const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadSource,requireUI}=require('../helpers/report-status.cjs');
const path=require('node:path'),{Module}=require('node:module');
const ui=path.resolve(__dirname,'../../src/ui');
const code=requireUI('esbuild').buildSync({entryPoints:[path.join(ui,'src/components/AssertionDetails.tsx')],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react']}).outputFiles[0].text;
const compiled=new Module(path.join(ui,'batch1-message.cjs'));compiled.paths=Module._nodeModulePaths(ui);compiled._compile(code,path.join(ui,'batch1-message.cjs'));
const {AssertionDetails}=compiled.exports;
const React=requireUI('react');
const {renderToStaticMarkup}=requireUI('react-dom/server');

test('custom assertion messages and observations remain inert text in both dashboard/report themes',()=>{
 const message='<img src="https://attacker.invalid/leak" onerror="attack()"><script>attack()</script>';
 for(const light of [false,true]){
  const html=renderToStaticMarkup(React.createElement(AssertionDetails,{light,result:{command:'assert.value',target:'stored value',status:'failed',message,sourceFile:'example.flow',sourceLine:17,checks:[{key:'value',label:'value greaterThan',status:'failed',expected:'20',actual:'12'}]}}));
  assert.match(html,/Message:/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<script/);assert.match(html,/Expected: /);assert.match(html,/Actual: /);assert.match(html,/example.flow/);assert.match(html,/17/);
 }
});
