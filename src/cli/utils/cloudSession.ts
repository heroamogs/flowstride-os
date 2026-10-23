import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { cloudApiBase } from '../../utils/cloud';

/** Resolve .env before authentication, using the same precedence as execution. */
export function loadCloudEnvironment(root: string, profile?: string) {
  if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('Invalid environment profile name.');
  const files = profile ? [`.env.${profile}`, '.env'] : ['.env'];
  for (const file of files) {
    const filename = path.join(root, file);
    if (fs.existsSync(filename)) dotenv.config({ path: filename, quiet: true });
  }
  return cloudApiBase(process.env);
}
export function cloudSessionDescription(apiBase: string): string {
  const source = process.env.FLOWSTRIDE_TOKEN ? 'FLOWSTRIDE_TOKEN (environment)'
    : fs.existsSync(path.join(process.cwd(), '.flowstride', 'credentials.json')) ? 'project credentials'
    : fs.existsSync(path.join(os.homedir(), '.flowstride', 'credentials.json')) ? 'global credentials' : 'no saved credentials';
  return `[Cloud]: ${apiBase}; credential source: ${source}`;
}
export function tokenExpiryDescription(data: { tokenExpiresAt?: string; tokenScope?: string }): string {
  const expiry = data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null;
  const label = expiry && Number.isFinite(expiry.getTime()) ? expiry.toISOString() : 'unavailable from this Cloud server';
  const scope = ['execution','admin','readonly'].includes(data.tokenScope || '') ? `; scope: ${data.tokenScope}` : '';
  return `[Cloud]: Token expiry (UTC): ${label}${scope}. Logging in with the same key does not renew it.`;
}
