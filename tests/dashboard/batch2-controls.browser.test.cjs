const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const required = createRequire(path.join(root, 'package.json'));
const browsers = required('playwright');
const { WebSocketServer } = required('ws');

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test(`${engine} dashboard pause/resume and user logs stay in the default view and render inert text`, { timeout: 60000 }, async () => {
    const ui = path.join(root, 'src/ui/dist');
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://local').pathname;
      const file = path.resolve(ui, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(ui + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(response);
    });
    const sockets = new WebSocketServer({ server });
    let client, browser;
    const received = [];
    sockets.on('connection', socket => { client = socket; socket.on('message', frame => received.push(JSON.parse(frame.toString()))); socket.send(JSON.stringify({ type: 'CLI_CONTEXT', payload: { command: 'run' } })); });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      browser = await browsers[engine].launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.getByText('Awaiting execution...', { exact: true }).waitFor(); assert(client);
      const send = (type, payload = {}) => client.send(JSON.stringify({ type, payload }));
      const attack = '<img src="https://attacker.invalid/leak" onerror="globalThis.injected=true"><script>globalThis.injected=true</script>';
      send('SUITE_START'); send('RUN_START', { fileName: 'customer.flow', scenarioName: 'Observe execution' });
      send('STEP_ADD', { id: 'log1', fileName: 'customer.flow', type: 'When', description: 'Print a message', command: 'log', commandLabel: 'flow.log', userMessage: 'Initial message', status: 'running' });
      send('STEP_UPDATE', { id: 'log1', fileName: 'customer.flow', status: 'passed', userMessage: attack });
      await page.locator('[data-user-message]').filter({ hasText: attack }).waitFor();
      assert.equal(await page.locator('[data-user-message] img,[data-user-message] script').count(), 0);
      const first = randomUUID(), second = randomUUID();
      send('EXECUTION_PAUSED', { id: '__proto__', message: 'Invalid pause' });
      send('EXECUTION_PAUSED', { id: first, fileName: 'customer.flow', scenario: 'Observe execution', message: attack, sourceLine: 12, attempt: 1, profile: 'customer' });
      send('EXECUTION_PAUSED', { id: second, fileName: 'admin.flow', scenario: 'Review execution', message: 'Review the administrator', sourceLine: 18, attempt: 1, profile: 'administrator' });
      await page.locator('[data-execution-pause]').nth(1).waitFor();
      assert.equal(await page.locator('[data-execution-pause]').count(), 2);
      assert.equal(await page.locator('[data-execution-pause] img,[data-execution-pause] script').count(), 0);
      assert.equal(await page.locator(`[data-execution-pause="${first}"] [data-pause-message]`).textContent(), attack);
      assert.match(await page.locator(`[data-execution-pause="${first}"]`).textContent(), /customer.flow:12/);
      assert.equal(await page.getByRole('button', { name: 'Rerun', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Resume customer.flow', exact: true }).click();
      await page.waitForFunction(() => true);
      const until = Date.now() + 3000;
      while (!received.some(message => message.type === 'RESUME_EXECUTION')) { assert(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 10)); }
      assert.deepEqual(received.filter(message => message.type === 'RESUME_EXECUTION'), [{ type: 'RESUME_EXECUTION', payload: { pauseId: first } }]);
      // Wait for the runner's confirmation rather than removing a pause on click.
      assert.equal(await page.locator('[data-execution-pause]').count(), 2);
      send('EXECUTION_RESUMED', { id: first });
      await page.locator(`[data-execution-pause="${first}"]`).waitFor({ state: 'detached' });
      assert.equal(await page.locator(`[data-execution-pause="${second}"]`).count(), 1);
      send('RUN_COMPLETE', { status: 'aborted' });
      await page.getByRole('region', { name: 'Paused executions' }).count();
      await page.locator('[data-execution-pause]').waitFor({ state: 'detached' });
      assert.equal(context.pages().length, 1);
      assert.equal(await page.evaluate(() => globalThis.injected), undefined);
      assert.equal(requests.some(url => url.startsWith('https://attacker.invalid')), false);
      assert.deepEqual(errors, []);
    } finally {
      if (browser) await browser.close();
      sockets.clients.forEach(client => client.terminate());
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  });
}
