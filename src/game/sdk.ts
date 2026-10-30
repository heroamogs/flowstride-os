import { prepareEvidenceFile, evidenceDirectory } from '../security/evidence';
import { artifactPrefix, projectPath } from '../utils/projectPaths';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright';
import type { FlowstrideConfig } from '../types';

export class GameSDK {
  private snapshots = new Map<string, Buffer>();
  private states = new Map<string, unknown>();
  constructor(private page: () => Page, private config: FlowstrideConfig) {}
  private timeout() { return this.config.timeout; }
  private async bridgeReady(method?: string) {
    await this.page().waitForFunction(method => {
      const bridge = (window as any).__FLOWSTRIDE_GAME__;
      return !!bridge && (!method || typeof bridge[method] === 'function');
    }, method, { timeout: this.timeout() });
  }
  private async point(options: any) {
    const canvas = this.page().locator(options.canvas || 'canvas');
    await canvas.waitFor({ state: 'visible', timeout: this.timeout() });
    const box = await canvas.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) throw new Error('Canvas has no usable bounds.');
    let { x, y } = options;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Canvas coordinates must be finite.');
    if ((options.unit || 'relative') === 'relative') { x *= box.width; y *= box.height; }
    else if (options.unit !== 'pixels') throw new Error('Coordinate unit must be relative or pixels.');
    if (x < 0 || x >= box.width || y < 0 || y >= box.height) throw new Error('Canvas coordinate is outside its bounds.');
    const point = { x: box.x + x, y: box.y + y };
    await canvas.evaluate((element, point) => {
      if (document.elementFromPoint(point.x, point.y) !== element) throw new Error('Canvas target is covered or outside the viewport.');
    }, point);
    return point;
  }
  private touch(options: any) {
    const input = options.input || (this.config.device === 'desktop' ? 'mouse' : 'touch');
    if (!['mouse','touch'].includes(input)) throw new Error('input must be mouse or touch.');
    return input === 'touch';
  }
  async tap(options: any) {
    const point = await this.point(options);
    if (this.touch(options)) await this.page().touchscreen.tap(point.x, point.y);
    else await this.page().mouse.click(point.x, point.y);
  }
  async drag(options: any) {
    const from = await this.point({ ...options, ...options.from });
    const to = await this.point({ ...options, ...options.to });
    const duration = options.duration ?? 250;
    if (!Number.isFinite(duration) || duration < 0 || duration > this.timeout()) throw new Error('Invalid gesture duration.');
    if (this.touch(options)) {
      const session = await this.page().context().newCDPSession(this.page());
      try {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
        for (let i = 1; i <= 10; i++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x-from.x)*i/10, y: from.y + (to.y-from.y)*i/10 }] });
          await delay(duration/10);
        }
      } finally {
        try { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
        finally { await session.detach(); }
      }
    } else {
      await this.page().mouse.move(from.x, from.y);
      await this.page().mouse.down();
      try {
        for (let i=1;i<=10;i++) { await this.page().mouse.move(from.x+(to.x-from.x)*i/10,from.y+(to.y-from.y)*i/10); await delay(duration/10); }
      } finally { await this.page().mouse.up(); }
    }
  }
  async swipe(options: any) { return this.drag({ ...options, input: 'touch' }); }
  async key(options: any) {
    const key = typeof options === 'string' ? options : options.key;
    const duration = typeof options === 'string' ? 0 : options.duration ?? 0;
    if (typeof key !== 'string' || !key || !Number.isFinite(duration) || duration < 0 || duration > this.timeout()) throw new Error('Invalid key or duration.');
    const keys = key === '+' ? [key] : key.split('+');
    const pressed: string[] = [];
    try {
      for (const part of keys) { await this.page().keyboard.down(part); pressed.push(part); }
      if (duration) await delay(duration);
    } finally {
      const released = await Promise.allSettled(pressed.reverse().map(part => this.page().keyboard.up(part)));
      if (released.some(result => result.status === 'rejected')) throw new Error('Failed to release game keyboard input.');
    }
  }
  async checkpoint(options: any) {
    const name = typeof options === 'string' ? options : options.name;
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Checkpoint name must use letters, digits, underscores or hyphens.');
    const directory = this.config.artifactsDir || path.resolve('flowstride-artifacts');
    evidenceDirectory(this.config, directory);
    const prefix = artifactPrefix(this.config.testFile);
    const file = prepareEvidenceFile(this.config, path.join(directory, prefix+name+'.png'));
    if (typeof options === 'object' && options.canvas) await this.page().locator(options.canvas).screenshot({ path: file });
    else await this.page().screenshot({ path: file });
    return file;
  }
  async snapshot(options: any) {
    if (!options?.name || typeof options.name !== 'string') throw new Error('snapshot requires a name.');
    const buffer = await this.page().locator(options.canvas || 'canvas').screenshot();
    this.snapshots.set(options.name, buffer);
  }
  private async difference(before: Buffer, after: Buffer) {
    return this.page().evaluate(async ({ before, after }) => {
      async function pixels(data: string) {
        const image = new Image(); image.src = 'data:image/png;base64,'+data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image,0,0);
        return { data: context.getImageData(0,0,canvas.width,canvas.height).data, width: canvas.width, height: canvas.height };
      }
      const a = await pixels(before), b = await pixels(after);
      if (a.width !== b.width || a.height !== b.height) throw new Error('Visual comparison dimensions differ.');
      let changed=0;
      for(let i=0;i<a.data.length;i+=4) if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])+Math.abs(a.data[i+3]-b.data[i+3])>60) changed++;
      return changed/(a.width*a.height);
    }, { before: before.toString('base64'), after: after.toString('base64') });
  }
  async expectVisual(options: any) {
    let before: Buffer | undefined;
    if (options.baseline) before = fs.readFileSync(projectPath(this.config.projectRoot || process.cwd(), options.baseline));
    else before = this.snapshots.get(options.name);
    if (!before) throw new Error('Visual snapshot or baseline is missing.');
    const ratio = await this.difference(before, await this.page().locator(options.canvas || 'canvas').screenshot());
    const min = options.minChange ?? 0, max = options.maxChange ?? (options.minChange === undefined ? 0 : 1);
    if (![min,max].every(Number.isFinite) || min < 0 || max > 1 || min > max) throw new Error('Visual change thresholds must satisfy 0 <= min <= max <= 1.');
    assert(ratio >= min && ratio <= max, `Canvas changed by ${ratio}; expected between ${min} and ${max}.`);
    return ratio;
  }
  async state(options: any = {}) {
    await this.bridgeReady('readState');
    return this.page().evaluate(async (field: string | undefined) => {
      const bridge = (window as any).__FLOWSTRIDE_GAME__;
      if (!bridge?.readState) throw new Error('Game state bridge is not registered.');
      let value = await bridge.readState();
      for (const part of field?.split('.') || []) {
        if (['__proto__','constructor','prototype'].includes(part) || value == null || !Object.hasOwn(value,part)) throw new Error(`Game state field is unavailable: ${field}`);
        value = value[part];
      }
      return value;
    }, options.path);
  }
  async expectState(options: any) {
    if (!options || !Object.hasOwn(options,'equals')) throw new Error('expectState requires equals.');
    const deadline = Date.now()+this.timeout();
    let actual: unknown;
    let observed = false;
    do {
      try { actual=await this.state(options); observed = true; assert.deepStrictEqual(actual,options.equals); return; } catch {}
      await delay(50);
    } while(Date.now()<deadline);
    if (!observed) throw new Error('Game state was not readable before the timeout.');
    assert.deepStrictEqual(actual,options.equals,`Game state did not reach the expected value: ${options.path || 'root'}`);
  }
  async snapshotState(options: any) {
    if (!options?.name) throw new Error('snapshotState requires name.');
    this.states.set(options.name,{ path: options.path, value: await this.state(options) });
  }
  async expectPreserved(options: any) {
    if (!this.states.has(options.name)) throw new Error('State snapshot missing.');
    const snapshot = this.states.get(options.name) as { path?: string; value: unknown };
    assert.deepStrictEqual(await this.state({ path: options.path ?? snapshot.path }), snapshot.value, 'Game state changed.');
  }
  async fixture(options: any) {
    await this.bridgeReady();
    return this.page().evaluate(async ({name,data})=> {
      const bridge=(window as any).__FLOWSTRIDE_GAME__;
      if (!bridge?.testMode || !Object.hasOwn(bridge.fixtures || {},name) || typeof bridge.fixtures[name] !== 'function') throw new Error('Named fixture is unavailable in this environment.');
      return bridge.fixtures[name](data);
    },{name:options.name,data:options.data});
  }
  async select(options: any) {
    if (typeof options?.id !== 'string' || !options.id.trim()) throw new Error('select requires a nonempty game object ID.');
    await this.bridgeReady('locate');
    const point=await this.page().evaluate(async id=> {
      const bridge=(window as any).__FLOWSTRIDE_GAME__;
      if (!bridge?.locate) throw new Error('Game object bridge is not registered.');
      return bridge.locate(id);
    },options.id);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid object coordinates.');
    if (this.touch(options)) await this.page().touchscreen.tap(point.x,point.y);
    else await this.page().mouse.click(point.x,point.y);
  }
}
