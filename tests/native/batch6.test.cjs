const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Lexer } = require('../../dist/parser/lexer');
const { Parser } = require('../../dist/parser/parser');
const { prepareWorkflowFeatures } = require('../../dist/native/workflow_plan');
const { executionPlan } = require('../../dist/ci/distribution');
const { ScenarioCleanup, resolveCleanupTarget } = require('../../dist/native/scenario_cleanup');
const { workflowTags } = require('../../dist/native/workflow_tags');

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-workflow-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    config: { projectRoot: root, browser: 'webkit', timeout: 1000, headless: true },
    write(file, content) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    },
  };
}
function parse(source) {
  return new Parser(new Lexer(source).tokenise()).parse();
}
function flow(given, action = 'flow.open "/";', then = 'flow.expect status "200";') {
  return `Feature: Workflows
Scenario: Customer
Tags: Smoke, regression
Given "Prepare"
${given}
When "Act"
${action}
Then "Verify"
${then}
`;
}

test('nested fragments use caller variables, block and unique IDs while retaining source lines', t => {
  const p = project(t);
  p.write('steps/outer.flowpart', 'flow.call "steps/check.flowpart";\nflow.call "steps/check.flowpart";');
  p.write('steps/check.flowpart', '// comment\nflow.expect visible "@customer";');
  const planned = prepareWorkflowFeatures(parse(flow('flow.call "steps/outer.flowpart";')), p.config);
  const scenario = planned[0].scenarios[0];
  assert.deepEqual(scenario.tags, ['regression', 'smoke']);
  assert.equal(new Set(scenario.steps.map(step => step.id)).size, 4);
  for (const step of scenario.steps.slice(0, 2)) {
    assert.equal(step.sourceFile, 'steps/check.flowpart');
    assert.equal(step.line, 2);
    assert.equal(step.blockDescription, 'Given "Prepare"');
    assert.equal(step.payload.selector, '@customer');
  }
  p.write('steps/check.flowpart', 'flow.expect status "201";');
  assert.throws(() => prepareWorkflowFeatures(parse(flow('flow.call "steps/outer.flowpart";')), p.config), /changed after planning/);
});

test('fragments cannot escape the project, read private files, recurse or declare execution blocks', t => {
  const p = project(t);
  p.write('loop.flowpart', 'flow.call "loop.flowpart";');
  p.write('block.flowpart', 'Then "Other block"\nflow.expect status "200";');
  p.write('dataset.flowpart', 'flow.data.cases {"file":"cases.json"};');
  p.write('valid.flowpart', 'flow.log "shared";');
  p.write('.flowstride/private.flowpart', 'flow.log "private";');
  fs.symlinkSync(path.join(p.root, 'valid.flowpart'), path.join(p.root, 'link.flowpart'));
  for (const [file, message] of [
    ['../other.flowpart', /project-relative/],
    ['{{env.FILE}}.flowpart', /project-relative/],
    ['.flowstride/private.flowpart', /private/i],
    ['link.flowpart', /symbolic link/i],
    ['loop.flowpart', /Recursive/],
    ['block.flowpart', /commands only/],
    ['dataset.flowpart', /Scenario declarations/],
  ]) {
    assert.throws(() => prepareWorkflowFeatures(parse(flow(`flow.call "${file}";`)), p.config), message);
  }
});

test('And can call assertion fragments while terminal Then and scenario metadata placement are enforced', t => {
  const p = project(t);
  p.write('check.flowpart', 'flow.expect status "200";');
  p.write('action.flowpart', 'flow.log "not an assertion";');
  const withAnd = name => flow('flow.get "/health";', `flow.get "/health";\nAnd "Check"\nflow.call "${name}.flowpart";`);
  assert.doesNotThrow(() => prepareWorkflowFeatures(parse(withAnd('check')), p.config));
  assert.throws(() => prepareWorkflowFeatures(parse(withAnd('action')), p.config), /only assertion/);
  assert.throws(() => parse(flow('flow.get "/health";') + 'When "After Then"\nflow.log "bad";'), /Terminal Lock/);
  assert.throws(() => parse(flow('Tags: misplaced\nflow.get "/health";')), /Unexpected trailing token/);
});

test('matching skip does not read a dataset or fragment and invalid placement fails early', t => {
  const p = project(t);
  const skip = 'flow.skipIf {"browser":"webkit","reason":"Microphone support required"};';
  const source = flow('flow.data.cases {"file":"missing.csv"};\n' + skip, 'flow.call "absent.flowpart";');
  assert.equal(prepareWorkflowFeatures(parse(source), p.config)[0].scenarios[0].skipReason, 'Microphone support required');
  assert.throws(() => prepareWorkflowFeatures(parse(flow('flow.open "/";\n' + skip)), p.config), /start of Given/);
  assert.throws(() => prepareWorkflowFeatures(parse(flow(skip.replace('webkit', 'unsupported'))), p.config), /supported browser/);
  assert.throws(() => prepareWorkflowFeatures(parse(flow(skip + '\n' + skip)), p.config), /one flow.skipIf/);
});

test('tags intersect only.Scenario, select before dependency reads and distinguish shard selections', t => {
  const p = project(t);
  p.write('flows/selected.flow', flow('flow.get "/health";'));
  p.write('flows/other.flow', flow('flow.call "absent.flowpart";').replace('Smoke, regression', 'other'));
  p.config.scenarioTags = workflowTags(['SMOKE', 'smoke']);
  const target = path.join(p.root, 'flows');
  const a = executionPlan(target, p.config);
  assert.deepEqual(a.allFiles, ['selected.flow']);
  p.config.scenarioTags = ['regression'];
  assert.notEqual(executionPlan(target, p.config).configHash, a.configHash);
  p.config.scenarioTags = ['smoke'];
  const restricted = flow('flow.get "/health";').replace('Scenario: Customer', 'only.Scenario: Customer').replace('Smoke, regression', 'other');
  p.write('flows/selected.flow', restricted + flow('flow.get "/health";').split('\n').slice(1).join('\n'));
  assert.throws(() => executionPlan(target, p.config), /No scenarios matched tags/);
  assert.throws(() => workflowTags(['--bad']), /Provide/);
});

test('cleanup rejects invalid targets and makes one bounded DELETE without following redirects', async t => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, method: req.method, headers: req.headers });
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/must-not-run' }).end();
    } else {
      res.writeHead(204).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cleanup = new ScenarioCleanup(origin);
  const step = { id: 'cleanup', line: 1, blockDescription: 'When', action: 'native' };
  for (const url of ['//example.invalid/path', 'https://example.invalid/target', '/@unresolved', '/x/%2e%2e/y', '/x/%252e%252e/y', '/x#fragment', 'ftp://example.invalid/x']) {
    assert.throws(() => cleanup.register(step, { method: 'DELETE', url }, {}));
  }
  assert.throws(() => cleanup.register(step, { method: 'POST', url: '/one' }, {}));
  const headers = { Authorization: 'Bearer fixture', Host: 'example.invalid' };
  cleanup.register({ ...step, id: 'first' }, { method: 'DELETE', url: '/one' }, headers);
  headers.Authorization = 'Bearer changed';
  cleanup.register({ ...step, id: 'second' }, { method: 'DELETE', url: '/redirect' }, {});
  const result = cleanup.drain();
  assert.equal(cleanup.drain(), result);
  const outcomes = await result;
  assert.deepEqual(outcomes.map(item => [item.step.id, item.status]), [['second', 302], ['first', 204]]);
  assert.match(outcomes[0].error, /HTTP 302/);
  assert.equal(outcomes[1].error, undefined);
  assert.deepEqual(requests.map(item => [item.method, item.url]), [['DELETE', '/redirect'], ['DELETE', '/one']]);
  assert.equal(requests[1].headers.authorization, 'Bearer fixture');
  assert.match(requests[1].headers.host, /^127\.0\.0\.1:/);
});

test('cleanup substitutions cannot inject request delimiters or erase a resource component', () => {
  const template = '/resources/@id?source=flowstride';
  for (const value of ['../other', 'user?all=true', 'user&force=true', '', '   ']) {
    assert.throws(() => resolveCleanupTarget(template, part => part.replace('@id', value)), /nonempty URL component/);
  }
  assert.equal(resolveCleanupTarget(template, part => part.replace('@id', 'customer-3')), '/resources/customer-3?source=flowstride');
});
