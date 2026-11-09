import type { ConsoleMessage, Page, WebSocket } from 'playwright';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { WebAdapter } from '../adapters/web/playwright';
import { assertionCheck, requireAssertion, type AssertionReporter } from '../reporting/assertion_result';
import { parseDataPath, readDataPath } from './paths';
import { name } from './validation';
import { observeEventSource } from './sse';

const maxMessageBytes = 64 * 1024;
const timeout = z.number().int().min(1).max(120000);
const text = z.string().min(1).max(4000);
const expectName = { name, timeout: timeout.optional() };
const consoleArm = z.object({
  name, level: z.enum(['log','debug','info','warn','warning','error','assert','pageerror']).optional(), contains: text,
}).strict();
const channelArm = z.object({
  name, protocol: z.enum(['websocket', 'sse']), url: text, direction: z.enum(['received','sent']).optional(),
  event: z.string().regex(/^[\w.:-]{1,80}$/).optional(),
}).strict();
const channelExpect = z.object({
  ...expectName, contains: text.optional(), path: text.optional(), equals: z.json().optional(),
}).strict();

function urlPattern(input: string, protocol: 'websocket' | 'sse'): RegExp {
  // Keep the same single/double wildcard meaning as network captures, with a bounded matcher.
  const parts = input.split(/(\*+)/);
  if (parts.length > 5 || parts.some((part, index) => index % 2 && part.length > 2)) {
    throw new Error('Channel URL accepts at most two * or ** wildcards.');
  }
  if (!input.includes('*')) {
    let url: URL;
    try { url = new URL(input); } catch { throw new Error('Channel URL must be an absolute URL or a wildcard pattern.'); }
    const schemes = protocol === 'websocket' ? ['ws:', 'wss:'] : ['http:', 'https:'];
    if (!schemes.includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Channel URL uses the wrong protocol or contains credentials or a fragment.');
    parts[0] = url.href;
  }
  return new RegExp('^' + parts.map((part, index) => index % 2 ? part === '**' ? '.*' : '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
}

class Watch<T> {
  readonly abort = new AbortController();
  readonly observations: T[] = [];
  count = 0;
  omitted = 0;
  notify?: (value: T) => void;
  constructor(readonly profile: string, readonly dispose: () => void | Promise<void>) {}
  push(value: T, capacity: number) {
    if (this.abort.signal.aborted) return;
    this.count++;
    if (this.observations.length === capacity) {
      this.observations.shift();
      this.omitted++;
    }
    this.observations.push(value);
    this.notify?.(value);
  }
  wait(match: (value: T) => boolean, ms: number): Promise<T | undefined> {
    if (this.abort.signal.aborted) return Promise.resolve(undefined);
    const existing = this.observations.find(match);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise(resolve => {
      const done = (value?: T) => {
        clearTimeout(timer);
        this.abort.signal.removeEventListener('abort', cancelled);
        this.notify = undefined;
        resolve(value);
      };
      const cancelled = () => done();
      const timer = setTimeout(cancelled, ms);
      this.abort.signal.addEventListener('abort', cancelled, { once: true });
      this.notify = value => { if (match(value)) done(value); };
    });
  }
}

interface ConsoleWatch {
  watch: Watch<{ error?: Error }>;
  level?: string;
  seen: number;
}
interface ChannelWatch {
  watch: Watch<string>;
  protocol: 'websocket' | 'sse';
  oversized: number;
}

export class ApplicationEvents {
  private consoles = new Map<string, ConsoleWatch>();
  private channels = new Map<string, ChannelWatch>();
  constructor(private web: WebAdapter, private defaultTimeout: number) {}

  private page() {
    if (this.web.hasFrameScope?.()) throw new Error('Console and channel checks are tab-scoped. Return to the main frame before using them.');
    return this.web.getPage();
  }

  private checkArm<T>(map: Map<string, T>, key: string) {
    if (map.has(key)) throw new Error('This observer name is already armed in the active tab. Complete or cancel it before reusing the name.');
    if (map.size >= 16) throw new Error('At most 16 observers of each kind can be armed in a flow.');
  }

  private key(page: Page, id: string) {
    let key = this.pageKeys.get(page);
    if (!key) { key = ++this.nextPage; this.pageKeys.set(page, key); }
    return key + ':' + id;
  }
  private pageKeys = new WeakMap<Page, number>();
  private nextPage = 0;

  async console(action: string, input: unknown, reporter?: AssertionReporter) {
    const page = this.page();
    if (action === 'arm') {
      const data = consoleArm.parse(input), key = this.key(page, data.name);
      this.checkArm(this.consoles, key);
      const level = data.level === 'warn' ? 'warning' : data.level;
      const observe = (kind: string, message: string, error?: Error) => {
        if (entry.level && entry.level !== kind) return;
        entry.seen++;
        if (!watch.observations.length && message.includes(data.contains)) watch.push({ error }, 1);
      };
      const onConsole = (message: ConsoleMessage) => observe(message.type(), message.text());
      const onError = (error: Error) => observe('pageerror', error.message, error);
      const closed = () => watch.abort.abort();
      const watch = new Watch<{error?: Error}>(this.web.activeProfile, () => {
        page.off('console', onConsole);
        page.off('pageerror', onError);
        page.off('close', closed);
      });
      const entry = { watch, level, seen: 0 };
      this.consoles.set(key, entry);
      if (level === 'pageerror') page.on('pageerror', onError);
      else page.on('console', onConsole);
      page.on('close', closed);
      return;
    }
    if (action !== 'expect') throw new Error(`Unknown console action: ${action}`);
    const data = z.object(expectName).strict().parse(input), key = this.key(page, data.name);
    const entry = this.consoles.get(key);
    if (!entry) throw new Error('Arm this console observer in the active tab before triggering the message.');
    const ms = this.deadline(data.timeout), started = Date.now();
    try {
      const result = await entry.watch.wait(() => true, ms);
      const acknowledged = result?.error ? this.web.claimPageError(result.error) : !!result;
      const observed = result && !acknowledged ? 'This exact error was already claimed or could not be correlated.' : `${entry.seen} message(s) at the selected level`;
      requireAssertion('console.expect', `console observer "${data.name}"`, [
        assertionCheck('message', entry.level === 'pageerror' ? 'Expected uncaught browser error' : 'Expected application console message', acknowledged, entry.level || 'any console level', observed),
      ], reporter, {
        timeout: ms, elapsed: Date.now() - started,
        reason: !result ? entry.watch.abort.signal.aborted ? 'Console observation cancelled or its tab closed.' : 'Console expectation timed out. No message matched the armed level and text.' : undefined,
      });
    } finally { await this.remove(this.consoles, key, entry.watch); }
  }

  async channel(action: string, input: unknown, reporter?: AssertionReporter) {
    const page = this.page();
    if (action === 'arm') {
      const data = channelArm.parse(input), key = this.key(page, data.name);
      this.checkArm(this.channels, key);
      if (data.protocol === 'sse' && data.direction === 'sent' || data.protocol === 'websocket' && data.event !== undefined) {
        throw new Error('SSE observes incoming EventSource events. WebSocket accepts direction; SSE accepts event.');
      }
      const pattern = urlPattern(data.url, data.protocol);
      const event = data.direction === 'sent' ? 'framesent' : 'framereceived';
      const sockets = new Map<WebSocket, () => void>();
      let stopSSE: (() => Promise<void>) | undefined;
      const receive = (payload: unknown) => {
        if (typeof payload === 'string' && payload.length <= maxMessageBytes && Buffer.byteLength(payload) <= maxMessageBytes) {
          watch.push(payload, 32);
        } else entry.oversized++;
      };
      const onFrame = ({ payload }: { payload: string | Buffer }) => receive(payload);
      const onSocket = (socket: WebSocket) => {
        const url = socket.url();
        if (url.length > 4096 || !pattern.test(url) || sockets.size >= 32) return;
        const remove = () => {
          if (event === 'framesent') socket.off('framesent', onFrame);
          else socket.off('framereceived', onFrame);
          socket.off('close', remove);
          sockets.delete(socket);
        };
        sockets.set(socket, remove);
        if (event === 'framesent') socket.on('framesent', onFrame);
        else socket.on('framereceived', onFrame);
        socket.on('close', remove);
      };
      const closed = () => watch.abort.abort();
      const watch = new Watch<string>(this.web.activeProfile, async () => {
        page.off('websocket', onSocket);
        page.off('close', closed);
        for (const remove of sockets.values()) remove();
        await stopSSE?.();
      });
      const entry = { watch, protocol: data.protocol, oversized: 0 };
      this.channels.set(key, entry);
      page.on('close', closed);
      try {
        if (data.protocol === 'websocket') page.on('websocket', onSocket);
        else {
          stopSSE = await observeEventSource(page, pattern, data.event || 'message', maxMessageBytes, receive);
          if (watch.abort.signal.aborted) await stopSSE();
        }
      } catch (error) { await this.remove(this.channels, key, watch); throw error; }
      return;
    }
    if (action !== 'expect') throw new Error(`Unknown channel action: ${action}`);
    const data = channelExpect.parse(input), key = this.key(page, data.name);
    const entry = this.channels.get(key);
    if (!entry) throw new Error('Arm this channel in the active tab before the application opens its connection.');
    const equality = Object.hasOwn(data, 'equals');
    if (data.path !== undefined && !equality || data.contains !== undefined && equality) {
      throw new Error('Choose either contains, equals, or path with equals for a channel expectation.');
    }
    if (data.path !== undefined) parseDataPath(data.path);
    const match = (payload: string) => {
      if (data.contains !== undefined) return payload.includes(data.contains);
      if (!equality) return true;
      try {
        const parsed = JSON.parse(payload);
        return isDeepStrictEqual(data.path === undefined ? parsed : readDataPath(parsed, data.path), data.equals);
      } catch { return data.path === undefined && payload === data.equals; }
    };
    const ms = this.deadline(data.timeout), started = Date.now();
    try {
      const result = await entry.watch.wait(match, ms);
      const wanted = data.path !== undefined ? `JSON field "${data.path}" equals the configured value` : data.contains ? 'configured message text' : equality ? 'configured message value' : 'a text message';
      requireAssertion('channel.expect', `${entry.protocol.toUpperCase()} channel "${data.name}"`, [
        assertionCheck('message', 'Channel delivered a matching message', result !== undefined, wanted,
          `${entry.watch.count} text message(s); ${entry.watch.omitted} evicted; ${entry.oversized} binary or oversized ignored`),
      ], reporter, {
        timeout: ms, elapsed: Date.now() - started,
        reason: result === undefined ? entry.watch.abort.signal.aborted ? 'Channel observation cancelled or its tab closed.' : 'Channel expectation timed out without a matching message. Arm it before the connection opens and verify the URL, direction and message predicate.' : undefined,
      });
    } finally { await this.remove(this.channels, key, entry.watch); }
  }

  private deadline(value?: number) { return value ?? Math.min(this.defaultTimeout || 15000, 120000); }

  private async remove<T>(map: Map<string, { watch: Watch<T> }>, key: string, watch: Watch<T>) {
    if (map.get(key)?.watch !== watch) return;
    map.delete(key);
    watch.abort.abort();
    await watch.dispose();
  }

  cancel() {
    for (const entry of [...this.consoles.values(), ...this.channels.values()]) entry.watch.abort.abort();
  }

  async dispose(profile?: string) {
    const cleanups: Promise<void>[] = [];
    for (const [key, entry] of this.consoles) {
      if (!profile || entry.watch.profile === profile) cleanups.push(this.remove(this.consoles, key, entry.watch));
    }
    for (const [key, entry] of this.channels) {
      if (!profile || entry.watch.profile === profile) cleanups.push(this.remove(this.channels, key, entry.watch));
    }
    await Promise.all(cleanups);
  }
}
