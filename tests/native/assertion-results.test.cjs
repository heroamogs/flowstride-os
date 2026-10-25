const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Parser}=require('../../dist/parser/parser');const {Lexer}=require('../../dist/parser/lexer');const {FlowWorker}=require('../../dist/runner/flow_worker');const {FlowOrchestrator}=require('../../dist/runner/flow_orchestrator');const {runNativeCI}=require('../../dist/ci/runtime');const {AssertionFailure,assertionCheck,assertionText,diagnosticValue,unexecutedAssertion}=require('../../dist/reporting/assertion_result');const {redactWorkerPayload}=require('../../dist/security/redaction');const {PdfGenerator}=require('../../dist/reporting/pdf_generator');
const parse=command=>new Parser(new Lexer(`Feature: Assertions\nScenario: Verification\nGiven "Setup"\nWhen "Action"\nflow.open "/";\nAnd "Verify"\n${command}\nThen "Done"\nflow.expect status "200";`).tokenise()).parse();
for(const method of ['assert.that','network.expect','download.expect','stub.expect','a11y.scan','a11y.match'])test(`And accepts native assertion ${method}`,()=>{assert.equal(parse(`flow.${method} {};`)[0].scenarios[0].steps.at(-2).payload.pluginMethod,method);});
for(const method of ['browser.create','browser.use','network.route','download.save','clock.install','stub.install','a11y.snapshot','unknown.check'])test(`And rejects state-changing or unknown native method ${method}`,()=>assert.throws(()=>parse(`flow.${method} {};`),/And|Unknown|Unsupported|not supported/i));
test('And preserves ordinary expectations and existing assertion plugins',()=>{assert.equal(parse('flow.expect visible "Ready";')[0].scenarios[0].steps.at(-2).action,'expect');});
const result=()=>({command:'assert.that',target:'button named "Submit"',status:'failed',timeout:100,elapsed:101,sourceFile:'example.flow',sourceLine:24,profile:'customer',checks:[{key:'target',label:'Target found',status:'passed',children:[assertionCheck('role','role: button',true),assertionCheck('name','name: Submit',true)]},assertionCheck('unique','Exactly one matching target',true),assertionCheck('condition','condition: enabled',false,'enabled','disabled')]});
test('nested failure preserves successful checks, truthful diagnostics and source',()=>{const text=assertionText(result());assert.match(text,/✔ role: button/);assert.match(text,/✖ condition: enabled/);assert.match(text,/Expected: enabled\n\s+Actual: disabled/);assert.match(text,/example.flow:24/);assert.doesNotMatch(text,/✔ Expected|✖ Timeout/);assert.match(new AssertionFailure(result()).message,/disabled/);});
test('diagnostic formatting neutralizes terminal controls and bounds hostile values',()=>{assert.doesNotMatch(diagnosticValue('\x1b[2J\x00'+'x'.repeat(10000)),/[\x00-\x1f]/);assert(diagnosticValue('x'.repeat(10000)).length<=1500);const r=result();r.checks[0].label='<script>evil()</script>\x1b[31m';const html=new PdfGenerator().generateReportHtml([{fileName:'x.flow',steps:[{id:'one',status:'failed',assertion:r,description:'unsafe'}]}]);assert(!html.includes('<script>evil()'));assert(html.includes('&lt;script&gt;'));});
test('assertion transport redacts secrets in expected, actual, labels and nested children',()=>{const r=result();r.checks[0].children[0].label='known-secret';r.checks[2].expected='known-secret';r.checks[2].actual='Bearer private-value';const safe=redactWorkerPayload('STEP_UPDATE',{assertion:r},['known-secret']);assert(!JSON.stringify(safe).includes('known-secret'));assert(!JSON.stringify(safe).includes('private-value'));});
test('unexecuted assertions cannot fabricate successful child checks',()=>{const r=unexecutedAssertion('native',{pluginMethod:'assert.that',data:{role:'button',name:'Later',condition:'enabled'}});assert.equal(r.status,'not_evaluated');assert(r.checks.every(x=>x.status==='not_evaluated'));});
test('worker keeps diagnostics per step, reports errors, and never executes later steps after failure',async()=>{const w=new FlowWorker({ci:true,timeout:50},{activeProfile:'customer'},{},{},{},{});w.currentFileName='example.flow';w.captureStepContext=async()=>({});w.native.captureDOM=async()=>undefined;let calls=0;w.native.execute=async()=>{calls++;w.native.lastAssertion=result();throw new AssertionFailure(w.native.lastAssertion);};const events=[];w.on('worker_event',e=>events.push(e));const steps=[1,2].map(i=>({id:'s'+i,line:20+i,action:'native',payload:{pluginMethod:'assert.that',data:{role:'button',name:'Submit',condition:'enabled'}},blockDescription:'And "Validate form"'}));assert.equal(await w.runScenario({name:'Form',steps,declarations:[]}),false);assert.equal(calls,1);const updates=events.filter(e=>e.type==='STEP_UPDATE').map(e=>e.payload);assert.equal(updates[0].assertion.sourceLine,21);assert.equal(updates[0].assertion.checks[0].status,'passed');assert.match(updates[0].error,/Actual: disabled/);assert.equal(updates[1].status,'not_tested');assert.equal(updates[1].assertion.status,'not_evaluated');});
test('recovered retries determine final success and failOnFlaky can reject recovery',async()=>{for(const failOnFlaky of [false,true]){const web={checkpointProfiles:async()=>({}),restoreProfiles:async()=>{},pageErrors:[],activeProfile:'default'};const w=new FlowWorker({ci:true,retries:1,failOnFlaky},web,{checkpointState:()=>({}),restoreState:()=>{}},{getAll:()=>({}),clear:()=>{}},{},{});let n=0;w.runScenario=async()=>++n===2;assert.equal(await w.runScenarioWithRetries({name:'Retry',steps:[]},[]),!failOnFlaky);assert.equal(n,2);}});
test('parse failure returns false, emits FILE_FAILED, and never prints suite success',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-summary-')),file=path.join(dir,'bad.flow');fs.writeFileSync(file,'Feature: Bad\nScenario: Bad\nGiven "setup"\nflow.assert.that {;\n"role":"button"\n};');const web={initialise:async()=>{},getPage:()=>({video:()=>undefined,context:()=>({})}),shutdown:async()=>{},pageErrors:[],activeProfile:'default'};const w=new FlowWorker({ci:true,timeout:100,headless:true,recordVideo:false},web,{resetState:()=>{}},{},{},{});w.startStreaming=async()=>{};w.setupNetworkInterception=async()=>{};const events=[];w.on('worker_event',e=>events.push(e));try{assert.equal(await w.runBatch([file]),false);assert(events.some(e=>e.type==='FILE_FAILED' && /Invalid JSON/.test(e.payload.error)));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('OS/Cloud orchestrator propagates a worker failure even when no STEP_UPDATE exists',async()=>{const {EventEmitter}=require('node:events');const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-empty-failure-'))),file=path.join(dir,'bad.flow');fs.writeFileSync(file,'Feature: Empty');const worker=new EventEmitter();worker.runBatch=async()=>false;worker.abort=()=>{};const config={ci:true,projectRoot:fs.realpathSync(dir),flowRoot:fs.realpathSync(dir)};const orch=new FlowOrchestrator(worker,1,config);try{assert.equal(await orch.start(file),false);}finally{await orch.close?.();fs.rmSync(dir,{recursive:true,force:true});}});
test('CI retains nested checks without inflating metrics and escapes JUnit output',async()=>{const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-check-ci-'))),file=path.join(dir,'one.flow');fs.writeFileSync(file,'Feature: Checks\nScenario: One\nGiven "Setup"\nWhen "Action"\nflow.open "/";\nThen "Done"\nflow.expect status "200";');const worker={on(){},off(){},abort(){}};const config={ci:true,projectRoot:dir,artifactsDir:path.join(dir,'evidence'),recordVideo:false,timeout:1000,browserErrors:'fail'};const r=result();r.checks[0].label='<script>unsafe</script>';const orch={async start(){for(const [type,payload] of [['STEP_ADD',{id:'one',fileName:'one.flow',description:'Check',status:'running'}],['STEP_UPDATE',{id:'one',fileName:'one.flow',status:'failed',assertion:r,error:'condition failed'}],['FILE_COMPLETE',{fileName:'one.flow'}]])config.onRunEvent({type,payload});return false;},close:async()=>{}};try{const summary=await runNativeCI(worker,orch,file,config,'test');assert.equal(summary.status,'failed');assert.equal(summary.metrics.failed,1);assert.equal(summary.steps[0].assertion.checks[0].status,'passed');const xml=fs.readFileSync(path.join(dir,'evidence/junit.xml'),'utf8');assert.match(xml,/<system-out>/);assert(xml.includes('&lt;script&gt;'));assert(!xml.includes('<script>'));}finally{fs.rmSync(dir,{recursive:true,force:true});}});

const terminalScenario = [
  'Feature: Terminal lock',
  'Scenario: Complete',
  'Given "Setup"',
  'When "Action"',
  'flow.open "/";',
  'Then "Final checks"',
  'flow.expect visible "Ready";',
].join('\n') + '\n';
const parseTerminalFlow = source => new Parser(new Lexer(source).tokenise()).parse();

for (const block of ['And', 'stop.And', 'Then', 'Given', 'When', 'stop.Then', 'stop.Given', 'stop.When']) {
  test(`terminal Then rejects a following ${block} block at its source line`, () => {
    assert.throws(
      () => parseTerminalFlow(terminalScenario + `${block} "Another block"\nflow.expect visible "Later";`),
      error => {
        assert.match(error.message, /^Line 8: Terminal Lock Violation\. No steps allowed after Then\.$/);
        return true;
      },
    );
  });
}

test('terminal Then rejects an empty following And block', () => {
  assert.throws(() => parseTerminalFlow(terminalScenario + 'And "Empty follow-up"'), /Terminal Lock Violation/);
});

for (const method of ['assert.that', 'network.expect', 'download.expect', 'stub.expect', 'a11y.scan', 'a11y.match']) {
  test(`terminal lock rejects post-Then And containing ${method}`, () => {
    assert.throws(
      () => parseTerminalFlow(terminalScenario + `And "More checks"\nflow.${method} {};`),
      /Terminal Lock Violation/,
    );
  });

  test(`terminal lock preserves ${method} under intermediate And and inside final Then`, () => {
    const source = [
      'Feature: Native assertions',
      'Scenario: Complete',
      'Given "Setup"',
      'When "Action"',
      'flow.open "/";',
      'And "Intermediate check"',
      `flow.${method} {};`,
      'Then "Final checks and action"',
      `flow.${method} {};`,
      'flow.expect visible "Ready";',
      'flow.click button "Logout";',
    ].join('\n');
    const scenario = parseTerminalFlow(source)[0].scenarios[0];
    assert.deepEqual(scenario.steps.map(step => step.action), ['open', 'native', 'native', 'expect', 'click']);
    assert.equal(scenario.steps[1].blockDescription, 'And "Intermediate check"');
    assert(scenario.steps.slice(2).every(step => step.blockDescription === 'Then "Final checks and action"'));
  });
}

for (const prefix of [
  'Feature: First feature\nFeature: Another feature\n',
  'Feature: First feature\nlet helper = "plugins/helper.cjs";\nFeature: Another feature\n',
]) {
  test(`a test file rejects duplicate Feature headings before its first Scenario: ${prefix.split('\n').length - 1} lines`, () => {
    const scenario = terminalScenario.slice(terminalScenario.indexOf('Scenario:'));
    assert.throws(() => parseTerminalFlow(prefix + scenario), /only one Feature/);
  });
}

for (const prefix of ['flow.open "/";\n', 'let helper = "plugins/helper.cjs";\n']) {
  test(`Feature must be the first declaration, before ${prefix.trim()}`, () => {
    assert.throws(() => parseTerminalFlow(prefix + terminalScenario), /Feature must be the first declaration/);
  });
}

test('comments and blank lines can precede the single top-level Feature', () => {
  assert.equal(parseTerminalFlow('// File description\n\n/* Header comment */\n' + terminalScenario)[0].name, 'Terminal lock');
});

test('the single Feature can declare shared aliases before its Scenarios', () => {
  const source = terminalScenario.replace('Feature: Terminal lock\n', 'Feature: Terminal lock\nlet helper = "plugins/helper.cjs";\n');
  assert.equal(parseTerminalFlow(source)[0].declarations[0].alias, 'helper');
});

test('terminal lock rejects an alias declaration after Then', () => {
  assert.throws(
    () => parseTerminalFlow(terminalScenario + 'let helper = "plugins/helper.cjs";'),
    /Line 8: Terminal Lock Violation/,
  );
});

test('terminal lock rejects another Feature after Then', () => {
  assert.throws(
    () => parseTerminalFlow(terminalScenario + [
      'Feature: Another feature',
      'Scenario: Another journey',
      'Given "Setup"',
      'When "Action"',
      'Then "Final result"',
    ].join('\n')),
    /Line 8: Terminal Lock Violation/,
  );
});

test('a following Scenario can declare its own aliases after the terminal lock resets', () => {
  const source = terminalScenario + [
    'Scenario: Next journey',
    'let helper = "plugins/helper.cjs";',
    'Given "Another setup"',
    'When "Another action"',
    'flow.open "/next";',
    'Then "Another result"',
    'flow.expect visible "Next";',
  ].join('\n');
  const scenarios = parseTerminalFlow(source)[0].scenarios;
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[1].declarations[0].alias, 'helper');
});

test('terminal lock resets for the next scenario', () => {
  const source = terminalScenario + [
    'Scenario: Next journey',
    'Given "Another setup"',
    'When "Another action"',
    'flow.open "/next";',
    'Then "Another result"',
    'flow.expect visible "Next";',
  ].join('\n');
  assert.equal(parseTerminalFlow(source)[0].scenarios.length, 2);
});
const {runtimeFailure}=require('../../dist/reporting/runtime_failure');
for(const [action,payload,message] of [
 ['click',{selector:'#submit'},'locator.click: Timeout 100ms exceeded.\nCall log:\n - element is outside the viewport'],
 ['type',{selector:'#email',value:'private-typed-value'},'Input is not editable'],
 ['post',{url:'https://fixture.test/users',body:{password:'private-body-value'}},'HTTP 503: Service unavailable'],
 ['use',{sessionName:'Admin'},'Session Admin does not exist'],
 ['plugin',{pluginAlias:'fixtures',pluginMethod:'prepare'},'Fixture reset failed: missing account'],
 ['native',{pluginMethod:'game.select',data:{id:'player'}},'Game target player is occluded by overlay'],
 ['injectAudio',{path:'fixtures/voice.wav'},'ENOENT: microphone fixture not found'],
 ['mail',{text:'test inbox'},'FlowMail request rejected: HTTP 401'],
 ['extract',{selector:'table[0] tr[5] td[3]'},'Cell index 3 is out of range'],
 ['upload',{selector:'#file',path:'fixtures/upload.pdf'},'File chooser did not open'],
 ['native',{pluginMethod:'browser.use',data:{name:'customer'}},'Unknown browser profile customer']
])test(`all-feature failure pipeline preserves the exact cause and source for ${action} ${payload.pluginMethod||''}`,async()=>{const w=new FlowWorker({ci:true,timeout:100},{activeProfile:'customer',getPage:()=>({})},{},{},{},{});w.isSilent=true;w.currentFileName='feature.flow';w.captureStepContext=async()=>({});w.native.captureDOM=async()=>undefined;w.executeStep=async()=>{throw new Error(message,{cause:Object.assign(new Error('Underlying fixture failure'),{code:'E_FIXTURE'})});};const events=[];w.on('worker_event',e=>events.push(e));assert.equal(await w.runScenario({name:'Failure diagnostics',declarations:[],steps:[{id:'one',line:42,action,payload,blockDescription:'When "Perform operation"'}]}),false);const error=events.find(e=>e.type==='STEP_UPDATE').payload.error;assert.match(error,/Location: feature.flow:42/);assert(error.includes(message));assert.match(error,/Caused by: Underlying fixture failure/);assert.match(error,/Error code: E_FIXTURE/);assert(!error.includes('private-typed-value'));assert(!error.includes('private-body-value'));});
test('missing environment variables are reported at the command, not hidden as a vague file failure',async()=>{const w=new FlowWorker({ci:true,timeout:100},{activeProfile:'default',getPage:()=>({})},{},{},{},{});w.isSilent=true;w.currentFileName='env.flow';w.captureStepContext=async()=>({});w.native.captureDOM=async()=>undefined;let executed=false;w.executeStep=async()=>{executed=true};const events=[];w.on('worker_event',e=>events.push(e));await w.runScenario({name:'Environment',declarations:[],steps:[{id:'env',line:9,action:'open',payload:{url:'{{env.FLOWSTRIDE_INTENTIONALLY_MISSING_TEST_URL_2026}}'},blockDescription:'When "Open application"'}]});assert.equal(executed,false);const update=events.find(e=>e.type==='STEP_UPDATE');assert.equal(update.payload.status,'failed');assert.match(update.payload.error,/env.flow:9/);assert.match(update.payload.error,/FLOWSTRIDE_INTENTIONALLY_MISSING_TEST_URL_2026/);});
test('general diagnostics retain call logs but neutralize terminal injection, secrets and cyclic causes',()=>{const cause=new Error('password="never-show"\n\x1b[2Jcall log');cause.cause=cause;const text=runtimeFailure('click',{selector:'#submit',value:'do-not-print'},cause,{file:'case.flow',line:7});assert(!text.includes('never-show'));assert(!text.includes('do-not-print'));assert(!text.includes('\x1b'));assert.match(text,/call log/);assert.match(text,/case.flow:7/);});

test('packaged TypeScript plugins retain the compatible compiler API as a runtime dependency',()=>{const metadata=require('../../package.json');assert.equal(metadata.dependencies.typescript,'5.9.3');assert.equal(metadata.devDependencies.typescript,undefined);});

test('browser fill call logs cannot expose literal typed secrets or request passwords',()=>{const typed=runtimeFailure('type',{selector:{type:'input',value:'Password'},text:'private-literal-password'},new Error('locator.fill("private-literal-password") failed'),{file:'case.flow',line:4});assert(!typed.includes('private-literal-password'));assert.match(typed,/Password/);const api=runtimeFailure('post',{url:'https://fixture.test',reqBody:'{"password":"private-request-password"}'},new Error('request rejected for private-request-password'),{file:'case.flow'});assert(!api.includes('private-request-password'));});

test('a closed browser during evidence capture cannot replace the original failure',async()=>{const w=new FlowWorker({ci:true},{getPage:()=>{throw new Error('No browser page')}},{},{},{},{});assert.deepEqual(await w.captureStepContext({selector:'#submit'}),{});});
