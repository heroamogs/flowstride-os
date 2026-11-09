const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {WebAdapter}=require('../../dist/adapters/web/playwright'),{NativeRuntime}=require('../../dist/native/runtime');
async function fixture(browser){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-batch5-browser-')));fs.mkdirSync(path.join(dir,'fixtures/folder/nested'),{recursive:true});fs.writeFileSync(path.join(dir,'fixtures/one.txt'),'first file');fs.writeFileSync(path.join(dir,'fixtures/two.json'),'{"second":true}');fs.writeFileSync(path.join(dir,'fixtures/folder/a.txt'),'folder first');fs.writeFileSync(path.join(dir,'fixtures/folder/nested/b.txt'),'folder second');
 const frame=`<!doctype html><label>Attach documents<input id="frame-files" type="file" multiple></label><input type="file" id="frame-chooser" multiple hidden><button onclick="document.querySelector('#frame-chooser').click()">Frame chooser</button>`;
 const html=`<!doctype html><html><body><h1>Ready</h1><form aria-label="Customer application"><label>Attach documents<input id="multiple" type="file" multiple></label><label>Single document<input id="single" type="file"></label><label>Folder<input id="folder" type="file" webkitdirectory></label></form><form aria-label="Other application"><label>Attach documents<input id="other" type="file" multiple></label></form><input type="file" id="hidden" aria-label="Hidden attachments" multiple hidden><input type="file" id="chooser" multiple hidden><button onclick="document.querySelector('#chooser').click()">Choose documents</button><button onclick="document.body.dataset.noChooser=String(Number(document.body.dataset.noChooser||0)+1)">No chooser</button><iframe title="Attachment frame" src="/frame"></iframe></body></html>`;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/frame'?frame:html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const config={projectRoot:dir,timeout:1000,headless:true,browser,recordVideo:false,ci:true},web=new WebAdapter(config);let cancelled=false;const native=new NativeRuntime(web,config,{cancelled:()=>cancelled,delay:ms=>new Promise(r=>setTimeout(r,ms))});await web.initialise();await web.navigate('http://127.0.0.1:'+server.address().port);await web.getPage().frameLocator('iframe').locator('#frame-files').waitFor();
 return{web,native,dir,abort:()=>{cancelled=true},close:async()=>{await native.dispose();await web.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};
}
async function selected(locator){return locator.evaluate(async element=>Promise.all([...element.files].map(async file=>({name:file.name,type:file.type,text:await file.text(),relative:file.webkitRelativePath}))));}
for(const browser of ['chromium','firefox','webkit'])test(`${browser}: textual/spatial multiple files, hidden inputs, clear, chooser and iframe ownership`,{timeout:45000},async()=>{
 const f=await fixture(browser),{web,native}=f,page=web.getPage();try{
 const files=['fixtures/one.txt','fixtures/two.json'];await assert.rejects(native.execute('files.select',{target:'Attach documents',files}),/Ambiguous file input/);
 const target={text:'Attach documents',element:'input',inside:'Customer application'};await native.execute('files.select',{target,files});assert.deepEqual((await selected(page.locator('#multiple'))).map(v=>[v.name,v.type,v.text]),[['one.txt','text/plain','first file'],['two.json','application/json','{"second":true}']]);assert.equal((await selected(page.locator('#other'))).length,0);
 await native.execute('files.select',{target,files:[]});assert.equal((await selected(page.locator('#multiple'))).length,0);
 await native.execute('files.select',{target:{text:'Hidden attachments',element:'input'},files});assert.equal((await selected(page.locator('#hidden'))).length,2);
 await native.execute('files.select',{target:{text:'Choose documents',element:'button'},files});assert.equal((await selected(page.locator('#chooser'))).length,2);
 await assert.rejects(native.execute('files.select',{target:'Single document',files}),/accepts one file/);assert.equal((await selected(page.locator('#single'))).length,0);
 await native.execute('files.select',{selector:'#single',files:['fixtures/one.txt']});assert.equal((await selected(page.locator('#single')))[0].text,'first file');
 await native.execute('frame.use',{target:'Attachment frame'});await native.execute('files.select',{target:{text:'Attach documents',element:'input'},files});assert.equal((await selected(page.frameLocator('iframe').locator('#frame-files'))).length,2);assert.equal((await selected(page.locator('#multiple'))).length,0);await native.execute('frame.main',{});
 await native.execute('files.select',{target:{text:'Frame chooser',element:'button'},files});assert.equal((await selected(page.frameLocator('iframe').locator('#frame-chooser'))).length,2);
 await assert.rejects(native.execute('files.select',{target:{text:'Choose documents',element:'button'},files:[]}),/Clearing.*direct/);
 await assert.rejects(native.execute('files.select',{target:{text:'No chooser',element:'button'},files,timeout:1200}),/timed out/);assert.equal(page.listenerCount('filechooser'),0);
 assert.equal(fs.readFileSync(path.join(f.dir,'fixtures/one.txt'),'utf8'),'first file');
 }finally{await f.close();}
});
for(const browser of ['chromium','firefox','webkit'])test(`${browser}: directory inputs preserve relative paths and staged copies are cleaned`,{timeout:45000},async()=>{
 const f=await fixture(browser),{web,native}=f,page=web.getPage();try{
 await native.execute('files.select',{target:'Folder',directory:'fixtures/folder'});const files=await selected(page.locator('#folder'));assert.equal(files.length,2);assert.deepEqual(files.map(v=>v.text).sort(),['folder first','folder second']);assert(files.some(v=>v.relative==='folder/a.txt'));assert(files.some(v=>v.relative==='folder/nested/b.txt'));
 await native.execute('files.select',{selector:'#folder',files:[]});assert.equal((await selected(page.locator('#folder'))).length,0);
 await assert.rejects(native.execute('files.select',{target:'Single document',directory:'fixtures/folder'}),/does not support directory/);await assert.rejects(native.execute('files.select',{target:'Folder',files:['fixtures/one.txt']}),/selects directories/);
 const staged=[...native.files.stagingPaths.keys()];assert.equal(staged.length,1);assert(staged.every(folder=>fs.existsSync(folder)));await native.dispose();assert(staged.every(folder=>!fs.existsSync(folder)));
 }finally{await f.close();}
});
test('pending chooser cancellation detaches handlers and cannot upload after cleanup',{timeout:20000},async()=>{
 const f=await fixture('chromium'),page=f.web.getPage();try{
 const run=f.native.execute('files.select',{target:{text:'No chooser',element:'button'},files:['fixtures/one.txt'],timeout:1000});await page.waitForFunction(()=>document.body.dataset.noChooser==='1');f.abort();await f.native.dispose();await assert.rejects(run,/cancel/);assert.equal(page.listenerCount('filechooser'),0);assert.equal((await selected(page.locator('#chooser'))).length,0);
 }finally{await f.close();}
});
test('upload symlinks/private runtime files and excessive selections fail before clearing existing files',{timeout:20000},async()=>{
 const f=await fixture('chromium'),{web,native}=f,page=web.getPage();try{
 await native.execute('files.select',{selector:'#single',files:['fixtures/one.txt']});fs.mkdirSync(path.join(f.dir,'.flowstride'),{recursive:true});fs.writeFileSync(path.join(f.dir,'.flowstride/credentials.json'),'private-token');
 fs.symlinkSync(path.join(f.dir,'.flowstride/credentials.json'),path.join(f.dir,'fixtures/folder/private.json'));
 for(const input of [{selector:'#single',files:['.flowstride/credentials.json']},{selector:'#single',files:['fixtures/folder/private.json']},{selector:'#folder',directory:'fixtures/folder'},{selector:'#multiple',files:Array(101).fill('fixtures/one.txt')}])await assert.rejects(native.execute('files.select',input));
 assert.equal((await selected(page.locator('#single')))[0].text,'first file');assert.equal((await selected(page.locator('#folder'))).length,0);
 }finally{await f.close();}
});
