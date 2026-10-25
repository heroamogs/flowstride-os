import { isLocalDashboardRequest } from './localDashboard';

/** Bind the manual workspace browser boundary to the actual loopback listener. */
export function isLocalWorkspaceRequest(
  host: string | undefined,
  origin: string | undefined,
  localPort: number | undefined,
  fetchSite?: string,
): boolean {
  if (!Number.isInteger(localPort) || !localPort || localPort < 1 || localPort > 65535) return false;
  if (!isLocalDashboardRequest(host, origin) || fetchSite === 'cross-site') return false;
  try { return Number(new URL(`http://${host}`).port) === localPort; }
  catch { return false; }
}
