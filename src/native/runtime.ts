import type { AssertionResult, AssertionReporter } from '../reporting/assertion_result';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlowstrideConfig } from '../types';
import { WebAdapter } from '../adapters/web/playwright';
import { name, positive, validateContextOptions, evidencePath, readProjectFile } from './validation';
import { projectPath } from '../utils/projectPaths';
import { NativeEvents } from './events';
import { NativeFunctions } from './functions';
import { NativeComponents } from './components';
import { assertBrowser } from './assertions';
import { accessibility } from './accessibility';

export class NativeRuntime {
  readonly events: NativeEvents;
  public lastAssertion?: AssertionResult;
  private assertionGeneration = 0;
  private functions = new NativeFunctions();
  private components: NativeComponents;
  constructor(private web: WebAdapter, private config: FlowstrideConfig) {
    this.events = new NativeEvents(web, config); this.components = new NativeComponents(config);
  }
  async execute(command: string, input: unknown = {}): Promise<unknown> {
    this.lastAssertion = undefined;
    const generation=++this.assertionGeneration;
    const report:AssertionReporter=result=>{if(generation===this.assertionGeneration)this.lastAssertion=result;};
    const [area, action, extra] = command.split('.');
    if (!action || extra) throw new Error(`Unknown native command: flow.${command}`);
    if (area === 'browser') {
      if (action === 'create') { const data = z.object({ name, options: z.unknown().optional() }).strict().parse(input); validateContextOptions(data.options, this.config.browser, this.config.projectRoot); await this.web.createProfile(data.name, data.options); return; }
      if (action === 'use' || action === 'close') { const data = z.object({ name }).strict().parse(input); if (action === 'use') await this.web.useProfile(data.name); else { if (data.name === 'default') throw new Error('The default profile stays available until file completion.'); await this.events.disposeProfile(data.name); await this.web.closeProfile(data.name); } return; }
      if (action === 'list') { z.object({}).strict().parse(input); return this.web.profileNames(); }
      if (action === 'offline') { const data = z.object({ value: z.boolean() }).strict().parse(input); await this.web.getContext().setOffline(data.value); return; }
      if (action === 'permissions') { const data = z.object({ permissions: z.array(z.string()), origin: z.string().url().optional() }).strict().parse(input); await this.web.getContext().grantPermissions(data.permissions, { origin: data.origin }); return; }
      if (action === 'clearPermissions') { z.object({}).strict().parse(input); await this.web.getContext().clearPermissions(); return; }
      if (action === 'geolocation') { const data = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().nonnegative().optional() }).strict().parse(input); await this.web.getContext().setGeolocation(data); return; }
      throw new Error(`Unknown browser action: ${action}`);
    }
    if (area === 'assert') { if (action !== 'that') throw new Error(`Unknown assertion action: ${action}`); return assertBrowser(this.web.getPage(), input, this.config.timeout, report); }
    if (area === 'network') return this.events.network(action, input, report);
    if (area === 'download') return this.events.download(action, input, report);
    if (area === 'stub') return this.functions.execute(this.web.getPage(), action, input, this.config.timeout, report);
    if (area === 'component') return this.components.execute(this.web.getPage(), action, input);
    if (area === 'a11y') return accessibility(this.web.getPage(), this.config, action, input, report);
    if (area === 'clock') {
      const clock = this.web.getPage().clock;
      if (action === 'install') { const data = z.object({ time: z.union([z.string(), z.number()]).optional() }).strict().parse(input); await clock.install(data); return; }
      if (action === 'resume') { z.object({}).strict().parse(input); await clock.resume(); return; }
      if (['pauseAt','setFixedTime','setSystemTime'].includes(action)) { const data = z.object({ time: z.union([z.string().min(1), z.number().finite()]) }).strict().parse(input); if (typeof data.time === 'string' && !Number.isFinite(Date.parse(data.time))) throw new Error('Clock time must be a valid date.'); await (clock as any)[action](data.time); return; }
      if (['runFor','fastForward'].includes(action)) { const data = z.object({ milliseconds: z.number().int().min(0).max(86400000) }).strict().parse(input); await (clock as any)[action](data.milliseconds); return; }
      throw new Error(`Unknown clock action: ${action}`);
    }
    if (area === 'trace') {
      if (action === 'start') { const data = z.object({ name: name.optional() }).strict().parse(input); await this.web.beginTrace(undefined, data.name ? `${data.name}-trace.zip` : undefined); return; }
      if (action === 'stop') { z.object({}).strict().parse(input); return this.web.endTrace(); }
      throw new Error(`Unknown trace action: ${action}`);
    }
    if (area === 'har') {
      if (action === 'replay') {
        const data = z.object({ file: z.string().min(1), url: z.string().optional(), notFound: z.enum(['abort','fallback']).default('abort') }).strict().parse(input);
        readProjectFile(this.config, data.file, 100 * 1024 * 1024);
        await this.web.getContext().routeFromHAR(projectPath(this.config.projectRoot || process.cwd(), data.file), { url: data.url, notFound: data.notFound, update: false }); return;
      }
      throw new Error(`Unknown HAR action: ${action}. Enable har in configuration before browser creation to record.`);
    }
    throw new Error(`Unknown native command: flow.${command}`);
  }
  async captureDOM(step: string): Promise<string | undefined> {
    if (!this.config.domSnapshots) return;
    const page = this.web.getPage();
    // Saved HTML is diagnostic data. It is never injected into an executable frame.
    const html = await page.content();
    const file = evidencePath(this.config, `${name.parse(step)}-${randomUUID()}.dom.html`);
    fs.writeFileSync(file, html, { mode: 0o600 }); return file;
  }
  async dispose() { this.assertionGeneration++; this.lastAssertion=undefined; await this.events.dispose(); await this.functions.dispose(); await this.components.dispose(); }
}
