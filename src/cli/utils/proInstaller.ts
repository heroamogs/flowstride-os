import { protectPrivatePath } from "../../security/privateState";
import { cloudFetch, secureCloudUrl } from "../../utils/cloud";
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Parser } from 'tar';
import { projectPath } from '../../utils/projectPaths';

const MAX_ARCHIVE = 32 * 1024 * 1024;
export async function validateProArchive(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_ARCHIVE) throw new Error('Invalid Enterprise archive size');
  const unpacked = gunzipSync(buffer, { maxOutputLength: 128 * 1024 * 1024 });
  const files = new Set<string>(), canonicalPaths = new Set<string>(); const metadataChunks: Buffer[] = []; let metadataBytes = 0; const invalid: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ onReadEntry(entry) {
      const name = entry.path.replace(/\/$/, '');
      const components = name.split('/');
      if (!/^package(?:\/|$)/.test(name) || /[\\\x00-\x1f\x7f:]/.test(name) || components.some(part =>
        !part || part === '..' || part === '.' || /[. ]$/.test(part) ||
        ['node_modules', '.npmrc', '.git'].includes(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || !['File', 'Directory'].includes(entry.type)) invalid.push(name);
      const canonical = name.toLowerCase();
      if (canonicalPaths.has(canonical)) invalid.push(name);
      canonicalPaths.add(canonical); files.add(name);
      if (entry.path === 'package/package.json') entry.on('data', chunk => {
        metadataBytes += chunk.length;
        if (metadataBytes > 65536) invalid.push('oversized package metadata');
        else metadataChunks.push(Buffer.from(chunk));
      });
      entry.resume();
    }, strict:true });
    parser.on('error', reject); parser.on('end', resolve); parser.end(unpacked);
  });
  if (invalid.length) throw new Error('Enterprise archive contains unsafe paths or entries');
  const pkg = JSON.parse(Buffer.concat(metadataChunks).toString("utf8"));
  if (pkg.name !== '@flowstride/pro' || (typeof pkg.version !== 'string' || pkg.version.length > 100 || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(pkg.version)) || pkg.bin?.flowstride !== 'dist/cli/index.js') throw new Error('Enterprise package identity is invalid');
  for (const file of ['dist/cli/index.js','dist/runner/flow_worker.js','dist/runner/flow_orchestrator.js']) if (!files.has(`package/${file}`)) throw new Error(`Enterprise archive is incomplete: ${file}`);
  return pkg.version as string;
}

export async function installProEngine(apiBase: string, token: string, root = process.cwd()) {
  secureCloudUrl(apiBase);
  if (process.env.FLOWSTRIDE_PRO_SHA256 && !/^[a-f\d]{64}$/i.test(process.env.FLOWSTRIDE_PRO_SHA256)) throw new Error("Invalid pinned Cloud archive SHA-256. Installation was not started.");
  const response = await cloudFetch(`${apiBase}/api/workspace/download-pro`, { headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Enterprise download failed (HTTP ${response.status})`);
  const lengthHeader=response.headers.get('content-length'); const length=lengthHeader === null ? undefined : Number(lengthHeader);
  if (length !== undefined && (!Number.isSafeInteger(length) || length <= 0 || length > MAX_ARCHIVE)) throw new Error('Invalid Enterprise download size');
  if (!response.body) throw new Error('Empty Enterprise download');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_ARCHIVE)throw new Error('Enterprise download exceeds 32 MiB');chunks.push(value);} }
  catch(error){await reader.cancel().catch(()=>{});throw error;} finally {reader.releaseLock();}
  if (length !== undefined && size!==length) throw new Error('Enterprise download is truncated');
  const archive = Buffer.concat(chunks);
  const advertised = response.headers.get('x-flowstride-sha256');
  const pinned = process.env.FLOWSTRIDE_PRO_SHA256;
  if (!advertised && !pinned) throw new Error('Cloud archive checksum is missing. Update the Cloud download service or supply a trusted FLOWSTRIDE_PRO_SHA256 pin; installation was not started.');
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  for (const expected of [advertised, pinned]) if (expected && (!/^[a-f\d]{64}$/i.test(expected) || actual !== expected.toLowerCase())) throw new Error('Cloud archive checksum mismatch. The existing installation was left untouched.');
  const version=await validateProArchive(archive);
  const engine=projectPath(root,'node_modules/@flowstride/pro');
  const bins=['flowstride','flowstride.cmd','flowstride.ps1'].map(name=>path.resolve(root,'node_modules/.bin',name));
  projectPath(root,'node_modules/.bin'); // Reject directory symlinks escaping the project; binary symlinks are preserved below.
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-pro-install-'));
  try { protectPrivatePath(scratch, true); } catch (error) { fs.rmSync(scratch, { recursive: true, force: true }); throw error; }
  const tarball=path.join(scratch,'engine.tgz');const backup=path.join(scratch,'previous-pro');
  const binState=bins.map(file=>{try{const st=fs.lstatSync(file);return {file,link:st.isSymbolicLink()?fs.readlinkSync(file):undefined,data:st.isSymbolicLink()?undefined:fs.readFileSync(file),mode:st.mode};}catch(error:any){if(error.code!=='ENOENT')throw error;return {file};}});
  let hadEngine=false; let mutationStarted=false;
  try {
    fs.writeFileSync(tarball,archive,{mode:0o600});
    if(fs.existsSync(engine)){fs.cpSync(engine,backup,{recursive:true,dereference:false});hadEngine=true;}
    mutationStarted=true;
    const args = ['install', tarball, '--no-save', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund'];
    if (process.platform === 'win32') {
      // .cmd launchers cannot be safely executed with execFile and shell:false.
      // Invoke the matching Node distribution's npm JavaScript entry point directly.
      const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      if (!fs.existsSync(npmCli)) throw new Error('This Node installation does not include npm. Install a Node distribution with npm before retrying.');
      execFileSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: 'pipe', timeout: 120000, maxBuffer: 1024 * 1024 });
    } else execFileSync('npm', args, { cwd: root, stdio: 'pipe', timeout: 120000, maxBuffer: 1024 * 1024 });
    if (JSON.parse(fs.readFileSync(path.join(engine,'package.json'),'utf8')).version !== version || !fs.existsSync(path.join(engine,'dist/runner/flow_worker.js'))) throw new Error('Enterprise installation verification failed');
    return {version,sha256:actual};
  } catch {
    if (!mutationStarted) throw new Error('Enterprise backup failed; the existing installation was left untouched.');
    fs.rmSync(engine,{recursive:true,force:true});
    if(hadEngine){fs.mkdirSync(path.dirname(engine),{recursive:true});fs.cpSync(backup,engine,{recursive:true,dereference:false});}
    for(const state of binState){fs.rmSync(state.file,{force:true});if(state.link!==undefined)fs.symlinkSync(state.link,state.file);else if(state.data!==undefined)fs.writeFileSync(state.file,state.data,{mode:state.mode});}
    throw new Error('Enterprise installation failed. The previous engine and CLI launchers were restored; the OSS fallback remains available.');
  } finally { fs.rmSync(scratch,{recursive:true,force:true}); }
}
