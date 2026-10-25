const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource, states, attack, scenario } = require('../helpers/report-status.cjs');
const { stepStatusPresentation } = loadSource('src/reporting/step_status.ts');
const { PdfGenerator } = loadSource('src/reporting/pdf_generator.ts');

for (const [input, state, label, actualResult] of states) {
  test(`report status ${String(input)} never invents a successful result`, () => {
    const result = stepStatusPresentation(input);
    assert.equal(result.status, state);
    assert.equal(result.label, label);
    assert.equal(result.actualResult, actualResult);
    assert.equal(result.isPassed, state === 'passed');
    assert.equal(result.isFailed, state === 'failed' || state === 'error');
    assert.equal(result.color === '#10b981', state === 'passed');
    if (state !== 'passed') assert.doesNotMatch(result.actualResult, /verified|success/i);
  });
}

test('status aliases normalize safely; malformed and invented values remain unknown', () => {
  assert.equal(stepStatusPresentation(' NOT-TESTED ').status, 'not_tested');
  assert.equal(stepStatusPresentation('not tested').status, 'not_tested');
  assert.equal(stepStatusPresentation('canceled').status, 'cancelled');
  assert.equal(stepStatusPresentation('in progress').status, 'running');
  for (const input of [attack, '__proto__', 'not-skipped', {}, [], true, 1]) {
    const result = stepStatusPresentation(input);
    assert.equal(result.status, 'unknown');
    assert.equal(result.actualResult, 'Result unavailable.');
    assert.equal(result.isPassed, false);
  }
});

test('PDF rows and summary counts agree for every supported result state', () => {
  const generator = new PdfGenerator();
  const html = generator.generateReportHtml([scenario()]);
  const rows = [...html.matchAll(/<tr data-step-status="([^"]+)">([\s\S]*?)<\/tr>/g)];
  assert.equal(rows.length, states.length);
  rows.forEach((row, index) => {
    const [, state, label, actualResult] = states[index];
    assert.equal(row[1], state);
    assert(row[2].includes(`>${actualResult}</td>`));
    assert(row[2].includes(`>${label}</td>`));
    if (state !== 'passed') assert.doesNotMatch(row[2], /verified successfully/);
  });
  assert.match(html, /data-report-count="total"[^>]*>15<\/div>/);
  assert.match(html, /data-report-count="passed"[^>]*>3<\/div>/);
  assert.match(html, /data-report-count="failed"[^>]*>3<\/div>/);
  // The same report is accepted through the file/scenario export envelope.
  assert.equal(generator.generateReportHtml({ files: [{ scenarios: [scenario()] }] }), html);
  assert.match(html, /__PROTO__/);
});

test('PDF treats file names, actions, expected results and statuses as inert text', () => {
  const generator = new PdfGenerator();
  const html = generator.generateReportHtml([{ fileName: attack, steps: [{
    command: attack, type: attack, description: attack, status: attack,
  }, { action: attack, expected: attack, status: 'not_tested' }] }]);
  assert.doesNotMatch(html, /<img|<script|<iframe/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;/);
  assert.match(html, /&amp;/);
  assert.match(html, /data-step-status="unknown"/);
  assert.doesNotMatch(html, /verified successfully/);
  assert.match(html, /data-report-count="passed"[^>]*>0<\/div>/);
});
