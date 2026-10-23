const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {createRequire}=require('node:module');
const source=path.resolve(__dirname,'../..'),root=process.env.FLOWSTRIDE_ENGINE_ROOT||source,required=createRequire(path.join(root,'package.json'));
const {chromium}=required('playwright'),{WebSocketServer}=required('ws');
const {FlowWorker}=required('./dist/runner/flow_worker'),{WebAdapter}=required('./dist/adapters/web/playwright'),{ApiAdapter}=required('./dist/adapters/api/undici'),{TemporaryStore}=required('./dist/runner/temporary_store'),{PluginManager}=required('./dist/runner/plugin_manager'),{PersistentVault}=required('./dist/runner/persistent_vault'),{SessionManager}=required('./dist/sessions/manager'),{ApiProxy}=required('./dist/sdk/api_proxy');
const A='a/login.flow',B='b/login.flow',API='api-only.flow';
const mime={'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.html':'text/html'};
test('built dashboard switches each real flow screen/history, isolates logs, and clears rerun state',{timeout:45000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-dashboard-tabs-'));const ui=path.join(root,'src/ui/dist');let browser,worker,client;const errors=[],requests=[],events=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/fixture-api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true}));return;}
  if(url.pathname.startsWith('/fixture/')){const name=url.pathname.split('/').pop();res.writeHead(200,{'Content-Type':'text/html'});res.end(`<title>${name} flow</title><body style="background:${name==='red'?'#b91c1c':'#1d4ed8'};font:40px sans-serif;color:white"><h1>${name} before</h1><button onclick="fetch('/fixture-api/${name}').then(()=>{document.querySelector('h1').textContent='${name} after';document.body.style.background='${name==='red'?'#15803d':'#7e22ce'}'})">Change screen</button></body>`);return;}
  const file=path.resolve(ui,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(ui+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 const sockets=new WebSocketServer({server});sockets.on('connection',socket=>{client=socket;socket.on('message',data=>requests.push(JSON.parse(data)));socket.send(JSON.stringify({type:'CLI_CONTEXT',payload:{command:'run'}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const send=data=>{assert(client&&client.readyState===1);client.send(JSON.stringify(data));};
 try{
  for(const [file,name] of [[A,'red'],[B,'blue']]){const target=path.join(directory,'flows',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,`Feature: ${name} screen\nScenario: Own history\nGiven "Load ${name} screen"\n flow.open "${origin}/fixture/${name}";\nWhen "Change ${name} screen"\n flow.click button "Change screen";\nThen "Check ${name} screen"\n flow.expect visible "${name} after";\n`);}
  const config={headless:true,timeout:3000,recordVideo:false,flowRoot:path.join(directory,'flows')};const web=new WebAdapter(config),api=new ApiAdapter(config),store=new TemporaryStore(),plugins=new PluginManager(config,web,store,new ApiProxy(api));
  worker=new FlowWorker(config,web,api,store,new SessionManager(web,api,new PersistentVault(directory)),plugins);worker.on('worker_event',event=>events.push(JSON.parse(JSON.stringify(event))));
  const oldCwd=process.cwd();process.chdir(directory);try{await worker.runBatch([path.join(directory,'flows',A),path.join(directory,'flows',B)]);}finally{await worker.shutdown();process.chdir(oldCwd);}
  assert(!events.some(event=>event.type==='FILE_FAILED'),JSON.stringify(events.filter(event=>event.type==='FILE_FAILED')));
  const captures=file=>events.filter(event=>event.type==='STEP_UPDATE'&&event.payload.fileName===file&&event.payload.screenshot).map(event=>event.payload);
  const a=captures(A),b=captures(B);assert.equal(a.length,3);assert.equal(b.length,3);assert.equal(a[0].id,b[0].id,'Fixture must exercise repeated step IDs');assert.notEqual(a[0].screenshot,a.at(-1).screenshot);assert.notEqual(a.at(-1).screenshot,b.at(-1).screenshot);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>document.body.textContent.includes('Core memory ready'));await page.getByText('Awaiting execution...', {exact:true}).waitFor();
  const connection=Date.now()+3000;while(!client){assert(Date.now()<connection);await new Promise(resolve=>setTimeout(resolve,10));}
  send({type:'SUITE_START',payload:{}});for(const event of events)send(event);
  const image=page.getByAltText('Browser frame');
  const expectSource=async shot=>{await page.waitForFunction(expected=>document.querySelector('img[alt="Browser frame"]')?.getAttribute('src')?.endsWith(expected),shot);assert(await image.evaluate(img=>img.naturalWidth>0),'Screen must decode');};
  const expectSelection=async(file,step)=>{await page.waitForFunction(({file,id})=>[...document.querySelectorAll('[data-active-step="true"]')].some(element=>element.getAttribute('data-flow-file')===file&&element.getAttribute('data-step-id')===id),{file,id:step.id});await page.locator(`[data-flow-file="${file}"][data-step-id="${step.id}"][data-active-step="true"]`).waitFor({state:'visible'});};
  await page.getByRole('tab',{name:A,exact:true}).click();
  // A live background update from B must not steal A's tab or screen.
  const liveA=await image.getAttribute('src');send({type:'STEP_UPDATE',payload:{...b[0],status:'running'}});send({type:'BROWSER_FRAME',payload:{fileName:B,base64:b.at(-1).screenshot}});
  await page.waitForTimeout(80);assert.equal(await page.getByRole('tab',{name:A,exact:true}).getAttribute('aria-selected'),'true');assert.equal(await image.getAttribute('src'),liveA);
  send({type:'STEP_UPDATE',payload:{...b[0],status:'passed'}});send({type:'RUN_COMPLETE',payload:{status:'success'}});await expectSource(a.at(-1).screenshot);
  await page.getByRole('tab',{name:B,exact:true}).click();await expectSource(b.at(-1).screenshot);
  await page.locator(`[data-flow-file="${B}"][data-step-id="${b[0].id}"]`).click();await expectSource(b[0].screenshot);
  await page.getByRole('tab',{name:A,exact:true}).click();await expectSource(a.at(-1).screenshot);
  await page.locator(`[data-flow-file="${A}"][data-step-id="${a[0].id}"]`).click();await expectSource(a[0].screenshot);
  await expectSelection(A,a[0]);
  if(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE){fs.mkdirSync(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE,(required('./package.json').name==='flowstride'?'oss':'pro')+'-red-history.png')});}
  await page.getByRole('tab',{name:B,exact:true}).click();await expectSource(b[0].screenshot);
  await expectSelection(B,b[0]);
  if(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE)await page.screenshot({path:path.join(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE,(required('./package.json').name==='flowstride'?'oss':'pro')+'-blue-history.png')});
  await page.getByRole('tab',{name:A,exact:true}).click();await expectSource(a[0].screenshot);await expectSelection(A,a[0]);
  // Another flow's sidebar step also selects its correct tab/history.
  await page.locator('aside').getByText(B,{exact:true}).click();await page.locator(`[data-flow-file="${B}"][data-step-id="${b[1].id}"]`).click();await expectSource(b[1].screenshot);assert.equal(await page.getByRole('tab',{name:B,exact:true}).getAttribute('aria-selected'),'true');
  // Explicitly exercise a flow with no browser evidence, including a stale global cursor.
  send({type:'RUN_START',payload:{fileName:API,scenarioName:'API only'}});send({type:'STEP_ADD',payload:{fileName:API,id:b[0].id,type:'Given',description:'API result',command:'get'}});send({type:'STEP_UPDATE',payload:{fileName:API,id:b[0].id,status:'passed'}});send({type:'RUN_COMPLETE',payload:{status:'success'}});
  await page.getByRole('tab',{name:API,exact:true}).click();await page.getByText('No browser screen captured for this test.',{exact:true}).waitFor();assert.equal(await image.count(),0);await page.locator(`[data-flow-file="${API}"][data-step-id="${b[0].id}"]`).click();await page.getByText('No captured screen for this step.',{exact:true}).waitFor();assert.equal(await image.count(),0);
  await page.getByRole('tab',{name:A,exact:true}).click();await expectSource(a[0].screenshot);
  const latestA=events.filter(event=>event.type==='LOG_EVENT'&&event.payload.fileName===A).at(-1).payload.summary;
  await page.locator('main').getByText(latestA,{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Toggle execution details',exact:true}).click();
  const onlyA=events.filter(event=>event.type==='NETWORK_REQ'&&event.payload.fileName===A).find(event=>event.payload.url.endsWith('/fixture-api/red'));const onlyB=events.filter(event=>event.type==='NETWORK_REQ'&&event.payload.fileName===B).find(event=>event.payload.url.endsWith('/fixture-api/blue'));assert(onlyA&&onlyB);
  await page.locator('main').getByText(onlyA.payload.name||onlyA.payload.url,{exact:true}).waitFor();assert.equal(await page.locator('main').getByText(onlyB.payload.name||onlyB.payload.url,{exact:true}).count(),0);
  // Return to Live stays local to A; B's selected snapshot remains intact.
  await page.getByRole('button',{name:'Return to Live',exact:true}).click();assert.equal(await page.getByText('Viewing Historical State',{exact:true}).count(),0);
  await page.getByRole('tab',{name:B,exact:true}).click();await expectSource(b[1].screenshot);await page.getByRole('tab',{name:A,exact:true}).click();assert.equal(await page.getByText('Viewing Historical State',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Rerun',exact:true}).click();await page.getByText('Awaiting execution...',{exact:true}).waitFor();assert.equal(await image.count(),0);assert.equal(await page.getByRole('tab').count(),0);assert.equal(requests.at(-1).type,'RERUN_REQ');assert.equal(requests.at(-1).payload.filePath,A);
  send({type:'SUITE_START',payload:{}});for(const event of events.filter(event=>event.payload?.fileName===A))send(event);send({type:'RUN_COMPLETE',payload:{status:'success'}});await expectSource(a.at(-1).screenshot);assert.equal(await page.getByRole('tab').count(),1);
  send({type:'STEP_UPDATE',payload:{...a[0],status:'failed',attempt:1,profile:'customer',domSnapshot:'first.dom.html'}});
  send({type:'STEP_UPDATE',payload:{...a[0],screenshot:b[0].screenshot,status:'passed',attempt:2,profile:'admin',domSnapshot:'second.dom.html'}});
  await page.locator(`[data-flow-file="${A}"][data-step-id="${a[0].id}"]`).click();
  await expectSource(b[0].screenshot);
  await page.getByLabel('History attempt').selectOption('1'); await expectSource(a[0].screenshot);
  assert.match(await page.getByRole('link',{name:'Read DOM snapshot'}).getAttribute('href'),/first\.dom\.html/);
  await page.getByLabel('History attempt').selectOption('2'); await expectSource(b[0].screenshot);
  assert.match(await page.getByRole('link',{name:'Read DOM snapshot'}).getAttribute('href'),/second\.dom\.html/);
  assert.deepEqual(errors,[]);if(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE){fs.mkdirSync(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.FLOWSTRIDE_DASHBOARD_EVIDENCE,required('./package.json').name==='flowstride'?'oss-tabs.png':'pro-tabs.png')});}
 }finally{await worker?.shutdown();await browser?.close();for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
