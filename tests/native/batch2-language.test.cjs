const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Parser}=require('../../dist/parser/parser');
const {Lexer,TokenType}=require('../../dist/parser/lexer');
const {validateControlDuration,isControlDurationTemplate,isSoftAssertionStep,validateControlMessage}=require('../../dist/parser/assertion_contract');
const {needsNativeControlProtocol}=require('../../dist/native/compatibility');

const parseText=text=>new Parser(new Lexer(text).tokenise()).parse();
const scenario=command=>`Feature: Control\nScenario: Controls\nGiven "Ready"\nWhen "Execute"\n${command}\nThen "Checked"\nflow.expect visible "Ready";`;
const step=command=>parseText(scenario(command))[0].scenarios[0].steps[0];

for(const command of ['flow.soft expect visible "Email";', ...['assert.that','assert.value','network.expect','download.expect','stub.expect','a11y.scan','a11y.match'].map(method=>`flow.soft ${method} {"target":"Email","condition":"visible"};`)]) {
 test(`soft assertion retains built-in payload and parent: ${command}`,()=>{
  const parsed=step(command);
  assert.equal(parsed.payload.soft,true);
  assert.equal(isSoftAssertionStep(parsed.action,parsed.payload),true);
  assert.equal(parsed.blockDescription,'When "Execute"');
  assert.equal(parsed.line,5);
  assert.notEqual(parsed.payload.optional,true);
  if(parsed.action==='native')assert.equal(parsed.payload.pluginAlias,'flow');
 });
}

test('soft assertions are additive in Given, When, assertion And and the final Then',()=>{
 const features=parseText(`Feature: Soft blocks\nScenario: Scoped\nGiven "Ready"\nflow.soft expect visible "Ready";\nWhen "Act"\nflow.soft expect visible "Act";\nAnd "Inspect"\nflow.soft assert.that {"target":"Email","condition":"visible"};\nThen "Final"\nflow.soft assert.value {"actual":1,"operator":"equals","expected":1};`);
 assert.equal(features[0].scenarios[0].steps.length,4);
 assert(features[0].scenarios[0].steps.every(step=>step.payload.soft===true));
});

for(const command of ['flow.soft click "Sign in";','flow.soft open "/";','flow.soft browser.use {"name":"a"};','flow.soft network.route {};','flow.soft plugin.assert {};','flow.soft try click "Button";','flow.soft flow.expect visible "Email";','flow.soft flow.try click "Button";','flow.soft soft expect visible "Email";','flow.try soft expect visible "Email";','flow.try flow.soft expect visible "Email";','flow.soft "expect";','flow.soft;']) {
 test(`soft actions/plugins/optional combinations fail closed: ${command}`,()=>assert.throws(()=>step(command)));
}

for(const [action,maximum] of [['wait',86400000],['pace',60000]]) {
 for(const value of [0,1,maximum])test(`${action} accepts finite integer boundary ${value}`,()=>{
  const parsed=step(`flow.${action} ${value};`);
  assert.equal(parsed.action,action);assert.deepEqual(parsed.payload,{optional:false,milliseconds:value});
 });
 for(const value of ['-1','1.5','NaN','Infinity','1e3','0x10','2,000','100ms',String(maximum+1),'9007199254740993','{}','true','"250"','""','"@delay extra"','"{{env.DELAY}}; process.exit()"']) {
  test(`${action} rejects malformed/unbounded duration ${value}`,()=>assert.throws(()=>step(`flow.${action} ${value};`)));
 }
 for(const value of ['{{env.DELAY}}','@delay','@global[delay]'])test(`${action} retains a duration template for runtime validation: ${value}`,()=>{
  assert.equal(step(`flow.${action} "${value}";`).payload.milliseconds,value);
 });
 test(`${action} requires one explicit duration`,()=>assert.throws(()=>step(`flow.${action};`)));
 for(const value of [true,false,null,{},[],NaN,Infinity,-1,1.5,maximum+1,'','1e3','0x10','2,000','-1','2.0','@missing']) {
  test(`${action} runtime contract rejects ${JSON.stringify(value)}`,()=>assert.throws(()=>validateControlDuration(value,action)));
 }
 test(`${action} runtime contract accepts an interpolated numeric string`,()=>assert.equal(validateControlDuration('250',action),250));
}

test('only complete duration templates bypass literal validation',()=>{
 for(const value of ['{{env.DELAY}}','@delay','@global[delay]'])assert.equal(isControlDurationTemplate(value),true);
 for(const value of ['prefix @delay','@delay suffix','{{env.X}}x','@delay.toString()','{{env.X;process.exit()}}'])assert.equal(isControlDurationTemplate(value),false);
});

for(const action of ['log','pause']) {
 test(`${action} keeps its quoted message without interpreting source code`,()=>{
  const parsed=step(`flow.${action} "Inspect {{env.LABEL}} @email; <script>";`);
  assert.equal(parsed.action,action);assert.deepEqual(parsed.payload,{optional:false,message:'Inspect {{env.LABEL}} @email; <script>'});
 });
 for(const argument of ['', '""','"   "','{}','250'])test(`${action} rejects absent/nonmessage argument ${argument}`,()=>assert.throws(()=>step(`flow.${action} ${argument};`)));
}

for(const command of ['flow.wait 0;','flow.pace 0;','flow.log "Message";','flow.pause "Inspect";'])test(`And remains assertion-only for control actions: ${command}`,()=>{
 assert.throws(()=>parseText(scenario(`flow.expect visible "Ready";\nAnd "Not an action"\n${command}`)),/strictly for assertions/);
});

test('terminal Then accepts its own assertions and only a new Scenario may follow',()=>{
 const source=scenario('flow.soft expect visible "Ready";');
 for(const tail of ['And "Forbidden"\nflow.soft expect visible "Ready";','When "Forbidden"\nflow.log "No";','Then "Forbidden"\nflow.expect visible "Ready";','Given "Forbidden"','Feature: Second','let alias = "plugin.cjs";']) {
  assert.throws(()=>parseText(source+'\n'+tail),/Terminal Lock|only one Feature/);
 }
 const second='Scenario: Next\nGiven "Ready"\nWhen "Do"\nflow.log "Next scenario";\nThen "Done"\nflow.expect visible "Ready";';
 assert.equal(parseText(source+'\n'+second)[0].scenarios.length,2);
});

test('Feature remains first/unique and Given When Then ordering is unchanged',()=>{
 assert.throws(()=>parseText('Scenario: First\nGiven "Ready"'),/Feature must be the first/);
 assert.throws(()=>parseText('Feature: First\nFeature: Second'),/only one Feature/);
 assert.throws(()=>parseText('Feature: First\nScenario: One\nWhen "Wrong"\nThen "Done"'),/When cannot come before Given/);
 assert.throws(()=>parseText('Feature: First\nScenario: One\nGiven "Ready"\nThen "Wrong"'),/Then must follow When/);
 assert.throws(()=>parseText('Feature: First\nScenario: One\nGiven "Ready"\nWhen "Do"\nGiven "Wrong"'),/Given must be first/);
});

test('flow.try retains optional behavior, payload and existing repeat-prefix error',()=>{
 const parsed=step('flow.try click button "Maybe";');
 assert.equal(parsed.action,'click');assert.equal(parsed.payload.optional,true);assert.equal(parsed.payload.selector,'Maybe');
 assert.throws(()=>step('flow.try flow.click "Maybe";'),/Do not repeat 'flow\.' after 'flow\.try'/);
 assert.throws(()=>step('flow.try unknown "Maybe";'),/Expected an action command after 'flow\.try'/);
});

test('new command words do not reserve plugin alias names or alter alias calls',()=>{
 for(const alias of ['wait','pace','log','pause','soft']) {
  const declarations=new Lexer(`let ${alias} = "plugin.cjs";`).tokenise();
  assert.equal(declarations.find(token=>token.value===alias).type,TokenType.IDENTIFIER);
  const parsed=step(`${alias}.assert {"value":1};`);
  assert.equal(parsed.action,'plugin');assert.equal(parsed.payload.pluginAlias,alias);
 }
});

test('the additive protocol is required for new syntax only, preserving legacy handoff',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-control-language-'));
 try {
  const file=path.join(directory,'test.flow'),config={projectRoot:directory};
  for(const [command,required] of [
   ['flow.click "Button";',false],['flow.try click "Optional";',false],
   ['flow.assert.that {"role":"button","name":"Submit","condition":"enabled"};',false],
   ['flow.wait 0;',true],['flow.pace 0;',true],['flow.log "Message";',true],['flow.pause "Inspect";',true],
   ['flow.soft expect visible "Email";',true],['flow.soft assert.that {"target":"Email","condition":"visible"};',true],
  ]) {
   fs.writeFileSync(file,scenario(command));
   assert.equal(needsNativeControlProtocol(file,config),required,command);
  }
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});


for(const action of ['log','pause'])test(`${action} message limits match the dashboard transport`,()=>{
 const message='x'.repeat(32768);
 assert.equal(step(`flow.${action} "${message}";`).payload.message.length,32768);
 assert.equal(validateControlMessage(message,action),message);
 assert.throws(()=>step(`flow.${action} "${message}x";`),/32768/);
 for(const value of [undefined,null,{},[],true,42,'','  ',message+'x'])assert.throws(()=>validateControlMessage(value,action),/message/);
});
