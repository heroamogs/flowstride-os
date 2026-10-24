export class ReplayRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayRequestError';
  }
}

/** Browser protocol metadata is not a portable set of Fetch request headers. */
export function buildReplayRequest(payload: any): { url: string; options: RequestInit } {
  let url: URL;
  try {
    url = new URL(payload?.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    throw new ReplayRequestError('Replay URL must use HTTP or HTTPS without embedded credentials.');
  }

  const method = typeof payload?.method === 'string' ? payload.method.toUpperCase() : 'GET';
  if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method) || ['CONNECT', 'TRACE', 'TRACK'].includes(method)) {
    throw new ReplayRequestError('Replay method is not supported.');
  }

  let supplied = payload?.headers;
  if (typeof supplied === 'string') {
    try { supplied = supplied.trim() ? JSON.parse(supplied) : {}; }
    catch { throw new ReplayRequestError('Replay headers must be a valid JSON object.'); }
  }
  if (supplied === undefined) supplied = {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new ReplayRequestError('Replay headers must be a JSON object of string values.');
  }

  // Fetch owns the destination, framing and supported compression. Recompute
  // Content-Length after edits and remove all Connection-nominated fields too.
  const excluded = new Set([
    'host', 'content-length', 'accept-encoding', 'connection', 'keep-alive',
    'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te',
    'trailer', 'transfer-encoding', 'upgrade', 'expect',
  ]);
  for (const [name, value] of Object.entries(supplied)) {
    if (name.toLowerCase() === 'connection' && typeof value === 'string') {
      for (const field of value.split(',')) excluded.add(field.trim().toLowerCase());
    }
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(supplied)) {
    if (name.startsWith(':') || excluded.has(name.toLowerCase())) continue;
    if (typeof value !== 'string') throw new ReplayRequestError('Replay header values must be strings.');
    try { headers.append(name, value); }
    catch { throw new ReplayRequestError('Replay headers contain an invalid name or value.'); }
  }

  const options: RequestInit = { method, headers };
  if (!['GET', 'HEAD'].includes(method) && payload?.body !== undefined && payload.body !== null) {
    try { options.body = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body); }
    catch { throw new ReplayRequestError('Replay body cannot be serialized.'); }
  }
  return { url: url.href, options };
}
