const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const {Lexer}=require('../../dist/parser/lexer');
const {Parser}=require('../../dist/parser/parser');

const ciKeys=['FLOWSTRIDE_NATIVE_CI','CI','GITHUB_ACTIONS','GITLAB_CI','CIRCLECI','JENKINS_URL','FLOWSTRIDE_API_KEY'];
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function until(predicate){for(let i=0;i<100;i++){const result=predicate();if(result)return result;await delay(2);}throw Error('Fixture timed out waiting for worker state');}
async function withoutCI(fn){const old=Object.fromEntries(ciKeys.map(key=>[key,process.env[key]]));try{for(const key of ciKeys)delete process.env[key];return await fn();}finally{for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}}
function fixture(config={}){
 const calls=[],events=[];
 const web={activeProfile:'default',pageErrors:[],getPage:()=>undefined,
  expectVisible:async target=>{calls.push(['expect',target]);if(target==='Missing')throw Error('Target not found: Missing');},
  click:async target=>{calls.push(['click',target]);if(target==='Optional missing')throw Error('Optional banner not found');},
  navigate:async url=>calls.push(['open',url]),
  checkpointProfiles:async()=>({}),restoreProfiles:async()=>calls.push(['restoreProfiles'])};
 const api={getState:()=>({status:200,body:{name:'Reader'},headers:{},responseTime:1}),get:async url=>calls.push(['get',url]),checkpointState:()=>({}),restoreState:()=>{},resetState:()=>{}};
 const store={getAll:()=>({}),clear(){},set(){}};
 const worker=new FlowWorker({ci:true,headless:true,timeout:40,...config},web,api,store,{},{});
 worker.isSilent=true;worker.currentFileName='batch2-worker.flow';worker.captureStepContext=async()=>({});worker.native.captureDOM=async()=>undefined;worker.native.dispose=async()=>{};worker.emitApiTelemetry=()=>{};
 worker.on('worker_event',event=>events.push(event));
 return {worker,web,api,calls,events};
}
const scenario=commands=>new Parser(new Lexer(`Feature: Worker controls\nScenario: Exercise\nGiven "Ready"\nWhen "Exercise"\n${commands}\nThen "Final"\nflow.expect visible "Completed";`).tokenise()).parse()[0].scenarios[0];
const updates=events=>events.filter(event=>event.type==='STEP_UPDATE').map(event=>event.payload);

test('a soft built-in assertion fails visibly, executes later commands and leaves the scenario failed',async()=>{
 const f=fixture(),s=scenario('flow.soft expect visible "Missing";\nflow.click "Continue";');
 assert.equal(await f.worker.runScenario(s),false);
 assert.deepEqual(updates(f.events).map(row=>row.status),['failed','passed','passed']);
 assert(f.calls.some(row=>row[0]==='click'&&row[1]==='Continue'));assert(f.calls.some(row=>row[1]==='Completed'));
 assert.match(updates(f.events)[0].error,/Missing/);
});

test('a hard required failure still skips later work while an optional try failure still passes',async()=>{
 const hard=fixture();assert.equal(await hard.worker.runScenario(scenario('flow.expect visible "Missing";\nflow.click "Continue";')),false);
 assert.deepEqual(updates(hard.events).map(row=>row.status),['failed','not_tested','not_tested']);assert(!hard.calls.some(row=>row[0]==='click'));
 const optional=fixture();assert.equal(await optional.worker.runScenario(scenario('flow.try click "Optional missing";\nflow.click "Continue";')),true);
 assert.deepEqual(updates(optional.events).map(row=>row.status),['skipped','passed','passed']);assert(optional.calls.some(row=>row[1]==='Completed'));
});

test('native assertion soft failures also retain nested diagnostics and continue',async()=>{
 const f=fixture();f.worker.native.execute=async()=>{throw Error('Expected stored value 1, received 2');};
 assert.equal(await f.worker.runScenario(scenario('flow.soft assert.value {"actual":2,"operator":"equals","expected":1};\nflow.click "Continue";')),false);
 const rows=updates(f.events);assert.deepEqual(rows.map(row=>row.status),['failed','passed','passed']);assert.match(rows[0].error,/stored value 1, received 2/);assert(rows[0].assertion);
});

test('soft failure defers bail until the remaining commands of its final attempt complete',async()=>{
 const f=fixture({bail:true}),s=scenario('flow.soft expect visible "Missing";\nflow.click "Continue";');
 assert.equal(await f.worker.runScenario(s),false);assert.equal(f.worker.bailTriggered,true);
 const bailIndex=f.events.findIndex(event=>event.type==='BAIL');
 const lastUpdate=f.events.map((event,index)=>[event,index]).filter(([event])=>event.type==='STEP_UPDATE').at(-1)[1];
 assert(bailIndex>lastUpdate);assert.equal(f.events.filter(event=>event.type==='BAIL').length,1);
});

for(const failOnFlaky of [false,true])test(`a recovered soft-failed retry keeps final outcome; failOnFlaky=${failOnFlaky}`,async()=>{
 const f=fixture({retries:1,failOnFlaky,bail:true});let attempts=0;
 f.worker.native.execute=async()=>{if(++attempts===1)throw Error('First attempt fixture mismatch');};
 const s=scenario('flow.soft assert.value {"actual":1,"operator":"equals","expected":1};\nflow.click "Continue";');
 assert.equal(await f.worker.runScenarioWithRetries(s,[]),!failOnFlaky);
 assert.equal(attempts,2);assert.deepEqual(f.events.filter(event=>event.type==='SCENARIO_RESULT').map(event=>event.payload.status),['failed','passed']);
 assert.equal(f.events.filter(event=>event.type==='BAIL').length,0);assert.equal(f.calls.filter(row=>row[1]==='Continue').length,2);
});

test('exhausted soft-failed retries fail finally and bail once after the final scenario command',async()=>{
 const f=fixture({retries:1,bail:true});f.worker.native.execute=async()=>{throw Error('Persistent mismatch');};
 assert.equal(await f.worker.runScenarioWithRetries(scenario('flow.soft assert.value {"actual":2,"operator":"equals","expected":1};\nflow.click "Continue";'),[]),false);
 assert.deepEqual(f.events.filter(event=>event.type==='SCENARIO_RESULT').map(event=>event.payload.status),['failed','failed']);
 assert.equal(f.events.filter(event=>event.type==='BAIL').length,1);assert.equal(f.calls.filter(row=>row[1]==='Continue').length,2);
});

for(const [action,payload]of [
 ['click',{selector:'Must not click',soft:true}],['open',{url:'https://example.test',soft:true}],['plugin',{pluginAlias:'custom',pluginMethod:'assert',data:{},soft:true}],
 ['native',{pluginAlias:'flow',pluginMethod:'browser.use',data:{name:'admin'},soft:true}],['expect',{type:'visible',selector:'Email',soft:true,optional:true}],
])test(`forged soft payload fails closed before side effects: ${action} ${payload.pluginMethod||''}`,async()=>{
 const f=fixture();f.worker.native.execute=async()=>{f.calls.push(['native']);};
 await assert.rejects(f.worker.executeStep(action,payload),/soft.*(assert|optional|try)|assert.*soft/i);
 assert.deepEqual(f.calls,[]);
});

for(const action of ['wait','pace'])test(`${action} runtime validates bounded integers and resolved numeric strings`,async()=>{
 const f=fixture(),durations=[];f.worker.control.delay=async ms=>durations.push(ms);
 const maximum=action==='wait'?86400000:60000;
 for(const value of [0,'0',1,'25',maximum])await f.worker.executeStep(action,{milliseconds:value});
 for(const value of [true,false,null,undefined,{},[],NaN,Infinity,-1,1.5,maximum+1,'','250ms','1e3','0x10','-1','2.0'])await assert.rejects(f.worker.executeStep(action,{milliseconds:value}),/finite integer|milliseconds/);
 if(action==='wait')assert.deepEqual(durations,[0,0,1,25,maximum]);else assert.equal(f.worker.paceMilliseconds,maximum);
});

test('wait and pace resolve env/local variables through the normal scenario path',async()=>{
 const old=process.env.FLOWSTRIDE_BATCH2_WAIT;process.env.FLOWSTRIDE_BATCH2_WAIT='15';
 try{
  const f=fixture(),durations=[];f.worker.localVariables.interval='20';f.worker.control.delay=async ms=>durations.push(ms);
  assert.equal(await f.worker.runScenario(scenario('flow.wait "{{env.FLOWSTRIDE_BATCH2_WAIT}}";\nflow.pace "@interval";\nflow.click "Continue";')),true);
  assert.deepEqual(durations,[15,20]);
 }finally{if(old===undefined)delete process.env.FLOWSTRIDE_BATCH2_WAIT;else process.env.FLOWSTRIDE_BATCH2_WAIT=old;}
});

test('pace affects browser actions only, zero disables it and the next scenario starts unpaced',async()=>{
 const f=fixture(),durations=[];f.worker.control.delay=async ms=>durations.push(ms);
 assert.equal(await f.worker.runScenario(scenario('flow.pace 12;\nflow.click "First";\nflow.get "/api/contract";\nflow.expect status "200";\nflow.assert.value {"actual":1,"operator":"equals","expected":1};\nflow.click "Second";\nflow.pace 0;\nflow.click "Third";')),true);
 assert.deepEqual(durations,[12,12]);
 await f.worker.runScenario(scenario('flow.click "New scenario";'));
 assert.deepEqual(durations,[12,12]);assert.equal(f.worker.paceMilliseconds,0);
});

test('abort releases a pending explicit wait promptly',async()=>{
 const f=fixture(),pending=f.worker.executeStep('wait',{milliseconds:10000});
 const rejection=assert.rejects(pending,/cancel|abort/i);setTimeout(()=>f.worker.abort(),5);await rejection;
 assert.equal(f.worker.isAborted,true);
});

test('log resolves ordinary variables, redacts known secrets and neutralizes terminal controls',async()=>{
 const old=process.env.FLOWSTRIDE_BATCH2_PASSWORD;process.env.FLOWSTRIDE_BATCH2_PASSWORD='batch2-private-value';
 const f=fixture(),output=[],originalLog=console.log;f.worker.isSilent=false;f.worker.localVariables.person='Reader';
 console.log=(...args)=>output.push(args.join(' '));
 try{
  const payload=f.worker.resolveStepPayload({message:'Hello @person {{env.FLOWSTRIDE_BATCH2_PASSWORD}}\x1b[2J\rspoof\x00'});
  await f.worker.executeStep('log',payload);
 }finally{console.log=originalLog;if(old===undefined)delete process.env.FLOWSTRIDE_BATCH2_PASSWORD;else process.env.FLOWSTRIDE_BATCH2_PASSWORD=old;}
 const logs=f.events.filter(event=>event.type==='LOG_EVENT');assert(logs.length>0);
 const rendered=JSON.stringify(logs);assert.match(rendered,/Reader/);assert.doesNotMatch(rendered,/batch2-private-value/);assert.match(rendered,/REDACTED/);
 assert(output.some(line=>line.includes('Reader')));assert.doesNotMatch(output.join(' '),/batch2-private-value|[\x00\x1b\r]/);
});

for(const action of ['log','pause'])test(`${action} runtime rejects absent and nonstring messages`,async()=>{
 await withoutCI(async()=>{const f=fixture({ci:false});for(const value of [undefined,null,'','  ',true,3,{},[]])await assert.rejects(f.worker.executeStep(action,{message:value}),/message|non-empty|string/);});
});

test('pause fails immediately in explicit CI and in detected CI even if config.ci=false',async()=>{
 await withoutCI(async()=>{
  for(const [config,setEnvironment]of [[{ci:true},false],[{ci:false},true]]){
   if(setEnvironment)process.env.CI='true';
   const f=fixture(config),started=Date.now();await assert.rejects(f.worker.executeStep('pause',{message:'Inspect'}),/CI|interactive/i);
   assert(Date.now()-started<1000);assert.equal(f.events.filter(event=>event.type==='EXECUTION_PAUSED').length,0);assert(!f.worker.control.pendingPause);
   delete process.env.CI;
  }
 });
});

test('interactive pause resumes only its exact ID; stale resumes cannot affect a later pause',async()=>{
 await withoutCI(async()=>{
  const f=fixture({ci:false});let settled=false;
  const pending=f.worker.executeStep('pause',{message:'Inspect form'}).then(()=>settled=true);
  const first=await until(()=>f.worker.control.pendingPause);
  assert.match(first.id,/^[\w-]{20,}$/);assert.equal(first.message,'Inspect form');
  assert.equal(f.worker.resumePause('not-the-current-id'),false);await delay(5);assert.equal(settled,false);
  assert.equal(f.worker.resumePause(first.id),true);await pending;assert.equal(settled,true);assert(!f.worker.control.pendingPause);
  assert.equal(f.worker.resumePause(first.id),false);
  const secondPending=f.worker.executeStep('pause',{message:'Inspect another form'}),second=await until(()=>f.worker.control.pendingPause);
  assert.notEqual(first.id,second.id);assert.equal(f.worker.resumePause(first.id),false);assert.equal(f.worker.control.pendingPause.id,second.id);
  assert.equal(f.worker.resumePause(second.id),true);await secondPending;
  assert.equal(f.events.filter(event=>event.type==='EXECUTION_PAUSED').length,2);assert.equal(f.events.filter(event=>event.type==='EXECUTION_RESUMED').length,2);
 });
});

test('abort releases an interactive pause and rejects later resume requests',async()=>{
 await withoutCI(async()=>{
  const f=fixture({ci:false}),pending=f.worker.executeStep('pause',{message:'Inspect form'});
  const rejection=assert.rejects(pending,/cancel|abort/i),pause=await until(()=>f.worker.control.pendingPause);
  f.worker.abort();await rejection;assert(!f.worker.control.pendingPause);assert.equal(f.worker.resumePause(pause.id),false);
  assert(f.events.some(event=>event.type==='EXECUTION_RESUMED'&&event.payload.cancelled===true));
 });
});


test('pause reports its exact scenario, step, line, profile and attempt without a browser mode change',async()=>{
 await withoutCI(async()=>{
  const f=fixture({ci:false}),s=scenario('flow.pause "Inspect form";\nflow.click "Continue";'),pausedStep=s.steps[0];
  const pending=f.worker.runScenario(s),pause=await until(()=>f.worker.control.pendingPause);
  assert.equal(pause.fileName,'batch2-worker.flow');assert.equal(pause.scenario,s.name);assert.equal(pause.stepId,pausedStep.id);assert.equal(pause.sourceLine,pausedStep.line);assert.equal(pause.profile,'default');assert.equal(pause.attempt,1);
  assert.equal(f.worker.config.headless,true);assert(!f.calls.some(row=>row[1]==='Continue'));
  assert.equal(f.worker.resumePause(pause.id),true);assert.equal(await pending,true);assert(f.calls.some(row=>row[1]==='Continue'));
 });
});


test('forged soft/optional AST fails the scenario without side effects or optional skipping',async()=>{
 for(const soft of [true,false,'true',null]) {
  const f=fixture();
  const result=await f.worker.runScenario({name:'Malformed soft flag',declarations:[],steps:[
   {id:'bad',line:7,blockDescription:'When "Malformed"',action:'click',payload:{selector:'Must not click',soft,optional:true}},
   {id:'later',line:8,blockDescription:'Then "Later"',action:'click',payload:{selector:'Must not continue'}},
  ]});
  assert.equal(result,false);assert.deepEqual(f.calls,[]);assert.deepEqual(updates(f.events).map(row=>row.status),['failed','not_tested']);assert.match(updates(f.events)[0].error,/soft/);
 }
});

for(const action of ['log','pause'])test(`${action} rejects overlong messages before creating an invisible pause/log`,async()=>{
 await withoutCI(async()=>{
  const f=fixture({ci:false}),message='x'.repeat(32768);
  await assert.rejects(f.worker.executeStep(action,{message:message+'x'}),/32768/);
  assert(!f.worker.control.pendingPause);assert.equal(f.events.filter(event=>['EXECUTION_PAUSED','LOG_EVENT'].includes(event.type)).length,0);
  if(action==='log')await f.worker.executeStep(action,{message});
  else {
   const pending=f.worker.executeStep(action,{message}),pause=await until(()=>f.worker.control.pendingPause);
   assert.equal(pause.message.length,32768);assert.equal(f.worker.resumePause(pause.id),true);await pending;
  }
 });
});


test('pause transport remains bounded after known-secret replacement expands its message',async()=>{
 await withoutCI(async()=>{
  const f=fixture({ci:false,machineToken:'abcd'}),pending=f.worker.executeStep('pause',{message:'abcd'.repeat(8192)});
  try{
   const pause=await until(()=>f.events.find(event=>event.type==='EXECUTION_PAUSED')?.payload);
   assert(pause.message.length<=32768);assert(!pause.message.includes('abcd'));assert.match(pause.message,/REDACTED/);
   assert.equal(f.worker.resumePause(pause.id),true);await pending;
   const resumed=f.events.find(event=>event.type==='EXECUTION_RESUMED').payload;
   assert.equal(resumed.id,pause.id);assert(resumed.message.length<=32768);assert(!resumed.message.includes('abcd'));
  }finally{f.worker.abort();await pending.catch(()=>{});}
 });
});

test('known-secret substrings cannot alter a trusted generated pause ID or block dashboard resume',async()=>{
 await withoutCI(async()=>{
  const crypto=require('node:crypto'),original=crypto.randomUUID,expected='12345678-1234-4123-8123-123456789abc';
  crypto.randomUUID=()=>expected;
  const f=fixture({ci:false,machineToken:'1234'}),pending=f.worker.executeStep('pause',{message:'Inspect form'});
  try{
   const pause=await until(()=>f.events.find(event=>event.type==='EXECUTION_PAUSED')?.payload);
   assert.equal(pause.id,expected);assert.equal(f.worker.control.pendingPause.id,expected);
   assert.equal(f.worker.resumePause(pause.id),true);await pending;
   assert.equal(f.events.find(event=>event.type==='EXECUTION_RESUMED').payload.id,expected);
  }finally{f.worker.abort();await pending.catch(()=>{});crypto.randomUUID=original;}
 });
});


for(const global of [false,true])for(const target of ['resBody','resHeader','cookie','nested'])test(`legacy ${target} extraction retains renamed-secret provenance; global=${global}`,async()=>{
 const suffix=target+(global?'Global':'Local'),token='opaque-legacy-fixture-'+suffix,alias='innocentAlias'+suffix;
 const bundle={displayName:'Reader',nested:{accessToken:token}};
 let state={status:200,body:{auth:{accessToken:token},bundle},headers:{'x-api-key':token,'set-cookie':[`session=${token}; HttpOnly`]},responseTime:1};
 const first=fixture();first.api.getState=()=>state;
 const original=target==='nested'?bundle:token;
 await first.worker.executeStep('extract',{target:target==='nested'?'resBody':target,jsonPath:target==='resBody'?'auth.accessToken':target==='resHeader'?'x-api-key':target==='cookie'?'session':'bundle',variableName:alias,isGlobal:global});
 const stored=(global?FlowWorker.globalVariables:first.worker.localVariables)[alias];assert.equal(stored,original);
 state={status:200,body:{replaced:true},headers:{},responseTime:1};
 const receiver=global?fixture():first,output=[],originalLog=console.log;receiver.worker.isSilent=false;
 // A harmless alias and later API state must not erase the value's secret provenance.
 receiver.worker.localVariables.innocentCopy=target==='nested'?stored.nested.accessToken:stored;
 console.log=(...args)=>output.push(args.join(' '));
 try{await receiver.worker.executeStep('log',receiver.worker.resolveStepPayload({message:'Stored result @innocentCopy'}));}
 finally{console.log=originalLog;if(global)delete FlowWorker.globalVariables[alias];}
 assert(output.length>0);assert(!output.join(' ').includes(token));assert.match(output.join(' '),/REDACTED/);
 const logs=receiver.events.filter(event=>event.type==='LOG_EVENT');assert(logs.length>0);assert(!JSON.stringify(logs).includes(token));assert.match(JSON.stringify(logs),/REDACTED/);
 assert.equal(stored,original);if(target==='nested')assert.equal(stored.nested.accessToken,token);
});

test('legacy provenance tracking tolerates 12000-level cyclic values without changing their reference',async()=>{
 const f=fixture(),root={},token='opaque-deep-legacy-fixture';let current=root;
 for(let index=0;index<12000;index++){current.child={};current=current.child;}
 current.accessToken=token;current.cycle=root;
 f.api.getState=()=>({status:200,body:{bundle:root},headers:{}});
 await f.worker.executeStep('extract',{target:'resBody',jsonPath:'bundle',variableName:'deepAlias'});
 assert.equal(f.worker.localVariables.deepAlias,root);assert.equal(current.cycle,root);assert.equal(current.accessToken,token);assert(f.worker.extractedSecretValues.has(token));
});

test('provenance metadata skips getters and revisits shared objects reached later through sensitive keys',async()=>{
 const f=fixture(),token='opaque-shared-legacy-fixture',shared={innocentValue:token};let getterCalls=0;
 // LIFO traversal sees the public path first, so the later sensitive path must revisit the shared value.
 const root={accessToken:shared,publicValue:shared};root.cycle=root;
 Object.defineProperty(root,'password',{enumerable:true,get(){getterCalls++;throw Error('Application getter must remain inert');}});
 f.api.getState=()=>({status:200,body:{bundle:root},headers:{}});
 await f.worker.executeStep('extract',{target:'resBody',jsonPath:'bundle',variableName:'sharedAlias'});
 assert.equal(getterCalls,0);assert.equal(f.worker.localVariables.sharedAlias,root);assert.equal(root.accessToken,shared);assert.equal(root.publicValue,shared);assert.equal(shared.innocentValue,token);assert(f.worker.extractedSecretValues.has(token));
 assert.equal(Object.getOwnPropertyDescriptor(root,'password').get!==undefined,true);
});


test('numeric OTP extraction keeps its integer value while hiding an innocuous alias in later logs',async()=>{
 const f=fixture(),otp=123456789;let state={status:200,body:{otp},headers:{}};
 f.api.getState=()=>state;
 await f.worker.executeStep('extract',{target:'resBody',jsonPath:'otp',variableName:'innocentNumeric'});
 assert.equal(typeof f.worker.localVariables.innocentNumeric,'number');assert.equal(f.worker.localVariables.innocentNumeric,otp);
 state={status:200,body:{replaced:true},headers:{}};
 const output=[],originalLog=console.log;f.worker.isSilent=false;console.log=(...args)=>output.push(args.join(' '));
 try{await f.worker.executeStep('log',f.worker.resolveStepPayload({message:'Result @innocentNumeric'}));}finally{console.log=originalLog;}
 assert(!output.join(' ').includes(String(otp)));assert.match(output.join(' '),/REDACTED/);
 assert(!JSON.stringify(f.events).includes(String(otp)));assert.match(JSON.stringify(f.events),/REDACTED/);
 assert.equal(typeof f.worker.localVariables.innocentNumeric,'number');assert.equal(f.worker.localVariables.innocentNumeric,otp);
});
