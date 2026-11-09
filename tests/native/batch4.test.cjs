const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Parser}=require('../../dist/parser/parser'),{Lexer}=require('../../dist/parser/lexer');
const {NativeBrowsing}=require('../../dist/native/browsing');
const {commandSecrets,runtimeFailure}=require('../../dist/reporting/runtime_failure');
const {redactWorkerPayload}=require('../../dist/security/redaction');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const {nativeStepTimeout}=require('../../dist/native/deadline');
const code=command=>`Feature: Tabs frames and dialogs\nScenario: Test\nGiven "Ready"\nWhen "Act"\n${command}\nThen "Done"\nflow.expect visible "Done";`;
const parse=source=>new Parser(new Lexer(source).tokenise()).parse();
const actions=['flow.tab.name {"name":"main"};','flow.tab.arm {"name":"receipt","timeout":1000};','flow.tab.use {"name":"receipt"};','flow.tab.close {"name":"receipt"};','flow.frame.use {"target":{"text":"Profile details","element":"iframe","inside":"Account"}};','flow.frame.main {};','flow.dialog.arm {"name":"rename","action":"accept","promptText":"Updated name"};'];
for(const command of [...actions,'flow.dialog.expect {"name":"rename","type":"prompt","message":"Enter name"};','flow.soft dialog.expect {"name":"rename","contains":"name"};'])test('Batch4 grammar: '+command,()=>assert(parse(code(command))));
test('new commands preserve the terminal Then, unique Feature, required blocks and assertion-only And',()=>{
 for(const command of actions){
  assert.throws(()=>parse(code('').replace('Then "Done"',`And "Action forbidden"\n${command}\nThen "Done"`)),/And blocks/);
  assert.throws(()=>parse(code('')+'\nWhen "After"\n'+command));
 }
 assert(parse(code('').replace('Then "Done"','And "Dialog assertion"\nflow.dialog.expect {"name":"rename","type":"prompt"};\nThen "Done"')));
 for(const block of ['And "After"\nflow.dialog.expect {"name":"rename","type":"prompt"};','Then "After"\nflow.expect visible "Done";','Feature: Second'])assert.throws(()=>parse(code('')+'\n'+block));
 assert.equal(parse(code('')+'\nScenario: Second\nGiven "Ready"\nWhen "Act"\nflow.frame.main {};\nThen "Done"\nflow.expect visible "Done";')[0].scenarios.length,2);
 assert.throws(()=>parse('Feature: Missing\nScenario: Missing\nWhen "No Given"\nflow.frame.main {};\nThen "Done"\nflow.expect visible "Done";'));
});
function fixture(){
 const page=new EventEmitter(),other=new EventEmitter(),names=new Map(),calls=[];page.isClosed=other.isClosed=()=>false;
 let profile='default',current=page,cancelled=false;
 const web={get activeProfile(){return profile},getPage:()=>current,hasNamedPage:n=>names.has(profile+':'+n),namePage:(n,p)=>{if(names.has(profile+':'+n))throw Error('duplicate');names.set(profile+':'+n,p);},useNamedPage:async n=>{if(!names.has(profile+':'+n))throw Error('Unknown tab');current=names.get(profile+':'+n);calls.push('use');},closeNamedPage:async n=>{names.delete(profile+':'+n);calls.push('close');},useFrameScope:async(data,check)=>{check();calls.push(['frame',data]);},mainFrameScope:()=>calls.push('main')};
 const native=new NativeBrowsing(web,{timeout:40},{delay:async()=>{},cancelled:()=>cancelled});
 return {web,page,other,calls,names,native,profile:value=>{profile=value},current:()=>current,cancel:()=>{cancelled=true}};
}
for(const [area,action,input]of [
 ['tab','arm',{name:'../bad'}],['tab','arm',{name:'ok',timeout:0}],['tab','use',{name:'ok',code:'alert(1)'}],
 ['frame','use',{}],['frame','use',{target:'Profile',selector:'iframe'}],['frame','use',{target:{text:'Profile',near:'A',under:'B'}}],['frame','use',{selector:'iframe',timeout:0}],['frame','main',{target:'ignored'}],
 ['dialog','arm',{name:'rename',action:'reject'}],['dialog','arm',{name:'rename',action:'dismiss',promptText:'must-not-use'}],['dialog','arm',{name:'rename',action:'accept',timeout:-1}],['dialog','expect',{name:'rename'}],['dialog','expect',{name:'rename',type:'script'}],
])test('Batch4 strict payload rejects before browser changes '+JSON.stringify([area,action,input]),async()=>{const f=fixture();try{await assert.rejects(f.native[area](action,input));assert.deepEqual(f.calls,[]);assert.equal(f.page.listenerCount('popup'),0);}finally{f.native.dispose();}});
test('data-only payloads reject getters, inherited fields and prototype pollution without executing them',async()=>{
 const f=fixture();let reads=0;
 try{for(const input of [{get name(){reads++;return 'main'}},Object.assign(Object.create({name:'main'}),{}),JSON.parse('{"name":"main","__proto__":{"polluted":true}}')])await assert.rejects(f.native.tab('name',input));assert.equal(reads,0);assert.equal({}.polluted,undefined);assert.equal(f.names.size,0);}finally{f.native.dispose();}
});
test('popup capture precedes the click, retains the exact page and detaches listeners',async()=>{
 const f=fixture();try{
 await f.native.tab('name',{name:'main'});await f.native.tab('arm',{name:'receipt'});assert.equal(f.page.listenerCount('popup'),1);
 f.page.emit('popup',f.other);assert.equal(f.page.listenerCount('popup'),0);await f.native.tab('use',{name:'receipt'});assert.equal(f.current(),f.other);
 await f.native.tab('use',{name:'main'});assert.equal(f.current(),f.page);await f.native.tab('close',{name:'receipt'});
 }finally{f.native.dispose();}
});
test('duplicate names, profile separation, timeout and opener closure fail explicitly without unhandled rejections',async()=>{
 const f=fixture();try{
 await f.native.tab('arm',{name:'main',timeout:10});await assert.rejects(f.native.tab('arm',{name:'main'}),/already exists/);
 f.profile('admin');await assert.rejects(f.native.tab('use',{name:'main'}),/Unknown/);f.profile('default');
 await new Promise(r=>setTimeout(r,20));assert.equal(f.page.listenerCount('popup'),0);await assert.rejects(f.native.tab('use',{name:'main'}),/main.*timed out/);
 await f.native.tab('arm',{name:'closed'});f.page.emit('close');await assert.rejects(f.native.tab('use',{name:'closed'}),/opener closed/);
 }finally{f.native.dispose();}
});
test('cancellation and cleanup prevent late tab use and detach popup listeners',async()=>{
 const f=fixture();await f.native.tab('arm',{name:'later'});const pending=f.native.tab('use',{name:'later'});f.native.dispose();await assert.rejects(pending,/cancelled/);assert.equal(f.page.listenerCount('popup'),0);assert.deepEqual(f.calls,[]);
 f.cancel();await assert.rejects(f.native.frame('main',{}),/cancelled/);assert.deepEqual(f.calls,[]);
});
test('a longer capture timeout cannot switch tabs after the per-command deadline',async()=>{
 const f=fixture();try{
 await f.native.tab('arm',{name:'late',timeout:500});await assert.rejects(f.native.tab('use',{name:'late'}),/timed out after 40 ms/);
 assert.equal(f.page.listenerCount('popup'),0);f.page.emit('popup',f.other);assert.equal(f.current(),f.page);assert.deepEqual(f.calls,[]);
 }finally{f.native.dispose();}
});
function dialog(f,type='prompt',message='Enter name',defaultValue='original'){const calls=[];return {calls,page:()=>f.page,type:()=>type,message:()=>message,defaultValue:()=>defaultValue,accept:async value=>calls.push(['accept',value]),dismiss:async()=>calls.push(['dismiss'])};}
test('dialog capture responds once, retains legacy fallback for others, and reports individual checks',async()=>{
 const f=fixture();try{
 await f.native.dialog('arm',{name:'rename',action:'accept',promptText:'Updated'});const d=dialog(f);
 assert.equal(await f.web.nativeDialogObserver(d),true);assert.deepEqual(d.calls,[['accept','Updated']]);
 let result;await f.native.dialog('expect',{name:'rename',type:'prompt',message:'Enter name',defaultValue:'original'},value=>result=value);
 assert.equal(result.status,'passed');assert.equal(result.checks.length,4);assert(!JSON.stringify(result).includes('original'));assert(!JSON.stringify(result).includes('Updated'));
 assert.equal(await f.web.nativeDialogObserver(dialog(f)),false);
 }finally{f.native.dispose();}
});
test('dialog mismatches and missing events show precise expected/actual causes',async()=>{
 const f=fixture();try{
 await f.native.dialog('arm',{name:'wrong',action:'dismiss'});const d=dialog(f,'confirm','Delete this record?');await f.web.nativeDialogObserver(d);assert.deepEqual(d.calls,[['dismiss']]);
 let result;await assert.rejects(f.native.dialog('expect',{name:'wrong',type:'prompt',message:'Different'},value=>result=value));assert.equal(result.status,'failed');assert.equal(result.checks.find(c=>c.key==='capture').status,'passed');assert.equal(result.checks.find(c=>c.key==='type').actual,'confirm');assert.equal(result.checks.find(c=>c.key==='message').actual,'Delete this record?');
 await f.native.dialog('arm',{name:'absent',action:'accept',timeout:5});await new Promise(r=>setTimeout(r,10));await assert.rejects(f.native.dialog('expect',{name:'absent',type:'alert'},value=>result=value));assert.match(result.checks[0].reason,/timed out/);
 }finally{f.native.dispose();}
});
test('prompt responses never go to non-prompt dialogs and pending handlers remain page/profile-owned',async()=>{
 const f=fixture();try{
 await f.native.dialog('arm',{name:'rename',action:'accept',promptText:'private'});await assert.rejects(f.native.dialog('arm',{name:'second',action:'dismiss'}),/already.*armed/);
 const foreign=dialog(f);foreign.page=()=>f.other;assert.equal(await f.web.nativeDialogObserver(foreign),false);
 const d=dialog(f,'alert');await f.web.nativeDialogObserver(d);assert.deepEqual(d.calls,[['dismiss']]);let result;await assert.rejects(f.native.dialog('expect',{name:'rename',type:'prompt'},v=>result=v));assert.match(result.checks[0].reason,/promptText requires a prompt/);assert(!JSON.stringify(result).includes('private'));
 }finally{f.native.dispose();}
});
test('profile cleanup and disposal cancel pending dialogs without unhandled rejections',async()=>{
 const f=fixture();await f.native.dialog('arm',{name:'one',action:'accept',promptText:'private'});f.native.disposeProfile('default');assert.equal(f.page.listenerCount('close'),0);assert.equal(await f.web.nativeDialogObserver(dialog(f)),false);f.native.dispose();
});
test('prompt input is masked at the worker transport and failure boundaries, including nested JSON',()=>{
 const secret='prompt-literal-keep-private',payload={pluginMethod:'dialog.arm',data:{name:'rename',action:'accept',promptText:secret}};
 assert(commandSecrets('native',payload).includes(secret));assert(!runtimeFailure('flow.dialog.arm',payload,Error(secret),{file:'dialogs.flow',line:5}).includes(secret));
 assert(!JSON.stringify(redactWorkerPayload('FILE_LOADED',{steps:[{payload}],nested:JSON.stringify(payload)},[])).includes(secret));
 assert.equal(redactWorkerPayload('X',{emailVerified:true},[]).emailVerified,true);
});
test('frame.use honors its explicit deadline and actions cannot be soft',async()=>{
 assert.equal(nativeStepTimeout('frame.use',{timeout:100},10),100);assert.throws(()=>nativeStepTimeout('frame.use',{timeout:0},10));assert.equal(FlowWorker.nativeBrowsingProtocol,1);
 for(const command of actions)assert.throws(()=>parse(code(command.replace('flow.','flow.soft '))));
});
test('UA lifecycle owns the pinned plugin CDP promise, tolerates actual closure, and preserves active-page failures',async()=>{
 const {settleUserAgentOverride}=require('../../dist/adapters/web/plugin_lifecycle');
 const fixture=(closed,error)=>{let calls=0;const page={isClosed:()=>closed,_client:()=>({send:async()=>{calls++;await Promise.resolve();if(error)throw Error(error);return {accepted:true};}})};const plugin={name:'stealth/evasions/user-agent-override',async onPageCreated(page){page._client().send('Network.setUserAgentOverride',{userAgent:'same-agent'});}};settleUserAgentOverride(plugin);const wrapped=plugin.onPageCreated;settleUserAgentOverride(plugin);assert.equal(plugin.onPageCreated,wrapped);return{page,plugin,calls:()=>calls};};
 const success=fixture(false);await success.plugin.onPageCreated(success.page);assert.equal(success.calls(),1);
 const closed=fixture(true,'Target page, context or browser has been closed');await closed.plugin.onPageCreated(closed.page);assert.equal(closed.calls(),1);
 const failed=fixture(false,'Active page protocol failure');await assert.rejects(failed.plugin.onPageCreated(failed.page),/Active page protocol failure/);
 const other={name:'another-plugin',onPageCreated:()=>{}};const original=other.onPageCreated;settleUserAgentOverride(other);assert.equal(other.onPageCreated,original);
});

test('the shared iframe qualifier requires the browsing protocol, while legacy targets keep their existing handoff',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{needsNativeBrowsingProtocol}=require('../../dist/native/compatibility');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-batch4-protocol-')),file=path.join(dir,'check.flow');
 try{for(const [command,expected]of [
  ['flow.assert.that {"target":{"text":"Profile details","element":"iframe"},"condition":"visible"};',true],
  ['flow.scroll {"target":{"text":"Profile details","element":"iframe"}};',true],
  ['flow.assert.that {"selector":"iframe","condition":"visible"};',false],
  ['flow.assert.that {"target":{"text":"Save","element":"button"},"condition":"enabled"};',false],
  ['flow.click button "Save";',false],
 ]){fs.writeFileSync(file,code(command));assert.equal(needsNativeBrowsingProtocol(file,{projectRoot:dir}),expected,command);}}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
