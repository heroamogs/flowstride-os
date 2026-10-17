const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {loadNativeConfig}=require('../../dist/ci/config');
const {runNativeCI}=require('../../dist/ci/runtime');
const {initCI}=require('../../dist/ci/init');
function project(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-native-test-'));fs.mkdirSync(path.join(dir,'flows'));return dir;}
function inProject(dir,fn){const old=process.cwd();process.chdir(dir);try{return fn();}finally{process.chdir(old);}}
test('configuration validates devices, paths, timeouts and malformed JSON',()=>{
 const root=project();
 for(const value of [{device:'console'},{timeout:0},{artifactsDir:'../outside'},{webServer:{command:'node app',url:'https://remote.invalid'}}]){
  fs.writeFileSync(path.join(root,'flowstride.config.json'),JSON.stringify(value));assert.throws(()=>loadNativeConfig(root,{}));
 }
 fs.writeFileSync(path.join(root,'flowstride.config.json'),'{broken');assert.throws(()=>loadNativeConfig(root,{}));
 fs.writeFileSync(path.join(root,'flowstride.config.json'),JSON.stringify({device:'phone',timeout:8000}));
 const config=loadNativeConfig(root,{ci:true});assert.equal(config.device,'phone');assert.equal(config.headless,true);assert.equal(config.timeout,8000);
});
test('CI setup generates a workflow once and preserves existing contents',()=>{
 const root=project();inProject(root,()=>{initCI('github');const file=path.join(root,'.github/workflows/flowstride.yml');const content=fs.readFileSync(file,'utf8');assert.match(content,/--ci/);assert.match(content,/if: always\(\)/);assert.throws(()=>initCI('github'));assert.equal(fs.readFileSync(file,'utf8'),content);assert.throws(()=>initCI('unknown'));});
});
for(const mode of ['passed','failed','incomplete','crash','browser-error','empty','interrupted'])test(`native reports handle ${mode} and clean resources`,async()=>{
 const root=project(),target=path.join(root,'flows');
 if(mode!=='empty')fs.writeFileSync(path.join(target,'check.flow'),'Feature: CI\nScenario: Result\nGiven "A scenario exists"\nWhen "A step runs"\n  flow.open "https://example.invalid"\nThen "The result is recorded"\n');
 const config=loadNativeConfig(root,{ci:true});
 const worker=new EventEmitter();let closed=false;worker.shutdown=async()=>{closed=true;};worker.abort=()=>{};
 const runner={start:async()=>{
  if(mode==='interrupted')process.emit('SIGTERM');
  if(mode==='crash')throw new Error('execution crashed');
  if(mode!=='incomplete')worker.emit('worker_event',{type:'STEP_UPDATE',payload:{id:'s1',fileName:'check.flow',status:mode==='failed'?'failed':'passed'}});
  if(mode==='browser-error')worker.emit('worker_event',{type:'BROWSER_ERROR',payload:{message:'uncaught game error'}});
  worker.emit('worker_event',{type:'FILE_COMPLETE',payload:{fileName:'check.flow'}});return mode!=='failed';
 },close:async()=>{}};
 const result=await runNativeCI(worker,runner,target,config,'test');
 assert.equal(result.status,mode==='passed'?'passed':mode==='interrupted'?'interrupted':'failed');assert.equal(closed,true);
 assert.equal(JSON.parse(fs.readFileSync(path.join(config.artifactsDir,'summary.json'))).status,result.status);
 assert.match(fs.readFileSync(path.join(config.artifactsDir,'junit.xml'),'utf8'),/<testsuite/);
});

const {withDeadline}=require('../../dist/ci/deadline');
test('native asynchronous steps have a deadline and observe late rejections',async()=>{
 const unhandled=[];const listener=error=>unhandled.push(error);process.on('unhandledRejection',listener);
 try{await assert.rejects(withDeadline(new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('late')),30)),5),/exceeded/);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(unhandled.length,0);}finally{process.off('unhandledRejection',listener);}
});
