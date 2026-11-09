const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const required = createRequire(path.join(root, 'package.json'));
const { WebSocket } = required('ws');
const { WebAdapter } = require(path.join(root, 'dist/adapters/web/playwright'));
const { ApiAdapter } = require(path.join(root, 'dist/adapters/api/undici'));
const { FlowWorker } = require(path.join(root, 'dist/runner/flow_worker'));
const { FlowOrchestrator } = require(path.join(root, 'dist/runner/flow_orchestrator'));
const privateEngine = required('./package.json').name === '@flowstride/pro';
async function until(predicate, label) {
  const limit = Date.now() + 20000;
  while (!predicate()) { if (Date.now() > limit) throw Error('Timed out waiting for ' + label); await new Promise(resolve => setTimeout(resolve, 20)); }
}

test(`real ${privateEngine ? 'parallel Cloud' : 'OS'} worker pauses resume through the local socket, survive reconnect, and reject stale requests`, { timeout: 60000 }, async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch2-resume-')));
  const flowRoot = path.join(directory, 'flows'); fs.mkdirSync(flowRoot);
  const count = privateEngine ? 2 : 1;
  for (let index = 0; index < count; index++) fs.writeFileSync(path.join(flowRoot, `review-${index}.flow`), `Feature: Explicit interactive review\nScenario: Review and continue\nGiven "An initial marker"\n  flow.log "Started ${index}";\nWhen "Review the test"\n  flow.pause "Inspect worker ${index}";\nThen "The test continues after an explicit resume"\n  flow.log "Resumed ${index}";\n`);
  const envNames = ['FLOWSTRIDE_NATIVE_CI', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'FLOWSTRIDE_API_KEY'];
  const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  const previousArgs = [...process.argv]; process.argv.push('--headless');
  const events = [], frames = [];
  const config = { ci: false, headless: true, browser: 'chromium', timeout: 2000, recordVideo: false, projectRoot: directory, flowRoot, security: { evidence: { screenshots: false } }, onRunEvent: event => events.push(event) };
  const worker = new FlowWorker(config, new WebAdapter(config), new ApiAdapter(config), {}, {});
  const orchestrator = new FlowOrchestrator(worker, count, config);
  let client;
  let run;
  const connect = async () => {
    const port = orchestrator.httpServer.address().port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}` });
    socket.on('message', frame => frames.push(JSON.parse(frame.toString())));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return socket;
  };
  try {
    run = orchestrator.start(flowRoot);
    await until(() => orchestrator.httpServer?.listening, 'local dashboard server');
    client = await connect();
    await until(() => orchestrator.pendingPauses.size === count, 'all workers to pause');
    const pauses = [...orchestrator.pendingPauses.values()].map(item => item.payload);
    assert.equal(new Set(pauses.map(pause => pause.id)).size, count);
    assert(pauses.every(pause => pause.sourceLine > 0 && pause.stepId && pause.scenario === 'Review and continue'));
    assert(events.filter(event => event.type === 'BROWSER_INFO').every(event => event.payload.headless === true));
    client.send('{invalid JSON');
    client.send(JSON.stringify({ type: 'RESUME_EXECUTION', payload: { pauseId: randomUUID(), workerId: 0 } }));
    client.send(JSON.stringify({ type: 'RERUN_REQ', payload: {} }));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(orchestrator.pendingPauses.size, count);
    assert.equal(events.filter(event => event.type === 'SUITE_START').length, 1);
    assert.equal(events.some(event => event.type === 'LOG_EVENT' && event.payload.details?.userLog && event.payload.summary.startsWith('Resumed')), false);
    // A new local dashboard connection receives the active pause capability for each worker.
    client.close(); frames.length = 0;
    client = await connect();
    await until(() => frames.filter(event => event.type === 'EXECUTION_PAUSED').length === count, 'pause replay after reconnect');
    client.send(JSON.stringify({ type: 'RESUME_EXECUTION', payload: { pauseId: pauses[0].id, workerId: 'spoofed-other-worker' } }));
    await until(() => !orchestrator.pendingPauses.has(pauses[0].id), 'first worker resume');
    client.send(JSON.stringify({ type: 'RESUME_EXECUTION', payload: { pauseId: pauses[0].id } }));
    if (count > 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(orchestrator.pendingPauses.has(pauses[1].id), true, 'A replayed first ID must not resume the second worker');
      client.send(JSON.stringify({ type: 'RESUME_EXECUTION', payload: { pauseId: pauses[1].id } }));
    }
    assert.equal(await run, true);
    assert.equal(orchestrator.pendingPauses.size, 0);
    assert.equal(events.filter(event => event.type === 'LOG_EVENT' && event.payload.details?.userLog && event.payload.summary.startsWith('Resumed')).length, count);
    assert.equal(events.filter(event => event.type === 'EXECUTION_RESUMED').length, count);
    assert.equal(events.filter(event => event.type === 'SUITE_START').length, 1);
  } finally {
    orchestrator.abort();
    await orchestrator.close();
    if (client) client.terminate();
    await worker.shutdown();
    if (run) await Promise.race([run.catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
    process.argv.splice(0, process.argv.length, ...previousArgs);
    for (const [name, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
