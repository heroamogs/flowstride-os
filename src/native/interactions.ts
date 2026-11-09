import { z } from 'zod';
import type { Locator } from 'playwright';
import type { WebAdapter } from '../adapters/web/playwright';
import type { FlowstrideConfig } from '../types';
import { readableTargetSchema, readableTargetDescription } from './targeting';
import { positive } from './validation';
import { dataSnapshot } from './paths';

// Key names are validated before any modifiers or focus changes are sent.
const modifiers = ['ControlOrMeta','Control','Alt','Shift','Meta'];
const namedKeys = new Set([
  'Enter','Tab','Escape','Backspace','Delete','Insert','Home','End','PageUp','PageDown',
  'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','CapsLock','NumLock','ScrollLock',
  'Pause','PrintScreen','ContextMenu','AltGraph','Shift','Control','Alt','Meta',
  'ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight',
  'AudioVolumeMute','AudioVolumeDown','AudioVolumeUp','MediaTrackNext','MediaTrackPrevious','MediaPlayPause',
]);
export function validateKey(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error('flow.press requires a supported key or shortcut, such as Enter, Tab or ControlOrMeta+A.');
  let key = value;
  const used = new Set<string>();
  for (;;) {
    const modifier = modifiers.find(item => key.startsWith(item + '+'));
    if (!modifier) break;
    if (used.has(modifier)) throw new Error('A keyboard shortcut must not repeat a modifier.');
    used.add(modifier); key = key.slice(modifier.length + 1);
  }
  if (!namedKeys.has(key) && !/^[\x20-\x7e]$/.test(key) && !/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(key)) {
    throw new Error('Unsupported keyboard key or shortcut. Use a Playwright key name, such as Enter, ArrowDown or ControlOrMeta+A.');
  }
  return value;
}

export interface InteractionControl { delay(milliseconds: number): Promise<void>; cancelled(): boolean; }
const targetFields = { target: readableTargetSchema.optional(), selector: z.string().min(1).max(4000).optional() };
const chooseTarget = (data: { target?: unknown; selector?: unknown }) => [data.target, data.selector].filter(item => item !== undefined).length === 1;
const typing = z.object({ ...targetFields, text: z.string().max(100000), clear: z.boolean().default(true), delay: z.number().int().min(0).max(60000).default(30), blur: z.boolean().default(true), timeout: positive.optional() }).strict().refine(chooseTarget, 'Choose exactly one readable target or explicit selector.');
const scrolling = z.object({ ...targetFields, x: z.number().int().min(-1000000).max(1000000).optional(), y: z.number().int().min(-1000000).max(1000000).optional(), timeout: positive.optional() }).strict().refine(data => !data.target || !data.selector, 'Choose a readable target or an explicit selector, not both.').refine(data => data.target !== undefined || data.selector !== undefined || data.x !== undefined || data.y !== undefined, 'Scrolling requires a target or an x/y distance.');
const legacy = z.object({ selector: z.string().min(1).max(4000), elementType: z.string().optional(), readableTarget: readableTargetSchema.optional(), key: z.string().optional(), optional: z.boolean().optional() }).strict();

/** Each action has a single deadline, reads the active profile, and never uses first(). */
export class NativeInteractions {
  constructor(private web: WebAdapter, private config: FlowstrideConfig, private control?: InteractionControl) {}

  private scope(timeout?: number) {
    const duration = positive.parse(timeout ?? this.config.timeout ?? 30000), deadline = Date.now() + duration;
    const remaining = () => {
      if (this.control?.cancelled()) throw new Error('Browser interaction cancelled.');
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Browser interaction timed out after ${duration} ms.`);
      return left;
    };
    const delay = async (ms: number) => {
      const wait = Math.min(ms, remaining());
      if (this.control) await this.control.delay(wait); else await new Promise(resolve => setTimeout(resolve, wait));
      remaining();
    };
    return { remaining, delay };
  }

  private async unique(resolve: () => Promise<Locator>, label: string, scope: ReturnType<NativeInteractions['scope']>): Promise<Locator> {
    for (;;) {
      scope.remaining();
      const locator = (await resolve()).filter({ visible: true }), count = await locator.count();
      if (count > 1) throw new Error(`Ambiguous target ${label}: ${count} visible matches. Narrow it with an element qualifier, inside/spatial relationship, or an explicit selector.`);
      if (count === 1) return locator;
      try { await scope.delay(40); }
      catch (error) { throw new Error(`Target not found: ${label}; 0 visible matches. Check the readable text, frame, and spatial/container scope. ${String(error instanceof Error ? error.message : error)}`); }
    }
  }

  private objectTarget(data: { target?: z.infer<typeof readableTargetSchema>; selector?: string }, scope: ReturnType<NativeInteractions['scope']>) {
    const label = data.target !== undefined ? readableTargetDescription(data.target) : `selector ${JSON.stringify(data.selector)}`;
    return this.unique(() => data.target !== undefined ? this.web.resolveAssertionTarget(data.target, undefined, true) : this.web.resolveInteractionTarget(data.selector!), label, scope);
  }

  async simple(action: string, input: unknown): Promise<void> {
    if (['goBack','goForward','reload'].includes(action)) {
      z.object({ optional: z.boolean().optional() }).strict().parse(dataSnapshot(input));
      const scope = this.scope(), page = this.web.getPage();
      // Null responses are valid for same-document history and for an empty history.
      await page[action as 'goBack'|'goForward'|'reload']({ waitUntil: 'domcontentloaded', timeout: scope.remaining() });
      scope.remaining(); return;
    }
    if (!['press','clear','focus','blur','doubleClick','rightClick'].includes(action)) throw new Error('Unknown browser interaction.');
    const data = legacy.parse(dataSnapshot(input));
    if (action === 'press') validateKey(data.key);
    else if (data.key !== undefined) throw new Error('Only flow.press accepts a keyboard key.');
    const scope = this.scope();
    const label = data.readableTarget ? readableTargetDescription(data.readableTarget) : data.selector;
    const locator = await this.unique(() => this.web.resolveInteractionTarget(data.selector, data.elementType, data.readableTarget), label, scope);
    const options = () => ({ timeout: scope.remaining() });
    if (action === 'press' || action === 'focus') {
      if (!await locator.isEnabled(options())) throw new Error('The target is disabled and cannot receive keyboard focus.');
      await locator.focus(options());
      if (!await locator.evaluate(element => (element.getRootNode() as Document | ShadowRoot).activeElement === element, undefined, options())) throw new Error('The target did not receive focus. Choose the actual focusable input, button, link or editable element.');
    }
    if (action === 'press') {
      try { await locator.press(data.key!, options()); }
      catch (error) {
        for (const modifier of modifiers.filter(value => data.key!.split('+').includes(value))) await this.web.getPage().keyboard.up(modifier).catch(() => {});
        throw error;
      }
    } else if (action === 'clear') await locator.fill('', options());
    else if (action === 'focus') { /* Focus and its observed result were checked above. */ }
    else if (action === 'blur') { await locator.blur(options()); if (await locator.evaluate(element => (element.getRootNode() as Document | ShadowRoot).activeElement === element, undefined, options())) throw new Error('The target remained focused after blur; check application focus handlers.'); }
    else if (action === 'doubleClick') await locator.dblclick(options());
    else await locator.click({ ...options(), button: 'right' });
    scope.remaining();
  }

  async type(input: unknown): Promise<void> {
    const data = typing.parse(dataSnapshot(input)), scope = this.scope(data.timeout), locator = await this.objectTarget(data, scope);
    let phase = 'checking editability', completed = 0;
    try {
      if (!await locator.isEditable({ timeout: scope.remaining() })) throw new Error('The target is disabled or read-only; typing requires an editable control.');
      phase = 'focusing'; await locator.focus({ timeout: scope.remaining() });
      if (!await locator.evaluate(element => (element.getRootNode() as Document | ShadowRoot).activeElement === element, undefined, {timeout:scope.remaining()})) throw new Error('The editable target did not receive focus.');
      if (data.clear) { phase = 'clearing'; await locator.fill('', { timeout: scope.remaining() }); }
      else {
        phase = 'moving to the end';
        await locator.evaluate(element => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            try { element.setSelectionRange(element.value.length, element.value.length); } catch { /* Number inputs do not support selection ranges. */ }
          } else if ((element as HTMLElement).isContentEditable) {
            const range = element.ownerDocument.createRange(); range.selectNodeContents(element); range.collapse(false);
            const selection = element.ownerDocument.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
          }
        }, undefined, { timeout: scope.remaining() });
      }
      phase = 'typing';
      for (const character of data.text) {
        if (completed && data.delay) await scope.delay(data.delay);
        if (!await locator.isEditable({ timeout:scope.remaining() })) throw new Error('The target became disabled or read-only during typing.');
        await locator.pressSequentially(character, { timeout: scope.remaining() }); completed++;
      }
      if (data.blur) { phase = 'blurring'; await locator.blur({ timeout: scope.remaining() }); }
      scope.remaining();
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).split('\n')[0].replace(/"[^"]*"|'[^']*'/g, '[value]');
      throw new Error(`Configurable typing failed while ${phase} (${completed}/${Array.from(data.text).length} characters completed). ${message}`);
    }
  }

  async scroll(input: unknown): Promise<void> {
    const data = scrolling.parse(dataSnapshot(input)), scope = this.scope(data.timeout);
    const distance = { x: data.x ?? 0, y: data.y ?? 0 };
    if (data.target === undefined && data.selector === undefined) {
      scope.remaining();
      await this.web.getScope().evaluate(({x,y}) => window.scrollBy({ left:x, top:y, behavior:'instant' }), distance);
    } else {
      const locator = await this.objectTarget(data, scope);
      if (data.x === undefined && data.y === undefined) await locator.scrollIntoViewIfNeeded({ timeout:scope.remaining() });
      else await locator.evaluate((element,{x,y}) => {
        const style = getComputedStyle(element);
        if (x && (element.scrollWidth <= element.clientWidth || !/auto|scroll|overlay/.test(style.overflowX))) throw new Error(`Target cannot scroll horizontally: clientWidth=${element.clientWidth}, scrollWidth=${element.scrollWidth}, overflowX=${style.overflowX}.`);
        if (y && (element.scrollHeight <= element.clientHeight || !/auto|scroll|overlay/.test(style.overflowY))) throw new Error(`Target cannot scroll vertically: clientHeight=${element.clientHeight}, scrollHeight=${element.scrollHeight}, overflowY=${style.overflowY}.`);
        element.scrollBy({ left:x, top:y, behavior:'instant' });
      }, distance, { timeout:scope.remaining() });
    }
    scope.remaining();
  }
}
