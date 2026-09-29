import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
await page.addInitScript(()=>{
 window.__THREE_DEVTOOLS__=new EventTarget();
 __THREE_DEVTOOLS__.addEventListener('observe',e=>{if(e.detail.isRenderer){const r=e.detail, render=r.render.bind(r); r.render=(scene,camera,...args)=>{if(scene.isScene&&scene.children.length>10){window.scene=scene;window.camera=camera;}return render(scene,camera,...args);};}});
});
await page.goto('http://localhost:4174/?camera=34');await page.waitForFunction(()=>window.aquarium?.elapsed>2);
const evidence=await page.evaluate(()=>{
 const floor=scene.children.find(o=>o.name==='Floor with integrated contact shadow');
 const point=camera.position.clone().set(2,0,2.5).project(camera);
 return {floorCount:scene.children.filter(o=>o.geometry?.parameters?.width===10000).length,contactPlanes:scene.children.filter(o=>o.geometry?.parameters?.width===9).length,receiveShadow:floor.receiveShadow,material:floor.material.type,regionCenter:[(point.x*.5+.5)*innerWidth*devicePixelRatio,(-point.y*.5+.5)*innerHeight*devicePixelRatio]};
});
assert.equal(evidence.floorCount,1);assert.equal(evidence.contactPlanes,0);assert.equal(evidence.receiveShadow,false);
await mkdir('verify/run-f/shadow-final',{recursive:true});
for(let i=0;i<10;i++){await page.evaluate(()=>new Promise(requestAnimationFrame));await page.screenshot({path:`verify/run-f/shadow-final/${i}.png`});}
await writeFile('verify/run-f/shadow-final.json',JSON.stringify(evidence,null,2));console.log(evidence);await browser.close();
