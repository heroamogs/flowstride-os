const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadSource}=require('../helpers/report-status.cjs');
const {manualFlowTitle}=loadSource('src/ui/src/utils/manualFlowTitle.ts');

test('historical metadata wins over an unrelated live selection',()=>{
  assert.equal(manualFlowTitle(true,'Different live flow','Saved account review'),'Saved account review');
});
test('clearing the live selection preserves the historical name',()=>{
  assert.equal(manualFlowTitle(true,undefined,'Saved account review'),'Saved account review');
});
test('missing historical names have an honest historical fallback',()=>{
  assert.equal(manualFlowTitle(true,undefined,undefined),'Historical Record');
  assert.equal(manualFlowTitle(true,'Stale live name',''),'Historical Record');
});
test('live design and execution continue using the selected flow',()=>{
  assert.equal(manualFlowTitle(false,'Current flow','Old historical name'),'Current flow');
});
test('new flows do not inherit the previously viewed historical title',()=>{
  assert.equal(manualFlowTitle(false,undefined,'Previous historical name'),'New Local Flow');
  assert.equal(manualFlowTitle(false,'','Previous historical name'),'New Local Flow');
});
test('stored Unicode and punctuation are preserved for text rendering',()=>{
  assert.equal(manualFlowTitle(true,undefined,'Review — Àda / version 2'),'Review — Àda / version 2');
});
test('HTML-looking names remain literal data for React to escape',()=>{
  const name='<img src="https://attacker.invalid/title" onerror="globalThis.titleInjected=1">';
  assert.equal(manualFlowTitle(true,undefined,name),name);
});
test('malformed imported names cannot become React object children',()=>{
  for(const value of [null,{},[],42,true,'   ']){
    assert.equal(manualFlowTitle(true,undefined,value),'Historical Record');
    assert.equal(manualFlowTitle(false,value,'Old record'),'New Local Flow');
  }
});
