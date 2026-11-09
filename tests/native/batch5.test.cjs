const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {loadProjectData,readBoundedProjectFile,parseCSV,dataSecrets,loadDataSchema}=require('../../dist/native/project_data');
const {interpolateData,hasExactDataReference}=require('../../dist/native/data_references');
const {prepareDataFeatures}=require('../../dist/native/data_plan');const {Parser}=require('../../dist/parser/parser'),{Lexer}=require('../../dist/parser/lexer');
const {DataGenerators}=require('../../dist/runner/data_generators');const {NativeFiles}=require('../../dist/native/files');const {FlowWorker}=require('../../dist/runner/flow_worker');
const code=command=>`Feature: Test data\nScenario: Read data\nGiven "Prepare"\n${command}\nWhen "Act"\nflow.click "Save";\nThen "Done"\nflow.expect visible "Done";`;
const parse=text=>new Parser(new Lexer(text).tokenise()).parse();
function workspace(){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-batch5-unit-')));fs.mkdirSync(path.join(dir,'fixtures'));return{dir,config:{projectRoot:dir,headless:true,timeout:100},write:(file,body)=>{const p=path.join(dir,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);return p;},close:()=>fs.rmSync(dir,{recursive:true,force:true})};}
for(const command of ['flow.files.select {"target":"Attach documents","files":["fixtures/one.txt","fixtures/two.txt"]};','flow.files.select {"selector":"input[type=file]","files":[]};','flow.files.select {"target":"Folder","directory":"fixtures/folder"};','flow.data.load {"file":"fixtures/customer.json","as":"customer"};','flow.file.read {"file":"fixtures/customers.csv","format":"csv","as":"customers"};','flow.data.cases {"file":"fixtures/users.csv"};','flow.data.seed "signup-case-42";'])test('Batch5 parses without new execution blocks: '+command,()=>assert(parse(code(command))));
test('original rules remain intact: terminal Then, unique Feature, mandatory ordering and assertion-only And',()=>{
 for(const command of ['flow.data.load {"file":"fixtures/a.json","as":"data"};','flow.data.seed "seed";','flow.files.select {"target":"Attach","files":[]};']){
  assert.throws(()=>parse(code('').replace('When "Act"',`And "No actions"\n${command}\nWhen "Act"`)),/And blocks/);
  for(const after of ['And "After"\nflow.expect visible "Done";','When "After"\n'+command,'Then "After"\nflow.expect visible "Done";','Feature: Another'])assert.throws(()=>parse(code(command)+'\n'+after));
  assert.throws(()=>parse(code('flow.soft '+command.slice(5))));
 }
 assert.equal(parse(code('')+'\nScenario: Second\nGiven "Ready"\nWhen "Act"\nflow.click "Save";\nThen "Done"\nflow.expect visible "Done";')[0].scenarios.length,2);
});
test('CSV handles BOM, commas, quoted multiline text, CRLF, escaped quotes and empty cells without coercion',()=>{
 const text='email,note,active\r\n"reader@example.test","Line one\nLine two, says ""hello""",false\r\nsecond@example.test,,true\r\n';
 assert.deepEqual(parseCSV(text),[{email:'reader@example.test',note:'Line one\nLine two, says "hello"',active:'false'},{email:'second@example.test',note:'',active:'true'}]);
 const f=workspace();try{f.write('fixtures/rows.csv','\uFEFFid,value\r\n001,=2+2\r\n');assert.deepEqual(loadProjectData(f.config,'fixtures/rows.csv').value,[{id:'001',value:'=2+2'}]);}finally{f.close();}
});
for(const text of ['a,a\n1,2','a,\n1,2','__proto__,a\n1,2','a,b\n1','a,b\n1,2,3','a\n"unterminated','a\n"one"extra','a\nun"quoted'])test('malformed CSV fails explicitly '+JSON.stringify(text),()=>assert.throws(()=>parseCSV(text),/CSV/));
test('JSON/text readers preserve types, Unicode, line endings and immutability',()=>{const f=workspace();try{
 f.write('fixtures/customer.json','\uFEFF{"name":"Adé","active":true,"age":28,"tags":["a"],"empty":null}');const loaded=loadProjectData(f.config,'fixtures/customer.json');assert.equal(loaded.format,'json');assert.equal(loaded.value.active,true);assert.equal(loaded.value.age,28);assert.equal(loaded.sha256.length,64);
 f.write('fixtures/note.txt','hello\r\n世界');assert.equal(loadProjectData(f.config,'fixtures/note.txt').value,'hello\r\n世界');assert.equal(loadProjectData(f.config,'fixtures/note.txt','text').value,'hello\r\n世界');
}finally{f.close();}});
test('file reads reject traversal, symlink escapes, hard links, private state and oversized/non-UTF8/binary content',()=>{const f=workspace(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-outside-'));try{
 fs.writeFileSync(path.join(outside,'secret.json'),'{"token":"outside-secret"}');fs.symlinkSync(path.join(outside,'secret.json'),path.join(f.dir,'fixtures/escape.json'));
 f.write('fixtures/a.json','{}');fs.linkSync(path.join(f.dir,'fixtures/a.json'),path.join(f.dir,'fixtures/hard.json'));
 f.write('.flowstride/credentials.json','{"token":"private-login"}');f.write('.env','TOKEN=private-login');f.write('.git/config','private');f.write('fixtures/large.txt',Buffer.alloc(1024*1024+1));f.write('fixtures/binary.txt',Buffer.from([255,254,255]));
 for(const file of ['../outside.json',path.join(outside,'secret.json'),'fixtures/escape.json','fixtures/hard.json','.flowstride/credentials.json','.env','.git/config','fixtures/large.txt','fixtures/binary.txt','fixtures'])assert.throws(()=>loadProjectData(f.config,file));
 fs.symlinkSync(path.join(f.dir,'.flowstride'),path.join(f.dir,'fixtures/private-link'));assert.throws(()=>loadProjectData(f.config,'fixtures/private-link/credentials.json'),/Private runtime/);
 assert.equal(fs.readFileSync(path.join(outside,'secret.json'),'utf8'),'{"token":"outside-secret"}');
}finally{f.close();fs.rmSync(outside,{recursive:true,force:true});}});
test('JSON source errors never echo credential-bearing excerpts; prototype keys and complexity fail closed',()=>{const f=workspace();try{
 const secret='do-not-print-fixture-password';f.write('fixtures/bad.json','{"password":"'+secret+'", invalid}');assert.throws(()=>loadProjectData(f.config,'fixtures/bad.json'),error=>/Invalid JSON/.test(error.message)&&!error.message.includes(secret));
 for(const value of ['{"__proto__":{"polluted":true}}','{"safe":{"constructor":"attack"}}']){f.write('fixtures/bad.json',value);assert.throws(()=>loadProjectData(f.config,'fixtures/bad.json'),/prototype/);}
 f.write('fixtures/bad.json','['.repeat(34)+'1'+']'.repeat(34));assert.throws(()=>loadProjectData(f.config,'fixtures/bad.json'),/nesting|complexity/);assert.equal({}.polluted,undefined);
}finally{f.close();}});
test('data aliases use safe names and sensitive metadata survives ordinary aliases',()=>{
 for(const name of ['__proto__','constructor','prototype','global','../bad','name.with.dot',''])assert.throws(()=>loadDataSchema.parse({file:'fixtures/data.json',as:name}));
 assert.deepEqual(dataSecrets({email:'private@example.test',emailVerified:true,account:{password:'password-42'},otp:123456,note:'public'}).sort(),['123456','password-42','private@example.test'].sort());
});
test('loaded references retain types and support nested arrays/quoted keys without expression evaluation',()=>{
 const aliases=new Set(['customer']),variables={customer:{name:'Adé',age:28,active:true,contacts:[{city:'Lagos'}],'First Name':'Samuel'}};const legacy=s=>s;
 assert.equal(interpolateData('@customer.name',aliases,variables,legacy),'Adé');assert.equal(interpolateData('@customer.age',aliases,variables,legacy),'28');assert.equal(interpolateData('@customer.age',aliases,variables,legacy,true),28);assert.equal(interpolateData('@customer.active',aliases,variables,legacy,true),true);assert.equal(interpolateData('@customer.contacts[0].city',aliases,variables,legacy),'Lagos');assert.equal(interpolateData('@customer["First Name"]',aliases,variables,legacy),'Samuel');assert(hasExactDataReference('@customer.contacts[0]',aliases));
 for(const ref of ['@customer.__proto__','@customer.constructor','@customer.contacts[99].city'])assert.throws(()=>interpolateData(ref,aliases,variables,legacy));
 const copy=interpolateData('@customer',aliases,variables,legacy,true);copy.name='changed';assert.equal(variables.customer.name,'Adé');assert.equal(interpolateData('mail@customer.test',aliases,variables,legacy),'mail@customer.test');
});
test('fixture strings cannot introduce env/generator expansion, JSON properties or executable text',()=>{
 const variables={row:{name:'"},"admin":true,"note":"',literal:'{{env.PRIVATE}} $randomToken @other',active:true}},aliases=new Set(['row']);
 const legacy=s=>s.replace('{{env.PRIVATE}}','must-not-read').replace('$randomToken','must-not-generate').replace('@other','must-not-resolve');
 assert.equal(interpolateData('@row.literal',aliases,variables,legacy),variables.row.literal);
 const body=interpolateData('{"name":"@row.name","active":"@row.active","literal":"@row.literal"}',aliases,variables,legacy);assert.deepEqual(JSON.parse(body),variables.row);assert(!Object.hasOwn(JSON.parse(body),'admin'));
 assert.equal(interpolateData('Old {{env.PRIVATE}}',new Set(),{},legacy),'Old must-not-read');
 assert.throws(()=>interpolateData(Array(4).fill('@row.name').join(' '),aliases,{row:{name:'x'.repeat(400000)}},s=>s),/exceeds 1 MiB/);
});
test('dataset expansion creates stable unique case IDs, keeps source lines, and never publishes row values',()=>{const f=workspace();try{
 f.write('fixtures/users.json',JSON.stringify([{name:'Samuel',password:'private-one'},{name:'Amina',password:'private-two'}]));const parsed=parse(code('flow.data.cases {"file":"fixtures/users.json","as":"person"};'));
 const planned=prepareDataFeatures(parsed,f.config),rows=planned[0].scenarios;assert.equal(rows.length,2);assert.deepEqual(rows.map(s=>s.name),['Read data [case 1/2]','Read data [case 2/2]']);assert.equal(new Set(rows.flatMap(s=>s.steps.map(step=>step.id))).size,6);assert.equal(rows[0].steps[0].line,4);assert.equal(rows[0].dataCase.binding,'person');assert(!JSON.stringify(planned).includes('private-one'));assert.equal(parsed[0].scenarios.length,1);
 assert.deepEqual(prepareDataFeatures(planned,f.config),planned);f.write('fixtures/users.json','[{"name":"Changed"}]');assert.throws(()=>prepareDataFeatures(parsed,f.config),/changed after/);
}finally{f.close();}});
test('datasets reject empty/primitive/invalid/overlarge cases and declarations outside first Given',()=>{const f=workspace();try{
 for(const body of ['[]','[1]','{}','null',JSON.stringify(Array.from({length:1001},()=>({id:1})))]){f.write('fixtures/users.json',body);delete f.config.nativeDataManifest;assert.throws(()=>prepareDataFeatures(parse(code('flow.data.cases {"file":"fixtures/users.json"};')),f.config));}
 f.write('fixtures/users.json','[{"name":"One"}]');
 for(const source of [code('flow.open "/";\nflow.data.cases {"file":"fixtures/users.json"};'),code('').replace('flow.click "Save";','flow.data.cases {"file":"fixtures/users.json"};'),code('flow.data.cases {"file":"fixtures/users.json"};\nflow.data.cases {"file":"fixtures/users.json"};')])assert.throws(()=>prepareDataFeatures(parse(source),f.config),/first command|exactly one/);
}finally{f.close();}});
test('only.Scenario ignores unselected dataset files and fixed env paths are pinned before execution',()=>{const f=workspace(),old=process.env.FLOWSTRIDE_CASE_FILE;try{
 f.write('fixtures/users.csv','name\nOne\nTwo\n');process.env.FLOWSTRIDE_CASE_FILE='fixtures/users.csv';const selected=code('flow.data.cases {"file":"{{env.FLOWSTRIDE_CASE_FILE}}"};').replace('Scenario:','only.Scenario:');const unselected=code('flow.data.cases {"file":"fixtures/missing.csv"};').split('\n').slice(1).join('\n');const planned=prepareDataFeatures(parse(selected+'\n'+unselected),f.config);assert.equal(planned[0].scenarios.length,2);assert(planned[0].scenarios.every(s=>s.isOnly));
}finally{if(old===undefined)delete process.env.FLOWSTRIDE_CASE_FILE;else process.env.FLOWSTRIDE_CASE_FILE=old;f.close();}});
const randomNames=generator=>Object.keys(generator.getMap()).filter(key=>!['timestamp','isoTimestamp','today','tomorrow','yesterday','currentYear','currentMonth','runId','workerId'].includes(key));
test('seeded random catalog is repeatable, context-specific, private to the instance, and keeps $/ @ reuse',()=>{
 const a=new DataGenerators('same-run','worker-1'),b=new DataGenerators('same-run','worker-1');a.setSeed('signup-case-42','file:scenario:0');b.setSeed('signup-case-42','file:scenario:0');
 const first={},second={};for(const key of randomNames(a)){first[key]=a.resolve('$'+key);second[key]=b.resolve('$'+key);}assert.deepEqual(first,second);assert.match(first.uuid,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(a.resolve('@randomPassword'),first.randomPassword);assert.equal(a.resolve('@randomEmail@flowstridemail.com'),first.randomEmail.split('@')[0]+'@flowstridemail.com');
 const other=new DataGenerators('same-run','worker-1');other.setSeed('signup-case-42','file:scenario:1');assert.notEqual(other.resolve('$uuid'),first.uuid);assert.equal(a.runId(),'same-run');assert.equal(a.workerId(),'worker-1');assert.equal(a.today(),new Date().toISOString().slice(0,10));
 a.setSeed('reset','same');const value=a.resolve('$randomString');a.setSeed('reset','same');assert.equal(a.resolve('$randomString'),value);assert(a.sensitiveValues().every(value=>typeof value==='string'));
});
test('seed checkpoints rewind retries and case forks vary without scheduling/worker dependence',()=>{
 const gen=new DataGenerators('run','worker');gen.setSeed('seed','file');gen.resolve('$randomEmail');const before=gen.checkpoint(),one=gen.resolve('$uuid');gen.restore(before);assert.equal(gen.resolve('$uuid'),one);gen.restore(before);
 const a=gen.fork('case-1'),b=gen.fork('case-1'),other=gen.fork('case-2');assert.equal(a.resolve('@randomEmail'),gen.resolve('@randomEmail'));assert.equal(a.resolve('$uuid'),b.resolve('$uuid'));assert.notEqual(b.resolve('$uuid'),other.resolve('$uuid'));
});
test('unseeded generators still call native randomness; seeding never replaces global Math/crypto APIs',()=>{
 const gen=new DataGenerators('run','worker'),original=Math.random;let calls=0;Math.random=()=>{calls++;return 0.5;};try{assert.equal(gen.randomNumber(),'500000');assert.equal(calls,1);gen.setSeed('seed');gen.randomNumber();assert.equal(calls,1);assert.equal(Math.random(),0.5);assert.equal(calls,2);}finally{Math.random=original;}
 for(const seed of ['',null,4,{},'x'.repeat(1025),'bad\nseed'])assert.throws(()=>gen.setSeed(seed));
});
test('unsafe file selection fails before browser calls or fixture mutation',async()=>{const f=workspace();try{
 f.write('fixtures/a.txt','one');const calls=[],web={getPage:()=>{calls.push('page');throw Error('must not touch browser')},getScope:()=>{calls.push('scope');throw Error('must not touch browser')},resolveAssertionTarget:()=>{calls.push('resolve');throw Error('must not touch browser')}};const files=new NativeFiles(web,f.config);
 for(const input of [{target:'Attach',files:['../escape']},{target:'Attach',files:['fixtures/a.txt','fixtures/a.txt']},{target:'Attach',files:['fixtures/a.txt'],directory:'fixtures'},{target:'Attach',selector:'input',files:[]},{target:'Attach',files:'fixtures/a.txt'},{target:'Attach',files:[],force:true},{target:'Attach',files:[],timeout:0}])await assert.rejects(files.select(input));assert.deepEqual(calls,[]);assert.equal(fs.readFileSync(path.join(f.dir,'fixtures/a.txt'),'utf8'),'one');
 let getters=0;await assert.rejects(files.select({target:'Attach',get files(){getters++;return[]}}));assert.equal(getters,0);files.dispose();
}finally{f.close();}});
test('worker data loads preserve real typed values and provenance without exposing stale assertion results',async()=>{const f=workspace();try{
 f.write('fixtures/customer.json',JSON.stringify({name:'Adé',active:true,age:28,password:'fixture-private-password',emailVerified:false}));const worker=new FlowWorker({...f.config,ci:true},{},{},{},{},{});await worker.executeStep('native',{pluginMethod:'data.load',data:{file:'fixtures/customer.json',as:'customer'}});
 assert.equal(worker.resolveStepPayload({text:'@customer.name'}).text,'Adé');assert.equal(worker.resolveStepPayload({pluginMethod:'assert.value',data:{actual:'@customer.active',operator:'equals',expected:true}}).data.actual,true);assert.equal(worker.resolveStepPayload({pluginMethod:'assert.value',data:{actual:'@customer.age',operator:'equals',expected:28}}).data.actual,28);assert(worker.secretValues().includes('fixture-private-password'));assert.equal(worker.localVariables.customer.emailVerified,false);
 await assert.rejects(worker.executeStep('native',{pluginMethod:'data.cases',data:{file:'fixtures/customer.json'}}),/planned/);
 assert.equal(FlowWorker.nativeDataProtocol,1);
}finally{f.close();}});

test('seeded catalogue matches the other engine without changing either default RNG',{skip:!process.env.FLOWSTRIDE_PRO_SOURCE||require('../../package.json').name!=='flowstride'},()=>{
 const Other=require(path.join(process.env.FLOWSTRIDE_PRO_SOURCE,'dist/runner/data_generators')).DataGenerators,a=new DataGenerators('run','worker-a'),b=new Other('run','worker-b');a.setSeed('same-seed','same-case');b.setSeed('same-seed','same-case');for(const key of randomNames(a))assert.equal(a.resolve('$'+key),b.resolve('$'+key),key);
});
test('case reset restores variables, API state, temporary values, globals, aliases and RNG before each row',async()=>{const f=workspace();try{
 f.write('fixtures/rows.json',JSON.stringify([{name:'First'},{name:'Second'}]));const planned=prepareDataFeatures(parse(code('flow.data.cases {"file":"fixtures/rows.json"};')),f.config)[0].scenarios;
 let apiState='baseline-api',values={original:'baseline'},restored=0;const web={onPageChanged:undefined,checkpointProfiles:async()=>({saved:'profile'}),restoreProfiles:async state=>{assert.equal(state.saved,'profile');restored++;}},api={checkpointState:()=>apiState,restoreState:state=>{apiState=state},resetState:()=>{apiState='reset'}},store={getAll:()=>values,clear:()=>{values={}},set:(key,value)=>{values[key]=value}};
 const worker=new FlowWorker({...f.config,ci:true},web,api,store,{});worker.localVariables={baseline:42};worker.dataGen=new DataGenerators('run','worker');worker.dataGen.setSeed('seed');const oldGlobals=FlowWorker.globalVariables,oldSessions=FlowWorker.globalBrowserSessions;FlowWorker.globalVariables={original:'global-value'};FlowWorker.globalBrowserSessions={original:{name:'global-session'}};
 try{let index=0;worker.runScenarioWithRetries=async()=>{assert.equal(worker.localVariables.baseline,42);assert.equal(worker.localVariables.previous,undefined);assert.equal(apiState,'baseline-api');assert.deepEqual(values,{original:'baseline'});assert.deepEqual(FlowWorker.globalVariables,{original:'global-value'});assert.deepEqual(FlowWorker.globalBrowserSessions,{original:{name:'global-session'}});assert.equal(worker.localVariables.case.name,index++===0?'First':'Second');worker.localVariables.previous='dirty';apiState='dirty';values.extra='dirty';FlowWorker.globalVariables.extra='dirty';FlowWorker.globalBrowserSessions.extra='dirty';return true;};await worker.runPreparedScenario(planned[0],[]);await worker.runPreparedScenario(planned[1],[]);assert.equal(index,2);assert.equal(restored,1);
 worker.runScenarioWithRetries=async()=>{assert.equal(worker.localVariables.case,undefined);assert.equal(worker.localVariables.previous,undefined);assert.equal(worker.dataAliases.size,0);assert.equal(apiState,'baseline-api');return true;};await worker.runPreparedScenario({name:'Ordinary scenario',steps:[],declarations:[]},[]);assert.equal(restored,2);
 }finally{FlowWorker.globalVariables=oldGlobals;FlowWorker.globalBrowserSessions=oldSessions;}
}finally{f.close();}});

test('CSV row/column caps and invalid data-case bindings reject before expansion',()=>{const f=workspace();try{
 assert.throws(()=>parseCSV(Array(1001).fill('column').join(',')+'\n'),/1000 columns/);assert.throws(()=>parseCSV('name\n'+Array(1001).fill('value').join('\n')),/1000 data rows/);
 f.write('fixtures/users.json','[{"id":1}]');for(const binding of ['__proto__','constructor','global','bad.name'])assert.throws(()=>prepareDataFeatures(parse(code('flow.data.cases '+JSON.stringify({file:'fixtures/users.json',as:binding})+';')),f.config));
}finally{f.close();}});
