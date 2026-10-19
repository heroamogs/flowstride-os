const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawnSync}=require('node:child_process');
const osTar=process.env.FLOWSTRIDE_OS_TGZ,proTar=process.env.FLOWSTRIDE_PRO_TGZ,cloudSource=process.env.FLOWSTRIDE_CLOUD_SOURCE;
test('real archive install, OSS-to-Pro handoff, npx dispatch and fallback contract',{skip:!osTar||!proTar||!cloudSource},()=>{
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-package-contract-'));const project=path.join(stage,'consumer');fs.mkdirSync(project);fs.mkdirSync(path.join(project,'flows'));
 fs.copyFileSync(proTar,path.join(stage,'pro.tgz'));
 fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'flowstride-package-contract',version:'1.0.0',private:true,devDependencies:{flowstride:'file:'+osTar}}));
 fs.writeFileSync(path.join(project,'flows/smoke.flow'),'Feature: Package contract\nScenario: Engine handoff\nGiven "A project exists"\nWhen "An action runs"\n flow.open "https://example.invalid"\nThen "The engine reports its result"\n');
 const env={PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',FLOWSTRIDE_API_URL:'https://cloud.example.invalid',FLOWSTRIDE_INSTALL_STAGE:stage,FLOWSTRIDE_CLOUD_SOURCE:cloudSource,
  NODE_OPTIONS:`--require=${path.join(__dirname,'fixtures/install-preload.cjs')}`,npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_package_lock:'false',
  npm_config_offline:process.env.FLOWSTRIDE_TEST_NPM_ONLINE?'false':'true',npm_config_cache:process.env.FLOWSTRIDE_NPM_CACHE||path.join(os.homedir(),'.npm'),npm_config_logs_dir:path.join(stage,'npm-logs'),PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1'};
 const traceFile=path.join(stage,'trace.jsonl');
 function invoke(label,entry,args,overrides={}){fs.writeFileSync(traceFile,'');const result=spawnSync(process.execPath,[entry,...args],{cwd:project,env:{...env,...overrides},encoding:'utf8',timeout:120000});fs.writeFileSync(path.join(stage,label+'.log'),(result.stdout||'')+(result.stderr||''));assert.equal(result.error,undefined);assert.equal(result.status,0,`${label}: ${result.stdout}\n${result.stderr}`);return fs.readFileSync(traceFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
 function engine(trace,expected){for(const type of ['worker','orchestrator','start']){assert(trace.some(item=>item.type===type&&item.engine===expected),`Missing ${expected} ${type}`);assert(!trace.some(item=>item.type===type&&item.engine!==expected),`Unexpected alternate ${type}`);}}
 const login=invoke('login',path.resolve(__dirname,'../../dist/cli/index.js'),['login'],{FLOWSTRIDE_TOKEN:'test-install-machine-token'});
 assert(login.some(item=>item.type==='storage-reference'));assert(!fs.existsSync(path.join(project,'flowstride-pro.tgz')));
 const installed=path.join(project,'node_modules/@flowstride/pro');const version=JSON.parse(fs.readFileSync(path.join(installed,'package.json'))).version;assert.match(version,/^1\.0\.15-rc\./);
 const publicCli=path.join(project,'node_modules/flowstride/dist/cli/index.js');
 engine(invoke('handoff',publicCli,['run','--ci']),'pro');
 const worker=path.join(installed,'dist/runner/flow_worker.js');fs.renameSync(worker,worker+'.backup');try{engine(invoke('missing-pro',publicCli,['run','--ci']),'os');}finally{fs.renameSync(worker+'.backup',worker);}
 const orchestrator=path.join(installed,'dist/runner/flow_orchestrator.js');fs.renameSync(orchestrator,orchestrator+'.backup');fs.writeFileSync(orchestrator,'throw new Error("Test-only broken Pro import");');try{engine(invoke('broken-pro',publicCli,['run','--ci']),'os');}finally{fs.unlinkSync(orchestrator);fs.renameSync(orchestrator+'.backup',orchestrator);}
 const originalOrchestrator=fs.readFileSync(orchestrator,'utf8');fs.appendFileSync(orchestrator,'\nexports.FlowOrchestrator.nativeCIProtocol=0;');try{engine(invoke('incompatible-pro',publicCli,['run','--ci']),'os');}finally{fs.writeFileSync(orchestrator,originalOrchestrator);}
 engine(invoke('revoked-token',publicCli,['run','--ci'],{FLOWSTRIDE_TOKEN:'test-revoked-token'}),'os');
 fs.writeFileSync(path.join(project,'.flowstride/credentials.json'),JSON.stringify({machineToken:'test-install-machine-token',workspaceId:'222222222222222222222222'}));
 const npmCli=process.env.FLOWSTRIDE_NPM_CLI||path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
 engine(invoke('npx',npmCli,['exec','--offline','--no','--','flowstride','run','--ci']),'pro');
 console.log('Archive contract passed: real npm dependency installation; actual Cloud download handler with mocked storage; Pro handoff/npx; missing, broken, and revoked fallback. Browser execution was mocked in this suite.');
});
