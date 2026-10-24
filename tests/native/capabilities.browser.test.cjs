const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {WebAdapter}=require('../../dist/adapters/web/playwright');
const {NativeRuntime}=require('../../dist/native/runtime');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const {ApiAdapter}=require('../../dist/adapters/api/undici');
const {TemporaryStore}=require('../../dist/runner/temporary_store');
const {SessionManager}=require('../../dist/sessions/manager');
const {PersistentVault}=require('../../dist/runner/persistent_vault');
const temp=()=>fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-capabilities-')));
const html=`<!doctype html><html lang="en"><head><title>Native fixture</title></head><body><main><h1>Ready</h1><button id="fetch" onclick="fetch('/data').then(r=>r.json()).then(r=>document.querySelector('output').textContent=r.message)">Fetch data</button><output></output><a href="/download">Download</a><input id="field" aria-label="Name" value="reader"><script>window.sum=(a,b)=>a+b;</script></main></body></html>`;
async function server(){let received;const server=http.createServer(async(req,res)=>{
 if(req.url==='/data'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'real',keep:true}));return;}
 if(req.url==='/echo'){let body='';for await(const chunk of req)body+=chunk;received={headers:req.headers,method:req.method,body};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(received));return;}
 if(req.url==='/download'){res.setHeader('Content-Disposition','attachment; filename="report.json"');res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
 res.setHeader('Content-Type','text/html');res.end(html);
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{url:`http://127.0.0.1:${server.address().port}`,received:()=>received,close:()=>new Promise(resolve=>server.close(resolve))};}
async function fixture(browser='chromium',extra={}){const root=temp(),config={projectRoot:root,artifactsDir:path.join(root,'evidence'),testFile:'fixture.flow',ci:true,headless:true,recordVideo:false,timeout:2500,browser,...extra};const web=new WebAdapter(config);await web.initialise();return{root,config,web,runtime:new NativeRuntime(web,config)};}
for(const browser of ['chromium','firefox','webkit'])test(`isolated profiles, current storage save/use and retrying assertions on ${browser}`,async()=>{
 const f=await fixture(browser),app=await server(),{web,runtime}=f;
 try{
  await web.navigate(app.url);await web.getPage().evaluate(()=>{localStorage.setItem('role','customer');sessionStorage.setItem('role','customer');document.cookie='role=customer';});
  const saved=await web.getState();
  await runtime.execute('browser.create',{name:'admin',options:{locale:'en-GB',colorScheme:'dark'}});await web.navigate(app.url);
  assert.equal(await web.getPage().evaluate(()=>localStorage.getItem('role')),null);assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('role')),null);assert.equal((await web.getState()).cookies.length,0);
  await web.getPage().evaluate(()=>{localStorage.setItem('role','admin');sessionStorage.setItem('role','admin');document.cookie='role=admin';});
  await runtime.execute('browser.use',{name:'default'});assert.equal(await web.getPage().evaluate(()=>localStorage.getItem('role')),'customer');
  await runtime.execute('assert.that',{condition:'localStorage',key:'role',value:'customer'});
  await runtime.execute('assert.that',{condition:'title',value:'Native fixture'});
  await runtime.execute('assert.that',{condition:'value',selector:'#field',value:'reader'});
  await runtime.execute('assert.that',{condition:'accessibleName',selector:'#field',value:'Name'});
  await runtime.execute('assert.that',{condition:'count',selector:'h1',value:1});
  await web.getPage().evaluate(()=>setTimeout(()=>document.querySelector('h1').textContent='Updated',100));
  await runtime.execute('assert.that',{condition:'text',role:'heading',name:'Updated',value:'Updated'});
  await assert.rejects(runtime.execute('assert.that',{condition:'text',selector:'h1',value:'Wrong',timeout:100}));
  await runtime.execute('browser.use',{name:'admin'});assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('role')),'admin');
  await web.injectStorage(saved.cookies,saved.localStorage,undefined,saved.sessionStorage,saved.storageOrigin);
  assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('role')),'customer');
  await runtime.execute('browser.close',{name:'admin'});assert.equal(web.activeProfile,'default');assert.deepEqual(web.profileNames(),['default']);
 }finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('real network mock, patch, request modification, armed response assertions and route cleanup',async()=>{
 const app=await server(),f=await fixture(),{web,runtime,root}=f;
 try{await web.navigate(app.url);
  await runtime.execute('network.route',{name:'mock',url:'**/data',json:{message:'mocked'},times:1});
  await runtime.execute('network.arm',{name:'data',url:'**/data',kind:'response',method:'GET'});await web.getPage().click('#fetch');await runtime.execute('network.wait',{name:'data'});
  await runtime.execute('network.expect',{name:'data',status:200,path:'message',equals:'mocked'});
  assert.equal(await web.getPage().textContent('output'),'mocked');
  await runtime.execute('network.route',{name:'patch',url:'**/data',mode:'patch',json:{message:'patched'}});
  await runtime.execute('network.arm',{name:'patch-result',url:'**/data'});await web.getPage().click('#fetch');await runtime.execute('network.wait',{name:'patch-result'});
  await runtime.execute('network.expect',{name:'patch-result',path:'keep',equals:true});await runtime.execute('network.expect',{name:'patch-result',path:'message',equals:'patched'});await runtime.execute('network.unroute',{name:'patch'});
  await runtime.execute('network.route',{name:'modify',url:'**/echo',mode:'continue',request:{method:'POST',body:'edited',headers:{'x-fixture':'native'}}});
  await runtime.execute('network.arm',{name:'request',url:'**/echo',kind:'request'});await web.getPage().evaluate(()=>fetch('/echo',{method:'POST',body:'original'}));await runtime.execute('network.wait',{name:'request'});assert.equal(app.received().body,'edited');assert.equal(app.received().headers['x-fixture'],'native');
  await runtime.execute('network.unroute',{name:'modify'});
  fs.writeFileSync(path.join(root,'fixture.json'),'{"message":"fixture"}');await runtime.execute('network.route',{name:'fixture',url:'**/data',fixture:'fixture.json',contentType:'application/json'});await web.getPage().click('#fetch');await runtime.execute('assert.that',{selector:'output',condition:'text',value:'fixture'});
  await runtime.execute('network.route',{name:'blocked',url:'**/blocked',mode:'abort'});assert.equal(await web.getPage().evaluate(()=>fetch('/blocked').then(()=>false,()=>true)),true);
  await runtime.execute('network.arm',{name:'never',url:'**/never',timeout:20});await new Promise(resolve=>setTimeout(resolve,40));await assert.rejects(runtime.execute('network.wait',{name:'never'}),/timed out/);
 }finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('downloads are armed before clicks, saved within project and asserted by metadata/content',async()=>{
 const app=await server(),{web,runtime,root}=await fixture();
 try{await web.navigate(app.url);await runtime.execute('download.arm',{name:'report'});await web.getPage().click('a');await runtime.execute('download.save',{name:'report',file:'downloads/report.json'});await runtime.execute('download.expect',{name:'report',filename:'report.json',size:11,json:{ok:true},contains:'ok'});await assert.rejects(runtime.execute('download.expect',{name:'report',size:99}),/assertion failed/);
  await runtime.execute('download.arm',{name:'escape'});await web.getPage().click('a');await assert.rejects(runtime.execute('download.save',{name:'escape',file:'../escape.json'}),/inside the project/);
  assert.equal(fs.readFileSync(path.join(root,'downloads/report.json'),'utf8'),'{"ok":true}');
 }finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('native clock, spies/stubs and restoration work without project plugins',async()=>{
 const app=await server(),{web,runtime}=await fixture();
 try{await runtime.execute('clock.install',{time:'2026-01-01T00:00:00Z'});await web.navigate(app.url);await runtime.execute('stub.install',{name:'sum',target:'sum'});assert.equal(await web.getPage().evaluate(()=>sum(1,2)),3);await runtime.execute('stub.expect',{name:'sum',count:1,args:[1,2]});await runtime.execute('stub.restore',{name:'sum'});
  await runtime.execute('stub.install',{name:'constant',target:'sum',mode:'return',value:42});assert.equal(await web.getPage().evaluate(()=>sum(1,2)),42);await runtime.execute('stub.restore',{name:'constant'});assert.equal(await web.getPage().evaluate(()=>sum(1,2)),3);
  await web.getPage().evaluate(()=>{window.done=false;setTimeout(()=>window.done=true,1000);});await runtime.execute('clock.runFor',{milliseconds:1100});assert.equal(await web.getPage().evaluate(()=>window.done),true);
  await runtime.execute('clock.setFixedTime',{time:'2026-05-01T00:00:00Z'});assert.equal(await web.getPage().evaluate(()=>new Date().toISOString()),'2026-05-01T00:00:00.000Z');
 }finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('axe detects a real defect, ARIA baselines compare and CI cannot overwrite them',async()=>{
 const app=await server(),{web,runtime,root,config}=await fixture();
 try{await web.navigate(app.url);await runtime.execute('a11y.scan',{tags:['wcag2a']});
  await web.getPage().evaluate(()=>{const button=document.createElement('button');document.body.appendChild(button);});
  await assert.rejects(runtime.execute('a11y.scan',{name:'bad',tags:['wcag2a']}),/Accessibility assertion failed/);
  const snapshot=await web.getPage().locator('main').ariaSnapshot();fs.writeFileSync(path.join(root,'main.aria.yml'),snapshot);
  await runtime.execute('a11y.snapshot',{name:'main',selector:'main',baseline:'main.aria.yml'});await runtime.execute('a11y.match',{selector:'main',yaml:snapshot});
  await assert.rejects(runtime.execute('a11y.snapshot',{name:'main',baseline:'main.aria.yml',update:true}),/CI/);assert.equal(fs.readFileSync(path.join(root,'main.aria.yml'),'utf8'),snapshot);
  await web.getPage().evaluate(()=>document.querySelector('h1').textContent='Changed');await assert.rejects(runtime.execute('a11y.snapshot',{name:'main',selector:'main',baseline:'main.aria.yml'}),/differs/);
 }finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('trace/HAR are finalized and HAR replays without the real application',async()=>{
 const app=await server(),f=await fixture('chromium',{trace:true,har:true}),{web,runtime,root,config}=f;
 await web.navigate(app.url);await web.getPage().click('#fetch');await runtime.execute('assert.that',{selector:'output',condition:'text',value:'real'});
 await runtime.dispose();await web.shutdown();await app.close();const files=fs.readdirSync(config.artifactsDir);assert(files.some(file=>file.endsWith('-trace.zip')));const har=files.find(file=>file.endsWith('.har'));assert(har);const recorded=JSON.parse(fs.readFileSync(path.join(config.artifactsDir,har)));assert(recorded.log.entries.some(entry=>entry.request.url.endsWith('/data')));
 const replayWeb=new WebAdapter({...config,trace:false,har:false});await replayWeb.initialise();const replay=new NativeRuntime(replayWeb,{...config,trace:false,har:false});
 try{await replay.execute('har.replay',{file:path.relative(root,path.join(config.artifactsDir,har))});await replayWeb.navigate(app.url);await replayWeb.getPage().click('#fetch');await replay.execute('assert.that',{selector:'output',condition:'text',value:'real'});}finally{await replay.dispose();await replayWeb.shutdown();}
});
for(const framework of ['vanilla','react','vue'])test(`native ${framework} component mount, props update, unmount and private-file denial`,async()=>{
 const {web,runtime,root}=await fixture();
 fs.writeFileSync(path.join(root,'package.json'),'{"name":"component-fixture","private":true}');
 // Use the fixture project's dependencies, as a real app does.
 fs.symlinkSync(path.resolve(__dirname,'../../node_modules'),path.join(root,'node_modules'),'dir');
 const module=framework==='react'?'Counter.jsx':framework==='vue'?'Counter.vue':'Counter.js';
 const source=framework==='react'?`import React from 'react';export default function Counter({label}){return <button onClick={event=>event.target.textContent='Clicked'}>{label}</button>}`:framework==='vue'?`<script setup>defineProps({label:String})</script><template><button @click="$event.target.textContent='Clicked'">{{label}}</button></template>`:`export default function mount(target,props){const button=document.createElement('button');button.textContent=props.label;button.onclick=()=>button.textContent='Clicked';target.appendChild(button);return{unmount(){button.remove()}}}`;
 fs.writeFileSync(path.join(root,module),source);fs.mkdirSync(path.join(root,'.flowstride'),{recursive:true});fs.writeFileSync(path.join(root,'.flowstride/credentials.json'),'sensitive-fixture');
 try{await runtime.execute('component.mount',{framework,module,props:{label:'Initial'}});await runtime.execute('assert.that',{role:'button',name:'Initial',condition:'visible'});await web.getPage().getByRole('button').click();await runtime.execute('assert.that',{selector:'button',condition:'text',value:'Clicked'});
  await runtime.execute('component.update',{props:{label:'Updated'}});await runtime.execute('assert.that',{selector:'button',condition:'text',value:'Updated'});
  const status=await web.getPage().evaluate(()=>fetch('/.flowstride/credentials.json').then(response=>response.status));assert.notEqual(status,200);
  await runtime.execute('component.unmount',{});await runtime.execute('assert.that',{selector:'button',condition:'count',value:0});
 }finally{await runtime.dispose();await web.shutdown();}
});
test('all native condition families retry/read real state and fail incorrect expectations',async()=>{
 const {web,runtime}=await fixture();try{const page=web.getPage();await page.setContent('<h1 id="heading" data-state="ready" style="color:rgb(255, 0, 0)">Ready page</h1><input id="input" value="value" aria-label="Name" aria-describedby="description"><p id="description">Account name</p><input id="checked" type="checkbox" checked><button id="disabled" disabled>Disabled</button><div id="empty"></div><select id="multi" multiple><option value="a" selected>A</option><option value="b" selected>B</option></select>');await page.focus('#input');
  for(const data of [{condition:'attached',selector:'#heading'},{condition:'visible',selector:'#heading'},{condition:'hidden',selector:'#missing'},{condition:'enabled',selector:'#input'},{condition:'disabled',selector:'#disabled'},{condition:'editable',selector:'#input'},{condition:'checked',selector:'#checked'},{condition:'empty',selector:'#empty'},{condition:'focused',selector:'#input'},{condition:'containsText',selector:'#heading',value:'page'},{condition:'attribute',selector:'#heading',attribute:'data-state',value:'ready'},{condition:'css',selector:'#heading',property:'color',value:'rgb(255, 0, 0)'},{condition:'property',selector:'#input',property:'value',value:'value'},{condition:'id',selector:'h1',value:'heading'},{condition:'values',selector:'#multi',value:['a','b']},{condition:'accessibleName',selector:'#input',value:'Name'},{condition:'accessibleDescription',selector:'#input',value:'Account name'},{condition:'inViewport',selector:'#heading'},{condition:'text',selector:'h1',matches:'^Ready'},{condition:'text',selector:'h1',value:'Wrong',not:true}])await runtime.execute('assert.that',data);
  for(const data of [{condition:'attribute',selector:'#heading',attribute:'missing',value:''},{condition:'checked',selector:'#checked',not:true},{condition:'property',selector:'#input',property:'value',value:'wrong'}])await assert.rejects(runtime.execute('assert.that',{...data,timeout:60}));
 }finally{await runtime.dispose();await web.shutdown();}
});
test('DOM snapshot route serves inert text and rejects credentials, traversal and disabled capture',async()=>{
 const {serveDOMSnapshot}=require('../../dist/native/evidence'),root=temp(),directory=path.join(root,'evidence');fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'step.dom.html'),'<script>throw new Error("must never execute")</script>');fs.writeFileSync(path.join(root,'credentials.json'),'private');const config={projectRoot:root,artifactsDir:directory,domSnapshots:true};const server=http.createServer((req,res)=>{if(!serveDOMSnapshot(req,res,config)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/evidence?file=`;
 try{const result=await fetch(url+encodeURIComponent(path.join(directory,'step.dom.html')));assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/^text\/plain/);assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.match(await result.text(),/<script>/);assert.equal((await fetch(url+encodeURIComponent(path.join(root,'credentials.json')))).status,404);assert.equal((await fetch(url+'../../credentials.json')).status,404);config.domSnapshots=false;assert.equal((await fetch(url+encodeURIComponent(path.join(directory,'step.dom.html')))).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('pending session restoration stays isolated when another profile receives its own snapshot',async()=>{
 const app=await server(),{web,runtime}=await fixture();try{await web.injectStorage([],{},undefined,{role:'customer'},app.url);await runtime.execute('browser.create',{name:'admin'});await web.injectStorage([],{},undefined,{role:'admin'},app.url);await web.navigate(app.url);assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('role')),'admin');await runtime.execute('browser.use',{name:'default'});await web.navigate(app.url);assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('role')),'customer');await web.getPage().evaluate(()=>sessionStorage.setItem('role','changed'));await web.getPage().reload();assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('role')),'changed');}finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('retry checkpoint restores all starting tabs/profiles and one-time session storage',async()=>{
 const app=await server(),{web,runtime}=await fixture();try{await web.navigate(app.url);await web.getPage().evaluate(()=>sessionStorage.setItem('tab','first'));const first=web.getPage();const second=await first.context().newPage();await second.goto(app.url+'/tab');await second.evaluate(()=>sessionStorage.setItem('tab','second'));await web.switchTo('next');const baseline=await web.checkpointProfiles();await runtime.execute('browser.create',{name:'failed-attempt'});await web.navigate(app.url);await web.restoreProfiles(baseline);assert.deepEqual(web.profileNames(),['default']);assert.equal(web.getContext().pages().length,2);assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('tab')),'second');await web.getPage().evaluate(()=>sessionStorage.setItem('tab','updated'));await web.getPage().reload();assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('tab')),'updated');await web.switchTo('previous');assert.equal(await web.getPage().evaluate(()=>sessionStorage.getItem('tab')),'first');}finally{await runtime.dispose();await web.shutdown();await app.close();}
});
test('default profile authentication is not silently copied into a newly named profile',async()=>{
 const app=await server(),f=await fixture('chromium',{browserOptions:{storageState:{cookies:[],origins:[{origin:app.url,localStorage:[{name:'account',value:'seeded-default'}]}]}}});try{await f.web.navigate(app.url);assert.equal(await f.web.getPage().evaluate(()=>localStorage.getItem('account')),'seeded-default');await f.runtime.execute('browser.create',{name:'new-user'});await f.web.navigate(app.url);assert.equal(await f.web.getPage().evaluate(()=>localStorage.getItem('account')),null);}finally{await f.runtime.dispose();await f.web.shutdown();await app.close();}
});
