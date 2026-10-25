const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { ApiProxy } = require('../../dist/sdk/api_proxy');
const { ApiAdapter } = require('../../dist/adapters/api/undici');
const { PluginManager } = require('../../dist/runner/plugin_manager');
const { TemporaryStore } = require('../../dist/runner/temporary_store');

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-plugin-runtime-'));
  fs.mkdirSync(path.join(root, 'plugins'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fs.realpathSync(root);
}

async function inProject(root, action) {
  const previous = process.cwd();
  process.chdir(root);
  try { return await action(); } finally { process.chdir(previous); }
}

function manager(root, store, baseUrl) {
  const config = {
    projectRoot: root, pluginsDir: path.join(root, 'plugins'),
    artifactsDir: path.join(root, 'artifacts'), testFile: 'flows/plugin.flow',
    timeout: 3000, headless: true, ci: true, baseUrl,
  };
  const web = { getPage() { throw new Error('This plugin must not access the browser.'); } };
  return new PluginManager(config, web, store, new ApiProxy(new ApiAdapter(config)));
}

test('plugin HTTP proxy preserves each method, body/header argument order and response body', async () => {
  const calls = [], response = { verified: true };
  const adapter = { getState: () => ({ body: response }) };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    adapter[method] = async (...args) => { calls.push([method, ...args]); };
  }
  const api = new ApiProxy(adapter), headers = { 'X-Fixture': 'kept' };
  assert.equal(await api.get('/get', headers), response);
  assert.equal(await api.post('/post', { nested: { count: 2 } }, headers), response);
  assert.equal(await api.put('/put', 'exact raw body', headers), response);
  assert.equal(await api.patch('/patch', { enabled: false }, headers), response);
  assert.equal(await api.delete('/delete', headers), response);
  assert.equal(await api.get('/without-headers'), response);
  const formatted = [{ key: 'X-Fixture', value: 'kept' }];
  assert.deepEqual(calls, [
    ['get', '/get', formatted],
    ['post', '/post', formatted, '{"nested":{"count":2}}'],
    ['put', '/put', formatted, 'exact raw body'],
    ['patch', '/patch', formatted, '{"enabled":false}'],
    ['delete', '/delete', formatted],
    ['get', '/without-headers', []],
  ]);
  assert.deepEqual(headers, { 'X-Fixture': 'kept' });
});

test('plugin HTTP proxy propagates transport failures instead of returning stale state', async () => {
  let reads = 0;
  const adapter = { getState() { reads++; return { body: 'stale response' }; } };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    adapter[method] = async () => { throw new Error('fixture transport failed'); };
  }
  const api = new ApiProxy(adapter);
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    await assert.rejects(api[method]('/fixture', ...(method === 'get' || method === 'delete' ? [] : [{}])), /fixture transport failed/);
  }
  assert.equal(reads, 0);
});

test('temporary state deletion and clearing preserve unrelated keys and separate stores', () => {
  const first = new TemporaryStore(), second = new TemporaryStore();
  first.set('remove', { account: 1 }); first.set('keep', false); first.set('__proto__', 'ordinary key');
  second.set('remove', 'other scope');
  assert.equal(first.delete('remove'), true);
  assert.equal(first.get('remove'), undefined);
  assert.equal(first.has('remove'), false);
  assert.equal(first.delete('remove'), false);
  assert.equal(first.get('keep'), false);
  assert.equal(first.get('__proto__'), 'ordinary key');
  first.clear();
  assert.deepEqual(first.getAll(), {});
  assert.equal(second.get('remove'), 'other scope');
});

test('executed TypeScript plugins send all five HTTP verbs through the real adapter', async t => {
  const root = project(t), requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8'); req.on('data', part => { body += part; });
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, body, marker: req.headers['x-plugin-fixture'], contentType: req.headers['content-type'] ?? null };
      requests.push(entry); res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ...entry, received: true }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(root, 'plugins/http.ts'), `
export async function exercise(sdk: any) {
  const headers = { 'X-Plugin-Fixture': 'preserved' };
  const result = [
    await sdk.api.get('/get?source=plugin', headers),
    await sdk.api.post('/post', { name: 'reader', nested: [1, false] }, headers),
    await sdk.api.put('/put', 'literal body', { ...headers, 'Content-Type': 'text/plain' }),
    await sdk.api.patch('/patch', { enabled: false }, headers),
    await sdk.api.delete('/delete', headers),
  ];
  return { result, headers };
}
`);
  await inProject(root, async () => {
    const store = new TemporaryStore(), plugins = manager(root, store, baseUrl);
    const output = await plugins.execute('http.exercise', {}, 'savedResponse');
    assert.deepEqual(output.result.map(entry => entry.method), ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    assert.deepEqual(output.result.map(entry => entry.body), ['', '{"name":"reader","nested":[1,false]}', 'literal body', '{"enabled":false}', '']);
    assert.equal(output.result[0].url, '/get?source=plugin');
    assert.equal(output.result[2].contentType, 'text/plain');
    assert.equal(output.result[1].contentType, 'application/json');
    assert(output.result.every(entry => entry.received && entry.marker === 'preserved'));
    assert.deepEqual(output.headers, { 'X-Plugin-Fixture': 'preserved' });
    assert.equal(store.get('savedResponse'), output);
    assert.equal(requests.length, 5);
  });
});

test('plugin state.delete and state.clear take effect across calls without crossing stores', async t => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'plugins/state.ts'), `
export async function change(sdk: any, args: any) {
  if (args.action === 'set') sdk.state.set(args.key, args.value);
  if (args.action === 'delete') sdk.state.delete(args.key);
  if (args.action === 'clear') sdk.state.clear();
  return { value: sdk.state.get(args.key), keep: sdk.state.get('keep') };
}
`);
  await inProject(root, async () => {
    const first = new TemporaryStore(), second = new TemporaryStore();
    first.set('keep', 'same scope'); second.set('entry', 'other scope');
    const plugins = manager(root, first), isolated = manager(root, second);
    assert.equal((await plugins.execute('state.change', { action: 'set', key: 'entry', value: { id: 7 } })).value.id, 7);
    const deleted = await plugins.execute('state.change', { action: 'delete', key: 'entry' });
    assert.deepEqual(deleted, { value: undefined, keep: 'same scope' });
    assert.equal(first.has('entry'), false);
    assert.equal((await plugins.execute('state.change', { action: 'delete', key: 'missing' })).value, undefined);
    assert.equal((await isolated.execute('state.change', { key: 'entry' })).value, 'other scope');
    await plugins.execute('state.change', { action: 'clear', key: 'keep' });
    assert.deepEqual(first.getAll(), {});
    assert.equal(second.get('entry'), 'other scope');
  });
});

test('plugin runtime retains project containment and rejects attachment traversal', async t => {
  const root = project(t), outside = project(t);
  fs.writeFileSync(path.join(outside, 'external.ts'), 'export async function run() { throw new Error("outside plugin executed"); }');
  fs.symlinkSync(path.join(outside, 'external.ts'), path.join(root, 'plugins/escape.ts'));
  fs.writeFileSync(path.join(root, 'plugins/attachment.ts'), `
export async function attach(sdk: any, args: any) { return sdk.run.attach(args.name, args.body); }
export async function fail() { throw new Error('fixture plugin failure'); }
`);
  await inProject(root, async () => {
    const plugins = manager(root, new TemporaryStore());
    await assert.rejects(plugins.execute('../external.run', {}), /project|workspace|traversal/i);
    await assert.rejects(plugins.execute('escape.run', {}), /project|workspace/i);
    for (const name of ['../escape.txt', '/absolute.txt', '.', '..', 'sub/file.txt', 'sub\\file.txt']) {
      await assert.rejects(plugins.execute('attachment.attach', { name, body: 'fixture' }), /Attachment name/);
    }
    const attached = await plugins.execute('attachment.attach', { name: 'proof.json', body: '{"verified":true}' });
    assert.equal(path.dirname(attached), path.join(root, 'artifacts'));
    assert.equal(fs.readFileSync(attached, 'utf8'), '{"verified":true}');
    await assert.rejects(plugins.execute('attachment.fail', {}), /Plugin Execution Failed.*fixture plugin failure/);
    assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
  });
});
