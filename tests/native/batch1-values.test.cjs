const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseDataPath,readDataPath,dataSnapshot}=require('../../dist/native/paths');
const {assertBrowser}=require('../../dist/native/assertions');
const {NativeEvents}=require('../../dist/native/events');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const {Parser}=require('../../dist/parser/parser');
const {Lexer}=require('../../dist/parser/lexer');

const parse=command=>new Parser(new Lexer(`Feature: Values\nScenario: Capture\nGiven "Ready"\nWhen "Capture"\n${command}\nThen "Checked"\nflow.expect status "200";`).tokenise()).parse()[0].scenarios[0];
for(const command of [
 'flow.extract property input "Email" "validity.typeMismatch" as "mismatch";',
 'flow.extract property input "Email" inside "Login form" "value" as global "saved";',
 'flow.extract network "orderResponse" "body.orders[0].id" as "id";',
])test(`extraction grammar retains its readable target/path: ${command}`,()=>{
 const step=parse(command).steps[0];assert.equal(step.action,'extract');assert.equal(step.payload.optional,false);assert.equal(step.payload.target,command.includes('extract network')?'network':'property');assert.equal(typeof step.payload.variableName,'string');
});

for(const path of ['__proto__.x','constructor.name','body.prototype','body.toString()','body["password"]','a..b','a;alert(1)','a.'+'b.'.repeat(33)+'c'])test(`unsafe paths fail closed: ${path}`,()=>assert.throws(()=>parseDataPath(path)));

test('property assertions reject browser-global paths before resolving a target', async () => {
 const browser = { locator: () => assert.fail('An invalid path must not look up a browser target') };
 await assert.rejects(assertBrowser(browser, {
  selector: '#customer-email', condition: 'property', property: 'ownerDocument.cookie', value: true,
 }, 1), /Browser property paths cannot access browser globals/);
});

test('a retry that runs out of time preserves the last property read error', async () => {
 let reads = 0;
 const locator = {
  count: async () => 1,
  evaluate: async () => {
   if (++reads === 1) throw new Error('Browser property paths cannot execute custom getters.');
   return new Promise(() => {});
  },
 };
 await assert.rejects(assertBrowser({ locator: () => locator }, {
  selector: '#customer-email', condition: 'property', property: 'unsafe', value: 'protected',
 }, 700), /cannot execute custom getters/);
 assert.equal(reads, 2);
});

test('network paths preserve typed false, zero, null, arrays/objects and header names as detached snapshots',()=>{
 const data={body:{flag:false,total:0,empty:null,items:[{id:12}],object:{enabled:true}},headers:{'content-type':'application/json'}};
 for(const [path,value] of [['body.flag',false],['body.total',0],['body.empty',null],['body.items[0].id',12],['headers.content-type','application/json']])assert.deepEqual(readDataPath(data,path),value);
 const copy=readDataPath(data,'body.object');copy.enabled=false;assert.equal(data.body.object.enabled,true);
 assert.equal(readDataPath({body:{location:'Lagos'}},'body.location'),'Lagos');
 assert.throws(()=>readDataPath(data,'body.missing'),/does not exist/);
 assert.throws(()=>readDataPath(data,'body.toString'),/plain data/);
});

test('snapshot reads never execute application getters or toJSON and reject non-JSON/unbounded values',()=>{
 let invoked=0;const getter={get secret(){invoked++;return 'private';}};
 assert.throws(()=>readDataPath({getter},'getter.secret'),/plain data/);
 assert.throws(()=>dataSnapshot(getter),/getters/);
 assert.throws(()=>dataSnapshot({toJSON(){invoked++;return 'private';}}),/JSON/);
 for(const value of [undefined,NaN,Infinity,1n,()=>0,new Date(),new Array(2),{large:'x'.repeat(1024*1024+1)}])assert.throws(()=>dataSnapshot(value));
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>dataSnapshot(cyclic));assert.equal(invoked,0);
});

test('named captured responses are isolated by profile, require wait completion and never expose the previous capture',()=>{
 const web={activeProfile:'customer'},events=new NativeEvents(web,{timeout:50});
 events.captured.set('customer:orderResponse',{body:{id:17}});
 assert.equal(events.extractNetwork('orderResponse','body.id'),17);
 web.activeProfile='administrator';assert.throws(()=>events.extractNetwork('orderResponse','body.id'),/No captured/);
 web.activeProfile='customer';events.events.set('customer:orderResponse',{});assert.throws(()=>events.extractNetwork('orderResponse','body.id'),/network.wait/);
 events.events.clear();events.captured.clear();assert.throws(()=>events.extractNetwork('orderResponse','body.id'),/No captured/);
});

function worker(){return new FlowWorker({ci:true,headless:true,timeout:50},{activeProfile:'customer'}, {}, {}, {}, {});}
test('new assertion fields retain exact variable types while ordinary text interpolation stays textual',()=>{
 const w=worker();w.localVariables={flag:false,total:12,items:[{id:1}]};
 for(const [key,value] of Object.entries(w.localVariables))assert.deepEqual(w.resolveStepPayload({pluginMethod:'assert.value',data:{actual:'@'+key,operator:'equals',expected:value}}).data.actual,value);
 assert.equal(w.resolveStepPayload({pluginMethod:'assert.that',data:{target:'Email',condition:'value',value:'Total @total'}}).data.value,'Total 12');
 assert.equal(w.resolveTemplateData('@total'),'12');
 assert.equal(w.resolveStepPayload({pluginMethod:'assert.that',data:{selector:'#total',condition:'value',value:'@total'}}).data.value,'12');
 assert.equal(w.resolveStepPayload({pluginMethod:'assert.that',data:{target:'Email',condition:'property',property:'validity.typeMismatch',value:'@flag'}}).data.value,false);
 assert.equal(w.resolveStepPayload({pluginMethod:'assert.that',data:{target:'Literal handle',condition:'text',value:'@someone'}}).data.value,'@someone');
 assert.throws(()=>w.resolveStepPayload({pluginMethod:'assert.value',data:{actual:'@missing',operator:'equals',expected:1}}),/undefined/);
 w.dataGen={resolve:value=>value==='@randomNumber'?'123':value};
 assert.equal(w.resolveStepPayload({pluginMethod:'assert.that',data:{target:'Count',condition:'value',value:'@randomNumber'}}).data.value,'123');
});

test('network extraction stores typed values, masks renamed secrets in diagnostics and does not modify direct API state',async()=>{
 const w=worker();w.native.events.captured.set('customer:result',{body:{total:12,accessToken:'fixture-private-access-token'}});
 await w.executeStep('extract',{target:'network',captureName:'result',jsonPath:'body.total',variableName:'total'});
 await w.executeStep('extract',{target:'network',captureName:'result',jsonPath:'body.accessToken',variableName:'innocentName'});
 assert.equal(w.localVariables.total,12);assert.equal(w.localVariables.innocentName,'fixture-private-access-token');
 const output=[];w.on('worker_event',event=>output.push(event));
 w.broadcast('STEP_UPDATE',{id:'x',fileName:'flow',status:'failed',error:'Observed '+w.localVariables.innocentName});
 assert(!JSON.stringify(output).includes('fixture-private-access-token'));assert.match(JSON.stringify(output),/REDACTED/);
 await assert.rejects(w.executeStep('extract',{target:'network',captureName:'result',jsonPath:'body.total',variableName:'__proto__'}),/safe variable/);
 assert.equal({}.polluted,undefined);
});

 test('new extraction keywords do not reserve existing plugin alias names',()=>{for(const alias of ['property','network']){const tokens=new Lexer(`let ${alias} = "plugin.cjs";`).tokenise();assert.equal(tokens.find(token=>token.value===alias).type,require('../../dist/parser/lexer').TokenType.IDENTIFIER);}});


test('property extraction waits for a delayed unique readable target and preserves false',async()=>{
 const w=worker();w.config.timeout=500;let attempts=0;
 w.web.resolvePropertyTarget=async()=>{attempts++;return {count:async()=>attempts<2?0:1,evaluate:async()=>false};};
 await w.executeStep('extract',{target:'property',selector:'Email',elementType:'input',property:'validity.typeMismatch',variableName:'mismatch'});
 assert(attempts>=2);assert.equal(w.localVariables.mismatch,false);
});

test('cancelling a property wait cannot store a late value',async()=>{
 const w=worker();w.config.timeout=500;
 w.web.resolvePropertyTarget=async()=>({count:async()=>0,evaluate:async()=>true});
 const timer=setTimeout(()=>w.isAborted=true,20);
 try{await assert.rejects(w.executeStep('extract',{target:'property',selector:'Email',property:'value',variableName:'late'}),/cancelled/);assert(!Object.hasOwn(w.localVariables,'late'));}finally{clearTimeout(timer);}
});

test('global extraction secret aliases stay redacted when a later worker reuses the value',async()=>{
 const first=worker();first.native.events.captured.set('customer:secrets',{body:{accessToken:'fixture-global-private-token'}});
 await first.executeStep('extract',{target:'network',captureName:'secrets',jsonPath:'body.accessToken',variableName:'globalAlias',isGlobal:true});
 const second=worker(),events=[];second.on('worker_event',event=>events.push(event));
 const value=second.resolveStepPayload({pluginMethod:'assert.value',data:{actual:'@global[globalAlias]',operator:'equals',expected:'other'}}).data.actual;
 second.broadcast('STEP_UPDATE',{id:'x',fileName:'x',status:'failed',error:'Observed '+value});assert(!JSON.stringify(events).includes('fixture-global-private-token'));assert.match(JSON.stringify(events),/REDACTED/);
});
