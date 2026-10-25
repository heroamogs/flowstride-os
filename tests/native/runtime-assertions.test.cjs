const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Parser}=require('../../dist/parser/parser');
const {Lexer}=require('../../dist/parser/lexer');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const {nativeStepTimeout}=require('../../dist/native/deadline');

function parse(command){return new Parser(new Lexer(`Feature: Runtime contracts\nScenario: Verification\nGiven "Context"\nWhen "Action"\n${command}\nThen "Checked"\nflow.expect status "200";`).tokenise()).parse()[0].scenarios[0].steps[0];}
function worker(body={value:'same'}){return new FlowWorker({ci:true,timeout:100}, {}, {getState:()=>({status:200,headers:{},body,responseTime:5})}, {}, {}, {});}

for(const modifier of ['reqBody','reqHeader','contains','session'])test(`parser rejects unsupported expectation modifier ${modifier}`,()=>{
  assert.throws(()=>parse(`flow.expect ${modifier};`),/Unsupported flow.expect modifier/);
});
for(const type of ['reqBody','unknown',null,undefined])test(`worker rejects an invalid external expectation payload: ${type}`,async()=>{
  await assert.rejects(worker().executeStep('expect',{type}),/Unsupported flow.expect modifier/);
});
for(const assertions of [[],undefined,[{condition:'typo',value:'same'}],[{condition:'equals'}]])test(`API assertions fail closed for invalid conditions ${JSON.stringify(assertions)}`,async()=>{
  await assert.rejects(worker().executeStep('expect',{type:'resBody',jsonPath:'value',assertions}),/assertion.*(requires|condition)/i);
});
for(const operator of ['to.not.be','is.not'])test(`${operator} rejects equal literals and accepts different values`,async()=>{
  const equal=parse(`flow.expect resBody "value" ${operator} "same";`);
  await assert.rejects(worker().executeStep(equal.action,equal.payload),/not to equal/);
  const different=parse(`flow.expect resBody "value" ${operator} "different";`);
  await worker().executeStep(different.action,different.payload);
  const empty=parse(`flow.expect resBody "value" ${operator} "";`);
  await assert.rejects(worker({value:''}).executeStep(empty.action,empty.payload),/not to equal/);
  await worker({value:'SAME'}).executeStep(equal.action,equal.payload);
});
for(const operator of ['is','to.be','is.not','to.not.be'])test(`${operator} preserves existing named-type comparisons`,async()=>{
  const type=parse(`flow.expect resBody "value" ${operator} "number";`);
  const negated=operator.includes('not');
  const pass=worker({value:negated?'text':12});await pass.executeStep(type.action,type.payload);
  await assert.rejects(worker({value:negated?12:'text'}).executeStep(type.action,type.payload),/type/);
});
test('supported chained API checks still execute and a later failing condition fails the step',async()=>{
  const success=parse('flow.expect resBody "value" type.of "string" includes "am" length "4";');
  await worker().executeStep(success.action,success.payload);
  const failure=parse('flow.expect resBody "value" type.of "string" includes "missing";');
  await assert.rejects(worker().executeStep(failure.action,failure.payload),/inclusion/);
});
test('response-time thresholds reject invalid literals and resolved values',async()=>{
  for(const threshold of ['',' ','not-a-number','100ms','NaN','Infinity','-Infinity','-1']){
    assert.throws(()=>parse(`flow.expect responseTime lessThan "${threshold}";`),/threshold.*finite nonnegative number/);
  }
  for(const threshold of [undefined,null,'',' ','not-a-number','100ms',NaN,Infinity,-Infinity,-1,false,[],{}]){
    await assert.rejects(worker().executeStep('expect',{type:'responseTime',threshold}),/threshold.*finite nonnegative number/);
  }
});
test('response-time checks preserve numeric templates and the inclusive threshold boundary',async()=>{
  for(const threshold of ['{{env.RESPONSE_LIMIT}}','@responseLimit','@global[responseLimit]','$randomInt']){
    assert.equal(parse(`flow.expect responseTime lessThan "${threshold}";`).payload.threshold,threshold);
  }
  for(const threshold of ['5',5,'5.5','10']){
    await worker().executeStep('expect',{type:'responseTime',threshold});
  }
  await assert.rejects(worker().executeStep('expect',{type:'responseTime',threshold:'4.9'}),/response time/);
  const w=worker();w.localVariables.responseLimit='5';
  const valid=w.resolveTemplateData(parse('flow.expect responseTime lessThan "@responseLimit";').payload);
  await w.executeStep('expect',valid);
  w.localVariables.responseLimit='invalid';
  const invalid=w.resolveTemplateData(parse('flow.expect responseTime lessThan "@responseLimit";').payload);
  await assert.rejects(w.executeStep('expect',invalid),/threshold.*finite nonnegative number/);
});
test('a rejected required assertion fails the scenario and leaves later work untested',async()=>{
  const w=worker();w.captureStepContext=async()=>({});const events=[];w.on('worker_event',event=>events.push(event));
  await w.runScenario({name:'Required check',declarations:[],steps:[{id:'bad',action:'expect',payload:{type:'reqBody'},blockDescription:'Then "Unsupported check"'},{id:'later',action:'expect',payload:{type:'status',statusCode:'200'},blockDescription:'Then "Later check"'}]});
  assert(events.some(event=>event.type==='STEP_UPDATE'&&event.payload.id==='bad'&&event.payload.status==='failed'));
  assert(events.some(event=>event.type==='STEP_UPDATE'&&event.payload.id==='later'&&event.payload.status==='not_tested'));
});
test('only supported native timeout fields override the outer deadline',()=>{
  for(const command of ['assert.that','a11y.match','a11y.snapshot','stub.expect']){
    assert.equal(nativeStepTimeout(command,{timeout:900},100),900);
    assert.equal(nativeStepTimeout(command,{timeout:40},100),40);
    assert.equal(nativeStepTimeout(command,{},100),100);
    for(const timeout of [0,-1,NaN,Infinity,2147483648,'900',false,null])assert.throws(()=>nativeStepTimeout(command,{timeout},100));
  }
  assert.equal(nativeStepTimeout('browser.offline',{timeout:900},100),100);
  assert.equal(nativeStepTimeout('unknown.action',{timeout:900},100),100);
});
test('worker observes the explicit native assertion deadline rather than the global default',async()=>{
  const w=worker();let finished=false;w.native={execute:async()=>{await new Promise(resolve=>setTimeout(resolve,75));finished=true;}};
  w.config.timeout=25;
  await w.executeStep('native',{pluginMethod:'assert.that',data:{timeout:250}});
  assert.equal(finished,true);
  await assert.rejects(w.executeStep('native',{pluginMethod:'assert.that',data:{timeout:10}}),/exceeded/);
});
test('worker observes explicit function-spy expectation timeouts',async()=>{
  const w=worker();w.config.timeout=25;
  w.native={execute:()=>new Promise(resolve=>setTimeout(resolve,75))};
  await w.executeStep('native',{pluginMethod:'stub.expect',data:{name:'delayed',minCount:1,timeout:250}});
  await assert.rejects(w.executeStep('native',{pluginMethod:'stub.expect',data:{name:'delayed',minCount:1,timeout:10}}),/exceeded/);
});
test('timed-out native work has its late rejection safely observed',async()=>{
  const w=worker(),unhandled=[];const listener=error=>unhandled.push(error);process.on('unhandledRejection',listener);
  try{
    w.native={execute:()=>new Promise((_resolve,reject)=>setTimeout(()=>reject(Error('late native failure')),50))};
    await assert.rejects(w.executeStep('native',{pluginMethod:'assert.that',data:{timeout:5}}),/exceeded/);
    await new Promise(resolve=>setTimeout(resolve,80));assert.deepEqual(unhandled,[]);
  }finally{process.off('unhandledRejection',listener);}
});
