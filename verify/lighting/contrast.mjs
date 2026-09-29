import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { contrastPair } from '../image-metrics.mjs';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${process.env.VERIFY_URL||'http://localhost:4176/'}?camera=front`);await page.waitForFunction(()=>window.aquarium?.elapsed>2);
 const pair=contrastPair(await page.evaluate(()=>window.aquarium));
 const png=await page.screenshot({path:'verify/lighting/contrast-front.png'});
 const result=await page.evaluate(async ({pair,png})=>{
  const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  const sample=([x,y])=>{const data=ctx.getImageData(x-2,y-2,5,5).data;let sum=0;for(let i=0;i<data.length;i+=4)for(let k=0;k<3;k++){const v=data[i+k]/255;sum+=(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][k];}return sum/25;};
  const lit=sample(pair.litPixel),dark=sample(pair.darkPixel);return {lit,dark,ratio:lit/dark,shadowFraction:dark/lit,pair};
 },{pair,png:png.toString('base64')});
 result.errors=errors;await writeFile('verify/lighting/contrast.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert.ok(result.ratio>=1.8);assert.ok(result.shadowFraction>=.35);assert.deepEqual(errors,[]);
} finally {await browser.close();}
