const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),cloud=process.env.FLOWSTRIDE_PRO_SOURCE&&path.resolve(process.env.FLOWSTRIDE_PRO_SOURCE),privateEngine=require(path.join(root,'package.json')).name==='@flowstride/pro';
const html=`<!doctype html><html><body><h1>Customer workspace</h1><output id="state"></output><label>Customer name<input id="name" value="clean"></label><label>Attach documents<input type="file" id="files" multiple onchange="document.querySelector('#filescount').textContent='Selected files: '+this.files.length"></label><output id="filescount">Selected files: 0</output><button id="save">Save customer</button><output id="saved">Not saved</output><script>document.querySelector('#state').textContent=[localStorage.getItem('customer')||'clean',sessionStorage.getItem('customer')||'clean',document.cookie.includes('customer=')?'dirty':'clean'].join(' / ');document.querySelector('#save').onclick=()=>{const name=document.querySelector('#name').value;localStorage.setItem('customer',name);sessionStorage.setItem('customer',name);document.cookie='customer='+encodeURIComponent(name)+';path=/';document.querySelector('#saved').textContent='Saved '+name;};</script></body></html>`;
async function fixture(browser='chromium'){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-batch5-cli-')));for(const name of ['flows','fixtures','.flowstride'])fs.mkdirSync(path.join(dir,name));fs.writeFileSync(path.join(dir,'.flowstride/credentials.json'),'{}');
 const rows=[{name:'Lagos customer',active:true,quantity:2,attachments:['fixtures/a.txt','fixtures/b.txt']},{name:'Abuja customer',active:false,quantity:1,attachments:['fixtures/b.txt']}];fs.writeFileSync(path.join(dir,'fixtures/cases.json'),JSON.stringify(rows));fs.writeFileSync(path.join(dir,'fixtures/cases.csv'),'name,expected\r\nLagos customer,Lagos customer\r\nAbuja customer,Abuja customer\r\n');fs.writeFileSync(path.join(dir,'fixtures/customer.json'),JSON.stringify({active:true,contacts:[{city:'Ibadan'}],note:'"},"injected":true,"x":"{{env.DO_NOT_EXPAND}} $randomToken @other',password:'fixture-credential-batch5-private',email:'fixture-person-batch5@example.test',emailVerified:false}));fs.writeFileSync(path.join(dir,'fixtures/a.txt'),'Attachment one');fs.writeFileSync(path.join(dir,'fixtures/b.txt'),'Attachment two');
 const requests=[],retry=new Map();const server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{const url=new URL(req.url,'http://localhost');requests.push({url:req.url,headers:req.headers,body});res.setHeader('Content-Type','application/json');if(url.pathname==='/api/auth/verify-cli')res.end(JSON.stringify({tier:'business',workspaceName:'Batch5 fixture'}));else if(url.pathname==='/api/workspace/status')res.end(JSON.stringify({workspace:{_id:'fixture-batch5-workspace'},manifest:{maxWorkers:2,features:[]}}));else if(url.pathname==='/api/retry'){const key=url.searchParams.get('case'),count=(retry.get(key)||0)+1;retry.set(key,count);res.statusCode=count===1?503:200;res.end('{}');}else if(url.pathname.startsWith('/api/'))res.end(JSON.stringify({accepted:true,...(body?JSON.parse(body):{})}));else{res.setHeader('Content-Type','text/html');res.end(html);}});});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(dir,'flowstride.config.json'),JSON.stringify({baseUrl:url,browser,timeout:600,recordVideo:false,domSnapshots:false,security:{evidence:{screenshots:false}}}));
 return{dir,url,rows,requests,retry,write:(source,file='dataset.flow')=>fs.writeFileSync(path.join(dir,'flows',file),source),summary:()=>JSON.parse(fs.readFileSync(path.join(dir,'flowstride-artifacts/summary.json'))),config:extra=>{const file=path.join(dir,'flowstride.config.json');fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file)),...extra}));},close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
}
async function execute(f,args=[],extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'dist/cli/index.js'),'run','flows','--ci',...args],{cwd:f.dir,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',FLOWSTRIDE_TOKEN:'',FLOWSTRIDE_API_URL:f.url,...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Batch5 CLI timed out: '+output));},75000);child.on('error',reject);child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output});});});}
function prepare(f,mode){const target=path.join(f.dir,'node_modules/@flowstride/pro');fs.mkdirSync(path.dirname(target),{recursive:true});if(mode==='handoff')fs.symlinkSync(cloud,target,'dir');else{fs.mkdirSync(path.join(target,'dist/runner'),{recursive:true});for(const[file,member]of[['flow_worker','FlowWorker'],['flow_orchestrator','FlowOrchestrator']])fs.writeFileSync(path.join(target,'dist/runner',file+'.js'),`module.exports=require(${JSON.stringify(path.join(cloud,'dist/runner',file+'.js'))});module.exports.${member}.nativeDataProtocol=undefined;`);}fs.writeFileSync(path.join(f.dir,'.flowstride/credentials.json'),JSON.stringify({machineToken:'fixture-batch5-token',workspaceId:'fixture-batch5-workspace'}));return{FLOWSTRIDE_API_URL:f.url};}
function source(file='fixtures/cases.json'){return `Feature: Native data and file workflows
Scenario: Isolate and exercise every customer
Given "Bind each customer row"
  flow.data.cases {"file":"${file}"};
  flow.open "/";
When "Load fixtures and structured files"
  flow.data.load {"file":"fixtures/customer.json","as":"customer"};
  flow.file.read {"file":"fixtures/cases.csv","as":"customers"};
  flow.assert.value {"actual":"@customer.active","operator":"equals","expected":true};
  flow.assert.value {"actual":"@customers[0].name","operator":"equals","expected":"Lagos customer"};
When "Each row starts from clean browser and API state"
  flow.expect visible "clean / clean / clean";
  flow.assert.that {"target":{"text":"Customer name","element":"input"},"condition":"value","value":"clean"};
  flow.get "/api/clean";
When "Use this customer without turning fixture text into code"
  flow.type input "Customer name" "@case.name";
  flow.files.select {"target":{"text":"Attach documents","element":"input"},"files":"@case.attachments"};
  flow.expect visible "Selected files: @case.quantity";
  flow.post "/api/record" with reqHeader "X-Case-Only" "@case.name" with reqBody;
  """
  {"name":"@case.name","active":"@case.active","quantity":"@case.quantity","note":"@customer.note"}
  """
  flow.expect status "200";
  flow.click button "Save customer";
Then "Check the saved customer"
  flow.assert.that {"target":{"text":"Customer name","element":"input"},"condition":"value","value":"@case.name"};
  flow.expect visible "Saved @case.name";
`;}
function parallelWorkerEnv(f) {
 const preload = path.join(f.dir, 'parallel-workers.cjs');
 // Give the CLI's CPU check a predictable budget while it starts two real workers.
 fs.writeFileSync(preload, `const os = require('node:os');
const cpus = os.cpus();
os.cpus = () => Array.from({ length: 3 }, (_, index) => cpus[index % cpus.length]);`);
 return { NODE_OPTIONS: `--require=${JSON.stringify(preload)}` };
}
module.exports={root,cloud,privateEngine,fixture,execute,prepare,source,parallelWorkerEnv};
