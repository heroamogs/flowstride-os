import type { Disposable, Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { withDeadline } from '../ci/deadline';

interface Tap {
  binding: string;
  pattern: string;
  event: string;
  limit: number;
}

/** Runs in the application's document. Attach observers to real browser EventSources. */
function installTap(tap: Tap) {
  type SourceTap = (source: EventSource) => void;
  const root = window as Window & {
    __flowstrideEventSources?: { taps: Map<string, SourceTap>; removers: Map<string, AbortController>; remove: (id: string) => void };
  };
  let bridge = root.__flowstrideEventSources;
  if (!bridge) {
    const Native = window.EventSource;
    if (!Native) throw new Error('This browser document has no EventSource.');
    const taps = new Map<string, SourceTap>();
    const wrapped = new Proxy(Native, {
      construct(target, args, newTarget) {
        const source = Reflect.construct(target, args, newTarget) as EventSource;
        for (const observe of taps.values()) observe(source);
        return source;
      },
    });
    const removers = new Map<string, AbortController>();
    bridge = {
      taps, removers, remove(id) {
        removers.get(id)?.abort();
        removers.delete(id);
        taps.delete(id);
        if (!taps.size) {
          if (window.EventSource === wrapped) window.EventSource = Native;
          delete root.__flowstrideEventSources;
        }
      },
    };
    Object.defineProperty(root, '__flowstrideEventSources', { value: bridge, configurable: true });
    window.EventSource = wrapped;
  }
  if (bridge.taps.has(tap.binding)) return;
  const stop = new AbortController();
  bridge.removers.set(tap.binding, stop);
  const test = new RegExp(tap.pattern);
  let pending = 0;
  bridge.taps.set(tap.binding, source => {
    if (source.url.length > 4096 || !test.test(source.url)) return;
    source.addEventListener(tap.event, event => {
      if (!event.isTrusted || !(event instanceof MessageEvent) || typeof event.data !== 'string' || pending >= 16) return;
      const send = (window as unknown as Record<string, (data: string | null) => Promise<void>>)[tap.binding];
      if (typeof send !== 'function') return;
      pending++;
      void send(event.data.length <= tap.limit ? event.data : null).catch(() => {}).finally(() => pending--);
    }, { signal: stop.signal });
  });
}

function removeTap(binding: string) {
  (window as Window & { __flowstrideEventSources?: { remove: (id: string) => void } })
    .__flowstrideEventSources?.remove(binding);
}

export async function observeEventSource(page: Page, pattern: RegExp, event: string, limit: number, receive: (value: unknown) => void) {
  const tap = { binding: '__flowstrideSSE_' + randomUUID().replace(/-/g, ''), pattern: pattern.source, event, limit };
  let binding: Disposable | undefined, script: Disposable | undefined, active = true;
  const dispose = async () => {
    if (!active) return;
    active = false;
    await script?.dispose().catch(() => {});
    await withDeadline(Promise.allSettled(page.frames().map(frame => frame.evaluate(removeTap, tap.binding))), 1500).catch(() => {});
    await binding?.dispose().catch(() => {});
  };
  try {
    binding = await page.exposeBinding(tap.binding, (source, value: unknown) => {
      if (active && source.page === page) receive(value);
    });
    script = await page.addInitScript(installTap, tap);
    const main = page.mainFrame();
    const frames = page.frames();
    await Promise.all(frames.map(async frame => {
      try { await frame.evaluate(installTap, tap); }
      catch (error) { if (frame === main) throw error; }
    }));
    return dispose;
  } catch (error) {
    await dispose();
    throw new Error('Could not observe browser EventSource messages. Arm the SSE channel on an open tab before the application creates its EventSource.', { cause: error });
  }
}
