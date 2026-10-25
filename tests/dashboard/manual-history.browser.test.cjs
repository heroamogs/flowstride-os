const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json'));
const {chromium}=req('playwright'),{WebSocketServer}=req('ws');

test('built manual history preserves each saved title, literal text and new-flow naming',{timeout:40000},async()=>{
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-manual-history-'));
  const filename=path.join(root,'dist/cli/manual_server/workspace_server.js'),requireServer=createRequire(filename);
  let server,sockets,browser,page;
  const original=fs.readFileSync(filename,'utf8');assert(/await import\(["']open["']\)/.test(original));
  const code=original.replace(/await import\(["']open["']\)/,'Promise.resolve({default:async()=>{}})');
  const module={exports:{}},deps={http:{...http,createServer(...args){server=http.createServer(...args);return server;}},os:{...os,homedir:()=>stage},ws:{...req('ws'),WebSocketServer:class extends WebSocketServer{constructor(options){super(options);sockets=this;}}}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>name in deps?deps[name]:requireServer(name),process:{env:{},cwd:()=>stage,on(){},exit(code){throw Error('Unexpected exit '+code);}},__dirname:path.dirname(filename),Buffer,URL,setTimeout,clearTimeout,console:{log(){},warn(){},error(){}}});
  await module.exports.startManualWorkspaceServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const attack='<img src="https://attacker.invalid/title" onerror="globalThis.titleInjected=1">';
  const names=['Saved account review',attack];
  const canvas={nodes:[{id:1,x:100,y:100,width:300,height:160,title:'Check the account',description:'Local fixture',steps:'<p>Inspect the sample.</p>',expected_result:'<p>The sample matches.</p>'}],groups:[],texts:[],connections:[],executionReport:[{id:1,title:'Check the account',description:'Local fixture',status:'Passed'}]};
  try{
    for(let i=0;i<names.length;i++){
      const response=await fetch(origin+'/api/save-run',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({filename:'history-'+i+'.json',canvasData:{...canvas,metadata:{flowName:names[i],version:'1.0',testPlan:'TP-HISTORY',environment:'Local',lastUpdatedBy:'Test fixture'}}})});assert.equal(response.status,200);
    }
    browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
    const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('attacker.invalid'))external.push(request.url());});
    await page.goto(origin);await page.getByRole('button',{name:'Design Mode',exact:true}).waitFor();
    for(let i=0;i<names.length;i++){
      await page.getByText('Runs',{exact:true}).click();
      await page.getByRole('cell',{name:'history-'+i,exact:true}).click();
      await page.getByText('PASSED',{exact:true}).first().waitFor();
      assert.equal(await page.locator('h1').textContent(),names[i]);
      const frame=await (await page.locator('iframe').first().elementHandle()).contentFrame();
      await frame.waitForFunction(()=>window.flowstrideEngineAPI?.exportDesignState().nodes.length===1);
      assert.equal(await frame.evaluate(()=>window.flowstrideEngineAPI.exportDesignState().nodes[0].title),'Check the account');
      assert.equal(await page.locator('img[src="https://attacker.invalid/title"]').count(),0);
      assert.equal(await page.evaluate(()=>globalThis.titleInjected),undefined);
      if(process.env.FLOWSTRIDE_HISTORY_EVIDENCE){fs.mkdirSync(process.env.FLOWSTRIDE_HISTORY_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.FLOWSTRIDE_HISTORY_EVIDENCE,`history-${i}.png`),fullPage:true});}
    }
    const newFlowName=req('./package.json').name==='flowstride'?'New Local Flow':'New Flow';
    await page.reload();await page.waitForFunction(name=>document.querySelector('h1')?.textContent===name,newFlowName);
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  }catch(error){
    if(page&&process.env.FLOWSTRIDE_HISTORY_EVIDENCE){fs.mkdirSync(process.env.FLOWSTRIDE_HISTORY_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.FLOWSTRIDE_HISTORY_EVIDENCE,'failure.png'),fullPage:true}).catch(()=>{});}
    throw error;
  }finally{
    await browser?.close();for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(stage,{recursive:true,force:true});
  }
});
