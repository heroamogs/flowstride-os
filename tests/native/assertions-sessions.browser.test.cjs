const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const { WebAdapter } = require(path.join(root, 'dist/adapters/web/playwright'));
const { ApiAdapter } = require(path.join(root, 'dist/adapters/api/undici'));
const { FlowWorker } = require(path.join(root, 'dist/runner/flow_worker'));
const { FlowOrchestrator } = require(path.join(root, 'dist/runner/flow_orchestrator'));
const { runNativeCI } = require(path.join(root, 'dist/ci/runtime'));

const html = pathname => `<!doctype html><html><body>
<button id="noop" disabled="">Continue</button><div id="state" class="primary selected"></div>
<script>
${pathname === '/seed' ? `sessionStorage.setItem('tenant','fixture-tenant');sessionStorage.setItem('empty','');localStorage.setItem('theme','dark');document.cookie='fixture_session=present; path=/';` : ''}
const state = document.querySelector('#state');
state.setAttribute('data-tenant', sessionStorage.getItem('tenant') ?? 'missing');
state.setAttribute('data-theme', localStorage.getItem('theme') ?? 'missing');
state.setAttribute('data-cookie', document.cookie);
state.setAttribute('data-state', 'pending');
${pathname === '/delayed' ? `setTimeout(()=>state.setAttribute('data-state','approved'),180);` : ''}
</script></body></html>`;
async function serve(handler) {
  const server = http.createServer(handler || ((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html(req.url)); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
function configuration(extra = {}) { return { ci: true, headless: true, timeout: 1500, recordVideo: false, ...extra }; }
function worker(config, web) { return new FlowWorker(config, web, new ApiAdapter(config), {}, {}); }
function expectAttribute(w, attribute, text, extra = {}) {
  return w.executeStep('expect', { type: 'attribute', selector: '#state', attribute, text, ...extra });
}

test('real browser checks attributes, waits for updates, and rejects wrong/missing values', async () => {
  const server = await serve(), config = configuration(), web = new WebAdapter(config), w = worker(config, web);
  try {
    await web.initialise();
    await web.navigate(server.url + '/delayed');
    await expectAttribute(w, 'data-state', 'approved');
    await expectAttribute(w, 'class', 'selected', { fuzzy: true });
    await w.executeStep('expect', { type: 'attribute', selector: '#noop', attribute: 'disabled', text: '' });
    config.timeout = 160;
    await assert.rejects(expectAttribute(w, 'data-state', 'wrong'), /Attribute assertion failed/);
    await assert.rejects(expectAttribute(w, 'data-missing', ''), /Attribute assertion failed/);
  } finally { await web.shutdown(); await server.close(); }
});

test('restoring in the active page preserves cookies/localStorage and does not reset later changes on reload', async () => {
  const server = await serve(), config = configuration(), web = new WebAdapter(config), w = worker(config, web);
  try {
    await web.initialise(); await web.navigate(server.url + '/seed');
    await w.executeStep('save', { type: 'session', name: 'memory' });
    await web.getPage().evaluate(() => { sessionStorage.clear(); localStorage.clear(); document.cookie = 'fixture_session=; max-age=0; path=/'; });
    await w.executeStep('use', { type: 'session', name: 'memory' });
    assert.deepEqual(await web.getPage().evaluate(() => ({ ...sessionStorage })), { tenant: 'fixture-tenant', empty: '' });
    await web.navigate(server.url + '/read');
    await expectAttribute(w, 'data-theme', 'dark');
    await expectAttribute(w, 'data-cookie', 'fixture_session=present', { fuzzy: true });
    await web.getPage().evaluate(() => sessionStorage.setItem('tenant', 'changed-by-app'));
    await web.getPage().reload(); await expectAttribute(w, 'data-tenant', 'changed-by-app');
    await web.getPage().evaluate(() => sessionStorage.clear());
    await web.getPage().reload(); await expectAttribute(w, 'data-tenant', 'missing');
  } finally { await web.shutdown(); await server.close(); }
});

test('fresh-page restoration runs before app startup, stays on its saved origin and skips foreign top-level frames', async () => {
  const server = await serve();
  const foreign = await serve((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<iframe src="${server.url}/read"></iframe>`); });
  const config = configuration(), web = new WebAdapter(config), w = worker(config, web);
  try {
    await web.initialise(); await web.navigate(server.url + '/seed');
    await w.executeStep('save', { type: 'session', name: 'fresh' });
    await web.shutdown(); await web.initialise();
    await w.executeStep('use', { type: 'session', name: 'fresh' });
    await web.navigate(foreign.url);
    assert.equal(await web.getPage().evaluate(() => sessionStorage.getItem('tenant')), null);
    const frame = web.getPage().frames().find(frame => frame.url().startsWith(server.url));
    await frame.waitForLoadState('domcontentloaded');
    assert.equal(await frame.evaluate(() => sessionStorage.getItem('tenant')), null);
    await web.navigate(server.url + '/read');
    await expectAttribute(w, 'data-tenant', 'fixture-tenant');
    assert.equal(web.pendingSessionStorageRestore, null);
    await web.getPage().evaluate(() => sessionStorage.setItem('tenant', 'changed-after-restore'));
    await web.getPage().reload(); await expectAttribute(w, 'data-tenant', 'changed-after-restore');
    await web.getPage().evaluate(() => sessionStorage.clear());
    await web.getPage().reload(); await expectAttribute(w, 'data-tenant', 'missing');
  } finally { await web.shutdown(); await foreign.close(); await server.close(); }
});

test('a later session selection replaces a pending restore; legacy data can use configured baseUrl', async () => {
  const server = await serve(), config = configuration({ baseUrl: server.url }), web = new WebAdapter(config);
  try {
    await web.initialise();
    await web.injectStorage([], {}, undefined, { tenant: 'old-session' }, server.url);
    await web.injectStorage([], {}, undefined, { tenant: 'selected-session' });
    await web.navigate('/read');
    assert.equal(await web.getPage().getAttribute('#state', 'data-tenant'), 'selected-session');
  } finally { await web.shutdown(); await server.close(); }
});

async function runFlows(sources, server, extra = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-session-ci-'))), previous = process.cwd();
  try {
    process.chdir(directory); fs.mkdirSync('flows');
    for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join('flows', name), source);
    const config = configuration({ timeout: 450, projectRoot: directory, baseUrl: server.url,
      artifactsDir: path.join(directory, 'artifacts'), ...extra });
    const web = new WebAdapter(config), w = worker(config, web), orchestrator = new FlowOrchestrator(w, 1, config);
    const result = await runNativeCI(w, orchestrator, path.join(directory, 'flows'), config, 'fixture');
    return { result, junit: fs.readFileSync(path.join(directory, 'artifacts/junit.xml'), 'utf8'),
      saved: fs.existsSync('.flowstride/sessions/browser.json') ? JSON.parse(fs.readFileSync('.flowstride/sessions/browser.json')) : null };
  } finally { process.chdir(previous); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('actual DSL/CI round-trips a persisted browser session into a fresh browser file', async () => {
  const server = await serve();
  try {
    const { result, saved } = await runFlows({
      'setup.first.flow': `Feature: Save\nScenario: Save browser\nGiven "A seeded browser"\n flow.open "/seed";\nWhen "Save the browser"\n flow.save session "browser" persist;\nThen "Verify seed"\n flow.expect attribute "#state" "data-tenant" "fixture-tenant";`,
      'restore.flow': `Feature: Restore\nScenario: Restore browser\nGiven "A saved session"\n flow.use session "browser";\nWhen "Start the app"\n flow.open "/read";\nThen "Verify startup state"\n flow.expect attribute "#state" "data-tenant" "fixture-tenant";\n flow.expect attribute "#state" "data-theme" "dark";\n flow.expect attribute "#state" "data-cookie" contains "fixture_session=present";`,
    }, server);
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.equal(saved.storageOrigin, server.url);
    assert.deepEqual(saved.sessionStorage, { tenant: 'fixture-tenant', empty: '' });
  } finally { await server.close(); }
});

test('actual DSL/CI records a mismatching attribute as a failed run and JUnit failure', async () => {
  const server = await serve();
  try {
    const { result, junit } = await runFlows({ 'failure.flow': `Feature: Reject wrong attribute\nScenario: Real failure\nGiven "An application"\n flow.open "/read";\nWhen "The app is ready"\nThen "Wrong state must fail"\n flow.expect attribute "#state" "data-state" "approved";` }, server);
    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.metrics.failed, 1);
    assert.match(junit, /<failure/);
  } finally { await server.close(); }
});

const proSource = process.env.FLOWSTRIDE_PRO_SOURCE;
test('public CLI selects real Pro and executes the new session/attribute behavior through the OSS adapter', {
  skip: !proSource || require(path.join(root, 'package.json')).name !== 'flowstride', timeout: 30000,
}, async () => {
  const server = await serve((req, res) => {
    if (req.url.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      assert.equal(req.headers.authorization, 'Bearer fixture-hybrid-token');
      if (req.url === '/api/auth/verify-cli') return res.end(JSON.stringify({ tier: 'business', workspaceName: 'Fixture' }));
      if (req.url === '/api/workspace/status') return res.end(JSON.stringify({ workspace: { _id: 'fixture-workspace', plan: 'business' }, manifest: { maxWorkers: 2, features: [] } }));
      res.statusCode = 404; return res.end('{}');
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html(req.url));
  });
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-session-hybrid-')));
  try {
    fs.mkdirSync(path.join(directory, 'flows'));
    fs.mkdirSync(path.join(directory, 'node_modules/@flowstride'), { recursive: true });
    fs.symlinkSync(proSource, path.join(directory, 'node_modules/@flowstride/pro'), 'dir');
    fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}');
    fs.writeFileSync(path.join(directory, 'flowstride.config.json'), JSON.stringify({ baseUrl: server.url, timeout: 400, recordVideo: false }));
    fs.writeFileSync(path.join(directory, 'flows/setup.first.flow'), 'Feature: Save\nScenario: Seed\nGiven "Seed application"\n flow.open "/seed";\nWhen "Save"\n flow.save session "hybrid" persist;\nThen "Verify"\n flow.expect attribute "#state" "data-tenant" "fixture-tenant";');
    const flow = 'Feature: Restore\nScenario: Fresh browser\nGiven "Restore"\n flow.use session "hybrid";\nWhen "Start app"\n flow.open "/read";\nThen "Verify startup"\n flow.expect attribute "#state" "data-tenant" "fixture-tenant";';
    fs.writeFileSync(path.join(directory, 'flows/restore.flow'), flow);
    const execute = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', '--ci'], {
        cwd: directory, env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CI: 'true',
          FLOWSTRIDE_TOKEN: 'fixture-hybrid-token', FLOWSTRIDE_API_URL: server.url }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Hybrid CLI timed out')); }, 12000);
      child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
      child.on('error', reject); child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    const passed = await execute(); assert.equal(passed.code, 0, passed.output);
    let report = JSON.parse(fs.readFileSync(path.join(directory, 'flowstride-artifacts/summary.json')));
    assert.equal(report.engine, 'Enterprise (Pro)', passed.output); assert.equal(report.status, 'passed');
    fs.writeFileSync(path.join(directory, 'flows/restore.flow'), flow.replace('"data-tenant" "fixture-tenant"', '"data-tenant" "wrong-value"'));
    const failed = await execute(); assert.equal(failed.code, 1, failed.output);
    report = JSON.parse(fs.readFileSync(path.join(directory, 'flowstride-artifacts/summary.json')));
    assert.equal(report.engine, 'Enterprise (Pro)', failed.output); assert.equal(report.metrics.failed, 1);
  } finally { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
