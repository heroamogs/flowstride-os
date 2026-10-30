import { evidenceDirectory, prepareEvidenceFile } from '../security/evidence';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { BrowserContextOptions } from 'playwright';
import { projectPath, artifactPrefix } from '../utils/projectPaths';
import type { FlowstrideConfig } from '../types';

export const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/, 'Use a simple name without path separators.');
export const positive = z.number().int().min(1).max(2147483647);
export const headers = z.record(z.string(), z.string());
const size = z.object({ width: positive, height: positive }).strict();
// File-bearing options are handled explicitly; evidence paths cannot bypass project containment.
export const contextOptions = z.object({
  acceptDownloads: z.boolean().optional(), strictSelectors: z.boolean().optional(),
  clientCertificates: z.array(z.object({ origin:z.string().url(), certPath:z.string().optional(), keyPath:z.string().optional(), pfxPath:z.string().optional(), passphrase:z.string().optional() }).strict()).optional(),
  storageState: z.union([z.string(), z.object({ cookies:z.array(z.object({ name:z.string(), value:z.string(), domain:z.string(), path:z.string(), expires:z.number(), httpOnly:z.boolean(), secure:z.boolean(), sameSite:z.enum(['Strict','Lax','None']) }).strict()), origins:z.array(z.object({ origin:z.string().url(), localStorage:z.array(z.object({name:z.string(),value:z.string()}).strict()), indexedDB:z.array(z.unknown()).optional() }).strict()) }).strict()]).optional(),
  baseURL: z.string().url().optional(),
  bypassCSP: z.boolean().optional(), colorScheme: z.enum(['light','dark','no-preference']).nullable().optional(),
  contrast: z.enum(['no-preference','more']).nullable().optional(),
  deviceScaleFactor: z.number().positive().optional(), extraHTTPHeaders: headers.optional(),
  forcedColors: z.enum(['active','none']).nullable().optional(), hasTouch: z.boolean().optional(),
  httpCredentials: z.object({ username: z.string(), password: z.string(), origin: z.string().url().optional(), send: z.enum(['always','unauthorized']).optional() }).strict().optional(),
  geolocation: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().nonnegative().optional() }).strict().optional(),
  ignoreHTTPSErrors: z.boolean().optional(), isMobile: z.boolean().optional(), javaScriptEnabled: z.boolean().optional(),
  locale: z.string().min(1).optional(), offline: z.boolean().optional(), permissions: z.array(z.string()).optional(),
  proxy: z.object({ server: z.string().min(1), bypass: z.string().optional(), username: z.string().optional(), password: z.string().optional() }).strict().optional(),
  reducedMotion: z.enum(['reduce','no-preference']).nullable().optional(), screen: size.optional(),
  serviceWorkers: z.enum(['allow','block']).optional(), timezoneId: z.string().optional(),
  userAgent: z.string().optional(), viewport: size.nullable().optional(),
}).strict();
export function validateContextOptions(value: unknown, browser = 'chromium', root = process.cwd()): BrowserContextOptions {
  const parsed = contextOptions.parse(value ?? {});
  if (typeof parsed.storageState === 'string') parsed.storageState = projectPath(root, parsed.storageState);
  for (const certificate of parsed.clientCertificates || []) for (const key of ['certPath','keyPath','pfxPath'] as const) if (certificate[key]) certificate[key] = projectPath(root, certificate[key]!);
  if (browser === 'firefox' && parsed.isMobile) throw new Error('Firefox does not support mobile emulation; use viewport and touch options instead.');
  return parsed as BrowserContextOptions;
}
export function evidencePath(config: FlowstrideConfig, file: string): string {
  const safe = name.parse(file);
  const root = config.projectRoot || process.cwd();
  const dir = projectPath(root, config.artifactsDir || 'flowstride-artifacts');
  evidenceDirectory(config, dir);
  return prepareEvidenceFile(config, path.join(dir, artifactPrefix(config.testFile) + safe));
}
export function readProjectFile(config: FlowstrideConfig, file: string, maxSize = 20 * 1024 * 1024): Buffer {
  const absolute = projectPath(config.projectRoot || process.cwd(), file);
  if (!fs.statSync(absolute).isFile() || fs.statSync(absolute).size > maxSize) throw new Error('Fixture must be a regular project file within the size limit.');
  return fs.readFileSync(absolute);
}
export async function poll(read: () => Promise<boolean>, timeout: number, label: string): Promise<void> {
  const deadline = Date.now() + positive.parse(timeout);
  let last: unknown;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Assertion timed out: ${label}`, { cause: last });
    let timer: NodeJS.Timeout | undefined;
    try {
      const ok = await Promise.race([read(), new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error('Read timed out')), remaining); })]);
      if (ok) return;
    } catch (error) { last = error; }
    finally { clearTimeout(timer); }
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, deadline - Date.now()))));
  }
}
