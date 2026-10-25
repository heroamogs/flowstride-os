const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WebAdapter}=require('../../dist/adapters/web/playwright');
const {FlowWorker}=require('../../dist/runner/flow_worker');
for(const browser of ['chromium','firefox','webkit'])test(`native assertions and spies honor longer and shorter explicit timeouts on ${browser}`,async()=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-assertion-deadlines-'));
  const config={ci:true,headless:true,recordVideo:false,timeout:150,browser,projectRoot:project,artifactsDir:path.join(project,'evidence')};
  const web=new WebAdapter(config),w=new FlowWorker(config,web,{}, {}, {}, {});
  try{
    await web.initialise();const page=web.getPage();
    // Fixture startup has its own budget; command deadlines below remain 150/60 ms.
    await page.setContent('<h1 id="state">Pending</h1>',{timeout:10000});
    await page.evaluate(()=>setTimeout(()=>document.querySelector('h1').textContent='Ready',350));
    await w.executeStep('native',{pluginMethod:'assert.that',data:{selector:'#state',condition:'text',value:'Ready',timeout:1200}});
    await assert.rejects(w.executeStep('native',{pluginMethod:'assert.that',data:{selector:'#state',condition:'text',value:'Missing',timeout:60}}),/timed out|exceeded/);
    await assert.rejects(w.executeStep('native',{pluginMethod:'assert.that',data:{selector:'#state',condition:'text',value:'Missing'}}),/timed out|exceeded/);
    await page.evaluate(()=>setTimeout(()=>{const element=document.createElement('h2');element.id='late';element.textContent='Snapshot ready';document.body.append(element);},350));
    await w.executeStep('native',{pluginMethod:'a11y.snapshot',data:{name:'delayed',selector:'#late',timeout:1200}});
    assert(fs.readdirSync(config.artifactsDir).some(file=>file.endsWith('.aria.yml')));
    await page.evaluate(()=>setTimeout(()=>document.querySelector('#late').textContent='Updated snapshot',350));
    await w.executeStep('native',{pluginMethod:'a11y.match',data:{selector:'#late',yaml:'- heading "Updated snapshot" [level=2]',timeout:1200}});
    await page.evaluate(()=>{window.__deadlineFixture={call(){}};});
    await w.executeStep('native',{pluginMethod:'stub.install',data:{name:'delayed-call',target:'__deadlineFixture.call',mode:'spy'}});
    await page.evaluate(()=>setTimeout(()=>window.__deadlineFixture.call('ready'),350));
    await w.executeStep('native',{pluginMethod:'stub.expect',data:{name:'delayed-call',args:['ready'],minCount:1,timeout:1200}});
    await assert.rejects(w.executeStep('native',{pluginMethod:'stub.expect',data:{name:'delayed-call',minCount:2,timeout:60}}),/timed out|exceeded/);
    await assert.rejects(w.executeStep('native',{pluginMethod:'stub.expect',data:{name:'delayed-call',minCount:2}}),/timed out|exceeded/);
  }finally{await w.native.dispose();await web.shutdown();fs.rmSync(project,{recursive:true,force:true});}
});
