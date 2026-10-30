import { isSensitiveField, redactText } from "./sensitiveFields";
import { replaySecretValues, sanitizeReplayRequest } from "./manualReplay";
export { redactText } from "./sensitiveFields";
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
  if ((globalThis as any).Buffer?.isBuffer(value)) return '[binary]';
  return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, isSensitiveField(key) ? '[REDACTED]' : redactPayload(item, secrets, depth + 1)]));
}

/** Manual captures carry masked templates; original credentials never cross this boundary. */
export function redactWorkerPayload(type: string, payload: any, secrets: string[], localDebug = false): any {
  const request = type === 'LOG_EVENT' && ['REST', 'GRAPHQL'].includes(payload?.type)
    ? payload.details?.replayRequest || payload.details?.rawReplayRequest : undefined;
  const known = request && typeof request === 'object' ? [...secrets, ...replaySecretValues(request)] : secrets;
  const result = redactPayload(payload, known);
  if (localDebug && request && typeof request === 'object' && result?.details) result.details.replayRequest = sanitizeReplayRequest(request, known);
  return result;
}
