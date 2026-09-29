import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1}),base=process.env.VERIFY_URL||'http://localhost:4174/',errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));
const level=async n=>{await page.evaluate(n=>{location.hash=`#/lab/caustics?level=${n}`;},n);await page.waitForFunction(n=>window.lab?.ready&&lab.state.level===n,n);await page.waitForTimeout(500);};
const capture=async name=>page.screenshot({path:`verify/lab/${name}.png`,clip:{x:320,y:110,width:1280,height:810}});
try {
 await page.goto(`${base}#/lab/caustics?level=1`);await page.waitForFunction(()=>window.lab?.ready);
 await page.evaluate(()=>lab.setReveal({freeze:true}));
 const before={};
 for(const n of [2,3]) {await level(n);assert.equal(await page.evaluate(()=>lab.state.elapsed),0);before[n]=await capture(`caustics-L${n}-untouched`);}
 await level(1);
 for(const [label,value] of [['sine frequency A','5'],['sine frequency B','7'],['speed','.9']]) {
  const input=page.locator('.tp-lblv').filter({has:page.locator('.tp-lblv_l',{hasText:new RegExp(`^${label}$`)})}).locator('input[type="text"]');
  await input.fill(value);await input.press('Enter');
 }
 assert.deepEqual(await page.evaluate(()=>[lab.state.sineScaleA,lab.state.sineScaleB,lab.state.sineSpeed]),[5,7,.9]);
 for(const n of [2,3]) {
  await level(n);const state=await page.evaluate(()=>lab.state);assert.equal(state.elapsed,0);assert.deepEqual([state.scaleA,state.scaleB,state.speed],[2.3,3.7,.32]);
  const after=await capture(`caustics-L${n}-after-L1`);
  const differences=await page.evaluate(async pngs=>{
   const images=await Promise.all(pngs.map(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}));
   let pixels=0;for(let i=0;i<images[0].length;i+=4)if([0,1,2,3].some(k=>images[0][i+k]!==images[1][i+k]))pixels++;return pixels;
  },[before[n].toString('base64'),after.toString('base64')]);
  assert.equal(differences,0);report.push({level:n,time:state.elapsed,differences,shared:[state.scaleA,state.scaleB,state.speed]});
  console.log(`PASS L${n}: L1 sine 5 / 7 / .9; frozen t=0; scene crop 1280x810: ${differences} differing pixels`);
 }
 await level(1);assert.deepEqual(await page.evaluate(()=>[lab.state.sineScaleA,lab.state.sineScaleB,lab.state.sineSpeed]),[5,7,.9]);
 assert.deepEqual(errors,[]);await writeFile('verify/lab/caustics-isolation.json',JSON.stringify(report,null,2));
} finally {await browser.close();}
