const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Module } = require('node:module');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { loadSource, requireUI, ui } = require('../helpers/report-status.cjs');
const { ExecutionControl } = loadSource('src/runner/execution_control.ts');
const esbuild = requireUI('esbuild');
const code = esbuild.buildSync({ entryPoints: [path.join(ui, 'src/store.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'zustand'] }).outputFiles[0].text;
const compiled = new Module(path.join(ui, 'batch2-controls-test.cjs'));
compiled.paths = Module._nodeModulePaths(ui); compiled._compile(code, path.join(ui, 'batch2-controls-test.cjs'));
const store = compiled.exports.useFlowStore;
const { FlowOrchestrator } = require('../../dist/runner/flow_orchestrator');
beforeEach(() => store.getState().startExecution());

test('manual waits validate durations and cancellation immediately clears pending timers', async () => {
  const control = new ExecutionControl();
  for (const duration of [-1, NaN, Infinity, '10', 1.5, 86400001]) await assert.rejects(control.delay(duration), /duration/);
  await control.delay(0);
  const wait = assert.rejects(control.delay(60000), /cancelled/);
  control.cancel(); await wait;
  await assert.rejects(control.delay(0), /cancelled/);
  control.reset(); await control.delay(1);
});

test('pause IDs are unguessable per pause, exact, single-use and isolated across resets', async () => {
  const events = [];
  const control = new ExecutionControl(pause => events.push(['paused', pause]), pause => events.push(['resumed', pause]));
  const first = control.pause('Review account', { fileName: 'customer.flow', scenario: 'Login', sourceLine: 8, attempt: 1 });
  const firstId = control.pendingPause.id;
  assert.match(firstId, /^[0-9a-f-]{36}$/);
  assert.equal(control.resume('__proto__'), false);
  assert.equal(control.resume(randomUUID()), false);
  control.pendingPause.id = randomUUID();
  assert.equal(control.resume(firstId), true); await first;
  assert.equal(control.resume(firstId), false);
  const second = control.pause('Review administrator', { fileName: 'admin.flow' });
  const secondId = control.pendingPause.id;
  assert.notEqual(firstId, secondId);
  assert.equal(control.resume(firstId), false);
  const rejected = assert.rejects(second, /cancelled/); control.reset(); await rejected;
  assert.equal(control.resume(secondId), false);
  assert.equal(events.at(-1)[1].cancelled, true);
  assert.equal(events[0][1].sourceLine, 8);
  assert.equal(control.pendingPause, null);
});

test('duplicate pauses and telemetry observer failures do not leave suspended or uncancellable work', async () => {
  const control = new ExecutionControl();
  const waiting = control.pause('First');
  await assert.rejects(control.pause('Second'), /already paused/);
  const rejected = assert.rejects(waiting, /cancelled/); control.cancel(); await rejected;
  const failingPause = new ExecutionControl(() => { throw Error('observer failed'); });
  await assert.rejects(failingPause.pause('Check'), /observer failed/);
  assert.equal(failingPause.pendingPause, null);
  const failingResume = new ExecutionControl(undefined, () => { throw Error('observer disconnected'); });
  const resumed = failingResume.pause('Continue');
  assert.equal(failingResume.resume(failingResume.pendingPause.id), true); await resumed;
});

test('dashboard pause state preserves each parallel owner and clears on completion or a new suite', () => {
  const s = store.getState(), first = randomUUID(), second = randomUUID();
  s.pauseExecution({ id: first, message: 'Review customer', fileName: 'customer.flow', sourceLine: 7 });
  s.pauseExecution({ id: second, message: 'Review admin', fileName: 'admin.flow', sourceLine: 9 });
  s.resumeExecution(randomUUID()); assert.equal(Object.keys(store.getState().pendingPauses).length, 2);
  s.resumeExecution(first); assert.deepEqual(Object.keys(store.getState().pendingPauses), [second]);
  s.stopExecution('aborted'); assert.deepEqual(store.getState().pendingPauses, {});
  s.pauseExecution({ id: randomUUID(), message: 'Reconnect pause' }); assert.equal(store.getState().isRunning, true);
  s.startExecution(); assert.deepEqual(store.getState().pendingPauses, {});
});

test('dashboard rejects malformed pause data and preserves redacted log text as escaped React content', () => {
  const s = store.getState();
  for (const payload of [null, [], { id: '__proto__', message: 'bad' }, { id: randomUUID(), message: {} }, { id: randomUUID(), message: 'bad', sourceLine: -1 }]) s.pauseExecution(payload);
  assert.deepEqual(store.getState().pendingPauses, {});
  s.startRun('log.flow', 'Logs');
  s.addStep({ id: 'log1', fileName: 'log.flow', command: 'log', userMessage: 'password=do-not-retain', status: 'running' });
  assert.doesNotMatch(store.getState().testScenarios[0].steps[0].userMessage, /do-not-retain/);
  s.updateStepStatus('log1', 'passed', undefined, 'log.flow', { userMessage: '<img src="https://attacker.invalid/leak" onerror="attack()">' });
  assert.equal(store.getState().testScenarios[0].steps[0].userMessage, '<img src="https://attacker.invalid/leak" onerror="attack()">');
});

test('orchestrator resumes only a recorded active pause and blocks stale/replayed IDs and concurrent runs', async () => {
  const worker = new EventEmitter(), calls = [];
  worker.abort = () => {}; worker.resumePause = id => { calls.push(id); worker.emit('worker_event', { type: 'EXECUTION_RESUMED', payload: { id } }); return true; };
  const orchestrator = new FlowOrchestrator(worker, 1, {});
  orchestrator.isExecuting = true;
  const id = randomUUID();
  worker.emit('worker_event', { type: 'EXECUTION_PAUSED', payload: { id, message: 'Review' } });
  assert.equal(orchestrator.resumeExecution(randomUUID()), false);
  assert.equal(orchestrator.resumeExecution(id), true); assert.deepEqual(calls, [id]);
  assert.equal(orchestrator.resumeExecution(id), false);
  assert.equal(await orchestrator.executeTestRun('/not-used'), false);
  const stale = randomUUID(); worker.emit('worker_event', { type: 'EXECUTION_PAUSED', payload: { id: stale, message: 'Old' } });
  orchestrator.abort(); assert.equal(orchestrator.resumeExecution(stale), false);
  assert.equal(FlowOrchestrator.nativeControlProtocol, 1);
});

test('Cloud parallel resume follows trusted worker ownership and clears only that worker on exit', () => {
  const worker = new EventEmitter(); worker.abort = () => {}; worker.resumePause = () => { throw Error('Must route to child'); };
  const orchestrator = new FlowOrchestrator(worker, 2, {});
  if (typeof orchestrator.clearWorkerPauses !== 'function') return;
  const sent = [], child = { connected: true, send: message => sent.push(message) }, other = { connected: true, send: () => { throw Error('Wrong owner'); } };
  orchestrator.activeWorkers = [child, other]; orchestrator.isExecuting = true;
  const id = randomUUID(), otherId = randomUUID();
  orchestrator.forwardToDashboard('EXECUTION_PAUSED', { id, message: 'Child' }, child);
  orchestrator.forwardToDashboard('EXECUTION_PAUSED', { id: otherId, message: 'Other' }, other);
  orchestrator.forwardToDashboard('EXECUTION_RESUMED', { id }, other);
  assert.equal(orchestrator.resumeExecution(id), true); assert.deepEqual(sent, [{ type: 'RESUME_EXECUTION', payload: { pauseId: id } }]);
  orchestrator.clearWorkerPauses(child);
  assert.equal(orchestrator.resumeExecution(id), false);
  assert.equal(orchestrator.pendingPauses.has(otherId), true);
  orchestrator.forwardToDashboard('SUITE_START', {}); assert.equal(orchestrator.resumeExecution(otherId), false);
});
