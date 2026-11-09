const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const required = createRequire(path.join(root, 'package.json'));
const browsers = required('playwright');
const { WebSocketServer } = required('ws');

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test(`${engine} built dashboard preserves optional skips and truthful file/block counts`, { timeout: 60000 }, async () => {
    const ui = path.join(root, 'src/ui/dist');
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://local').pathname;
      const file = path.resolve(ui, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(ui + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); response.end(); return;
      }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(response);
    });
    const sockets = new WebSocketServer({ server });
    let client, browser;
    sockets.on('connection', socket => {
      client = socket;
      socket.send(JSON.stringify({ type: 'CLI_CONTEXT', payload: { command: 'run' } }));
    });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      browser = await browsers[engine].launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.setDefaultTimeout(10000);
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.getByText('Awaiting execution...', { exact: true }).waitFor();
      assert(client);
      const send = (type, payload = {}) => client.send(JSON.stringify({ type, payload }));
      const fileResult = name => page.locator('[data-flow-result]').filter({ has: page.locator('span').filter({ hasText: name }) }).first();
      const expectFile = async (file, status) => {
        await page.waitForFunction(({ file, status }) => [...document.querySelectorAll('[data-flow-result]')].some(element => element.getAttribute('data-flow-result') === file && element.getAttribute('data-flow-status') === status), { file, status });
      };
      const count = async (name, expected) => {
        await page.waitForFunction(({ name, expected }) => document.querySelector(`[data-flow-count="${name}"]`)?.textContent.trim() === String(expected), { name, expected });
      };
      const add = (fileName, id, status, type = 'When', description = 'Optional and required actions', extra = {}) => {
        send('STEP_ADD', { id, fileName, type, description, command: 'click', status: 'running' });
        send('STEP_UPDATE', { id, fileName, status, ...extra });
      };

      for (const [index, statuses] of [
        ['skipped', 'passed', 'passed'], ['passed', 'skipped', 'passed'], ['passed', 'passed', 'skipped'],
      ].entries()) {
        const file = `optional-position-${index}.flow`;
        send('SUITE_START'); send('RUN_START', { fileName: file, scenarioName: 'Continue normally' });
        add(file, 'ready', 'passed', 'Given', 'Ready');
        statuses.forEach((status, step) => add(file, 'action-' + step, status));
        add(file, 'final', 'passed', 'Then', 'Final required check');
        send('SCENARIO_RESULT', { fileName: file, scenario: 'Continue normally', status: 'passed' });
        send('RUN_COMPLETE', { status: 'success' });
        await expectFile(file, 'passed');
        await count('total', 1); await count('passed', 1); await count('failed', 0);
        const result = fileResult(file);
        assert.equal(await result.getAttribute('data-flow-status'), 'passed');
        assert.equal(await result.locator('[data-flow-block]').filter({ hasText: 'Optional and required actions' }).getAttribute('data-flow-block-status'), 'passed');
        for (const [step, status] of statuses.entries()) {
          const child = page.locator(`[data-step-id="action-${step}"]`);
          assert.equal(await child.getAttribute('data-step-status'), status === 'passed' ? 'pass' : status);
          assert.equal(await child.locator('svg').first().evaluate(icon => getComputedStyle(icon).stroke), status === 'passed' ? 'rgb(52, 211, 153)' : 'rgb(110, 118, 129)');
        }
        assert.equal(await page.locator('[data-step-id="final"] svg').first().evaluate(icon => getComputedStyle(icon).stroke), 'rgb(52, 211, 153)');
      }

      // A skipped-only parent stays grey while the completed file can still pass.
      send('SUITE_START'); send('RUN_START', { fileName: 'skipped-parent.flow', scenarioName: 'Skipped parent' });
      add('skipped-parent.flow', 'ready', 'passed', 'Given', 'Ready');
      add('skipped-parent.flow', 'optional', 'skipped', 'When', 'Only optional commands');
      add('skipped-parent.flow', 'final', 'passed', 'Then', 'Final required check');
      send('SCENARIO_RESULT', { fileName: 'skipped-parent.flow', scenario: 'Skipped parent', status: 'passed' });
      send('RUN_COMPLETE', { status: 'success' });
      await count('passed', 1);
      assert.equal(await page.locator('[data-flow-block]').filter({ hasText: 'Only optional commands' }).getAttribute('data-flow-block-status'), 'skipped');

      // Concurrent files use repeated IDs without sharing their outcomes.
      send('SUITE_START');
      for (const name of ['customer.flow', 'administrator.flow']) send('RUN_START', { fileName: name, scenarioName: 'Independent result' });
      add('customer.flow', 'same-id', 'skipped'); add('administrator.flow', 'same-id', 'passed');
      add('customer.flow', 'required', 'passed'); add('administrator.flow', 'required', 'failed');
      send('SCENARIO_RESULT', { fileName: 'customer.flow', scenario: 'Independent result', status: 'passed' });
      send('SCENARIO_RESULT', { fileName: 'administrator.flow', scenario: 'Independent result', status: 'failed' });
      send('RUN_COMPLETE', { status: 'failed' });
      await count('total', 2); await count('passed', 1); await count('failed', 1);
      assert.equal(await fileResult('customer.flow').getAttribute('data-flow-status'), 'passed');
      assert.equal(await fileResult('administrator.flow').getAttribute('data-flow-status'), 'failed');

      // A scenario-level browser error must remain failed even if all commands passed.
      send('SUITE_START'); send('RUN_START', { fileName: 'page-error.flow', scenarioName: 'Browser error' });
      add('page-error.flow', 'optional', 'skipped'); add('page-error.flow', 'required', 'passed');
      send('SCENARIO_RESULT', { fileName: 'page-error.flow', scenario: 'Browser error', status: 'failed' });
      send('RUN_COMPLETE', { status: 'failed' });
      await count('passed', 0); await count('failed', 1);

      // Entirely skipped work, unfinished work and unknown values must never turn green.
      for (const [suffix, statuses, expected] of [
        ['all-skipped', ['skipped', 'skipped'], 'skipped'],
        ['not-tested', ['skipped', 'not_tested'], 'not_tested'],
        ['unknown', ['passed', 'skipped', '__proto__'], 'unknown'],
      ]) {
        const file = `${suffix}.flow`;
        send('SUITE_START'); send('RUN_START', { fileName: file, scenarioName: 'Truthful results' });
        statuses.forEach((status, step) => add(file, 'action-' + step, status));
        send('SCENARIO_RESULT', { fileName: file, scenario: 'Truthful results', status: 'passed' });
        send('RUN_COMPLETE', { status: 'success' });
        await expectFile(file, expected);
        await count('passed', 0);
      }

      const attack = '<img src="https://attacker.invalid/leak" onerror="window.statusInjected=true"><script>window.statusInjected=true</script>';
      send('SUITE_START'); send('RUN_START', { fileName: attack, scenarioName: 'Inert metadata' });
      add(attack, 'optional', 'skipped', 'When', attack, { error: attack });
      add(attack, 'required', attack, 'Then', 'Keep unknown results truthful');
      send('SCENARIO_RESULT', { fileName: attack, scenario: 'Inert metadata', status: 'passed' });
      send('RUN_COMPLETE', { status: 'success' });
      await expectFile(attack, 'unknown'); await count('passed', 0);
      assert.equal(await page.evaluate(() => window.statusInjected), undefined);
      assert.equal(await page.locator('[data-flow-result] img,[data-flow-result] script').count(), 0);
      assert(!requests.some(url => url.includes('attacker.invalid')));

      send('SUITE_START');
      await count('total', 0); await count('passed', 0); await count('failed', 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise(resolve => sockets.close(resolve));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
