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
  assert.deepEqual(normalizeThresholds({enabled:true,minHealthy:120,maxRotten:-5}),{...defaultThresholds,enabled:true,minHealthy:100,maxRotten:0});
  assert.deepEqual(normalizeThresholds({enabled:'yes',minHealthy:'70',maxRotten:null}),defaultThresholds);
  assert.deepEqual(normalizeThresholds({enabled:true,rottenEnabled:true,minRotten:120}),{...defaultThresholds,enabled:true,rottenEnabled:true,minRotten:100});
  assert.equal(normalizeThresholds({minRotten:NaN}).minRotten,70);
  assert.equal(normalizeThresholds({minRotten:-5}).minRotten,0);
});
test('Rotten routing is opt-in, inclusive, and applies to Healthy and Unclear API choices',()=>{
  const routing={...rule,rottenEnabled:true,minRotten:40};
  assert.equal(routedCategory(answer(.53,.41),routing),'rotten');
  assert.equal(routedCategory(answer(.53,.41),{...routing,minRotten:42}),'unclear');
  assert.equal(routedCategory(answer(.53,.4),routing),'rotten');
  assert.equal(routedCategory(answer(.2,.4,'unclear'),routing),'rotten');
  assert.equal(routedCategory(answer(.2,.399,'unclear'),routing),'unclear');
  assert.equal(routedCategory(answer(.53,.41),{...routing,rottenEnabled:false}),'unclear');
  assert.equal(routedCategory(answer(.53,.41),{...routing,enabled:false}),'healthy');
});
test('Rotten wins overlapping rules, preserves raw answers, and does not change refusals or pending results',()=>{
  const routing={...rule,minHealthy:50,maxRotten:45,rottenEnabled:true,minRotten:40};
  const saved=answer(.53,.41); const before=JSON.stringify(saved);
  assert.equal(routedCategory(saved,routing),'rotten');
  assert.equal(JSON.stringify(saved),before);
  assert.equal(routedCategory({type:'refusal',probabilities:[{value:'rotten',probability:1}]},routing),'refused');
  assert.equal(routedCategory(undefined,routing),'pending');
  assert.equal(routedCategory(answer(.1,.1,'rotten'),routing),'rotten');
  assert.equal(routedCategory({type:'choice',choice:'healthy'},routing),'unclear');
  assert.equal(routedCategory(answer(.7,NaN),routing),'unclear');
  assert.equal(routedCategory(answer(NaN,.41),routing),'rotten');
});
