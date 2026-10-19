const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const run=(command,args,cwd=root)=>execFileSync(command,args,{cwd,stdio:'inherit'});
for(const directory of ['dist','src/ui/dist'])fs.rmSync(path.join(root,directory),{recursive:true,force:true});
run('wasm-pack',['build','--target','web','--release','--locked'],path.join(root,'src/workspace_engine'));
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'],path.join(root,'src/ui'));
run(process.execPath,[require.resolve('typescript/bin/tsc')]);
run(process.execPath,[path.join(root,'scripts/verify-candidate.cjs')]);
