const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');

const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const required = createRequire(path.join(root, 'package.json'));
const engines = required('playwright');
const { WebSocketServer } = required('ws');

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test(`built ${engine} dashboard resizes the test panel and preserves independent histories`, { timeout: 60000 }, async () => {
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
    const requests = [], errors = [];
    sockets.on('connection', socket => {
      client = socket;
      socket.on('message', data => requests.push(JSON.parse(data.toString())));
      socket.send(JSON.stringify({ type: 'CLI_CONTEXT', payload: { command: 'run' } }));
    });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      browser = await engines[engine].launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: engine === 'chromium' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.getByText('Awaiting execution...', { exact: true }).waitFor();
      assert(client);
      const send = (type, payload) => client.send(JSON.stringify({ type, payload }));
      const divider = page.getByRole('separator', { name: 'Resize test flows panel' });
      const panel = page.getByRole('complementary', { name: 'Test flows' });
      const expectWidth = async width => {
        await page.waitForFunction(expected => {
          const handle = document.querySelector('.flow-panel-divider');
          const aside = document.getElementById('flowstride-test-flows');
          return Number(handle?.getAttribute('aria-valuenow')) === expected
            && Math.abs(aside.getBoundingClientRect().width - expected - 1) < 1;
        }, width).catch(async error => {
          const actual = await divider.getAttribute('aria-valuenow');
          throw new Error(`Expected panel width ${width}; observed ${actual}. ${error.message}`);
        });
      };
      const drag = async dx => {
        const box = await divider.boundingBox();
        const x = box.x + box.width / 2, y = Math.min(450, box.y + box.height / 2);
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(Math.max(1, Math.min(1590, x + dx)), y, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(() => !document.querySelector('[data-flow-panel-drag-shield]'));
      };

      await expectWidth(280);
      const initialPanel = await panel.boundingBox(), initialHandle = await divider.boundingBox();
      assert(initialHandle.x >= initialPanel.x + initialPanel.width - 1, 'the drag handle must not cover the test-list scrollbar');
      const previewBefore = await page.locator('main').boundingBox();
      await drag(180); await expectWidth(460);
      assert(Math.abs((await page.locator('main').boundingBox()).width - previewBefore.width + 180) < 2);
      assert.equal(await panel.locator('h2').innerText(), 'TEST FLOWS');
      await page.evaluate(() => { document.body.style.userSelect = 'text'; document.body.style.cursor = 'crosshair'; });
      await drag(-80); await expectWidth(380);
      assert.deepEqual(await page.evaluate(() => ({ select: document.body.style.userSelect, cursor: document.body.style.cursor })), { select: 'text', cursor: 'crosshair' });

      // The splitter must not become a scrollbar or dispatch execution commands.
      const box = await divider.boundingBox();
      await page.mouse.click(box.x + 4, 400, { button: 'right' });
      await expectWidth(380);
      await page.keyboard.press('Escape');
      await divider.focus(); await page.keyboard.press('ArrowRight'); await expectWidth(390);
      await page.keyboard.press('Shift+ArrowLeft'); await expectWidth(340);
      await page.keyboard.press('Home'); await expectWidth(220);
      await page.keyboard.press('End'); await expectWidth(640);
      await page.keyboard.press('Enter'); await expectWidth(280);
      await drag(90); await expectWidth(370);
      await divider.dblclick(); await expectWidth(280);

      // Confirm resizing does not change the selected file or its screenshot.
      const frames = await page.evaluate(() => ['#b91c1c', '#1d4ed8'].map(color => {
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
        const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 80, 60);
        return canvas.toDataURL('image/png').split(',')[1];
      }));
      send('SUITE_START', {});
      for (const [index, file] of ['red.flow', 'blue.flow'].entries()) {
        send('RUN_START', { fileName: file, scenarioName: 'Own screen' });
        if (file === 'blue.flow') for (let extra = 0; extra < 40; extra++) send('STEP_ADD', { id: 'extra-' + extra, fileName: file, type: 'When', description: 'Additional history ' + extra, command: 'expect', status: 'passed' });
        send('STEP_ADD', { id: 'shared-step', fileName: file, type: 'Then', description: 'Inspect own screen', command: 'expect', status: 'running' });
        send('STEP_UPDATE', { id: 'shared-step', fileName: file, status: 'passed', screenshot: frames[index], sourceLine: 8 });
      }
      send('RUN_COMPLETE', { status: 'success' });
      for (const [index, file] of ['red.flow', 'blue.flow'].entries()) {
        await page.getByRole('tab', { name: file, exact: true }).click();
        await page.waitForFunction(source => document.querySelector('img[alt="Browser frame"]')?.getAttribute('src') === 'data:image/png;base64,' + source, frames[index]);
        await drag(index === 0 ? 120 : -40);
        assert.equal(await page.getByRole('tab', { name: file, exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByAltText('Browser frame').getAttribute('src'), 'data:image/png;base64,' + frames[index]);
      }
      await expectWidth(360);
      await panel.locator('[data-step-id="extra-39"]').waitFor();
      const scrollArea = panel.locator('div').filter({ has: page.locator('[data-step-id="extra-39"]') });
      const scrolling = await scrollArea.evaluateAll(elements => {
        const element = elements.find(item => getComputedStyle(item).overflowY === 'auto' && item.scrollHeight > item.clientHeight);
        if (!element) return null;
        element.scrollTop = 0;
        return { height: element.clientHeight, total: element.scrollHeight };
      });
      assert(scrolling && scrolling.total > scrolling.height, 'long histories retain their own scroll area');
      const sideBox = await panel.boundingBox();
      await page.mouse.move(sideBox.x + sideBox.width - 12, 450); await page.mouse.wheel(0, 400);
      await page.waitForFunction(() => [...document.getElementById('flowstride-test-flows').querySelectorAll('div')].some(element => getComputedStyle(element).overflowY === 'auto' && element.scrollTop > 0));
      await expectWidth(360);
      await page.getByText('Hide', { exact: true }).click();
      await divider.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.getElementById('flowstride-test-flows').getBoundingClientRect().width < 1);
      await page.getByText('Show', { exact: true }).click(); await expectWidth(360);
      await page.getByText('Logs', { exact: true }).click(); await divider.waitFor({ state: 'detached' });
      await page.getByText('Flows', { exact: true }).click(); await expectWidth(360);

      // Shrinking the window clamps the displayed size without losing the user's choice.
      await page.setViewportSize({ width: 480, height: 900 });
      await page.waitForFunction(() => {
        const handle = document.querySelector('.flow-panel-divider');
        return Number(handle.getAttribute('aria-valuenow')) < 220;
      });
      await page.waitForFunction(() => {
        const aside = document.getElementById('flowstride-test-flows');
        const main = document.querySelector('main');
        const width = Number(document.querySelector('.flow-panel-divider').getAttribute('aria-valuenow'));
        return Math.abs(aside.getBoundingClientRect().width - width - 1) < 1
          && aside.getBoundingClientRect().width + main.getBoundingClientRect().width <= aside.parentElement.clientWidth + 1;
      });
      assert((await page.locator('main').boundingBox()).width > 150);
      await page.setViewportSize({ width: 1600, height: 1000 }); await expectWidth(360);

      // Interrupted drags restore interaction styles and remove the capture shield.
      let handleBox = await divider.boundingBox();
      await page.mouse.move(handleBox.x + 4, 400); await page.mouse.down();
      await page.mouse.move(handleBox.x + 60, 400, { steps: 4 });
      await page.locator('[data-flow-panel-drag-shield]').waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.locator('[data-flow-panel-drag-shield]').waitFor({ state: 'detached' });
      await page.mouse.up();
      assert.equal(await page.evaluate(() => document.body.style.userSelect), 'text');

      if (engine === 'chromium') {
        await divider.focus(); await page.keyboard.press('Enter'); await expectWidth(280);
        const cdp = await context.newCDPSession(page);
        handleBox = await divider.boundingBox();
        const x = handleBox.x + 4, y = 400;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 95, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expectWidth(375);
        handleBox = await divider.boundingBox();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handleBox.x + 4, y }] });
        await page.locator('[data-flow-panel-drag-shield]').waitFor();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.locator('[data-flow-panel-drag-shield]').waitFor({ state: 'detached' });
        await cdp.detach();
      }
      handleBox = await divider.boundingBox();
      await page.mouse.move(handleBox.x + 4, 400); await page.mouse.down();
      await page.mouse.move(handleBox.x + 40, 400, { steps: 4 });
      await page.locator('[data-flow-panel-drag-shield]').waitFor();
      await page.getByText('Logs', { exact: true }).evaluate(element => element.click());
      await page.locator('[data-flow-panel-drag-shield]').waitFor({ state: 'detached' });
      await page.mouse.up();
      assert.deepEqual(await page.evaluate(() => ({ select: document.body.style.userSelect, cursor: document.body.style.cursor })), { select: 'text', cursor: 'crosshair' });
      await page.getByText('Flows', { exact: true }).click(); await divider.waitFor();
      assert.deepEqual(requests, [], 'resizing and view navigation must not dispatch execution or replay commands');
      assert.deepEqual(errors, []);
      if (process.env.FLOWSTRIDE_PANEL_EVIDENCE) {
        fs.mkdirSync(process.env.FLOWSTRIDE_PANEL_EVIDENCE, { recursive: true });
        await page.screenshot({ path: path.join(process.env.FLOWSTRIDE_PANEL_EVIDENCE, `${required('./package.json').name === 'flowstride' ? 'os' : 'cloud'}-${engine}-resized.png`) });
      }
      await page.reload(); await expectWidth(280);
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
