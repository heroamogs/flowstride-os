const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { WebAdapter } = require('../../dist/adapters/web/playwright');
const { assertBrowser } = require('../../dist/native/assertions');
const { AssertionFailure, assertionText } = require('../../dist/reporting/assertion_result');

const html = `<!doctype html><html><body>
<style>form{display:block;padding:20px;border:1px solid;width:320px;margin:16px} label,input,button{display:block;margin:8px} #horizontal{display:flex;align-items:center;gap:30px} #horizontal button{display:inline-block}</style>
<form aria-label="Customer form"><label for="customer-email">Email</label><input id="customer-email" type="email" required value="samuel.me"><label>Password<input type="password" value="hidden-password"></label><button type="button">Submit</button></form>
<form aria-label="Administrator form"><label for="admin-email">Email</label><input id="admin-email" type="email" value="administrator@example.test"><button type="button">Submit</button></form>
<button type="button" id="save">Save settings</button><button type="button">button</button>
<input aria-label="Hidden field" style="display:none" value="hidden-data">
<div id="horizontal" role="group" aria-label="Position controls"><button>Choose</button><span>Middle anchor</span><button>Choose</button></div>
</body></html>`;

for (const engine of ['chromium', 'firefox', 'webkit']) test(`${engine} textual/spatial object assertions preserve uniqueness, property types, hidden state and legacy targets`, { timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-readable-assertions-'));
  const lookupTimeout = 5000;
  const mismatchTimeout = 2000;
  const web = new WebAdapter({ browser: engine, projectRoot: root, headless: true, ci: true, recordVideo: false, timeout: lookupTimeout });
  let page;
  try {
    await web.initialise(); page = web.getPage(); await page.setContent(html);
    const check = async data => {
      const results = [];
      await assertBrowser(page, data, lookupTimeout, result => results.push(result), web);
      assert.equal(results.at(-1).status, 'passed');
      return results.at(-1);
    };
    await check({ target: 'Save settings', condition: 'enabled' });
    await check({ target: { text: 'button', element: 'button' }, condition: 'count', value: 1 });
    const nested = await check({ target: { text: 'Email', element: 'input', inside: 'Customer form' }, condition: 'property', property: 'validity.typeMismatch', value: true, message: 'Invalid email syntax must be detected' });
    assert.equal(nested.message, 'Invalid email syntax must be detected');
    assert(nested.checks[0].children.some(item => item.key === 'text' && item.status === 'passed'));
    await check({ target: { text: 'Email', element: 'input', inside: 'Customer form' }, condition: 'value', value: 'samuel.me' });
    await check({ target: { text: 'Email', element: 'input', inside: 'Administrator form' }, condition: 'property', property: 'validity.typeMismatch', value: false });
    await check({ target: { text: 'Submit', element: 'button', inside: 'Customer form', under: 'Password' }, condition: 'enabled' });
    await check({ target: { text: 'Choose', element: 'button', inside: 'Position controls', leftOf: 'Middle anchor' }, condition: 'count', value: 1 });
    await check({ target: { text: 'Choose', element: 'button', inside: 'Position controls', rightOf: 'Middle anchor' }, condition: 'count', value: 1 });
    await check({ target: { text: 'Hidden field', element: 'input' }, condition: 'hidden' });
    await check({ target: { text: 'Hidden field', element: 'input' }, condition: 'value', value: 'hidden-data' });
    await check({ target: 'Never present', condition: 'hidden' });
    await check({ target: 'Never present', condition: 'count', value: 0 });
    await check({ selector: '#customer-email', condition: 'value', value: 'samuel.me' });
    await check({ role: 'button', name: 'Save settings', condition: 'enabled' });
    await check({ selector: '#customer-email', condition: 'property', property: 'value', value: 'samuel.me' });

    let failure;
    await assert.rejects(assertBrowser(page, { target: { text: 'Email', element: 'input' }, condition: 'value', value: 'samuel.me', timeout: mismatchTimeout }, lookupTimeout, result => failure = result, web), AssertionFailure);
    assert.equal(failure.checks.find(item => item.key === 'unique').status, 'failed');
    assert.match(assertionText(failure), /Actual: 2/);

    await page.locator('#save').evaluate(element => element.disabled = true);
    await assert.rejects(assertBrowser(page, { target: 'Save settings', condition: 'enabled', timeout: mismatchTimeout, message: 'Saving requires an approved account' }, lookupTimeout, result => failure = result, web), AssertionFailure);
    assert.equal(failure.message, 'Saving requires an approved account');
    assert.match(assertionText(failure), /Expected: enabled/);
    assert.match(assertionText(failure), /Actual: disabled/);

    // No CSS interpretation or selector injection from a readable text value.
    const quoted = 'Customer "special" \\ path';
    await page.evaluate(text => { const button = document.createElement('button'); button.textContent = text; document.body.append(button); }, quoted);
    await check({ target: { text: quoted, element: 'button' }, condition: 'count', value: 1 });
    await check({ target: { text: '") , input', element: 'button' }, condition: 'count', value: 0 });
    await check({ target: '#customer-email', condition: 'count', value: 0 });

    // Existing explicit frame selector remains available; unqualified cross-frame ambiguity is explicit.
    await page.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'profile-frame'; frame.setAttribute('srcdoc', '<label for="frame-email">Frame email</label><input id="frame-email" value="frame@example.test">'); document.body.append(frame); });
    // Attribute setup avoids the existing stealth plugin's broken dynamic srcdoc setter.
    await page.frameLocator('#profile-frame').getByLabel('Frame email').waitFor({state:'attached',timeout:5000});
    await check({ target: { text: 'Frame email', element: 'input' }, frame: '#profile-frame', condition: 'value', value: 'frame@example.test' });
    await check({ target: { text: 'Frame email', element: 'input' }, condition: 'value', value: 'frame@example.test' });

    // A user-defined getter is never executed while reading a property.
    await page.locator('#customer-email').evaluate(element => { window.getterExecuted = false; Object.defineProperty(element, 'unsafe', { get() { window.getterExecuted = true; return 'should not run'; } }); });
    await assert.rejects(assertBrowser(page, { selector: '#customer-email', condition: 'property', property: 'unsafe', value: 'should not run', timeout: mismatchTimeout }, lookupTimeout, undefined, web), /custom getters/);
    assert.equal(await page.evaluate(() => window.getterExecuted), false);
    for (const property of ['constructor.name', '__proto__.value', 'ownerDocument.cookie', 'validity.constructor', 'value;alert(1)']) {
      await assert.rejects(assertBrowser(page, { selector: '#customer-email', condition: 'property', property, value: true, timeout: 90 }, 100, undefined, web), /Unsafe|path/i);
    }
    for (const data of [
      { target: 'Save settings', selector: '#save', condition: 'enabled' },
      { target: 'Save settings', role: 'button', condition: 'enabled' },
      { target: 'Save settings', name: 'other', condition: 'enabled' },
      { selector: '', condition: 'visible' },
    ]) await assert.rejects(assertBrowser(page, data, 100, undefined, web));
  } finally { await web.shutdown(); fs.rmSync(root, { recursive: true, force: true }); }
});
