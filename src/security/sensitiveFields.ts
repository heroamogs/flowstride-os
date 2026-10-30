export const REDACTED = '[REDACTED]';

export function isSensitiveField(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
  if (normalized === 'emailverified' || normalized === 'isemailverified') return false;
  return /password|passcode|secret|token|authorization|cookie|api.?key|master.?key|otp|email|curlString|replayRequest|strippedDom/i.test(key);
}

export function redactText(input: string, secrets: string[] = []): string {
  let value = String(input);
  for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 4).sort((a,b) => b.length - a.length)) value = value.split(secret).join(REDACTED);
  return value.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, REDACTED)
    .replace(/(["']?(?:password|passcode|secret|token|otp|authorization|cookie|api[_-]?key|master[_-]?key)["']?\s*[:=]\s*)(["']?)([^\s,;&"'<>}]+)\2/gi,
      (match, prefix, quote, value, offset, source) => source[offset - 1] === '$' || (!quote && /^\$[A-Za-z_]\w*[\])}]*$/.test(value)) ? match : prefix + REDACTED)
    .replace(/([?&](?:email|password|passcode|secret|ticket|token|signature|x-amz-[^=&#]+)=)[^&#\s]+/gi, '$1[REDACTED]');
}
