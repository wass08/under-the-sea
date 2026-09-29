// Isolate the existing crack -> drain -> full-shatter verification on the pre-M build.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
await page.goto('http://localhost:4175/?camera=default');await page.waitForFunction(()=>window.aquarium?.elapsed>2);
const target=await page.evaluate(()=>window.aquarium.crackTarget);await page.mouse.click(target.x,target.y);
await page.waitForFunction(()=>window.aquarium.cracks===1&&!window.aquarium.spilling&&Math.abs(window.aquarium.height-window.aquarium.holeBottom)<.05,{},{timeout:90000});
await page.keyboard.press('Space');const start=await page.evaluate(()=>window.aquarium.elapsed);
const result=await page.evaluate(async start=>{
 let reference,samples=0,maxDisplacement=0,maxRotation=0;
 while(window.aquarium.elapsed<start+4){
  await new Promise(requestAnimationFrame);const s=window.aquarium;if(s.elapsed<start+3)continue;
  reference??=s.shardTransforms;samples++;
  for(let i=0;i<reference.length;i+=7){
   const p=s.shardTransforms;
   maxDisplacement=Math.max(maxDisplacement,Math.hypot(...[0,1,2].map(k=>p[i+k]-reference[i+k])));
   const a=reference.slice(i+3,i+7),b=p.slice(i+3,i+7),dot=a.reduce((n,v,k)=>n+v*b[k],0)/Math.hypot(...a)/Math.hypot(...b);
   maxRotation=Math.max(maxRotation,2*Math.acos(Math.min(1,Math.abs(dot))));
  }
 }
 return {samples,maxDisplacement,maxRotation,awake:window.aquarium.awakeShards};
},start);
console.log(result);await writeFile('verify/run-m/settling-baseline.json',JSON.stringify(result,null,2));await browser.close();
