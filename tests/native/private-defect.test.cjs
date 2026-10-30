const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..');
const {servePrivateDefect}=require(path.join(root,'dist/manual/privateMedia'));
const {localDefectPreviewUrl,isPrivateDefectKey}=require(path.join(root,'dist/manual/mediaReference'));
const key='workspaces/'+ '2'.repeat(24)+'/media/defect/12345678-1234-1234-1234-123456789abc.png';
async function fixture(mode='ok',credential='environment'){
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-private-defect-')),home=path.join(stage,'home');fs.mkdirSync(home);
 const calls=[];
 const cloud=http.createServer((req,res)=>{calls.push({url:req.url,authorization:req.headers.authorization,range:req.headers.range});
  if(mode==='redirect'){res.writeHead(307,{Location:'/trap'});res.end();return;}
  if(mode==='denied'){res.writeHead(401,{'Content-Type':'text/plain'});res.end('do-not-expose-storage-secret');return;}
  if(mode==='html'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<script>unsafe</script>');return;}
  const body=mode==='range'?'abcd':'image-fixture';
  res.writeHead(mode==='range'?206:200,{'Content-Type':mode==='range'?'video/webm':'image/png','Content-Length':mode==='oversize'?String(51*1024*1024):String(Buffer.byteLength(body)),'Set-Cookie':'must-not-forward=secret',...(mode==='range'?{'Content-Range':'bytes 0-3/12'}:{})});res.end(body);
 });await new Promise(resolve=>cloud.listen(0,'127.0.0.1',resolve));
 const env={FLOWSTRIDE_API_URL:`http://127.0.0.1:${cloud.address().port}`};
 if(credential==='environment')env.FLOWSTRIDE_TOKEN='environment-fixture-token';
 if(['project','global'].includes(credential)){
  const dir=path.join(credential==='project'?stage:home,'.flowstride');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'credentials.json'),JSON.stringify({machineToken:credential+'-fixture-token'}),{mode:0o600});
 }
 const proxy=http.createServer((req,res)=>{servePrivateDefect(req,res,{root:stage,home,env}).catch(error=>{res.destroy(error);});});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${proxy.address().port}`;
 return {calls,origin,async close(){proxy.closeAllConnections();cloud.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>cloud.close(r))]);fs.rmSync(stage,{recursive:true,force:true});}};
}
test('private and legacy defect references use loopback previews without changing stored URLs',()=>{
 const raw='https://cloud.test/api/upload/media?key='+encodeURIComponent(key);
 assert.equal(localDefectPreviewUrl(raw),'/api/defect-preview?key='+encodeURIComponent(key));
 assert.equal(localDefectPreviewUrl('https://store.test/'+key),'/api/defect-preview?key='+encodeURIComponent(key));
 for(const raw of ['/defect_media/local.png','/media/design.png','https://example.test/image.png'])assert.equal(localDefectPreviewUrl(raw),raw);
 for(const bad of ['../outside',key+'\n',key.replace('/defect/','/video/'),key.replace('.png','.svg')])assert.equal(isPrivateDefectKey(bad),false);
});
for(const credential of ['environment','project','global'])test(`private preview authenticates using ${credential} credentials only on the server`,async()=>{
 const app=await fixture('ok',credential);try{
  const res=await fetch(app.origin+'/api/defect-preview?key='+encodeURIComponent(key));assert.equal(res.status,200);assert.equal(await res.text(),'image-fixture');
  assert.equal(app.calls[0].authorization,'Bearer '+credential+'-fixture-token');assert(!app.calls[0].url.includes('token'));
  assert.equal(res.headers.get('set-cookie'),null);assert.equal(res.headers.get('location'),null);assert.match(res.headers.get('cache-control'),/private, no-store/);
 }finally{await app.close();}
});
test('video previews preserve byte ranges for seeking',async()=>{
 const app=await fixture('range');try{const res=await fetch(app.origin+'/api/defect-preview?key='+encodeURIComponent(key.replace('.png','.webm')),{headers:{Range:'bytes=0-3'}});assert.equal(res.status,206);assert.equal(await res.text(),'abcd');assert.equal(res.headers.get('content-range'),'bytes 0-3/12');assert.equal(app.calls[0].range,'bytes=0-3');}finally{await app.close();}
});
for(const [mode,status]of [['denied',401],['html',502],['oversize',502],['redirect',502]])test(`private preview rejects ${mode} without leaking credentials or following redirects`,async()=>{
 const app=await fixture(mode);try{const res=await fetch(app.origin+'/api/defect-preview?key='+encodeURIComponent(key));assert.equal(res.status,status);assert(!/secret|fixture-token/.test(await res.text()));assert.equal(app.calls.length,1);assert(!app.calls[0].url.includes('/trap'));}finally{await app.close();}
});
test('missing credentials and invalid keys/ranges never contact Cloud',async()=>{
 const app=await fixture('ok','none');try{
  assert.equal((await fetch(app.origin+'/api/defect-preview?key='+encodeURIComponent(key))).status,401);
  for(const bad of ['../../outside',key+'\n',key.replace('.png','.svg'),key.replace('/defect/','/video/')])assert.equal((await fetch(app.origin+'/api/defect-preview?key='+encodeURIComponent(bad))).status,400);
  assert.equal((await fetch(app.origin+'/api/defect-preview?key='+encodeURIComponent(key),{headers:{Range:'bytes=0-1,3-4'}})).status,416);
  assert.equal(app.calls.length,0);
 }finally{await app.close();}
});
