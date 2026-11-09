const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { root, cloud, privateEngine, execute, prepare } = require('./batch5.fixtures.cjs');

async function fixture(t, browser = 'chromium') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch6-cli-')));
  for (const name of ['flows', 'steps', 'fixtures', '.flowstride']) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, '.flowstride/credentials.json'), '{}');
  const visits = [];
  let created = 0;
  let checks = 0;
  const server = http.createServer((req, res) => {
    visits.push([req.method, req.url]);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };
    if (req.url === '/api/auth/verify-cli') send(200, { tier: 'business', workspaceName: 'Batch6' });
    else if (req.url === '/api/workspace/status') send(200, { workspace: { _id: 'fixture-batch5-workspace' }, manifest: { maxWorkers: 2, features: [] } });
    else if (req.url === '/create') send(201, { id: `resource-${++created}` });
    else if (req.url === '/transient') send(++checks === 1 ? 503 : 200, {});
    else if (req.method === 'DELETE') send(req.url === '/cleanup-fails' ? 500 : 200, { private: 'cleanup-response-must-not-leak' });
    else if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>Customer workspace</h1><label>Customer name<input></label>');
    else send(200, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const config = (extra = {}) => fs.writeFileSync(path.join(dir, 'flowstride.config.json'), JSON.stringify({
    baseUrl: url, browser, timeout: 1200, recordVideo: false,
    security: { evidence: { screenshots: false } }, ...extra,
  }));
  config();
  return {
    dir, url, visits, config,
    write: (source, name = 'main.flow') => fs.writeFileSync(path.join(dir, 'flows', name), source),
    fragment: (name, source) => fs.writeFileSync(path.join(dir, 'steps', name + '.flowpart'), source),
    summary: () => JSON.parse(fs.readFileSync(path.join(dir, 'flowstride-artifacts/summary.json'), 'utf8')),
    junit: () => fs.readFileSync(path.join(dir, 'flowstride-artifacts/junit.xml'), 'utf8'),
  };
}

const normal = `Feature: Workflow reuse
Scenario: Selected customer workflow
Tags: Smoke
Given "Open the application"
  flow.open "/";
When "Reuse customer actions"
  flow.call "steps/customer.flowpart";
And "Reuse an assertion"
  flow.call "steps/check.flowpart";
Then "Check the workspace"
  flow.expect visible "Customer workspace";
`;
const skipped = `Feature: Capability skip
Scenario: Work requiring a different browser
Tags: conditional
Given "Check the prerequisite"
  flow.data.cases {"file":"fixtures/absent.csv"};
  flow.skipIf {"browser":"webkit","reason":"Requires microphone injection"};
  flow.injectAudio "fixtures/unavailable.wav";
When "An unavailable dependency must not be read"
  flow.call "steps/absent.flowpart";
Then "Nothing ran"
  flow.expect status "201";
`;
const withCleanup = (ending, second = '') => `Feature: Registered cleanup
Scenario: Remove created customer
Given "Create a resource"
  flow.post "/create";
  flow.extract resBody "id" as "newUserId";
  flow.cleanup.register {"method":"DELETE","url":"/remove/@newUserId"};
  ${second}
When "Exercise the resource"
  ${ending}
Then "Finish"
  flow.expect status "200";
`;
function fragments(f) {
  f.fragment('customer', 'flow.type input "Customer name" "Lagos";\nflow.call "steps/check.flowpart";');
  f.fragment('check', 'flow.expect visible "Customer workspace";');
}
for (const browser of ['chromium', 'firefox', 'webkit']) {
  test(`Batch6 ${browser}: nested reusable commands run through tag selection and keep source locations`, { timeout: 45000 }, async t => {
    const f = await fixture(t, browser);
    fragments(f);
    f.write(normal);
    f.write(skipped, 'excluded.flow');
    const result = await execute(f, ['--tag', 'sMoKe', '--tag', 'extra']);
    assert.equal(result.code, 0, result.output);
    const report = f.summary();
    assert.equal(report.status, 'passed');
    assert.equal(report.metrics.total, 5);
    assert.deepEqual(report.files, ['main.flow']);
    assert(report.browsers.every(item => item.engine === browser && item.headless));
    assert.equal(report.steps.filter(item => item.sourceFile === 'steps/check.flowpart').length, 2);
  });
}

test('Batch6 all-skipped suite records its reason and starts neither browsers nor application calls', async t => {
  const f = await fixture(t, 'webkit');
  f.write(skipped);
  const result = await execute(f, ['--tag', 'conditional']);
  assert.equal(result.code, 0, result.output);
  const report = f.summary();
  assert.equal(report.status, 'skipped');
  assert.equal(report.metrics.passed, 0);
  assert.equal(report.metrics.skipped, 5);
  assert.equal(report.attempts[0].status, 'skipped');
  assert(report.steps.every(step => step.skipReason === 'Requires microphone injection'));
  assert.match(f.junit(), /skipped message="Requires microphone injection"/);
  assert.deepEqual(report.browsers, []);
  assert.deepEqual(f.visits, []);
});

test('Batch6 no-match and invalid fragment plans fail with CI evidence before actions', async t => {
  const f = await fixture(t);
  f.write(normal);
  const noMatch = await execute(f, ['--tag', 'no-match']);
  assert.equal(noMatch.code, 1, noMatch.output);
  assert.match(f.summary().errors.join(' '), /No scenarios matched/);
  assert.match(noMatch.output, /No scenarios matched/);
  const missing = await execute(f, ['--tag', 'smoke']);
  assert.equal(missing.code, 1, missing.output);
  assert.match(f.summary().errors.join(' '), /flow.call/);
  assert.match(missing.output, /flow.call/);
  assert.deepEqual(f.visits, []);
});

test('Batch6 fragment assertion failures point at the fragment line', async t => {
  const f = await fixture(t);
  fragments(f);
  f.fragment('check', '// source line preserved\nflow.assert.that {"target":"Missing message","condition":"visible","timeout":150};');
  f.write(normal);
  const result = await execute(f);
  assert.equal(result.code, 1, result.output);
  const failed = f.summary().steps.find(step => step.status === 'failed');
  assert.equal(failed.sourceFile, 'steps/check.flowpart');
  assert.equal(failed.assertion.sourceFile, 'steps/check.flowpart');
  assert.match(failed.error, /steps\/check\.flowpart:2/);
});

test('Batch6 cleanup is LIFO, runs after failed assertions and before the retry creates a new resource', async t => {
  const f = await fixture(t);
  f.config({ retries: 1 });
  f.write(withCleanup('flow.get "/transient";\nflow.expect status "200";',
    'flow.cleanup.register {"method":"DELETE","url":"/dependent/@newUserId"};'));
  const result = await execute(f);
  assert.equal(result.code, 0, result.output);
  const app = f.visits.filter(([, url]) => url !== '/');
  assert.deepEqual(app, [
    ['POST', '/create'], ['GET', '/transient'], ['DELETE', '/dependent/resource-1'], ['DELETE', '/remove/resource-1'],
    ['POST', '/create'], ['GET', '/transient'], ['DELETE', '/dependent/resource-2'], ['DELETE', '/remove/resource-2'],
  ]);
  assert.equal(f.summary().attempts.at(-1).flaky, true);
});

test('Batch6 cleanup failure is reported, avoids scenario retry, and still drains remaining entries', async t => {
  const f = await fixture(t);
  f.config({ retries: 2 });
  f.write(withCleanup('flow.get "/okay";', 'flow.cleanup.register {"method":"DELETE","url":"/cleanup-fails"};'));
  const result = await execute(f);
  assert.equal(result.code, 1, result.output);
  const report = f.summary();
  assert.equal(report.attempts.length, 1);
  assert.equal(report.metrics.failed, 1);
  assert.equal(report.metrics.incomplete, 0);
  assert.match(report.steps.find(step => step.status === 'failed').error, /main.flow:\d+: Cleanup DELETE returned HTTP 500/);
  assert.deepEqual(f.visits.filter(([method]) => method === 'DELETE').map(([, url]) => url), ['/cleanup-fails', '/remove/resource-1']);
  assert(!JSON.stringify(report).includes('cleanup-response-must-not-leak'));
});

test('Batch6 cleanup completes on cooperative cancellation and preserves the interrupted result', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.write(withCleanup('flow.get "/ready-to-cancel";\nflow.wait 20000;'));
  const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', 'flows', '--ci'], {
    cwd: f.dir,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CI: 'true', FLOWSTRIDE_TOKEN: '', FLOWSTRIDE_API_URL: f.url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const deadline = Date.now() + 15000;
  while (!f.visits.some(([, url]) => url === '/ready-to-cancel')) {
    assert(Date.now() < deadline, output);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  child.kill('SIGTERM');
  assert.equal(await exit, 130, output);
  assert.equal(f.summary().status, 'interrupted');
  assert.deepEqual(f.visits.filter(([method]) => method === 'DELETE'), [['DELETE', '/remove/resource-1']]);
});

for (const mode of ['handoff', 'older']) {
  test(`Batch6 ${mode}: workflow protocol retains OS-to-Cloud handoff and older-engine fallback`, { skip: privateEngine || !cloud, timeout: 45000 }, async t => {
    const f = await fixture(t);
    fragments(f);
    f.write(normal);
    const env = prepare(f, mode);
    if (mode === 'older') for (const file of ['flow_worker', 'flow_orchestrator']) {
      const target = path.join(f.dir, 'node_modules/@flowstride/pro/dist/runner', file + '.js');
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('nativeDataProtocol', 'nativeWorkflowProtocol'));
    }
    const result = await execute(f, ['--tag', 'smoke'], env);
    assert.equal(result.code, 0, result.output);
    assert.equal(f.summary().engine, mode === 'handoff' ? 'Enterprise (Pro)' : 'Open Source');
    if (mode === 'older') assert.match(result.output, /workflow capabilities/);
  });
}

test('Batch6 parallel workers keep independent cleanup queues', { skip: !privateEngine && !cloud, timeout: 45000 }, async t => {
  const f = await fixture(t);
  const env = privateEngine ? {} : prepare(f, 'handoff');
  f.write(withCleanup('flow.get "/okay";'));
  f.write(withCleanup('flow.get "/okay";'), 'other.flow');
  const result = await execute(f, ['--workers', '2'], env);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(f.visits.filter(([method]) => method === 'DELETE').map(([, url]) => url).sort(), ['/remove/resource-1', '/remove/resource-2']);
  assert.equal(f.summary().attempts.length, 2);
});

test('Batch6 mixed run keeps passed and explicitly skipped scenarios distinct', { timeout: 45000 }, async t => {
  const f = await fixture(t, 'webkit');
  fragments(f);
  f.write(normal);
  f.write(skipped, 'conditional.flow');
  const result = await execute(f, ['--tag', 'smoke', '--tag', 'conditional']);
  assert.equal(result.code, 0, result.output);
  const report = f.summary();
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.passed, 5);
  assert.equal(report.metrics.skipped, 5);
  assert.deepEqual(report.attempts.map(attempt => attempt.status).sort(), ['passed', 'skipped']);
  assert(f.visits.every(([, url]) => url === '/'));
});
