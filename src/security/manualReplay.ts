import { isSensitiveField, REDACTED, redactText } from './sensitiveFields';
import { excludedRequestHeaders } from '../utils/requestHeaders';

export interface ReplayTemplate {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}
const emailAddress = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const maskText = (value: string, secrets: string[]) => redactText(value, secrets).replace(emailAddress, REDACTED);
function headerObject(value: any): Record<string, any> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return { 'X-Invalid-Captured-Headers': REDACTED }; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function parseJson(value: string): { parsed: any } | undefined {
  try { return { parsed: JSON.parse(value) }; } catch { return; }
}
function inlineCredentials(value: string): string[] {
  const credentials: string[] = [];
  const fields = /\b([A-Za-z_][\w.-]*)["']?\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)/g;
  for (const match of value.matchAll(fields)) {
    if (value[(match.index ?? 0) - 1] === '$' || !isSensitiveField(match[1]) || /^\$[A-Za-z_]\w*[\])}]*$/.test(match[2])) continue;
    let secret = match[2];
    if (secret.startsWith('"')) { try { secret = JSON.parse(secret); } catch { continue; } }
    else if (secret.startsWith("'")) secret = secret.slice(1, -1).replace(/\\(['\\])/g, '$1');
    credentials.push(secret);
  }
  return credentials;
}
function maskData(value: any, secrets: string[], depth = 0): any {
  if (depth > 32) return REDACTED;
  if (typeof value === 'string') {
    const json = parseJson(value);
    if (json && typeof json.parsed === 'object' && json.parsed !== null) return JSON.stringify(maskData(json.parsed, secrets, depth + 1));
    if (inlineCredentials(value).length) return REDACTED;
    return maskText(value, secrets);
  }
  if (Array.isArray(value)) return value.map(item => maskData(item, secrets, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSensitiveField(key) ? REDACTED : maskData(item, secrets, depth + 1)]));
}
function maskUrl(value: string, secrets: string[]): string {
  try {
    const url = new URL(value);
    let changed = false;
    if (url.username || url.password) { url.username = REDACTED; url.password = REDACTED; changed = true; }
    const entries = [...url.searchParams.entries()].map(([key, item]) => {
      const masked = isSensitiveField(key) || /^(?:signature|ticket|x-amz-)/i.test(key) ? REDACTED : maskText(item, secrets);
      if (masked !== item) changed = true;
      return [key, masked] as [string, string];
    });
    if (changed) url.search = new URLSearchParams(entries).toString();
    return maskText(changed ? url.href : value, secrets);
  } catch { return maskText(value, secrets); }
}

/** A disposable manual template, never a cache of original credentials. */
export function sanitizeReplayRequest(value: any, secrets: string[] = []): ReplayTemplate {
  const originalHeaders = headerObject(value?.headers);
  const headers = Object.fromEntries(Object.entries(originalHeaders).map(([key, item]) => {
    const text = typeof item === 'string' ? item : REDACTED;
    const masked = /^authorization$/i.test(key) && /^(Bearer|Basic)\s+/i.test(text)
      ? text.split(/\s+/, 1)[0] + ' ' + REDACTED
      : /^(?:cookie|set-cookie)$/i.test(key)
        ? text.split(';').map(part => { const index = part.indexOf('='); return index < 0 ? REDACTED : part.slice(0, index).trim() + '=' + REDACTED; }).join('; ')
        : isSensitiveField(key) ? REDACTED : maskText(text, secrets);
    return [key, masked];
  }));
  const contentType = String(Object.entries(originalHeaders).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '');
  const originalBody = value?.body;
  let body: string | null = null;
  if (originalBody !== undefined && originalBody !== null) {
    let text: string;
    try { text = typeof originalBody === 'string' ? originalBody : JSON.stringify(originalBody); if (typeof text !== 'string') text = REDACTED; }
    catch { text = REDACTED; }
    const json = parseJson(text);
    if (/multipart\/form-data|application\/octet-stream/i.test(contentType)) body = REDACTED;
    else if (json) {
      const masked = maskData(json.parsed, secrets);
      body = JSON.stringify(masked) === JSON.stringify(json.parsed) ? text : JSON.stringify(masked, null, 2);
    } else if (/application\/x-www-form-urlencoded/i.test(contentType) || (!contentType && /(?:^|&)[^=&\s]+=/m.test(text))) {
      let changed = false;
      const fields = [...new URLSearchParams(text).entries()].map(([key, item]) => {
        const masked = isSensitiveField(key) ? REDACTED : maskText(item, secrets);
        if (masked !== item) changed = true;
        return [key, masked] as [string, string];
      });
      body = changed ? new URLSearchParams(fields).toString() : text;
    } else if (/json|multipart\/form-data/i.test(contentType) || /^[\s]*[\[{]/.test(text)) {
      body = REDACTED; // Do not guess at malformed JSON or opaque multipart fields.
    } else if (/(?:password|passcode|secret|token|authorization|cookie|api[_-]?key)\s*[=:]/i.test(text)) {
      body = REDACTED;
    } else body = maskText(text, secrets);
  }
  return {
    method: typeof value?.method === 'string' ? value.method.toUpperCase() : 'GET',
    url: maskUrl(String(value?.url || ''), secrets), headers, body,
  };
}

/** Ignore legacy raw capture fields when opening older saved logs. */
export function replayTemplateFromLog(details: any): ReplayTemplate {
  const request = details?.replayRequest && typeof details.replayRequest === 'object' ? details.replayRequest : undefined;
  return sanitizeReplayRequest(request || {
    method: details?.method, url: details?.url, headers: details?.requestHeaders,
    body: details?.requestBody,
  });
}

function decoded(value: string): string {
  for (let index = 0; index < 2; index++) { try { const next = decodeURIComponent(value); if (next === value) break; value = next; } catch { break; } }
  return value;
}
/** Inspect only the effective request after transport-only headers/body are removed. */
export function unresolvedReplayFields(value: any): string[] {
  const fields: string[] = [];
  const scan = (item: any, location: string, depth = 0) => {
    if (depth > 32) { fields.push(location); return; }
    if (typeof item === 'string') {
      const json = parseJson(item);
      if (json) { scan(json.parsed, location, depth + 1); return; }
      if (/\[(?:REDACTED|omitted)\]/i.test(decoded(item))) fields.push(location);
    } else if (Array.isArray(item)) item.forEach((child, index) => scan(child, `${location}[${index}]`, depth + 1));
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) scan(child, `${location}.${/^[\w.-]{1,64}$/.test(key) ? key : '[field]'}`, depth + 1);
  };
  scan(value?.url, 'URL'); scan(value?.headers, 'headers'); scan(value?.body, 'body');
  return [...new Set(fields)].slice(0, 20);
}

/** Values supplied for a one-off resend must not appear in its error/response diagnostics. */
export function replaySecretValues(value: any): string[] {
  const secrets: string[] = [];
  const collect = (item: any, sensitive = false, depth = 0) => {
    if (depth > 32) return;
    if (typeof item === 'string') {
      if (sensitive) { secrets.push(item); if (/^(Bearer|Basic)\s+/i.test(item)) secrets.push(item.replace(/^\S+\s+/, '')); }
      else { const json = parseJson(item); if (json && typeof json.parsed === 'object') collect(json.parsed, false, depth + 1); else secrets.push(...inlineCredentials(item)); }
    } else if (Array.isArray(item)) item.forEach(child => collect(child, sensitive, depth + 1));
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) collect(child, sensitive || isSensitiveField(key), depth + 1);
  };
  const headers = headerObject(value?.headers);
  collect(headers); collect(value?.body);
  for (const [key, item] of Object.entries(headers)) if (/^(?:cookie|set-cookie)$/i.test(key) && typeof item === 'string') {
    for (const part of item.split(';')) { const index = part.indexOf('='); if (index >= 0) secrets.push(part.slice(index + 1).trim()); }
  }
  if (typeof value?.body === 'string' && !parseJson(value.body) && /(?:^|&)[^=&\s]+=/.test(value.body)) {
    for (const [key, item] of new URLSearchParams(value.body)) if (isSensitiveField(key)) secrets.push(item);
  }
  try { for (const [key, item] of new URL(value?.url).searchParams) if (isSensitiveField(key)) secrets.push(item); } catch {}
  return [...new Set(secrets.filter(secret => secret && !secret.includes(REDACTED)).flatMap(secret => [secret, encodeURIComponent(secret)]))];
}

export function maskedCurl(value: any): string {
  const request = sanitizeReplayRequest(value);
  if (!request.url || !/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(request.method)) return '';
  try { if (!['http:', 'https:'].includes(new URL(request.url).protocol)) return ''; } catch { return ''; }
  const quote = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
  const excluded = excludedRequestHeaders(request.headers);
  let curl = `curl -X ${quote(request.method)} ${quote(request.url)}`;
  for (const [key, item] of Object.entries(request.headers)) {
    if (!key.startsWith(':') && !excluded.has(key.toLowerCase())) curl += ' \\\n  -H ' + quote(`${key}: ${item}`);
  }
  if (!['GET', 'HEAD'].includes(request.method) && request.body !== null) curl += ' \\\n  --data-raw ' + quote(request.body);
  return curl;
}
