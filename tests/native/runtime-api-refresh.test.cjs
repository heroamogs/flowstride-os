const {test}=require('node:test');
const assert=require('node:assert/strict'),http=require('node:http');
const {ApiAdapter}=require('../../dist/adapters/api/undici');
const {Parser}=require('../../dist/parser/parser'),{Lexer}=require('../../dist/parser/lexer');
const {FlowWorker}=require('../../dist/runner/flow_worker');
const cloud=require('../../package.json').name==='@flowstride/pro';
function parse(command){return new Parser(new Lexer(`Feature: Refresh\nScenario: Authentication\nGiven "Refresh registered"\n${command}\nWhen "Protected data"\nflow.get "/protected";\nThen "Success"\nflow.expect status "200";`).tokenise()).parse()[0].scenarios[0].steps[0];}
async function fixture(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{url:'http://127.0.0.1:'+server.address().port,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}
function worker(api){return new FlowWorker({ci:true,timeout:1000},{},api,{}, {}, {});}

test('refresh grammar normalizes the HTTP verb and rejects unrelated commands/statuses',()=>{
  for(const verb of ['get','post','put','patch','delete']){
    const step=parse(`flow.autoheal "401" via flow.${verb} "/refresh";`);
    assert.equal(step.action,'autoHeal');assert.equal(step.payload.verb,verb);
  }
  for(const verb of ['open','graphql','expect'])assert.throws(()=>parse(`flow.autoheal "401" via flow.${verb} "/refresh";`),/HTTP verb/);
  for(const status of ['500','401xyz','0'])assert.throws(()=>parse(`flow.autoheal "${status}" via flow.post "/refresh";`),/401 or 403/);
});
test('OS retains the Cloud-only refresh boundary',async()=>{
  if(cloud)return;
  const step=parse('flow.autoheal "401" via flow.post "/refresh";');
  await assert.rejects(worker(new ApiAdapter({})).executeStep(step.action,step.payload),/Enterprise feature/);
});
test('adapter refresh updates authentication headers and retries the protected request once',async()=>{
  let requests=0,refreshes=0;
  const app=await fixture((req,res)=>{requests++;res.setHeader('Content-Type','application/json');if(req.headers.authorization==='Bearer renewed'){res.end('{"ok":true}');}else{res.statusCode=401;res.end('{"error":"unauthorized"}');}});
  try{
    const api=new ApiAdapter({baseUrl:app.url});api.setUnauthorizedHandler(async()=>{refreshes++;api.setGlobalHeader('Authorization','Bearer renewed');});
    await api.get('/protected');assert.equal(requests,2);assert.equal(refreshes,1);assert.equal(api.getState().status,200);assert.deepEqual(api.getState().body,{ok:true});
  }finally{await app.close();}
});
for(const trigger of [401,403])test(`parsed Cloud refresh recovers a ${trigger} without invalid method dispatch`,async()=>{
  if(!cloud)return;
  let ready=false,refreshes=0,protectedCalls=0,requestBody,header;
  const app=await fixture(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/refresh'){
      refreshes++;header=req.headers['x-refresh'];assert.equal(req.method,'POST');let body='';for await(const chunk of req)body+=chunk;requestBody=JSON.parse(body);ready=true;res.end('{"renewed":true}');return;
    }
    protectedCalls++;res.statusCode=ready?200:trigger;res.end(ready?'{"ok":true}':'{"error":"auth"}');
  });
  try{
    const api=new ApiAdapter({baseUrl:app.url}),w=worker(api);
    const step=parse(`flow.autoheal "${trigger}" via flow.post "${app.url}/refresh" with reqHeader "X-Refresh" "fixture" with reqBody\n"""\n{"refresh":"local-fixture"}\n"""`);
    await w.executeStep(step.action,step.payload);await api.get('/protected');
    assert.equal(api.getState().status,200);assert.equal(refreshes,1);assert.equal(protectedCalls,2);assert.equal(header,'fixture');assert.deepEqual(requestBody,{refresh:'local-fixture'});
  }finally{await app.close();}
});
test('refresh only runs for its configured authorization status',async()=>{
  let refreshes=0;const app=await fixture((_req,res)=>{res.statusCode=401;res.end('{}');});
  try{const api=new ApiAdapter({baseUrl:app.url});api.setUnauthorizedHandler(async()=>{refreshes++;},403);await api.get('/protected');assert.equal(refreshes,0);assert.equal(api.getState().status,401);assert.throws(()=>api.setUnauthorizedHandler(async()=>{},500),/401 or 403/);}finally{await app.close();}
});
test('an adapter refresh request cannot recursively refresh itself',async()=>{
  let calls=0,refreshes=0;const app=await fixture((_req,res)=>{calls++;res.statusCode=calls>5?500:401;res.end('{}');});
  try{
    const api=new ApiAdapter({baseUrl:app.url});
    api.setUnauthorizedHandler(async()=>{refreshes++;await api.post('/refresh',[], '{}');if(api.getState().status!==200)throw Error('Refresh rejected');});
    await assert.rejects(api.get('/protected'),/Refresh rejected/);assert.equal(calls,2);assert.equal(refreshes,1);
    // Failure clears the guard so a later request can try again.
    await assert.rejects(api.get('/protected'),/Refresh rejected/);assert.equal(calls,4);assert.equal(refreshes,2);
  }finally{await app.close();}
});
test('Cloud refresh rejects a failing refresh response without replaying the protected request',async()=>{
  if(!cloud)return;
  let calls=0;const app=await fixture((_req,res)=>{calls++;res.statusCode=calls>5?500:401;res.end('{}');});
  try{
    const api=new ApiAdapter({baseUrl:app.url}),w=worker(api),step=parse('flow.autoheal "401" via flow.post "/refresh";');
    await w.executeStep(step.action,step.payload);await assert.rejects(api.get('/protected'),/Authentication refresh failed/);assert.equal(calls,2);
    await assert.rejects(w.executeStep('autoHeal',{verb:'__proto__',url:'/refresh',targetStatus:'401'}),/HTTP verb/);
  }finally{await app.close();}
});
