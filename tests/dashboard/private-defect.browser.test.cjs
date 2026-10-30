const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{createRequire}=require('node:module');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),req=createRequire(path.join(root,'package.json')),ui=createRequire(path.join(root,'src/ui/package.json'));
const {servePrivateDefect}=req('./dist/manual/privateMedia'),{chromium}=req('playwright');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0J8AAAAASUVORK5CYII=','base64');
test('manual screenshot and video previews work through server-only credentials in the real UI',{timeout:60000},async()=>{
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-private-ui-'));let browser,cloud,server;
 try{
  browser=await chromium.launch({headless:true});
  const recording=await browser.newContext({recordVideo:{dir:stage,size:{width:320,height:200}}}),capture=await recording.newPage();
  await capture.setContent('<h1>Private video fixture</h1>');await capture.screenshot();await new Promise(resolve=>setTimeout(resolve,250));await recording.close();
  const video=fs.readFileSync(await capture.video().path());const calls=[];
  cloud=http.createServer((request,response)=>{calls.push({url:request.url,authorization:request.headers.authorization});const isVideo=request.url.includes('.webm'),body=isVideo?video:pixel;
   const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'');const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),body.length-1):body.length-1;
   response.writeHead(match?206:200,{'Content-Type':isVideo?'video/webm':'image/png','Content-Length':String(end-start+1),'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})});response.end(body.subarray(start,end+1));
  });await new Promise(resolve=>cloud.listen(0,'127.0.0.1',resolve));
  const env={FLOWSTRIDE_API_URL:`http://127.0.0.1:${cloud.address().port}`,FLOWSTRIDE_TOKEN:'server-only-fixture-token'};
  const key=`workspaces/${'2'.repeat(24)}/media/defect/12345678-1234-1234-1234-123456789abc`;
  const references=['.png','.webm'].map(ext=>'https://cloud.example/api/upload/media?key='+encodeURIComponent(key+ext)).join(',');
  const bundle=await ui('esbuild').build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TestReportPanel}from'./src/components/TestReportPanel';window.storedReferences=${JSON.stringify(references)};createRoot(document.getElementById('root')).render(React.createElement(TestReportPanel,{isReadOnly:true,report:[{id:1,title:'Private attachment check',description:'Fixture',status:'Failed',defect_report:'Fixture failure',defect_media:window.storedReferences}]}));`,resolveDir:path.join(root,'src/ui'),loader:'tsx'},absWorkingDir:path.join(root,'src/ui'),bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
  server=http.createServer((request,response)=>{if(request.url.startsWith('/api/defect-preview'))return void servePrivateDefect(request,response,{root:stage,home:stage,env});response.setHeader('Content-Type','text/html');response.end('<div id="root"></div>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,page=await browser.newPage(),requests=[],errors=[];
  page.on('request',request=>requests.push({url:request.url(),authorization:request.headers().authorization}));page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'Failure Details'}).click();await page.getByRole('button',{name:'Screenshot',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('img')].some(image=>image.src.includes('/api/defect-preview')&&image.complete&&image.naturalWidth>0));
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(video=>video.src.includes('/api/defect-preview')&&video.readyState>=1));
  await page.locator('img[alt="Defect Evidence 0"]').click();await page.getByTitle('Close Preview').waitFor();
  assert.equal(await page.evaluate(()=>window.storedReferences),references);
  assert(calls.length>=2&&calls.every(call=>call.authorization==='Bearer server-only-fixture-token'));
  assert(requests.every(request=>request.url.startsWith(origin)&&!request.authorization&&!request.url.includes('fixture-token')));
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();for(const app of [server,cloud])if(app){app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}fs.rmSync(stage,{recursive:true,force:true});}
});
