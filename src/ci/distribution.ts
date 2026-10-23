import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FlowstrideConfig } from '../types';
import { discoverFlows, flowIdentity, projectPath } from '../utils/projectPaths';
export function parseShard(value?: string) {
  if (value === undefined) return { index: 1, total: 1 };
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new Error('shard must be index/total, e.g. 1/4.');
  const index = Number(match[1]), total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 1 || index > total || total > 256) throw new Error('Shard index must be between 1 and total (maximum 256).');
  return { index, total };
}
export function executionPlan(target: string, config?: FlowstrideConfig) {
  const root = config?.projectRoot || process.cwd(), files = discoverFlows(target, root);
  const flowRoot = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  const shard = parseShard(config?.shard);
  const identity = (file: string) => flowIdentity(file, flowRoot);
  const suiteHash = createHash('sha256').update(JSON.stringify(files.map(file => [identity(file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))).digest('hex');
  // Configuration affects compatibility, but only a hash leaves this process.
  const configHash = createHash('sha256').update(JSON.stringify([require('../../package.json').name, require('../../package.json').version, config?.browser || 'chromium', config?.device || 'desktop', config?.browserOptions || {}, config?.retries || 0, config?.baseUrl || '', config?.timeout || 30000, config?.headless, config?.browserErrors, config?.failOnFlaky, config?.recordVideo, config?.trace, config?.har])).digest('hex');
  let history: Record<string, number> = {};
  if (config?.shardHistory) {
    history = JSON.parse(fs.readFileSync(projectPath(root, config.shardHistory), 'utf8'));
    if (!history || Array.isArray(history) || typeof history !== 'object' || Object.values(history).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Shard history must map file names to nonnegative durations.');
  }
  const setup = files.filter(file => file.endsWith('.first.flow'));
  const standard = files.filter(file => !file.endsWith('.first.flow'));
  const bins: string[][] = Array.from({ length: shard.total }, () => []), weights = bins.map(() => 0);
  for (const file of [...standard].sort((a,b) => (history[identity(b)] ?? 1) - (history[identity(a)] ?? 1) || identity(a).localeCompare(identity(b)))) {
    const index = weights.indexOf(Math.min(...weights)); bins[index].push(file); weights[index] += history[identity(file)] ?? 1;
  }
  const assigned = new Set([...setup, ...bins[shard.index - 1]!]);
  return { files: files.filter(file => assigned.has(file)), allFiles: files.map(identity), setupFiles: setup.map(identity), suiteHash, configHash, shard, flowRoot };
}
export function mergeResults(summaries: string[], output = 'flowstride-merged') {
  const root = process.cwd(), out = projectPath(root, output);
  if (fs.existsSync(out)) throw new Error('Merge output already exists; choose a new directory.');
  if (!summaries.length) throw new Error('Provide one summary per shard.');
  const inputs = summaries.map(file => { const absolute = projectPath(root, file); return { file: absolute, report: JSON.parse(fs.readFileSync(absolute, 'utf8')) }; });
  const first = inputs[0]!.report;
  if (first.protocol !== 1 || !first.distribution?.suiteHash) throw new Error('Only native distributed reports can be merged.');
  const total = first.distribution.shard.total, seen = new Set<number>(), seenFiles = new Set<string>(), setup = new Set<string>(first.distribution.setupFiles);
  const errors: string[] = [], steps: any[] = [], attempts: any[] = [], timings: Record<string,number> = {};
  for (const { report } of inputs) {
    const dist = report.distribution;
    if (report.protocol !== 1 || report.engine !== first.engine || !dist || dist.suiteHash !== first.distribution.suiteHash || dist.configHash !== first.distribution.configHash || dist.shard.total !== total || JSON.stringify(dist.allFiles) !== JSON.stringify(first.distribution.allFiles) || JSON.stringify(dist.setupFiles) !== JSON.stringify(first.distribution.setupFiles)) throw new Error('Shards belong to different suites or browser configurations.');
    const { index } = parseShard(`${dist.shard.index}/${dist.shard.total}`);
    if (seen.has(index)) throw new Error('Duplicate shard.'); seen.add(index);
    if (!['passed','failed','interrupted'].includes(report.status) || !Array.isArray(report.steps) || !Array.isArray(report.files) || !Array.isArray(report.errors)) throw new Error('Invalid shard report.');
    if (!report.metrics || ['total','passed','failed','skipped','incomplete'].some(key => !Number.isSafeInteger(report.metrics[key]) || report.metrics[key] < 0) || report.metrics.passed + report.metrics.failed + report.metrics.skipped + report.metrics.incomplete !== report.metrics.total) throw new Error('Inconsistent shard metrics.');
    if (report.status === 'passed' && (report.errors.length || report.metrics.failed || report.metrics.incomplete || report.steps.some((step: any) => !['passed','skipped','not_tested'].includes(step.status)))) throw new Error('A passing shard contains failures or unfinished work.');
    const duplicateSetup = new Set<string>();
    for (const file of report.files) {
      if (!dist.allFiles.includes(file)) throw new Error('Unexpected file in shard.');
      if (seenFiles.has(file)) { if (!setup.has(file)) throw new Error('File appears in more than one shard.'); duplicateSetup.add(file); }
      seenFiles.add(file);
    }
    for (const step of report.steps) steps.push({ ...step, shard: index });
    attempts.push(...(report.attempts || []).map((attempt: any) => ({ ...attempt, shard: index })));
    errors.push(...report.errors.map((error: string) => `Shard ${index}: ${error}`));
    for (const [file, duration] of Object.entries(report.timings || {})) if (typeof duration === 'number' && duration >= 0) timings[file] = Math.max(timings[file] || 0, duration);
  }
  if (seen.size !== total) throw new Error(`Missing shards: expected ${total}, received ${seen.size}.`);
  if (first.distribution.allFiles.some((file: string) => !seenFiles.has(file))) throw new Error('Merged reports omit test files.');
  const statuses = inputs.map(input => input.report.status), status = statuses.includes('interrupted') ? 'interrupted' : statuses.includes('failed') || errors.length ? 'failed' : 'passed';
  const metrics = inputs.reduce((all, { report }) => { for (const key of ['total','passed','failed','skipped','incomplete'] as const) { const n = report.metrics?.[key]; if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid shard metrics.'); all[key] += n; } return all; }, { total:0, passed:0, failed:0, skipped:0, incomplete:0 });
  // Preserve shard-level metrics (setup executes independently on each machine).
  const merged = { protocol:1, engine:first.engine, browser:first.browser, browsers:inputs.flatMap(({report}) => (report.browsers || []).map((info: any) => ({ ...info, shard: report.distribution.shard.index }))), status, metrics, steps, attempts, errors, timings, files:[...seenFiles], duration:Math.max(...inputs.map(input => input.report.duration)), distribution:{ ...first.distribution, merged:true, setupRunsPerShard:true } };
  fs.mkdirSync(out, { recursive: true, mode:0o700 });
  try {
    for (const { file, report } of inputs) {
      const source = projectPath(root, path.join(path.dirname(file), path.basename(report.artifactsDir || '')));
      if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error('Shard evidence directory is missing. Preserve each summary alongside its run directory.');
      const destination = path.join(out, `shard-${report.distribution.shard.index}`); fs.mkdirSync(destination);
      let bytes = 0;
      for (const name of fs.readdirSync(source)) {
        const item = projectPath(root, path.join(source, name)), stat = fs.lstatSync(item);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Shard evidence must contain regular files only.');
        bytes += stat.size; if (bytes > 500 * 1024 * 1024) throw new Error('Shard evidence exceeds the 500 MiB merge limit.');
        fs.copyFileSync(item, path.join(destination, name));
      }
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(merged,null,2));
    fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings,null,2));
    return merged;
  } catch (error) { fs.rmSync(out, { recursive:true, force:true }); throw error; }
}
