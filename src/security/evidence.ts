import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlowstrideConfig } from '../types';
import { projectPath } from '../utils/projectPaths';
import { protectPrivatePath } from './privateState';
import { redactPayload } from './redaction';

/** Evidence contains application data. Protect it independently of the process umask. */
export function evidenceDirectory(config: Pick<FlowstrideConfig, 'projectRoot'> | undefined, target: string): string {
  const root = path.resolve(config?.projectRoot || process.cwd());
  const directory = projectPath(root, target);
  const relative = path.relative(root, directory);
  if (!relative) throw new Error('Evidence must use a dedicated directory inside the project.');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let info: fs.Stats;
    try { info = fs.lstatSync(current); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; try { fs.mkdirSync(current, { mode: 0o700 }); } catch (created: any) { if (created.code !== 'EEXIST') throw created; } info = fs.lstatSync(current); }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Evidence directories must not contain links or special files.');
  }
  protectPrivatePath(directory, true);
  return directory;
}
export function prepareEvidenceFile(config: Pick<FlowstrideConfig, 'projectRoot'> | undefined, target: string): string {
  const file = projectPath(config?.projectRoot || process.cwd(), target);
  evidenceDirectory(config, path.dirname(file));
  try { protectPrivatePath(file, false); }
  catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.closeSync(fd); protectPrivatePath(file, false);
  }
  return file;
}
function evidenceFileSnapshot(file: string) {
  const info = fs.lstatSync(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
    throw new Error('Evidence file changed or became unsafe before writing.');
  }
  return info;
}
export function writeEvidence(config: Pick<FlowstrideConfig, 'projectRoot'> | undefined, target: string, data: string | Buffer) {
  const file = prepareEvidenceFile(config, target);
  const original = evidenceFileSnapshot(file);
  const temporary = path.join(path.dirname(file), `.evidence-${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    let staged: fs.BigIntStats;
    try {
      protectPrivatePath(temporary, false);
      staged = evidenceFileSnapshot(temporary);
      fs.writeFileSync(descriptor, data);
    } finally {
      fs.closeSync(descriptor);
    }
    projectPath(config?.projectRoot || process.cwd(), file);
    const current = evidenceFileSnapshot(file);
    const ready = evidenceFileSnapshot(temporary);
    if (current.dev !== original.dev || current.ino !== original.ino || ready.dev !== staged.dev || ready.ino !== staged.ino) {
      throw new Error('Evidence file changed or became unsafe before writing.');
    }
    // Replace the checked directory entry. A link introduced during the rename
    // cannot redirect writes through the destination to another file.
    fs.renameSync(temporary, file);
    return file;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function protectEvidenceTree(config: Pick<FlowstrideConfig, 'projectRoot'> | undefined, directory: string) {
  const root = evidenceDirectory(config, directory);
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name), info = fs.lstatSync(file);
    if (info.isDirectory() && !info.isSymbolicLink()) protectEvidenceTree(config, file);
    else protectPrivatePath(file, false);
  }
}
export function screenshotEvidence(config: FlowstrideConfig) { return config.security?.evidence?.screenshots !== false; }
export function validateEvidencePolicy(value: any) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('security.evidence must be an object.');
  for (const [key, item] of Object.entries(value)) if (!['screenshots','cloudVideo'].includes(key) || typeof item !== 'boolean') throw new Error('security.evidence accepts boolean screenshots and cloudVideo only.');
}
/** Portable reports must not inherit local debugger-only raw data or inline binary captures. */
export function exportEvidence(value: any, secrets: string[] = []): any {
  const strip = (item: any, depth = 0): any => {
    if (depth > 12) return '[omitted]';
    if (typeof item === 'string') {
      const trimmed=item.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { return JSON.stringify(strip(JSON.parse(item), depth+1)); } catch {} }
      return /^data:(?:image|video|audio|application\/zip)\//i.test(item) || /^data:application\/zip[;,]/i.test(item) ? '[local evidence omitted]' : item;
    }
    if (Array.isArray(item)) return item.map(child => strip(child, depth + 1));
    if (!item || typeof item !== 'object') return item;
    if (Buffer.isBuffer(item)) return '[binary omitted]';
    return Object.fromEntries(Object.entries(item).filter(([key]) => !/^(?:rawCurlString|rawReplayRequest|replayRequest|curlString|strippedDom|screenshot|base64|harContent|traceContent|domContent)$/i.test(key)).map(([key, child]) => [key, strip(child, depth + 1)]));
  };
  const known = [...secrets, ...Object.entries(process.env).filter(([key]) => /password|passcode|secret|token|api.?key/i.test(key)).map(([,value]) => value || '')];
  return redactPayload(strip(value), known);
}
