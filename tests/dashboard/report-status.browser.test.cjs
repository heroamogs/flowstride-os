const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { ui, requireEngine, esbuild, loadSource, states, attack, scenario } = require('../helpers/report-status.cjs');
const { chromium } = requireEngine('playwright');
const { WebSocketServer } = requireEngine('ws');
const { PdfGenerator } = loadSource('src/reporting/pdf_generator.ts');

test('real TestCase UI renders truthful states, escapes inputs and preserves PDF export data', { timeout: 30000 }, async () => {
  const fixture = scenario();
  fixture.steps[0].command = attack;
  fixture.steps[0].description = attack;
  const bundle = esbuild.buildSync({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TestCaseView}from'./src/views/TestCaseView';import{connectToRunner}from'./src/socket';connectToRunner();createRoot(document.getElementById('root')).render(React.createElement(TestCaseView));`,
      resolveDir: ui, sourcefile: 'report-status-harness.tsx', loader: 'tsx',
    }, bundle: true, write: false, platform: 'browser', format: 'iife',
    tsconfig: path.join(ui, 'tsconfig.app.json'),
  }).outputFiles[0].text;
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><div id="root"></div><script src="/app.js"></script>'); }
  });
  const sockets = new WebSocketServer({ server });
  let resolveExport;
  const exported = new Promise(resolve => { resolveExport = resolve; });
  sockets.on('connection', socket => {
    socket.on('message', raw => { const data = JSON.parse(raw); if (data.type === 'EXPORT_PDF_REQ') resolveExport(data.payload); });
    socket.send(JSON.stringify({ type: 'SUITE_START' }));
    socket.send(JSON.stringify({ type: 'RUN_START', payload: { fileName: fixture.fileName, scenarioName: fixture.name } }));
    for (const step of fixture.steps) {
      socket.send(JSON.stringify({ type: 'STEP_ADD', payload: { ...step, fileName: fixture.fileName } }));
      socket.send(JSON.stringify({ type: 'STEP_UPDATE', payload: { id: step.id, fileName: fixture.fileName, status: step.status } }));
    }
    // Keep the suite live so pending/running rows can be inspected alongside finished steps.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('tr[data-step-status]').first().waitFor();
    const rows = await page.locator('tr[data-step-status]').evaluateAll(rows => rows.map(row => ({
      status: row.dataset.stepStatus, cells: [...row.cells].map(cell => cell.textContent),
      color: row.cells[4].querySelector('span').style.color,
    })));
    assert.equal(rows.length, states.length);
    rows.forEach((row, index) => {
      assert.equal(row.status, states[index][1]);
      assert.equal(row.cells[3], states[index][3]);
      assert.equal(row.cells[4], states[index][2]);
      assert.equal(row.color === 'rgb(16, 185, 129)', row.status === 'passed');
    });
    assert.equal(rows[0].cells[1], attack);
    assert.equal(rows[0].cells[2], 'When ' + attack);
    assert.equal(await page.locator('img, iframe').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.reportInjected), undefined);
    assert(!requests.some(url => url.includes('attacker.invalid')));
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const sentExport = await exported;
    assert.equal(sentExport.length, 1);
    assert.equal(sentExport[0].steps.length, fixture.steps.length);
    assert.equal(sentExport[0].steps[0].command, attack);
    assert.equal(sentExport[0].steps[6].status, 'skipped');
    assert.deepEqual(pageErrors, []);
    if (process.env.FLOWSTRIDE_REPORT_EVIDENCE) {
      fs.mkdirSync(process.env.FLOWSTRIDE_REPORT_EVIDENCE, { recursive: true });
      await page.screenshot({ path: path.join(process.env.FLOWSTRIDE_REPORT_EVIDENCE, requireEngine('./package.json').name === 'flowstride' ? 'os-report-status.png' : 'cloud-report-status.png'), fullPage: true });
    }
  } finally {
    await browser?.close();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('generated PDF HTML is inert in Chromium and public PDF export still produces a PDF', { timeout: 30000 }, async () => {
  const generator = new PdfGenerator();
  const fixture = scenario(attack);
  fixture.steps[0].command = attack;
  fixture.steps[0].description = attack;
  fixture.steps[1].status = attack;
  const html = generator.generateReportHtml([fixture]);
  const requests = [];
  let browser;
  const output = fs.mkdtempSync(path.join(process.cwd(), '.flowstride-report-status-'));
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('request', request => requests.push(request.url()));
    await page.setContent(html);
    assert.equal(await page.locator('script, img, iframe').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.reportInjected), undefined);
    assert.deepEqual(requests, []);
    assert.equal(await page.locator('[data-report-count="passed"]').textContent(), '2');
    assert.equal(await page.locator('[data-report-count="failed"]').textContent(), '3');
    assert.equal(await page.locator('tr[data-step-status="skipped"]').locator('td').nth(3).textContent(), 'Step skipped; not executed.');
    const pdfPath = await generator.generateTestcasePdf([fixture], output);
    const bytes = fs.readFileSync(pdfPath);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert(bytes.length > 2000);
  } finally {
    await browser?.close();
    fs.rmSync(output, { recursive: true, force: true });
  }
});
