import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function projectPath(root: string, target: string): string {
  root = path.resolve(root); target = path.resolve(root, target);
  const inside = (base: string, value: string) => {
    const relative = path.relative(base, value);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(root, target)) throw new Error(`Path must remain inside the project: ${target}`);
  const realRoot = fs.realpathSync(root);
  let parent = target; const suffix: string[] = [];
  while (true) {
    try { fs.lstatSync(parent); break; }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; suffix.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) throw error; parent = next; }
  }
  const real = path.join(fs.realpathSync(parent), ...suffix);
  if (!inside(realRoot, real)) throw new Error(`Symlink escapes the project: ${target}`);
  return target;
}
export function discoverFlows(target: string, projectRoot = process.cwd()): string[] {
  const files: string[] = []; const visited = new Set<string>();
  const visit = (item: string) => {
    item = projectPath(projectRoot, item);
    const real = fs.realpathSync(item);
    if (visited.has(real)) return;
    visited.add(real);
    const stat = fs.statSync(item);
    if (stat.isFile()) { if (item.endsWith('.flow')) files.push(item); return; }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(item, { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (['node_modules','.git','.flowstride','flowstride-artifacts'].includes(entry.name)) continue;
      visit(path.join(item, entry.name));
    }
  };
  visit(target);
  return files.sort((a,b) => Number(!a.endsWith('.first.flow')) - Number(!b.endsWith('.first.flow')) || (a < b ? -1 : a > b ? 1 : 0));
}
export function flowIdentity(file: string, root?: string) { return (root ? path.relative(root, file) : path.basename(file)).split(path.sep).join('/'); }
export function videoFileName(identity: string): string {
  if (!identity.includes('/') && identity.length < 180 && !identity.includes('%')) return identity.replace(/\.flow$/, '') + '.webm';
  const base = path.posix.basename(identity, '.flow').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0,60);
  return `${base}-${createHash('sha256').update(identity).digest('hex').slice(0,16)}.webm`;
}
export function selectedFeatures<T extends { scenarios: { isOnly?: boolean; steps: unknown[] }[] }>(features: T[]): T[] {
  if (!features.some(f => f.scenarios.some(s => s.isOnly))) return features;
  return features.map(f => ({ ...f, scenarios: f.scenarios.filter(s => s.isOnly) }));
}

export function artifactPrefix(identity?: string) {
  if (!identity) return '';
  const safe=identity.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,100);
  return safe + (identity.includes('/') || identity.length>100 ? '-'+createHash('sha256').update(identity).digest('hex').slice(0,12) : '') + '-';
}
