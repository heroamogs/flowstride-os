const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..');
const {cloudFailure}=require(path.join(root,'dist/utils/cloud'));
const {loadCloudEnvironment,tokenExpiryDescription}=require(path.join(root,'dist/cli/utils/cloudSession'));
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-token-cli-'));}
function execute(args,cwd,extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'dist/cli/index.js'),...args],{cwd,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),CI:'true',...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('CLI timed out: '+output));},30000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);resolve({code,output});});});}
test('generic 401 does not diagnose expiry, but explicit Cloud error codes do',()=>{
 const generic=cloudFailure({response:{status:401},code:'ERR_BAD_REQUEST'});assert(!generic.message.includes('expired'));assert.match(generic.message,/does not confirm expiration/);
 for(const [code,word,status] of [['TOKEN_EXPIRED','expired',401],['TOKEN_REVOKED','revoked',401],['TOKEN_INVALID','credential source',401],['TOKEN_SCOPE_DENIED','scope',403]])assert(cloudFailure({response:{status,data:{code}}}).message.includes(word));
 assert(!cloudFailure({response:{status:500,data:{code:'TOKEN_EXPIRED'}}}).message.includes('expired'));
 assert.match(tokenExpiryDescription({tokenExpiresAt:'2026-11-19T12:00:00Z',tokenScope:'execution'}),/2026-11-19T12:00:00.000Z/);assert.match(tokenExpiryDescription({}),/unavailable/);assert(!tokenExpiryDescription({tokenExpiresAt:'bad'}).includes('Invalid Date'));
});
test('environment profiles load before authentication, retain shell precedence, and reject traversal',()=>{
 const dir=temporary(),keys=['FLOWSTRIDE_API_URL','FLOWSTRIDE_TOKEN','NEXTJS_WEBHOOK_URL'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{for(const key of keys)delete process.env[key];fs.writeFileSync(path.join(dir,'.env'),'FLOWSTRIDE_API_URL=https://default.test\nFLOWSTRIDE_TOKEN=default-token\n');fs.writeFileSync(path.join(dir,'.env.preview'),'FLOWSTRIDE_API_URL=https://profile.test\nFLOWSTRIDE_TOKEN=profile-token\n');assert.equal(loadCloudEnvironment(dir,'preview'),'https://profile.test');assert.equal(process.env.FLOWSTRIDE_TOKEN,'profile-token');process.env.FLOWSTRIDE_API_URL='https://shell.test';assert.equal(loadCloudEnvironment(dir,'preview'),'https://shell.test');assert.throws(()=>loadCloudEnvironment(dir,'../../outside'),/profile/);}
 finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];fs.rmSync(dir,{recursive:true,force:true});}
});
test('real CLI rejects expired login without overwriting credentials; .env login and reporting use the same token and Cloud URL',{timeout:90000},async()=>{
 const dir=temporary(),calls=[];let rejectLogin=true;
 const expiry='2099-01-01T00:00:00.000Z',token='fst_local_fixture_token';
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  calls.push({path:req.url,authorization:req.headers.authorization,body});res.setHeader('Content-Type','application/json');
  const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  if(req.url==='/api/auth/cli-sync'){if(rejectLogin)return reply(401,{code:'TOKEN_EXPIRED',error:'Expired'});return reply(200,{machineToken:token,workspaceId:'test-workspace',isProEligible:true,tokenExpiresAt:expiry,tokenScope:'execution'});}
  if(req.url==='/api/auth/verify-cli')return reply(200,{workspaceName:'Fixture',tier:'business',tokenExpiresAt:expiry,tokenScope:'execution'});
  if(req.url==='/api/workspace/status')return reply(200,{workspace:{_id:'test-workspace',name:'Fixture',plan:'business'},manifest:{maxWorkers:2,features:[]},tokenExpiresAt:expiry,tokenScope:'execution'});
  if(req.url==='/api/workspace/pro-version')return reply(200,{version:'1.0.14'});
  if(req.url==='/api/runs')return reply(200,{success:true,runId:'fixture-run'});
  if(req.url==='/fixture')return reply(200,{ok:true});
  return reply(404,{error:'Unexpected fixture endpoint'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  fs.mkdirSync(path.join(dir,'.flowstride'));const credentials=path.join(dir,'.flowstride/credentials.json'),old=JSON.stringify({machineToken:'old-saved-key'});fs.writeFileSync(credentials,old);
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({private:true,dependencies:{flowstride:'file:fixture'}}));
  fs.mkdirSync(path.join(dir,'node_modules/@flowstride/pro'),{recursive:true});
  const proRoot=process.env.FLOWSTRIDE_PRO_SOURCE;if(proRoot){fs.rmdirSync(path.join(dir,'node_modules/@flowstride/pro'));fs.symlinkSync(proRoot,path.join(dir,'node_modules/@flowstride/pro'),'dir');}
  fs.writeFileSync(path.join(dir,'.env'),`FLOWSTRIDE_API_URL=${origin}\nFLOWSTRIDE_TOKEN="  ${token}  "\n`);
  // Prevent a regression from contacting production when the CLI reads Cloud configuration too early.
  const preload=path.join(dir,'guard.cjs');fs.writeFileSync(preload,`const http=require('node:http'),https=require('node:https');for(const mod of [http,https]){const original=mod.request;mod.request=function(...args){const a=args[0],host=typeof a==='string'?new URL(a).hostname:a.hostname||a.host;if(!['127.0.0.1','localhost'].includes(host))throw Error('Blocked non-fixture request');return original.apply(this,args);};}const originalFetch=global.fetch;global.fetch=(url,...args)=>{if(!['127.0.0.1','localhost'].includes(new URL(String(url)).hostname))throw Error('Blocked non-fixture fetch');return originalFetch(url,...args);};`);
  const env={NODE_OPTIONS:`--require=${preload}`};
  const failed=await execute(['login'],dir,env);assert.equal(failed.code,1,failed.output);assert.match(failed.output,/expired/);assert.equal(fs.readFileSync(credentials,'utf8'),old);assert(!failed.output.includes(token));
  rejectLogin=false;const login=await execute(['login'],dir,env);assert.equal(login.code,0,login.output);assert(login.output.includes(expiry),login.output);assert(!login.output.includes(token));assert.equal(JSON.parse(fs.readFileSync(credentials)).machineToken,token);
  fs.mkdirSync(path.join(dir,'flows'));fs.writeFileSync(path.join(dir,'flows/api.flow'),`Feature: Local reporting acceptance\nScenario: Send a report\nGiven "Read fixture"\n flow.get "${origin}/fixture";\nWhen "Read fixture again"\n flow.get "${origin}/fixture";\nThen "Verify status"\n flow.expect status "200";\n`);fs.writeFileSync(path.join(dir,'flowstride.config.json'),JSON.stringify({cloudSync:true,recordVideo:false,timeout:3000}));
  fs.writeFileSync(path.join(dir,'.env'),'FLOWSTRIDE_API_URL=https://blocked-default.invalid\nFLOWSTRIDE_TOKEN=wrong-default-key\n');fs.writeFileSync(path.join(dir,'.env.preview'),`FLOWSTRIDE_API_URL=${origin}\nFLOWSTRIDE_TOKEN="  ${token}  "\n`);
  const run=await execute(['run','flows/api.flow','--ci','--env','preview'],dir,env);assert.equal(run.code,0,run.output+'\n'+(fs.existsSync(path.join(dir,'flowstride-artifacts/summary.json'))?fs.readFileSync(path.join(dir,'flowstride-artifacts/summary.json'),'utf8'):''));assert(run.output.includes(origin));assert(run.output.includes('FLOWSTRIDE_TOKEN (environment)'));assert(!run.output.includes(token));
  const authenticated=calls.filter(call=>call.path.startsWith('/api/'));const reporting=require(path.join(root,'package.json')).name==='@flowstride/pro'||!!proRoot;if(reporting)assert(authenticated.some(call=>call.path==='/api/runs'),run.output);for(const call of authenticated)assert.equal(call.authorization,`Bearer ${token}`);
  if(reporting){const report=JSON.parse(authenticated.find(call=>call.path==='/api/runs').body);assert.equal(report.status,'passed');assert(!JSON.stringify(report).includes(token));}
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
