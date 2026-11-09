const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const { ApiAdapter } = require(path.join(root, 'dist/adapters/api/undici'));
const { Lexer } = require(path.join(root, 'dist/parser/lexer'));
const { Parser } = require(path.join(root, 'dist/parser/parser'));
const { artifactPrefix } = require(path.join(root, 'dist/utils/projectPaths'));

const parse = source => new Parser(new Lexer(source).tokenise()).parse();
const flow = (when, and = 'flow.expect status "200";') => `Feature: API contracts
Scenario: A service responds
Given "A service exists"
flow.get "/health";
When "Use the service"
${when}
And "Inspect the response"
${and}
Then "Verify status"
flow.expect status "200";
`;

function project(t) {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch7-')));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  return {
    projectRoot,
    write(name, data) {
      const file = path.join(projectRoot, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
      return file;
    },
  };
}

async function service(t, handle) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = { url: new URL(req.url, 'http://localhost'), method: req.method, headers: req.headers, body: Buffer.concat(chunks) };
    requests.push(data);
    await handle(data, res, req);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

const json = (res, value, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
const execute = (api, action, data, report) => api.executeNative(action, data, report);

test('API language preserves terminal Then and allows only schema assertions in And', () => {
  const when = 'flow.api.request {"method":"HEAD","url":"/health"};';
  const assertion = 'flow.api.expectSchema {"file":"schemas/customer.json"};';
  assert.equal(parse(flow(when, assertion))[0].scenarios[0].steps[2].payload.pluginMethod, 'api.expectSchema');
  assert.equal(parse(flow(when, 'flow.soft api.expectSchema {"file":"schemas/customer.json"};'))[0].scenarios[0].steps[2].payload.soft, true);
  assert.throws(() => parse(flow(when, when)), /And.*assertion/i);
  assert.throws(() => parse(flow(when, 'flow.api.poll {"url":"/job","path":"done","equals":true};')), /And.*assertion/i);
  assert.throws(() => parse(flow(when, assertion) + 'And "Too late"\n' + assertion), /Terminal Lock/);
  assert.equal(parse(flow(when, assertion) + 'Scenario: Another service\nGiven "Prepare"\nWhen "Use"\nThen "Verify"\n')[0].scenarios.length, 2);
});

test('structured requests transmit JSON, form, multipart, raw, binary, HEAD, OPTIONS and repeated query parameters', async t => {
  const p = project(t);
  const bytes = Buffer.from([0, 1, 0xff, 0, 2]);
  p.write('fixtures/document.bin', bytes);
  const s = await service(t, (req, res) => {
    if (req.url.pathname === '/binary') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(bytes);
    }
    json(res, { accepted: true });
  });
  const api = new ApiAdapter({ ...p, baseUrl: s.url, testFile: 'documents.flow' });
  const send = data => execute(api, 'request', { url: '/echo', method: 'POST', ...data });
  await send({ json: { active: false, count: 2 }, headers: { 'X-Test': 'fixture' }, query: { a: ['one', 'two'], count: 2 } });
  assert.deepEqual(JSON.parse(s.requests[0].body), { active: false, count: 2 });
  assert.deepEqual(s.requests[0].url.searchParams.getAll('a'), ['one', 'two']);
  assert.equal(s.requests[0].url.searchParams.get('count'), '2');
  assert.equal(s.requests[0].headers['x-test'], 'fixture');
  assert.deepEqual(api.getState().body, { accepted: true });
  await send({ form: { city: 'Port Harcourt', list: [true, 2] } });
  assert.equal(s.requests[1].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(s.requests[1].body.toString(), 'city=Port+Harcourt&list=true&list=2');
  await send({ multipart: { description: 'Test document', file: { path: 'fixtures/document.bin', contentType: 'application/octet-stream' } } });
  assert.match(s.requests[2].headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(s.requests[2].body.toString(), /name="description"\r\n\r\nTest document/);
  assert.match(s.requests[2].body.toString(), /name="file"; filename="document.bin"/);
  assert(s.requests[2].body.includes(bytes));
  await send({ body: 'raw data' });
  assert.equal(s.requests[3].body.toString(), 'raw data');
  await send({ binary: { path: 'fixtures/document.bin' } });
  assert.deepEqual(s.requests[4].body, bytes);
  await execute(api, 'request', { method: 'HEAD', url: '/echo' });
  assert.equal(s.requests[5].method, 'HEAD');
  assert.equal(api.getState().body, null);
  await execute(api, 'request', { method: 'OPTIONS', url: '/echo' });
  assert.equal(s.requests[6].method, 'OPTIONS');
  await execute(api, 'request', { url: '/binary', saveAs: 'document.bin' });
  const file = path.join(p.projectRoot, '.flowstride/api-responses', artifactPrefix('documents.flow') + 'document.bin');
  assert.deepEqual(fs.readFileSync(file), bytes);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(api.getState().body, null);
});

test('request security blocks private fixtures, outside paths, unsafe headers, linked output and oversized responses', async t => {
  const p = project(t);
  const secret = p.write('.env', 'PASSWORD=batch7-fixture-secret');
  const valid = p.write('regular.txt', 'fixture');
  p.write('too-big.bin', Buffer.alloc(20 * 1024 * 1024 + 1));
  fs.symlinkSync(secret, path.join(p.projectRoot, 'linked.txt'));
  const s = await service(t, (req, res) => {
    if (req.url.pathname === '/oversized') {
      res.setHeader('Content-Type', 'application/json');
      res.write(' '.repeat(600000));
      return res.end(' '.repeat(600000));
    }
    json(res, { ok: true });
  });
  const api = new ApiAdapter({ ...p, baseUrl: s.url });
  const send = data => execute(api, 'request', { method: 'POST', url: '/', ...data });
  for (const [data, expected] of [
    [{ json: {}, form: { x: 1 } }, /one API body source/],
    [{ method: 'GET', body: 'no' }, /cannot have a body/],
    [{ headers: { 'Content-Length': '99' } }, /framing/],
    [{ headers: { 'X-Test': 'line\r\ninjection' } }, /invalid header/],
    [{ url: 'file:///etc/passwd' }, /HTTP\(S\)/],
    [{ url: 'https://user:password@example.test/' }, /embedded credentials/],
    [{ multipart: { file: { path: '.env' } } }, /private runtime state/i],
    [{ binary: { path: 'linked.txt' } }, /private runtime state|symbolic link/i],
    [{ binary: { path: '../escape.bin' } }, /inside the project/],
    [{ binary: { path: 'too-big.bin' } }, /limit/],
    [{ saveAs: '../result.bin' }, /simple name/],
  ]) await assert.rejects(send(data), expected);
  assert.equal(s.requests.length, 0);
  fs.mkdirSync(path.join(p.projectRoot, '.flowstride/api-responses'), { recursive: true });
  fs.symlinkSync(valid, path.join(p.projectRoot, '.flowstride/api-responses/linked.bin'));
  await assert.rejects(send({ saveAs: 'linked.bin' }), /link|regular/i);
  assert.equal(fs.readFileSync(valid, 'utf8'), 'fixture');
  await assert.rejects(execute(api, 'request', { url: '/oversized' }), /exceeds the 1 MiB limit/);
  assert.throws(() => api.getState(), /No API request/);
});

test('named contexts isolate cookies, authorization and last response with checkpoint and file reset', async t => {
  const s = await service(t, (req, res) => {
    if (req.url.pathname === '/login') res.setHeader('Set-Cookie', [`identity=${req.headers['x-actor']}; HttpOnly; Path=/`, 'other=valid; Path=/private']);
    json(res, { actor: req.headers['x-actor'] || null, cookie: req.headers.cookie || null, auth: req.headers.authorization || null });
  });
  const api = new ApiAdapter({ baseUrl: s.url });
  api.setGlobalHeader('Authorization', 'Bearer default-fixture');
  await api.get('/whoami');
  const use = name => execute(api, 'use', { name });
  for (const name of ['customer', 'admin']) {
    await execute(api, 'create', { name, cookies: true, headers: { 'X-Actor': name, Authorization: `Bearer ${name}-fixture` } });
    await use(name);
    assert.throws(() => api.getState(), /No API request/);
    await api.post('/login', [], '{}');
    await api.get('/whoami');
    assert.deepEqual(api.getState().body, { actor: name, cookie: `identity=${name}`, auth: `Bearer ${name}-fixture` });
    assert.equal(api.getLegacySessionState(), undefined);
    assert.equal(api.snapshotHeaders().Authorization, 'Bearer default-fixture');
  }
  const checkpoint = api.checkpointState();
  await use('customer');
  assert.equal(api.getState().body.actor, 'customer');
  await use('default');
  assert.equal(api.getState().body.auth, 'Bearer default-fixture');
  assert.equal(api.getState().body.cookie, null);
  await execute(api, 'close', { name: 'admin' });
  await assert.rejects(use('admin'), /Unknown API context/);
  api.restoreState(checkpoint);
  await api.get('/private');
  assert.match(api.getState().body.cookie, /identity=admin/);
  assert.match(api.getState().body.cookie, /other=valid/);
  api.resetState();
  await assert.rejects(use('admin'), /Unknown API context/);
  await api.get('/whoami');
  assert.equal(api.getState().body.auth, 'Bearer default-fixture');
});

test('redirects never disclose credentials cross-origin or silently replay a mutation', async t => {
  const foreign = await service(t, (req, res) => json(res, { foreign: true }));
  const origin = await service(t, (req, res) => {
    if (req.url.pathname === '/cross') { res.writeHead(302, { location: foreign.url }); return res.end(); }
    if (req.url.pathname === '/same') { res.writeHead(302, { location: '/destination' }); return res.end(); }
    if (req.url.pathname === '/repeat') { res.writeHead(307, { location: '/destination' }); return res.end(); }
    json(res, { method: req.method, auth: req.headers.authorization });
  });
  const api = new ApiAdapter({ baseUrl: origin.url });
  api.setGlobalHeader('Authorization', 'Bearer fixture-private');
  const get = (url, options) => execute(api, 'request', { url, ...options });
  await get('/cross');
  assert.equal(api.getState().status, 302);
  await assert.rejects(get('/cross', { followRedirects: true }), /changes origin/);
  assert.equal(foreign.requests.length, 0);
  await get(foreign.url);
  assert.equal(foreign.requests[0].headers.authorization, undefined);
  await get('/same', { method: 'POST', json: {}, followRedirects: true });
  assert.deepEqual(api.getState().body, { method: 'GET', auth: 'Bearer fixture-private' });
  await assert.rejects(get('/repeat', { method: 'POST', json: {}, followRedirects: true }), /would resend a POST/);
  assert.equal(origin.requests.filter(req => req.url.pathname === '/destination').length, 1);
  await execute(api, 'create', { name: 'scoped', cookies: true });
  await execute(api, 'use', { name: 'scoped' });
  await assert.rejects(api.get(foreign.url), /limited to the origin/);
  assert.equal(foreign.requests.length, 1);
});

test('schema assertions validate Draft 7 and 2020-12, report paths and rules, and withhold data', async t => {
  const p = project(t);
  const remote = await service(t, (req, res) => json(res, {}));
  const s = await service(t, (req, res) => json(res, {
    address: { postcode: 1001 }, privateField: 'batch7-private-body-value',
  }));
  p.write('valid.json', { type: 'object', properties: { address: { $ref: '#/definitions/address' } }, definitions: { address: { type: 'object' } } });
  p.write('draft2020.json', { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', $defs: { code: { type: 'integer' } }, properties: { address: { properties: { postcode: { $ref: '#/$defs/code' } } } } });
  p.write('wrong.json', { properties: { address: { properties: { postcode: { type: 'string' } } } } });
  p.write('missing.json', { properties: { address: { required: ['street'] } } });
  p.write('remote.json', { $ref: remote.url + '/private-schema' });
  const api = new ApiAdapter({ ...p, baseUrl: s.url });
  await api.get('/customer');
  let result;
  const check = file => execute(api, 'expectSchema', { file }, value => { result = value; });
  await check('valid.json');
  assert.equal(result.status, 'passed');
  await check('draft2020.json');
  await assert.rejects(check('wrong.json'), error => /\/address\/postcode/.test(error.message) &&
    /rule "type"/.test(error.message) && !/batch7-private-body-value/.test(error.message));
  assert.equal(result.status, 'failed');
  await assert.rejects(check('missing.json'), /\/address\/street/);
  await assert.rejects(check('remote.json'), /Use references within the same file/);
  assert.equal(remote.requests.length, 0);
});

test('schema evaluation is bounded even for a pathological regular expression', async t => {
  const p = project(t);
  const s = await service(t, (req, res) => json(res, { text: 'a'.repeat(20000) + '!' }));
  p.write('regex.json', { properties: { text: { pattern: '^(a+)+$' } } });
  const api = new ApiAdapter({ ...p, baseUrl: s.url });
  await api.get('/payload');
  await assert.rejects(execute(api, 'expectSchema', { file: 'regex.json', timeout: 450 }), /timed out after 450 ms/);
  assert.equal(api.getState().status, 200);
});

test('polling uses typed equality, retries only GET, retains last response and aborts a stalled body', async t => {
  let count = 0;
  let onStall;
  const stalled = new Promise(resolve => { onStall = resolve; });
  const s = await service(t, (req, res) => {
    if (req.url.pathname === '/stall') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      onStall();
      return;
    }
    if (req.url.pathname === '/unauthorized') return json(res, {}, 401);
    if (req.url.pathname === '/private') return json(res, { password: 'fixture-batch7-password' });
    count++;
    json(res, { ready: count === 1 ? 'true' : true });
  });
  const api = new ApiAdapter({ baseUrl: s.url });
  await execute(api, 'poll', { url: '/job', path: 'ready', equals: true, interval: 50, timeout: 2500 });
  assert.equal(count, 2);
  assert.equal(api.getState().body.ready, true);
  assert(s.requests.every(req => req.method === 'GET'));
  await assert.rejects(execute(api, 'poll', { url: '/unauthorized', path: 'ready', equals: true }), /HTTP 401/);
  assert.equal(api.getState().status, 401);
  await assert.rejects(execute(api, 'poll', { url: '/private', path: 'password', equals: 'fixture-batch7-expected', timeout: 220 }), error =>
    /timed out/.test(error.message) && !/fixture-batch7-(?:password|expected)/.test(error.message));
  await assert.rejects(execute(api, 'poll', { url: '/job', path: 'constructor.prototype', equals: true }), /Unsafe property/);
  const request = execute(api, 'request', { url: '/stall', timeout: 5000 });
  const rejected = assert.rejects(request, /cancelled/);
  await stalled;
  api.cancelNativeRequests();
  await rejected;
  api.resetCancellation();
  await assert.rejects(execute(api, 'request', { url: '/stall', timeout: 150 }), /timed out after 150 ms/);
});

const compatPath = path.join(root, 'dist/native/compatibility.js');
test('handoff detects delayed routes and nested Batch 7 fragments, while legacy routes retain compatibility', { skip: require(path.join(root, 'package.json')).name !== 'flowstride' }, t => {
  const { needsNativeApiProtocol } = require(compatPath);
  assert.equal(typeof needsNativeApiProtocol, 'function');
  const p = project(t);
  const legacy = p.write('legacy.flow', flow('flow.network.route {"name":"plain","url":"**/job","json":{}};'));
  const modern = p.write('modern.flow', flow('flow.network.route {"name":"slow","url":"**/job","json":{},"delay":25};'));
  const fragment = p.write('fragment.flow', flow('flow.call "outer.flowpart";'));
  p.write('outer.flowpart', 'flow.call "inner.flowpart";');
  p.write('inner.flowpart', 'flow.api.request {"method":"HEAD","url":"/health"};');
  assert.equal(needsNativeApiProtocol(legacy, p), false);
  assert.equal(needsNativeApiProtocol(modern, p), true);
  assert.equal(needsNativeApiProtocol(fragment, p), true);
});

test('delayed network routes count only matching bodies and abort promptly on removal', async () => {
  const { NativeEvents } = require(path.join(root, 'dist/native/events'));
  const handlers = new Map();
  const changes = [];
  const context = {
    route: async (pattern, handler) => { changes.push('attach'); handlers.set(pattern, handler); },
    unroute: async (pattern, handler) => { changes.push('detach'); if (handlers.get(pattern) === handler) handlers.delete(pattern); },
  };
  const web = { activeProfile: 'default', getContext: () => context, pageErrors: [] };
  const events = new NativeEvents(web, { timeout: 1000 });
  const body = (bytes, method = 'POST') => ({
    request: () => ({ method: () => method, postDataBuffer: () => Buffer.from(bytes) }),
    fallback: async () => 'fallthrough',
    fulfill: async () => {},
    abort: async () => {},
  });
  const url = '**/jobs';
  const match = { name: 'jobs', url, method: 'POST', requestBody: { path: 'job.priority', equals: true }, json: {} };
  await assert.rejects(events.network('route', { ...match, requestBody: { path: 'job.__proto__', equals: true } }), /Unsafe property/);
  await events.network('route', { ...match, delay: 80, times: 1 });
  const handler = handlers.get(url);
  for (const data of ['invalid JSON', '{"job":{"priority":"true"}}', '{"unrelated":true}', ' '.repeat(1024 * 1024 + 1)]) {
    let fallback = false;
    await handler({ ...body(data), fallback: async () => { fallback = true; } });
    assert(fallback);
    assert.equal(handlers.get(url), handler);
  }
  let fulfilled = false;
  const started = performance.now();
  await handler({ ...body('{"job":{"priority":true}}'), fulfill: async () => { fulfilled = true; } });
  assert(fulfilled);
  assert(performance.now() - started >= 70);
  let fellThrough = false;
  await handler({
    ...body('{"job":{"priority":true}}'),
    fallback: async () => { fellThrough = true; },
    fulfill: async () => assert.fail('An exhausted route must only pass requests through'),
  });
  assert(fellThrough);
  assert.deepEqual(changes, ['attach']);
  await events.network('route', { ...match, delay: 20000, times: 1 });
  assert.notEqual(handlers.get(url), handler);
  assert.deepEqual(changes, ['attach', 'attach', 'detach']);
  let aborted = false;
  const pending = handlers.get(url)({
    ...body('{"job":{"priority":true}}'),
    abort: async () => { aborted = true; },
    fulfill: async () => assert.fail('A cancelled route must not fulfill'),
  });
  await events.network('unroute', { name: 'jobs' });
  await pending;
  assert(aborted);
  assert.equal(handlers.size, 0);
  assert.deepEqual(web.pageErrors, []);
  await events.network('route', { ...match, times: 1 });
  await handlers.get(url)(body('{"job":{"priority":true}}'));
  await events.dispose();
  assert.equal(handlers.size, 0);
});
