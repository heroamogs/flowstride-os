const sensitive = /password|passcode|secret|token|authorization|cookie|api.?key|master.?key|otp|email|curlString|rawReplayRequest|strippedDom/i;
export function redactText(input: string, secrets: string[] = []): string {
  let value = String(input);
  for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 4).sort((a,b) => b.length - a.length)) value = value.split(secret).join('[REDACTED]');
  value = value.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[REDACTED]')
    .replace(/(["']?(?:password|passcode|secret|token|otp|authorization|cookie|api[_-]?key|master[_-]?key)["']?\s*[:=]\s*)(["']?)[^\s,;"'<>}]+\2/gi, '$1[REDACTED]')
    .replace(/([?&](?:ticket|token|signature|x-amz-[^=&#]+)=)[^&#\s]+/gi, '$1[REDACTED]');
  return value;
}
export function redactPayload(value: any, secrets: string[] = [], depth = 0): any {
  if (depth > 12) return '[omitted]';
  if (typeof value === 'string') {
    if (/^data:image\//.test(value)) return value;
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { return JSON.stringify(redactPayload(JSON.parse(value), secrets, depth + 1)); } catch {} }
    return redactText(value, secrets);
  }
  if (Array.isArray(value)) return value.map(item => redactPayload(item, secrets, depth + 1));
  if (!value || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return '[binary]';
  return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, sensitive.test(key) ? '[REDACTED]' : redactPayload(item, secrets, depth + 1)]));
}

/** Raw network commands belong only to the local interactive debugger. */
export function redactWorkerPayload(type: string, payload: any, secrets: string[], localDebug = false): any {
  const result = redactPayload(payload, secrets);
  if (!localDebug || !payload || !result) return result;
  if (type === 'LOG_EVENT' && ['REST', 'GRAPHQL'].includes(payload.type) && typeof payload.details?.curlString === 'string') {
    result.details.rawCurlString = payload.details.curlString;
    if (payload.details.rawReplayRequest) result.details.rawReplayRequest = payload.details.rawReplayRequest;

  }
  return result;
}
