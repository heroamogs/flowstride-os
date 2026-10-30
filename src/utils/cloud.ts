import { redactText } from '../security/redaction';

export class CloudTransportError extends Error { readonly code = "CLOUD_TRANSPORT_DENIED"; }

/** Cloud/control-plane transport only. User application URLs keep their existing behavior. */
export function secureCloudUrl(value: string | URL): URL {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash)
    throw new CloudTransportError('Cloud connections require HTTPS; HTTP is allowed only for loopback testing. URL credentials and fragments are not allowed.');
  return url;
}
export function cloudApiBase(env: Record<string, string | undefined> = process.env): string {
  const value = env.FLOWSTRIDE_API_URL || env.NEXTJS_WEBHOOK_URL || 'https://cloud.flowstride.io';
  const url = secureCloudUrl(value);
  if (url.search) throw new Error('Cloud base URL must not contain query parameters.');
  const pathname = url.pathname.replace(/\/api\/cloud\/execution-complete\/?$/, '').replace(/\/+$/, '');
  return url.origin + pathname;
}
export function cloudRequestOptions(value: string | URL, timeout = 30000) {
  secureCloudUrl(value);
  return { maxRedirects: 0, timeout };
}
export async function cloudFetch(value: string | URL, options: RequestInit = {}) {
  const url = secureCloudUrl(value);
  let response: Response;
  try { response = await fetch(url.toString(), { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(30000) }); }
  catch (error) {
    if (/redirect/i.test(String((error as { cause?: { message?: string } })?.cause?.message || ""))) throw new CloudTransportError('Cloud redirect was rejected. Configure the final HTTPS Cloud URL.');
    throw error;
  }
  if (response.redirected || (response.url && new URL(response.url).origin !== url.origin)) {
    await response.body?.cancel();
    throw new CloudTransportError('Cloud redirects are not allowed. Configure the final HTTPS Cloud URL.');
  }
  return response;
}
export function cloudFailure(error: any, secrets: string[] = []) {
  if (["PRIVATE_STATE_DENIED", "CLOUD_TRANSPORT_DENIED"].includes(error?.code)) return { status: undefined, code: error.code, message: redactText(error.message, secrets) };
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
    : status && status >= 300 && status < 400 ? 'Cloud redirect was rejected. Configure the final HTTPS Cloud URL.'
    : status === 413 ? 'The Cloud/proxy upload limit was exceeded; evidence remains local.'
    : status === 429 ? 'The Cloud request rate limit was reached.'
    : status && status >= 500 ? 'Cloud service failed; evidence remains local.'
    : status === 400 ? 'Cloud rejected the report schema; verify matching CLI and Cloud releases.'
    : 'Cloud could not be reached; verify the configured URL and network connection.';
  return { status, code: code ? redactText(code, secrets) : undefined, message };
}
