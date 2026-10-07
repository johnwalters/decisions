import sharp from 'sharp';
import fs from 'node:fs/promises';
const root=new URL('../public/samples/',import.meta.url);
const rows=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
for(const item of rows){const file=new URL(item.src.split('/').at(-1),root);const original=await fs.readFile(file);const output=await sharp(original).rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).toBuffer();await fs.writeFile(file,output);}
console.log(`Optimized ${rows.length} images to at most 1024 pixels.`);
