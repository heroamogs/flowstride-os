import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const archives=path.resolve(process.argv[2]);
const evidence=path.resolve(process.argv[3] || path.join(os.tmpdir(),'flowstride-archive-acceptance'));
fs.mkdirSync(evidence,{recursive:true});
const candidates=fs.readdirSync(archives).filter(name=>name.endsWith('.tgz'));
assert.equal(candidates.length,1,'Provide a directory containing one candidate archive.');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-consumer-'));
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'flowstride-candidate-consumer',private:true,version:'1.0.0'}));
const browserCache=process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform==='darwin' ? path.join(os.homedir(),'Library/Caches/ms-playwright') : process.platform==='win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(),'ms-playwright') : path.join(os.homedir(),'.cache/ms-playwright'));
const env={...process.env,CI:'true',FLOWSTRIDE_TOKEN:'',FLOWSTRIDE_API_KEY:'',FLOWSTRIDE_API_URL:'http://127.0.0.1:1',NEXTJS_WEBHOOK_URL:'',HOME:root,USERPROFILE:root,PLAYWRIGHT_BROWSERS_PATH:browserCache,PLAYWRIGHT_SKIP_BROWSER_GC:'1'};
// Never inherit live developer credentials or preload hooks into the consumer.
delete env.NODE_OPTIONS;delete env.BASE_URL;
function invoke(label,command,args,timeout=120000){
 const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout,shell:process.platform==='win32'});
 fs.writeFileSync(path.join(evidence,label+'.log'),(result.stdout || '')+(result.stderr || ''));
 if(result.error)throw result.error;
 return result;
}
const install=invoke('install',process.platform==='win32'?'npm.cmd':'npm',['install','--ignore-scripts','--no-audit','--no-fund',path.join(archives,candidates[0])]);
assert.equal(install.status,0,install.stderr);
const names=['flowstride','@flowstride/pro'];
const name=names.find(value=>fs.existsSync(path.join(root,'node_modules',value,'package.json')));
assert(name,'The archive must install an engine package.');
const engine=path.join(root,'node_modules',name);
const packageJSON=JSON.parse(fs.readFileSync(path.join(engine,'package.json')));
assert.equal(packageJSON.dependencies.playwright,'1.59.1');
fs.cpSync(path.join(engine,'examples/native-game'),root,{recursive:true});
if(name!=='flowstride'){
 const server=path.join(root,'server.mjs');fs.writeFileSync(server,fs.readFileSync(server,'utf8').replace("from 'flowstride/","from '@flowstride/pro/"));
}
const cli=path.join(engine,'dist/cli/index.js');
// Use an isolated consumer port, rather than the sample's fixed port.
const {createServer}=await import('node:net');const probe=createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
for(const file of ['server.mjs','flowstride.config.json','flows/canvas.flow']){
 const target=path.join(root,file);fs.writeFileSync(target,fs.readFileSync(target,'utf8').replaceAll('5189',String(port)));
}
const installBrowser=invoke('browser-command',process.execPath,[cli,'install']);
assert.equal(installBrowser.status,0,'Native matching-browser installer failed.');
const passed=invoke('passed',process.execPath,[cli,'run','--ci']);
assert.equal(passed.status,0,passed.stdout+passed.stderr);
let report=JSON.parse(fs.readFileSync(path.join(root,'flowstride-artifacts/summary.json')));
assert.equal(report.status,'passed');assert.equal(report.metrics.passed,7);assert.equal(report.metrics.incomplete,0);
assert(fs.readdirSync(report.artifactsDir).some(file=>file.endsWith('.webm')),'A packaged run must retain its video.');
assert(fs.existsSync(path.join(root,'flowstride-artifacts/junit.xml')));
fs.writeFileSync(path.join(evidence,'passed-summary.json'),JSON.stringify(report,null,2));
await assert.rejects(fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)}),'The owned sample server must stop after success.');
const flow=path.join(root,'flows/canvas.flow');fs.writeFileSync(flow,fs.readFileSync(flow,'utf8').replace('game.checkpoint {"name":"game-result","canvas":"#game"}', 'game.expectState {"path":"score","equals":999}'));
const failed=invoke('failed',process.execPath,[cli,'run','--ci']);assert.equal(failed.status,1,failed.stdout+failed.stderr);
report=JSON.parse(fs.readFileSync(path.join(root,'flowstride-artifacts/summary.json')));
assert.equal(report.status,'failed');assert.equal(report.metrics.failed,1);assert.equal(report.metrics.incomplete,0);
assert(fs.readdirSync(report.artifactsDir).some(file=>file.endsWith('.jpg')),'A packaged failing run must retain its screenshot.');
fs.writeFileSync(path.join(evidence,'failed-summary.json'),JSON.stringify(report,null,2));
await assert.rejects(fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)}),'The owned sample server must stop after failure.');
fs.cpSync(path.join(root,'flowstride-artifacts'),path.join(evidence,'media'),{recursive:true});
const init=invoke('workflow-init',process.execPath,[cli,'ci','init','github']);assert.equal(init.status,0);
const generated=path.join(root,'.github/workflows/flowstride.yml');const before=fs.readFileSync(generated,'utf8');
assert(before.includes('flowstride run --ci'));assert(before.includes('flowstride install --with-deps'));
const duplicate=invoke('workflow-preservation',process.execPath,[cli,'ci','init','github']);assert.notEqual(duplicate.status,0);assert.equal(fs.readFileSync(generated,'utf8'),before);
fs.writeFileSync(path.join(evidence,'acceptance.json'),JSON.stringify({name,version:packageJSON.version,node:process.version,platform:process.platform,passedSteps:7,deliberateFailures:1,browserInstaller:true,video:true,failureScreenshot:true,serverCleanup:true,workflowPreserved:true,liveCloud:false},null,2));
console.log(`${name}@${packageJSON.version}: clean archive install, native browser install, 7 passed steps, 1 deliberate failure, video, screenshot, cleanup and workflow preservation verified.`);
