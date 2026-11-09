const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('../helpers/report-status.cjs');
const { aggregateStepStatus, aggregateFileStatus } = loadSource('src/ui/src/utils/executionStatus.ts');
const store = loadSource('src/ui/src/store.ts').useFlowStore;
const entries = statuses => statuses.map(status => ({ status }));

for (const statuses of [
  ['skipped', 'passed', 'passed'], ['passed', 'skipped', 'passed'], ['passed', 'passed', 'skipped'],
  ['success', 'skip', 'PASS'],
]) test(`optional skips preserve the passed parent/file: ${statuses}`, () => {
  const steps = entries(statuses);
  assert.equal(aggregateStepStatus(steps), 'passed');
  assert.equal(aggregateFileStatus([{ status: 'pass', steps }]), 'passed');
  assert.deepEqual(steps, entries(statuses), 'reporting must not rewrite individual outcomes');
});

test('all-skipped and empty groups do not invent successful execution', () => {
  assert.equal(aggregateStepStatus(entries(['skipped', 'skipped'])), 'skipped');
  assert.equal(aggregateFileStatus([{ status: 'pass', steps: entries(['skipped']) }]), 'skipped');
  assert.equal(aggregateStepStatus([]), 'pending');
  assert.equal(aggregateFileStatus([]), 'pending');
  assert.equal(aggregateFileStatus([{ status: 'pass', steps: [] }]), 'pending');
});

for (const status of ['failed', 'error', 'running', 'pending', 'not_tested', 'interrupted', 'cancelled', 'blocked', 'unknown']) {
  test(`${status} cannot be hidden by passed/skipped commands`, () => {
    const expected = status === 'error' ? 'failed' : status;
    const list = entries(['passed', status, 'skipped']);
    assert.equal(aggregateStepStatus(list), expected);
    assert.equal(aggregateStepStatus([...list].reverse()), expected);
    assert.equal(aggregateFileStatus([{ status: 'pass', steps: list }]), expected);
  });
}

test('scenario errors, pending parallel scenarios and interrupted files override successful steps', () => {
  for (const status of ['failed', 'error', 'running', 'interrupted', 'cancelled', 'blocked']) {
    assert.equal(aggregateFileStatus([
      { status: 'pass', steps: entries(['passed', 'skipped']) },
      { status, steps: entries(['passed']) },
    ]), status === 'error' ? 'failed' : status);
  }
});

test('malformed or hostile status values never turn mixed work into a pass', () => {
  for (const status of ['__proto__', 'constructor', '<img src=x onerror=attack()>', 'not-skipped', {}, [], true, 1, null, undefined]) {
    const steps = entries(['passed', 'skipped', status]);
    assert.notEqual(aggregateStepStatus(steps), 'passed');
    assert.notEqual(aggregateFileStatus([{ status: 'pass', steps }]), 'passed');
  }
});

beforeEach(() => store.getState().startExecution());
function add(id, status, file = 'optional.flow', metadata) {
  const state = store.getState();
  state.addStep({ id, fileName: file, type: 'When', description: 'Optional and required actions', command: 'click', status: 'running' });
  state.updateStepStatus(id, status, undefined, file, metadata);
}

test('store completion and summary agree when a scenario starts with an optional skip', () => {
  const state = store.getState();
  state.startRun('optional.flow', 'Continue after optional target');
  add('optional', 'skipped');
  add('required', 'passed');
  state.stopExecution('success');
  const completed = store.getState();
  assert.equal(completed.runStatus, 'passed');
  assert.equal(aggregateFileStatus(completed.testScenarios), 'passed');
  assert.deepEqual(completed.testScenarios[0].steps.map(step => step.status), ['skipped', 'passed']);
});

test('parallel files and repeated step IDs retain independent skipped/pass/fail results', () => {
  const state = store.getState();
  state.startRun('optional.flow', 'Customer');
  state.startRun('other.flow', 'Administrator');
  add('same-id', 'skipped');
  add('required', 'passed');
  add('same-id', 'failed', 'other.flow');
  state.scenarioResult({ fileName: 'optional.flow', scenario: 'Customer', status: 'passed' });
  state.scenarioResult({ fileName: 'other.flow', scenario: 'Administrator', status: 'failed' });
  state.stopExecution('failed');
  const scenarios = store.getState().testScenarios;
  assert.equal(aggregateFileStatus(scenarios.filter(item => item.fileName === 'optional.flow')), 'passed');
  assert.equal(aggregateFileStatus(scenarios.filter(item => item.fileName === 'other.flow')), 'failed');
  assert.equal(store.getState().runStatus, 'failed');
});

test('latest retry determines summary while skipped/failed attempt history stays intact', () => {
  const state = store.getState();
  state.startRun('optional.flow', 'Retry');
  add('optional', 'skipped', 'optional.flow', { attempt: 1 });
  add('required', 'failed', 'optional.flow', { attempt: 1 });
  state.addStep({ id: 'required', fileName: 'optional.flow', command: 'expect', attempt: 2, status: 'running' });
  assert.equal(aggregateFileStatus(store.getState().testScenarios), 'running');
  state.updateStepStatus('required', 'passed', undefined, 'optional.flow', { attempt: 2 });
  state.stopExecution('success');
  const scenario = store.getState().testScenarios[0];
  assert.equal(aggregateFileStatus([scenario]), 'passed');
  assert.deepEqual(scenario.steps.find(step => step.id === 'required').attemptHistory.map(item => item.status), ['failed', 'passed']);
  state.startExecution();
  assert.equal(aggregateFileStatus(store.getState().testScenarios), 'pending');
});

test('cancellation and unfinished work cannot become green because another command was skipped', () => {
  const state = store.getState();
  state.startRun('optional.flow', 'Cancelled');
  add('optional', 'skipped');
  state.addStep({ id: 'unfinished', fileName: 'optional.flow', command: 'click', status: 'running' });
  state.stopExecution('interrupted');
  assert.equal(store.getState().runStatus, 'interrupted');
  assert.notEqual(aggregateFileStatus(store.getState().testScenarios), 'passed');
});
