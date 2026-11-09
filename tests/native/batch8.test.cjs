const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const { Lexer } = require(path.join(root, 'dist/parser/lexer'));
const { Parser } = require(path.join(root, 'dist/parser/parser'));
const { ApplicationEvents } = require(path.join(root, 'dist/native/application_events'));
const { decodeVisualPNG } = require(path.join(root, 'dist/native/visual'));
const { WebAdapter } = require(path.join(root, 'dist/adapters/web/playwright'));
const { PNG } = require(require.resolve('pngjs', { paths: [root] }));

const parse = source => new Parser(new Lexer(source).tokenise()).parse();
const flow = assertion => `Feature: Observe application behavior
Scenario: Watch a named event
Given "Set up the observer"
flow.console.arm {"name":"saved","contains":"Saved","level":"info"};
When "Save the record"
flow.click button "Save";
And "Verify the event"
${assertion}
Then "Finish"
flow.expect visible "Saved";
`;

test('Batch 8 assertion commands accept And and soft syntax while terminal Then and Feature remain enforced', () => {
  for (const command of [
    'flow.console.expect {"name":"saved"};',
    'flow.channel.expect {"name":"updates","path":"ok","equals":true};',
    'flow.visual.match {"target":"Summary","baseline":"baselines/summary.png"};',
  ]) {
    assert.equal(parse(flow(command))[0].scenarios[0].steps[2].action, 'native');
    assert.equal(parse(flow(command.replace('flow.', 'flow.soft ')))[0].scenarios[0].steps[2].payload.soft, true);
    assert.throws(() => parse(flow(command) + 'And "Too late"\n' + command), /Terminal Lock/);
    assert.throws(() => parse(flow(command) + 'Feature: Another feature'), /Feature|Unexpected|Terminal Lock/i);
  }
  for (const command of [
    'flow.console.arm {"name":"saved","contains":"Saved"};',
    'flow.channel.arm {"name":"stream","protocol":"sse","url":"**/updates"};',
    'flow.visual.capture {"name":"candidate"};',
  ]) assert.throws(() => parse(flow(command)), /And.*assertion/i);
});

test('Batch 8 expected errors acknowledge one exact occurrence and leave other errors visible', async () => {
  const page = new EventEmitter();
  const web = new WebAdapter({ timeout: 100 });
  web.getPage = () => page;
  page.on('pageerror', error => web.recordPageError(error));
  const observer = new ApplicationEvents(web, 100);
  await observer.console('arm', { name: 'expected', level: 'pageerror', contains: 'Validation fixture' });
  await observer.console('arm', { name: 'duplicate-observer', level: 'pageerror', contains: 'Validation fixture' });
  page.emit('pageerror', Error('Validation fixture'));
  page.emit('pageerror', Error('Validation fixture'));
  page.emit('pageerror', Error('Unrelated failure'));
  await observer.console('expect', { name: 'expected' });
  await assert.rejects(observer.console('expect', { name: 'duplicate-observer' }), /already claimed/);
  assert.deepEqual(web.pageErrors.filter(Boolean), ['Validation fixture', 'Unrelated failure']);
  assert.equal(page.listenerCount('pageerror'), 1);
});

test('Batch 8 console observer is one-shot, tab scoped and cancellable without printing captured secrets', async () => {
  const first = new EventEmitter(), second = new EventEmitter();
  let page = first;
  const events = new ApplicationEvents({ getPage: () => page, activeProfile: 'default' }, 500);
  const message = (type, body) => ({ type: () => type, text: () => body });
  await events.console('arm', { name: 'ready', level: 'warn', contains: 'ready' });
  second.emit('console', message('warning', 'ready'));
  first.emit('console', message('info', 'ready'));
  first.emit('console', message('warning', 'private-console-string'));
  page = second;
  await assert.rejects(events.console('expect', { name: 'ready' }), /active tab/);
  page = first;
  await assert.rejects(events.console('expect', { name: 'ready', timeout: 35 }), error =>
    /timed out/.test(error.message) && /1 message/.test(error.message) && !error.message.includes('private-console-string'));
  assert.equal(first.listenerCount('console'), 0);
  await events.console('arm', { name: 'ready', level: 'warn', contains: 'ready' });
  const result = events.console('expect', { name: 'ready', timeout: 10000 });
  const rejected = assert.rejects(result, /cancelled/);
  events.cancel();
  await rejected;
  assert.equal(first.listenerCount('close'), 0);
});

test('Batch 8 WebSocket observer validates options, keeps typed observations bounded and detaches sockets', async () => {
  const page = new EventEmitter(), socket = new EventEmitter(), foreign = new EventEmitter();
  socket.url = () => 'ws://localhost/updates';
  foreign.url = () => 'ws://localhost/unrelated';
  const events = new ApplicationEvents({ getPage: () => page, activeProfile: 'default' }, 100);
  await assert.rejects(events.channel('arm', { name: 'wrong', protocol: 'sse', url: '**/updates', direction: 'sent' }), /SSE accepts event/);
  await assert.rejects(events.channel('arm', { name: 'wrong', protocol: 'websocket', url: 'https://localhost/updates' }), /wrong protocol/);
  await events.channel('arm', { name: 'updates', protocol: 'websocket', url: '**/updates' });
  page.emit('websocket', socket);
  page.emit('websocket', foreign);
  for (let i = 0; i < 34; i++) socket.emit('framereceived', { payload: '{"ok":"false"}' });
  socket.emit('framesent', { payload: '{"ok":false}' });
  foreign.emit('framereceived', { payload: '{"ok":false}' });
  socket.emit('framereceived', { payload: Buffer.from('{"ok":false}') });
  const waiting = events.channel('expect', { name: 'updates', path: 'ok', equals: false });
  socket.emit('framereceived', { payload: '{"ok":false}' });
  await waiting;
  assert.equal(socket.listenerCount('framereceived'), 0);
  assert.equal(page.listenerCount('websocket'), 0);

  await events.channel('arm', { name: 'sent', protocol: 'websocket', url: '**/updates', direction: 'sent' });
  page.emit('websocket', socket);
  await assert.rejects(events.channel('expect', { name: 'sent', path: '__proto__.secret', equals: true }), /Unsafe property/);
  socket.emit('framesent', { payload: 'outbound-fixture' });
  await events.channel('expect', { name: 'sent', equals: 'outbound-fixture' });
  assert.equal(socket.listenerCount('framesent'), 0);
});

test('Batch 8 PNG decoder rejects oversized, interlaced and malformed inputs before comparison', () => {
  const good = PNG.sync.write(new PNG({ width: 2, height: 3 }));
  const decoded = decodeVisualPNG(good);
  assert.deepEqual([decoded.width, decoded.height], [2, 3]);
  const large = Buffer.from(good);
  large.writeUInt32BE(5000, 16);
  assert.throws(() => decodeVisualPNG(large), /4096/);
  const interlaced = Buffer.from(good);
  interlaced[28] = 1;
  assert.throws(() => decodeVisualPNG(interlaced), /non-interlaced/);
  assert.throws(() => decodeVisualPNG(good.subarray(0, 40)), /valid PNG/);
  assert.throws(() => decodeVisualPNG(Buffer.from('not an image')), /must be PNG/);
});

test('Batch 8 rejects private and linked baseline paths before attempting a browser capture', async t => {
  const { visual } = require(path.join(root, 'dist/native/visual'));
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch8-baselines-')));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectRoot, '.flowstride'));
  fs.writeFileSync(path.join(projectRoot, '.flowstride/private.png'), PNG.sync.write(new PNG({ width: 2, height: 2 })));
  fs.symlinkSync('.flowstride/private.png', path.join(projectRoot, 'linked.png'));
  const web = { getPage: () => assert.fail('Unsafe baseline accessed the browser') };
  for (const file of ['../outside.png', path.join(projectRoot, '.flowstride/private.png'), '.flowstride/private.png', 'linked.png']) {
    await assert.rejects(visual(web, { projectRoot }, 'match', { baseline: file }), /project-relative|private runtime state|symbolic link/i);
  }
});
