import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { FlowstrideConfig } from '../types';
import { projectPath } from '../utils/projectPaths';
export function serveDOMSnapshot(req: IncomingMessage, res: ServerResponse, config?: FlowstrideConfig): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname !== '/evidence') return false;
  try {
    if (req.method !== 'GET' || !config?.domSnapshots) throw new Error('Unavailable');
    const root = config.projectRoot || process.cwd();
    const file = projectPath(root, url.searchParams.get('file') || '');
    const directory = projectPath(root, config.artifactsDir || 'flowstride-artifacts');
    const relative = path.relative(directory, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !file.endsWith('.dom.html') || !fs.statSync(file).isFile() || fs.statSync(file).size > 10 * 1024 * 1024) throw new Error('Unavailable');
    res.writeHead(200, { 'Content-Type':'text/plain; charset=utf-8', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; sandbox", 'Cache-Control':'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end('Snapshot unavailable.'); }
  return true;
}
