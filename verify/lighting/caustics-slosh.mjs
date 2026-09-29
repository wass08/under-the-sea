import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 await page.goto(`${process.env.VERIFY_URL||'http://localhost:4174/'}?camera=front`);await page.waitForFunction(()=>window.aquarium?.elapsed>2&&aquarium.lampOn===1);
 const target=await page.evaluate(()=>aquarium.crackTarget);await page.mouse.click(target.x,target.y);
 const start=await page.evaluate(()=>aquarium.elapsed);
 // Orbit to the lamp side during the first 1.5 s of the front-wall spill.
 await page.mouse.move(960,540);await page.mouse.down();await page.mouse.move(1370,610);await page.mouse.up();
 const result=await page.evaluate(async start=>{
  const canvas=document.querySelector('#app canvas');
  while(aquarium.elapsed<start+1.5)await new Promise(requestAnimationFrame);
  const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d').drawImage(canvas,0,0);
  const {normal,height,wall,cracks,spilling,camera,lightDirection}=aquarium;
  return {secondsAfterCrack:aquarium.elapsed-start,normal,height,wall,cracks,spilling,camera,lightDirection,png:c.toDataURL()};
 },start);
 assert.equal(result.wall,0);assert.equal(result.cracks,1);assert.equal(result.spilling,true);assert.ok(Math.hypot(result.normal[0],result.normal[2])>0);assert.ok(result.camera.position[0]<0&&result.camera.position[2]<0);
 await writeFile('verify/lighting/caustics-slosh.png',Buffer.from(result.png.split(',')[1],'base64'));delete result.png;
 await writeFile('verify/lighting/caustics-slosh.json',JSON.stringify(result,null,2));
 console.log(`PASS front-wall spill: ${result.secondsAfterCrack.toFixed(3)} s; tilted normal ${JSON.stringify(result.normal)}; lamp-side camera ${JSON.stringify(result.camera.position)}`);
} finally {await browser.close();}
