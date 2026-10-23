import { z } from 'zod';
import type { Page, Disposable } from 'playwright';
import { positive, name, poll } from './validation';
import { isDeepStrictEqual } from 'node:util';
const target = z.string().min(1).refine(value => value.split('.').every(key => /^[a-zA-Z_$][\w$]*$/.test(key) && !['__proto__','prototype','constructor'].includes(key)), 'Use a safe dotted function path.');
const schema = z.object({ name, target, mode: z.enum(['spy','return','throw']).default('spy'), value: z.unknown().optional(), error: z.string().optional(), async: z.boolean().default(false), beforeLoad: z.boolean().default(false) }).strict();
function install(data: z.infer<typeof schema>) {
  const symbol = Symbol.for('flowstride.function-doubles');
  const registry = (window as any)[symbol] ||= Object.create(null);
  if (registry[data.name]) throw new Error('Function double name already exists.');
  const keys = data.target.replace(/^window\./, '').split('.'); let object: any = window;
  for (const key of keys.slice(0, -1)) object = object[key];
  const key = keys.at(-1)!, original = object[key], own = Object.getOwnPropertyDescriptor(object, key);
  if (typeof original !== 'function') throw new Error(`Target is not a function: ${data.target}`);
  const calls: unknown[][] = [];
  const replacement = function(this: unknown, ...args: any[]) {
    let snapshot: any[];
    try { snapshot = JSON.parse(JSON.stringify(args)); } catch { snapshot = args.map(value => String(value)); }
    calls.push(snapshot);
    if (data.mode === 'spy') return original.apply(this, args);
    if (data.mode === 'throw') { const error = new Error(data.error || 'Stubbed function error'); if (data.async) return Promise.reject(error); throw error; }
    return data.async ? Promise.resolve(data.value) : data.value;
  };
  Object.defineProperty(object, key, { configurable: true, writable: true, value: replacement });
  registry[data.name] = { calls, restore: () => { if (own) Object.defineProperty(object, key, own); else delete object[key]; } };
}
export class NativeFunctions {
  private installed = new Map<string, { name:string; page: Page; script?: Disposable }>();
  private pages = new WeakMap<Page,number>(); private counter = 0;
  private key(page: Page, name: string) { if (!this.pages.has(page)) this.pages.set(page, ++this.counter); return `${this.pages.get(page)}:${name}`; }
  async execute(page: Page, action: string, input: unknown, timeout: number) {
    if (action === 'install') {
      const data = schema.parse(input);
      if (this.installed.has(this.key(page,data.name))) throw new Error('Function double name already exists; restore it first.');
      const script = data.beforeLoad ? await page.addInitScript(install, data) : undefined;
      try { if (!data.beforeLoad || page.url() !== 'about:blank') await page.evaluate(install, data); }
      catch (error) { await script?.dispose(); throw error; }
      this.installed.set(this.key(page,data.name), { name:data.name, page, script }); return;
    }
    if (action === 'restore') {
      const data = z.object({ name }).strict().parse(input), entry = this.installed.get(this.key(page,data.name));
      if (!entry || entry.page !== page) throw new Error('Unknown function double on this page.');
      await entry.script?.dispose();
      await page.evaluate(name => { const registry = (window as any)[Symbol.for('flowstride.function-doubles')]; registry?.[name]?.restore(); if (registry) delete registry[name]; }, data.name);
      this.installed.delete(this.key(page,data.name)); return;
    }
    if (action === 'expect') {
      const data = z.object({ name, count: z.number().int().nonnegative().optional(), minCount: z.number().int().nonnegative().optional(), args: z.array(z.unknown()).optional(), timeout: positive.optional() }).strict().parse(input);
      if (!['count','minCount','args'].some(key => key in data)) throw new Error('Provide a call count or expected arguments.');
      await poll(async () => {
        const calls = await page.evaluate(name => (window as any)[Symbol.for('flowstride.function-doubles')]?.[name]?.calls, data.name);
        return Array.isArray(calls) && (data.count === undefined || calls.length === data.count) && (data.minCount === undefined || calls.length >= data.minCount) && (data.args === undefined || calls.some(call => isDeepStrictEqual(call, data.args)));
      }, data.timeout ?? timeout, `function double ${data.name}`); return;
    }
    throw new Error(`Unknown stub action: ${action}`);
  }
  async dispose() {
    for (const entry of this.installed.values()) {
      const name = entry.name;
      await entry.script?.dispose().catch(() => {});
      if (!entry.page.isClosed()) await entry.page.evaluate(name => { const registry = (window as any)[Symbol.for('flowstride.function-doubles')]; registry?.[name]?.restore(); if (registry) delete registry[name]; }, name).catch(() => {});
    }
    this.installed.clear();
  }
}
