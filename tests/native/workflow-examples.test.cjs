const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),vm=require('node:vm');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json'));
const examples=path.join(root,'examples/native-workflows'),{Lexer}=req('./dist/parser/lexer.js'),{Parser}=req('./dist/parser/parser.js');
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
function parse(source){return new Parser(new Lexer(source).tokenise()).parse();}

test('core guides link to existing files, parse their exact flow examples and keep public release details clean',()=>{
  const markdown=[path.join(root,'NATIVE_WORKFLOWS.md'),...walk(examples).filter(p=>p.endsWith('.md'))];assert.equal(markdown.length,9);
  const flows=walk(examples).filter(p=>p.endsWith('.flow'));assert.equal(flows.length,18);
  for(const file of flows)assert(parse(fs.readFileSync(file,'utf8')).length>0,file);
  for(const file of markdown){
    const source=fs.readFileSync(file,'utf8');
    assert(!/\bPro\b|@next|\b\d+\.\d+\.\d+-(?:rc|local)\b|Digital\s*Ocean|flowstride-engine-vault|\.tgz\b/i.test(source),file);
    assert(!/\/Users\/[a-z0-9._-]+\/(?:Documents|Desktop|Downloads)/i.test(source),file);
    assert(!source.includes('{{FLOW:'),file);
    for(const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
      const link=match[1];if(/^(?:https?:|mailto:|#)/.test(link))continue;
      const target=path.resolve(path.dirname(file),decodeURIComponent(link.split('#')[0]));assert(fs.existsSync(target),file+' -> '+link);
    }
    for(const match of source.matchAll(/```json\s*\n([\s\S]*?)```/g))JSON.parse(match[1]);
    for(const match of source.matchAll(/```flow\s*\n([\s\S]*?)```/g)){
      let body=match[1];
      if(!/^\s*Feature:/m.test(body)){
        const blocks=/^\s*(?:Given|When|And|Then)\b/m.test(body);
        body='Feature: Guide fragment\nScenario: Syntax\nGiven "Context"\n flow.open "/";\n'+(blocks?'':'When "Documented command"\n')+body+'\nThen "Syntax-check outcome"\n flow.expect visible "Fixture outcome";\n';
      }
      try{assert(parse(body).length>0,file);}catch(error){throw Error(file+': '+error.message);}
    }
  }
  for(const name of ['profile-review.json','profile-review-mismatch.json']){
    const fixture=JSON.parse(fs.readFileSync(path.join(examples,'manual-testing/fixtures',name)));assert.equal(fixture.nodes.length,3);assert.equal(fixture.connections.length,2);
  }
  const wav=fs.readFileSync(path.join(examples,'audio-to-text/fixtures/microphone-tone.wav'));assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt32LE(40),wav.length-44);
});

test('shared demo is loopback-only, validates requests and serves the documented application routes',async()=>{
  const {startExampleApp}=await import(pathToFileURL(path.join(examples,'shared/server.mjs')).href);const app=await startExampleApp({port:0});
  const request=(route,options={})=>fetch(app.url+route,options);
  try{
    for(const route of ['/','/login','/frames','/orders','/reuse','/audio','/profile'])assert.equal((await request(route)).status,200,route);
    assert.equal((await request('/api/users',{method:'POST',body:'{}'})).status,400);
    assert.equal((await request('/api/echo',{method:'POST',body:'x'.repeat(65537)})).status,413);
    assert.equal((await request('/api/profile',{method:'POST',headers:{Origin:'https://unrelated.example'},body:'{"name":"should not persist"}'})).status,403);
    assert.equal(await new Promise((resolve,reject)=>{http.get(app.url,{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode)}).on('error',reject)}),403);
    assert((await (await request('/profile')).text()).includes('Ada Obi'));
    assert.equal((await request('/api/workspace/proxy-otp?email=example@flowstridemail.com')).status,404,'Demo must not pretend to implement FlowMail');
  }finally{await app.close();}
});

test('shipped local workflows pass and their deliberate failures fail through the real CLI',{timeout:180000},async()=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-core-examples-'))),copy=path.join(directory,'workflow-examples');
  fs.cpSync(examples,copy,{recursive:true});fs.mkdirSync(path.join(directory,'isolated-home'));fs.writeFileSync(path.join(directory,'isolate.cjs'),"require('node:os').homedir=()=>process.env.FLOWSTRIDE_EXAMPLE_TEST_HOME;\n");
  const {startExampleApp}=await import(pathToFileURL(path.join(examples,'shared/server.mjs')).href);const app=await startExampleApp({port:0});
  fs.writeFileSync(path.join(directory,'.env'),`BASE_URL=${app.url}\nEXAMPLE_LABEL="Workflow fixture"\n`);
  fs.writeFileSync(path.join(directory,'flowstride.config.json'),JSON.stringify({timeout:1800,headless:true,recordVideo:true,cloudSync:false}));
  const browser=process.env.FLOWSTRIDE_EXAMPLES_BROWSER||'chromium';
  const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||(process.platform==='darwin'?path.join(os.homedir(),'Library/Caches/ms-playwright'):process.platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'ms-playwright'):path.join(os.homedir(),'.cache/ms-playwright'));
  const env={...process.env,CI:'true',FLOWSTRIDE_TOKEN:'',FLOWSTRIDE_API_KEY:'',FLOWSTRIDE_API_URL:'http://127.0.0.1:1',NEXTJS_WEBHOOK_URL:'',FLOWSTRIDE_EXAMPLE_TEST_HOME:path.join(directory,'isolated-home'),PLAYWRIGHT_BROWSERS_PATH:cache,PLAYWRIGHT_SKIP_BROWSER_GC:'1'};for(const key of ['BASE_URL','EXAMPLE_LABEL','NODE_OPTIONS'])delete env[key];
  const cases=[['api-and-ui/flows/api-and-ui.flow',false],['api-and-ui/negative/wrong-backend-state.flow',true],['iframes/flows/readable-frame.flow',false],['iframes/flows/explicit-frame-plugin.flow',false],['iframes/negative/wrong-frame-result.flow',true],['tables-and-cells/flows/search-extract-reuse.flow',false],['tables-and-cells/flows/coordinates.flow',false],['tables-and-cells/negative/wrong-cell-value.flow',true],['variables-and-reuse/flows',false],['variables-and-reuse/negative/wrong-reused-value.flow',true],['variables-and-reuse/sessions/save.flow',false],['variables-and-reuse/sessions/restore.flow',false]];
  if(browser==='chromium')cases.push(['audio-to-text/flows/microphone-demo.flow',false],['audio-to-text/negative/wrong-transcript.flow',true]);
  const results=[];
  try{
    for(const [file,negative]of cases){
      const output=[];const child=spawn(process.execPath,['--require',path.join(directory,'isolate.cjs'),path.join(root,'dist/cli/index.js'),'run','workflow-examples/'+file,'--workers','1','--browser',browser,'--ci'],{cwd:directory,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',part=>output.push(part));child.stderr.on('data',part=>output.push(part));const timer=setTimeout(()=>child.kill('SIGTERM'),35000);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});clearTimeout(timer);
      const summary=JSON.parse(fs.readFileSync(path.join(directory,'flowstride-artifacts/summary.json'))),log=Buffer.concat(output).toString();assert.equal(code,negative?1:0,file+'\n'+log);assert.equal(summary.status,negative?'failed':'passed',file+'\n'+JSON.stringify(summary));assert.equal(summary.metrics.incomplete,0,file);if(negative)assert(summary.metrics.failed>0,file);else assert.equal(summary.metrics.failed,0,file);
      assert(fs.existsSync(path.join(directory,'flowstride-artifacts/junit.xml')));const media=fs.readdirSync(summary.artifactsDir);assert(media.some(f=>f.endsWith('.webm')),file);if(negative)assert(media.some(f=>/\.(jpg|png)$/.test(f)),file);
      if(file==='audio-to-text/flows/microphone-demo.flow')assert((await (await fetch(app.url+'/api/audio-observed')).json()).peak>0.001,'Microphone must receive the actual signal');
      results.push({file,status:summary.status,metrics:summary.metrics});
      console.log(`[Example] ${browser} ${file}: ${summary.status} as expected`);
    }
    if(process.env.FLOWSTRIDE_EXAMPLES_EVIDENCE){const out=path.join(process.env.FLOWSTRIDE_EXAMPLES_EVIDENCE,req('./package.json').name==='flowstride'?'os':'cloud',browser);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}
  }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('manual design fixtures support passing and mixed-result UI runs with saved history',{timeout:45000},async()=>{
  const stage=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-core-manual-')));let server,sockets,browser;
  const filename=path.join(root,'dist/cli/manual_server/workspace_server.js'),requireServer=createRequire(filename),source=fs.readFileSync(filename,'utf8');
  assert(/await import\(["']open["']\)/.test(source));const module={exports:{}};
  const deps={http:{...http,createServer(...args){server=http.createServer(...args);return server;}},os:{...os,homedir:()=>stage},ws:{...req('ws'),WebSocketServer:class extends req('ws').WebSocketServer{constructor(options){super(options);sockets=this;}}}};
  vm.runInNewContext(source.replace(/await import\(["']open["']\)/,'Promise.resolve({default:async()=>{}})'),{module,exports:module.exports,require:name=>name in deps?deps[name]:requireServer(name),process:{env:{},cwd:()=>stage,on(){},exit(code){throw Error('Unexpected exit '+code)}},__dirname:path.dirname(filename),Buffer,URL,setTimeout,clearTimeout,console:{log(){},warn(){},error(){}}});
  await module.exports.startManualWorkspaceServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const {startExampleApp}=await import(pathToFileURL(path.join(examples,'shared/server.mjs')).href);const app=await startExampleApp({port:0});
  const post=(route,body)=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    browser=await req('playwright').chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1500,height:1000}}),application=await browser.newPage();page.setDefaultTimeout(10000);
    for(const [file,keys,statuses]of [['profile-review.json',['Enter','Enter','Enter'],['Passed','Passed','Passed']],['profile-review-mismatch.json',['Enter','Delete','Escape'],['Passed','Failed','Skipped']]]){
      const fixture=JSON.parse(fs.readFileSync(path.join(examples,'manual-testing/fixtures',file))),name=fixture.metadata.flowName,physical=name+'.json';assert.equal((await post('/api/save-design',{filename:physical,canvasData:fixture})).status,200);await post('/api/state',{activeFlowId:physical});
      await page.goto(origin);await page.getByRole('button',{name:'Execution Mode',exact:true}).waitFor();const frame=await (await page.locator('iframe').first().elementHandle()).contentFrame();await frame.waitForFunction(()=>window.flowstrideEngineAPI?.exportDesignState().nodes.length===3);
      await page.getByRole('button',{name:'Execution Mode',exact:true}).click();await application.goto(app.url+'/profile');await application.getByLabel('Display name').fill('Lola Idowu');await application.getByRole('button',{name:'Save profile',exact:true}).click();await application.getByText('Saved as Lola Idowu',{exact:true}).waitFor();await application.reload();assert.equal(await application.getByLabel('Display name').inputValue(),'Lola Idowu');
      await frame.locator('canvas').click({position:{x:5,y:5}});for(let i=0;i<keys.length;i++){await frame.locator('body').press(keys[i]);await page.getByText(statuses[i].toUpperCase(),{exact:true}).first().waitFor();}
      const before=new Set(((await (await fetch(origin+'/api/runs')).json()).runs||[]).map(r=>r.id));await page.getByRole('button',{name:req('./package.json').name==='flowstride'?'Save':'Submit Run',exact:true}).click();let saved;for(let i=0;i<60;i++){saved=((await (await fetch(origin+'/api/runs')).json()).runs||[]).find(r=>!before.has(r.id));if(saved)break;await new Promise(resolve=>setTimeout(resolve,100));}assert(saved,'UI must save a new run');const result=await (await fetch(origin+'/api/run?filename='+encodeURIComponent(saved.id))).json();assert.deepEqual(result.executionReport.map(s=>s.status),statuses);assert.equal(saved.metrics.status,file==='profile-review.json'?'PASS':'FAIL');
      await page.getByText('Runs',{exact:true}).click();await page.getByRole('row').filter({hasText:saved.name}).first().click();await page.getByText('PASSED',{exact:true}).first().waitFor();assert.equal(await page.locator('h1').textContent(),name);
    }
  }finally{await browser?.close();await app.close();for(const client of sockets.clients)client.terminate();await new Promise(resolve=>sockets.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(stage,{recursive:true,force:true});}
});
