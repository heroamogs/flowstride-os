import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as tar from 'tar';
const manifest=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const file=path.join(path.dirname(process.argv[2]),manifest.file);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),manifest.sha256,'Candidate checksum mismatch.');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-candidate-integrity-'));
await tar.x({file,cwd:directory,strict:true,preservePaths:false});
const root=path.join(directory,'package');
const candidate=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const source=JSON.parse(fs.readFileSync('package.json','utf8'));
assert.equal(candidate.name,source.name);assert.equal(candidate.version,source.version);
assert.deepEqual(candidate.dependencies,source.dependencies);
assert.deepEqual(candidate.engines,source.engines);
assert.deepEqual(candidate.publishConfig,source.publishConfig);
let count=0;
function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){
 const file=path.join(folder,item.name);
 if(item.isDirectory())walk(file);
 else {const relative=path.relative(root,file);assert.deepEqual(fs.readFileSync(file),fs.readFileSync(relative),relative+' differs from fresh source build.');count++;}
}}
walk(path.join(root,'dist'));
assert(count>0);
const ui=path.join(root,'src/ui/dist');assert(fs.existsSync(path.join(ui,'index.html')),'Candidate must contain the interactive dashboard.');
const html=fs.readFileSync(path.join(ui,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
 const target=match[1];if(/^(?:https?:|data:|#)/.test(target))continue;
 assert(fs.existsSync(path.join(ui,target.replace(/^\//,''))),`Dashboard asset missing: ${target}`);
}
console.log(`${candidate.name}@${candidate.version}: immutable archive checksum, ${count} compiled files, package dependencies and dashboard assets match.`);
