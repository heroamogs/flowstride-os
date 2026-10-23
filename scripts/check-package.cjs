const assert=require('node:assert/strict'),fs=require('node:fs');
const [pack]=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const names=pack.files.map(file=>file.path);
for(const name of names)assert(!/(^|\/)(?:\.env(?:\..*)?|credentials\.json|node_modules|target|tests|\.git)(?:\/|$)/.test(name),`Private or generated development data in package: ${name}`);
for(const required of ['package.json','dist/cli/index.js','dist/runner/flow_worker.js','src/ui/dist/index.html'])assert(names.includes(required),`Missing ${required}`);
assert(names.some(name=>name.endsWith('.wasm')),'WASM dashboard dependency missing');
console.log(`Package inventory passed: ${pack.name}@${pack.version}, ${names.length} files`);
