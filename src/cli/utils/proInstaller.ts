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
  const files = new Set<string>(); let metadata = ''; const invalid: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ onReadEntry(entry) {
      const name = entry.path.replace(/\/$/, '');
      if (!/^package(?:\/|$)/.test(name) || /\\/.test(name) || name.split('/').some(part => part === '..' || part === '.' || part === 'node_modules' || part === '.npmrc' || part === '.env' || part.startsWith('.env.')) || !['File','Directory'].includes(entry.type)) invalid.push(name);
      if (files.has(name)) invalid.push(name); files.add(name);
      if (entry.path === 'package/package.json') entry.on('data', chunk => { metadata += chunk.toString('utf8'); if (metadata.length > 65536) invalid.push('oversized package metadata'); });
      entry.resume();
    }, strict:true });
    parser.on('error', reject); parser.on('end', resolve); parser.end(unpacked);
  });
  if (invalid.length) throw new Error('Enterprise archive contains unsafe paths or entries');
  const pkg = JSON.parse(metadata);
  if (pkg.name !== '@flowstride/pro' || typeof pkg.version !== 'string' || pkg.bin?.flowstride !== 'dist/cli/index.js') throw new Error('Enterprise package identity is invalid');
  for (const file of ['dist/cli/index.js','dist/runner/flow_worker.js','dist/runner/flow_orchestrator.js']) if (!files.has(`package/${file}`)) throw new Error(`Enterprise archive is incomplete: ${file}`);
  return pkg.version as string;
}

export async function installProEngine(apiBase: string, token: string, root = process.cwd()) {
  const response = await fetch(`${apiBase}/api/workspace/download-pro`, { headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Enterprise download failed (HTTP ${response.status})`);
  const lengthHeader=response.headers.get('content-length'); const length=lengthHeader === null ? undefined : Number(lengthHeader);
  if (length !== undefined && (!Number.isSafeInteger(length) || length <= 0 || length > MAX_ARCHIVE)) throw new Error('Invalid Enterprise download size');
  if (!response.body) throw new Error('Empty Enterprise download');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_ARCHIVE)throw new Error('Enterprise download exceeds 32 MiB');chunks.push(value);} }
  catch(error){await reader.cancel().catch(()=>{});throw error;} finally {reader.releaseLock();}
  if (length !== undefined && size!==length) throw new Error('Enterprise download is truncated');
  const archive=Buffer.concat(chunks); const expected=process.env.FLOWSTRIDE_PRO_SHA256 || response.headers.get('x-flowstride-sha256');
  const actual=crypto.createHash('sha256').update(archive).digest('hex');
  if (expected && (!/^[a-f\d]{64}$/i.test(expected) || actual!==expected.toLowerCase())) throw new Error('Enterprise archive checksum mismatch');
  if (!expected) console.warn('[Installer]: This Cloud server did not provide an archive checksum. HTTPS and package validation are being used; update Cloud to enable checksum verification.');
  const version=await validateProArchive(archive);
  const engine=projectPath(root,'node_modules/@flowstride/pro');
  const bins=['flowstride','flowstride.cmd','flowstride.ps1'].map(name=>path.resolve(root,'node_modules/.bin',name));
  projectPath(root,'node_modules/.bin'); // Reject directory symlinks escaping the project; binary symlinks are preserved below.
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-pro-install-'));
  const tarball=path.join(scratch,'engine.tgz');const backup=path.join(scratch,'previous-pro');
  const binState=bins.map(file=>{try{const st=fs.lstatSync(file);return {file,link:st.isSymbolicLink()?fs.readlinkSync(file):undefined,data:st.isSymbolicLink()?undefined:fs.readFileSync(file),mode:st.mode};}catch(error:any){if(error.code!=='ENOENT')throw error;return {file};}});
  let hadEngine=false; let mutationStarted=false;
  try {
    fs.writeFileSync(tarball,archive,{mode:0o600});
    if(fs.existsSync(engine)){fs.cpSync(engine,backup,{recursive:true,dereference:false});hadEngine=true;}
    mutationStarted=true;
    execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install',tarball,'--no-save','--ignore-scripts','--package-lock=false','--no-audit','--no-fund'],{cwd:root,stdio:'pipe',timeout:120000,maxBuffer:1024*1024});
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
