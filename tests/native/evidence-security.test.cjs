const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {evidenceDirectory,prepareEvidenceFile,writeEvidence,protectEvidenceTree,exportEvidence,validateEvidencePolicy}=require('../../dist/security/evidence');
const {redactWorkerPayload}=require('../../dist/security/redaction');
const temp=()=>fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-evidence-security-')));
const cleanup=root=>fs.rmSync(root,{recursive:true,force:true});
test('all evidence formats are private even with a permissive umask; existing modes are tightened',()=>{
 const root=temp(),config={projectRoot:root},old=process.umask(0);
 try {for(const name of ['run.json','snapshot.dom.html','capture.har','trace.zip','screen.png','recording.webm','report.pdf']){const file=writeEvidence(config,path.join(root,'evidence',name),'sensitive-fixture');if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);}
  fs.chmodSync(path.join(root,'evidence'),0o755);fs.chmodSync(path.join(root,'evidence/trace.zip'),0o644);protectEvidenceTree(config,path.join(root,'evidence'));if(process.platform!=='win32'){assert.equal(fs.statSync(path.join(root,'evidence')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(root,'evidence/trace.zip')).mode&0o777,0o600);}
 }finally{process.umask(old);cleanup(root);}
});
test('rewriting evidence truncates the verified handle and rejects swapped hardlinks before mutation',()=>{
 const root=temp(),outside=temp(),file=path.join(root,'evidence/run.json'),sentinel=path.join(outside,'sentinel'),originalOpen=fs.openSync;
 try{
  writeEvidence({projectRoot:root},file,'long-fixture-value');writeEvidence({projectRoot:root},file,'new');assert.equal(fs.readFileSync(file,'utf8'),'new');
  fs.writeFileSync(sentinel,'must-remain-unchanged');let swapped=false;
  fs.openSync=function(target,flags,...args){if(target===file&&typeof flags==='number'&&!swapped){swapped=true;fs.unlinkSync(file);fs.linkSync(sentinel,file);}return originalOpen.call(this,target,flags,...args);};
  assert.throws(()=>writeEvidence({projectRoot:root},file,'unsafe'),/changed|unsafe/);assert.equal(fs.readFileSync(sentinel,'utf8'),'must-remain-unchanged');
 }finally{fs.openSync=originalOpen;cleanup(root);cleanup(outside);}
});
for(const kind of ['directory-link','file-link','hardlink','outside','project-root'])test(`evidence rejects ${kind} without reading or overwriting its target`,()=>{
 const root=temp(),outside=temp(),file=path.join(outside,'sentinel');fs.writeFileSync(file,'unchanged');
 try{fs.mkdirSync(path.join(root,'evidence'));let action;
  if(kind==='directory-link'){fs.symlinkSync(outside,path.join(root,'linked'),process.platform==='win32'?'junction':undefined);action=()=>writeEvidence({projectRoot:root},path.join(root,'linked/leak'),'secret');}
  if(kind==='file-link'){fs.symlinkSync(file,path.join(root,'evidence/link'));action=()=>prepareEvidenceFile({projectRoot:root},path.join(root,'evidence/link'));}
  if(kind==='hardlink'){fs.linkSync(file,path.join(root,'evidence/link'));action=()=>writeEvidence({projectRoot:root},path.join(root,'evidence/link'),'secret');}
  if(kind==='outside')action=()=>evidenceDirectory({projectRoot:root},outside);
  if(kind==='project-root')action=()=>evidenceDirectory({projectRoot:root},root);
  assert.throws(action);assert.equal(fs.readFileSync(file,'utf8'),'unchanged');
 }finally{cleanup(root);cleanup(outside);}
});
test('export removes debugger-only raw evidence and redacts structured credentials without modifying live data',()=>{
 const input={status:'failed',error:'password=private-value',rawCurlString:'curl raw-secret',details:{rawReplayRequest:{headers:{Authorization:'secret'}},strippedDom:'<div>private</div>',screenshot:'raw-image',base64:'encoded',harContent:'raw',traceContent:'raw'},assertion:{checks:[{label:'button enabled',status:'failed',expected:'enabled',actual:'disabled'}]},image:'data:image/png;base64,private-image'};
 const exported=exportEvidence(input);const text=JSON.stringify(exported);for(const secret of ['private-value','raw-secret','private-image','raw-image','<div>','encoded'])assert(!text.includes(secret),text);assert.equal(exported.assertion.checks[0].actual,'disabled');assert(input.rawCurlString.includes('raw-secret'));
});
test('portable evidence redacts separately known environment secrets',()=>{const prior=process.env.FLOWSTRIDE_TEST_SECRET;process.env.FLOWSTRIDE_TEST_SECRET='private-env-sentinel';try{assert(!JSON.stringify(exportEvidence({error:'failed with private-env-sentinel'})).includes('private-env-sentinel'));}finally{if(prior===undefined)delete process.env.FLOWSTRIDE_TEST_SECRET;else process.env.FLOWSTRIDE_TEST_SECRET=prior;}});
test('authorized interactive cURL and Replay retain masked templates while CI events do not',()=>{
 const input={type:'REST',details:{curlString:'curl -H "Authorization: Bearer private-token"',rawReplayRequest:{url:'https://app.test',headers:{Authorization:'Bearer private-token'}}}};
 const local=redactWorkerPayload('LOG_EVENT',input,['private-token'],true);assert.equal(local.details.rawCurlString,undefined);assert.equal(local.details.rawReplayRequest,'[REDACTED]');assert.equal(local.details.replayRequest.headers.Authorization,'Bearer [REDACTED]');assert.equal(exportEvidence(local).details.replayRequest,undefined);
 assert(!JSON.stringify(exportEvidence(local)).includes('private-token'));assert(!JSON.stringify(redactWorkerPayload('LOG_EVENT',input,['private-token'],false)).includes('private-token'));
});
test('evidence capture configuration accepts only documented booleans',()=>{for(const value of [undefined,{}, {screenshots:false,cloudVideo:false}])assert.doesNotThrow(()=>validateEvidencePolicy(value));for(const value of [null,[],true,{screenshots:'false'},{cloudVideo:0},{uploadAll:true}])assert.throws(()=>validateEvidencePolicy(value));});
test('screenshot disable avoids both step screenshots and live streaming browser access',async()=>{
 const {FlowWorker}=require('../../dist/runner/flow_worker');const worker=Object.create(FlowWorker.prototype);worker.config={security:{evidence:{screenshots:false}},ci:false};let calls=0;worker.web={getPage(){return {screenshot:async()=>{calls++;return Buffer.from('private');}};}};
 assert.deepEqual(await worker.captureStepContext({}),{});await worker.startStreaming();assert.equal(calls,0);
});
test('Cloud video privacy opt-out and disabled recording make no upload requests',async()=>{
 const pkg=require('../../package.json');if(pkg.name!=='@flowstride/pro')return;
 const {FlowOrchestrator}=require('../../dist/runner/flow_orchestrator');for(const policy of [{security:{evidence:{cloudVideo:false}}},{recordVideo:false}]){const runner=Object.create(FlowOrchestrator.prototype);runner.config={...policy,isCloudSyncActive:true,machineToken:'fixture',cloudSyncResult:{}};assert.deepEqual(await runner.uploadVideosToCloud('failed'),[]);assert.equal(runner.config.cloudSyncResult.video,'skipped-privacy');}
});

test('artifact configuration cannot export credential, Git or dependency directories',()=>{const {loadNativeConfig}=require('../../dist/ci/config');const root=temp();try{for(const artifactsDir of ['.flowstride','.git/evidence','node_modules/evidence']){fs.writeFileSync(path.join(root,'flowstride.config.json'),JSON.stringify({artifactsDir}));assert.throws(()=>loadNativeConfig(root,{}),/artifactsDir/);}}finally{cleanup(root);}});

test('init keeps generated private evidence out of Git and rejects linked ignore files',async()=>{const vm=require('node:vm'),ts=require('typescript');const root=temp();try{const source=fs.readFileSync(path.join(__dirname,'../../src/cli/commands/init.ts'),'utf8'),module={exports:{}};const chalk=require('chalk');const deps={fs,path,chalk,ora:()=>({start(){return this;},succeed(){},fail(){},stop(){}}),child_process:{execFileSync(){},execFile(){}},util:{promisify:()=>async()=>({stdout:''})}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:Object.assign(name=>{assert(name in deps,name);return deps[name];},{resolve:require.resolve}),console:{log(){}},process:{cwd:()=>root,env:{},execPath:process.execPath,platform:process.platform}});fs.writeFileSync(path.join(root,'.gitignore'),'# user rule\nnode_modules\n');await module.exports.initAction();await module.exports.initAction();const ignore=fs.readFileSync(path.join(root,'.gitignore'),'utf8');assert(ignore.startsWith('# user rule'));for(const rule of ['.flowstride','flowstride-artifacts','reports/latest'])assert.equal(ignore.split('\n').filter(line=>line===rule).length,1,rule);fs.unlinkSync(path.join(root,'.gitignore'));const sentinel=path.join(root,'sentinel');fs.writeFileSync(sentinel,'unchanged');fs.symlinkSync(sentinel,path.join(root,'.gitignore'));await assert.rejects(module.exports.initAction(),/linked|special/);assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged');}finally{cleanup(root);}});
