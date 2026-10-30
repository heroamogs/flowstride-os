const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire, Module } = require('node:module');

const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const ui = path.join(root, 'src/ui');
const requireUI = createRequire(path.join(ui, 'package.json'));
const code = requireUI('esbuild').buildSync({
  entryPoints: [path.join(ui, 'src/utils/flowPanelSize.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;
const compiled = new Module(path.join(ui, 'flow-panel-size.test.cjs'));
compiled._compile(code, path.join(ui, 'flow-panel-size.test.cjs'));
const { DEFAULT_FLOW_PANEL_WIDTH, flowPanelBounds, clampFlowPanelWidth } = compiled.exports;

test('the existing 280-pixel default remains unchanged on desktop windows', () => {
  assert.equal(DEFAULT_FLOW_PANEL_WIDTH, 280);
  for (const width of [800, 1200, 1600, 2560]) assert.equal(clampFlowPanelWidth(280, width), 280);
});

test('resizing preserves usable test and preview widths with a bounded desktop maximum', () => {
  assert.equal(clampFlowPanelWidth(-100, 1500), 220);
  assert.equal(clampFlowPanelWidth(10000, 1500), 640);
  const constrained = clampFlowPanelWidth(10000, 800);
  assert(800 - constrained - 1 >= 360, 'the preview keeps at least 360 pixels when space permits');
});

test('narrow and zero-sized containers fit without negative sizes or horizontal overflow', () => {
  for (let container = 0; container <= 1600; container += 7) {
    const { min, max } = flowPanelBounds(container);
    assert(Number.isInteger(min) && Number.isInteger(max));
    assert(min >= 0 && max >= min);
    assert(max <= Math.max(0, container - 1));
    for (const requested of [-500, 0, 220, 280, 640, 5000]) {
      const result = clampFlowPanelWidth(requested, container);
      assert(result >= min && result <= max);
      if (container > 4) assert(container - result - 1 > 0, 'the preview never disappears');
    }
  }
});

test('invalid and hostile size values cannot become CSS or unbounded layout values', () => {
  for (const container of [NaN, Infinity, -Infinity, -1, 0, 480, 1500]) {
    for (const requested of [NaN, Infinity, -Infinity, '100vw;display:none', '<img onerror=alert(1)>', null, {}, 321.9]) {
      const result = clampFlowPanelWidth(requested, container);
      assert(Number.isFinite(result) && Number.isInteger(result));
      assert(result >= 0 && result <= 640);
    }
  }
});
