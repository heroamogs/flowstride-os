const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { sanitizeReplayRequest, replaySecretValues, maskedCurl } = require('../../dist/security/manualReplay');
const { redactPayload, redactWorkerPayload } = require('../../dist/security/redaction');
const { exportEvidence } = require('../../dist/security/evidence');
const { buildReplayRequest } = require('../../dist/utils/replayRequest');
const { FlowWorker } = require('../../dist/runner/flow_worker');
const request = () => ({ method:'POST', url:'https://fixture.invalid/login?email=person%40fixture.test&token=query-secret&emailVerified=false', headers:{'Content-Type':'application/json',Authorization:'Bearer header-secret',Cookie:'session=cookie-secret','Content-Length':'79','Accept-Encoding':'gzip',Connection:'X-Hop','X-Hop':'drop'}, body:JSON.stringify({email:'person@fixture.test',password:'body-secret',emailVerified:false,nested:[{emailVerified:true,emailVerificationToken:'verify-secret'}],note:"ordinary ' $HOME"}) });

test('email verification values and their types survive redaction; genuine secrets remain masked', () => {
  for (const flag of [true,false,0,1,null,'verified']) {
    const source={email:'person@fixture.test',password:'secret',emailVerified:flag,isEmailVerified:flag,email_verified:flag,emailVerificationToken:'secret-token'};
    const masked=redactPayload(source);
    assert.equal(masked.emailVerified,flag); assert.equal(masked.isEmailVerified,flag); assert.equal(masked.email_verified,flag);
    assert.equal(masked.email,'[REDACTED]'); assert.equal(masked.password,'[REDACTED]'); assert.equal(masked.emailVerificationToken,'[REDACTED]');
    assert.equal(source.email,'person@fixture.test');
  }
});
test('manual templates hide nested credentials, URL parameters, bearer tokens and cookies without mutating the request',()=>{
  const source=request(), masked=sanitizeReplayRequest(source), text=JSON.stringify(masked), body=JSON.parse(masked.body);
  for(const secret of ['person@fixture.test','person%40fixture.test','query-secret','header-secret','cookie-secret','body-secret','verify-secret'])assert(!text.includes(secret),secret);
  assert.equal(body.emailVerified,false);assert.equal(body.nested[0].emailVerified,true);assert.equal(body.note,"ordinary ' $HOME");
  assert.equal(masked.headers.Authorization,'Bearer [REDACTED]');assert.equal(masked.headers.Cookie,'session=[REDACTED]');
  assert.equal(new URL(masked.url).searchParams.get('emailVerified'),'false');assert.equal(JSON.parse(source.body).password,'body-secret');
});
test('form-encoded and nested stringified JSON credentials are masked while status fields remain useful',()=>{
  const form=sanitizeReplayRequest({method:'POST',url:'https://fixture.invalid',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'email=person%40fixture.test&password=body-secret&emailVerified=false'});
  const fields=new URLSearchParams(form.body);assert.equal(fields.get('email'),'[REDACTED]');assert.equal(fields.get('password'),'[REDACTED]');assert.equal(fields.get('emailVerified'),'false');
  const nested=sanitizeReplayRequest({body:JSON.stringify({variables:JSON.stringify({email:'nested@fixture.test',password:'nested-secret',emailVerified:false})})});
  const parsed=JSON.parse(JSON.parse(nested.body).variables);assert.equal(parsed.password,'[REDACTED]');assert.equal(parsed.emailVerified,false);
});
for(const [type,body] of [['application/json','{"email":"person@fixture.test",'],['multipart/form-data; boundary=x','--x\r\nname="password"\r\n\r\nsecret'],['application/octet-stream','opaque-private-data'],['text/plain','password="part one with spaces"']])test('opaque or malformed manual capture fails closed: '+type,()=>{
  const masked=sanitizeReplayRequest({method:'POST',url:'https://fixture.invalid',headers:{'Content-Type':type},body});assert.equal(masked.body,'[REDACTED]');assert.throws(()=>buildReplayRequest(masked),/Replace redacted/);
});
for(const body of ['0','false','null','""','', 'name=a%20b&value=%E2%9C%93', '{\n "ordinary": "keep spacing"\n}'])test('non-sensitive manual data keeps its exact bytes: '+JSON.stringify(body),()=>assert.equal(sanitizeReplayRequest({body}).body,body));
test('redacted placeholders are rejected from every effective request location, including encoded and escaped forms',()=>{
  for(const input of [
    {url:'https://fixture.invalid?email=%5BREDACTED%5D'},
    {url:'https://fixture.invalid',headers:{Authorization:'Bearer [REDACTED]'}},
    {url:'https://fixture.invalid',method:'POST',body:'{"email":"[REDACTED]","password":"[REDACTED]"}'},
    {url:'https://fixture.invalid',method:'POST',body:'email=%255BREDACTED%255D'},
    {url:'https://fixture.invalid',method:'POST',body:'"\\u005bREDACTED\\u005d"'},
  ]) assert.throws(()=>buildReplayRequest(input),error=>error.code==='REPLAY_REDACTED_FIELDS'&&/Replace redacted/.test(error.message));
  assert.doesNotThrow(()=>buildReplayRequest({url:'https://fixture.invalid',method:'GET',headers:{':authority':'[REDACTED]','Content-Length':'[REDACTED]'},body:'[REDACTED]'}));
});
test('the worker rejects placeholders before fetch even if the dashboard is bypassed',async()=>{
  const worker=new FlowWorker({ci:false,timeout:1000},{},{},{},{}),events=[];worker.on('worker_event',event=>events.push(event));
  const previous=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Network must not run');};
  try{await worker.handleReplayRequest({...sanitizeReplayRequest(request()),requestId:'blocked'});assert.equal(calls,0);const event=events.at(-1).payload;assert.equal(event.status,null);assert.equal(event.error,'REPLAY_REDACTED_FIELDS');assert.match(event.responseBody.error,/body.email/);assert.match(event.responseBody.error,/body.password/);assert.equal(event.requestId,'blocked');}
  finally{global.fetch=previous;}
});
test('a manually supplied token can authenticate without inventing a password; echoed credentials stay masked',async()=>{
  const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received.push({headers:req.headers,body});res.writeHead(req.headers.authorization==='Bearer supplied-token'?200:401,{'Content-Type':'application/json'});res.end(JSON.stringify({email:'person@fixture.test',emailVerified:false,echo:'supplied-token',token:'server-token'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const worker=new FlowWorker({ci:false,timeout:3000},{},{},{},{}),events=[];worker.on('worker_event',event=>events.push(event));await worker.handleReplayRequest({url:'http://127.0.0.1:'+server.address().port,method:'GET',headers:{Authorization:'Bearer supplied-token'},requestId:'manual'});assert.equal(received.length,1);assert.equal(received[0].body,'');const result=events.at(-1).payload;assert.equal(result.status,200);assert.equal(result.responseBody.emailVerified,false);assert.equal(result.responseBody.email,'[REDACTED]');assert.equal(result.responseBody.echo,'[REDACTED]');assert(!JSON.stringify(events).includes('supplied-token'));}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('copyable cURL is shell-quoted, masked, and lets curl own content length and compression',()=>{
  const curl=maskedCurl(request());for(const secret of ['person@fixture.test','query-secret','header-secret','cookie-secret','body-secret','verify-secret'])assert(!curl.includes(secret));
  assert(curl.startsWith("curl -X 'POST'"));assert(curl.includes('--data-raw'));assert(curl.includes('[REDACTED]'));assert(curl.includes("'\\''"));
  assert(!/content-length|accept-encoding|X-Hop:|Connection:/i.test(curl));assert.equal(maskedCurl({url:'file:///etc/passwd'}),'');
});
test('local, shared and portable events never restore raw secrets and retain emailVerified',()=>{
  const source=request(), input={type:'REST',details:{curlString:'curl raw-secret',rawReplayRequest:source,requestBody:JSON.parse(source.body),responseBody:{emailVerified:false,token:'response-secret'}}};
  const local=redactWorkerPayload('LOG_EVENT',input,[],true);assert(local.details.replayRequest);assert.equal(local.details.rawCurlString,undefined);assert.equal(local.details.rawReplayRequest,'[REDACTED]');assert.equal(local.details.responseBody.emailVerified,false);
  const serialized=JSON.stringify(local);for(const secret of ['body-secret','header-secret','cookie-secret','person@fixture.test','response-secret'])assert(!serialized.includes(secret));
  const exported=exportEvidence(local);assert.equal(exported.details.replayRequest,undefined);assert.equal(exported.details.responseBody.emailVerified,false);
  const ci=redactWorkerPayload('LOG_EVENT',input,[],false);assert.equal(ci.details.replayRequest,undefined);assert.equal(JSON.parse(source.body).password,'body-secret');
});
test('manual error-redaction values include JSON, form, query, cookie and bearer credentials',()=>{
  const values=replaySecretValues(request());for(const secret of ['body-secret','header-secret','cookie-secret','query-secret','person@fixture.test'])assert(values.includes(secret),secret);
  assert(replaySecretValues({body:'password=form-secret&email=form%40fixture.test'}).includes('form-secret'));
});
test('GraphQL literals and quoted opaque credentials are hidden without changing variable-based queries',()=>{
  const query='mutation { login(email: "inline@fixture.test", password: "part one with spaces") { emailVerified } }';
  const request={method:'POST',url:'https://fixture.invalid/graphql',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})};
  assert.equal(JSON.parse(sanitizeReplayRequest(request).body).query,'[REDACTED]');
  const values=replaySecretValues(request);assert(values.includes('part one with spaces'));assert(values.includes('inline@fixture.test'));
  assert(!JSON.stringify(redactPayload({echo:'part one with spaces'},values)).includes('part one with spaces'));
  const variableQuery='mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { emailVerified } }';
  assert.equal(JSON.parse(sanitizeReplayRequest({body:JSON.stringify({query:variableQuery,variables:{email:'user@fixture.test',password:'secret'}})}).body).query,variableQuery);
});
