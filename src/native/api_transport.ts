import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import type { FlowstrideConfig } from '../types';
import type { ApiState } from '../adapters/api/undici';
import { writePrivateState } from '../security/privateState';
import { artifactPrefix } from '../utils/projectPaths';
import { DATA_LIMIT, readBoundedProjectFile } from './project_data';
import { headers, name } from './validation';

const transferLimit = 20 * DATA_LIMIT;
const methods = z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const parameters = z.record(z.string(), z.union([scalar, z.array(scalar)]));
const fixture = z.object({
  path: z.string().min(1).max(4000),
  contentType: z.string().regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/).optional(),
}).strict();
export const apiTimeout = z.number().int().min(1).max(120000);
export const apiRequestFields = {
  url: z.string().min(1).max(4000), headers: headers.optional(), query: parameters.optional(),
  timeout: apiTimeout.optional(), followRedirects: z.boolean().default(false),
};
export const apiRequestSchema = z.object({
  ...apiRequestFields, method: methods.default('GET'), json: z.json().optional(), form: parameters.optional(),
  multipart: z.record(z.string(), z.union([scalar, fixture])).optional(),
  body: z.string().optional(), binary: fixture.optional(), saveAs: name.optional(),
}).strict();
export type ApiRequest = z.infer<typeof apiRequestSchema>;
export type CompleteApiState = ApiState & { status: number; jsonBody: boolean };

export function httpURL(value: string, base?: string): URL {
  let url: URL;
  try { url = new URL(value, base); }
  catch { throw new Error('API URL is invalid. Use an absolute HTTP(S) URL or configure a base URL for relative requests.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('API URL must use HTTP(S), without embedded credentials or a fragment.');
  }
  return url;
}

export function requestHeaders(...sources: (Record<string, string> | undefined)[]): Headers {
  const result = new Headers({ Accept: 'application/json, text/plain, */*', 'User-Agent': 'Flowstride/1.0' });
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (/^(?:host|content-length|transfer-encoding|connection|keep-alive|upgrade|proxy-.*|te|trailer|expect)$/i.test(key)) {
        throw new Error('API request headers cannot override HTTP framing or proxy controls.');
      }
      try { result.set(key, value); }
      catch { throw new Error('API request contains an invalid header name or value.'); }
    }
  }
  return result;
}

function searchParams(values: z.infer<typeof parameters>, target = new URLSearchParams()) {
  for (const [key, valuesOrValue] of Object.entries(values)) {
    for (const value of Array.isArray(valuesOrValue) ? valuesOrValue : [valuesOrValue]) target.append(key, String(value));
  }
  return target;
}

function encodeBody(config: FlowstrideConfig, data: ApiRequest, headers: Headers): BodyInit | undefined {
  const modes = ['json', 'form', 'multipart', 'body', 'binary'] as const;
  const active = modes.filter(mode => data[mode] !== undefined);
  if (active.length > 1) throw new Error('Choose only one API body source: json, form, multipart, body or binary.');
  if (!active.length) return;
  if (['GET', 'HEAD'].includes(data.method)) throw new Error(`API ${data.method} requests cannot have a body.`);
  const contentType = (type: string) => { if (!headers.has('content-type')) headers.set('content-type', type); };
  let body: string;
  switch (active[0]) {
    case 'binary': {
      contentType(data.binary!.contentType || 'application/octet-stream');
      return new Uint8Array(readBoundedProjectFile(config, data.binary!.path, transferLimit));
    }
    case 'multipart': {
      if (headers.has('content-type')) throw new Error('Multipart requests generate their own Content-Type and boundary. Remove the manual header.');
      const entries = Object.entries(data.multipart!);
      if (entries.length > 64) throw new Error('Multipart requests support up to 64 fields.');
      const form = new FormData();
      let bytes = 0;
      for (const [key, value] of entries) {
        if (!key.length || key.length > 256 || /[\x00-\x1f\x7f]/.test(key)) throw new Error('Multipart field names must be 1–256 printable characters.');
        if (typeof value !== 'object') {
          bytes += Buffer.byteLength(String(value));
          form.append(key, String(value));
        } else {
          const file = readBoundedProjectFile(config, value.path, transferLimit - bytes);
          const filename = path.basename(value.path);
          if (/[\x00-\x1f\x7f]/.test(filename)) throw new Error('Multipart filenames must be printable.');
          bytes += file.length;
          form.append(key, new Blob([new Uint8Array(file)], { type: value.contentType || 'application/octet-stream' }), filename);
        }
        if (bytes > transferLimit) throw new Error('Multipart content exceeds the 20 MiB limit.');
      }
      return form;
    }
    case 'json': contentType('application/json'); body = JSON.stringify(data.json); break;
    case 'form': contentType('application/x-www-form-urlencoded'); body = searchParams(data.form!).toString(); break;
    case 'body': contentType('text/plain; charset=utf-8'); body = data.body!; break;
  }
  if (Buffer.byteLength(body) > transferLimit) throw new Error('API request body exceeds the 20 MiB limit.');
  return body;
}

async function readResponse(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    if (Number(response.headers.get('content-length')) > limit) throw new Error(`API response exceeds the ${limit / DATA_LIMIT} MiB limit.`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > limit) throw new Error(`API response exceeds the ${limit / DATA_LIMIT} MiB limit.`);
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function collectCookies(jar: CookieJar | undefined, cookies: string[], url: URL) {
  if (!jar) return;
  for (const cookie of cookies) if (cookie.length <= 4096) jar.setCookieSync(cookie, url.href, { ignoreError: true });
  if (jar.serializeSync()!.cookies.length > 128) throw new Error('API context cookie jar exceeded 128 cookies. Close or reset this context.');
}

export async function sendApiRequest(
  config: FlowstrideConfig, data: ApiRequest, url: URL, headers: Headers, signal: AbortSignal, jar?: CookieJar,
): Promise<CompleteApiState> {
  signal.throwIfAborted();
  if (data.query) searchParams(data.query, url.searchParams);
  if (url.href.length > 8192) throw new Error('API URL including query parameters exceeds 8192 characters.');
  let method = data.method, body = encodeBody(config, data, headers);
  const originalCookie = headers.get('cookie');
  const start = performance.now();
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    if (jar && !originalCookie) {
      const cookies = jar.getCookieStringSync(url.href);
      if (cookies) headers.set('cookie', cookies);
      else headers.delete('cookie');
    }
    let response: Response;
    try { response = await fetch(url, { method, headers, body, signal, redirect: 'manual' }); }
    catch (error) {
      signal.throwIfAborted();
      const code = (error as { cause?: { code?: unknown } })?.cause?.code;
      throw new Error(`API ${method} request could not connect or receive response headers${typeof code === 'string' && /^\w+$/.test(code) ? ` (${code})` : ''}.`);
    }
    const cookies = response.headers.getSetCookie();
    const location = response.headers.get('location');
    if (data.followRedirects && location && [301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      if (redirects >= 5) throw new Error('API request exceeded the limit of five redirects.');
      const next = httpURL(location, url.href);
      if (next.origin !== url.origin) throw new Error('API redirect blocked because it changes origin.');
      if (next.href.length > 8192) throw new Error('API redirect URL exceeds 8192 characters.');
      collectCookies(jar, cookies, url);
      if (method !== 'HEAD' && (response.status === 303 || [301, 302].includes(response.status) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
      } else if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        throw new Error(`API redirect would resend a ${method} request. Call the destination explicitly.`);
      }
      url = next;
      continue;
    }

    const responseHeaders: ApiState['headers'] = Object.fromEntries(response.headers);
    if (cookies.length) responseHeaders['set-cookie'] = cookies;
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const textBody = !mediaType || /^(?:text\/|application\/(?:json|xml|x-www-form-urlencoded)$)/.test(mediaType) || /\+(?:json|xml)$/.test(mediaType);
    const bytes = await readResponse(response, data.saveAs || !textBody ? transferLimit : DATA_LIMIT, signal);
    signal.throwIfAborted();
    collectCookies(jar, cookies, url);
    let parsed: unknown = null, jsonBody = false;
    if (data.saveAs && response.ok) {
      const output = 'api-responses/' + artifactPrefix(config.testFile) + data.saveAs;
      writePrivateState(config.projectRoot || process.cwd(), output, bytes);
    }
    if (textBody && bytes.length && bytes.length <= DATA_LIMIT) {
      parsed = bytes.toString('utf8');
      try { parsed = JSON.parse(parsed as string); jsonBody = true; } catch {}
    }
    return { status: response.status, headers: responseHeaders, body: parsed, jsonBody, responseTime: Math.round(performance.now() - start) };
  }
}

export async function withinApiDeadline<T>(timeout: number, parent: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(timeout);
  const signal = AbortSignal.any([parent, deadline]);
  try { signal.throwIfAborted(); return await action(signal); }
  catch (error) {
    if (parent.aborted) throw new Error('API operation cancelled.');
    if (deadline.aborted) throw new Error(`API operation timed out after ${timeout} ms.`);
    throw error;
  }
}
