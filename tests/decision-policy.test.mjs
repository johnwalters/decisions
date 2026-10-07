import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../lib/decision-policy.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {routedCategory,normalizeThresholds,defaultThresholds}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const answer=(healthy,rotten,choice='healthy')=>({type:'choice',choice,probabilities:[{value:'healthy',probability:healthy},{value:'rotten',probability:rotten}]});
const rule={enabled:true,minHealthy:70,maxRotten:25};
test('Healthy requires both thresholds, including inclusive boundaries',()=>{
  assert.equal(routedCategory(answer(.53,.41),rule),'unclear');
  assert.equal(routedCategory(answer(.75,.2),rule),'healthy');
  assert.equal(routedCategory(answer(.7,.25),rule),'healthy');
  assert.equal(routedCategory(answer(.699,.2),rule),'unclear');
  assert.equal(routedCategory(answer(.7,.251),rule),'unclear');
  assert.equal(routedCategory(answer(.53,.41),{enabled:true,minHealthy:50,maxRotten:25}),'unclear');
  assert.equal(routedCategory(answer(.53,.41),{enabled:true,minHealthy:50,maxRotten:45}),'healthy');
});
test('Disabling restores the API choice without changing saved results',()=>{
  const saved=answer(.53,.41);const before=JSON.stringify(saved);
  assert.equal(routedCategory(saved,rule),'unclear');
  assert.equal(routedCategory(saved,defaultThresholds),'healthy');
  assert.equal(JSON.stringify(saved),before);
});
test('Other API categories, pending images, refusals, and missing probabilities',()=>{
  for(const choice of ['rotten','unclear'])assert.equal(routedCategory(answer(.75,.2,choice),rule),choice);
  assert.equal(routedCategory(undefined,rule),'pending');
  assert.equal(routedCategory({type:'refusal'},rule),'refused');
  assert.equal(routedCategory({type:'choice',choice:'healthy'},rule),'unclear');
  assert.equal(routedCategory(answer(NaN,.2),rule),'unclear');
});
test('Stored settings are bounded and invalid values use defaults',()=>{
  assert.deepEqual(normalizeThresholds({enabled:true,minHealthy:120,maxRotten:-5}),{enabled:true,minHealthy:100,maxRotten:0});
  assert.deepEqual(normalizeThresholds({enabled:'yes',minHealthy:'70',maxRotten:null}),defaultThresholds);
});
