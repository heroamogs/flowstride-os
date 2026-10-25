const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const { WebAdapter } = require(path.join(root, 'dist/adapters/web/playwright'));

for (const origin of [undefined, 'file:///tmp/fixture', 'not-a-url', 'null']) test(`localStorage requires a trustworthy HTTP(S) origin before any cookie/storage write: ${origin}`, async () => {
  const web = new WebAdapter({ headless: true, timeout: 100 }); let writes = 0;
  web.context = { addCookies: async () => writes++ };
  web.page = { url: () => 'about:blank', addInitScript: async () => writes++, evaluate: async () => writes++ };
  await assert.rejects(web.injectStorage([{ name: 'session', value: 'secret' }], { secret: 'saved' }, undefined, undefined, origin), /requires a saved HTTP\(S\) origin/);
  assert.equal(writes, 0);
});
test('cookie-only legacy sessions do not require Web Storage origin metadata', async () => {
  const web = new WebAdapter({ headless: true, timeout: 100 }); let cookies;
  web.context = { addCookies: async value => { cookies = value; } }; web.page = { url: () => 'about:blank' };
  await web.injectStorage([{ name: 'legacy', value: 'cookie', domain: 'example.test', path: '/' }]);
  assert.equal(cookies[0].name, 'legacy');
});
test('hover delegates to a real pointer hover and propagates actionability failures without clicking', async () => {
  const calls = [], web = new WebAdapter({ headless: true, timeout: 100 });
  const target = { waitFor: async options => calls.push(['visible', options]), scrollIntoViewIfNeeded: async () => calls.push(['scroll']),
    hover: async () => { calls.push(['hover']); throw new Error('Target is covered'); },
    click: async () => { throw new Error('Hover must not click'); }, focus: async () => { throw new Error('Hover must not focus'); } };
  web.getLocator = async () => target; web.checkAmbiguity = async value => value;
  await assert.rejects(web.hover('#target'), /Target is covered/);
  assert.deepEqual(calls, [['visible', { state: 'visible' }], ['scroll'], ['hover']]);
});

test('legacy storage uses configured application origin before an unrelated active page', async () => {
  const web = new WebAdapter({ headless: true, timeout: 100, baseUrl: 'https://trusted-app.example/start' });
  let data, evaluated = false;
  web.context = { addCookies: async () => {} };
  web.page = { url: () => 'https://unrelated-site.example/page',
    addInitScript: async (_restore, value) => { data = value; return { dispose: async () => {} }; },
    evaluate: async () => { evaluated = true; }, on() {}, off() {}, isClosed: () => false };
  await web.injectStorage([], { accessToken: 'legacy-session-secret' });
  assert.equal(evaluated, false, 'legacy secrets must not be injected into the unrelated active page');
  assert.equal(data.origin, 'https://trusted-app.example');
  assert.deepEqual(data.local, { accessToken: 'legacy-session-secret' });
});
