const {test}=require('node:test');
const assert=require('node:assert/strict');
const engines=require('playwright');
const {readBrowserProperty}=require('../../dist/native/paths');

for(const engine of ['chromium','firefox','webkit'])test(`${engine} property paths read native state without DOM/global traversal or application getter execution`,{timeout:30000},async()=>{
 const browser=await engines[engine].launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<label>Email<input id="email" type="email" value="reader@example.test"></label>');
  await page.evaluate(()=>{
   window.propertyGetterCalls=0;
   const field=document.getElementById('email');
   field.refs={win:window,node:document};
   field.binding={get secret(){window.propertyGetterCalls++;return 'private';}};
   field.symbolData={value:12,get [Symbol.toStringTag](){window.propertyGetterCalls++;return 'Object';}};
   Object.defineProperty(field,'value',{get(){window.propertyGetterCalls++;return 'application-wrapper';},configurable:true});
  });
  const input=page.locator('#email');
  assert.equal(await readBrowserProperty(input,'value'),'reader@example.test');
  assert.equal(await readBrowserProperty(input,'validity.typeMismatch'),false);
  assert.equal(await readBrowserProperty(input,'symbolData.value'),12);
  for(const path of ['ownerDocument.cookie','parentNode.parentNode.cookie','refs.node.cookie','refs.win.name','binding.secret','constructor.name','__proto__.ownerDocument','valueOf'])await assert.rejects(readBrowserProperty(input,path));
  assert.equal(await page.evaluate(()=>window.propertyGetterCalls),0);
  await assert.rejects(readBrowserProperty(page.locator('missing'),'value'),/exactly one/);
  await page.evaluate(()=>{const duplicate=document.createElement('input');duplicate.type='email';document.body.appendChild(duplicate);});
  await assert.rejects(readBrowserProperty(page.locator('input'),'value'),/found 2/);
 }finally{await browser.close();}
});
