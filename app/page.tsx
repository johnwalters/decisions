'use client';
import { useEffect, useRef, useState } from 'react';

type Category = 'healthy' | 'rotten' | 'unclear';
type Answer = { type: string; choice?: Category; confidence?: number; probabilities?: { value: string; probability: number }[] };
type Result = { answers: Answer[]; model: string; elapsedMs: number; evaluatedAt: string; usage?: unknown; instructions: string };
type Item = { id: string; src: string; name: string; label?: Category; sourcePath?: string; result?: Result; error?: string };
const defaultInstructions = 'Classify the visible condition of the fruit as healthy, rotten, or unclear. Judge only visible evidence. Ignore backgrounds, lighting, and shadows. Natural color variation and small superficial blemishes do not alone mean rotten. Choose unclear when evidence is insufficient or mixed. This is a visual classification experiment, not a food-safety assessment.';
const titles: Record<string,string> = { healthy: 'Healthy', rotten: 'Rotten', unclear: 'Unclear', pending: 'Unclassified', refused: 'Refused' };
const resultCategory = (item: Item) => item.result ? item.result.answers[0]?.type === 'refusal' ? 'refused' : item.result.answers[0]?.choice || 'unclear' : 'pending';
const mismatch = (item: Item) => Boolean(item.label && item.result && item.result.answers[0]?.type !== 'refusal' && item.label !== resultCategory(item));
const percent = (v?:number) => v === undefined ? '—' : `${(v*100).toFixed(1)}%`;
function openDb(): Promise<IDBDatabase> { return new Promise((resolve,reject)=> { const req=indexedDB.open('fruit-decisions-lab',1); req.onupgradeneeded=()=>req.result.createObjectStore('state'); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function saveItems(items:Item[]) { const db=await openDb(); return new Promise<void>((resolve,reject)=>{ const tx=db.transaction('state','readwrite'); tx.objectStore('state').put(items,'items'); tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}; }); }
async function readItems():Promise<Item[]|undefined> { const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction('state').objectStore('state').get('items');req.onsuccess=()=>{db.close();resolve(req.result)};req.onerror=()=>{db.close();reject(req.error)};}); }
async function imageData(src:string):Promise<string> {
  const image = new Image(); image.src=src; await image.decode();
  const scale=Math.min(1,1024/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d'); if(!ctx)throw new Error('Could not prepare image.');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.88);
}
export default function Page() {
  const [items,setItems]=useState<Item[]>([]), [selected,setSelected]=useState(''), [configured,setConfigured]=useState(false), [ready,setReady]=useState(false);
  const [filter,setFilter]=useState('all'),[onlyMismatch,setOnlyMismatch]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[message,setMessage]=useState('');
  const [detailsId,setDetailsId]=useState<string|null>(null);
  const detailsDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=detailsDialog.current;if(detailsId&&!dialog?.open)dialog?.showModal();else if(!detailsId&&dialog?.open)dialog.close();},[detailsId]);
  const [instructions,setInstructions]=useState(defaultInstructions),[settings,setSettings]=useState(false),[raw,setRaw]=useState(false);
  const stop=useRef(false), filesRef=useRef<HTMLInputElement>(null), folderRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{(async()=>{try {const sample=await fetch('/samples/manifest.json').then(async r=>await r.json() as Item[]);const saved=await readItems();const initial=saved?.length?saved:sample;setItems(initial);setSelected(initial[0]?.id||'');}catch {setMessage('Could not load the sample. Import images to get started.');}finally{setReady(true);}try{const status=await fetch('/api/status').then(async r=>await r.json() as {configured:boolean});setConfigured(status.configured);}catch{setMessage('Could not check API configuration.');}})();},[]);
  useEffect(()=>{if(ready)saveItems(items).catch(()=>setMessage('Browser storage is full or unavailable. Export your results before closing.'));},[items,ready]);
  const detailItem=items.find(x=>x.id===detailsId), detailAnswer=detailItem?.result?.answers[0];
  const active=items.find(x=>x.id===selected), answer=active?.result?.answers[0];
  const completed=items.filter(x=>x.result), evaluable=completed.filter(x=>x.label&&x.result?.answers[0]?.type!=='refusal'), correct=evaluable.filter(x=>!mismatch(x));
  const visible=items.filter(x=>(filter==='all'||resultCategory(x)===filter)&&(!onlyMismatch||mismatch(x)));
  async function classify(targets:Item[]) {
    if(busy||!configured)return;setBusy(true);stop.current=false;setMessage('');
    for(let i=0;i<targets.length;i++) {if(stop.current)break;const item=targets[i];setSelected(item.id);setProgress(`${i+1} / ${targets.length}`);
      try { const image=await imageData(item.src); const response=await fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,instructions})});const data=await response.json() as Result & {error?:string};if(!response.ok)throw new Error(data.error||'Classification failed.');setItems(prev=>prev.map(x=>x.id===item.id?{...x,result:{...data,instructions},error:undefined}:x)); }
      catch(error){const text=error instanceof Error?error.message:'Classification failed.';setItems(prev=>prev.map(x=>x.id===item.id?{...x,error:text}:x));setMessage(text);break;}
    }
    setBusy(false);setProgress('');
  }
  async function importFiles(list:FileList|null) {
    if(!list)return;setMessage('');const incoming:Item[]=[];
    for(const file of Array.from(list).filter(f=>/^image\/(jpeg|png|webp)$/.test(f.type)).slice(0,500)) {
      if(file.size>20_000_000){setMessage('Skipped an image larger than 20 MB.');continue;}
      const path=file.webkitRelativePath||file.name, folders=path.split('/').slice(0,-1).join('/').toLowerCase();
      const label:Category|undefined=/rotten/.test(folders)?'rotten':/healthy|fresh/.test(folders)?'healthy':undefined;
      try {const url=URL.createObjectURL(file);let src;try{src=await imageData(url)}finally{URL.revokeObjectURL(url)}incoming.push({id:crypto.randomUUID(),src,name:file.name,label,sourcePath:path});}catch{setMessage('An image could not be read and was skipped.');}
    }
    setItems(prev=>[...prev,...incoming]);if(incoming[0])setSelected(incoming[0].id);if(!incoming.length)setMessage('Choose JPEG, PNG, or WebP images.');if(filesRef.current)filesRef.current.value='';if(folderRef.current)folderRef.current.value='';
  }
  function exportResults() { const data={exportedAt:new Date().toISOString(),dataset:'muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten, version 1',instructions,items:items.map(({src,...item})=>({...item,image:src.startsWith('/samples/')?src:'Imported image; retain your original file'}))};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='fruit-decisions-results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function reset() {if(!confirm('Clear classifications and imported images, and restore the Kaggle sample?'))return;const sample=await fetch('/samples/manifest.json').then(async r=>await r.json() as Item[]);setItems(sample);setSelected(sample[0]?.id||'');setFilter('all');setOnlyMismatch(false);setMessage('');}
  return <main>
    <header><a className="brand" href="/">Fruit<span> / </span>Decisions Lab</a><span className="model">OPENAI · gpt-6-luna</span><button className="quiet" onClick={()=>setSettings(!settings)}>Experiment settings ↗</button></header>
    <section className="toolbar"><div><p className="eyebrow">EXPERIMENT 001 / VISIBLE CONDITION</p><h1>Inspect. Decide. Compare.</h1><p className="muted">A labeled apple sample, one image at a time.</p></div><div className="actions"><button onClick={()=>folderRef.current?.click()} disabled={busy}>Import folder</button><button onClick={()=>filesRef.current?.click()} disabled={busy}>Add images</button><button onClick={exportResults} disabled={!completed.length}>Export results ↓</button></div></section>
    <input hidden type="file" multiple accept="image/jpeg,image/png,image/webp" ref={filesRef} onChange={e=>importFiles(e.target.files)}/><input hidden type="file" multiple accept="image/jpeg,image/png,image/webp" {...{webkitdirectory:''}} ref={folderRef} onChange={e=>importFiles(e.target.files)}/>
    {!configured&&<aside className="notice"><span className="dot"/><div><strong>Ready for your API key.</strong> Image browsing and imports are available. <span>Add <code>OPENAI_API_KEY</code> to the server environment to run real decisions.</span></div><button className="quiet" onClick={async()=>{const s=await fetch('/api/status').then(async r=>await r.json() as {configured:boolean});setConfigured(s.configured);if(!s.configured)setMessage('The server does not have OPENAI_API_KEY yet.');}}>Check connection ↻</button></aside>}
    {settings&&<section className="settings"><label htmlFor="instructions">Classification instructions</label><textarea id="instructions" rows={4} value={instructions} disabled={busy} onChange={e=>setInstructions(e.target.value)}/><p className="muted">Results retain the instructions used for each run. Only image pixels and these instructions are sent; filenames and labels stay in the app.</p><div className="actions"><button onClick={()=>setInstructions(defaultInstructions)} disabled={busy}>Restore instructions</button><button onClick={reset} disabled={busy}>Reset experiment</button></div></section>}
    <section className="summary"><span><b>{items.length}</b> images</span><span><b>{completed.length}</b> classified</span><span><b>{evaluable.length?percent(correct.length/evaluable.length):'—'}</b> label agreement <small>({evaluable.length} labeled results)</small></span><span><b>{items.filter(mismatch).length}</b> disagreements</span></section>
    {message&&<div className="error" role="alert">{message}<button className="quiet" onClick={()=>setMessage('')}>Dismiss</button></div>}
    <section className="workspace"><div className="viewer"><div className="viewer-label"><span>{active?active.name:'Select an image'}</span><span>{active?`${items.indexOf(active)+1} / ${items.length}`:'—'}</span></div><div className="image-stage" onDoubleClick={()=>active&&setDetailsId(active.id)}>{active?<img key={active.id} src={active.src} alt={`Selected fruit photograph: ${active.name}`}/>:<p>{ready?'Import images to begin.':'Loading sample…'}</p>}</div><div className="image-footer"><span>Dataset label <strong>{active?.label?titles[active.label]:'Unlabeled'}</strong></span><div className="actions"><button disabled={!active} onClick={()=>active&&setDetailsId(active.id)}>View details ↗</button><button disabled={busy||!active||items.indexOf(active)===0} aria-label="Previous image" onClick={()=>setSelected(items[items.indexOf(active!)-1].id)}>←</button><button disabled={busy||!active||items.indexOf(active)===items.length-1} aria-label="Next image" onClick={()=>setSelected(items[items.indexOf(active!)+1].id)}>→</button></div></div></div>
    <aside className="inspector"><p className="eyebrow">DECISION RESULT</p><h2>{active?.result?titles[resultCategory(active)]:'Awaiting decision'}</h2><p className="muted">{active?.result?'Returned by the Decisions API.':'Classify the selected image to see the result and category probabilities.'}</p><div className="probabilities">{(['healthy','rotten','unclear'] as Category[]).map(category=>{const p=answer?.probabilities?.find(x=>x.value===category)?.probability;return <div key={category}><div className="prob-label"><span>{titles[category]}</span><span>{percent(p)}</span></div><div className="track"><div style={{width:`${(p||0)*100}%`}}/></div></div>})}</div>
    {active?.result&&<div className="result-meta"><span>API confidence <b>{percent(answer?.confidence)}</b></span><span>Request time <b>{(active.result.elapsedMs/1000).toFixed(2)} s</b></span>{active.label&&<span>Dataset comparison <b>{answer?.type==='refusal'?'Not scored':mismatch(active)?'Disagrees':'Matches'}</b></span>}<p className="muted">Probability estimates are model outputs; label agreement measures this sample only.</p></div>}
    {active?.error&&<p className="error">{active.error}</p>}
    <button className="primary" disabled={busy||!configured||!active||!instructions.trim()} onClick={()=>active&&classify([active])}>{busy?`Classifying ${progress}…`:active?.result?'Classify again ↗':'Classify image ↗'}</button>
    {busy?<button onClick={()=>{stop.current=true;setProgress('Stopping after current image')}}>Stop after this image</button>:<button disabled={!configured||!items.some(x=>!x.result)||!instructions.trim()} onClick={()=>classify(items.filter(x=>!x.result))}>Classify remaining ({items.filter(x=>!x.result).length})</button>}
    {active?.result&&<details open={raw} onToggle={e=>setRaw(e.currentTarget.open)}><summary>API response & run instructions</summary><pre>{JSON.stringify(active.result,null,2)}</pre></details>}
    </aside></section>
    <section className="collection"><div className="collection-header"><div><h2>Image collection</h2><p className="collection-hint">Double-click an image to inspect its decision.</p></div><label className="toggle"><input type="checkbox" checked={onlyMismatch} onChange={e=>setOnlyMismatch(e.target.checked)}/> Disagreements only</label></div><nav className="filters" aria-label="Filter by decision"><button className={filter==='all'?'chosen':''} onClick={()=>setFilter('all')}>All <span>{items.length}</span></button>{['pending','healthy','rotten','unclear','refused'].map(c=><button key={c} className={filter===c?'chosen':''} onClick={()=>setFilter(c)}>{titles[c]} <span>{items.filter(x=>resultCategory(x)===c).length}</span></button>)}</nav>
    <div className="gallery">{visible.map(item=><button className={`thumbnail ${selected===item.id?'selected':''}`} key={item.id} disabled={busy} onClick={()=>setSelected(item.id)} onDoubleClick={()=>setDetailsId(item.id)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();setSelected(item.id);setDetailsId(item.id);}}} title="Double-click or press Enter to view decision details"><img loading="lazy" src={item.src} alt={item.name}/><div><span>{item.name}</span><span className={mismatch(item)?'disagreement':''}>{titles[resultCategory(item)]}{mismatch(item)?' ≠':''}</span></div></button>)}</div>{!visible.length&&<p className="empty">No images in this group yet.</p>}</section>

    <dialog ref={detailsDialog} className="decision-dialog" aria-labelledby="decision-details-title" onClose={()=>setDetailsId(null)} onClick={e=>{if(e.target===e.currentTarget){const bounds=e.currentTarget.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)setDetailsId(null);}}}>
      {detailItem&&<><div className="dialog-header"><div><p className="eyebrow">DECISION DETAILS</p><h2 id="decision-details-title">{detailItem.name}</h2></div><button autoFocus onClick={()=>setDetailsId(null)} aria-label="Close decision details">Close ×</button></div>
      <div className="dialog-content"><div className="dialog-image"><img src={detailItem.src} alt={`Fruit photograph: ${detailItem.name}`}/></div><div className="dialog-result">
        <h2>{titles[resultCategory(detailItem)]}</h2>
        {detailItem.result?<><p className="muted">{detailAnswer?.type==='refusal'?'The API declined to classify this image.':'Category probabilities returned by the Decisions API.'}</p>
          {detailAnswer?.type!=='refusal'&&<><div className="probabilities">{(['healthy','rotten','unclear'] as Category[]).map(category=>{const p=detailAnswer?.probabilities?.find(x=>x.value===category)?.probability;return <div key={category}><div className="prob-label"><span>{titles[category]}</span><b>{percent(p)}</b></div><div className="track"><div style={{width:`${(p||0)*100}%`}}/></div></div>})}</div><div className="result-meta"><span>API confidence <b>{percent(detailAnswer?.confidence)}</b></span></div></>}
          <div className="result-meta"><span>Dataset label <b>{detailItem.label?titles[detailItem.label]:'Unlabeled'}</b></span><span>Comparison <b>{!detailItem.label||detailAnswer?.type==='refusal'?'Not scored':mismatch(detailItem)?'Disagrees':'Matches'}</b></span><span>Model <b>{detailItem.result.model}</b></span><span>Request time <b>{(detailItem.result.elapsedMs/1000).toFixed(2)} s</b></span><span>Evaluated <b>{new Date(detailItem.result.evaluatedAt).toLocaleString()}</b></span></div>
          <p className="muted">Probabilities and confidence are separate API outputs. These estimates do not establish food safety.</p>
        </>:<><p className="muted">This image has not been classified yet. Close this view and choose Classify image to get a result.</p><div className="result-meta"><span>Dataset label <b>{detailItem.label?titles[detailItem.label]:'Unlabeled'}</b></span></div></>}
        {detailItem.error&&<p className="error">{detailItem.error}</p>}
      </div></div>
      {detailItem.result&&<div className="dialog-run"><details><summary>Instructions used for this decision</summary><p>{detailItem.result.instructions}</p></details><details><summary>Full API response</summary><pre>{JSON.stringify(detailItem.result,null,2)}</pre></details></div>}
      </>}
    </dialog>
    <footer><span>Source: <a href="https://www.kaggle.com/datasets/muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten" target="_blank" rel="noreferrer">Kaggle · Healthy vs Rotten</a> · v1 · listed CC0</span><span>Results and imports are saved in this browser. <a href="https://developers.openai.com/api/docs/guides/decisions" target="_blank" rel="noreferrer">API guide ↗</a></span></footer>
  </main>;
}
