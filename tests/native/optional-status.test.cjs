const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Parser } = require('../../dist/parser/parser');
const { Lexer } = require('../../dist/parser/lexer');
const { FlowWorker } = require('../../dist/runner/flow_worker');

const source = `Feature: Optional command contract
Scenario: Keep optional execution unchanged
Given "Ready"
  flow.expect visible "Ready";
When "Dismiss an optional banner and continue"
  flow.try click button "Dismiss";
  flow.click button "Continue";
Then "Verify the result"
  flow.expect visible "Completed";
`;

for (const optionalExists of [false, true]) for (const requiredFails of [false, true]) {
  test(`flow.try remains isolated; optional exists=${optionalExists}, required fails=${requiredFails}`, async () => {
    const scenario = new Parser(new Lexer(source).tokenise()).parse()[0].scenarios[0];
    assert.deepEqual(scenario.steps.map(step => step.payload.optional), [false, true, false, false]);
    const calls = [];
    const web = {
      activeProfile: 'default',
      getPage() { return undefined; },
      async expectVisible(target) { calls.push(target); },
      async click(target) {
        calls.push(target);
        if (target === 'Dismiss' && !optionalExists || target === 'Continue' && requiredFails) throw Error('Target not found');
      },
    };
    const worker = new FlowWorker({ ci: true, headless: true, timeout: 50 }, web, {}, {}, {}, {});
    worker.isSilent = true;
    worker.currentFileName = 'optional.flow';
    const events = [];
    worker.on('worker_event', event => events.push(event));
    const passed = await worker.runScenario(scenario);
    assert.equal(passed, !requiredFails);
    assert.deepEqual(events.filter(event => event.type === 'STEP_UPDATE').map(event => event.payload.status), [
      'passed', optionalExists ? 'passed' : 'skipped', requiredFails ? 'failed' : 'passed', requiredFails ? 'not_tested' : 'passed',
    ]);
    assert.equal(calls.includes('Completed'), !requiredFails);
  });
}

test('an optional skip cannot weaken the single-Feature or terminal-Then rules', () => {
  for (const suffix of ['And "Another check"\nflow.expect visible "Ready";', 'When "Another action"\nflow.click "Continue";', 'Then "Another Then"\nflow.expect visible "Ready";', 'Feature: Another feature']) {
    assert.throws(() => new Parser(new Lexer(source + '\n' + suffix).tokenise()).parse());
  }
  const nextScenario = source + '\nScenario: Another valid scenario\nGiven "Ready"\nWhen "Continue"\nThen "Done"\nflow.expect visible "Ready";';
  assert.equal(new Parser(new Lexer(nextScenario).tokenise()).parse()[0].scenarios.length, 2);
});
