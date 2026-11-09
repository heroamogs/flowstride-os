import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Locator } from 'playwright';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { withDeadline } from '../ci/deadline';
import type { WebAdapter } from '../adapters/web/playwright';
import type { FlowstrideConfig } from '../types';
import { assertionCheck, reportAssertion, requireAssertion, type AssertionReporter } from '../reporting/assertion_result';
import { writePrivateState } from '../security/privateState';
import { artifactPrefix } from '../utils/projectPaths';
import { readBoundedProjectFile } from './project_data';
import { readableTargetDescription, readableTargetSchema } from './targeting';
import { name } from './validation';

const maxPixels = 4 * 1024 * 1024;
const maxBytes = 20 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const selector = z.string().min(1).max(2000);
const screenshotOptions = {
  target: readableTargetSchema.optional(),
  selector: selector.optional(),
  mask: z.array(z.union([readableTargetSchema, z.object({ selector }).strict()])).max(24).default([]),
  fullPage: z.boolean().default(false),
  timeout: z.number().int().min(1).max(120000).optional(),
};
const captureOptions = z.object({ ...screenshotOptions, name }).strict();
const matchOptions = z.object({
  ...screenshotOptions,
  baseline: z.string().min(1).max(4000),
  maxDiffRatio: z.number().min(0).max(1).default(0),
  pixelTolerance: z.number().int().min(0).max(255).default(0),
}).strict();
type Capture = z.infer<typeof captureOptions> | z.infer<typeof matchOptions>;

function validateDimensions(width: number, height: number) {
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > maxPixels) {
    throw new Error('Visual capture must be nonempty, at most 4096 pixels per side and at most 4 megapixels. Narrow the target or reduce the viewport.');
  }
}

export function decodeVisualPNG(bytes: Buffer) {
  if (bytes.length < 33 || bytes.length > maxBytes || !bytes.subarray(0, 8).equals(pngSignature) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Visual images must be PNG files within the 20 MiB limit.');
  }
  validateDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  // pngjs bounds decompression for non-interlaced images.
  if (bytes[28] !== 0) throw new Error('Visual images must be non-interlaced PNGs.');
  try { return PNG.sync.read(bytes); }
  catch { throw new Error('Visual image is not a valid PNG. Export it again and confirm it opens.'); }
}

function compareVisual(before: ReturnType<typeof decodeVisualPNG>, after: ReturnType<typeof decodeVisualPNG>, tolerance: number) {
  const dimensionsMatch = before.width === after.width && before.height === after.height;
  // Keep the diff within the actual image's dimensions even if the baseline is larger.
  const image = new PNG({ width: after.width, height: after.height });
  let changed = 0;
  for (let y = 0; y < after.height; y++) {
    for (let x = 0; x < after.width; x++) {
      const current = (y * after.width + x) * 4;
      const baseline = (y * before.width + x) * 4;
      const different = y >= before.height || x >= before.width ||
        Math.abs(after.data[current] - before.data[baseline]) > tolerance ||
        Math.abs(after.data[current + 1] - before.data[baseline + 1]) > tolerance ||
        Math.abs(after.data[current + 2] - before.data[baseline + 2]) > tolerance ||
        Math.abs(after.data[current + 3] - before.data[baseline + 3]) > tolerance;
      if (different) {
        changed++;
        image.data[current] = 255;
        image.data[current + 2] = 96;
      } else {
        // A faint grayscale guide shows where the difference occurred.
        const shade = Math.round((after.data[current] + after.data[current + 1] + after.data[current + 2]) / 9 + 140);
        image.data.fill(shade, current, current + 3);
      }
      image.data[current + 3] = 255;
    }
  }
  return { dimensionsMatch, image, changed, pixels: after.width * after.height };
}

export async function visual(
  web: WebAdapter, config: FlowstrideConfig, action: string, input: unknown,
  reporter?: AssertionReporter, cancelled: () => boolean = () => false,
) {
  const data = action === 'capture' ? captureOptions.parse(input) : action === 'match' ? matchOptions.parse(input) : undefined;
  if (!data) throw new Error(`Unknown visual action: ${action}`);
  if (data.target !== undefined && data.selector !== undefined || data.fullPage && (data.target !== undefined || data.selector !== undefined)) {
    throw new Error('Choose one readable target, explicit selector, or whole-page capture.');
  }
  if (web.hasFrameScope?.() && data.target === undefined && data.selector === undefined) {
    throw new Error('Visual capture inside an iframe requires an element target. Use flow.frame.main {} for a page capture.');
  }
  const project = config.projectRoot || process.cwd();
  const baseline = 'baseline' in data ? readBaseline(config, data.baseline) : undefined;
  const targetLabel = data.target !== undefined ? readableTargetDescription(data.target) : data.selector || (data.fullPage ? 'full page' : 'page viewport');
  const timeout = data.timeout ?? Math.min(config.timeout || 15000, 120000);
  const started = Date.now();
  const remaining = () => {
    if (cancelled()) throw new Error('Visual capture cancelled.');
    const left = timeout - (Date.now() - started);
    if (left <= 0) throw new Error('Visual capture timed out.');
    return left;
  };
  const bytes = await capture(web, data, remaining);
  const actual = decodeVisualPNG(bytes);
  const stem = artifactPrefix(config.testFile) + (config.browser || 'chromium') + '-';
  if ('name' in data) {
    const file = `visual/${stem}${data.name}-candidate.png`;
    remaining();
    writePrivateState(project, file, bytes);
    reportAssertion('visual.capture', targetLabel, [assertionCheck('candidate', `Baseline candidate saved at .flowstride/${file}`, true)], reporter);
    return;
  }

  const result = compareVisual(baseline!, actual, data.pixelTolerance);
  const ratio = result.changed / result.pixels;
  const size = (image: {width: number; height: number}) => `${image.width} × ${image.height} px`;
  const checks = [assertionCheck('dimensions', 'Image dimensions match', result.dimensionsMatch, size(baseline!), size(actual))];
  if (result.dimensionsMatch) {
    checks.push(assertionCheck('pixels', 'Changed pixel ratio stays within tolerance', ratio <= data.maxDiffRatio,
      `≤ ${data.maxDiffRatio * 100}%`, `${(ratio * 100).toFixed(4)}% (${result.changed}/${result.pixels} pixels)`));
  }
  let reason: string | undefined;
  remaining();
  if (checks.some(check => check.status === 'failed')) {
    const difference = PNG.sync.write(result.image);
    const evidence = `visual/${stem}${randomUUID()}`;
    remaining();
    writePrivateState(project, evidence + '-actual.png', bytes);
    writePrivateState(project, evidence + '-diff.png', difference);
    reason = (result.dimensionsMatch ? 'Visual difference was above the permitted ratio.' : 'Visual dimensions differ. Check the browser, viewport and approved baseline.') +
      ` Actual: .flowstride/${evidence}-actual.png. Diff: .flowstride/${evidence}-diff.png.`;
  }
  requireAssertion('visual.match', targetLabel, checks, reporter, { reason, timeout, elapsed: Date.now() - started });
}

function readBaseline(config: FlowstrideConfig, file: string) {
  if (path.isAbsolute(file) || !file.toLowerCase().endsWith('.png') || /[\\\x00-\x1f]/.test(file) || file.split('/').includes('..')) {
    throw new Error('Visual baseline must be a project-relative .png path.');
  }
  return decodeVisualPNG(readBoundedProjectFile(config, file, maxBytes));
}

async function capture(web: WebAdapter, data: Capture, remaining: () => number) {
  const page = web.getPage(), scope = web.getScope();
  const resolve = async (value: NonNullable<Capture['target']> | { selector: string }, label: string): Promise<Locator> => {
    const explicit = typeof value === 'object' && 'selector' in value;
    let locator: Locator, count: number;
    do {
      remaining();
      locator = explicit ? scope.locator(value.selector).filter({ visible: true }) : await web.resolveAssertionTarget(value, undefined, true, scope);
      count = await locator.count();
      if (count > 1) throw new Error(`${label} matched ${count} visible elements. Narrow it with a qualifier, spatial relationship or explicit selector.`);
      if (count === 1) return locator;
      if (label.startsWith('Visual mask')) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining())));
    } while (remaining() > 50);
    throw new Error(`${label} matched no visible element. Check the readable target and active frame.`);
  };
  const wanted = data.target ?? (data.selector ? { selector: data.selector } : undefined);
  const target = wanted && await resolve(wanted, 'Visual target');
  const dimensions = target ? await target.boundingBox({ timeout: remaining() }) : await page.evaluate(fullPage => ({
    width: fullPage ? Math.max(innerWidth, document.documentElement.scrollWidth) : innerWidth,
    height: fullPage ? Math.max(innerHeight, document.documentElement.scrollHeight) : innerHeight,
  }), data.fullPage);
  if (!dimensions) throw new Error('Visual target has no visible bounding box.');
  validateDimensions(Math.ceil(dimensions.width), Math.ceil(dimensions.height));
  const masks: Locator[] = [];
  for (const [index, mask] of data.mask.entries()) masks.push(await resolve(mask, `Visual mask ${index + 1}`));
  const marker = 'data-flowstride-visual-' + randomUUID();
  const marked = scope.locator(`[${marker}]`);
  try {
    for (const mask of masks) {
      await mask.evaluate((element, attribute) => element.setAttribute(attribute, ''), marker, { timeout: remaining() });
    }
    // The overlay masks the element's box. Clip painted overflow from its descendants during the same capture.
    const options = {
      type: 'png', animations: 'disabled', caret: 'hide', scale: 'css',
      mask: masks.length ? [marked] : [], style: masks.length ? `[${marker}] { clip-path: inset(0) !important; }` : undefined,
      timeout: remaining(),
    } as const;
    const bytes = await (target ? target.screenshot(options) : page.screenshot({ ...options, fullPage: data.fullPage }));
    remaining();
    if (masks.length && await marked.count() !== masks.length) {
      throw new Error('A visual mask changed during capture. Wait for the page to stabilize before comparing.');
    }
    return bytes;
  } finally {
    if (masks.length) {
      await withDeadline(marked.evaluateAll((elements, attribute) => {
        for (const element of elements) element.removeAttribute(attribute);
      }, marker), 1500).catch(() => {});
    }
  }
}
