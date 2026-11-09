import type { Locator } from 'playwright';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const browserGlobals = new Set(['window','document','ownerDocument','defaultView','parentWindow','contentWindow','contentDocument','frames','location','navigator','localStorage','sessionStorage']);

/** Read data, never expressions, functions, prototype chains or browser globals. */
export function parseDataPath(path: unknown): string[] {
  if (typeof path !== 'string' || !path.length || path.length > 1000) throw new Error('A property/data path must contain 1–1000 characters.');
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (parts.length > 32 || parts.some(part => !/^(?:[A-Za-z_$][\w$-]*|\d+)$/.test(part) || forbidden.has(part))) {
    throw new Error('Unsafe property/data path. Use dot-separated property names or numeric array indices; prototype and browser-global access is forbidden.');
  }
  return parts;
}

/** Detached, bounded JSON values prevent state mutation and unsafe object reuse. */
export function dataSnapshot(value: unknown): any {
  let nodes = 0, size = 0;
  const seen = new Set<object>();
  const copy = (input: any, depth: number): any => {
    if (++nodes > 10000 || depth > 32) throw new Error('Extracted data exceeds the snapshot complexity limit.');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') { size += input.length; if (size > 1024 * 1024) throw new Error('Extracted data exceeds the 1 MiB snapshot limit.'); return input; }
    if (!input || typeof input !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(input)) || seen.has(input)) throw new Error('Extracted value must be finite, acyclic JSON data. Choose a nested property for browser objects.');
    seen.add(input);
    if (Array.isArray(input) && Object.keys(input).length !== input.length) throw new Error('Snapshots require dense JSON arrays.');
    const pairs = Object.keys(input).map(key => {
      size += key.length; if (size > 1024 * 1024) throw new Error('Data snapshot exceeds 1 MiB.');
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!('value' in descriptor)) throw new Error('Data snapshots cannot execute getters.');
      return [key, copy(descriptor.value, depth + 1)] as const;
    });
    seen.delete(input);
    return Array.isArray(input) ? pairs.map(([, item]) => item) : Object.fromEntries(pairs);
  };
  return copy(value, 0);
}

export function readDataPath(value: unknown, path: string): unknown {
  const parts = parseDataPath(path);
  let current: any = value;
  for (const key of parts) {
    if (current === null || typeof current !== 'object') throw new Error(`Data path "${path}" does not exist (missing "${key}").`);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`Data path "${path}" does not exist or is not a plain data field ("${key}").`);
    current = descriptor.value;
  }
  return dataSnapshot(current);
}

export function parseBrowserPropertyPath(path: string): string[] {
  const parts = parseDataPath(path);
  if (parts.some(part => browserGlobals.has(part))) throw new Error('Browser property paths cannot access browser globals.');
  return parts;
}

export async function readBrowserProperty(locator: Locator, path: string): Promise<unknown> {
  const parts = parseBrowserPropertyPath(path);
  const count = await locator.count();
  if (count !== 1) throw new Error(`Property extraction requires exactly one target; found ${count}. Narrow the readable target with a qualifier, spatial relationship, or explicit selector.`);
  const value = await locator.evaluate((element, parts) => {
    let current: any = element;
    for (const key of parts) {
      if (current == null || !(key in Object(current))) throw new Error(`Browser property path does not exist at "${key}".`);
      const prototype = Object.getPrototypeOf(Object(current));
      const plain = prototype === Object.prototype || prototype === null || Array.isArray(current);
      const descriptor = Object.getOwnPropertyDescriptor(Object(current), key);
      if (plain && (!descriptor || !('value' in descriptor))) throw new Error('Browser property paths cannot execute custom getters or read inherited data fields.');
      if (descriptor && !('value' in descriptor)) {
        // Controlled inputs may install an own value/checked accessor. Read the
        // browser's native state getter without executing that application wrapper.
        let ancestor = current instanceof Element ? Object.getPrototypeOf(current) : null;
        let nativeDescriptor: PropertyDescriptor | undefined;
        while (ancestor && !nativeDescriptor) { nativeDescriptor = Object.getOwnPropertyDescriptor(ancestor,key); ancestor = Object.getPrototypeOf(ancestor); }
        if (!nativeDescriptor?.get || !Function.prototype.toString.call(nativeDescriptor.get).includes('[native code]')) throw new Error('Browser property paths cannot execute custom getters.');
        current = nativeDescriptor.get.call(current);
      } else current = current[key];
      if (typeof current === 'function') throw new Error('Browser property paths cannot read or execute functions.');
      if (current && typeof current === 'object') {
        const nextPrototype = Object.getPrototypeOf(current);
        const safeHost = current instanceof ValidityState || current instanceof DOMStringMap || current instanceof CSSStyleDeclaration || current instanceof DOMTokenList;
        if (current instanceof Node || current instanceof Window || ![Object.prototype, null, Array.prototype].includes(nextPrototype) && !safeHost) throw new Error('Browser property paths cannot traverse DOM nodes, browser globals or other browser objects. Select the intended element directly.');
      }
    }
    // Serialize only plain data using descriptors; do not invoke toJSON or custom getters.
    let nodes = 0, size = 0;
    const seen = new Set<object>();
    const copy = (input: any, depth: number): any => {
      if (++nodes > 10000 || depth > 32) throw new Error('Browser property snapshot exceeds the complexity limit.');
      if (input === null || typeof input === 'boolean') return input;
      if (typeof input === 'number' && Number.isFinite(input)) return input;
      if (typeof input === 'string') { size += input.length; if (size > 1024 * 1024) throw new Error('Browser property snapshot exceeds 1 MiB.'); return input; }
      if (!input || typeof input !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(input)) || seen.has(input)) throw new Error('Choose a nested property returning plain JSON data, rather than a browser object.');
      seen.add(input);
      if (Array.isArray(input) && Object.keys(input).length !== input.length) throw new Error('Snapshots require dense JSON arrays.');
    const pairs = Object.keys(input).map(key => {
        size += key.length; if (size > 1024 * 1024) throw new Error('Data snapshot exceeds 1 MiB.');
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor)) throw new Error('Browser snapshots cannot execute custom getters.');
        return [key, copy(descriptor.value, depth + 1)] as const;
      });
      seen.delete(input);
      return Array.isArray(input) ? pairs.map(([, item]) => item) : Object.fromEntries(pairs);
    };
    return copy(current, 0);
  }, parts);
  return dataSnapshot(value);
}
