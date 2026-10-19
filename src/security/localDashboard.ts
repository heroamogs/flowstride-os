/** Reject remote hosts and browser origins before exposing local debugger data. */
export function isLocalDashboardRequest(host?: string, origin?: string): boolean {
  if (!host) return false;
  try {
    const target = new URL(`http://${host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.port || target.username || target.password || target.pathname !== '/' || target.search || target.hash) return false;
    if (origin !== undefined) {
      const source = new URL(origin);
      if (source.origin !== target.origin || source.pathname !== '/' || source.search || source.hash || source.username || source.password) return false;
    }
    return true;
  } catch { return false; }
}
