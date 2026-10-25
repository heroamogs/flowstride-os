const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { Writable } = require('node:stream');
const { createRequire } = require('node:module');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { isLocalWorkspaceRequest } = requireRoot('./dist/security/localWorkspace.js');
const { WebSocket, WebSocketServer } = requireRoot('ws');

for (const [host, origin, port, site, expected] of [
  ['127.0.0.1:4321', undefined, 4321, undefined, true],
  ['localhost:4321', 'http://localhost:4321', 4321, 'same-origin', true],
  ['[::1]:4321', 'http://[::1]:4321', 4321, undefined, true],
  ['localhost:4322', 'http://localhost:4322', 4321, undefined, false],
  ['localhost:4321', 'http://127.0.0.1:4321', 4321, undefined, false],
  ['localhost:4321', 'https://attacker.test', 4321, undefined, false],
  ['localhost:4321', 'null', 4321, undefined, false],
  ['attacker.test:4321', undefined, 4321, undefined, false],
  ['localhost:4321', 'http://localhost:4321', 4321, 'cross-site', false],
  ['localhost:4321', undefined, undefined, undefined, false],
  ['localhost:4321', undefined, 0, undefined, false],
]) test(`manual workspace policy: ${host}, ${origin}, bound ${port}, ${site}`, () => {
  assert.equal(isLocalWorkspaceRequest(host, origin, port, site), expected);
});

async function workspace(options = {}) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-manual-boundary-'));
  let server, wss, listenArgs, opened;
  const responses = [];
  const deps = {
    '../../utils/projectPaths': requireRoot('./dist/utils/projectPaths.js'),
    '../../utils/cloud': requireRoot('./dist/utils/cloud.js'),
    '../../manual/security': requireRoot('./dist/manual/security.js'),
    '../../security/localWorkspace': requireRoot('./dist/security/localWorkspace.js'),
    http: { ...http, createServer(handler) { server = http.createServer((req, res) => {
      if (options.uploadSize) { const emit = req.emit.bind(req); req.emit = (event, ...args) => emit(event, ...(event === 'data' ? [{ length: options.uploadSize }] : args)); }
      const writeHead = res.writeHead.bind(res);
      res.writeHead = (...args) => { responses.push({ url: req.url, status: args[0] }); return writeHead(...args); };
      handler(req, res);
    }); const listen = server.listen.bind(server); server.listen = (...args) => { listenArgs = args; return listen(...args); }; return server; } },
    path, fs: { ...fs, createWriteStream: options.createWriteStream || fs.createWriteStream }, os: { ...os, homedir: () => stage },
    axios: options.axios || { post() { throw new Error('Unexpected live Cloud request'); } },
    ws: { WebSocketServer: class extends WebSocketServer { constructor(options) { super(options); wss = this; } } },
    chalk: requireRoot('chalk'), open: async url => { opened = url; },
  };
  const module = { exports: {} };
  const code = requireRoot('typescript').transpileModule(fs.readFileSync(path.join(root, 'src/cli/manual_server/workspace_server.ts'), 'utf8'), {
    compilerOptions: { module: 1, target: 9, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert(name in deps, name); return deps[name]; },
    process: { env: options.env || {}, cwd: () => stage, on() {}, exit(code) { throw new Error('Unexpected exit ' + code); } },
    __dirname: path.join(root, 'dist/cli/manual_server'), Buffer, URL,
    console: { log() {}, warn() {}, error() {} },
  });
  await module.exports.startManualWorkspaceServer();
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  await new Promise(resolve => setImmediate(resolve));
  const port = server.address().port, origin = `http://127.0.0.1:${port}`, host = `127.0.0.1:${port}`;
  async function request(route, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(origin + route, { method, headers: { Host: host, ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject); req.end(body);
    });
  }
  return { stage, port, host, origin, request, responses, get opened() { return opened; }, get listenArgs() { return listenArgs; },
    async close() { for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(stage, { recursive: true, force: true }); } };
}
function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

test('manual server binds only loopback and rejects foreign, null and forged origins/hosts before all writes', async () => {
  const app = await workspace();
  try {
    assert.equal(app.listenArgs[1], '127.0.0.1'); assert.equal(app.opened, app.origin);
    const original = allFiles(app.stage);
    const attacks = [{ Origin: 'https://attacker.test' }, { Origin: 'null' }, { Origin: app.origin + '/spoof' },
      { Origin: `http://127.0.0.1:${app.port + 1}` }, { Host: `attacker.test:${app.port}` },
      { Host: `localhost:${app.port + 1}`, Origin: `http://localhost:${app.port + 1}` },
      { Origin: app.origin, 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of attacks) for (const [method, route] of [
      ['POST', '/api/save-design'], ['POST', '/api/save-run'], ['POST', '/api/state'],
      ['POST', '/api/upload'], ['POST', '/api/upload-defect'],
      ['DELETE', '/api/template?filename=target.json'], ['DELETE', '/api/media?filepath=/media/target.png'],
      ['DELETE', '/api/defect-media?filepath=/defect_media/target.png'], ['GET', '/api/templates'], ['OPTIONS', '/api/save-design'],
    ]) {
      const result = await app.request(route, { method, headers, body: '{}' });
      assert.equal(result.status, 403, JSON.stringify({ method, route, headers, result }));
      assert.equal(result.headers['access-control-allow-origin'], undefined);
    }
    assert.deepEqual(allFiles(app.stage), original, 'rejected writes must create no files');
  } finally { await app.close(); }
});

test('manual same-origin saves, state, static UI, media ranges and preflight remain functional', async () => {
  const app = await workspace();
  try {
    const headers = { Origin: app.origin, 'Content-Type': 'application/json' };
    for (const route of ['save-design', 'save-run']) {
      const response = await app.request('/api/' + route, { method: 'POST', headers, body: JSON.stringify({ filename: 'boundary.json', canvasData: { nodes: [], groups: [], texts: [], connections: [] } }) });
      assert.equal(response.status, 200, response.body); assert.equal(response.headers['access-control-allow-origin'], app.origin);
    }
    assert.equal((await app.request('/api/state', { method: 'POST', headers, body: '{"activeFlowId":"boundary"}' })).status, 200);
    assert.equal(JSON.parse((await app.request('/api/state')).body).activeFlowId, 'boundary');
    assert.equal((await app.request('/')).status, 200);
    const preflight = await app.request('/api/upload', { method: 'OPTIONS', headers: { Origin: app.origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-File-Extension' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-origin'], app.origin);
    assert.match(preflight.headers['access-control-allow-headers'], /X-File-Extension/);
    for (const [route, prefix] of [['upload', '/media/'], ['upload-defect', '/defect_media/']]) {
      const upload = await app.request('/api/' + route, { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png' }, body: '0123456789' });
      assert.equal(upload.status, 200, upload.body); const location = JSON.parse(upload.body).url; assert(location.startsWith(prefix));
      const media = await app.request(location, { headers: { Origin: app.origin, Range: 'bytes=2-5' } });
      assert.equal(media.status, 206); assert.equal(media.body, '2345'); assert.equal(media.headers['content-range'], 'bytes 2-5/10');
    }
  } finally { await app.close(); }
});

function socketResult(app, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(app.origin.replace('http:', 'ws:'), options);
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket boundary test timed out')); }, 2000);
    socket.on('message', message => { clearTimeout(timeout); resolve({ connected: true, payload: JSON.parse(message) }); socket.close(); });
    socket.on('unexpected-response', (_request, response) => { clearTimeout(timeout); response.resume(); resolve({ connected: false, status: response.statusCode }); });
    socket.on('error', error => { clearTimeout(timeout); reject(error); });
  });
}
test('manual WebSocket upgrade requires the actual Host and exact same browser origin', async () => {
  const app = await workspace();
  try {
    const accepted = await socketResult(app, { origin: app.origin });
    assert.equal(accepted.connected, true); assert.equal(accepted.payload.type, 'CLI_CONTEXT');
    for (const options of [{}, { origin: 'null' }, { origin: 'https://attacker.test' },
      { origin: app.origin, headers: { Host: `attacker.test:${app.port}` } },
      { origin: `http://localhost:${app.port + 1}`, headers: { Host: `localhost:${app.port + 1}` } },
      { origin: app.origin, headers: { 'Sec-Fetch-Site': 'cross-site' } }]) {
      const denied = await socketResult(app, options); assert.deepEqual(denied, { connected: false, status: 401 });
    }
  } finally { await app.close(); }
});

for (const route of ['upload', 'upload-defect']) {
  test(`manual ${route} publishes its URL only after delayed local write completion`, async () => {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const app = await workspace({ createWriteStream(filePath) {
      const chunks = [];
      return new Writable({
        write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
        final(callback) { release = () => { fs.writeFileSync(filePath, Buffer.concat(chunks)); callback(); }; started(); },
      });
    } });
    try {
      const pending = app.request('/api/' + route, { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png' }, body: '0123456789' });
      await ready;
      assert.equal(app.responses.some(response => response.url === '/api/' + route), false, 'request end must not announce success while writes are pending');
      assert.equal(allFiles(app.stage).length, 0, 'fixture has not persisted the media yet');
      release();
      const result = await pending; assert.equal(result.status, 200, result.body);
      const media = await app.request(JSON.parse(result.body).url, { headers: { Range: 'bytes=2-5' } });
      assert.equal(media.status, 206); assert.equal(media.body, '2345');
      assert.equal(app.responses.filter(response => response.url === '/api/' + route).length, 1);
    } finally { await app.close(); }
  });
  test(`manual ${route} fails once on disk write errors and removes incomplete media`, async () => {
    const app = await workspace({ createWriteStream(filePath) {
      return new Writable({ write(_chunk, _encoding, callback) {
        fs.writeFileSync(filePath, 'incomplete'); callback(new Error('Fixture disk failure'));
      } });
    } });
    try {
      const result = await app.request('/api/' + route, { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png' }, body: 'must-not-succeed' });
      assert.equal(result.status, 500); assert.equal(JSON.parse(result.body).error, 'Upload stream failed');
      assert.equal(allFiles(app.stage).length, 0);
      assert.deepEqual(app.responses.filter(response => response.url === '/api/' + route), [{ url: '/api/' + route, status: 500 }]);
    } finally { await app.close(); }
  });
  test(`manual ${route} cleans partial media when the client aborts`, async () => {
    let started, closed;
    const ready = new Promise(resolve => { started = resolve; }), disposed = new Promise(resolve => { closed = resolve; });
    const app = await workspace({ createWriteStream(filePath) {
      const output = new Writable({ write(chunk, _encoding, callback) { fs.writeFileSync(filePath, chunk); callback(); started(); } });
      output.once('close', closed); return output;
    } });
    try {
      const request = http.request(app.origin + '/api/' + route, { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png', 'Content-Length': 100 } });
      request.on('error', () => {}); request.write('partial'); await ready; request.destroy();
      await disposed; await new Promise(resolve => setImmediate(resolve));
      assert.equal(allFiles(app.stage).length, 0);
      assert.equal(app.responses.some(response => response.status === 200), false);
    } finally { await app.close(); }
  });
}

for (const [route, limit] of [['upload', 100 * 1024 * 1024], ['upload-defect', 40 * 1024 * 1024]]) {
  test(`manual ${route} rejects over-limit input before writing and cleans a file opened during abort`, async () => {
    let writes = 0, cloudCalls = 0;
    const app = await workspace({ uploadSize: limit + 1, env: { FLOWSTRIDE_TOKEN: 'fixture-token' },
      axios: { post() { cloudCalls++; throw new Error('No Cloud upload is allowed after rejection'); } },
      createWriteStream(filePath) { return new Writable({
        write(_chunk, _encoding, callback) { writes++; callback(); },
        destroy(error, callback) { setImmediate(() => { fs.writeFileSync(filePath, 'late-open-partial'); callback(error); }); },
      }); },
    });
    try {
      const result = await app.request('/api/' + route, { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png' }, body: 'fixture-size-accounting' });
      assert.equal(result.status, 413); assert.match(JSON.parse(result.body).error, /Payload Too Large/);
      assert.equal(writes, 0); assert.equal(cloudCalls, 0); assert.equal(allFiles(app.stage).length, 0);
      assert.deepEqual(app.responses.filter(response => response.url === '/api/' + route), [{ url: '/api/' + route, status: 413 }]);
    } finally { await app.close(); }
  });
}

if (requireRoot('./package.json').name === '@flowstride/pro') test('Cloud authenticated defect upload receives exactly the persisted bytes after local finish', async () => {
  const calls = [], payload = 'complete-authenticated-evidence';
  const app = await workspace({ env: { FLOWSTRIDE_TOKEN: 'fixture-token' }, axios: {
    async post(url, body, options) {
      calls.push('ticket'); assert.match(url, /\/api\/upload\/defect$/); assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      assert.deepEqual(JSON.parse(JSON.stringify(body)), { ext: '.png', size: Buffer.byteLength(payload) });
      const files = allFiles(app.stage); assert.equal(files.length, 1); assert.equal(fs.readFileSync(files[0], 'utf8'), payload);
      return { data: { presignedUrl: 'https://private-upload.example.test/ticket', publicUrl: 'https://evidence.example.test/fixture.png', headers: { 'X-Fixture': 'signed' } } };
    },
    async put(url, body, options) {
      calls.push('put'); assert.equal(url, 'https://private-upload.example.test/ticket'); assert.equal(Buffer.from(body).toString(), payload);
      assert.equal(fs.readFileSync(allFiles(app.stage)[0], 'utf8'), payload);
      assert.equal(options.headers['Content-Length'], String(Buffer.byteLength(payload))); assert.equal(options.headers['X-Fixture'], 'signed');
    },
  } });
  try {
    const result = await app.request('/api/upload-defect', { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png' }, body: payload });
    assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body), { url: 'https://evidence.example.test/fixture.png' });
    assert.deepEqual(calls, ['ticket', 'put']);
  } finally { await app.close(); }
});

if (requireRoot('./package.json').name === '@flowstride/pro') test('Cloud defect upload retains a complete local URL when the authenticated remote PUT fails', async () => {
  let puts = 0;
  const app = await workspace({ env: { FLOWSTRIDE_TOKEN: 'fixture-token' }, axios: {
    async post() { return { data: { presignedUrl: 'https://private-upload.example.test/ticket', publicUrl: 'https://evidence.example.test/fixture.png' } }; },
    async put() { puts++; throw new Error('Fixture remote upload failure'); },
  } });
  try {
    const result = await app.request('/api/upload-defect', { method: 'POST', headers: { Origin: app.origin, 'X-File-Extension': '.png' }, body: 'complete-local-backup' });
    assert.equal(result.status, 200); const location = JSON.parse(result.body).url; assert(location.startsWith('/defect_media/')); assert.equal(puts, 1);
    const media = await app.request(location); assert.equal(media.status, 200); assert.equal(media.body, 'complete-local-backup');
    assert.deepEqual(app.responses.filter(response => response.url === '/api/upload-defect'), [{ url: '/api/upload-defect', status: 200 }]);
  } finally { await app.close(); }
});
