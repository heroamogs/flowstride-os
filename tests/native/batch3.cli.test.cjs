const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');const {spawn}=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),cloud=process.env.FLOWSTRIDE_PRO_SOURCE;const privateEngine=require(path.join(root,'package.json')).name==='@flowstride/pro';
const html=`<!doctype html><html><head><title>Browser interaction lab</title><style>body{font:18px sans-serif;min-height:2000px;padding:20px}form{width:400px}label,input,button{display:block;margin:10px}#panel{height:100px;width:200px;overflow:auto}#panel div{height:500px}</style></head><body><h1>Ready</h1><form aria-label="Search form"><label>Search<input id="search" value="initial"></label><label>Read-only<input id="readonly" readonly value="fixed"></label><button type="submit">Submit search</button></form><button id="invoice">Invoice</button><output id="mouse">None</output><output id="result">Not submitted</output><div role="region" aria-label="Customer records" id="panel"><div>Records</div></div><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('#result').textContent='Submitted '+document.querySelector('#search').value;};document.querySelector('#invoice').ondblclick=()=>document.querySelector('#mouse').textContent='Double clicked';document.querySelector('#invoice').oncontextmenu=e=>{e.preventDefault();document.querySelector('#mouse').textContent='Right clicked';};</script></body></html>`;
async function fixture(browser='chromium'){
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-batch3-cli-')));fs.mkdirSync(path.join(directory,'flows'));fs.mkdirSync(path.join(directory,'.flowstride'));fs.writeFileSync(path.join(directory,'.flowstride/credentials.json'),'{}');const requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.url);if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(req.url==='/api/auth/verify-cli')res.end(JSON.stringify({tier:'business',workspaceName:'Batch3 fixture'}));else if(req.url==='/api/workspace/status')res.end(JSON.stringify({workspace:{_id:'fixture-batch3-workspace'},manifest:{maxWorkers:2,features:[]}}));else{req.resume();res.end(JSON.stringify({accepted:true}));}return;}res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(directory,'flowstride.config.json'),JSON.stringify({baseUrl:url,browser,timeout:750,recordVideo:false,domSnapshots:false,security:{evidence:{screenshots:false}}}));
 return {directory,url,requests,write:source=>fs.writeFileSync(path.join(directory,'flows/interactions.flow'),source),summary:()=>JSON.parse(fs.readFileSync(path.join(directory,'flowstride-artifacts/summary.json'))),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}};
}
async function execute(f,args=[],extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'dist/cli/index.js'),'run','flows','--ci',...args],{cwd:f.directory,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',FLOWSTRIDE_TOKEN:'',FLOWSTRIDE_API_URL:f.url,...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Batch3 CLI timeout: '+output));},60000);child.on('error',reject);child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output});});});}
function source(){return `Feature: Native everyday browser interactions
Scenario: Exercise all interactions in the same browser
Given "Open the local application"
  flow.open "/";
When "Existing typing keeps its replacement and blur defaults"
  flow.type input "Search" "legacy";
  flow.assert.that {"target":{"text":"Search","element":"input"},"condition":"value","value":"legacy"};
  flow.assert.that {"target":{"text":"Search","element":"input"},"condition":"focused","not":true};
When "Use keyboard and explicit focus control"
  flow.focus input "Search";
  flow.press "ControlOrMeta+A" on input "Search";
  flow.press "Backspace" on input "Search";
  flow.input.type {"target":{"text":"Search","element":"input","inside":"Search form"},"text":"Lagos","clear":false,"delay":0,"blur":false};
  flow.press "Enter" on input "Search";
  flow.expect visible "Submitted Lagos";
  flow.blur input "Search";
  flow.clear input "Search";
  flow.input.type {"selector":"#search","text":"Abuja","delay":0};
When "Use genuine double and right clicks"
  flow.doubleClick button "Invoice";
  flow.expect visible "Double clicked";
  flow.rightClick button "Invoice";
  flow.expect visible "Right clicked";
When "Navigate back, forward and reload"
  flow.open "/one";
  flow.open "/two";
  flow.goBack;
  flow.assert.that {"condition":"url","matches":"/one$"};
  flow.goForward;
  flow.assert.that {"condition":"url","matches":"/two$"};
  flow.reload;
When "Use optional new actions without changing optional semantics"
  flow.try clear input "Absent optional field";
  flow.input.type {"target":{"text":"Search","element":"input"},"text":"Final value","delay":0};
When "Scroll a readable container and the page"
  flow.scroll {"target":"Customer records","y":120};
  flow.scroll {"y":150};
Then "Assert final state after the interactions"
  flow.assert.that {"target":{"text":"Search","element":"input"},"condition":"value","value":"Final value"};
  flow.assert.that {"selector":"#panel","condition":"property","property":"scrollTop","value":120};
  flow.expect visible "Ready";
`;}
function prepare(f,mode){const target=path.join(f.directory,'node_modules/@flowstride/pro');fs.mkdirSync(path.dirname(target),{recursive:true});if(mode==='handoff')fs.symlinkSync(cloud,target,'dir');else{fs.mkdirSync(path.join(target,'dist/runner'),{recursive:true});for(const [file,member]of [['flow_worker','FlowWorker'],['flow_orchestrator','FlowOrchestrator']])fs.writeFileSync(path.join(target,'dist/runner',file+'.js'),`module.exports=require(${JSON.stringify(path.join(cloud,'dist/runner',file+'.js'))});module.exports.${member}.nativeInteractionProtocol=undefined;`);}fs.writeFileSync(path.join(f.directory,'.flowstride/credentials.json'),JSON.stringify({machineToken:'fixture-batch3-token',workspaceId:'fixture-batch3-workspace'}));return {FLOWSTRIDE_API_URL:f.url};}
for(const browser of ['chromium','firefox','webkit'])test(`Batch3 real ${browser} CLI retains legacy typing, new interactions and truthful optional results`,{timeout:65000},async()=>{const f=await fixture(browser);try{f.write(source());const result=await execute(f);assert.equal(result.code,0,result.output);const summary=f.summary();assert.equal(summary.status,'passed');assert.equal(summary.metrics.failed,0);assert.equal(summary.metrics.incomplete,0);assert.equal(summary.steps.filter(s=>s.status==='skipped').length,1);assert(summary.browsers.every(item=>item.engine===browser&&item.headless===true));assert(summary.steps.some(s=>s.commandLabel==='flow.input.type'&&s.status==='passed'));}finally{await f.close();}});
test('Batch3 failure has action, target, precise cause and source location without exposing typed secrets',{timeout:25000},async()=>{const f=await fixture(),secret='fixture-literal-typed-secret-not-from-env';try{assert(!Object.values(process.env).includes(secret));f.write(`Feature: Failed actions are explicit\nScenario: Stop a required failure\nGiven "Open the application"\nflow.open "/";\nWhen "Attempt typing in a read-only target"\nflow.input.type {"target":{"text":"Read-only","element":"input"},"text":"${secret}","delay":0};\nWhen "Do not run after the required failure"\nflow.click button "Invoice";\nThen "Do not claim success"\nflow.expect visible "Ready";`);const result=await execute(f);assert.equal(result.code,1,result.output);const summary=f.summary();assert.deepEqual(summary.steps.map(s=>s.status),['passed','failed','not_tested','not_tested']);const error=summary.steps[1].error;assert.match(error,/flow\.input\.type/);assert.match(error,/Read-only/);assert.match(error,/read-only|disabled|editable/i);assert.match(error,/interactions.flow:\d+/);const junit=fs.readFileSync(path.join(f.directory,'flowstride-artifacts/junit.xml'),'utf8');for(const text of [result.output,JSON.stringify(summary),junit])assert(!text.includes(secret));assert(!result.output.includes('All suites completed successfully'));}finally{await f.close();}});
for(const mode of ['handoff','older','legacy-handoff'])test(`Batch3 ${mode} capability gate preserves Cloud handoff and OS fallback`,{skip:privateEngine||!cloud,timeout:65000},async()=>{const f=await fixture();try{const env=prepare(f,mode);f.write(mode==='legacy-handoff'?`Feature: Original syntax\nScenario: Keep the licensed handoff\nGiven "Open"\nflow.open "/";\nWhen "Ordinary action"\nflow.click button "Invoice";\nThen "Ready"\nflow.expect visible "Ready";`:source());const result=await execute(f,[],env);assert.equal(result.code,0,result.output);assert.equal(f.summary().engine,mode==='older'?'Open Source':'Enterprise (Pro)');if(mode==='older')assert.match(result.output,/browser-interaction.*fallback|fallback.*browser-interaction/is);}finally{await f.close();}});
test('Batch3 parallel Cloud workers retain isolated input/history/scroll state',{skip:!privateEngine&&!cloud,timeout:65000},async()=>{const f=await fixture();try{const env=privateEngine?{}:prepare(f,'handoff');f.write(source());fs.copyFileSync(path.join(f.directory,'flows/interactions.flow'),path.join(f.directory,'flows/second.flow'));const result=await execute(f,['--workers','2'],env);assert.equal(result.code,0,result.output);const summary=f.summary();assert.equal(summary.status,'passed');assert.equal(summary.metrics.failed,0);assert.equal(summary.metrics.incomplete,0);assert.equal(summary.steps.filter(s=>s.status==='skipped').length,2);assert.equal(new Set(summary.steps.map(s=>s.fileName)).size,2);assert(summary.browsers.every(info=>info.headless));}finally{await f.close();}});
