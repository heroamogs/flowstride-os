const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const { WebAdapter } = require(path.join(root, 'dist/adapters/web/playwright'));
async function serve(content) {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(typeof content === 'function' ? content(req) : content); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
const stateHtml = '<div id="state"></div><script>window.startup={local:localStorage.getItem("identity"),session:sessionStorage.getItem("identity")};</script>';
function config(extra = {}) { return { ci: true, headless: true, timeout: 1500, recordVideo: false, ...extra }; }
for (const browser of ['chromium', 'firefox', 'webkit']) {
  test(`${browser}: storage restore is top-level/origin scoped, precedes app startup and never reseeds reloads`, async () => {
    const app = await serve(stateHtml), foreign = await serve(`<iframe src="${app.url}/embedded"></iframe>`), web = new WebAdapter(config({ browser }));
    try {
      await web.initialise();
      await web.injectStorage([{ name: 'saved', value: 'cookie', domain: '127.0.0.1', path: '/' }], { identity: 'customer' }, undefined, { identity: 'tab-customer' }, app.url);
      await web.navigate(foreign.url);
      assert.deepEqual(await web.getPage().evaluate(() => ({ local: localStorage.getItem('identity'), session: sessionStorage.getItem('identity') })), { local: null, session: null });
      await web.getPage().frameLocator('iframe').locator('#state').waitFor({ state: 'attached' });
      const frame = web.getPage().frames().find(frame => frame.url().startsWith(app.url));
      assert(frame); await frame.waitForLoadState('domcontentloaded');
      assert.deepEqual(await frame.evaluate(() => ({ local: localStorage.getItem('identity'), session: sessionStorage.getItem('identity') })), { local: null, session: null }, 'even a matching-origin iframe under a foreign site must not receive saved storage');
      await web.navigate(app.url);
      assert.deepEqual(await web.getPage().evaluate(() => window.startup), { local: 'customer', session: 'tab-customer' });
      assert.match(await web.getPage().evaluate(() => document.cookie), /saved=cookie/);
      assert.equal(web.pendingSessionStorageRestore, null);
      await web.getPage().evaluate(() => { localStorage.setItem('identity', 'changed'); sessionStorage.setItem('identity', 'changed-tab'); });
      await web.getPage().reload();
      assert.deepEqual(await web.getPage().evaluate(() => window.startup), { local: 'changed', session: 'changed-tab' });
      await web.getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await web.getPage().reload();
      assert.deepEqual(await web.getPage().evaluate(() => window.startup), { local: null, session: null }, 'logout must remain effective');
    } finally { await web.shutdown(); await foreign.close(); await app.close(); }
  });
  test(`${browser}: hover opens normal menus/tooltips without click, focus, change or duplicate pointer events`, async () => {
    const app = await serve(`<style>#menu,#tooltip{display:none}#wrap:hover #menu,#wrap:hover #tooltip{display:block}</style><button id="focus">Original focus</button><div id="wrap"><button id="target">Hover me</button><div id="menu">Menu content</div><div id="tooltip" role="tooltip">Tooltip content</div></div><script>window.events={click:0,change:0,focus:0,mouseenter:0};const target=document.querySelector('#target');for(const key of Object.keys(events))target.addEventListener(key,()=>events[key]++);document.querySelector('#focus').focus();</script>`), web = new WebAdapter(config({ browser }));
    try {
      await web.initialise(); await web.navigate(app.url); await web.hover('#target');
      assert.equal(await web.getPage().locator('#menu').isVisible(), true); assert.equal(await web.getPage().locator('#tooltip').isVisible(), true);
      assert.deepEqual(await web.getPage().evaluate(() => window.events), { click: 0, change: 0, focus: 0, mouseenter: 1 });
      assert.equal(await web.getPage().evaluate(() => document.activeElement.id), 'focus');
      await web.click('#target'); assert.equal(await web.getPage().evaluate(() => events.click), 1, 'ordinary click still works separately');
    } finally { await web.shutdown(); await app.close(); }
  });
}

test('same-origin immediate and legacy baseUrl localStorage restores are one-shot; selecting another session replaces pending values', async () => {
  const app = await serve(stateHtml), web = new WebAdapter(config({ baseUrl: app.url }));
  try {
    await web.initialise();
    await web.injectStorage([], { identity: 'old' }); await web.injectStorage([], { identity: 'selected' });
    await web.navigate('/'); assert.equal(await web.getPage().evaluate(() => window.startup.local), 'selected');
    await web.injectStorage([], { identity: 'immediate' });
    assert.equal(await web.getPage().evaluate(() => localStorage.getItem('identity')), 'immediate');
    assert.equal(web.pendingSessionStorageRestore, null);
    await web.getPage().evaluate(() => localStorage.setItem('identity', 'application-value'));
    await web.getPage().reload(); assert.equal(await web.getPage().evaluate(() => window.startup.local), 'application-value');
  } finally { await web.shutdown(); await app.close(); }
});

test('pending storage is isolated to named profiles and tabs, and is removed on profile close or retry restoration', async () => {
  const app = await serve(stateHtml), web = new WebAdapter(config());
  try {
    await web.initialise();
    await web.injectStorage([], { identity: 'customer' }, undefined, undefined, app.url);
    await web.createProfile('admin'); await web.injectStorage([], { identity: 'admin' }, undefined, undefined, app.url);
    await web.navigate(app.url); assert.equal(await web.getPage().evaluate(() => window.startup.local), 'admin');
    await web.useProfile('default'); await web.navigate(app.url); assert.equal(await web.getPage().evaluate(() => window.startup.local), 'customer');
    const snapshot = await web.checkpointProfiles();
    await web.createProfile('temporary'); await web.injectStorage([], { identity: 'must-not-leak' }, undefined, undefined, app.url);
    const pendingPage = web.getPage(); assert.equal(web.sessionStorageRestores.size, 1);
    await web.closeProfile('temporary'); assert(pendingPage.isClosed()); assert.equal(web.sessionStorageRestores.size, 0);
    await web.createProfile('retry-pending'); await web.injectStorage([], { identity: 'discard' }, undefined, undefined, app.url);
    await web.restoreProfiles(snapshot); assert.equal(web.sessionStorageRestores.size, 0);
    assert.equal(await web.getPage().evaluate(() => window.startup.local), 'customer');
    await web.getPage().evaluate(() => localStorage.setItem('identity', 'after-retry'));
    await web.getPage().reload(); assert.equal(await web.getPage().evaluate(() => window.startup.local), 'after-retry');
  } finally { await web.shutdown(); await app.close(); }
});

for (const browser of ['chromium', 'firefox', 'webkit']) test(`${browser}: a legacy snapshot uses baseUrl while a foreign page is already open`, async () => {
  const app = await serve(stateHtml), foreign = await serve(stateHtml), web = new WebAdapter(config({ browser, baseUrl: app.url }));
  try {
    await web.initialise(); await web.navigate(foreign.url);
    await web.injectStorage([], { identity: 'legacy-secret' }, undefined, { identity: 'legacy-tab-secret' });
    assert.deepEqual(await web.getPage().evaluate(() => ({ local: localStorage.getItem('identity'), session: sessionStorage.getItem('identity') })), { local: null, session: null });
    await web.getPage().reload();
    assert.deepEqual(await web.getPage().evaluate(() => window.startup), { local: null, session: null });
    await web.navigate(app.url);
    assert.deepEqual(await web.getPage().evaluate(() => window.startup), { local: 'legacy-secret', session: 'legacy-tab-secret' });
    await web.getPage().evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await web.getPage().reload();
    assert.deepEqual(await web.getPage().evaluate(() => window.startup), { local: null, session: null });
  } finally { await web.shutdown(); await foreign.close(); await app.close(); }
});
