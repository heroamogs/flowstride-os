import { readPrivateCredentials } from "../security/privateState";
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { cloudApiBase, cloudFetch } from '../utils/cloud';
import { projectPath } from '../utils/projectPaths';
import { isPrivateDefectKey } from './mediaReference';

/** Credential-bearing requests stay on this loopback server, never in the UI. */
export async function servePrivateDefect(req: IncomingMessage, res: ServerResponse,
  options: {root:string;home:string;env:Record<string,string|undefined>}) {
  const headers = {'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const send = (status:number, error:string) => {res.writeHead(status, {...headers,'Content-Type':'application/json'});res.end(JSON.stringify({error}));};
  const url = new URL(req.url || '/', 'http://localhost');
  const key = url.searchParams.get('key');
  if (url.searchParams.getAll('key').length !== 1 || !isPrivateDefectKey(key)) {send(400,'Invalid defect media key');return;}
  const range = req.headers.range;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {send(416,'Invalid media range');return;}
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const closed = () => {if (!res.writableEnded) controller.abort();};
  res.once('close', closed);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let token = options.env.FLOWSTRIDE_TOKEN?.trim();
    if (!token) {
      const local = projectPath(options.root, '.flowstride/credentials.json');
      const global = path.join(options.home, '.flowstride/credentials.json');
      const file = fs.existsSync(local) ? local : fs.existsSync(global) ? global : null;
      if (file) token = JSON.parse(readPrivateCredentials(file)).machineToken?.trim();
    }
    if (!token) {send(401,'Sign in to Flowstride Cloud to view this private attachment.');return;}
    const response = await cloudFetch(`${cloudApiBase(options.env)}/api/upload/media?key=${encodeURIComponent(key)}`, {
      headers:{Authorization:`Bearer ${token}`,...(range ? {Range:range} : {})},
      redirect:'error',cache:'no-store',signal:controller.signal,
    });
    if (![200,206].includes(response.status) || !response.body) {
      await response.body?.cancel();
      send([401,403,404,416].includes(response.status) ? response.status : 502,
        response.status === 401 ? 'Cloud authentication expired or was rejected. Sign in again.' : 'Private attachment is unavailable or access was denied.');
      return;
    }
    const contentType = response.headers.get('content-type')?.split(';')[0];
    const allowed = ['image/png','image/jpeg','image/gif','video/webm','video/mp4'];
    const declared = response.headers.get('content-length');
    if (!contentType || !allowed.includes(contentType) || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 50*1024*1024))) {
      await response.body.cancel();send(502,'Cloud returned an invalid attachment response.');return;
    }
    const contentRange = response.headers.get('content-range');
    if (response.status === 206 && (!range || !contentRange || !/^bytes \d+-\d+\/\d+$/.test(contentRange))) {
      await response.body.cancel();send(502,'Cloud returned an invalid media range.');return;
    }
    res.writeHead(response.status,{...headers,'Content-Type':contentType,'Accept-Ranges':'bytes',
      ...(declared !== null ? {'Content-Length':declared} : {}),...(response.status === 206 ? {'Content-Range':contentRange!} : {})});
    reader = response.body.getReader();let size = 0;
    while (true) {
      const {value,done} = await reader.read();if (done) break;
      size += value.byteLength;if (size > 50*1024*1024) throw Error('Attachment exceeds size limit');
      if (!res.write(value)) await new Promise<void>((resolve,reject) => {
        const cleanup=()=>{res.off('drain',drain);res.off('close',abort);};
        const drain=()=>{cleanup();resolve();};const abort=()=>{cleanup();reject(Error('Preview closed'));};
        res.once('drain',drain);res.once('close',abort);
      });
    }
    if (declared !== null && size !== Number(declared)) throw Error('Attachment was truncated');
    res.end();
  } catch {
    await reader?.cancel().catch(() => {});
    if (res.headersSent) res.destroy();
    else send(502,'Could not load the private attachment. Check Cloud connectivity and sign-in.');
  } finally {clearTimeout(timer);res.off('close',closed);reader?.releaseLock();}
}
