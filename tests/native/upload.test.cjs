const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {WebAdapter}=require('../../dist/adapters/web/playwright');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(chooser,click){const file=path.join(fs.mkdtempSync(path.join(process.cwd(),'.flowstride-upload-')),'fixture.txt');fs.writeFileSync(file,'fixture');const adapter=new WebAdapter({headless:true,timeout:80});let saved;
 const locator={waitFor:async()=>{},scrollIntoViewIfNeeded:async()=>{},click,setInputFiles:async()=>{throw new Error('Not an input');}};
 adapter.getLocator=async()=>locator;adapter.checkAmbiguity=async value=>value;
 adapter.page={waitForEvent:(_name,options)=>{assert.equal(options.timeout,80);return chooser({setFiles:async value=>{saved=value;}});}};
 return{adapter,file,saved:()=>saved};}
test('slow chooser uses configured timeout and saves the actual file',async()=>{const h=setup(async chooser=>{await delay(30);return chooser;},async()=>{await delay(20);});await h.adapter.upload('#upload',h.file);assert.equal(h.saved(),h.file);});
test('chooser rejection before click completion is handled without unhandled rejection',async()=>{const unhandled=[];const onError=error=>unhandled.push(error);process.on('unhandledRejection',onError);try{const h=setup(async()=>{await delay(5);throw new Error('Chooser timed out');},async()=>{await delay(30);});await assert.rejects(h.adapter.upload('#upload',h.file),/Failed to upload/);await delay(50);assert.equal(unhandled.length,0);}finally{process.off('unhandledRejection',onError);}});
