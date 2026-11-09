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
const { Parser } = require(path.join(root, 'dist/parser/parser'));
const { Lexer } = require(path.join(root, 'dist/parser/lexer'));

function execute(directory, args = [], extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'dist/cli/index.js'), 'run', 'flows', '--ci', ...args], {
      cwd: directory,
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CI: 'true', FLOWSTRIDE_TOKEN: '', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Batch1 CLI timed out:\n' + output)); }, 60000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
}

async function fixture(browser = 'chromium') {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-batch1-cli-')));
  fs.mkdirSync(path.join(directory, 'flows'));
  fs.mkdirSync(path.join(directory, '.flowstride'));
  fs.writeFileSync(path.join(directory, '.flowstride/credentials.json'), '{}');
  let orderCalls = 0;
  const order = { orderId: 'order-123', count: 3, active: true, items: [{ sku: 'A', quantity: 2 }], details: { approved: true, note: 'Ready' } };
  const server = http.createServer((request, response) => {
    if (request.url === '/orders') {
      orderCalls++;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(order)); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><title>Batch1 local acceptance</title><style>
      body{font:18px sans-serif;margin:32px}form{display:flex;flex-direction:column;gap:16px;width:320px;padding:20px;border:1px solid #888;margin-bottom:20px}label{display:flex;flex-direction:column;gap:6px}input,button{padding:10px}output{display:block}
      </style></head><body><h1>Ready</h1>
      <form aria-label="Login form"><label>Email<input type="email" aria-label="Email" value="samuel.me"></label><label>Password<input type="password" aria-label="Password" value="fixture-password"></label><button type="button">Submit</button></form>
      <form aria-label="Other form"><label>Email<input type="email" aria-label="Email" value="other@example.test"></label><button type="button">Submit</button></form>
      <button type="button" onclick="fetch('/orders',{method:'POST'}).then(r=>r.json()).then(order=>document.querySelector('output').textContent=order.orderId)">Place order</button>
      <output id="reference">Ready</output></body></html>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(directory, 'flowstride.config.json'), JSON.stringify({
    baseUrl: url, timeout: 2500, browser, recordVideo: false,
    security: { evidence: { screenshots: false } }, domSnapshots: false,
  }));
  return {
    directory, url, order,
    get orderCalls() { return orderCalls; },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function source({ failed = false, legacy = false } = {}) {
  if (legacy) return `Feature: Legacy assertions remain compatible
Scenario: Existing selector and role targeting
Given "Open the local application"
  flow.open "/";
When "Check the existing selector form"
  flow.assert.that {
    "selector": "#reference",
    "condition": "text",
    "value": "Ready"
  };
Then "Check existing role and name"
  flow.assert.that {
    "role": "button",
    "name": "Place order",
    "condition": "enabled"
  };
`;
  return `Feature: Textual targeting and typed extraction
Scenario: Browser properties and captured order data
Given "Open the local application"
  flow.open "/";
When "Retain the email validity state"
  flow.extract property input "Email" inside "Login form" "validity.typeMismatch" as "emailMismatch";
  flow.assert.that {
    "target": {
      "text": "Email",
      "element": "input",
      "inside": "Login form"
    },
    "condition": "property",
    "property": "validity.typeMismatch",
    "value": "@emailMismatch",
    "message": "The invalid email must retain its browser mismatch state"
  };
And "The extracted property remains a boolean"
  flow.assert.value {
    "actual": "@emailMismatch",
    "operator": "equals",
    "expected": true
  };
When "Use the readable spatial target"
  flow.assert.that {
    "target": {
      "text": "Submit",
      "element": "button",
      "inside": "Login form",
      "under": "Password"
    },
    "condition": "enabled"
  };
  flow.assert.that {
    "selector": "#reference",
    "condition": "text",
    "value": "Ready"
  };
  flow.assert.that {
    "role": "button",
    "name": "Place order",
    "condition": "enabled"
  };
When "Capture the actual browser request"
  flow.network.arm {
    "name": "orderResponse",
    "url": "**/orders",
    "method": "POST"
  };
  flow.click button "Place order";
  flow.network.wait {
    "name": "orderResponse"
  };
  flow.extract network "orderResponse" "body.orderId" as global "orderId";
  flow.extract network "orderResponse" "body.count" as "orderCount";
  flow.extract network "orderResponse" "body.active" as "orderActive";
  flow.extract network "orderResponse" "body.items" as "orderItems";
  flow.extract network "orderResponse" "body.details" as "orderDetails";
And "Captured values keep their original JSON types"
  flow.assert.value {
    "actual": "@orderActive",
    "operator": "equals",
    "expected": true
  };
  flow.assert.value {
    "actual": "@orderItems",
    "operator": "equals",
    "expected": [
      {
        "sku": "A",
        "quantity": 2
      }
    ]
  };
  flow.assert.value {
    "actual": "@orderDetails",
    "operator": "equals",
    "expected": {
      "approved": true,
      "note": "Ready"
    }
  };
  flow.assert.value {
    "actual": "Order @global[orderId]",
    "operator": "equals",
    "expected": "Order order-123"
  };
Then "Validate the count and final application state"
  flow.assert.value {
    "actual": "@orderCount",
    "operator": "greaterThan",
    "expected": ${failed ? 99 : 0},
    "message": "Order count must exceed the configured threshold"
  };
  flow.assert.that {
    "target": "order-123",
    "condition": "visible"
  };
`;
}

function prepareMode(fixture, mode) {
  if (mode === 'direct') return {};
  const parent = path.join(fixture.directory, 'node_modules/@flowstride');
  fs.mkdirSync(parent, { recursive: true });
  const installed = path.join(parent, 'pro');
  if (mode === 'handoff') fs.symlinkSync(cloud, installed, 'dir');
  else {
    const runner = path.join(installed, 'dist/runner');
    fs.mkdirSync(runner, { recursive: true });
    if (mode === 'legacy-handoff') {
      for (const [file, exported] of [['flow_worker', 'FlowWorker'], ['flow_orchestrator', 'FlowOrchestrator']]) {
        fs.writeFileSync(path.join(runner, file + '.js'), `module.exports=require(${JSON.stringify(path.join(cloud, 'dist/runner', file + '.js'))});module.exports.${exported}.nativeValueProtocol=undefined;`);
      }
    } else {
      fs.writeFileSync(path.join(runner, 'flow_worker.js'), 'exports.FlowWorker=class {static nativeBrowserProtocol=2;static nativeAssertionProtocol=1;constructor(){throw Error("BATCH1_OLD_ENGINE_CONSTRUCTOR_MUST_NOT_RUN")}};');
      fs.writeFileSync(path.join(runner, 'flow_orchestrator.js'), 'exports.FlowOrchestrator=class {static nativeCIProtocol=1;static nativeBrowserProtocol=2;static nativeAssertionProtocol=1;constructor(){throw Error("BATCH1_OLD_ENGINE_CONSTRUCTOR_MUST_NOT_RUN")}};');
    }
  }
  fs.writeFileSync(path.join(fixture.directory, '.flowstride/credentials.json'), JSON.stringify({ machineToken: 'fixture-batch1-token', workspaceId: 'fixture-batch1-workspace' }));
  const preload = path.join(fixture.directory, 'auth.cjs');
  fs.writeFileSync(preload, `const original=global.fetch;global.fetch=async(url,...args)=>{if(String(url).endsWith('/api/auth/verify-cli'))return Response.json({tier:'business',workspaceName:'Batch1 fixture'});if(String(url).endsWith('/api/workspace/status'))return Response.json({workspace:{_id:'fixture-batch1-workspace'},manifest:{maxWorkers:2,features:[]}});return original(url,...args);};`);
  return { NODE_OPTIONS: '--require=' + preload };
}

for (const browser of ['chromium', 'firefox', 'webkit']) {
  test(`Batch1 typed values/textual/spatial targeting run through real ${browser}`, { timeout: 65000 }, async () => {
    const f = await fixture(browser);
    try {
      fs.writeFileSync(path.join(f.directory, 'flows/acceptance.flow'), source());
      const result = await execute(f.directory);
      assert.equal(result.code, 0, result.output);
      const summary = JSON.parse(fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/summary.json')));
      assert.equal(summary.status, 'passed', result.output);
      assert.equal(summary.metrics.failed, 0);
      assert.equal(summary.metrics.incomplete, 0);
      assert(summary.steps.every(step => step.status === 'passed'));
      assert.equal(summary.browsers[0].engine, browser);
      assert.equal(f.orderCalls, 1, 'capture must come from the browser-triggered localhost POST');
    } finally { await f.close(); }
  });
}

test('Batch1 a failed value assertion produces nonzero CI and explicit message/expected/actual/location', { timeout: 65000 }, async () => {
  const f = await fixture();
  try {
    fs.writeFileSync(path.join(f.directory, 'flows/acceptance.flow'), source({ failed: true }));
    const result = await execute(f.directory);
    assert.equal(result.code, 1, result.output);
    const summary = JSON.parse(fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/summary.json')));
    assert.equal(summary.status, 'failed');
    assert.equal(summary.metrics.failed, 1);
    assert.equal(summary.metrics.incomplete, 0);
    const failure = summary.steps.find(step => step.status === 'failed');
    assert.match(failure.error, /Order count must exceed the configured threshold/);
    assert.match(failure.error, /Expected:/);
    assert.match(failure.error, /Actual:/);
    assert.match(failure.error, /acceptance\.flow:\d+/);
    assert.equal(summary.steps.at(-1).status, 'not_tested');
  } finally { await f.close(); }
});

for (const mode of ['handoff', 'older', 'legacy-handoff']) {
  test(`Batch1 ${mode} preserves OS-to-Cloud compatibility`, { skip: privateEngine || mode !== 'older' && !cloud, timeout: 65000 }, async () => {
    const f = await fixture();
    try {
      const env = prepareMode(f, mode);
      fs.writeFileSync(path.join(f.directory, 'flows/acceptance.flow'), source({ legacy: mode === 'legacy-handoff' }));
      const result = await execute(f.directory, [], env);
      assert.equal(result.code, 0, result.output);
      const summary = JSON.parse(fs.readFileSync(path.join(f.directory, 'flowstride-artifacts/summary.json')));
      assert.equal(summary.status, 'passed');
      assert.equal(summary.metrics.incomplete, 0);
      assert.equal(summary.engine, mode === 'older' ? 'Open Source' : 'Enterprise (Pro)', result.output);
      if (mode === 'older') assert.match(result.output, /fallback|falling back/i);
    } finally { await f.close(); }
  });
}

test('Batch1 syntax retains terminal Then, single Feature and assertion-only And rules', () => {
  const valid = source();
  const parse = text => new Parser(new Lexer(text).tokenise()).parse();
  assert.equal(parse(valid).length, 1);
  for (const suffix of ['And "Late assertion"\nflow.assert.value {"actual":1,"operator":"equals","expected":1};', 'When "Late action"\nflow.open "/";', 'Then "Repeated Then"\nflow.expect visible "Ready";', 'Feature: Repeated Feature']) {
    assert.throws(() => parse(valid + '\n' + suffix));
  }
  for (const command of [
    'flow.extract property input "Email" "validity.typeMismatch" as "value";',
    'flow.extract network "orderResponse" "body.orderId" as "value";',
  ]) {
    assert.throws(() => parse(`Feature: Rule check\nScenario: Extraction is an action\nGiven "Ready"\nWhen "Action"\nAnd "Incorrect action block"\n${command}\nThen "Done"\nflow.expect visible "Ready";`), /And.*assert/i);
  }
  assert.equal(parse(valid + '\nScenario: Next scenario\nGiven "Ready"\nWhen "Action"\nThen "Done"\nflow.assert.value {"actual":1,"operator":"equals","expected":1};')[0].scenarios.length, 2);
});
