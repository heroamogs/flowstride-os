import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export class PrivateStateError extends Error { readonly code = "PRIVATE_STATE_DENIED"; }
const MAX_STATE = 64 * 1024 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
function stat(file: string) { try { return fs.lstatSync(file); } catch (error) { if (missing(error)) return undefined; throw error; } }
function owned(info: fs.Stats, file: string, directory: boolean) {
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || (!directory && info.nlink !== 1)) throw new PrivateStateError(`Unsafe private-state path: ${file}. Symlinks, hard-linked files and special files are not accepted.`);
  if (process.platform !== 'win32' && process.getuid && info.uid !== process.getuid()) throw new PrivateStateError(`Private state must be owned by the current user: ${file}`);
}

// Fixed script; paths are data supplied through the environment, never executable text.
export const WINDOWS_PRIVATE_ACL = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:FLOWSTRIDE_PRIVATE_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$current = Get-Acl -LiteralPath $target
if ($current.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Private state must be owned by the current user' }
if ($env:FLOWSTRIDE_PRIVATE_KIND -eq 'directory') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl
$check = Get-Acl -LiteralPath $target
$rules = @($check.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $check.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow') { throw 'Private ACL verification failed' }
`;
export function restrictWindowsPath(file: string, directory: boolean, run: typeof execFileSync = execFileSync) {
  try {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    run(executable, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PRIVATE_ACL], {
      env: { ...process.env, FLOWSTRIDE_PRIVATE_PATH: file, FLOWSTRIDE_PRIVATE_KIND: directory ? 'directory' : 'file' },
      timeout: 10000, stdio: 'pipe', maxBuffer: 65536,
    });
  } catch { throw new PrivateStateError('Could not establish owner-only Windows access for private state. Check file ownership and ACL support.'); }
}
const macAclCache = new Map<string, string>();
function clearMacAcl(file: string, info: fs.Stats) {
  if (process.platform !== "darwin") return;
  const stamp = `${info.dev}:${info.ino}:${info.ctimeMs}`;
  if (macAclCache.get(file) === stamp) return;
  try { execFileSync("/bin/chmod", ["-h", "-N", file], { timeout: 10000, stdio: "pipe" }); }
  catch { throw new PrivateStateError("Could not remove inherited macOS ACLs from private state."); }
  const after = fs.lstatSync(file);
  macAclCache.set(file, `${after.dev}:${after.ino}:${after.ctimeMs}`);
}
function restrict(file: string, info: fs.Stats, directory: boolean) {
  owned(info, file, directory);
  if (process.platform === 'win32') restrictWindowsPath(file, directory);
  else {
    if ((info.mode & 0o7777) !== (directory ? 0o700 : 0o600)) fs.chmodSync(file, directory ? 0o700 : 0o600);
    clearMacAcl(file, fs.lstatSync(file));
  }
}
export function protectPrivatePath(file: string, directory: boolean) { restrict(file, fs.lstatSync(file), directory); return file; }
function parts(relative: string) {
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) throw new PrivateStateError('Private state must remain under .flowstride.');
  const values = relative === '' ? [] : relative.split('/');
  if (values.some(value => !value || value === '.' || value === '..' || (process.platform === 'win32' && (/[<>:"|?*]/.test(value) || /[. ]$/.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))))) throw new PrivateStateError('Invalid private-state path component.');
  return values;
}
/** Validate each state component, including dangling symlinks. Workspace roots may themselves be aliases. */
export function privateStatePath(root: string, relative = '') {
  const segments = ['.flowstride', ...parts(relative)], anchor = path.resolve(root);
  const canonicalRoot = fs.realpathSync(anchor);
  let current = anchor;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = stat(current);
    if (!info) continue;
    const directory = index < segments.length - 1 || relative === '';
    if (info.isSymbolicLink()) throw new PrivateStateError(`Symlink is not allowed in private state: ${current}`);
    if (directory && !info.isDirectory()) throw new PrivateStateError(`Private-state parent is not a directory: ${current}`);
    const expected = path.join(canonicalRoot, ...segments.slice(0, index + 1));
    if (fs.realpathSync(current) !== expected) throw new PrivateStateError(`Private state escaped its workspace: ${current}`);
  }
  return path.join(anchor, ...segments);
}
export function ensurePrivateDirectory(root: string, relative = '') {
  const values = parts(relative); let current = path.resolve(root);
  for (const segment of ['.flowstride', ...values]) {
    current = path.join(current, segment);
    privateStatePath(root, path.relative(path.join(root, '.flowstride'), current).split(path.sep).join('/'));
    if (!stat(current)) { try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
    restrict(current, fs.lstatSync(current), true);
  }
  return current;
}
export function readPrivateState(root: string, relative: string, limit = MAX_STATE): string | undefined {
  const file = privateStatePath(root, relative), info = stat(file);
  if (!info) return undefined;
  ensurePrivateDirectory(root, path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative));
  owned(info, file, false);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd); owned(opened, file, false);
    if (opened.size > limit) throw new PrivateStateError(`Private-state file exceeds ${limit} bytes: ${file}`);
    if (process.platform === 'win32') restrictWindowsPath(file, false); else { if ((opened.mode & 0o7777) !== 0o600) fs.fchmodSync(fd, 0o600); clearMacAcl(file, fs.lstatSync(file)); }
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
export function writePrivateState(root: string, relative: string, data: string) {
  if (Buffer.byteLength(data) > MAX_STATE) throw new PrivateStateError('Private-state value exceeds 64 MiB.');
  const file = privateStatePath(root, relative);
  const directory = ensurePrivateDirectory(root, path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative));
  const previous = stat(file); if (previous) owned(previous, file, false);
  const temporary = path.join(directory, `.state-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    if (process.platform === 'win32') restrictWindowsPath(temporary, false); else fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, data, 'utf8'); fs.fsyncSync(fd);
    privateStatePath(root, relative);
    const latest = stat(file); if (latest) owned(latest, file, false);
    fs.renameSync(temporary, file);
  } finally { fs.closeSync(fd); if (stat(temporary)) fs.unlinkSync(temporary); }
  return file;
}
export function stateSessionFile(name: string) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 200 || /[/\\\0]/.test(name) || name === '.' || name === '..') throw new PrivateStateError('Saved-session names must be a single filename of at most 200 UTF-8 bytes.');
  parts(name + '.json'); return name + '.json';
}
function inspectDeletion(root: string, relative: string): string | undefined {
  const file = privateStatePath(root, relative), info = stat(file);
  if (!info) return undefined;
  owned(info, file, info.isDirectory());
  if (info.isDirectory()) for (const name of fs.readdirSync(file)) inspectDeletion(root, relative + '/' + name);
  return file;
}
export function removePrivateState(root: string, relative: string) {
  const file = inspectDeletion(root, relative);
  if (file) fs.rmSync(file, { recursive: fs.lstatSync(file).isDirectory(), force: false });
}
/** Preflight every requested target before deleting anything. Credentials and other data are preserved. */
export function resetPrivateState(root: string, options: { values?: boolean; sessions?: boolean }) {
  const targets = [options.values ? 'vault.json' : null, options.sessions ? 'sessions' : null].filter((item): item is string => !!item);
  if (!targets.length) throw new PrivateStateError('Specify --values or --sessions.');
  const existing = targets.map(relative => ({ relative, file: inspectDeletion(root, relative) }));
  for (const target of existing) if (target.file) removePrivateState(root, target.relative);
  return existing.map(target => ({ target: target.relative, removed: !!target.file }));
}
function credentialRoot(file: string) {
  if (path.basename(file) !== 'credentials.json' || path.basename(path.dirname(file)) !== '.flowstride') throw new PrivateStateError('Invalid credential file location.');
  return path.dirname(path.dirname(path.resolve(file)));
}
export function readPrivateCredentials(file: string) {
  try { const value = readPrivateState(credentialRoot(file), 'credentials.json', 65536); if (value === undefined) throw new PrivateStateError('Credential file does not exist.'); return value; }
  catch (error) { if (error instanceof PrivateStateError) throw error; throw new PrivateStateError(`Could not securely read credential file (${(error as NodeJS.ErrnoException).code || 'filesystem error'}). Check its ownership and permissions.`); }
}
export function writePrivateCredentials(file: string, value: string) { if (Buffer.byteLength(value) > 65536) throw new PrivateStateError("Credential data exceeds 64 KiB."); return writePrivateState(credentialRoot(file), 'credentials.json', value); }
export function removePrivateCredentials(file: string) { removePrivateState(credentialRoot(file), 'credentials.json'); }
