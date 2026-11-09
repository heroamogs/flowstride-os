const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),cloud=process.env.FLOWSTRIDE_PRO_SOURCE&&path.resolve(process.env.FLOWSTRIDE_PRO_SOURCE),privateEngine=require(path.join(root,'package.json')).name==='@flowstride/pro';
const frame='<!doctype html><label>First name<input id="first" value="frame-original"></label><button id="save" onclick="document.querySelector(\'output\').textContent=\'Saved \'+document.querySelector(\'input\').value">Save</button><output>Not saved</output>';
const html=`<!doctype html><h1>Ready</h1><label>First name<input id="main" value="main-original"></label><label>Main only<input id="main-only" value="untouched"></label><iframe title="Profile details" src="/frame"></iframe><button onclick="window.open('/receipt','_blank')">Open receipt</button><button onclick="document.querySelector('#result').textContent=prompt('Enter customer name','Original')??'Cancelled'">Rename</button><output id="result">No dialog</output>`;
async function fixture(browser='chromium'){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-batch4-cli-')));fs.mkdirSync(path.join(dir,'flows'));fs.mkdirSync(path.join(dir,'.flowstride'));fs.writeFileSync(path.join(dir,'.flowstride/credentials.json'),'{}');
 let retries=0;const server=http.createServer((req,res)=>{if(req.url==='/api/retry'){res.statusCode=++retries===1?503:200;res.end('{}');return;}if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(req.url==='/api/auth/verify-cli')res.end(JSON.stringify({tier:'business',workspaceName:'Batch4 fixture'}));else if(req.url==='/api/workspace/status')res.end(JSON.stringify({workspace:{_id:'fixture-batch4-workspace'},manifest:{maxWorkers:2,features:[]}}));else{req.resume();res.end(JSON.stringify({accepted:true}));}return;}res.setHeader('Content-Type','text/html');res.end(req.url==='/frame'?frame:req.url==='/receipt'?'<h1>Receipt page</h1>':html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(dir,'flowstride.config.json'),JSON.stringify({baseUrl:url,browser,timeout:650,recordVideo:false,domSnapshots:false,security:{evidence:{screenshots:false}}}));
 return {dir,url,write:s=>fs.writeFileSync(path.join(dir,'flows/browsing.flow'),s),summary:()=>JSON.parse(fs.readFileSync(path.join(dir,'flowstride-artifacts/summary.json'))),close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
}
async function execute(f,args=[],extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'dist/cli/index.js'),'run','flows','--ci',...args],{cwd:f.dir,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',FLOWSTRIDE_TOKEN:'',FLOWSTRIDE_API_URL:f.url,...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Batch4 CLI timed out: '+output));},60000);child.on('error',reject);child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output});});});}
function source(){return `Feature: Native tab frame and dialog workflows
Scenario: Use readable targets inside a selected document
Given "Open the local application"
  flow.open "/";
When "Name the current tab and explicitly scope a frame"
  flow.tab.name {"name":"main"};
  flow.frame.use {"target":{"text":"Profile details","element":"iframe"}};
  flow.type input "First name" "Samuel";
  flow.extract value input "First name" as "savedFirst";
  flow.click button "Save";
  flow.expect visible "Saved Samuel";
  flow.assert.that {"target":{"text":"First name","element":"input"},"condition":"value","value":"Samuel"};
When "Return to the main document without changing its matching field"
  flow.frame.main {};
  flow.assert.that {"selector":"#main","condition":"value","value":"main-original"};
  flow.type input "Main only" "@savedFirst";
When "Capture a popup before the click and select it by name"
  flow.tab.arm {"name":"receipt"};
  flow.click button "Open receipt";
  flow.tab.use {"name":"receipt"};
  flow.expect visible "Receipt page";
  flow.tab.use {"name":"main"};
  flow.tab.close {"name":"receipt"};
When "Accept the prompt with the intended input"
  flow.dialog.arm {"name":"rename","action":"accept","promptText":"Updated customer"};
  flow.click button "Rename";
And "The actual prompt matches the expected message"
  flow.dialog.expect {"name":"rename","type":"prompt","message":"Enter customer name","defaultValue":"Original"};
Then "Verify the final result"
  flow.expect visible "Updated customer";
  flow.assert.that {"selector":"#main-only","condition":"value","value":"Samuel"};
`;}
function prepare(f,mode){const target=path.join(f.dir,'node_modules/@flowstride/pro');fs.mkdirSync(path.dirname(target),{recursive:true});if(mode==='handoff')fs.symlinkSync(cloud,target,'dir');else{fs.mkdirSync(path.join(target,'dist/runner'),{recursive:true});for(const[file,member]of[['flow_worker','FlowWorker'],['flow_orchestrator','FlowOrchestrator']])fs.writeFileSync(path.join(target,'dist/runner',file+'.js'),`module.exports=require(${JSON.stringify(path.join(cloud,'dist/runner',file+'.js'))});module.exports.${member}.nativeBrowsingProtocol=undefined;`);}fs.writeFileSync(path.join(f.dir,'.flowstride/credentials.json'),JSON.stringify({machineToken:'fixture-batch4-token',workspaceId:'fixture-batch4-workspace'}));return{FLOWSTRIDE_API_URL:f.url};}
for(const browser of ['chromium','firefox','webkit'])test(`Batch4 ${browser}: native CLI scopes frames, captures named tabs and verifies prompts`,{timeout:65000},async()=>{const f=await fixture(browser);try{f.write(source());const result=await execute(f);assert.equal(result.code,0,result.output);const summary=f.summary();assert.equal(summary.status,'passed');assert.equal(summary.metrics.failed,0);assert.equal(summary.metrics.incomplete,0);assert(summary.browsers.every(b=>b.engine===browser&&b.headless));assert(summary.steps.some(s=>s.commandLabel==='flow.frame.use'&&s.status==='passed'));const check=summary.steps.find(s=>s.commandLabel==='flow.dialog.expect');assert.equal(check.status,'passed');assert.equal(check.assertion.checks.find(c=>c.key==='message').status,'passed');assert(!JSON.stringify(summary).includes('"promptText":"Updated customer"'));}finally{await f.close();}});
for(const failure of ['frame','dialog'])test(`Batch4 ${failure}: truthful CLI failure identifies the command, exact cause and source line`,{timeout:30000},async()=>{const f=await fixture();try{f.write(failure==='frame'?source().replace('"text":"Profile details"','"text":"Missing frame"'):source().replace('"message":"Enter customer name"','"message":"Wrong expected prompt"'));const result=await execute(f);assert.equal(result.code,1,result.output);const summary=f.summary();assert.equal(summary.status,'failed');assert.equal(summary.metrics.failed,1);assert.equal(summary.metrics.incomplete,0);const failed=summary.steps.find(s=>s.status==='failed');assert.match(failed.error,/browsing.flow:\d+/);assert.match(failed.error,failure==='frame'?/frame.use/:/dialog.expect/);assert.match(failed.error,failure==='frame'?/Missing frame|Iframe.*timed out/:/Wrong expected prompt/);assert(summary.steps.slice(summary.steps.indexOf(failed)+1).every(s=>s.status==='not_tested'));assert(!result.output.includes('All suites completed successfully'));}finally{await f.close();}});
test('Batch4 prompt input does not leak into CI logs, reports or JUnit when the browser rejects it',{timeout:30000},async()=>{const f=await fixture(),secret='literal-private-prompt-not-in-env';try{f.write(source().replace('Updated customer',secret).replace('flow.click button "Rename";','flow.click button "Missing trigger";'));const result=await execute(f);assert.equal(result.code,1,result.output);for(const content of [result.output,JSON.stringify(f.summary()),fs.readFileSync(path.join(f.dir,'flowstride-artifacts/junit.xml'),'utf8')])assert(!content.includes(secret));}finally{await f.close();}});
for(const mode of ['handoff','older','legacy-handoff','iframe-qualifier'])test(`Batch4 ${mode}: OS-to-Cloud handoff and older-engine fallback`,{skip:privateEngine||!cloud,timeout:65000},async()=>{const f=await fixture();try{const env=prepare(f,mode==='iframe-qualifier'?'older':mode);f.write(mode==='iframe-qualifier'?`Feature: Textual iframe assertion\nScenario: Guard its shared qualifier\nGiven \"Open\"\nflow.open \"/\";\nWhen \"Inspect the frame textually\"\nflow.assert.that {\"target\":{\"text\":\"Profile details\",\"element\":\"iframe\"},\"condition\":\"visible\"};\nThen \"Done\"\nflow.expect visible \"Ready\";`:mode==='legacy-handoff'?`Feature: Existing syntax\nScenario: Keep old behavior\nGiven "Open"\nflow.open "/";\nWhen "Act"\nflow.type input "Main only" "Original";\nThen "Done"\nflow.expect visible "Ready";`:source());const result=await execute(f,[],env);assert.equal(result.code,0,result.output);assert.equal(f.summary().engine,['older','iframe-qualifier'].includes(mode)?'Open Source':'Enterprise (Pro)');if(['older','iframe-qualifier'].includes(mode))assert.match(result.output,/tab\/frame\/dialog.*fallback|fallback.*tab\/frame\/dialog/is);}finally{await f.close();}});
test('Batch4 parallel Cloud workers keep aliases, frame scopes and dialog handlers isolated',{skip:!privateEngine&&!cloud,timeout:65000},async()=>{const f=await fixture();try{const env=privateEngine?{}:prepare(f,'handoff');f.write(source());fs.copyFileSync(path.join(f.dir,'flows/browsing.flow'),path.join(f.dir,'flows/second.flow'));const result=await execute(f,['--workers','2'],env);assert.equal(result.code,0,result.output);assert.equal(f.summary().status,'passed');assert.equal(new Set(f.summary().steps.map(s=>s.fileName)).size,2);assert.equal(f.summary().metrics.failed,0);}finally{await f.close();}});

test('Batch4 real scenario retry restores a previously named tab and its selected frame',{timeout:45000},async()=>{const f=await fixture();try{f.write(`Feature: Retry document identity
Scenario: Prepare named state
Given "Open"
flow.open "/";
When "Name and scope"
flow.tab.name {"name":"main"};
flow.frame.use {"target":"Profile details"};
Then "Frame is ready"
flow.expect visible "First name";
Scenario: Retry from the same named document
Given "Use the existing alias"
flow.tab.use {"name":"main"};
flow.expect visible "First name";
When "An application request is transient"
flow.get "/api/retry";
flow.expect status "200";
Then "The selected frame remains correct"
flow.assert.that {"selector":"#first","condition":"value","value":"frame-original"};
`);const configFile=path.join(f.dir,'flowstride.config.json');fs.writeFileSync(configFile,JSON.stringify({...JSON.parse(fs.readFileSync(configFile)),retries:1}));const result=await execute(f);assert.equal(result.code,0,result.output);const summary=f.summary();assert.equal(summary.status,'passed');assert(summary.attempts.some(item=>item.attempt===2&&item.status==='passed'),JSON.stringify(summary.attempts));}finally{await f.close();}});
