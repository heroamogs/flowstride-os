import { parseShard } from './distribution';
import { validateContextOptions } from '../native/validation';
import { projectPath } from '../utils/projectPaths';
import fs from 'node:fs';
import path from 'node:path';
import type { FlowstrideConfig } from '../types';

export function isCIEnvironment() {
  return ['FLOWSTRIDE_NATIVE_CI', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'FLOWSTRIDE_API_KEY']
    .some(key => !!process.env[key] && process.env[key] !== 'false' && process.env[key] !== '0');
}
export function loadNativeConfig(root: string, options: Record<string, any>): FlowstrideConfig {
  const file = projectPath(root, options.config || 'flowstride.config.json');
  let input: any = {};
  if (fs.existsSync(file)) {
    input = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Flowstride configuration must be an object.');
  } else if (options.config) throw new Error(`Configuration not found: ${file}`);
  const config: any = { ...input, browser: options.browser ?? input.browser ?? "chromium", retries: input.retries ?? 0, shard: options.shard ?? input.shard, shardHistory: options.shardHistory ?? input.shardHistory, updateBaselines: !!options.updateBaselines, projectRoot: path.resolve(root), timeout: input.timeout ?? 30000, headless: input.headless ?? true,
    ci: !!options.ci || isCIEnvironment(), bail: options.bail || input.bail || false, device: options.device ?? input.device ?? 'desktop',
    artifactsDir: input.artifactsDir ?? 'flowstride-artifacts', testDir: input.testDir ?? 'flows',
    defaultDialogBehavior: input.defaultDialogBehavior ?? 'dismiss',
    recordVideo: input.recordVideo ?? true, browserErrors: input.browserErrors ?? 'fail',
    isCloudSyncActive: options.isCloudSyncActive ?? false, machineToken: options.machineToken ?? null,
    workspaceId: options.workspaceId ?? null, manifest: options.manifest ?? null };
  if (!['chromium','firefox','webkit'].includes(config.browser)) throw new Error('browser must be chromium, firefox, or webkit.');
  config.browserOptions = validateContextOptions(input.browserOptions, config.browser, root);
  if (!Number.isSafeInteger(config.retries) || config.retries < 0 || config.retries > 10) throw new Error('retries must be an integer from 0 to 10.');
  for (const key of ['trace','har','domSnapshots','failOnFlaky']) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new Error(`${key} must be boolean.`);
  parseShard(config.shard);
  if (config.ci && config.updateBaselines) throw new Error('Baseline updates are not allowed in CI.');
  if (config.ci && input.cloudSync !== true) config.isCloudSyncActive = false;
  if (options.headless || config.ci) config.headless = true;
  else if (options.headed) config.headless = false;
  if (process.env.BASE_URL) config.baseUrl = process.env.BASE_URL;
  if (!Number.isSafeInteger(config.timeout) || config.timeout < 1) throw new Error('timeout must be a positive integer.');
  if (!['desktop', 'phone', 'landscape'].includes(config.device)) throw new Error('device must be desktop, phone, or landscape.');
  for (const key of ['headless','recordVideo','bail']) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new Error(`${key} must be boolean.`);
  if (!['fail','record'].includes(config.browserErrors)) throw new Error('browserErrors must be fail or record.');
  for (const key of ['artifactsDir','testDir','pluginsDir']) {
    if (config[key] === undefined) continue;
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`${key} must be a nonempty path.`);
    const resolved = projectPath(root, config[key]);
    const relative = path.relative(root, resolved);
    if ((key === 'artifactsDir' && !relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${key} must be a directory inside the project.`);
    config[key] = resolved;
  }
  if (config.viewport && (!Number.isSafeInteger(config.viewport.width) || config.viewport.width < 1 || !Number.isSafeInteger(config.viewport.height) || config.viewport.height < 1)) throw new Error('viewport requires positive integer width and height.');
  if (config.webServer) {
    const server = config.webServer;
    if (typeof server.command !== 'string' || !server.command.trim() || typeof server.url !== 'string') throw new Error('webServer requires command and url.');
    const url = new URL(server.url);
    if (!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('webServer readiness URL must use local HTTP(S).');
    if (server.timeout !== undefined && (!Number.isSafeInteger(server.timeout) || server.timeout < 1)) throw new Error('webServer.timeout must be positive.');
    server.cwd = projectPath(root, server.cwd || '.');
    const relative = path.relative(root, server.cwd);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('webServer.cwd must be inside the project.');
  }
  return config;
}
