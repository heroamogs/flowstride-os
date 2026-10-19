const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),tar=require('tar');
const {projectPath,discoverFlows,flowIdentity,videoFileName,selectedFeatures,artifactPrefix}=require('../../dist/utils/projectPaths');
const {cloudApiBase,cloudFailure}=require('../../dist/utils/cloud');
const {redactPayload}=require('../../dist/security/redaction');
const {validateProArchive,installProEngine}=require('../../dist/cli/utils/proInstaller');
const {Parser}=require('../../dist/parser/parser'),{Lexer}=require('../../dist/parser/lexer');
function stage(){return fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-combined-'));}
test('recursive discovery uses stable identities, global setup priority, and rejects external symlinks',()=>{
 const root=stage();for(const dir of ['a','b']){fs.mkdirSync(path.join(root,dir));fs.writeFileSync(path.join(root,dir,'same.flow'),'Feature: One');}fs.writeFileSync(path.join(root,'z.first.flow'),'Feature: Setup');
 const found=discoverFlows(root,root);assert(found[0].endsWith('z.first.flow'));assert.deepEqual(found.slice(1).map(file=>flowIdentity(file,root)),['a/same.flow','b/same.flow']);assert.notEqual(videoFileName('a/same.flow'),videoFileName('b/same.flow'));assert.notEqual(artifactPrefix('a/same.flow'),artifactPrefix('a_same.flow'));assert.equal(videoFileName('same.flow'),'same.webm');
 const external=stage();fs.writeFileSync(path.join(external,'escape.flow'),'Feature: External');fs.symlinkSync(external,path.join(root,'escape'));assert.throws(()=>discoverFlows(root,root),/project/);assert.throws(()=>projectPath(root,'../elsewhere'),/project/);fs.rmSync(root,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});
});
test('focused selection plans only selected scenarios using the real parser',()=>{
 const source='Feature: Focus\nScenario: Unselected\nGiven "Ignore"\n flow.open "/"\nWhen "Act"\nThen "Done"\nonly.Scenario: Selected\nGiven "Selected"\n flow.open "/"\nWhen "Act"\nThen "Done"\n';
 const features=new Parser(new Lexer(source).tokenise()).parse();const selected=selectedFeatures(features);assert.equal(selected.flatMap(f=>f.scenarios).length,1);assert.equal(selected.flatMap(f=>f.scenarios)[0].isOnly,true);
});
test('Cloud overrides retain precedence and normalize legacy webhook addresses',()=>{
 assert.equal(cloudApiBase({FLOWSTRIDE_API_URL:'http://localhost:8080/base/',NEXTJS_WEBHOOK_URL:'https://ignored.test'}),'http://localhost:8080/base');assert.equal(cloudApiBase({NEXTJS_WEBHOOK_URL:'https://staging.test/api/cloud/execution-complete'}),'https://staging.test');assert.throws(()=>cloudApiBase({FLOWSTRIDE_API_URL:'https://token@host.test'}));assert.equal(cloudFailure({response:{status:401}}).status,401);
});
test('redaction covers nested credentials, JSON bodies, OTPs, and signed capabilities without modifying input',()=>{
 const input={password:'hidden',email:'person@example.test',nested:{body:JSON.stringify({token:'secret'})},message:'Authorization: Bearer fst_secret\npassword=abc',url:'https://x.test?ticket=signed-secret'};const result=JSON.stringify(redactPayload(input));for(const value of ['hidden','person@example.test','fst_secret','password=abc','signed-secret','"secret"'])assert(!result.includes(value),result);assert.equal(input.password,'hidden');
});
function archive(root,extra){fs.mkdirSync(path.join(root,'package/dist/runner'),{recursive:true});fs.mkdirSync(path.join(root,'package/dist/cli'));fs.writeFileSync(path.join(root,'package/package.json'),JSON.stringify({name:'@flowstride/pro',version:'1.0.15-rc.2',bin:{flowstride:'dist/cli/index.js'}}));for(const file of ['cli/index','runner/flow_worker','runner/flow_orchestrator'])fs.writeFileSync(path.join(root,'package/dist',file+'.js'),'module.exports={};');extra?.(root);const file=path.join(root,'pro.tgz');tar.c({file,cwd:root,gzip:true,sync:true},['package']);return fs.readFileSync(file);}
test('archive validation rejects corrupted gzip, wrong identity, secrets, and symlink entries',async()=>{
 const root=stage();const valid=archive(root);assert.equal(await validateProArchive(valid),'1.0.15-rc.2');await assert.rejects(validateProArchive(Buffer.from('not gzip')));
 for(const mode of ['identity','secret','symlink']){const folder=stage();const bytes=archive(folder,p=>{if(mode==='identity')fs.writeFileSync(path.join(p,'package/package.json'),'{"name":"foreign"}');if(mode==='secret')fs.writeFileSync(path.join(p,'package/.env'),'secret');if(mode==='symlink')fs.symlinkSync('/etc/passwd',path.join(p,'package/link'));});await assert.rejects(validateProArchive(bytes));fs.rmSync(folder,{recursive:true,force:true});}fs.rmSync(root,{recursive:true,force:true});
});
test('checksum mismatch is rejected before npm and failed installs restore previous Pro and CLI launcher',async()=>{
 const root=stage(),source=stage(),bytes=archive(source),bin=path.join(root,'node_modules/.bin');fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(path.join(root,'node_modules/@flowstride/pro'),{recursive:true});fs.writeFileSync(path.join(root,'node_modules/@flowstride/pro/previous'),'preserve');fs.symlinkSync('../@flowstride/pro/previous',path.join(bin,'flowstride'));
 const originalFetch=global.fetch,originalPath=process.env.PATH;const fake=path.join(root,'fake-bin');fs.mkdirSync(fake);fs.writeFileSync(path.join(fake,'npm'),'#!/usr/bin/env node\nconst fs=require("node:fs");fs.writeFileSync("node_modules/@flowstride/pro/previous","damaged");fs.unlinkSync("node_modules/.bin/flowstride");process.exit(1);',{mode:0o755});process.env.PATH=fake+path.delimiter+originalPath;
 try{global.fetch=async()=>new Response(bytes,{headers:{'X-Flowstride-Sha256':'0'.repeat(64)}});await assert.rejects(installProEngine('https://test.invalid','test-token',root),/checksum/);assert.equal(fs.readFileSync(path.join(root,'node_modules/@flowstride/pro/previous'),'utf8'),'preserve');
 global.fetch=async()=>new Response(bytes,{headers:{'Content-Length':String(bytes.length),'X-Flowstride-Sha256':crypto.createHash('sha256').update(bytes).digest('hex')}});await assert.rejects(installProEngine('https://test.invalid','test-token',root),/restored/);assert.equal(fs.readFileSync(path.join(root,'node_modules/@flowstride/pro/previous'),'utf8'),'preserve');assert.equal(fs.readlinkSync(path.join(bin,'flowstride')),'../@flowstride/pro/previous');
 }finally{global.fetch=originalFetch;process.env.PATH=originalPath;fs.rmSync(root,{recursive:true,force:true});fs.rmSync(source,{recursive:true,force:true});}
});

test('game visual baselines reject files outside the configured project before browser access',async()=>{
 const {GameSDK}=require('../../dist/game/sdk');const root=stage(),outside=stage();const file=path.join(outside,'baseline.png');fs.writeFileSync(file,'private');
 const game=new GameSDK(()=>{throw Error('Browser must not be accessed');},{projectRoot:root,timeout:1000});await assert.rejects(game.expectVisual({baseline:file}),/project/);fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});
});
