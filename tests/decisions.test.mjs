import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../app/api/decide/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const request=body=>new Request('http://localhost/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('Decisions API boundary, error handling, and label isolation',async()=>{
  const previousKey=process.env.OPENAI_API_KEY,previousFetch=globalThis.fetch;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal((await POST(request({}))).status,503);
    process.env.OPENAI_API_KEY='test-placeholder';
    assert.equal((await POST(request({image:'https://example.com/apple.jpg',instructions:'classify'}))).status,400);
    assert.equal((await POST(request({image:'data:image/jpeg;base64,YQ==',instructions:''}))).status,400);
    let payload;
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/decisions');payload=JSON.parse(options.body);return Response.json({model:'gpt-6-luna',answers:[{type:'choice',choice:'healthy',probabilities:[{value:'healthy',probability:0.9}]}]});};
    const response=await POST(request({image:'data:image/jpeg;base64,YQ==',instructions:'Judge visible rot.',filename:'rotten-apple.jpg',label:'rotten'}));
    assert.equal(response.status,200);assert.equal((await response.json()).answers[0].choice,'healthy');
    assert.equal(payload.model,'gpt-6-luna');assert.equal(payload.questions[0].type,'choice');
    assert.equal(JSON.stringify(payload).includes('rotten-apple.jpg'),false);assert.equal(payload.input[0].content[0].text.includes('rotten'),false);
    globalThis.fetch=async()=>Response.json({answers:[{type:'refusal'}]});assert.equal((await POST(request({image:'data:image/jpeg;base64,YQ==',instructions:'classify'}))).status,200);
    globalThis.fetch=async()=>Response.json({error:{message:'Rate limited'}},{status:429});assert.equal((await POST(request({image:'data:image/jpeg;base64,YQ==',instructions:'classify'}))).status,429);
    globalThis.fetch=async()=>Response.json({answers:[{type:'choice',choice:'invented'}]});assert.equal((await POST(request({image:'data:image/jpeg;base64,YQ==',instructions:'classify'}))).status,502);
  }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;}
});
test('sample has 50 images per label, unique IDs, and image signatures',()=>{
  const rows=JSON.parse(readFileSync(new URL('../public/samples/manifest.json',import.meta.url),'utf8'));
  assert.equal(rows.length,100);assert.equal(new Set(rows.map(x=>x.id)).size,100);
  for(const label of ['healthy','rotten'])assert.equal(rows.filter(x=>x.label===label).length,50);
  for(const row of rows){const bytes=readFileSync(new URL('../public'+row.src,import.meta.url));assert.ok(bytes[0]===0xff&&bytes[1]===0xd8||bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));}
});
