import { redactText } from '../security/redaction';

export function cloudApiBase(env: Record<string, string | undefined> = process.env): string {
  const value = env.FLOWSTRIDE_API_URL || env.NEXTJS_WEBHOOK_URL || 'https://cloud.flowstride.io';
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Cloud URL must be an HTTP(S) URL without credentials or query parameters.');
  const pathname = url.pathname.replace(/\/api\/cloud\/execution-complete\/?$/, '').replace(/\/+$/, '');
  return url.origin + pathname;
}
export function cloudFailure(error: any, secrets: string[] = []) {
  const status = Number(error?.response?.status) || undefined;
  const code = typeof error?.response?.data?.code === 'string' ? error.response.data.code.slice(0,80) : typeof error?.code === 'string' ? error.code.slice(0,80) : undefined;
  const authenticationMessages: Record<string, string> = {
    TOKEN_EXPIRED: 'This developer token has expired. Generate a replacement; logging in with the same key does not renew it.',
    TOKEN_REVOKED: 'This developer token has been revoked. Use a replacement token.',
    TOKEN_INVALID: 'Cloud did not recognize a valid developer token. Check the credential source and Cloud URL.',
    TOKEN_REQUIRED: 'Cloud requires a Bearer developer token.',
    TOKEN_SCOPE_DENIED: 'This token requires execution or admin scope for CLI runs.',
  };
  const message = (status === 401 || status === 403) && code && authenticationMessages[code] ? authenticationMessages[code]
    : status === 401 ? 'Cloud rejected authentication. Check the selected token and Cloud URL; this response does not confirm expiration.'
    : status === 403 ? 'Workspace permission or feature policy rejected this request.'
    : status === 413 ? 'The Cloud/proxy upload limit was exceeded; evidence remains local.'
    : status === 429 ? 'The Cloud request rate limit was reached.'
    : status && status >= 500 ? 'Cloud service failed; evidence remains local.'
    : status === 400 ? 'Cloud rejected the report schema; verify matching CLI and Cloud releases.'
    : 'Cloud could not be reached; verify the configured URL and network connection.';
  return { status, code: code ? redactText(code, secrets) : undefined, message };
}
