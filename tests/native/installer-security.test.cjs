const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),tar=require('tar'),child=require('node:child_process');
const root=process.env.FLOWSTRIDE_ENGINE_ROOT||path.resolve(__dirname,'../..'),{installProEngine,validateProArchive}=require(path.join(root,'dist/cli/utils/proInstaller'));
function stage(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-integrity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function archive(t){const dir=stage(t);fs.mkdirSync(path.join(dir,'package/dist/cli'),{recursive:true});fs.mkdirSync(path.join(dir,'package/dist/runner'),{recursive:true});fs.writeFileSync(path.join(dir,'package/package.json'),JSON.stringify({name:'@flowstride/pro',version:'1.0.17',bin:{flowstride:'dist/cli/index.js'}}));for(const file of['cli/index','runner/flow_worker','runner/flow_orchestrator'])fs.writeFileSync(path.join(dir,'package/dist',file+'.js'),'module.exports={};');const file=path.join(dir,'engine.tgz');tar.c({file,cwd:dir,gzip:true,sync:true},['package']);return fs.readFileSync(file);}
function mock(t,bytes,headers={}){const fetch=global.fetch,pinned=process.env.FLOWSTRIDE_PRO_SHA256,exec=child.execFileSync;delete process.env.FLOWSTRIDE_PRO_SHA256;let npm=0,requests=0,options;global.fetch=async(_url,init)=>{requests++;options=init;return new Response(bytes,{headers});};child.execFileSync=(...args)=>{npm++;throw Error('npm must not run');};t.after(()=>{global.fetch=fetch;child.execFileSync=exec;if(pinned===undefined)delete process.env.FLOWSTRIDE_PRO_SHA256;else process.env.FLOWSTRIDE_PRO_SHA256=pinned;});return {calls:()=>({npm,requests,options})};}
for(const variant of['missing checksum','malformed checksum','mismatch','conflicting pin'])test('installer fails before npm on '+variant,async t=>{
 const dir=stage(t),bytes=archive(t),sha=crypto.createHash('sha256').update(bytes).digest('hex');const headers=variant==='missing checksum'?{}:{'x-flowstride-sha256':variant==='malformed checksum'?'invalid':variant==='mismatch'?'0'.repeat(64):sha};const control=mock(t,bytes,headers);if(variant==='conflicting pin')process.env.FLOWSTRIDE_PRO_SHA256='1'.repeat(64);
 await assert.rejects(installProEngine('https://cloud.test','fixture',dir),/checksum/i);assert.equal(control.calls().npm,0);assert.equal(control.calls().options.redirect,'error');assert(!fs.existsSync(path.join(dir,'node_modules')));
});
test('a malformed local integrity pin is rejected before credentials are sent',async t=>{
 const dir=stage(t),control=mock(t,archive(t));process.env.FLOWSTRIDE_PRO_SHA256='invalid';await assert.rejects(installProEngine('https://cloud.test','fixture',dir),/SHA-256/);assert.deepEqual({npm:control.calls().npm,requests:control.calls().requests},{npm:0,requests:0});
});
test('remote HTTP is rejected before a download request is made',async t=>{
 const dir=stage(t),control=mock(t,archive(t));await assert.rejects(installProEngine('http://remote.test','fixture',dir),/HTTPS/);assert.equal(control.calls().requests,0);assert.equal(control.calls().npm,0);
});
test('an explicit trusted checksum pin can verify an archive from a server without the header',async t=>{
 const dir=stage(t),bytes=archive(t),control=mock(t,bytes);process.env.FLOWSTRIDE_PRO_SHA256=crypto.createHash('sha256').update(bytes).digest('hex');let invocation;
 child.execFileSync=(command,args,options)=>{invocation={command,args,options};const engine=path.join(dir,'node_modules/@flowstride/pro');fs.mkdirSync(path.join(engine,'dist/runner'),{recursive:true});fs.writeFileSync(path.join(engine,'package.json'),JSON.stringify({version:'1.0.17'}));fs.writeFileSync(path.join(engine,'dist/runner/flow_worker.js'),'module.exports={}');return Buffer.alloc(0);};
 const result=await installProEngine('http://127.0.0.1:4321','fixture',dir);assert.equal(result.version,'1.0.17');assert.equal(result.sha256,process.env.FLOWSTRIDE_PRO_SHA256);assert(invocation.args.includes('--ignore-scripts'));assert(invocation.args.includes('--no-save'));assert(invocation.args.includes('--package-lock=false'));assert.equal(invocation.options.cwd,dir);assert.equal(control.calls().options.redirect,'error');
});
for(const variant of['oversized','truncated'])test('bounded download refuses '+variant+' archives before npm',async t=>{
 const dir=stage(t),bytes=archive(t),control=mock(t,bytes,{'content-length':String(variant==='oversized'?32*1024*1024+1:bytes.length+1),'x-flowstride-sha256':'0'.repeat(64)});await assert.rejects(installProEngine('https://cloud.test','fixture',dir),/size|truncated/);assert.equal(control.calls().npm,0);
});

function tarBytes(entries) {
 const blocks=[];
 for(const [name,content]of entries){const data=Buffer.from(content),header=Buffer.alloc(512);header.write(name,0,100,'utf8');header.write('0000600\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(data.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);blocks.push(header,data,Buffer.alloc((512-data.length%512)%512));}
 return require('node:zlib').gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
function entries(){return [['package/package.json',JSON.stringify({name:'@flowstride/pro',version:'1.0.17',bin:{flowstride:'dist/cli/index.js'}})],...['cli/index','runner/flow_worker','runner/flow_orchestrator'].map(name=>['package/dist/'+name+'.js','module.exports={};'])];}
for(const name of ['package//alias.js','package/secret:stream','package/.NPMRC','package/NODE_MODULES/dependency.js','package/CON','package/worker.js.','package/worker.js '])test('archive rejects unsafe cross-platform path: '+name,async()=>{
 await assert.rejects(validateProArchive(tarBytes([...entries(),[name,'unsafe']])) ,/unsafe/);
});
test('archive rejects case-aliased duplicates and oversized metadata while accepting normal archives',async()=>{
 assert.equal(await validateProArchive(tarBytes(entries())),'1.0.17');await assert.rejects(validateProArchive(tarBytes([...entries(),['package/duplicate.js','one'],['package/DUPLICATE.js','two']])),/unsafe/);
 const list=entries();list[0][1]=JSON.stringify({name:'@flowstride/pro',version:'1.0.17',extra:'x'.repeat(65537)});await assert.rejects(validateProArchive(tarBytes(list)),/unsafe/);
});
