const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Lexer } = require('../../dist/parser/lexer');
const { Parser } = require('../../dist/parser/parser');
const { loadNativeConfig } = require('../../dist/ci/config');
const { parseShard, executionPlan, mergeResults } = require('../../dist/ci/distribution');
const { NativeRuntime } = require('../../dist/native/runtime');
const { ArmedEvent, matchesURL } = require('../../dist/native/events');
const { validateContextOptions, evidencePath, readProjectFile } = require('../../dist/native/validation');
const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flowstride-native-unit-')));
const parse = source => new Parser(new Lexer(`Feature: Native capabilities\nScenario: Native actions\nGiven "A fixture"\nWhen "An operation"\nThen "An assertion"\n${source}\n`).tokenise()).parse()[0].scenarios[0].steps;

test('native syntax preserves JSON quoted braces, aliases and existing commands', () => {
  const data = {name:'route',url:'**/a',json:{text:'{ literal } and "quoted"'}};
  const result = parse('flow.network.route '+JSON.stringify(data));
  assert.equal(result[0].action,'native'); assert.deepEqual(result[0].payload.data,data);
  assert.equal(result[0].payload.pluginMethod,'network.route');
  assert.equal(parse('game.tap {"x":0.5,"y":0.5}')[0].action,'plugin');
  assert.equal(parse('flow.open "/";')[0].action,'open');
  assert.throws(()=>parse('flow.network.route {"name":"oops"'),/Unclosed/);
});
test('unknown native operations and options cannot silently pass',async()=>{
  const runtime=new NativeRuntime({},{timeout:100});
  await assert.rejects(runtime.execute('network.unknown',{}),/Unknown network/);
  await assert.rejects(runtime.execute('browser.create',{name:'x',options:{ignoreHTTPSerrors:true}}));
  await assert.rejects(runtime.execute('browser.create',{name:'../escape'}));
  await assert.rejects(runtime.execute('network.route',{name:'x',url:'**',extra:true}));
});
for(const browser of ['chromium','firefox','webkit'])test(`configuration validates ${browser} and retry boundaries`,()=>{
  const root=temp();fs.writeFileSync(path.join(root,'flowstride.config.json'),JSON.stringify({browser,retries:2,trace:true,har:true,browserOptions:{locale:'en-GB'}}));
  const config=loadNativeConfig(root,{});assert.equal(config.browser,browser);assert.equal(config.retries,2);
  fs.writeFileSync(path.join(root,'flowstride.config.json'),JSON.stringify({retries:-1}));assert.throws(()=>loadNativeConfig(root,{}),/retries/);
});
test('context options reject unsafe paths, typos and invalid bounds',()=>{
  for(const data of [{executablePath:'/tmp/exe'},{recordHar:{path:'../../private'}},{storageState:'../../credentials.json'},{viewport:{width:-1,height:100}},{geolocation:{latitude:91,longitude:0}}])assert.throws(()=>validateContextOptions(data));
  assert.throws(()=>validateContextOptions({isMobile:true},'firefox'),/Firefox/);
});
test('armed events safely observe timeout, late capture and cancellation',async()=>{
  const errors=[];const listener=error=>errors.push(error);process.on('unhandledRejection',listener);let detached=0;
  try{const event=new ArmedEvent(10,()=>detached++);await new Promise(resolve=>setTimeout(resolve,40));await assert.rejects(event.take(),/timed out/);event.capture('late');assert.equal(detached,1);assert.deepEqual(errors,[]);
    const success=new ArmedEvent(100,()=>detached++);success.capture('done');assert.equal(await success.take(),'done');
    const cancelled=new ArmedEvent(100,()=>detached++);cancelled.fail(new Error('cancelled'));await assert.rejects(cancelled.take(),/cancelled/);
  }finally{process.off('unhandledRejection',listener);}
});
test('network matchers escape regex syntax and distinguish * from **',()=>{
  assert(matchesURL('**/data?key=1','https://app.test/api/data?key=1'));assert(!matchesURL('https://app.test/*','https://app.test/a/b'));assert(matchesURL('https://app.test/**','https://app.test/a/b'));assert(!matchesURL('https://app.test/data','https://appXtest/data'));
});
test('evidence/fixture containment checks include symlink escapes',()=>{
  const root=temp(),outside=temp(),config={projectRoot:root,artifactsDir:'artifacts'};fs.writeFileSync(path.join(outside,'private.txt'),'private');fs.symlinkSync(outside,path.join(root,'escape'));
  assert.throws(()=>evidencePath(config,'../private'));assert.throws(()=>readProjectFile(config,'escape/private.txt'),/Symlink/);assert.throws(()=>readProjectFile(config,'../outside'));assert(evidencePath(config,'trace.zip').startsWith(root));
});
function makePlan(){const root=temp(),target=path.join(root,'flows');fs.mkdirSync(target);for(const name of ['setup.first','a','b','c','d'])fs.writeFileSync(path.join(target,name+'.flow'),'fixture '+name);return{root,target,config:{projectRoot:root,browser:'chromium'}};}
test('shards are deterministic, disjoint and complete; setup repeats explicitly',()=>{
  const{target,config}=makePlan(),shards=[1,2,3].map(index=>executionPlan(target,{...config,shard:`${index}/3`}));const assigned=shards.flatMap(plan=>plan.files.filter(file=>!file.endsWith('.first.flow')));
  assert.equal(new Set(assigned).size,4);assert.equal(assigned.length,4);assert(shards.every(plan=>plan.files.some(file=>file.endsWith('setup.first.flow'))));assert(shards.every(plan=>plan.suiteHash===shards[0].suiteHash));assert.deepEqual(executionPlan(target,{...config,shard:'2/3'}),shards[1]);
  for(const value of ['0/1','2/1','1/0','x','1/257','1.2/3'])assert.throws(()=>parseShard(value));
});
test('history-weighted scheduling balances long files',()=>{
  const{root,target,config}=makePlan();fs.writeFileSync(path.join(root,'timings.json'),JSON.stringify({'a.flow':100,'b.flow':50,'c.flow':40,'d.flow':10}));const shards=[1,2].map(index=>executionPlan(target,{...config,shard:`${index}/2`,shardHistory:'timings.json'}));assert.equal(shards[0].files.filter(file=>!file.endsWith('.first.flow')).length,1);assert.equal(shards[1].files.filter(file=>!file.endsWith('.first.flow')).length,3);
  fs.writeFileSync(path.join(root,'timings.json'),'[]');assert.throws(()=>executionPlan(target,{...config,shardHistory:'timings.json'}));
});
test('merge rejects missing/duplicate/different shards and preserves failures/evidence',()=>{
  const{root,target,config}=makePlan(),old=process.cwd();process.chdir(root);
  try{const summaries=[1,2].map(index=>{const plan=executionPlan(target,{...config,shard:`${index}/2`}),dir=path.join(root,`s${index}`);fs.mkdirSync(path.join(dir,'run-a'),{recursive:true});fs.writeFileSync(path.join(dir,'run-a','trace.zip'),'fixture-trace');const report={protocol:1,engine:'OS',browser:'firefox',browsers:[{fileName:`file-${index}`,engine:'firefox',version:'fixture',headless:true}],status:index===2?'failed':'passed',duration:100,artifactsDir:'/other-machine/run-a',metrics:{total:1,passed:index===1?1:0,failed:index===2?1:0,skipped:0,incomplete:0},files:plan.files.map(file=>path.basename(file)),steps:[],errors:index===2?['failed assertion']:[],distribution:{...plan,files:undefined,flowRoot:undefined}};const file=path.join(dir,'summary.json');fs.writeFileSync(file,JSON.stringify(report));return file;});
    assert.throws(()=>mergeResults([summaries[0]],'missing'),/Missing shards/);assert.throws(()=>mergeResults([summaries[0],summaries[0]],'duplicate'),/Duplicate/);const result=mergeResults(summaries,'complete');assert.equal(result.status,'failed');assert.equal(result.errors.length,1);assert.equal(result.browser,'firefox');assert.equal(result.browsers.length,2);assert.deepEqual(result.browsers.map(info=>info.shard),[1,2]);assert.equal(fs.readFileSync(path.join(root,'complete/shard-2/trace.zip'),'utf8'),'fixture-trace');const other=JSON.parse(fs.readFileSync(summaries[1]));other.distribution.configHash='different';fs.writeFileSync(summaries[1],JSON.stringify(other));assert.throws(()=>mergeResults(summaries,'different'),/different suites/);
  }finally{process.chdir(old);}
});

test('generated CI matrix uses native browser/shard options and preserves existing workflow files',()=>{
 const {initCI}=require('../../dist/ci/init');const root=temp(),old=process.cwd();process.chdir(root);
 try{initCI('github',{browsers:'chromium,firefox,webkit',shards:'3'});const file=path.join(root,'.github/workflows/flowstride.yml'),text=fs.readFileSync(file,'utf8');assert(text.includes('fail-fast: false'));assert(text.includes('shard: [1,2,3]'));assert(text.includes('--browser ${{ matrix.browser }} --shard ${{ matrix.shard }}/3'));assert(text.includes('flowstride-results-${{ matrix.browser }}-${{ matrix.shard }}'));assert.throws(()=>initCI('github'),/not overwritten/);assert.equal(fs.readFileSync(file,'utf8'),text);
 }finally{process.chdir(old);}
});
test('API retry checkpoint restores response and authorization without keeping failed-attempt changes',()=>{
 const {ApiAdapter}=require('../../dist/adapters/api/undici');const api=new ApiAdapter({timeout:1000});api.setGlobalHeader('Authorization','Bearer fixture-original');api.lastStatus=200;api.lastBody={ok:true};api.lastHeaders={'x-state':'original'};const checkpoint=api.checkpointState();api.setGlobalHeader('Authorization','Bearer fixture-changed');api.lastBody.ok=false;api.restoreState(checkpoint);assert.equal(api.globalHeaders.Authorization,'Bearer fixture-original');assert.deepEqual(api.getState().body,{ok:true});
});
test('stealth adapter wraps the pinned browser instead of selecting a separate optional peer runtime',()=>{
 const vm=require('node:vm'),{createRequire}=require('node:module'),filename=path.resolve(__dirname,'../../dist/adapters/web/playwright.js'),load=createRequire(filename);let wrapped=false;
 const exports={};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports,require(name){if(name==='playwright-extra')return{addExtra(browser){assert.equal(browser,load('playwright').chromium);wrapped=true;return{use(){}};}};return load(name);}});assert.equal(wrapped,true);assert.equal(typeof exports.WebAdapter,'function');
 const pkg=require('../../package.json');assert.equal(pkg.dependencies['playwright-core'],pkg.dependencies.playwright);
});
test('new browser features require the capability protocol; legacy flows, comments and descriptions do not',()=>{
 const {needsNativeBrowserProtocol}=require('../../dist/native/compatibility'),root=temp(),file=path.join(root,'flow.flow'),config={projectRoot:root,timeout:1000,headless:true,browser:'chromium'};
 fs.writeFileSync(file,'// flow.browser.create {}\nFeature: flow.assert.that\nScenario: Existing\nGiven "flow.browser.create"\n flow.open "/"\nWhen "Existing action"\n flow.click "flow.network.arm"\nThen "Existing assertion"\n flow.expect visible "Ready"\n');
 assert.equal(needsNativeBrowserProtocol(file,config),false);
 fs.appendFileSync(file,'flow.assert.that {"selector":"h1","condition":"text","value":"Ready"}\n');assert.equal(needsNativeBrowserProtocol(file,config),true);
 fs.writeFileSync(file,'flow.open "/"');
 for(const extra of [{browser:'firefox'},{retries:1},{trace:true},{har:true},{domSnapshots:true},{shard:'1/2'},{browserOptions:{locale:'en-GB'}}])assert.equal(needsNativeBrowserProtocol(file,{...config,...extra}),true);
});
