const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
assert.equal(typeof require(root).registerGame,'function');assert.equal(typeof require(root).GameSDK,'function');
assert.equal(pkg.engines.node,'>=22.12.0');assert.equal(require('../package-lock.json').version,pkg.version);
const cli=fs.readFileSync(path.join(root,'dist/cli/index.js'),'utf8');assert(cli.startsWith('#!/usr/bin/env node'));assert.equal(require('node:child_process').execFileSync(process.execPath,[path.join(root,'dist/cli/index.js'),'--version'],{encoding:'utf8'}).trim(),pkg.version);
for(const file of ['dist/runner/flow_orchestrator.js','dist/runner/flow_worker.js','dist/ci/runtime.js','dist/cli/utils/proInstaller.js','src/ui/dist/index.html'])assert(fs.statSync(path.join(root,file)).size>0,file);
const html=fs.readFileSync(path.join(root,'src/ui/dist/index.html'),'utf8');for(const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))assert(fs.existsSync(path.join(root,'src/ui/dist',match[1])),match[1]);
assert(fs.readdirSync(path.join(root,'src/ui/dist/assets')).some(file=>file.endsWith('.wasm')),'Fresh UI must contain WASM');
console.log(`Candidate metadata and compiled entry points verified: ${pkg.name}@${pkg.version}`);
