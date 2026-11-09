const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { WebSocketServer } = require('ws');
const { root, cloud, privateEngine, execute } = require('./batch5.fixtures.cjs');

const page = `<!doctype html><meta charset="utf-8"><title>Application events</title>
<style>
#summary { width: 300px; height: 140px; background: white; color: black; border: 5px solid #202020; padding: 12px; font: 16px sans-serif; }
#summary.changed { background: #d52929; }
[data-private] { width: 160px; height: 28px; }
</style>
<h1>Application event fixture</h1>
<div role="group" aria-label="Checkout">
  <div id="summary" aria-label="Order summary">Order summary
    <div data-private aria-label="Session reference">Session reference <span>private-value-first</span></div>
  </div>
</div>
<button id="change">Change appearance</button>
<button id="private">Change private value</button>
<button id="throw">Raise expected error</button>
<button id="duplicate">Raise duplicate error</button>
<button id="streams">Open connections</button>
<output id="status">Waiting</output>
<script>
document.querySelector('#change').onclick = () => document.querySelector('#summary').classList.add('changed');
document.querySelector('#private').onclick = () => document.querySelector('[data-private] span').textContent = 'private-value-second';
document.querySelector('#throw').onclick = () => { throw new Error('Expected fixture error'); };
document.querySelector('#duplicate').onclick = () => {
  setTimeout(() => { throw new Error('Expected fixture error'); }, 0);
  setTimeout(() => { throw new Error('Expected fixture error'); }, 0);
  setTimeout(() => { throw new Error('Unrelated application error'); }, 0);
};
let ready = 0;
const record = () => { if (++ready === 3) document.querySelector('#status').textContent = 'All channels received'; };
function startStreams() {
  console.info('Application channels starting');
  const socket = new WebSocket('ws://' + location.host + '/updates/socket');
  socket.addEventListener('open', () => socket.send(JSON.stringify({ request: 'order.watch' })));
  socket.addEventListener('message', e => { if (typeof e.data === 'string' && JSON.parse(e.data).event === 'order.updated') record(); });
  const stream = new EventSource('/updates/stream');
  stream.onmessage = e => { if (stream instanceof EventSource && JSON.parse(e.data).event === 'order.updated') record(); };
  stream.addEventListener('order-status', e => {
    if (JSON.parse(e.data).state === 'delivered') record();
    stream.close();
  });
}
document.querySelector('#streams').onclick = startStreams;
if (new URL(location.href).searchParams.has('initial')) startStreams();
</script>`;

async function fixture(t, browser = 'chromium') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch8-cli-')));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url.startsWith('/updates/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: {"event":"unrelated","active":"false"}\n\n');
      res.write('data: {"event":"order.updated","active":false,"opaque":"private-SSE-frame-8"}\n\n');
      res.write('event: order-status\ndata: {"state":"delivered"}\n\n');
      return;
    }
    if (req.url === '/api/auth/verify-cli' || req.url === '/api/workspace/status') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ tier: 'business', workspaceName: 'Batch 8 fixture', workspace: { _id: 'batch8' }, manifest: { maxWorkers: 2, features: [] } }));
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(page);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/updates/socket') return socket.destroy();
    requests.push(req.url);
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on('message', () => {
        ws.send(Buffer.from([0, 1, 2]));
        ws.send('{"event":"unrelated"}');
        ws.send('{"event":"order.updated","active":false,"opaque":"private-WebSocket-frame-8"}');
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const write = (name, data) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  };
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  write('flowstride.config.json', {
    baseUrl: url, browser, timeout: 5000, recordVideo: false, security: { evidence: { screenshots: false } },
  });
  write('.flowstride/credentials.json', {});
  return { dir, url, requests, write, summary: () => JSON.parse(fs.readFileSync(path.join(dir, 'flowstride-artifacts/summary.json'))) };
}

const channels = `Feature: Application events through the browser
Scenario: Observe initial WebSocket and EventSource events
Given "Arm before navigation creates the streams"
flow.console.arm {"name":"starting","level":"info","contains":"Application channels starting"};
flow.channel.arm {"name":"orders","protocol":"websocket","url":"**/updates/socket"};
flow.channel.arm {"name":"outbound","protocol":"websocket","url":"**/updates/socket","direction":"sent"};
flow.channel.arm {"name":"stream","protocol":"sse","url":"**/updates/stream"};
flow.channel.arm {"name":"status","protocol":"sse","url":"**/updates/stream","event":"order-status"};
When "Open the application"
flow.open "/?initial=1";
And "Inspect the application messages"
flow.console.expect {"name":"starting"};
flow.channel.expect {"name":"orders","path":"active","equals":false};
flow.channel.expect {"name":"outbound","path":"request","equals":"order.watch"};
flow.channel.expect {"name":"stream","path":"event","equals":"order.updated"};
flow.channel.expect {"name":"status","path":"state","equals":"delivered"};
Then "The browser consumed the same messages"
flow.expect visible "All channels received";
`;

for (const browser of ['chromium', 'firefox', 'webkit']) {
  test(`Batch 8 ${browser}: real browser WebSocket and SSE messages before assertion, including named SSE events`, { timeout: 45000 }, async t => {
    const f = await fixture(t, browser);
    f.write('flows/channels.flow', channels);
    const result = await execute(f);
    assert.equal(result.code, 0, result.output);
    assert.equal(f.summary().status, 'passed');
    assert(f.summary().browsers.every(item => item.engine === browser && item.headless));
    assert.equal(f.requests.filter(url => url === '/updates/stream').length, 1, 'Two observers must use the same EventSource connection');
    assert.equal(f.requests.filter(url => url === '/updates/socket').length, 1);
    assert(!/private-(?:WebSocket|SSE)-frame-8/.test(result.output + JSON.stringify(f.summary())));
  });
}

test('Batch 8 real uncaught error is acknowledged once and unrelated browser errors still fail CI', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  const source = trigger => `Feature: Expected application errors
Scenario: Deliberately trigger one known browser error
Given "Watch for a known exception"
flow.open "/";
flow.console.arm {"name":"expected","level":"pageerror","contains":"Expected fixture error"};
When "Trigger the exception"
flow.click button "${trigger}";
And "Check the browser error"
flow.console.expect {"name":"expected"};
Then "The application is still visible"
flow.expect visible "Application event fixture";
`;
  f.write('flows/errors.flow', source('Raise expected error'));
  let result = await execute(f);
  assert.equal(result.code, 0, result.output);
  assert.equal(f.summary().status, 'passed');
  assert(!/Failed command: flow.browser.pageError/.test(result.output));
  f.write('flows/errors.flow', source('Raise duplicate error'));
  result = await execute(f);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Unrelated application error/);
  const errors = f.summary().attempts[0].browserErrors;
  if (errors) assert.equal(errors.filter(text => text === 'Expected fixture error').length, 1);
  assert.match(result.output, /Reason: Expected fixture error/);
});

const visualTarget = '"target":{"text":"Order summary","element":"div","inside":"Checkout"}';
const visualMask = '"mask":["Session reference"]';

test('Batch 8 visual baselines use readable scoped targets, hide masked content and write private difference evidence', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  const source = (when, then) => `Feature: Compare an approved visual reference
Scenario: Compare a readable target
Given "Open the checkout"
flow.open "/";
When "Prepare the visual state"
${when}
Then "Inspect the checkout summary"
${then}
`;
  f.write('flows/visual.flow', source('flow.expect visible "Order summary";', `flow.visual.capture {"name":"approved",${visualTarget},${visualMask}};`));
  let result = await execute(f);
  assert.equal(result.code, 0, result.output);
  const visual = path.join(f.dir, '.flowstride/visual');
  const candidate = fs.readdirSync(visual).find(name => name.endsWith('-approved-candidate.png'));
  assert(candidate);
  const baseline = path.join(f.dir, 'baselines/summary.png');
  fs.mkdirSync(path.dirname(baseline));
  fs.copyFileSync(path.join(visual, candidate), baseline);
  const approved = fs.readFileSync(baseline);
  const match = `flow.visual.match {"baseline":"baselines/summary.png",${visualTarget},${visualMask},"maxDiffRatio":0};`;
  f.write('flows/visual.flow', source('flow.click button "Change private value";', match));
  result = await execute(f);
  assert.equal(result.code, 0, result.output);
  assert.equal(f.summary().status, 'passed');
  assert.equal(fs.readdirSync(visual).length, 1);
  f.write('flows/visual.flow', source('flow.click button "Change appearance";', match));
  result = await execute(f);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Visual difference was above/);
  assert.match(result.output, /-diff\.png/);
  assert.deepEqual(fs.readFileSync(baseline), approved);
  const evidence = fs.readdirSync(visual).filter(name => /-(actual|diff)\.png$/.test(name));
  assert.equal(evidence.length, 2);
  if (process.platform !== 'win32') for (const file of evidence) assert.equal(fs.statSync(path.join(visual, file)).mode & 0o777, 0o600);
  const report = f.summary().steps.find(step => step.assertion?.command === 'visual.match');
  assert.equal(report.assertion.status, 'failed');
  assert(report.assertion.checks.some(check => check.key === 'pixels' && check.status === 'failed'));

  f.write('flows/visual.flow', source('flow.click button "Change appearance";', match.replace(visualMask, '"mask":[{"selector":"#not-present"}]')));
  result = await execute(f);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Visual mask 1 matched no visible element/);
  assert.equal(fs.readdirSync(visual).length, 3);
});

test('Batch 8 channel timeout is explicit, soft continuation stays failed and does not log payloads', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.write('flows/timeout.flow', channels.replace(
    'flow.channel.expect {"name":"orders","path":"active","equals":false};',
    'flow.soft channel.expect {"name":"orders","path":"event","equals":"missing-update","timeout":200};',
  ));
  const result = await execute(f);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Channel expectation timed out/);
  const summary = f.summary();
  assert.equal(summary.metrics.failed, 1);
  assert(summary.steps.some(step => step.status === 'passed' && /browser consumed/.test(JSON.stringify(step))));
  assert(!/private-(?:WebSocket|SSE)-frame-8/.test(result.output + JSON.stringify(summary)));
});

test('Batch 8 stops an armed channel wait on CLI cancellation', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.write('flows/cancel.flow', channels.replace(
    'flow.channel.expect {"name":"orders","path":"active","equals":false};',
    'flow.channel.expect {"name":"orders","contains":"never-delivered","timeout":30000};',
  ));
  const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', 'flows', '--ci'], {
    cwd: f.dir, env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CI: 'true', FLOWSTRIDE_TOKEN: '', FLOWSTRIDE_API_URL: f.url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const until = Date.now() + 20000;
  while (!f.requests.includes('/updates/socket')) {
    assert(Date.now() < until, output);
    await sleep(20);
  }
  await sleep(100);
  child.kill('SIGTERM');
  assert.equal(await exited, 130, output);
  assert.equal(f.summary().status, 'interrupted');
});

for (const mode of ['handoff','fallback']) {
  test(`Batch 8 ${mode} works through an installed Cloud engine and nested fragments`, {
    skip: privateEngine || !cloud, timeout: 45000,
  }, async t => {
    const f = await fixture(t);
    const installed = path.join(f.dir, 'node_modules/@flowstride/pro');
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    if (mode === 'handoff') fs.symlinkSync(cloud, installed, 'dir');
    else for (const [name, type] of [['flow_worker','FlowWorker'], ['flow_orchestrator','FlowOrchestrator']]) {
      f.write(`node_modules/@flowstride/pro/dist/runner/${name}.js`,
        `module.exports = require(${JSON.stringify(path.join(cloud, 'dist/runner', name + '.js'))}); module.exports.${type}.nativeApplicationEvidenceProtocol = undefined;`);
    }
    f.write('.flowstride/credentials.json', { machineToken: 'batch8-token-fixture', workspaceId: 'batch8' });
    f.write('steps/expect.flowpart', `flow.console.arm {"name":"exception","level":"pageerror","contains":"Expected fixture error"};
flow.click button "Raise expected error";
flow.console.expect {"name":"exception"};`);
    f.write('flows/channels.flow', `Feature: Compatibility for a nested native command
Scenario: Use shared expected-error steps
Given "Open the application"
flow.open "/";
When "Run shared commands"
flow.call "steps/expect.flowpart";
Then "The app still responds"
flow.expect visible "Application event fixture";`);
    const result = await execute(f);
    assert.equal(result.code, 0, result.output);
    assert.equal(f.summary().engine, mode === 'handoff' ? 'Enterprise (Pro)' : 'Open Source');
    if (mode === 'fallback') assert.match(result.output, /console, channel or visual capabilities/);
  });
}

test('Batch 8 parallel Cloud files observe separate tabs and can arm SSE on an already-open page', {
  skip: !privateEngine && !cloud, timeout: 45000,
}, async t => {
  const f = await fixture(t);
  if (!privateEngine) {
    const installed = path.join(f.dir, 'node_modules/@flowstride/pro');
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.symlinkSync(cloud, installed, 'dir');
    f.write('.flowstride/credentials.json', { machineToken: 'batch8-token-fixture', workspaceId: 'batch8' });
  }
  const afterNavigation = channels
    .replace('Given "Arm before navigation creates the streams"', 'Given "Open the page, then arm before clicking"\nflow.open "/";')
    .replace('flow.open "/?initial=1";', 'flow.click button "Open connections";');
  f.write('flows/first.flow', afterNavigation);
  f.write('flows/second.flow', afterNavigation);
  const result = await execute(f, ['--workers', '2']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Distributing 2 files to 2 workers/);
  assert.equal(f.requests.filter(url => url === '/updates/stream').length, 2);
  assert.equal(f.requests.filter(url => url === '/updates/socket').length, 2);
  assert.equal(f.summary().status, 'passed');
});

test('Batch 8 full-page comparisons use an explicit candidate and report dimension mismatches', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  const source = command => `Feature: Verify a full-page screenshot
Scenario: Compare a whole page
Given "Open the application"
flow.open "/";
When "The fixture is ready"
flow.expect visible "Application event fixture";
Then "Check the page appearance"
${command}
`;
  f.write('flows/page.flow', source('flow.visual.capture {"name":"whole-page","fullPage":true,"mask":[{"selector":"[data-private]"}]};'));
  let result = await execute(f);
  assert.equal(result.code, 0, result.output);
  const visual = path.join(f.dir, '.flowstride/visual');
  const candidate = fs.readdirSync(visual).find(name => name.endsWith('-whole-page-candidate.png'));
  assert(candidate);
  const approved = path.join(f.dir, 'baselines/whole-page.png');
  fs.mkdirSync(path.dirname(approved));
  fs.copyFileSync(path.join(visual, candidate), approved);
  const comparison = 'flow.visual.match {"baseline":"baselines/whole-page.png","fullPage":true,"mask":[{"selector":"[data-private]"}]};';
  f.write('flows/page.flow', source(comparison));
  result = await execute(f);
  assert.equal(result.code, 0, result.output);
  const { PNG } = require(require.resolve('pngjs', { paths: [root] }));
  fs.writeFileSync(approved, PNG.sync.write(new PNG({ width: 1, height: 1 })));
  result = await execute(f);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Visual dimensions differ/);
  assert.match(result.output, /Expected: 1 × 1 px/);
  assert(fs.readdirSync(visual).some(name => name.endsWith('-diff.png')));
});
