const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { WebAdapter } = require('../../dist/adapters/web/playwright');
const { FlowWorker } = require('../../dist/runner/flow_worker');
const { FlowOrchestrator } = require('../../dist/runner/flow_orchestrator');
const { ApiAdapter } = require('../../dist/adapters/api/undici');
const { TemporaryStore } = require('../../dist/runner/temporary_store');
const { SessionManager } = require('../../dist/sessions/manager');
const { PersistentVault } = require('../../dist/runner/persistent_vault');
const root = path.resolve(__dirname, '../..');
const privateEngine = require('../../package.json').name === '@flowstride/pro';
const cloud = process.env.FLOWSTRIDE_PRO_SOURCE;
const engines = ['chromium', 'firefox', 'webkit'];
const browserCache = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/server/registry/index.js')).registryDirectory;

async function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-browser-')));
  const agents = [];
  fs.mkdirSync(path.join(directory, 'flows'));
  const server = http.createServer((req, res) => {
    agents.push(req.headers['user-agent']);
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><title>Browser fixture</title></head><body><h1>Ready</h1><button onclick="this.textContent=\'Clicked\'">Mark</button></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(directory, 'flows/browser.flow'), `Feature: Existing commands\nScenario: Browser selection\nGiven "Open fixture"\n flow.open "${url}"\nWhen "Interact"\n flow.click button "Mark"\nThen "Verify"\n flow.expect visible "Clicked"\n`);
  return { directory, url, agents, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); } };
}
function run(args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', 'flows', '--ci', ...args], {
      cwd, env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), HOME: cwd, PLAYWRIGHT_BROWSERS_PATH: browserCache, CI: 'true', FLOWSTRIDE_TOKEN: '', ...env }
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI timeout: ' + output)); }, 40000);
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); resolve({ code, output }); });
  });
}
function assertAgent(engine, agent) {
  if (engine === 'firefox') { assert.match(agent, /Firefox\//); assert.doesNotMatch(agent, /Chrome\//); }
  if (engine === 'webkit') { assert.match(agent, /AppleWebKit\//); assert.doesNotMatch(agent, /Chrome\/|Firefox\//); }
}

for (const browser of engines) test(`actual ${browser} identity survives desktop, phone and explicit overrides`, async () => {
  const f = await fixture();
  try {
    for (const device of ['desktop', 'phone', 'landscape']) {
      const web = new WebAdapter({ browser, device, projectRoot: f.directory, timeout: 5000, headless: true, ci: true, recordVideo: false });
      try {
        await web.initialise(); await web.navigate(f.url);
        assert.equal(web.getBrowserInfo().engine, browser);
        assert.equal(web.getPage().context().browser().browserType().name(), browser);
        assert.equal(web.getBrowserInfo().headless, true);
        assertAgent(browser, await web.getPage().evaluate(() => navigator.userAgent));
        assertAgent(browser, f.agents.at(-1));
      } finally { await web.shutdown(); }
    }
    const web = new WebAdapter({ browser, projectRoot: f.directory, timeout: 5000, headless: true, ci: true, recordVideo: false, browserOptions: { userAgent: 'Flowstride explicit fixture' } });
    try { await web.initialise(); assert.equal(await web.getPage().evaluate(() => navigator.userAgent), 'Flowstride explicit fixture'); }
    finally { await web.shutdown(); }
  } finally { await f.close(); }
});

const modes = privateEngine ? ['direct', 'parallel'] : ['direct', 'handoff', 'broken', 'older'];
for (const mode of modes) for (const browser of engines) test(`CLI selects real ${browser} through ${mode}`, { skip: mode === 'handoff' && !cloud }, async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.directory, 'flowstride.config.json'), JSON.stringify({ browser: browser === 'webkit' ? 'firefox' : 'webkit', recordVideo: false, timeout: 5000, ...(mode === 'older' ? { trace: true } : {}) }));
    const env = {};
    if (mode === 'parallel') fs.copyFileSync(path.join(f.directory, 'flows/browser.flow'), path.join(f.directory, 'flows/second.flow'));
    if (['handoff', 'broken', 'older'].includes(mode)) {
      const engine = path.join(f.directory, 'node_modules/@flowstride/pro');
      fs.mkdirSync(path.dirname(engine), { recursive: true });
      if (mode === 'handoff') fs.symlinkSync(cloud, engine, 'dir');
      else {
        fs.mkdirSync(path.join(engine, 'dist/runner'), { recursive: true });
        fs.writeFileSync(path.join(engine, 'dist/runner/flow_worker.js'), mode === 'older'
          ? 'exports.FlowWorker=class {static nativeBrowserProtocol=1;constructor(){throw new Error("Old worker must not run")}}'
          : 'throw new Error("Fixture broken engine")');
        fs.writeFileSync(path.join(engine, 'dist/runner/flow_orchestrator.js'), 'exports.FlowOrchestrator=class {static nativeCIProtocol=1;static nativeBrowserProtocol=1;}');
      }
      const preload = path.join(f.directory, 'auth.cjs');
      fs.writeFileSync(preload, `const original=fetch;global.fetch=async(url,...args)=>String(url).endsWith('/api/auth/verify-cli')?Response.json({tier:'business',workspaceName:'Fixture'}):String(url).endsWith('/api/workspace/status')?Response.json({workspace:{_id:'fixture'},manifest:{maxWorkers:2,features:[]}}):original(url,...args);`);
      env.NODE_OPTIONS = '--require=' + preload; env.FLOWSTRIDE_TOKEN = 'owned-fixture-token';
    }
    const result = await run(['--browser', browser, ...(mode === 'parallel' ? ['--workers', '2'] : [])], f.directory, env);
    assert.equal(result.code, 0, result.output);
    const report = JSON.parse(fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/summary.json')));
    assert.equal(report.status, 'passed', result.output);
    assert.equal(report.browser, browser);
    assert.equal(report.browsers.length, mode === 'parallel' ? 2 : 1);
    assert(report.browsers.every(info => info.engine === browser && info.version && info.headless));
    assert.match(result.output, new RegExp(`\\[Browser\\]: ${browser} `));
    assertAgent(browser, f.agents[0]);
    assert.equal(report.engine, privateEngine || mode === 'handoff' ? 'Enterprise (Pro)' : 'Open Source');
    if (mode === 'older' && browser !== 'chromium') assert.match(result.output, /does not support these native browser capabilities/);
  } finally { await f.close(); }
});

// This covers the ordinary interactive command path, including the real UI's
// WebSocket handshake. Linux CI needs a virtual display for headed browsers.
for (const browser of ['firefox', 'webkit']) for (const headless of [true, false]) test(`interactive dashboard and ${headless ? 'headless' : 'headed'} test both use ${browser} with verified badge`, {
  skip: process.platform === 'linux' && !process.env.DISPLAY
}, async () => {
  const f = await fixture(); const saved = {};
  for (const key of ['CI', 'GITHUB_ACTIONS', 'FLOWSTRIDE_API_KEY', 'FLOWSTRIDE_NATIVE_CI']) { saved[key] = process.env[key]; delete process.env[key]; }
  const config = { browser, timeout: 5000, headless, ci: false, recordVideo: false, projectRoot: f.directory, artifactsDir: path.join(f.directory, 'evidence') };
  const web = new WebAdapter(config), api = new ApiAdapter(config), store = new TemporaryStore();
  const worker = new FlowWorker(config, web, api, store, new SessionManager(web, api, new PersistentVault(f.directory)));
  const orchestrator = new FlowOrchestrator(worker, 1, config);
  const beforeSignals = new Set(process.listeners('SIGINT'));
  const browserEvents = []; worker.on('worker_event', event => { if (event.type === 'BROWSER_INFO') browserEvents.push(event.payload); });
  try {
    assert.equal(await orchestrator.start(path.join(f.directory, 'flows')), true);
    const dashboard = orchestrator.dashboardBrowser.browser;
    assert.equal(dashboard.browserType().name(), browser);
    assert.equal(browserEvents.length, 1); assert.equal(browserEvents[0].engine, browser); assert.equal(browserEvents[0].headless, headless);
    const page = dashboard.contexts()[0].pages()[0];
    page.setDefaultTimeout(6000);
    const badge = page.getByTestId('test-browser');
    await badge.waitFor(); assert.match(await badge.textContent(), new RegExp(`${browser === 'firefox' ? 'Firefox' : 'WebKit'}.*${headless ? 'Headless' : 'Headed'}`));
    if (process.env.FLOWSTRIDE_BROWSER_EVIDENCE) { fs.mkdirSync(process.env.FLOWSTRIDE_BROWSER_EVIDENCE, { recursive: true }); await page.screenshot({ path: path.join(process.env.FLOWSTRIDE_BROWSER_EVIDENCE, `${privateEngine ? 'cloud' : 'os'}-${browser}-${headless ? 'headless' : 'headed'}.png`) }); }
    assertAgent(browser, f.agents[0]);
    // Reconnect receives the last verified identity without replaying a suite.
    await page.reload(); await badge.waitFor();
    assert.match(await badge.textContent(), browser === 'firefox' ? /Firefox/ : /WebKit/);
  } finally {
    await worker.shutdown(); await orchestrator.close(); await f.close();
    for (const listener of process.listeners('SIGINT')) if (!beforeSignals.has(listener)) process.off('SIGINT', listener);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
