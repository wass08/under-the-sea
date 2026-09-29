import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const results=[];
for(const mode of ['no-reflection','full']){
 await page.goto(`http://localhost:4174/?camera=default&waterProfile=${mode}`);
 await page.waitForFunction(()=>window.aquarium?.gpu.samples.length>=170,{},{timeout:90000});
 await page.waitForTimeout(2500);
 const s=await page.evaluate(()=>window.aquarium);assert.ok(s.gpu.supported);assert.ok(s.gpu.samples.length>100);
 results.push({mode,water:median(s.gpu.samples.map(s=>s.water)),reflection:median(s.gpu.samples.map(s=>s.reflection)),fps:s.fps,drawCalls:s.drawCalls});console.log(results.at(-1));
}
await page.keyboard.press('Space');await page.waitForTimeout(11000);
const s=await page.evaluate(()=>window.aquarium);results.push({mode:'shattered',water:median(s.gpu.samples.map(s=>s.water)),reflection:median(s.gpu.samples.map(s=>s.reflection)),fps:s.fps,drawCalls:s.drawCalls});
await writeFile('verify/run-m/gpu.json',JSON.stringify({results,errors},null,2));assert.deepEqual(errors,[]);await browser.close();
