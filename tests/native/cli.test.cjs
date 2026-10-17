const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const proRoot=process.env.FLOWSTRIDE_PRO_SOURCE;
const privateEngine=require('../../package.json').name==='@flowstride/pro';
async function port(){const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const value=socket.address().port;await new Promise(resolve=>socket.close(resolve));return value;}
async function execute(args,cwd,env){return new Promise((resolve,reject)=>{const processHandle=spawn(process.execPath,args,{cwd,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',FLOWSTRIDE_TOKEN:'',...env},stdio:['ignore','pipe','pipe']});let output='';processHandle.stdout.on('data',data=>output+=data);processHandle.stderr.on('data',data=>output+=data);const timeout=setTimeout(()=>{processHandle.kill('SIGKILL');reject(new Error('CLI hung: '+output));},25000);processHandle.on('error',reject);processHandle.on('exit',code=>{clearTimeout(timeout);resolve({code,output});});});}
for(const failed of [false,true])for(const hybrid of [false,true])for(const workers of [1,2])test(`real native CLI ${failed?'failure':'success'} through ${hybrid?'OSS-to-Pro':'direct engine'} (${workers} workers)`,{skip:(hybrid&&(!proRoot||privateEngine))||(workers===2&&!hybrid&&!privateEngine)},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-cli-')),number=await port();
 fs.mkdirSync(path.join(directory,'flows'));fs.mkdirSync(path.join(directory,'.flowstride'));
 fs.writeFileSync(path.join(directory,'.flowstride/credentials.json'),JSON.stringify({machineToken:hybrid?'test-token':null,workspaceId:'test-workspace'}));
 const html='<canvas id="game" width="300" height="200"></canvas><script>const canvas=document.querySelector("canvas"),state={score:0};canvas.onpointerdown=()=>state.score++;window.__FLOWSTRIDE_GAME__={readState:()=>state};</script>';
 fs.writeFileSync(path.join(directory,'server.cjs'),`require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(html)});}).listen(${number},'127.0.0.1');`);
 fs.writeFileSync(path.join(directory,'flowstride.config.json'),JSON.stringify({timeout:1500,recordVideo:true,device:'phone',webServer:{command:'node server.cjs',url:`http://127.0.0.1:${number}`}}));
 fs.writeFileSync(path.join(directory,'flows/game.flow'),`Feature: Native game\nlet game = "flowstride:game"\nScenario: Canvas input\nGiven "A game is open"\n  flow.open "http://127.0.0.1:${number}"\nWhen "The player taps the canvas"\n  game.tap {"canvas":"#game","x":0.5,"y":0.5}\nThen "The score changes"\n  game.expectState {"path":"score","equals":${failed?999:1}}\n`);
 if(workers===2)fs.copyFileSync(path.join(directory,'flows/game.flow'),path.join(directory,'flows/game2.flow'));
 const env={};
 if(hybrid){fs.mkdirSync(path.join(directory,'node_modules/@flowstride'),{recursive:true});fs.symlinkSync(proRoot,path.join(directory,'node_modules/@flowstride/pro'),'dir');
  const preload=path.join(directory,'auth.cjs');fs.writeFileSync(preload,`global.fetch=async url=>{if(String(url).endsWith('/api/auth/verify-cli'))return Response.json({tier:'business',workspaceName:'Test'});if(String(url).endsWith('/api/workspace/status'))return Response.json({workspace:{_id:'test-workspace'},manifest:{maxWorkers:2,features:[]}});return require('undici').fetch(url);};`);
  // Use Node's original fetch for the owned fixture; no production Cloud is contacted.
  fs.writeFileSync(preload,fs.readFileSync(preload,'utf8').replace("global.fetch=async url=>", "const originalFetch=global.fetch;global.fetch=async url=>").replace("return require('undici').fetch(url);","return originalFetch(url);"));
  env.NODE_OPTIONS=`--require=${preload}`;
 }
 const result=await execute([path.join(root,'dist/cli/index.js'),'run','--ci','--workers',String(workers)],directory,env);
 assert.equal(result.code,failed?1:0,result.output);
 const report=JSON.parse(fs.readFileSync(path.join(directory,'flowstride-artifacts/summary.json')));
 assert.equal(report.status,failed?'failed':'passed',result.output);
 assert.equal(report.metrics.total,3*workers);assert.equal(report.metrics.incomplete,0);
 if(hybrid)assert.equal(report.engine,'Enterprise (Pro)');
 assert(fs.statSync(path.join(report.artifactsDir,'game.webm')).size>0,'Video must be present');
 if(failed)assert(fs.readdirSync(report.artifactsDir).some(file=>file.endsWith('.jpg')),'Failure screenshot must be present');
 await assert.rejects(fetch(`http://127.0.0.1:${number}`,{signal:AbortSignal.timeout(1000)}));
});

for (const priority of [false]) test(`SIGTERM stops ${priority?'priority':'single-worker'} work, records interruption, and finalizes videos`,async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-cancel-')),number=await port();fs.mkdirSync(path.join(directory,'flows'));fs.mkdirSync(path.join(directory,'.flowstride'));
 fs.writeFileSync(path.join(directory,'.flowstride/credentials.json'),JSON.stringify({machineToken:null}));
 fs.writeFileSync(path.join(directory,'server.cjs'),`require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body>Game</body></html>');}).listen(${number},'127.0.0.1');`);
 fs.writeFileSync(path.join(directory,'flowstride.config.json'),JSON.stringify({timeout:5000,recordVideo:true,webServer:{command:'node server.cjs',url:`http://127.0.0.1:${number}`}}));
 const flow=`Feature: Cancellation\nlet game = "flowstride:game"\nScenario: Stop queued gameplay\nGiven "The game is open"\n flow.open "http://127.0.0.1:${number}"\nWhen "The player holds a key"\n game.checkpoint "ready"\n game.key {"key":"ArrowRight","duration":1500}\nThen "Execution would continue"\n game.checkpoint "after-key"\n`;
 for(const name of [priority?'cancel1.first':'cancel1','cancel2'])fs.writeFileSync(path.join(directory,'flows',name+'.flow'),flow);
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'dist/cli/index.js'),'run','--ci','--workers','1'],{cwd:directory,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',FLOWSTRIDE_TOKEN:''},stdio:['ignore','pipe','pipe']});
  let output='',sent=false;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Cancellation hung: '+output));},15000);
  const signal = setInterval(()=>{
    const artifacts=path.join(directory,'flowstride-artifacts');
    if(!sent&&fs.existsSync(artifacts)&&fs.readdirSync(artifacts).some(name=>name.startsWith('run-')&&fs.readdirSync(path.join(artifacts,name)).some(file=>file.endsWith('-ready.png')))){
      sent=true;setTimeout(()=>child.kill('SIGTERM'),200);
    }
  },20);
  const collect=data=>{output+=data;};
  child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);clearInterval(signal);resolve({code,output});});
 });
 assert.equal(result.code,130,result.output);const report=JSON.parse(fs.readFileSync(path.join(directory,'flowstride-artifacts/summary.json')));assert.equal(report.status,'interrupted');assert(report.metrics.passed<8);
 assert(!fs.readdirSync(report.artifactsDir).some(name=>name.endsWith('-after-key.png')));
 assert(fs.readdirSync(report.artifactsDir).some(name=>name.endsWith('.webm')),'Interrupted run should retain finalized video: '+result.output);
 await assert.rejects(fetch(`http://127.0.0.1:${number}`,{signal:AbortSignal.timeout(1000)}));
});
