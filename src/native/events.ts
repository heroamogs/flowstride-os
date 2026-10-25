import { assertionCheck, requireAssertion, diagnosticValue, type AssertionReporter } from '../reporting/assertion_result';
import { z } from 'zod';
import type { Download, Request, Response, Route, BrowserContext, Page } from 'playwright';
import type { FlowstrideConfig } from '../types';
import { WebAdapter } from '../adapters/web/playwright';
import { name, positive, headers, evidencePath, readProjectFile } from './validation';
import { projectPath } from '../utils/projectPaths';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// The promise always resolves to an outcome, including timeout/cancellation. Arming a
// waiter never leaves a rejecting promise while a following click is still pending.
export class ArmedEvent<T> {
  private settled = false;
  private timer: NodeJS.Timeout;
  private resolve!: (value: { value?: T; error?: Error }) => void;
  readonly promise = new Promise<{ value?: T; error?: Error }>(resolve => { this.resolve = resolve; });
  constructor(timeout: number, private detach: () => void) {
    this.timer = setTimeout(() => this.fail(new Error('Armed event timed out.')), positive.parse(timeout));
  }
  capture(value: T) { if (this.settled) return; this.settled = true; clearTimeout(this.timer); this.detach(); this.resolve({ value }); }
  fail(error: Error) { if (this.settled) return; this.settled = true; clearTimeout(this.timer); this.detach(); this.resolve({ error }); }
  async take(): Promise<T> { const result = await this.promise; if (result.error) throw result.error; return result.value!; }
}
const urlPattern = z.string().min(1).max(4000);
export function matchesURL(pattern: string, url: string): boolean {
  const regexp = pattern.split('**').map(part => part.split('*').map(bit => bit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${regexp}$`).test(url);
}
const routeSchema = z.object({ name, url: urlPattern, method: z.string().optional(),
  mode: z.enum(['fulfill','abort','continue','patch']).default('fulfill'), status: z.number().int().min(100).max(599).optional(),
  headers: headers.optional(), json: z.unknown().optional(), body: z.string().optional(), fixture: z.string().optional(),
  contentType: z.string().optional(), request: z.object({ url: z.string().url().optional(), method: z.string().optional(), headers: headers.optional(), body: z.string().optional() }).strict().optional(),
  times: positive.optional(),
}).strict();
const armSchema = z.object({ name, url: urlPattern, method: z.string().optional(), kind: z.enum(['request','response']).default('response'), timeout: positive.optional(), status: z.number().int().optional() }).strict();
const networkExpect = z.object({ name, status: z.number().int().optional(), method: z.string().optional(), header: z.string().optional(), equals: z.unknown().optional(), path: z.string().optional(), contains: z.string().optional() }).strict();
export class NativeEvents {
  private routes = new Map<string, { context: BrowserContext; handler: (route: Route) => Promise<void>; pattern: string }>();
  private events = new Map<string, ArmedEvent<any>>();
  private captured = new Map<string, any>();
  private routeErrors: string[] = [];
  private generation = 0;
  private downloads = new Map<string, ArmedEvent<Download>>();
  private savedDownloads = new Map<string, { file: string; suggested: string }>();
  constructor(private web: WebAdapter, private config: FlowstrideConfig) {}
  private key(value: string) { return `${this.web.activeProfile}:${value}`; }
  async network(action: string, input: unknown, reporter?: AssertionReporter): Promise<any> {
    if (this.routeErrors.length) throw new Error(`Network route failed: ${this.routeErrors.shift()}`);
    if (action === 'route') {
      const data = routeSchema.parse(input), key = this.key(data.name), context = this.web.getContext();
      if (this.routes.has(key)) throw new Error('Route name already exists; remove it before replacing it.');
      const responseFields = ['status','headers','json','body','fixture','contentType'];
      if (['abort','continue'].includes(data.mode) && responseFields.some(key => key in data) || data.mode !== 'continue' && data.request !== undefined) throw new Error('Route options do not apply to the selected mode.');
      if (data.mode === 'abort' && data.request) throw new Error('Abort routes cannot modify requests.');
      if (data.mode === 'patch' && data.json !== undefined && (!data.json || typeof data.json !== 'object' || Array.isArray(data.json))) throw new Error('Response patches require a JSON object.');
      if ([data.json !== undefined, data.body !== undefined, data.fixture !== undefined].filter(Boolean).length > 1) throw new Error('Choose one route body source.');
      const body = data.fixture ? readProjectFile(this.config, data.fixture) : data.body;
      let remaining = data.times ?? Infinity; const generation = this.generation;
      const operation = async (route: Route) => {
        if (remaining <= 0 || data.method && route.request().method().toUpperCase() !== data.method.toUpperCase()) return route.fallback();
        if (--remaining === 0) this.routes.delete(key);
        if (data.mode === 'abort') return route.abort();
        if (data.mode === 'continue') return route.continue({ ...data.request, postData: data.request?.body, headers: data.request?.headers ? { ...route.request().headers(), ...data.request.headers } : undefined });
        if (data.mode === 'patch') {
          const response = await route.fetch();
          const original = data.json === undefined ? undefined : await response.json();
          await route.fulfill({ response, status: data.status, headers: data.headers ? { ...response.headers(), ...data.headers } : undefined,
            ...(data.json === undefined ? { body } : { json: { ...original, ...(data.json as object) } }) });
        } else await route.fulfill({ status: data.status ?? 200, headers: data.headers, contentType: data.contentType,
          ...(data.json === undefined ? { body: body ?? '' } : { json: data.json }) });
      };
      const handler = async (route: Route) => {
        try { await operation(route); if (remaining === 0) await context.unroute(data.url, handler); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (generation === this.generation) { this.routeErrors.push(message); this.web.pageErrors.push(`Native route: ${message}`); }
          await route.abort().catch(() => {});
        }
      };
      await context.route(data.url, handler); this.routes.set(key, { context, pattern: data.url, handler }); return;
    }
    if (action === 'unroute') {
      const data = z.object({ name }).strict().parse(input), key = this.key(data.name), route = this.routes.get(key);
      if (!route) throw new Error('Unknown route.'); await route.context.unroute(route.pattern, route.handler); this.routes.delete(key); return;
    }
    if (action === 'arm') {
      const data = armSchema.parse(input), key = this.key(data.name), context = this.web.getContext();
      if (data.kind === 'request' && data.status !== undefined) throw new Error('A request event has no response status.');
      if (this.events.has(key)) throw new Error('Event name already armed.');
      const listener = (event: Request | Response) => {
        const request = data.kind === 'request' ? event as Request : (event as Response).request();
        if (!matchesURL(data.url, request.url()) || data.method && request.method().toUpperCase() !== data.method.toUpperCase() || data.kind === 'response' && data.status !== undefined && (event as Response).status() !== data.status) return;
        armed.capture(event);
      };
      const armed = new ArmedEvent<Request | Response>(data.timeout ?? this.config.timeout, () => data.kind === 'request' ? context.off('request', listener) : context.off('response', listener));
      if (data.kind === 'request') context.on('request', listener); else context.on('response', listener); this.events.set(key, armed); return;
    }
    if (action === 'wait') {
      const data = z.object({ name }).strict().parse(input), key = this.key(data.name), armed = this.events.get(key);
      if (!armed) throw new Error('Arm the network event before triggering its request.');
      try {
        const event = await armed.take(), response = typeof event.status === 'function' ? event as Response : undefined;
        const request = response ? response.request() : event as Request;
        let body: unknown = request.postData();
        if (response) {
          const length = Number(response.headers()['content-length'] || 0);
          if (length > 20 * 1024 * 1024) throw new Error('Captured response exceeds the 20 MiB limit.');
          const content = await response.body();
          if (content.length > 20 * 1024 * 1024) throw new Error('Captured response exceeds the 20 MiB limit.');
          body = content.toString('utf8');
        }
        try { body = JSON.parse(String(body)); } catch {}
        const result = { url: request.url(), method: request.method(), status: response?.status(), headers: response ? await response.allHeaders() : await request.allHeaders(), body };
        this.captured.set(key, result); return result;
      } finally { this.events.delete(key); }
    }
    if (action === 'expect') {
      const data = networkExpect.parse(input), result = this.captured.get(this.key(data.name));
      if (!result) throw new Error('No captured event; call network.wait first.');
      if (!['status','method','equals','contains'].some(key => key in data)) throw new Error('Provide a network expectation.');
      const checks = [];
      if (data.status !== undefined) checks.push(assertionCheck('status','status',result.status===data.status,data.status,result.status));
      if (data.method) checks.push(assertionCheck('method','method',result.method===data.method.toUpperCase(),data.method.toUpperCase(),result.method));
      let actual = data.header ? result.headers[data.header.toLowerCase()] : result.body;
      if (data.path) for (const key of data.path.split('.')) actual=actual?.[key];
      const protect = (value:unknown) => /password|passcode|secret|token|authorization|cookie|api.?key|otp/i.test((data.header||'')+' '+(data.path||'')) ? '[REDACTED]' : value;
      if ('equals' in data) checks.push(assertionCheck('equals',(data.header?'header '+data.header:data.path?'body path '+data.path:'body')+' equals',isDeepStrictEqual(actual,data.equals),protect(data.equals),protect(actual)));
      if (data.contains !== undefined) checks.push(assertionCheck('contains','content contains',String(actual).includes(data.contains),protect(data.contains),protect(actual)));
      requireAssertion('network.expect','captured network event '+JSON.stringify(data.name),checks,reporter,{reason:checks.some(check=>check.status==='failed'&&['status','method'].includes(check.key))?'Network status/method assertion failed.':checks.some(check=>check.status==='failed')?'Network content assertion failed.':undefined});
      return;
    }
    throw new Error(`Unknown network action: ${action}`);
  }
  async download(action: string, input: unknown, reporter?: AssertionReporter): Promise<any> {
    if (action === 'arm') {
      const data = z.object({ name, timeout: positive.optional() }).strict().parse(input), key = this.key(data.name), page = this.web.getPage();
      if (this.downloads.has(key)) throw new Error('Download name already armed.');
      const listener = (download: Download) => armed.capture(download);
      const armed = new ArmedEvent<Download>(data.timeout ?? this.config.timeout, () => page.off('download', listener));
      page.on('download', listener); this.downloads.set(key, armed); return;
    }
    if (action === 'save') {
      const data = z.object({ name, file: z.string().min(1) }).strict().parse(input), key = this.key(data.name), armed = this.downloads.get(key);
      if (!armed) throw new Error('Arm the download before clicking its trigger.');
      try {
        const download = await armed.take();
        const file = projectPath(this.config.projectRoot || process.cwd(), data.file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file)) throw new Error('Download destination exists; choose a new file.');
        await download.saveAs(file); const failure = await download.failure(); if (failure) throw new Error(`Download failed: ${failure}`);
        this.savedDownloads.set(key, { file, suggested: download.suggestedFilename() }); return file;
      } finally { this.downloads.delete(key); }
    }
    if (action === 'expect') {
      const data = z.object({ name, filename: z.string().optional(), size: z.number().int().nonnegative().optional(), minSize: z.number().int().nonnegative().optional(), contains: z.string().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), json: z.unknown().optional() }).strict().parse(input);
      if (!['filename','size','minSize','contains','sha256','json'].some(key => key in data)) throw new Error('Provide a download expectation.');
      const saved = this.savedDownloads.get(this.key(data.name)); if (!saved) throw new Error('Download not saved.');
      const absolute = projectPath(this.config.projectRoot || process.cwd(), saved.file), length = fs.statSync(absolute).size;
      const body = data.contains !== undefined || 'json' in data ? readProjectFile(this.config, saved.file) : Buffer.alloc(0);
      let sha256: string | undefined;
      if (data.sha256) { const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(absolute)) hash.update(chunk); sha256 = hash.digest('hex'); }
      const checks=[];
      if(data.filename!==undefined)checks.push(assertionCheck('filename','filename',saved.suggested===data.filename,data.filename,saved.suggested));
      if(data.size!==undefined)checks.push(assertionCheck('size','size',length===data.size,data.size,length));
      if(data.minSize!==undefined)checks.push(assertionCheck('minSize','minimum size',length>=data.minSize,data.minSize,length));
      if(data.contains!==undefined)checks.push(assertionCheck('contains','content contains',body.toString('utf8').includes(data.contains),data.contains,body.toString('utf8')));
      if(data.sha256!==undefined)checks.push(assertionCheck('sha256','SHA-256',sha256===data.sha256,data.sha256,sha256));
      if('json' in data){try{const actual=JSON.parse(body.toString('utf8'));checks.push(assertionCheck('json','JSON content',isDeepStrictEqual(actual,data.json),data.json,actual));}catch(error){checks.push({...assertionCheck('json','JSON content',false,data.json,body.toString('utf8')),reason:'Downloaded content is not valid JSON: '+diagnosticValue(error instanceof Error?error.message:String(error))});}}
      requireAssertion('download.expect','saved download '+JSON.stringify(data.name),checks,reporter,{reason:checks.some(check=>check.status==='failed')?'Download assertion failed.':undefined});
      return;
    }
    throw new Error(`Unknown download action: ${action}`);
  }
  async disposeProfile(profile: string) {
    const prefix = profile + ':';
    for (const map of [this.events, this.downloads]) for (const [key, event] of map) if (key.startsWith(prefix)) { event.fail(new Error('Profile closed.')); map.delete(key); }
    for (const map of [this.captured, this.savedDownloads]) for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    for (const [key, route] of this.routes) if (key.startsWith(prefix)) { await route.context.unroute(route.pattern, route.handler).catch(() => {}); this.routes.delete(key); }
  }
  async dispose() {
    this.generation++;
    for (const armed of [...this.events.values(), ...this.downloads.values()]) armed.fail(new Error('Event cancelled during cleanup.'));
    this.events.clear(); this.downloads.clear(); this.captured.clear(); this.savedDownloads.clear();
    for (const route of this.routes.values()) await route.context.unroute(route.pattern, route.handler).catch(() => {});
    this.routes.clear(); this.routeErrors = [];
  }
}
