const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const cloud = process.env.FLOWSTRIDE_PRO_SOURCE;
const privateEngine = require(path.join(root, 'package.json')).name === '@flowstride/pro';
const secret = 'fixture-Batch2-password-keep-private';
const metadataSecrets = {
  body: 'opaque-response-value-8b71d4cc',
  header: 'opaque-header-value-4ce8b3fa',
  cookie: 'opaque-session-value-27c65a19',
};

function execute(directory, { args = [], env = {}, onSpawn, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', 'flows', '--ci', ...args], {
      cwd: directory,
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CI: 'true', FLOWSTRIDE_TOKEN: '', BATCH2_PASSWORD: secret, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Batch2 CLI timed out:\n' + output)); }, timeout);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
    onSpawn?.(child);
  });
}

async function fixture(browser = 'chromium') {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch2-cli-')));
  fs.mkdirSync(path.join(directory, 'flows'));
  fs.mkdirSync(path.join(directory, '.flowstride'));
  fs.writeFileSync(path.join(directory, '.flowstride/credentials.json'), '{}');
  const calls = [];
  let onCall;
  const server = http.createServer((request, response) => {
    if (request.url === '/checkpoint/secrets') {
      const call = { path: request.url, time: Date.now() };
      calls.push(call);
      onCall?.(call);
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('X-Api-Key', metadataSecrets.header);
      response.setHeader('Set-Cookie', [`session=${metadataSecrets.cookie}; HttpOnly; Path=/; SameSite=Lax`, 'fixture=present; Path=/']);
      response.end(JSON.stringify({ accessToken: metadataSecrets.body }));
      return;
    }
    if (request.url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/auth/verify-cli') response.end(JSON.stringify({ tier: 'business', workspaceName: 'Batch2 fixture' }));
      else if (request.url === '/api/workspace/status') response.end(JSON.stringify({ workspace: { _id: 'fixture-batch2-workspace' }, manifest: { maxWorkers: 2, features: [] } }));
      else if (request.url === '/api/runs') { request.resume(); response.end(JSON.stringify({ accepted: true })); }
      else { response.statusCode = 404; response.end(JSON.stringify({ error: 'No such local Cloud fixture endpoint' })); }
      return;
    }
    if (request.url.startsWith('/checkpoint/')) {
      const call = { path: request.url, time: Date.now() };
      calls.push(call);
      onCall?.(call);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ reference: 'order-123', active: true }));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><title>Batch2 local acceptance</title><style>
      body{font:18px sans-serif;margin:32px}form{display:flex;flex-direction:column;gap:16px;width:320px;padding:20px;border:1px solid #888}label{display:flex;flex-direction:column;gap:6px}input,button{padding:10px}
      </style></head><body><h1>Ready</h1>
      <form aria-label="Login form"><label>Email<input type="email" aria-label="Email" value="reader@example.test"></label><label>Password<input type="password" aria-label="Password"></label><button type="button" disabled>Submit</button></form>
      <button type="button" onclick="document.querySelector('output').textContent='Continued'">Continue</button>
      <button type="button" onclick="fetch('/checkpoint/pace-one')">Record first marker</button>
      <button type="button" onclick="fetch('/checkpoint/pace-two')">Record second marker</button><output>Not continued</output></body></html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(directory, 'flowstride.config.json'), JSON.stringify({
    baseUrl: url, timeout: 500, browser, recordVideo: false,
    security: { evidence: { screenshots: false } }, domSnapshots: false,
  }));
  return {
    directory, url, calls,
    onCall(callback) { onCall = callback; },
    write(source) { fs.writeFileSync(path.join(directory, 'flows/controls.flow'), source); },
    summary() { return JSON.parse(fs.readFileSync(path.join(directory, 'flowstride-artifacts/summary.json'))); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

function softSource() {
  return `Feature: Soft assertions and explicit execution controls
Scenario: Inspect failures and continue to the final outcome
Given "Open the local application"
  flow.open "/";
When "Begin the validation group"
  flow.expect visible "Ready";
And "Collect three distinct assertion failures"
  flow.soft expect visible "Missing banner";
  flow.soft assert.that {
    "target": {
      "text": "Submit",
      "element": "button",
      "inside": "Login form",
      "under": "Password"
    },
    "condition": "enabled",
    "timeout": 120,
    "message": "The Submit button must be enabled"
  };
  flow.soft assert.value {
    "actual": 1,
    "operator": "equals",
    "expected": 2,
    "message": "The order count must equal two"
  };
When "Required DOM and API work still executes after the soft failures"
  flow.click button "Continue";
  flow.get "/checkpoint/after-soft";
  flow.expect status "200";
When "An explicit wait delays the next request"
  flow.wait 120;
  flow.get "/checkpoint/after-wait";
When "Pacing spaces browser actions and zero disables it"
  flow.pace 80;
  flow.click button "Record first marker";
  flow.click button "Record second marker";
  flow.pace 0;
  flow.wait 0;
When "Log a reused value without exposing secrets"
  flow.extract resBody "reference" as "reference";
  flow.log "Order @reference is ready";
  flow.log "Readable <tag> stays plain text";
  flow.log "Private value {{env.BATCH2_PASSWORD}}";
Then "The terminal outcome is still evaluated"
  flow.expect visible "Continued";
  flow.assert.value {
    "actual": true,
    "operator": "equals",
    "expected": true
  };
`;
}

function assertSoftOutcome(f, result, engine) {
  assert.equal(result.code, 1, result.output);
  const summary = f.summary();
  assert.equal(summary.status, 'failed', result.output);
  assert.equal(summary.metrics.failed, 3);
  assert.equal(summary.metrics.skipped, 0, 'Soft failures must not make later required steps optional or not tested');
  assert.equal(summary.metrics.incomplete, 0);
  assert.deepEqual(summary.steps.slice(-2).map(step => step.status), ['passed', 'passed'], 'Both final Then assertions must execute');
  const failed = summary.steps.filter(step => step.status === 'failed');
  assert.match(failed[0].error, /Missing banner/);
  assert.match(failed[1].error, /Submit/);
  assert.match(failed[1].error, /enabled/);
  assert.match(failed[2].error, /order count must equal two/i);
  for (const step of failed) assert.match(step.error, /controls\.flow:\d+/, 'Every failure must identify its source location');
  assert(summary.attempts.some(attempt => attempt.status === 'failed'), 'A soft-failed Scenario must remain failed');
  if (engine) assert.equal(summary.engine, engine, result.output);
  const checkpoints = f.calls.map(call => call.path);
  assert.deepEqual(checkpoints, ['/checkpoint/after-soft', '/checkpoint/after-wait', '/checkpoint/pace-one', '/checkpoint/pace-two']);
  assert(f.calls[1].time - f.calls[0].time >= 100, 'flow.wait must delay the following API call');
  assert(f.calls[3].time - f.calls[2].time >= 60, 'flow.pace must delay subsequent browser actions');
  assert.match(result.output, /Order order-123 is ready/);
  const junit = fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/junit.xml'), 'utf8');
  assert.match(junit, /Order order-123 is ready/, 'User logs must be available in retained CI evidence');
  assert.match(junit, /Readable &lt;tag&gt; stays plain text/, 'User messages must be XML escaped in JUnit evidence');
  const evidence = result.output + JSON.stringify(summary) + junit;
  assert(!evidence.includes(secret), 'A logged secret must remain redacted in terminal and retained results');
  assert.match(result.output, /REDACTED/);
  assert(!/All suites completed successfully|Execution suite completed successfully/.test(result.output), 'Soft-failed suites must not print a success result');
  return summary;
}

for (const browser of ['chromium', 'firefox', 'webkit']) {
  test(`Batch2 soft failures, logs, wait and pace use real headless ${browser}`, { timeout: 65000 }, async () => {
    const f = await fixture(browser);
    try {
      f.write(softSource());
      const summary = assertSoftOutcome(f, await execute(f.directory));
      assert.equal(summary.browsers[0].engine, browser);
      assert.equal(summary.browsers[0].headless, true, 'Batch2 must retain the default headless application browser');
    } finally { await f.close(); }
  });
}

test('Batch2 extracted metadata secrets stay private through innocent aliases after a clean API request', { timeout: 65000 }, async () => {
  const f = await fixture();
  try {
    for (const value of Object.values(metadataSecrets)) assert(!Object.values(process.env).includes(value), 'These fixture secrets must not be protected merely by environment-secret discovery');
    f.write(`Feature: Extracted secret metadata survives API state replacement
Scenario: Reuse ordinary local and global aliases safely
Given "Read a response containing secret metadata"
  flow.get "/checkpoint/secrets";
When "Keep the values under ordinary alias names"
  flow.extract resBody "accessToken" as "bodyProof";
  flow.extract resHeader "x-api-key" as global "headerProof";
  flow.extract cookie "session" as "cookieProof";
When "Replace the current API response with clean data"
  flow.get "/checkpoint/clean";
When "Log the reused values with readable surrounding text"
  flow.log "Reused body @bodyProof, header @global[headerProof], cookie @cookieProof after a clean request";
Then "The clean request still succeeds"
  flow.expect status "200";
`);
    const result = await execute(f.directory);
    assert.equal(result.code, 0, result.output);
    const summary = f.summary();
    assert.equal(summary.status, 'passed');
    assert.equal(summary.metrics.failed, 0);
    assert.equal(summary.metrics.incomplete, 0);
    assert(summary.steps.every(step => step.status === 'passed'));
    assert.deepEqual(f.calls.map(call => call.path), ['/checkpoint/secrets', '/checkpoint/clean']);
    const junit = fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/junit.xml'), 'utf8');
    const readable = 'Reused body [REDACTED], header [REDACTED], cookie [REDACTED] after a clean request';
    assert(result.output.includes(readable), result.output);
    assert(JSON.stringify(summary).includes(readable), 'The retained step message must keep readable context while masking each alias');
    assert(junit.includes(readable), 'JUnit must retain the masked message for CI consumers');
    for (const value of Object.values(metadataSecrets)) {
      assert(!result.output.includes(value), 'Terminal output exposed an extracted metadata secret');
      assert(!JSON.stringify(summary).includes(value), 'Summary exposed an extracted metadata secret');
      assert(!junit.includes(value), 'JUnit exposed an extracted metadata secret');
    }
  } finally { await f.close(); }
});

test('Batch2 required failure still stops subsequent actions while flow.try retains its isolated skip', { timeout: 65000 }, async () => {
  const f = await fixture();
  try {
    f.write(`Feature: Optional execution stays unchanged
Scenario: Skip only the optional command
Given "Open the application"
  flow.open "/";
When "Try an absent optional control, then continue normally"
  flow.try click button "Absent optional control";
  flow.click button "Continue";
Then "Required outcome passes"
  flow.expect visible "Continued";
`);
    const optional = await execute(f.directory);
    assert.equal(optional.code, 0, optional.output);
    assert.deepEqual(f.summary().steps.map(step => step.status), ['passed', 'skipped', 'passed', 'passed']);
    f.write(`Feature: Required failures stay strict
Scenario: A hard failure is still terminal for this Scenario
Given "Open the application"
  flow.open "/";
When "Fail a required assertion"
  flow.expect visible "Missing required content";
When "This action must not run"
  flow.get "/checkpoint/must-not-run";
Then "This assertion must not run either"
  flow.expect visible "Ready";
`);
    const hard = await execute(f.directory);
    assert.equal(hard.code, 1, hard.output);
    assert.deepEqual(f.summary().steps.map(step => step.status), ['passed', 'failed', 'not_tested', 'not_tested']);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('Batch2 pause fails promptly in CI and never resumes execution implicitly', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    f.write(`Feature: Interactive pause is not a CI wait
Scenario: A paused CI run fails explicitly
Given "Open the application"
  flow.open "/";
When "Request a manual inspection"
  flow.pause "Inspect the form before continuing";
When "Do not execute after the pause failure"
  flow.get "/checkpoint/must-not-run";
Then "Do not report a false pass"
  flow.expect visible "Ready";
`);
    const result = await execute(f.directory, { timeout: 20000 });
    assert.equal(result.code, 1, result.output);
    const summary = f.summary();
    assert.equal(summary.status, 'failed');
    assert.deepEqual(summary.steps.map(step => step.status), ['passed', 'failed', 'not_tested', 'not_tested']);
    assert.match(summary.steps[1].error, /pause/i);
    assert.match(summary.steps[1].error, /CI|interactive/i);
    assert.match(summary.steps[1].error, /controls\.flow:\d+/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

for (const [command, value] of [['wait', '-1'], ['pace', '60001'], ['wait', '1; process.exit(0)']]) {
  test(`Batch2 ${command} rejects unsafe interpolated duration ${JSON.stringify(value)}`, { timeout: 25000 }, async () => {
    const f = await fixture();
    try {
      f.write(`Feature: Runtime delay validation
Scenario: Interpolated durations are validated without evaluating code
Given "Open the application"
  flow.open "/";
When "Read an invalid duration"
  flow.${command} "{{env.BATCH2_DELAY}}";
When "This action must not run"
  flow.get "/checkpoint/must-not-run";
Then "This assertion must not run"
  flow.expect visible "Ready";
`);
      const result = await execute(f.directory, { env: { BATCH2_DELAY: value }, timeout: 20000 });
      assert.equal(result.code, 1, result.output);
      const summary = f.summary();
      assert.equal(summary.metrics.failed, 1);
      assert.match(summary.steps.find(step => step.status === 'failed').error, /duration|milliseconds|integer|range/i);
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  });
}

test('Batch2 SIGTERM interrupts a long manual wait and preserves an interrupted CI result', { timeout: 25000 }, async () => {
  const f = await fixture();
  let child;
  try {
    f.write(`Feature: Manual waits remain cancellable
Scenario: Stop an explicit long wait
Given "Open the application"
  flow.open "/";
When "Announce that the wait is about to begin"
  flow.get "/checkpoint/wait-start";
  flow.wait 60000;
When "Cancelled work must not execute"
  flow.get "/checkpoint/must-not-run";
Then "Cancelled work cannot pass"
  flow.expect visible "Ready";
`);
    f.onCall(call => { if (call.path === '/checkpoint/wait-start') setTimeout(() => child.kill('SIGTERM'), 100); });
    const result = await execute(f.directory, { timeout: 20000, onSpawn(value) { child = value; } });
    assert.equal(result.code, 130, result.output);
    assert.equal(f.summary().status, 'interrupted');
    assert.deepEqual(f.calls.map(call => call.path), ['/checkpoint/wait-start']);
  } finally { if (child?.exitCode === null) child.kill('SIGKILL'); await f.close(); }
});

function prepareMode(f, mode) {
  const parent = path.join(f.directory, 'node_modules/@flowstride');
  fs.mkdirSync(parent, { recursive: true });
  const installed = path.join(parent, 'pro');
  if (mode === 'handoff') fs.symlinkSync(cloud, installed, 'dir');
  else {
    const runner = path.join(installed, 'dist/runner');
    fs.mkdirSync(runner, { recursive: true });
    for (const [file, exported] of [['flow_worker', 'FlowWorker'], ['flow_orchestrator', 'FlowOrchestrator']]) {
      fs.writeFileSync(path.join(runner, file + '.js'), `module.exports=require(${JSON.stringify(path.join(cloud, 'dist/runner', file + '.js'))});module.exports.${exported}.nativeControlProtocol=undefined;`);
    }
  }
  fs.writeFileSync(path.join(f.directory, '.flowstride/credentials.json'), JSON.stringify({ machineToken: 'fixture-batch2-token', workspaceId: 'fixture-batch2-workspace' }));
  return { FLOWSTRIDE_API_URL: f.url };
}

for (const mode of ['handoff', 'older', 'legacy-handoff']) {
  test(`Batch2 ${mode} preserves OS-to-Cloud installation and fallback`, { skip: privateEngine || !cloud, timeout: 65000 }, async () => {
    const f = await fixture();
    try {
      const env = prepareMode(f, mode);
      f.write(mode === 'legacy-handoff' ? `Feature: Legacy flows still hand off
Scenario: No new execution controls are required
Given "Open the application"
  flow.open "/";
When "Perform an ordinary action"
  flow.click button "Continue";
Then "The ordinary outcome passes"
  flow.expect visible "Continued";
` : softSource());
      const result = await execute(f.directory, { env });
      if (mode === 'legacy-handoff') {
        assert.equal(result.code, 0, result.output);
        assert.equal(f.summary().engine, 'Enterprise (Pro)');
        assert.equal(f.summary().status, 'passed');
      } else {
        assertSoftOutcome(f, result, mode === 'older' ? 'Open Source' : 'Enterprise (Pro)');
        if (mode === 'older') assert.match(result.output, /fallback|falling back/i);
      }
    } finally { await f.close(); }
  });
}

test('Batch2 parallel Cloud files retain each soft failure, final Then outcome and log evidence', { skip: !privateEngine && !cloud, timeout: 65000 }, async () => {
  const f = await fixture();
  try {
    const env = privateEngine ? {} : prepareMode(f, 'handoff');
    f.write(softSource());
    fs.copyFileSync(path.join(f.directory, 'flows/controls.flow'), path.join(f.directory, 'flows/controls-second.flow'));
    const result = await execute(f.directory, { args: ['--workers', '2'], env });
    assert.equal(result.code, 1, result.output);
    const summary = f.summary();
    assert.equal(summary.engine, 'Enterprise (Pro)', result.output);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.metrics.failed, 6);
    assert.equal(summary.metrics.skipped, 0);
    assert.equal(summary.metrics.incomplete, 0);
    const files = [...new Set(summary.steps.map(step => step.fileName))];
    assert.equal(files.length, 2);
    for (const file of files) {
      const steps = summary.steps.filter(step => step.fileName === file);
      assert.equal(steps.filter(step => step.status === 'failed').length, 3);
      assert.deepEqual(steps.slice(-2).map(step => step.status), ['passed', 'passed']);
    }
    assert.equal(summary.attempts.filter(attempt => attempt.status === 'failed').length, 2);
    for (const name of ['after-soft', 'after-wait', 'pace-one', 'pace-two']) assert.equal(f.calls.filter(call => call.path === '/checkpoint/' + name).length, 2);
    const junit = fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/junit.xml'), 'utf8');
    assert.match(junit, /Order order-123 is ready/);
    assert(![result.output, JSON.stringify(summary), junit].some(text => text.includes(secret)));
    assert(!/All suites completed successfully|Execution suite completed successfully/.test(result.output));
  } finally { await f.close(); }
});
