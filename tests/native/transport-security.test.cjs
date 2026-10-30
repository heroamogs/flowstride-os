const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..');
const {cloudApiBase,cloudFetch,cloudRequestOptions,secureCloudUrl}=require(path.join(root,'dist/utils/cloud'));
for(const value of ['http://cloud.example.test','http://192.168.0.4','http://127.0.0.1.attacker.test','http://localhost.attacker.test','https://token@cloud.test','file:///tmp/secret'])test('control-plane URL rejects unsafe transport: '+value,()=>assert.throws(()=>cloudApiBase({FLOWSTRIDE_API_URL:value}),/HTTPS|credentials/));
for(const value of ['http://127.0.0.1:5000','http://localhost:5000/base','http://[::1]:5000','https://private.cloud.test/path'])test('secure overrides and loopback HTTP remain supported: '+value,()=>assert.equal(cloudApiBase({FLOWSTRIDE_API_URL:value}),value));
test('legacy override precedence and webhook normalization remain unchanged',()=>{
 assert.equal(cloudApiBase({FLOWSTRIDE_API_URL:'https://chosen.test/base/',NEXTJS_WEBHOOK_URL:'https://ignored.test'}),'https://chosen.test/base');assert.equal(cloudApiBase({NEXTJS_WEBHOOK_URL:'https://custom.test/base/api/cloud/execution-complete/'}),'https://custom.test/base');assert.throws(()=>cloudApiBase({FLOWSTRIDE_API_URL:'https://cloud.test?token=hidden'}));assert.throws(()=>cloudApiBase({FLOWSTRIDE_API_URL:'https://cloud.test#hidden'}));
});
test('Cloud fetch rejects unsafe URLs before handing credentials to a transport',async()=>{
 const saved=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response('{}');};try{await assert.rejects(cloudFetch('http://remote.test/api',{headers:{Authorization:'Bearer fixture'}}),/HTTPS/);assert.equal(calls,0);}finally{global.fetch=saved;}
});
test('Cloud fetch forces redirect rejection, preserves cancellation and adds a timeout by default',async()=>{
 const saved=global.fetch,calls=[],controller=new AbortController();global.fetch=async(url,options)=>{calls.push({url,options});return new Response('{}');};try{await cloudFetch('https://cloud.test/api',{redirect:'follow',signal:controller.signal});await cloudFetch('http://127.0.0.1:4000/api');assert(calls.every(c=>c.options.redirect==='error'));assert.equal(calls[0].options.signal,controller.signal);assert(calls[1].options.signal instanceof AbortSignal);}finally{global.fetch=saved;}
});
test('actual redirect cannot carry a Cloud credential to another server',async t=>{
 let targetRequests=0;const target=http.createServer((req,res)=>{targetRequests++;res.end('{}');});await new Promise(r=>target.listen(0,'127.0.0.1',r));const redirect=http.createServer((req,res)=>{res.writeHead(307,{Location:'http://127.0.0.1:'+target.address().port+'/stolen'});res.end();});await new Promise(r=>redirect.listen(0,'127.0.0.1',r));try{await assert.rejects(cloudFetch('http://127.0.0.1:'+redirect.address().port+'/api',{method:'POST',body:'sensitive-fixture',headers:{Authorization:'Bearer fixture'}}));assert.equal(targetRequests,0);}finally{for(const s of[redirect,target]){s.closeAllConnections();await new Promise(r=>s.close(r));}}
});
test('signed storage URLs require HTTPS remotely and retain signed query parameters',()=>{
 const signed='https://storage.test/key?X-Amz-Signature=fixture';assert.equal(secureCloudUrl(signed).toString(),signed);assert.deepEqual(cloudRequestOptions(signed,120000),{maxRedirects:0,timeout:120000});assert.throws(()=>cloudRequestOptions('http://storage.test/key?capability=fixture'),/HTTPS/);
});
test('every Axios Cloud/control-plane call disables redirects without changing application HTTP adapters',()=>{
 const ts=require('typescript');let count=0;
 for(const relative of['src/cli/index.ts','src/cli/commands/open.ts','src/cli/manual_server/workspace_server.ts','src/runner/flow_orchestrator.ts']){const file=path.join(root,relative);if(!fs.existsSync(file))continue;const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);function visit(node){if(ts.isCallExpression(node)&&/^axios\.(get|post|put)$/.test(node.expression.getText(tree))){count++;const verb=node.expression.name.text,options=node.arguments[verb==='get'?1:2];assert(options&&ts.isObjectLiteralExpression(options),relative+': missing options');assert(options.properties.some(p=>p.name?.getText(tree)==='maxRedirects'&&p.initializer?.getText(tree)==='0')||options.properties.some(p=>ts.isSpreadAssignment(p)&&/cloudRequestOptions|uploadOptions/.test(p.expression.getText(tree))),relative+': redirects not blocked');}ts.forEachChild(node,visit);}visit(tree);}
 if(require(path.join(root,'package.json')).name==='@flowstride/pro')assert(count>=7);else assert((fs.readFileSync(path.join(root,'src/cli/index.ts'),'utf8').match(/await cloudFetch\(/g)||[]).length>=3);const adapter=fs.readFileSync(path.join(root,'src/adapters/api/undici.ts'),'utf8');assert(!adapter.includes('secureCloudUrl'));
});
