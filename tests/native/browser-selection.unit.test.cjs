const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { loadNativeConfig } = require('../../dist/ci/config');

test('CLI browser selection overrides configuration without changing CI/headed rules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-browser-config-'));
  try {
    fs.writeFileSync(path.join(root, 'flowstride.config.json'), JSON.stringify({ browser: 'webkit' }));
    assert.equal(loadNativeConfig(root, {}).browser, 'webkit');
    const config = loadNativeConfig(root, { browser: 'firefox', headed: true });
    assert.equal(config.browser, 'firefox');
    assert.equal(config.headless, config.ci);
    assert.equal(loadNativeConfig(root, { browser: 'firefox', headed: true, ci: true }).headless, true);
    assert.throws(() => loadNativeConfig(root, { browser: 'safari' }), /browser must be/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function dashboardFixture(failure) {
  const calls = [];
  const exports = {};
  const engine = name => ({ launch: async options => {
    calls.push({ engine: name, options });
    if (failure === 'launch') throw new Error('Browser binary unavailable');
    return { newPage: async () => ({ goto: async url => {
      calls.push({ url });
      if (failure === 'navigate') throw new Error('Dashboard unavailable');
    } }), close: async () => calls.push({ closed: name }) };
  } });
  const file = path.resolve(__dirname, '../../dist/native/dashboard.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports,
    require(name) { assert.equal(name, 'playwright'); return { firefox: engine('firefox'), webkit: engine('webkit') }; }
  });
  return { dashboard: new exports.DashboardBrowser(), calls };
}
for (const engine of ['firefox', 'webkit']) test(`dashboard uses isolated ${engine} and closes it`, async () => {
  const { dashboard, calls } = dashboardFixture();
  await dashboard.open('http://localhost:5000', engine);
  assert.equal(calls[0].engine, engine);
  assert.equal(calls[0].options.headless, false);
  assert.equal(calls[1].url, 'http://localhost:5000');
  await dashboard.close(); await dashboard.close();
  assert.equal(calls.filter(call => call.closed === engine).length, 1);
});
for (const failure of ['launch', 'navigate']) test(`dashboard ${failure} failure never silently opens Chrome`, async () => {
  const { dashboard, calls } = dashboardFixture(failure);
  await assert.rejects(dashboard.open('http://localhost:5000', 'firefox'), /unavailable/);
  assert.equal(calls.filter(call => call.engine).length, 1);
  assert.equal(calls.filter(call => call.closed).length, failure === 'navigate' ? 1 : 0);
});
