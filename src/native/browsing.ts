import { z } from 'zod';
import type { Page, Dialog } from 'playwright';
import type { WebAdapter } from '../adapters/web/playwright';
import type { FlowstrideConfig } from '../types';
import { name, positive } from './validation';
import { readableTargetSchema } from './targeting';
import { dataSnapshot } from './paths';
import type { InteractionControl } from './interactions';
import { ArmedEvent } from './events';
import { assertionCheck, requireAssertion, type AssertionReporter } from '../reporting/assertion_result';

const named = z.object({ name }).strict();
const armedTab = z.object({ name, timeout: positive.optional() }).strict();
export const frameScopeSchema = z.object({ target: readableTargetSchema.optional(), selector: z.string().min(1).max(4000).optional(), timeout: positive.optional() }).strict()
  .refine(data => [data.target,data.selector].filter(value => value !== undefined).length === 1, 'Choose exactly one readable iframe target or explicit selector.')
  .refine(data => typeof data.target !== 'object' || data.target.element === undefined || data.target.element === 'iframe', 'A frame target element must be iframe.');
const dialogType = z.enum(['alert','confirm','prompt','beforeunload']);
const armDialog = z.object({ name, action: z.enum(['accept','dismiss']), promptText: z.string().max(100000).optional(), timeout: positive.optional() }).strict()
  .refine(data => data.promptText === undefined || data.action === 'accept', 'promptText is only valid when accepting a prompt.');
const expectDialog = z.object({ name, type: dialogType.optional(), message: z.string().max(100000).optional(), contains: z.string().min(1).max(100000).optional(), defaultValue: z.string().max(100000).optional() }).strict()
  .refine(data => ['type','message','contains','defaultValue'].some(key => Object.hasOwn(data,key)), 'Provide a dialog type, message, contains, or defaultValue expectation.');
type DialogResult = { type: string; message: string; defaultValue: string };
type PendingTab = { event: ArmedEvent<Page>; opener: Page; profile: string };
type PendingDialog = { event: ArmedEvent<DialogResult>; page: Page; profile: string; action: 'accept'|'dismiss'; promptText?: string };

/** Page-owned event capture; every promise resolves even when its trigger never fires. */
export class NativeBrowsing {
  private tabs = new Map<string, PendingTab>();
  private dialogs = new Map<string, PendingDialog>();
  private generation = 0;
  private observer = (dialog: Dialog) => this.handleDialog(dialog);
  constructor(private web: WebAdapter, private config: FlowstrideConfig, private control?: InteractionControl) {
    web.nativeDialogObserver = this.observer;
  }
  private key(value: string) { return `${this.web.activeProfile}:${value}`; }
  private check(generation = this.generation) {
    if (this.control?.cancelled() || generation !== this.generation) throw new Error('Browser event cancelled during cleanup.');
  }
  private async take<T>(event: ArmedEvent<T>, label: string): Promise<T> {
    const timeout = this.config.timeout ?? 30000;
    // Registered before the worker deadline, so a timeout detaches the handler before execution continues.
    const timer = setTimeout(() => event.fail(new Error(`${label} timed out after ${timeout} ms while waiting. Check its trigger, active tab/profile and capture timeout.`)),timeout);
    try { return await event.take(); } finally { clearTimeout(timer); }
  }
  async tab(action: string, input: unknown): Promise<void> {
    this.check();
    const value = dataSnapshot(input);
    if (action === 'arm') {
      const data = armedTab.parse(value), key = this.key(data.name), opener = this.web.getPage();
      if (this.tabs.has(key) || this.web.hasNamedPage(data.name)) throw new Error(`Tab name already exists: ${data.name}. Close it or choose a different name.`);
      const onPopup = (page: Page) => event.capture(page);
      const onClose = () => event.fail(new Error(`Tab capture "${data.name}" failed: its opener closed before the popup arrived.`));
      const event = new ArmedEvent<Page>(data.timeout ?? this.config.timeout, () => { opener.off('popup',onPopup); opener.off('close',onClose); });
      opener.on('popup',onPopup); opener.on('close',onClose);
      this.tabs.set(key,{ event,opener,profile:this.web.activeProfile }); return;
    }
    const data = named.parse(value), key = this.key(data.name);
    if (action === 'name') {
      if (this.tabs.has(key)) throw new Error(`Tab name already armed: ${data.name}.`);
      this.web.namePage(data.name,this.web.getPage()); return;
    }
    if (action === 'use') {
      const capture = this.tabs.get(key), generation = this.generation;
      if (capture) {
        try {
          const page = await this.take(capture.event,`Tab "${data.name}"`); this.check(generation);
          if (capture.profile !== this.web.activeProfile) throw new Error('The active profile changed while waiting for the tab.');
          this.web.namePage(data.name,page);
        } catch (error) { throw new Error(`Cannot use tab "${data.name}": ${error instanceof Error ? error.message : String(error)} Arm it before clicking the popup trigger and check its timeout.`); }
        finally { this.tabs.delete(key); }
      }
      await this.web.useNamedPage(data.name); return;
    }
    if (action === 'close') {
      if (this.tabs.has(key)) throw new Error(`Tab "${data.name}" is still a capture. Use it before closing it.`);
      await this.web.closeNamedPage(data.name); return;
    }
    throw new Error(`Unknown tab action: ${action}`);
  }
  async frame(action: string, input: unknown): Promise<void> {
    this.check();
    const value = dataSnapshot(input);
    if (action === 'main') { z.object({}).strict().parse(value); this.web.mainFrameScope(); return; }
    if (action !== 'use') throw new Error(`Unknown frame action: ${action}`);
    const data = frameScopeSchema.parse(value), generation = this.generation;
    await this.web.useFrameScope(data, () => this.check(generation));
  }
  async dialog(action: string, input: unknown, reporter?: AssertionReporter): Promise<void> {
    this.check();
    const value = dataSnapshot(input);
    if (action === 'arm') {
      const data = armDialog.parse(value), key = this.key(data.name), page = this.web.getPage();
      if (this.dialogs.has(key)) throw new Error(`Dialog name already exists: ${data.name}. Consume it with flow.dialog.expect first.`);
      if ([...this.dialogs.values()].some(item => item.page === page && item.event.pending)) throw new Error('This page already has an armed dialog. Expect it before arming another.');
      const onClose = () => event.fail(new Error(`Dialog capture "${data.name}" failed: its page closed.`));
      const event = new ArmedEvent<DialogResult>(data.timeout ?? this.config.timeout, () => page.off('close',onClose));
      page.on('close',onClose);
      this.dialogs.set(key,{ event,page,profile:this.web.activeProfile,action:data.action,promptText:data.promptText }); return;
    }
    if (action !== 'expect') throw new Error(`Unknown dialog action: ${action}`);
    const data = expectDialog.parse(value), key = this.key(data.name), capture = this.dialogs.get(key);
    if (!capture) throw new Error(`No dialog capture "${data.name}" in profile "${this.web.activeProfile}". Arm it before triggering the dialog.`);
    const generation = this.generation;
    try {
      let result: DialogResult;
      try { result = await this.take(capture.event,`Dialog "${data.name}"`); this.check(generation); }
      catch (error) {
        requireAssertion('dialog.expect',`dialog "${data.name}"`,[{ key:'capture',label:'Dialog captured and handled',status:'failed',reason:error instanceof Error ? error.message : String(error) }],reporter,{ reason:'No usable dialog was captured. Check the trigger, active tab/profile and capture timeout.' }); return;
      }
      const checks = [assertionCheck('capture','Dialog captured and handled',true,true,true)];
      if (data.type !== undefined) checks.push(assertionCheck('type','dialog type',result.type === data.type,data.type,result.type));
      if (data.message !== undefined) checks.push(assertionCheck('message','dialog message',result.message === data.message,data.message,result.message));
      if (data.contains !== undefined) checks.push(assertionCheck('contains','dialog message contains',result.message.includes(data.contains),data.contains,result.message));
      if (data.defaultValue !== undefined) checks.push(assertionCheck('defaultValue','prompt default value',result.type === 'prompt' && result.defaultValue === data.defaultValue,'[REDACTED]','[REDACTED]'));
      requireAssertion('dialog.expect',`dialog "${data.name}"`,checks,reporter,{ reason:checks.some(check => check.status === 'failed') ? 'Captured dialog differs from the expected type/message/default value.' : undefined });
    } finally { this.dialogs.delete(key); }
  }
  private async handleDialog(dialog: Dialog): Promise<boolean> {
    const capture = [...this.dialogs.values()].find(item => item.page === dialog.page() && item.event.pending);
    if (!capture) return false;
    const generation = this.generation;
    try {
      this.check(generation);
      const result = { type:dialog.type(),message:dialog.message(),defaultValue:dialog.defaultValue() };
      if (capture.promptText !== undefined && result.type !== 'prompt') {
        await dialog.dismiss().catch(() => {});
        capture.event.fail(new Error(`promptText requires a prompt, but the application opened an ${result.type} dialog.`)); return true;
      }
      if (capture.action === 'accept') await dialog.accept(capture.promptText); else await dialog.dismiss();
      this.check(generation); capture.event.capture(result);
    } catch { await dialog.dismiss().catch(() => {}); capture.event.fail(new Error('The dialog could not be handled; its page closed, the operation was cancelled, or the browser rejected the response. Prompt input is withheld from diagnostics.')); }
    finally { capture.promptText = undefined; }
    return true;
  }
  disposeProfile(profile: string) {
    for (const map of [this.tabs,this.dialogs] as const) for (const [key,item] of map) if (item.profile === profile) { item.event.fail(new Error('Browser profile closed.')); if ('promptText' in item) item.promptText=undefined; map.delete(key); }
  }
  dispose() {
    this.generation++;
    for (const item of [...this.tabs.values(),...this.dialogs.values()]) { item.event.fail(new Error('Browser event cancelled during cleanup.')); if ('promptText' in item) item.promptText=undefined; }
    this.tabs.clear(); this.dialogs.clear();
  }
}
