const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');const {once}=require('node:events'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),req=require('node:module').createRequire(path.join(root,'package.json'));
const {chromium,firefox,webkit}=req('playwright'),WebSocket=req('ws'),{FlowWorker}=req('./dist/runner/flow_worker'),{FlowOrchestrator}=req('./dist/runner/flow_orchestrator'),{WebAdapter}=req('./dist/adapters/web/playwright'),{ApiAdapter}=req('./dist/adapters/api/undici'),{TemporaryStore}=req('./dist/runner/temporary_store'),{SessionManager}=req('./dist/sessions/manager'),{PersistentVault}=req('./dist/runner/persistent_vault'),{PluginManager}=req('./dist/runner/plugin_manager'),{ApiProxy}=req('./dist/sdk/api_proxy');
for(const [engine,browserType] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]) test(`actual ${engine} dashboard protects manual Replay/cURL and preserves emailVerified`,{timeout:60000},async()=>{
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-curl-browser-')));let browser,worker,orchestrator;const captured=[],events=[],body={email:'fixture@example.test',password:"a' b $HOME",note:"ordinary ' $HOME",authMode:'cookie'};
 const fixture=http.createServer(async(request,response)=>{let raw='';for await(const chunk of request)raw+=chunk;if(request.url==='/login'){captured.push({method:request.method,headers:request.headers,body:raw});response.setHeader('Content-Type','application/json');response.end(JSON.stringify({ok:true,email:JSON.parse(raw).email,emailVerified:false,echo:JSON.parse(raw).password,token:'server-token'}));return;}response.setHeader('Content-Type','text/html');response.setHeader('Set-Cookie','fixture-session=fixture-cookie; Path=/');response.end(`<button onclick='fetch("/login",{method:"POST",headers:{"Authorization":"Bearer fixture-bearer","Content-Type":"application/json"},body:JSON.stringify(${JSON.stringify(body).replace(/'/g,'&#39;')})}).then(()=>document.querySelector("h1").textContent="Login finished")'>Login</button><h1>Waiting</h1>`);});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const fixtureOrigin='http://127.0.0.1:'+fixture.address().port;
 const oldCwd=process.cwd();const oldArgv=[...process.argv];process.argv.push('--headless');
 try{
  fs.mkdirSync(path.join(directory,'flows'));const file=path.join(directory,'flows/login.flow');fs.writeFileSync(file,`Feature: Local cURL\nScenario: Copy original request\nGiven "Open fixture"\n flow.open "${fixtureOrigin}";\nWhen "Login"\n flow.click button "Login";\nThen "Finish login"\n flow.expect visible "Login finished";\n`);
  const config={projectRoot:directory,ci:false,browser:engine,headless:true,timeout:3000,recordVideo:false,flowRoot:path.join(directory,'flows')},web=new WebAdapter(config),api=new ApiAdapter(config),store=new TemporaryStore(),plugins=new PluginManager(config,web,store,new ApiProxy(api));worker=new FlowWorker(config,web,api,store,new SessionManager(web,api,new PersistentVault(directory)),plugins);worker.on('worker_event',e=>events.push(e));
  let ready;const gate=new Promise(resolve=>ready=resolve),batch=worker.runBatch.bind(worker);worker.runBatch=async(...args)=>{await gate;return batch(...args);};process.chdir(directory);orchestrator=new FlowOrchestrator(worker,1,config);const running=orchestrator.start(file);running.catch(()=>{});await once(orchestrator.httpServer,'listening');assert.equal(orchestrator.httpServer.address().address,'127.0.0.1');const origin='http://127.0.0.1:'+orchestrator.httpServer.address().port;
  assert.equal(await new Promise((resolve,reject)=>{http.get(origin,{headers:{Host:'attacker.test'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);}),403);assert.equal((await fetch(origin,{headers:{Origin:'https://attacker.test'}})).status,403);
  await new Promise((resolve,reject)=>{const socket=new WebSocket(origin.replace('http:','ws:'),{origin:'https://attacker.test'});socket.on('open',()=>{socket.terminate();reject(Error('Cross-origin WebSocket was accepted'));});socket.on('error',error=>{try{assert.match(error.message,/40[13]/);resolve();}catch(e){reject(e);}});});
  browser=await browserType.launch({headless:true});const context=await browser.newContext(engine==='chromium'?{permissions:['clipboard-read','clipboard-write']}:{});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>document.body.textContent.includes('Core memory ready'));ready();assert.equal(await running,true);
  const log=events.find(e=>e.type==='LOG_EVENT'&&e.payload.type==='REST'&&e.payload.details?.url?.endsWith('/login'));
  assert(log,'Browser request must be captured');assert.equal(log.payload.details.curlString,'[REDACTED]');
  assert.equal(log.payload.details.rawCurlString,undefined);assert.equal(log.payload.details.rawReplayRequest,'[REDACTED]');
  assert.equal(JSON.parse(log.payload.details.replayRequest.body).email,'[REDACTED]');assert.equal(log.payload.details.responseBody.emailVerified,false);
  for(const secret of [body.email,body.password,'fixture-bearer','fixture-cookie'])assert(!JSON.stringify(log).includes(secret));
  await page.getByText('Logs',{exact:true}).click();await page.getByText('login',{exact:true}).click();await page.getByText('cURL',{exact:true}).click();
  const code=page.locator('pre code');await code.waitFor();assert.equal(await code.innerText(),'[REDACTED]');
  let copied;
  if(engine==='chromium'){
    await page.getByRole('button',{name:'Copy masked cURL',exact:true}).click();await page.getByRole('button',{name:'Copied!',exact:true}).waitFor();copied=await page.evaluate(()=>navigator.clipboard.readText());
    assert(copied.startsWith("curl -X 'POST'"));assert(copied.includes('[REDACTED]'));assert(!/content-length|accept-encoding/i.test(copied));
    for(const secret of [body.email,body.password,'fixture-bearer','fixture-cookie'])assert(!copied.includes(secret));
    const replaced=copied.replace('"email": "[REDACTED]"','"email": "curl-manual@example.test"').replace('"password": "[REDACTED]"','"password": "curl-manual-password"').replace('Bearer [REDACTED]','Bearer curl-manual-bearer').replace('fixture-session=[REDACTED]','fixture-session=curl-manual-cookie');
    assert(!replaced.includes('[REDACTED]'));
    await promisify(execFile)('sh',['-c',replaced],{timeout:5000});assert.equal(captured.length,2);assert.equal(JSON.parse(captured[1].body).password,'curl-manual-password');assert.equal(captured[1].headers.authorization,'Bearer curl-manual-bearer');assert.equal(JSON.parse(captured[1].body).note,body.note);
  }
  const beforeReplay=captured.length;
  await page.getByText('▶ Replay',{exact:true}).click();const fields=page.locator('textarea');
  assert.equal(JSON.parse(await fields.nth(1).inputValue()).email,'[REDACTED]');assert.equal(JSON.parse(await fields.nth(1).inputValue()).password,'[REDACTED]');
  const replayHeaders=JSON.parse(await fields.nth(0).inputValue());assert.equal(replayHeaders.authorization,'Bearer [REDACTED]');assert(replayHeaders.cookie.includes('[REDACTED]'));
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('REPLAY ERROR:',{exact:true}).waitFor();assert.equal(captured.length,beforeReplay);
  await page.getByText(/Replace redacted values before sending/).waitFor();
  replayHeaders.authorization='Bearer manually-entered-bearer';replayHeaders.cookie='fixture-session=manually-entered-cookie';
  replayHeaders[':authority']='[REDACTED]';replayHeaders[':method']='GET';replayHeaders['content-length']='[REDACTED]';
  await fields.nth(0).fill(JSON.stringify(replayHeaders));
  const edited=JSON.stringify({...body,email:'manual-replay@example.test',password:"manual ' $HOME ✓",note:'Edited replay ✓'},null,2);
  await fields.nth(1).fill(edited);await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('LIVE RESPONSE:',{exact:true}).waitFor();
  assert.equal(captured.length,beforeReplay+1);const replay=captured.at(-1);assert.equal(replay.body,edited);assert.equal(Number(replay.headers['content-length']),Buffer.byteLength(edited));assert.equal(replay.headers.authorization,'Bearer manually-entered-bearer');assert(replay.headers.cookie.includes('manually-entered-cookie'));
  assert.equal(JSON.parse(await fields.nth(1).inputValue()).email,'[REDACTED]');assert.equal(JSON.parse(await fields.nth(1).inputValue()).password,'[REDACTED]');assert.equal(JSON.parse(await fields.nth(0).inputValue()).authorization,'Bearer [REDACTED]');
  assert.match(await page.getByText('emailVerified:',{exact:true}).locator('..').innerText(),/false/);
  const visible=await page.locator('body').innerText();for(const secret of ['manual-replay@example.test',"manual ' $HOME ✓",'manually-entered-bearer','server-token'])assert(!visible.includes(secret));
  await fields.nth(0).fill('{broken');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('REPLAY ERROR:',{exact:true}).waitFor();assert.equal(captured.length,beforeReplay+1);
  assert(await page.getByText('Request error',{exact:true}).isVisible());assert(!(await page.locator('body').innerText()).includes('LIVE RESPONSE:'));
  if(engine==='chromium'){
    await page.getByText('cURL',{exact:true}).click();assert.equal(await page.locator('pre code').innerText(),'[REDACTED]');await page.getByRole('button',{name:'Copy masked cURL',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),copied);
  }
  assert.deepEqual(errors,[]);
  if(process.env.FLOWSTRIDE_CURL_EVIDENCE){fs.mkdirSync(process.env.FLOWSTRIDE_CURL_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.FLOWSTRIDE_CURL_EVIDENCE,req('./package.json').name==='flowstride'?'os-'+engine+'-masked-curl.png':'cloud-'+engine+'-masked-curl.png'),fullPage:true});}
 }finally{process.argv.splice(0,process.argv.length,...oldArgv);await worker?.shutdown();await browser?.close();await new Promise(setImmediate);await orchestrator?.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));process.chdir(oldCwd);fs.rmSync(directory,{recursive:true,force:true});}
});
