const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const { FlowWorker } = require(path.join(root, 'dist/runner/flow_worker'));
const { SessionManager } = require(path.join(root, 'dist/sessions/manager'));
const { WebAdapter } = require(path.join(root, 'dist/adapters/web/playwright'));
const { Parser } = require(path.join(root, 'dist/parser/parser'));
const { Lexer } = require(path.join(root, 'dist/parser/lexer'));

function worker(web, timeout = 140) {
  return new FlowWorker({ ci: true, headless: true, timeout }, web, {
    getState() { throw new Error('No API response'); },
  }, {}, {});
}
function attribute(source) {
  const flow = `Feature: Attribute regression\nScenario: Verify state\nGiven "A page"\nWhen "An action"\nThen "Verify the attribute"\n${source}\n`;
  return new Parser(new Lexer(flow).tokenise()).parse()[0].scenarios[0].steps[0];
}
const snapshot = {
  cookies: [{ name: 'session', value: 'fixture-cookie', domain: 'app.example.test', path: '/' }],
  localStorage: { theme: 'dark' }, sessionStorage: { tenant: 'fixture-tenant', empty: '' },
  storageOrigin: 'https://app.example.test:8443',
};

test('parsed exact attribute assertion reads the named element and attribute', async () => {
  const calls = [];
  const w = worker({ getAttribute: async (...args) => { calls.push(args); return 'approved'; } });
  const step = attribute('flow.expect attribute button "#order" "data-state" "approved";');
  await w.executeStep(step.action, step.payload);
  assert.deepEqual(calls, [['#order', 'data-state', 'button']]);
});

for (const actual of ['pending', null]) test(`incorrect/missing attribute fails instead of passing: ${actual}`, async () => {
  let reads = 0;
  const w = worker({ getAttribute: async () => { reads++; return actual; } });
  const step = attribute('flow.expect attribute "#order" "data-state" "approved";');
  await assert.rejects(w.executeStep(step.action, step.payload), /Attribute assertion failed/);
  assert(reads > 0);
});

test('contains uses substring matching while exact comparison remains case-sensitive', async () => {
  const w = worker({ getAttribute: async () => 'primary selected' });
  const partial = attribute('flow.expect attribute "#order" "class" contains "selected";');
  await w.executeStep(partial.action, partial.payload);
  for (const expected of ['selected', 'PRIMARY SELECTED']) {
    await assert.rejects(w.executeStep('expect', { type: 'attribute', selector: '#order', attribute: 'class', text: expected }), /Attribute assertion failed/);
  }
});

test('empty attribute is valid but a missing attribute cannot satisfy an empty expectation', async () => {
  let actual = '';
  const w = worker({ getAttribute: async () => actual });
  const step = attribute('flow.expect attribute "#order" "disabled" "";');
  await w.executeStep(step.action, step.payload);
  actual = null;
  await assert.rejects(w.executeStep(step.action, step.payload), /Attribute assertion failed/);
});

test('attribute comparison retries delayed updates and eventually fails persistent read errors', async () => {
  let reads = 0;
  const w = worker({ getAttribute: async () => ++reads < 3 ? 'pending' : 'approved' }, 1000);
  await w.executeStep('expect', { type: 'attribute', selector: '#order', attribute: 'data-state', text: 'approved' });
  assert.equal(reads, 3);
  await assert.rejects(worker({ getAttribute: async () => { throw new Error('Element detached'); } }).executeStep('expect', {
    type: 'attribute', selector: '#order', attribute: 'data-state', text: 'approved',
  }), /Attribute assertion failed/);
});

test('a hung attribute read is bounded and its late rejection is observed safely', async () => {
  const unhandled = [], listener = error => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    const w = worker({ getAttribute: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Late read failure')), 70)) }, 20);
    await assert.rejects(w.executeStep('expect', { type: 'attribute', selector: '#order', attribute: 'data-state', text: 'approved' }), /Attribute assertion failed/);
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', listener); }
});

test('attribute failure marks the scenario failed and leaves its remaining steps untested', async () => {
  const w = worker({ getAttribute: async () => 'pending' });
  w.captureStepContext = async () => ({});
  const events = [];
  w.on('worker_event', event => events.push(event));
  const step = { id: 'one', blockDescription: 'Then Check state', action: 'expect', payload: {
    type: 'attribute', selector: '#order', attribute: 'data-state', text: 'approved',
  } };
  await w.runScenario({ name: 'Regression', declarations: [], steps: [step, {
    ...step, id: 'two', blockDescription: 'Then Check later state',
  }] });
  assert(events.some(event => event.type === 'STEP_UPDATE' && event.payload.id === 'one' && event.payload.status === 'failed'));
  assert(events.some(event => event.type === 'STEP_UPDATE' && event.payload.id === 'two' && event.payload.status === 'not_tested'));
});

for (const isGlobal of [false, true]) test(`save/use forwards cookies, both storage types and source origin; global=${isGlobal}`, async () => {
  let injected;
  const w = worker({ getState: async () => snapshot, injectStorage: async (...args) => { injected = args; } });
  const payload = { type: 'session', name: `unit-${isGlobal}`, isGlobal };
  await w.executeStep('save', payload);
  await w.executeStep('use', payload);
  assert.deepEqual(injected, [snapshot.cookies, snapshot.localStorage, undefined, snapshot.sessionStorage, snapshot.storageOrigin]);
});

test('persisted sessions round-trip sessionStorage and origin through a new worker', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-session-unit-'));
  const previous = process.cwd();
  try {
    process.chdir(directory);
    await worker({ getState: async () => snapshot }).executeStep('save', { type: 'session', name: 'saved', persist: true });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, '.flowstride/sessions/saved.json')));
    assert.deepEqual(saved.sessionStorage, snapshot.sessionStorage);
    assert.equal(saved.storageOrigin, snapshot.storageOrigin);
    let injected;
    await worker({ injectStorage: async (...args) => { injected = args; } }).executeStep('use', { type: 'session', name: 'saved' });
    assert.deepEqual(injected, [snapshot.cookies, snapshot.localStorage, undefined, snapshot.sessionStorage, snapshot.storageOrigin]);
  } finally { process.chdir(previous); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('legacy sessions without sessionStorage or origin retain the original call arguments', async () => {
  let injected;
  const w = worker({ injectStorage: async (...args) => { injected = args; } });
  w.localBrowserSessions.legacy = { cookies: snapshot.cookies, localStorage: snapshot.localStorage, fallbackDomain: 'legacy.example.test' };
  await w.executeStep('use', { type: 'session', name: 'legacy' });
  assert.deepEqual(injected, [snapshot.cookies, snapshot.localStorage, 'legacy.example.test', undefined, undefined]);
});

test('SessionManager saves and reuses both storage types and origin without losing token injection', async () => {
  const data = new Map();
  const vault = { get: key => data.get(key), save: (key, value) => data.set(key, value) };
  const headers = [], calls = [];
  const web = { getState: async () => snapshot, injectStorage: async (...args) => calls.push(args) };
  const manager = new SessionManager(web, { setUnauthorizedHandler() {}, setGlobalHeader: (...args) => headers.push(args) }, vault);
  manager.register({ name: 'saved', acquire: async () => { throw new Error('Saved session must not reacquire'); },
    inject: { api: { headerName: 'Authorization', template: 'Bearer {{token}}' } } });
  manager.activeSession = { tokens: { accessToken: 'fixture-access' } };
  await manager.saveCurrentState('saved', true);
  await manager.useSession('saved');
  assert.deepEqual(calls[0], [snapshot.cookies, snapshot.localStorage, undefined, snapshot.sessionStorage, snapshot.storageOrigin]);
  assert.deepEqual(headers, [['Authorization', 'Bearer fixture-access']]);
  assert.equal(data.get('session_saved').persist, true);
});

test('legacy SessionManager records remain usable', async () => {
  const old = { name: 'legacy', cookies: [], localStorage: { theme: 'light' }, tokens: {}, persist: true };
  const calls = [];
  const manager = new SessionManager({ injectStorage: async (...args) => calls.push(args) }, { setUnauthorizedHandler() {} }, {
    get: () => old, save() {},
  });
  manager.register({ name: 'legacy', acquire: async () => ({}) });
  await manager.useSession('legacy');
  assert.deepEqual(calls[0], [[], { theme: 'light' }, undefined, undefined, undefined]);
});

for (const origin of [undefined, 'file:///tmp/private', 'not-an-origin']) test(`unknown or invalid origin fails before injecting temporary data: ${origin}`, async () => {
  let writes = 0;
  const adapter = new WebAdapter({ ci: true, headless: true, timeout: 100 });
  adapter.context = { addCookies: async () => writes++ };
  adapter.page = { url: () => 'about:blank', addInitScript: async () => writes++, evaluate: async () => writes++ };
  await assert.rejects(adapter.injectStorage([], {}, undefined, snapshot.sessionStorage, origin), /requires a saved HTTP\(S\) origin/);
  assert.equal(writes, 0);
});
