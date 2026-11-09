const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { root, cloud, privateEngine, execute } = require('./batch5.fixtures.cjs');

const html = `<!doctype html><title>Jobs</title><h1>Jobs</h1>
<button id="run">Run browser jobs</button><output id="state">Not started</output>
<script>
document.querySelector('#run').onclick = async () => {
  const results = [];
  for (const operationName of ['Health', 'GetOrders', 'GetOrders']) {
    const started = performance.now();
    const response = await fetch('/job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName }) });
    results.push((await response.json()).source + (performance.now() - started >= 100 && results.length === 1 ? ' delayed' : ''));
  }
  document.querySelector('#state').textContent = results.join(' / ');
};
</script>`;

async function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch7-cli-')));
  const requests = [];
  const counts = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, cookie: req.headers.cookie, body: Buffer.concat(chunks).toString() });
    const json = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/api/auth/verify-cli') return json({ tier: 'business', workspaceName: 'Batch 7 fixture' });
    if (url.pathname === '/api/workspace/status') return json({ workspace: { _id: 'batch7-workspace' }, manifest: { maxWorkers: 2, features: [] } });
    if (url.pathname === '/stalled') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      return;
    }
    if (url.pathname === '/login') {
      res.setHeader('Set-Cookie', 'actor=administrator; Path=/; HttpOnly');
      return json({ login: true });
    }
    if (url.pathname === '/job' && req.method === 'GET') {
      const key = url.searchParams.get('key');
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return json({ status: count % 2 ? 'pending' : 'completed', actor: req.headers.cookie ?? 'anonymous' });
    }
    if (url.pathname === '/job' && req.method === 'POST') return json({ source: 'origin' });
    if (url.pathname === '/retry') {
      const key = url.searchParams.get('row');
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return json({ actor: req.headers.cookie ?? 'anonymous' }, count === 1 ? 503 : 200);
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(html);
    }
    json({ unknown: true }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const config = extra => write('flowstride.config.json', { baseUrl: url, timeout: 3500, recordVideo: false, security: { evidence: { screenshots: false } }, ...extra });
  config();
  write('.flowstride/credentials.json', {});
  write('schemas/job.json', { type: 'object', required: ['status', 'actor'], properties: { status: { const: 'completed' }, actor: { const: 'actor=administrator' } } });
  write('schemas/wrong.json', { type: 'object', properties: { status: { type: 'boolean' } } });
  return { dir, url, write, config, requests, summary: () => JSON.parse(fs.readFileSync(path.join(dir, 'flowstride-artifacts/summary.json'))) };
}

function useCloud(f, older = false) {
  const target = path.join(f.dir, 'node_modules/@flowstride/pro');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!older) fs.symlinkSync(cloud, target, 'dir');
  else {
    fs.mkdirSync(path.join(target, 'dist/runner'), { recursive: true });
    for (const [file, member] of [['flow_worker', 'FlowWorker'], ['flow_orchestrator', 'FlowOrchestrator']]) {
      f.write(`node_modules/@flowstride/pro/dist/runner/${file}.js`,
        `module.exports = require(${JSON.stringify(path.join(cloud, 'dist/runner', file + '.js'))}); module.exports.${member}.nativeApiProtocol = undefined;`);
    }
  }
  f.write('.flowstride/credentials.json', { machineToken: 'batch7-license-fixture', workspaceId: 'batch7-workspace' });
}

const passing = `Feature: Connect API and browser work
Scenario: Poll and verify a browser route
Given "Sign in to an isolated API context"
flow.api.create {"name":"administrator","cookies":true};
flow.api.use {"name":"administrator"};
flow.api.request {"method":"POST","url":"/login","json":{"flow":"fixture"}};
When "Read a typed job result"
flow.api.poll {"url":"/job","query":{"key":"contract"},"path":"status","equals":"completed","interval":50};
flow.extract resBody "actor" as "actor";
And "Check the response contract"
flow.api.expectSchema {"file":"schemas/job.json"};
When "Open the local UI and route one matching request"
flow.open "/";
flow.network.route {"name":"orders","url":"**/job","method":"POST","requestBody":{"path":"operationName","equals":"GetOrders"},"mode":"fulfill","json":{"source":"fixture"},"times":1,"delay":180};
flow.click button "Run browser jobs";
Then "Check the route and the original API context"
flow.expect visible "origin / fixture delayed / origin";
flow.assert.value {"actual":"@actor","operator":"equals","expected":"actor=administrator"};
`;

for (const mode of ['direct', 'handoff']) {
  test(`Batch 7 ${mode} CLI executes API, schema, polling and a real delayed browser route`, {
    skip: mode === 'handoff' && (privateEngine || !cloud), timeout: 45000,
  }, async t => {
    const f = await fixture(t);
    if (mode === 'handoff') useCloud(f);
    f.write('flows/jobs.flow', passing);
    const result = await execute(f);
    assert.equal(result.code, 0, result.output);
    const summary = f.summary();
    assert.equal(summary.status, 'passed');
    if (mode === 'handoff') assert.equal(summary.engine, 'Enterprise (Pro)');
    assert(summary.browsers.every(item => item.headless));
    assert.equal(f.requests.filter(req => req.url.startsWith('/job?') && req.method === 'GET' && req.cookie === 'actor=administrator').length, 2);
    assert.equal(f.requests.filter(req => req.url === '/job' && req.method === 'POST').length, 2);
    assert(!f.requests.some(req => req.url === '/job' && req.method === 'POST' && req.cookie));
  });
}

test('Batch 7 schema failure records the rule and exact path in CI while soft assertions continue', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.write('flows/failure.flow', passing.replace('flow.api.expectSchema {"file":"schemas/job.json"};', 'flow.soft api.expectSchema {"file":"schemas/wrong.json"};'));
  const result = await execute(f);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /JSON Schema rule "type" failed at \/status/);
  const summary = f.summary();
  assert.equal(summary.status, 'failed');
  assert.equal(summary.metrics.failed, 1);
  assert(summary.steps.some(step => step.assertion?.command === 'api.expectSchema' && step.assertion.status === 'failed'));
  assert(summary.steps.some(step => step.status === 'passed' && /Check the route/.test(JSON.stringify(step))));
});

test('Batch 7 dataset rows and retried attempts start from their own API context state', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.config({ retries: 1 });
  f.write('fixtures/rows.json', [{ id: 'first' }, { id: 'second' }]);
  f.write('flows/rows.flow', `Feature: Isolate named API contexts
Scenario: Repeat independently
Given "Load each row"
flow.data.cases {"file":"fixtures/rows.json"};
flow.api.create {"name":"shared","cookies":true};
flow.api.use {"name":"shared"};
When "Verify the session is clean at the start of an attempt"
flow.api.request {"url":"/retry","query":{"row":"@case.id"}};
flow.extract resBody "actor" as "actor";
flow.assert.value {"actual":"@actor","operator":"equals","expected":"anonymous"};
flow.expect status "200";
When "Set a cookie after the retry succeeds"
flow.api.request {"method":"POST","url":"/login"};
Then "Verify the session response"
flow.expect status "200";
`);
  const result = await execute(f);
  assert.equal(result.code, 0, result.output);
  const summary = f.summary();
  assert.equal(summary.status, 'passed');
  assert.equal(summary.attempts.length, 4);
  assert.equal(f.requests.filter(req => req.url.startsWith('/retry?')).length, 4);
  assert(!f.requests.some(req => req.url.startsWith('/retry?') && req.cookie));
});

test('Batch 7 nested fragment falls back from an older installed Cloud engine', {
  skip: privateEngine || !cloud, timeout: 45000,
}, async t => {
  const f = await fixture(t);
  useCloud(f, true);
  f.write('steps/login.flowpart', 'flow.api.request {"method":"POST","url":"/login"};');
  f.write('flows/jobs.flow', `Feature: Old Cloud compatibility
Scenario: Run the selected engine
Given "Load a fragment"
flow.call "steps/login.flowpart";
When "Read its response"
flow.extract resBody "login" as "loggedIn";
Then "Check the response"
flow.assert.value {"actual":"@loggedIn","operator":"equals","expected":true};
`);
  const result = await execute(f);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /API or network route capabilities/);
  assert.equal(f.summary().engine, 'Open Source');
});

test('Batch 7 parallel Cloud workers isolate identically named contexts per flow file', {
  skip: !privateEngine && !cloud, timeout: 45000,
}, async t => {
  const f = await fixture(t);
  if (!privateEngine) useCloud(f);
  const source = key => `Feature: Separate API workers
Scenario: Use an independent named context
Given "Create an isolated context"
flow.api.create {"name":"shared","cookies":true};
flow.api.use {"name":"shared"};
When "Poll a job without any cookie"
flow.api.poll {"url":"/job","query":{"key":"${key}"},"path":"status","equals":"completed","interval":50};
flow.extract resBody "actor" as "actor";
Then "Verify anonymous state before login"
flow.assert.value {"actual":"@actor","operator":"equals","expected":"anonymous"};
flow.api.request {"method":"POST","url":"/login"};
`;
  f.write('flows/first.flow', source('one'));
  f.write('flows/second.flow', source('two'));
  const result = await execute(f, ['--workers', '2']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Distributing 2 files to 2 workers/);
  assert.equal(f.summary().status, 'passed');
  const calls = f.requests.filter(req => req.url.startsWith('/job?'));
  assert.equal(calls.length, 4);
  assert(calls.every(req => !req.cookie));
});

test('Batch 7 CLI cancellation aborts a stalled poll and retains interrupted evidence', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.write('flows/stalled.flow', `Feature: Cancel a bounded API read
Scenario: Stop an in-progress HTTP response
Given "Prepare"
When "Wait for the stalled job"
flow.api.poll {"url":"/stalled","path":"status","equals":"completed","timeout":30000};
Then "This call must never run"
flow.api.request {"url":"/must-not-run"};
`);
  const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', 'flows', '--ci'], {
    cwd: f.dir,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CI: 'true', FLOWSTRIDE_TOKEN: '', FLOWSTRIDE_API_URL: f.url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const start = Date.now();
  while (!f.requests.some(req => req.url === '/stalled')) {
    assert(Date.now() - start < 20000, output);
    await sleep(20);
  }
  child.kill('SIGTERM');
  assert.equal(await exited, 130, output);
  assert.equal(f.summary().status, 'interrupted');
  assert.equal(f.requests.filter(req => req.url === '/stalled').length, 1);
  assert(!f.requests.some(req => req.url === '/must-not-run'));
});
