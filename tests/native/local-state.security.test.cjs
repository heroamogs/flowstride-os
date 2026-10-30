const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn,spawnSync,execFileSync}=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..');
const security=require(path.join(root,'dist/security/privateState'));
const {PersistentVault}=require(path.join(root,'dist/runner/persistent_vault'));
const SessionVault=require(path.join(root,'dist/sessions/vault')).PersistentVault;
const {FlowWorker}=require(path.join(root,'dist/runner/flow_worker'));
const cloud=require(path.join(root,'package.json')).name==='@flowstride/pro';
function stage(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-private-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function mode(file,value){if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o7777,value,file);}
function linkedDirectory(target,dest){fs.symlinkSync(target,dest,process.platform==='win32'?'junction':'dir');}
function worker(web){return new FlowWorker({ci:true,headless:true,timeout:200},web,{getState(){throw Error('No API response');}},{},{});}
const snapshot={cookies:[{name:'session',value:'fixture-cookie',domain:'app.example.test',path:'/'}],localStorage:{theme:'dark'},sessionStorage:{tenant:'fixture-tenant'},storageOrigin:'https://app.example.test'};

test('private writes override permissive umask and repair existing directory/file permissions',t=>{
 const dir=stage(t),prior=process.umask(0);try{
  fs.mkdirSync(path.join(dir,'.flowstride'),{mode:0o777});fs.writeFileSync(path.join(dir,'.flowstride/vault.json'),'{}',{mode:0o666});
  security.writePrivateState(dir,'vault.json','{"token":"private-fixture"}');mode(path.join(dir,'.flowstride'),0o700);mode(path.join(dir,'.flowstride/vault.json'),0o600);
  assert.equal(security.readPrivateState(dir,'vault.json'),'{"token":"private-fixture"}');assert.deepEqual(fs.readdirSync(path.join(dir,'.flowstride')),['vault.json']);
 }finally{process.umask(prior);}
});
test('project and global credential files retain their JSON data and remain isolated',t=>{
 const project=stage(t),home=stage(t),p=path.join(project,'.flowstride/credentials.json'),g=path.join(home,'.flowstride/credentials.json');
 security.writePrivateCredentials(p,'{"machineToken":"project-fixture"}');security.writePrivateCredentials(g,'{"machineToken":"global-fixture"}');assert.equal(JSON.parse(security.readPrivateCredentials(p)).machineToken,'project-fixture');assert.equal(JSON.parse(security.readPrivateCredentials(g)).machineToken,'global-fixture');mode(p,0o600);mode(g,0o600);mode(path.dirname(p),0o700);security.removePrivateCredentials(p);assert(!fs.existsSync(p));assert(fs.existsSync(g));
});
for(const relative of ['.flowstride','.flowstride/sessions','.flowstride/vault'])test('private state rejects directory links without reading, writing or deleting neighbors: '+relative,t=>{
 const dir=stage(t),neighbor=stage(t);fs.writeFileSync(path.join(neighbor,'vault.json'),'neighbor-canary');fs.writeFileSync(path.join(neighbor,'saved.json'),'neighbor-session');if(relative!=='.flowstride')fs.mkdirSync(path.join(dir,'.flowstride'));
 linkedDirectory(neighbor,path.join(dir,relative));
 const target=relative==='.flowstride'?'vault.json':relative.split('/')[1]+'/saved.json';
 assert.throws(()=>security.readPrivateState(dir,target),/Symlink|private state/);assert.throws(()=>security.writePrivateState(dir,target,'overwrite'),/Symlink|private state/);assert.throws(()=>security.removePrivateState(dir,target),/Symlink|private state/);assert.equal(fs.readFileSync(path.join(neighbor,'vault.json'),'utf8'),'neighbor-canary');assert.equal(fs.readFileSync(path.join(neighbor,'saved.json'),'utf8'),'neighbor-session');
});
test('dangling directory links are rejected rather than recreated or silently treated as absent',t=>{
 const dir=stage(t),absent=path.join(dir,'missing');linkedDirectory(absent,path.join(dir,'.flowstride'));assert.throws(()=>security.readPrivateState(dir,'vault.json'),/Symlink/);assert.throws(()=>security.resetPrivateState(dir,{values:true}),/Symlink/);assert(!fs.existsSync(absent));
});
for(const file of ['credentials.json','vault.json','sessions/saved.json'])test('hard-linked secret files are rejected without altering the other link: '+file,t=>{
 const dir=stage(t),neighbor=stage(t),outside=path.join(neighbor,'untouched');fs.writeFileSync(outside,'hardlink-canary');fs.mkdirSync(path.dirname(path.join(dir,'.flowstride',file)),{recursive:true});fs.linkSync(outside,path.join(dir,'.flowstride',file));const originalMode=fs.statSync(outside).mode;
 assert.throws(()=>security.readPrivateState(dir,file),/hard-linked/);assert.throws(()=>security.writePrivateState(dir,file,'unsafe'),/hard-linked/);assert.throws(()=>security.removePrivateState(dir,file),/hard-linked/);assert.equal(fs.readFileSync(outside,'utf8'),'hardlink-canary');assert.equal(fs.statSync(outside).mode,originalMode);
});
test('leaf symlinks are rejected, including dangling credentials', {skip:process.platform==='win32'},t=>{
 const dir=stage(t),neighbor=stage(t),outside=path.join(neighbor,'canary');fs.writeFileSync(outside,'leaf-canary');fs.mkdirSync(path.join(dir,'.flowstride'));fs.symlinkSync(outside,path.join(dir,'.flowstride/vault.json'));fs.symlinkSync(path.join(neighbor,'missing'),path.join(dir,'.flowstride/credentials.json'));
 assert.throws(()=>new PersistentVault(dir),/Symlink/);assert.throws(()=>security.readPrivateCredentials(path.join(dir,'.flowstride/credentials.json')),/Symlink/);assert.throws(()=>security.writePrivateCredentials(path.join(dir,'.flowstride/credentials.json'),'new'),/Symlink/);assert.equal(fs.readFileSync(outside,'utf8'),'leaf-canary');
});
test('atomic write failure retains the previous secret and removes temporary files',t=>{
 const dir=stage(t);security.writePrivateState(dir,'vault.json','old-value');const rename=fs.renameSync;
 try{fs.renameSync=()=>{throw Object.assign(Error('fixture write failure'),{code:'EACCES'});};assert.throws(()=>security.writePrivateState(dir,'vault.json','new-value'),/fixture write failure/);}finally{fs.renameSync=rename;}
 assert.equal(security.readPrivateState(dir,'vault.json'),'old-value');assert.deepEqual(fs.readdirSync(path.join(dir,'.flowstride')),['vault.json']);
});
test('persistent value and legacy session vaults preserve their existing data formats',t=>{
 const dir=stage(t),vault=new PersistentVault(dir);vault.save('fixture',{token:'value'});assert.deepEqual(new PersistentVault(dir).get('fixture'),{token:'value'});mode(path.join(dir,'.flowstride/vault.json'),0o600);
 const sessions=new SessionVault(dir);sessions.save('Admin login',snapshot);assert.deepEqual(sessions.load('Admin login'),snapshot);assert(sessions.exists('Admin login'));mode(path.join(dir,'.flowstride/vault/Admin login.json'),0o600);mode(path.join(dir,'.flowstride/vault'),0o700);
 for(const name of ['../outside','a/b','a\\b','..','',path.resolve(dir,'outside')])assert.throws(()=>sessions.save(name,snapshot),/Saved-session|private-state/);
});
test('worker persistent sessions retain cookies and both browser storage types with private permissions',async t=>{
 const dir=stage(t),cwd=process.cwd();try{process.chdir(dir);await worker({getState:async()=>snapshot}).executeStep('save',{type:'session',name:'admin',persist:true});mode(path.join(dir,'.flowstride/sessions'),0o700);mode(path.join(dir,'.flowstride/sessions/admin.json'),0o600);let actual;await worker({injectStorage:async(...args)=>actual=args}).executeStep('use',{type:'session',name:'admin'});assert.deepEqual(actual,[snapshot.cookies,snapshot.localStorage,undefined,snapshot.sessionStorage,snapshot.storageOrigin]);await assert.rejects(worker({getState:async()=>snapshot}).executeStep('save',{type:'session',name:'../../outside',persist:true}),/securely persist|single filename/);}finally{process.chdir(cwd);}
});
test('reset preflights both targets before deleting either and leaves credentials untouched',t=>{
 const dir=stage(t),outside=stage(t);security.writePrivateState(dir,'vault.json','{}');security.writePrivateCredentials(path.join(dir,'.flowstride/credentials.json'),'{}');linkedDirectory(outside,path.join(dir,'.flowstride/sessions'));assert.throws(()=>security.resetPrivateState(dir,{values:true,sessions:true}),/Symlink/);assert.equal(security.readPrivateState(dir,'vault.json'),'{}');fs.unlinkSync(path.join(dir,'.flowstride/sessions'));security.writePrivateState(dir,'sessions/one.json','{}');const result=security.resetPrivateState(dir,{values:true,sessions:true});assert(result.every(r=>r.removed));assert(!fs.existsSync(path.join(dir,'.flowstride/vault.json')));assert(!fs.existsSync(path.join(dir,'.flowstride/sessions')));assert(fs.existsSync(path.join(dir,'.flowstride/credentials.json')));assert(security.resetPrivateState(dir,{sessions:true}).every(r=>!r.removed));
});
test('real Windows ACL accepts the token default owner and normalizes to exactly one user grant',{skip:process.platform!=='win32'},t=>{
 const dir=stage(t),file=path.join(dir,'owner-fixture.txt');fs.writeFileSync(file,'disposable-acl-fixture');
 const exe=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 try{execFileSync(exe,['-NoProfile','-NonInteractive','-Command',security.WINDOWS_PRIVATE_ACL],{env:{...process.env,PSModulePath:path.join(path.dirname(exe),'Modules'),FLOWSTRIDE_PRIVATE_PATH:file,FLOWSTRIDE_PRIVATE_KIND:'file'},stdio:'pipe'});}
 catch(error){assert.fail('Disposable Windows ACL fixture failed: '+String(error.stderr||error.message));}
 const result=JSON.parse(execFileSync(exe,['-NoProfile','-NonInteractive','-Command',`$i=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $a=Get-Acl -LiteralPath $env:FLOWSTRIDE_PRIVATE_PATH; $r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); @{owned=($a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $i.User.Value); protected=$a.AreAccessRulesProtected; count=$r.Count; userOnly=($r.Count -eq 1 -and $r[0].IdentityReference.Value -eq $i.User.Value -and $r[0].AccessControlType -eq 'Allow')} | ConvertTo-Json -Compress`],{env:{...process.env,PSModulePath:path.join(path.dirname(exe),'Modules'),FLOWSTRIDE_PRIVATE_PATH:file},encoding:'utf8'}));
 assert.deepEqual(result,{owned:true,protected:true,count:1,userOnly:true});
});
test('Windows ACL command treats paths as data, removes inherited/explicit grants and fails closed',t=>{
 const file="C:\\private\\space '; $env:INJECTED = 1; ";let call;
 security.restrictWindowsPath(file,true,(...args)=>{call=args;return Buffer.alloc(0);});assert.equal(call[2].env.FLOWSTRIDE_PRIVATE_PATH,file);assert.equal(call[2].env.FLOWSTRIDE_PRIVATE_KIND,'directory');assert.equal(call[2].env.PSModulePath,path.join(path.dirname(call[0]),'Modules'));assert(!call[1].join(' ').includes(file));assert.match(call[1].join(' '),/SetAccessRuleProtection\(\$true, \$false\)/);assert.match(call[1].join(' '),/rules.Count -ne 1/);assert.throws(()=>security.restrictWindowsPath(file,false,()=>{throw Error('fixture ACL denial');}),/owner-only Windows/);
 if(process.platform==='win32'){const dir=stage(t);security.writePrivateState(dir,'vault.json','{}');const exe=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');const check=execFileSync(exe,['-NoProfile','-NonInteractive','-Command',`$a=Get-Acl -LiteralPath $env:FLOWSTRIDE_PRIVATE_PATH; @($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) | Select-Object @{n='sid';e={$_.IdentityReference.Value}},AccessControlType | ConvertTo-Json -Compress`],{env:{...process.env,PSModulePath:path.join(path.dirname(exe),'Modules'),FLOWSTRIDE_PRIVATE_PATH:path.join(dir,'.flowstride/vault.json')},encoding:'utf8'});const rows=[JSON.parse(check)].flat();assert.equal(rows.length,1);assert.equal(rows[0].AccessControlType,0);}
});
function preload(dir){const home=path.join(dir,'test-home');fs.mkdirSync(home);const filename=path.join(dir,'guard.cjs');fs.writeFileSync(filename,`require('node:os').homedir=()=>${JSON.stringify(home)};`);return {filename,home};}
function execute(dir,args,extra={}){return new Promise(resolve=>{const child=spawn(process.execPath,[path.join(root,'dist/cli/index.js'),...args],{cwd:dir,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),...(process.platform==='win32'?Object.fromEntries(['SystemRoot','COMSPEC','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramData','WINDIR','TEMP','TMP','SystemDrive'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])):{}),CI:'true',FLOWSTRIDE_API_URL:'https://cloud.invalid',...extra},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);const timer=setTimeout(()=>child.kill('SIGKILL'),45000);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});});}
test('Cloud reset and --fresh fail with a nonzero exit before touching an external vault',{skip:!cloud},async t=>{
 const dir=stage(t),outside=stage(t),guard=preload(dir);fs.writeFileSync(path.join(outside,'vault.json'),'reset-canary');linkedDirectory(outside,path.join(dir,'.flowstride'));const env={NODE_OPTIONS:`--require=${JSON.stringify(guard.filename)}`};for(const args of [['reset','--values'],['run','flows','--ci','--fresh']]){const res=await execute(dir,args,env);assert.notEqual(res.code,0,res.output);assert.match(res.output,/Symlink|private state/);assert.equal(fs.readFileSync(path.join(outside,'vault.json'),'utf8'),'reset-canary');}
});
test('real CLI local and global login write private files and reject linked credential destinations',{timeout:90000},async t=>{
 const dir=stage(t),guard=preload(dir),token='fixture-security-login';fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'fixture',dependencies:{flowstride:'fixture'}}));
 const server=http.createServer(async(req,res)=>{for await(const _ of req){};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({machineToken:token,workspaceId:'fixture',isProEligible:false,tokenExpiresAt:'2099-01-01T00:00:00Z',tokenScope:'execution'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});const env={FLOWSTRIDE_API_URL:'http://127.0.0.1:'+server.address().port,NODE_OPTIONS:`--require=${JSON.stringify(guard.filename)}`};
 for(const global of[false,true]){const res=await execute(dir,['login','--token',token,...(global?['--global']:[])],env);assert.equal(res.code,0,res.output);assert(!res.output.includes(token));const file=path.join(global?guard.home:dir,'.flowstride/credentials.json');assert.equal(JSON.parse(fs.readFileSync(file)).machineToken,token);mode(file,0o600);mode(path.dirname(file),0o700);}
 if(process.platform!=='win32'){const neighbor=stage(t),outside=path.join(neighbor,'credentials.json');fs.writeFileSync(outside,'linked-canary');const local=path.join(dir,'.flowstride/credentials.json');fs.unlinkSync(local);fs.symlinkSync(outside,local);const res=await execute(dir,['login','--token',token],env);assert.notEqual(res.code,0,res.output);assert.match(res.output,/Symlink|private state|credential/i);assert.equal(fs.readFileSync(outside,'utf8'),'linked-canary');assert(!res.output.includes('linked-canary'));}
});

test('credential writes reject oversized data before creating or replacing a file',t=>{
 const dir=stage(t),file=path.join(dir,'.flowstride/credentials.json');assert.throws(()=>security.writePrivateCredentials(file,'x'.repeat(65537)),/64 KiB/);assert(!fs.existsSync(file));
});
test('private reads refuse foreign ownership and remove existing macOS allow ACLs',t=>{
 if(process.platform==='win32')return;
 const dir=stage(t),file=path.join(dir,'.flowstride/vault.json');security.writePrivateState(dir,'vault.json','private-value');const getuid=process.getuid;
 try{process.getuid=()=>getuid()+1;assert.throws(()=>security.readPrivateState(dir,'vault.json'),/owned by the current user/);}finally{process.getuid=getuid;}
 if(process.platform==='darwin'){
  execFileSync('/bin/chmod',['+a','everyone allow read,readattr,readextattr,readsecurity',file]);assert.match(execFileSync('/bin/ls',['-le',file],{encoding:'utf8'}),/everyone allow/);
  assert.equal(security.readPrivateState(dir,'vault.json'),'private-value');assert.doesNotMatch(execFileSync('/bin/ls',['-le',file],{encoding:'utf8'}),/everyone allow/);mode(file,0o600);
 }
});

test('real CLI does not follow a credential-bearing login redirect or overwrite saved credentials',{timeout:90000},async t=>{
 const dir=stage(t),guard=preload(dir);fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'fixture',dependencies:{flowstride:'fixture'}}));security.writePrivateCredentials(path.join(dir,'.flowstride/credentials.json'),'{"machineToken":"previous-fixture"}');
 let followed=0;const target=http.createServer((req,res)=>{followed++;res.end('{}');});await new Promise(r=>target.listen(0,'127.0.0.1',r));const source=http.createServer((req,res)=>{res.writeHead(307,{Location:'http://127.0.0.1:'+target.address().port+'/credentials'});res.end();});await new Promise(r=>source.listen(0,'127.0.0.1',r));
 try{const res=await execute(dir,['login','--token','fixture-redirect-token'],{FLOWSTRIDE_API_URL:'http://127.0.0.1:'+source.address().port,NODE_OPTIONS:`--require=${JSON.stringify(guard.filename)}`});assert.notEqual(res.code,0,res.output);assert.equal(followed,0);assert.match(res.output,/redirect/i);assert(!res.output.includes('fixture-redirect-token'));assert.equal(JSON.parse(security.readPrivateCredentials(path.join(dir,'.flowstride/credentials.json'))).machineToken,'previous-fixture');}finally{for(const server of[source,target]){server.closeAllConnections();await new Promise(r=>server.close(r));}}
});
