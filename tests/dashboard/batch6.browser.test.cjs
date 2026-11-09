const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const engine = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const fromEngine = createRequire(path.join(engine, 'package.json'));
const { chromium } = fromEngine('playwright');
const { WebAdapter } = fromEngine('./dist/adapters/web/playwright');
const { ApiAdapter } = fromEngine('./dist/adapters/api/undici');
const { FlowWorker } = fromEngine('./dist/runner/flow_worker');
const { FlowOrchestrator } = fromEngine('./dist/runner/flow_orchestrator');

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'Timed out waiting for the dashboard fixture');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('Batch6 dashboard shows a skipped file and reason without counting it as passed', { timeout: 45000 }, async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-workflow-dashboard-')));
  const flows = path.join(dir, 'flows');
  fs.mkdirSync(flows);
  fs.writeFileSync(path.join(flows, 'capability.flow'), `Feature: Skip evidence
Scenario: Skip unavailable browser capability
Tags: browser
Given "Evaluate the browser"
  flow.skipIf {"browser":"webkit","reason":"Requires Chromium microphone injection"};
When "Open an application"
  flow.open "/must-not-visit";
Then "Check the page"
  flow.expect visible "Never reached";
`);
  const oldCwd = process.cwd();
  const oldArgs = [...process.argv];
  process.chdir(dir);
  process.argv.push('--headless');
  const events = [];
  const config = {
    projectRoot: dir, browser: 'webkit', headless: true, ci: false, timeout: 1200,
    recordVideo: false, onRunEvent: event => events.push(event),
  };
  const web = new WebAdapter(config);
  const worker = new FlowWorker(config, web, new ApiAdapter(config), {}, {});
  const orchestrator = new FlowOrchestrator(worker, 1, config);
  let browser;
  let run;
  try {
    // Hold the run until the dashboard connects, as the actual non-headless CLI does.
    const execute = orchestrator.executeTestRun.bind(orchestrator);
    orchestrator.executeTestRun = async target => {
      await until(() => orchestrator.wss?.clients.size);
      return execute(target);
    };
    run = orchestrator.start(flows);
    await until(() => orchestrator.httpServer?.listening);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto('http://127.0.0.1:' + orchestrator.httpServer.address().port);
    assert.equal(await run, true);
    const file = page.locator('[data-flow-result="capability.flow"]');
    await file.waitFor();
    assert.equal(await file.getAttribute('data-flow-status'), 'skipped');
    assert.equal(parseInt(await page.locator('[data-flow-count="passed"]').textContent()), 0);
    await page.getByText('Skipped', { exact: true }).first().waitFor();
    if (!await page.locator('[data-flow-file="capability.flow"]').count()) {
      await file.getByText('capability.flow', { exact: true }).click();
    }
    await page.locator('[data-user-message]').filter({ hasText: 'Requires Chromium microphone injection' }).first().waitFor();
    assert(events.some(event => event.type === 'SCENARIO_RESULT' && event.payload.status === 'skipped'));
    assert(!events.some(event => event.type === 'BROWSER_INFO'));
  } finally {
    await orchestrator.close();
    if (browser) await browser.close();
    await worker.shutdown();
    if (run) await run.catch(() => {});
    process.argv.splice(0, process.argv.length, ...oldArgs);
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Batch6 dashboard Stop drains registered cleanup before reporting interruption', { timeout: 45000 }, async () => {
  const http = require('node:http');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-workflow-stop-')));
  const flow = path.join(dir, 'stop.flow');
  fs.writeFileSync(flow, `Feature: Stop cleanup
Scenario: Clean a registered resource on Stop
Given "Register cleanup"
  flow.cleanup.register {"method":"DELETE","url":"/created-resource"};
When "Wait for the tester"
  flow.get "/ready";
  flow.wait 20000;
Then "This does not run"
  flow.get "/must-not-visit";
`);
  const visits = [];
  const app = http.createServer((req, res) => {
    visits.push([req.method, req.url]);
    res.writeHead(204).end();
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const oldCwd = process.cwd();
  const oldArgs = [...process.argv];
  process.chdir(dir);
  process.argv.push('--headless');
  const events = [];
  const config = {
    projectRoot: dir, browser: 'chromium', headless: true, ci: false, timeout: 1500,
    recordVideo: false, security: { evidence: { screenshots: false } },
    baseUrl: `http://127.0.0.1:${app.address().port}`,
    onRunEvent: event => events.push(event),
  };
  const worker = new FlowWorker(config, new WebAdapter(config), new ApiAdapter(config), {}, {});
  const orchestrator = new FlowOrchestrator(worker, 1, config);
  let browser;
  let run;
  try {
    const execute = orchestrator.executeTestRun.bind(orchestrator);
    orchestrator.executeTestRun = async target => {
      await until(() => orchestrator.wss?.clients.size);
      return execute(target);
    };
    run = orchestrator.start(flow);
    await until(() => orchestrator.httpServer?.listening);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto('http://127.0.0.1:' + orchestrator.httpServer.address().port);
    await until(() => visits.some(([, url]) => url === '/ready'));
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    assert.equal(await run, false);
    await until(() => events.some(event => event.type === 'RUN_COMPLETE' && event.payload.status === 'aborted'));
    assert.deepEqual(visits, [['GET', '/ready'], ['DELETE', '/created-resource']]);
    const cleanupIndex = events.findIndex(event => event.type === 'STEP_UPDATE' && event.payload.cleanupStatus === 204);
    const stopIndex = events.findIndex(event => event.type === 'RUN_COMPLETE' && event.payload.status === 'aborted');
    assert(cleanupIndex >= 0 && cleanupIndex < stopIndex);
  } finally {
    await orchestrator.close();
    if (browser) await browser.close();
    await worker.shutdown();
    if (run) await run.catch(() => {});
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    process.argv.splice(0, process.argv.length, ...oldArgs);
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
