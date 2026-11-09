const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Parser}=require('../../dist/parser/parser');
const {Lexer,TokenType}=require('../../dist/parser/lexer');
const {NativeInteractions,validateKey}=require('../../dist/native/interactions');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const {commandSecrets,runtimeFailure}=require('../../dist/reporting/runtime_failure');
const source=command=>`Feature: Interactions\nScenario: Check\nGiven "Ready"\nWhen "Interact"\n${command}\nThen "Done"\nflow.expect visible "Ready";`;
const parse=command=>new Parser(new Lexer(source(command)).tokenise()).parse()[0].scenarios[0].steps;
for(const command of ['flow.press "Enter" on input "Search";','flow.press "ControlOrMeta+A" on input "Email" inside "Login form";','flow.clear input "Email";','flow.focus input "Email";','flow.blur input "Email";','flow.doubleClick button "Invoice" under "Orders";','flow.rightClick "Invoice" inside "Recent orders";','flow.goBack;','flow.goForward;','flow.reload;','flow.scroll {"y":600};','flow.scroll {"target":"Customer records","y":600};','flow.input.type {"target":{"text":"Search","element":"input"},"text":"Lagos","clear":false,"delay":100,"blur":false};'])test('new grammar: '+command,()=>assert(parse(command).length>=2));
for(const command of ['flow.press "Enter" input "Search";','flow.press "Enter" from input "Search";','flow.press "NotAKey" on input "Search";','flow.clear;','flow.focus;','flow.doubleClick;','flow.scroll "down";','flow.goBack "unexpected";','flow.soft clear input "Email";','flow.soft input.type {"target":"Email","text":"data"};'])test('malformed action is rejected: '+command,()=>assert.throws(()=>parse(command)));
for(const key of ['Enter','Tab','Shift+Tab','ControlOrMeta+A','Control+Shift+ArrowLeft','Alt+ArrowDown','+','Control++','KeyA','Digit5','NumpadEnter','F12',' ','.'])test('supported key '+JSON.stringify(key),()=>assert.equal(validateKey(key),key));
for(const key of ['','Ctrl+A','Control+Control+A','Control+','Enter;process.exit()','Enter\nTab','\x1b[2J','Unknown','🙂',null,{},[],true])test('invalid key fails closed '+JSON.stringify(key),()=>assert.throws(()=>validateKey(key)));
for(const command of ['flow.clear input "Email";','flow.press "Enter" on input "Email";','flow.scroll {"y":3};','flow.input.type {"target":"Email","text":"hello"};','flow.reload;'])test('new actions do not weaken And or terminal Then: '+command,()=>{
 assert.throws(()=>new Parser(new Lexer(source('flow.click "Continue";').replace('Then "Done"',`And "Not an assertion"\n${command}\nThen "Done"`)).tokenise()).parse(),/And blocks/);
 for(const block of ['And "After"\nflow.expect visible "Ready";','When "After"\n'+command,'Then "Again"\nflow.expect visible "Ready";','Feature: Another'])assert.throws(()=>new Parser(new Lexer(source(command)+'\n'+block).tokenise()).parse());
});
test('Feature stays unique/top-level, next Scenario remains valid and try stays optional',()=>{
 const normal=source('flow.try clear input "Optional";');const steps=new Parser(new Lexer(normal).tokenise()).parse()[0].scenarios[0].steps;assert.equal(steps[0].payload.optional,true);
 const next='\nScenario: Next\nGiven "Ready"\nWhen "Next"\nflow.focus input "Email";\nThen "Done"\nflow.expect visible "Ready";';assert.equal(new Parser(new Lexer(normal+next).tokenise()).parse()[0].scenarios.length,2);
 assert.throws(()=>new Parser(new Lexer(normal+'\nFeature: Duplicate').tokenise()).parse());
 for(const alias of ['press','clear','focus','blur','doubleClick','rightClick','goBack','goForward','reload','scroll','on'])assert.equal(new Lexer(`let ${alias} = "plugin.cjs";`).tokenise().find(t=>t.value===alias).type,TokenType.IDENTIFIER);
});
test('new readable target retains element and combined inside/spatial context',()=>{
 const step=parse('flow.press "Enter" on input "Email" inside "Login form" under "Password";')[0];assert.deepEqual(step.payload.readableTarget,{text:'Email',element:'input',inside:'Login form',under:'Password'});
 assert.throws(()=>parse('flow.clear input "Email" inside "One" inside "Two";'),/repeat/);
});
function fixture(){const calls=[];const loc={filter(){return this},count:async()=>1,isEnabled:async()=>true,focus:async()=>calls.push('focus'),evaluate:async()=>true,press:async key=>calls.push(['press',key]),fill:async value=>calls.push(['fill',value]),blur:async()=>calls.push('blur'),dblclick:async()=>calls.push('double'),click:async options=>calls.push(['click',options.button]),isEditable:async()=>true,pressSequentially:async text=>calls.push(['typed',text])};const page={keyboard:{up:async key=>calls.push(['up',key])},goBack:async()=>calls.push('back'),goForward:async()=>calls.push('forward'),reload:async()=>calls.push('reload'),evaluate:async()=>calls.push('page-scroll')};const web={resolveInteractionTarget:async()=>loc,resolveAssertionTarget:async()=>loc,getPage:()=>page};return {calls,loc,web,runtime:new NativeInteractions(web,{timeout:200})};}
test('simple actions dispatch real focus/keyboard/input/mouse/navigation methods without first()',async()=>{
 const f=fixture();for(const action of ['press','clear','focus','doubleClick','rightClick'])await f.runtime.simple(action,{selector:'Email',...(action==='press'?{key:'Enter'}:{})});
 f.loc.evaluate=async()=>false;await f.runtime.simple('blur',{selector:'Email'});
 for(const action of ['goBack','goForward','reload'])await f.runtime.simple(action,{});
 assert(f.calls.some(item=>item[0]==='press'&&item[1]==='Enter'));assert(f.calls.some(item=>item[0]==='click'&&item[1]==='right'));assert(f.calls.includes('double'));assert(f.calls.includes('back'));
});
test('invalid keys, duplicate matches and disabled/nonfocusable targets cannot receive input',async()=>{
 const f=fixture();await assert.rejects(f.runtime.simple('press',{selector:'Email',key:'Fake+Key'}));assert.deepEqual(f.calls,[]);
 f.loc.count=async()=>2;await assert.rejects(f.runtime.simple('clear',{selector:'Email'}),/Ambiguous.*2 visible matches/);assert.deepEqual(f.calls,[]);
 f.loc.count=async()=>1;f.loc.isEnabled=async()=>false;await assert.rejects(f.runtime.simple('press',{selector:'Email',key:'A'}),/disabled/);assert.deepEqual(f.calls,[]);
 f.loc.isEnabled=async()=>true;f.loc.evaluate=async()=>false;await assert.rejects(f.runtime.simple('press',{selector:'Email',key:'A'}),/did not receive focus/);assert(!f.calls.some(item=>item[0]==='press'));
});
test('a failed shortcut releases every requested modifier',async()=>{const f=fixture();f.loc.press=async()=>{throw Error('Page closed');};await assert.rejects(f.runtime.simple('press',{selector:'Email',key:'Control+Shift+Enter'}),/closed/);assert(f.calls.some(c=>c[0]==='up'&&c[1]==='Control'));assert(f.calls.some(c=>c[0]==='up'&&c[1]==='Shift'));});
for(const input of [{target:'Email',selector:'#email',text:'data'},{target:'Email',text:'data',clear:'false'},{target:'Email',text:'data',delay:-1},{target:'Email',text:'data',delay:60001},{target:'Email',text:'data',delay:1.2},{target:'Email',text:'data',delay:'5'},{target:'Email',text:'data',timeout:0},{target:'Email',text:'data',force:true},{target:'Email',text:'x'.repeat(100001)}])test('unsafe typing options fail before side effects '+Object.keys(input).join(','),async()=>{const f=fixture();await assert.rejects(f.runtime.type(input));assert.deepEqual(f.calls,[]);});
for(const input of [{},{x:'10'},{y:Infinity},{y:1.5},{y:1000001},{target:'One',selector:'#one',y:1},{target:'One',y:1,script:'alert(1)'},{target:{text:'One',under:'Two',above:'Three'},y:1}])test('unsafe scroll options fail before side effects '+JSON.stringify(input),async()=>{const f=fixture();await assert.rejects(f.runtime.scroll(input));assert.deepEqual(f.calls,[]);});
test('configurable typing defaults clear, delay and blur; append preserves content and options',async()=>{
 const f=fixture(),delays=[];f.runtime=new NativeInteractions(f.web,{timeout:200},{delay:async ms=>delays.push(ms),cancelled:()=>false});
 await f.runtime.type({target:'Email',text:'abc'});assert(f.calls.some(c=>c[0]==='fill'&&c[1]===''));assert(f.calls.includes('blur'));assert.deepEqual(delays,[30,30]);
 f.calls.length=0;delays.length=0;await f.runtime.type({target:'Email',text:'🙂é',clear:false,delay:0,blur:false});assert(!f.calls.some(c=>c[0]==='fill'));assert(!f.calls.includes('blur'));assert.deepEqual(f.calls.filter(c=>c[0]==='typed').map(c=>c[1]),['🙂','é']);assert.deepEqual(delays,[]);
});
test('cancellation and deadlines stop typing and scrolling before more side effects',async()=>{
 const f=fixture();let aborted=true;f.runtime=new NativeInteractions(f.web,{timeout:100},{delay:async()=>{},cancelled:()=>aborted});
 await assert.rejects(f.runtime.scroll({y:30}),/cancel/);await assert.rejects(f.runtime.type({target:'Email',text:'data'}),/cancel/);assert.deepEqual(f.calls,[]);
 aborted=false;f.runtime=new NativeInteractions(f.web,{timeout:10},{delay:async ms=>{await new Promise(r=>setTimeout(r,ms));},cancelled:()=>false});await assert.rejects(f.runtime.type({target:'Email',text:'abcdef',delay:50}),/timed out/);const count=f.calls.filter(c=>c[0]==='typed').length;await new Promise(r=>setTimeout(r,30));assert.equal(f.calls.filter(c=>c[0]==='typed').length,count);assert(count<6);
});
test('data-only interaction payloads reject getters, custom prototypes and malicious JSON fields',async()=>{
 const f=fixture();let read=0;const getter={target:'Email',get text(){read++;return 'secret';}};
 for(const data of [getter,Object.assign(Object.create({target:'Email'}),{text:'data'}),JSON.parse('{"target":"Email","text":"data","__proto__":{"polluted":true}}')])await assert.rejects(f.runtime.type(data));
 assert.equal(read,0);assert.equal({}.polluted,undefined);assert.deepEqual(f.calls,[]);
});
test('new typing errors never report the supplied text and keep the readable target',()=>{
 const secret='fixture-literal-private-password';const payload={pluginMethod:'input.type',data:{target:{text:'Password',element:'input'},text:secret}};
 assert(commandSecrets('native',payload).includes(secret));const failure=runtimeFailure('flow.input.type',payload,Error('Typing failed for '+secret),{file:'login.flow',line:10});assert(!failure.includes(secret));assert.match(failure,/Password/);assert.match(failure,/login.flow:10/);
});
test('new actions participate in pacing and cannot be made soft',async()=>{
 const worker=new FlowWorker({ci:true,timeout:50},{},{},{},{},{}),calls=[];worker.native.interactions.simple=async(action)=>calls.push(action);worker.native.interactions.scroll=async()=>calls.push('scroll');worker.native.execute=async()=>{};worker.control.delay=async value=>calls.push(value);worker.paceMilliseconds=5;
 for(const action of ['press','clear','focus','blur','doubleClick','rightClick','goBack','goForward','reload','scroll'])await worker.executeStep(action,{selector:'Email',key:'Enter',data:{y:1}});
 await worker.executeStep('native',{pluginMethod:'input.type',data:{target:'Email',text:'one'}});assert.equal(calls.filter(c=>c===5).length,11);
 await assert.rejects(worker.executeStep('clear',{selector:'Email',soft:true}),/soft/);assert.equal(FlowWorker.nativeInteractionProtocol,1);
});

test('configurable typing uses its explicit native deadline instead of the shorter global timeout',async()=>{
 const worker=new FlowWorker({ci:true,timeout:15},{},{},{},{},{});worker.native.execute=async()=>{await new Promise(resolve=>setTimeout(resolve,35));};
 await worker.executeStep('native',{pluginMethod:'input.type',data:{target:'Email',text:'data',timeout:100}});
 const {nativeStepTimeout}=require('../../dist/native/deadline');assert.equal(nativeStepTimeout('input.type',{timeout:100},15),100);assert.throws(()=>nativeStepTimeout('input.type',{timeout:0},15));assert.equal(nativeStepTimeout('browser.use',{timeout:100},15),15);
});


test('keyboard references retain normal local/global/environment interpolation and runtime validation',async()=>{
 const step=parse('flow.press "{{env.FLOWSTRIDE_BATCH3_KEY}}" on input "Email";')[0];assert.equal(step.payload.key,'{{env.FLOWSTRIDE_BATCH3_KEY}}');
 const old=process.env.FLOWSTRIDE_BATCH3_KEY;process.env.FLOWSTRIDE_BATCH3_KEY='Enter';
 try{const worker=new FlowWorker({ci:true,timeout:50},{},{},{},{},{});worker.localVariables.key='Tab';assert.equal(worker.resolveStepPayload(step.payload).key,'Enter');assert.equal(worker.resolveStepPayload({key:'Shift+@key'}).key,'Shift+Tab');assert.equal(validateKey(worker.resolveStepPayload({key:'Shift+@key'}).key),'Shift+Tab');}finally{if(old===undefined)delete process.env.FLOWSTRIDE_BATCH3_KEY;else process.env.FLOWSTRIDE_BATCH3_KEY=old;}
});


test('the key allowlist accepts printable characters, physical keys and supported shortcuts', () => {
 const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index));
 const functionKeys = Array.from({ length: 12 }, (_, index) => `F${index + 1}`);
 const digits = Array.from({ length: 10 }, (_, index) => index);
 const supported = [
  ...printable, ...functionKeys,
  ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => `Key${letter}`),
  ...digits.flatMap(digit => [`Digit${digit}`, `Numpad${digit}`]),
  'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'NumpadAdd', 'NumpadSubtract',
  'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'CapsLock', 'NumLock', 'ScrollLock',
  'Pause', 'PrintScreen', 'ContextMenu', 'AltGraph', 'Shift', 'Control', 'Alt', 'Meta',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'AudioVolumeMute', 'AudioVolumeDown', 'AudioVolumeUp', 'MediaTrackNext', 'MediaTrackPrevious', 'MediaPlayPause',
  'ControlOrMeta+A', 'Shift+Tab', 'Alt+ArrowLeft', 'Control+Shift+Digit1',
 ];
 for (const key of supported) assert.equal(validateKey(key), key, key);
 for (const key of ['F13', 'F24', 'Clear', 'Help', 'Super', 'Ctrl', 'Key1', 'Numpad10']) assert.throws(() => validateKey(key));
});
