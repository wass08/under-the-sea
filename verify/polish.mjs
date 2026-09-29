import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {bundle} from './temp-build.mjs';
await bundle('verify/spill-lips.ts');
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5}),reports=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.aquarium),report=line=>{reports.push(line);console.log(line);};
try {
 await page.goto(process.env.VERIFY_URL||'http://localhost:4174/');await page.waitForFunction(()=>window.aquarium?.elapsed>2);
 const before=await state();assert.equal(before.cracks,0);await page.keyboard.press('r');await page.waitForTimeout(4200);
 const after=await state();assert.deepEqual(before.camera.target,[-.3,1.45,.15]);assert.deepEqual(after.camera.target,before.camera.target);
 report(`Pristine R target: PASS before=${JSON.stringify(before.camera.target)} after=${JSON.stringify(after.camera.target)} cracks=${after.cracks}`);
 await page.goto((process.env.VERIFY_URL||'http://localhost:4174/')+'?camera=default');await page.waitForFunction(()=>window.aquarium?.elapsed>2);
 const front=(await state()).wallTargets[0];await page.mouse.click(front.x,front.y);
 const back=(await state()).wallTargets[1];await page.mouse.click(back.x,back.y);
 const cracked=await state();assert.equal(cracked.cracks,2);assert.deepEqual(cracked.holes.map(h=>h.wall).sort(),[0,1]);
 await page.keyboard.press('Space');const start=(await state()).elapsed;await page.waitForFunction(t=>window.aquarium.elapsed>=t,start+.35);
 await page.screenshot({path:'verify/spill-two-walls.png'});
 report(`Opposite-wall screenshot: PASS walls=${JSON.stringify((await state()).spillFlow.map(f=>f.wall))} verify/spill-two-walls.png`);assert.deepEqual(errors,[]);
} finally {await writeFile('verify/polish.txt',reports.join('\n')+'\n');await browser.close();}
