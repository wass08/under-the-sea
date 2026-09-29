import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
export async function verifyPond(page,base){
 await page.goto(`${base}?camera=default&pondProbe`);await page.waitForFunction(()=>window.aquarium?.elapsed>2&&window.aquarium.lampSequenceDone&&window.aquarium.lampOn===1,null,{timeout:90000});
 await page.evaluate(()=>window.pondProbe.arm(3));await page.keyboard.press('Space');await page.waitForFunction(()=>window.pondProbe.frozen,null,{timeout:90000});
 const pond=await page.evaluate(()=>window.aquarium.puddles[0]);assert.ok(pond,'Wet pond at three seconds');
 await page.evaluate(p=>window.pondProbe.view([p.position[0]+3,1.5,p.position[2]+5],[p.position[0],-.36,p.position[2]]),pond);
 await page.waitForTimeout(200);const candidates=await page.evaluate(()=>window.pondProbe.candidates());assert.ok(candidates.length>0,'Real upward shard triangles inside the pond outline');
 const pixels={};for(const mode of ['normal','pond-only','glass-only','glass-last','pond-last']){
  await page.evaluate(mode=>window.pondProbe.layer(mode),mode);await page.waitForTimeout(100);
  const png=await page.screenshot();pixels[mode]=await page.evaluate(async({png,points})=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const scale=img.width/innerWidth;return points.map(p=>[...ctx.getImageData(Math.round(p.pixel[0]*scale),Math.round(p.pixel[1]*scale),1,1).data].slice(0,3));},{png:png.toString('base64'),points:candidates});
 }
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 const ranked=candidates.map((p,i)=>({i,score:distance(pixels['glass-last'][i],pixels['pond-last'][i])})).sort((a,b)=>b.score-a.score),index=ranked[0].i;
 const evidence={age:await page.evaluate(()=>window.pondProbe.age),candidate:candidates[index],pixels:Object.fromEntries(Object.entries(pixels).map(([k,v])=>[k,v[index]])),ordering:await page.evaluate(()=>window.pondProbe.ordering)};
 const rgb=evidence.pixels;assert.ok(distance(rgb['glass-last'],rgb['pond-last'])>20,'Probe distinguishes glass from the old pond-over-glass result');
 assert.ok(distance(rgb.normal,rgb['glass-last'])<3,'Actual shard pixel matches glass drawn above the pond');
 assert.ok(distance(rgb.normal,rgb['glass-only'])<distance(rgb.normal,rgb['pond-only']),'Shard colour dominates pond tint inside its footprint');
 await page.evaluate(()=>window.pondProbe.layer('normal'));await page.waitForTimeout(100);evidence.ordering=await page.evaluate(()=>window.pondProbe.ordering);
 assert.ok(evidence.ordering.ponds.every(p=>p.order<3&&!p.depthWrite&&p.depthTest));assert.ok(evidence.ordering.shard.depthTest&&!evidence.ordering.shard.depthWrite);
 await mkdir('verify/perf-after',{recursive:true});await page.screenshot({path:'verify/perf-after/pond-under-shards.png'});await writeFile('verify/perf-after/pond-pixel.json',JSON.stringify(evidence,null,2));
 return `PASS pond under shards: pixel ${candidates[index].pixel.map(Math.round)} RGB ${rgb.normal}; glass-last ${rgb['glass-last']}, pond-last ${rgb['pond-last']}; floor depth-testing retained`;
}
