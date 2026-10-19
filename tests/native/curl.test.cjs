const {test}=require('node:test');const assert=require('node:assert/strict');
const {redactPayload,redactWorkerPayload}=require('../../dist/security/redaction');
const {isLocalDashboardRequest}=require('../../dist/security/localDashboard');
const {FlowWorker}=require('../../dist/runner/flow_worker'),{WebAdapter}=require('../../dist/adapters/web/playwright');
const token='fst_fixture_secret',body=JSON.stringify({email:'fixture@example.test',password:"a' b $HOME",note:'ordinary field'}),headers={Authorization:'Bearer '+token,Cookie:'session=fixture-secret','Content-Type':'application/json'};
for(const ci of [false,true,undefined])test(`actual worker API telemetry: ci=${ci} preserves raw cURL only in explicit local mode`,()=>{
 const web=new WebAdapter({ci}),api={getState:()=>({status:200,headers:{'set-cookie':'fixture'},body:{token,ok:true}})},worker=new FlowWorker({ci,machineToken:token},web,api,{},{}),events=[];worker.on('worker_event',event=>events.push(event));
 worker.emitApiTelemetry('post',"http://127.0.0.1:3000/api/login?note='literal'",headers,body);
 const log=events.find(e=>e.type==='LOG_EVENT').payload,network=events.find(e=>e.type==='NETWORK_REQ').payload;
 assert.equal(log.details.curlString,'[REDACTED]');assert.equal(network.curlString,'[REDACTED]');assert.equal(network.rawCurlString,undefined);
 if(ci===false){assert(log.details.rawCurlString.startsWith('curl -X POST'));assert(log.details.rawCurlString.includes(token));assert(log.details.rawCurlString.includes('ordinary field'));assert(log.details.rawCurlString.includes("'\\''"));}
 else {assert.equal(log.details.rawCurlString,undefined);assert(!JSON.stringify(events).includes(token));assert(!JSON.stringify(events).includes('fixture@example.test'));}
 assert.equal(log.details.requestHeaders.Authorization,'[REDACTED]');assert.equal(log.details.requestBody.password,'[REDACTED]');assert.equal(log.details.responseBody.token,'[REDACTED]');
 const shared=JSON.stringify(redactPayload(events,[token]));assert(!shared.includes(token));assert(!shared.includes('fixture@example.test'));assert(!shared.includes('curl -X')); // entire cURL is removed at shared/report boundaries
});
test('raw cURL exception is narrow and never mutates original values',()=>{
 const payload={type:'ACTION',details:{curlString:'curl secret',password:'hidden'}};assert.equal(redactWorkerPayload('LOG_EVENT',payload,[],true).details.curlString,'[REDACTED]');assert.equal(payload.details.password,'hidden');assert.equal(redactWorkerPayload('STEP_UPDATE',{curlString:'curl secret'},[],true).curlString,'[REDACTED]');
});
for(const [host,origin,expected] of [['localhost:1234','http://localhost:1234',true],['127.0.0.1:1234','http://127.0.0.1:1234',true],['[::1]:1234','http://[::1]:1234',true],['evil.test:1234',undefined,false],['localhost:1234','https://evil.test',false],['localhost:1234','http://localhost:5678',false],['localhost:1234','null',false],['localhost:1234','http://user:pass@localhost:1234',false],['localhost',undefined,false],[undefined,undefined,false]])test(`dashboard Host/Origin policy: ${host} / ${origin}`,()=>assert.equal(isLocalDashboardRequest(host,origin),expected));
