import {chromium} from 'playwright';import {writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']}),page=await browser.newPage({viewport:{width:807,height:869},deviceScaleFactor:1.5}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{for(const profile of ['previous','individual']) {
 await page.goto(`${process.env.VERIFY_URL||'http://localhost:4175/'}?camera=default&physics=launch&fourWallPerf&launchProbe&groupingProbe&grouping=${profile}`);await page.waitForFunction(()=>window.aquarium?.elapsed>2);
 await page.evaluate(()=>{document.querySelectorAll('header,footer,#hud').forEach(e=>e.style.visibility='hidden');window.groupingProbe.armFloor();window.launchProbe.arm([2]);});await page.keyboard.press('Space');
 await page.waitForFunction(()=>window.launchProbe.images.length===1);const result=await page.evaluate(()=>({floor:window.groupingProbe.floor,grouping:window.groupingProbe.snapshot(),shot:window.launchProbe.images[0]}));
 const dir=profile==='individual'?'verify/perf-after':'verify/grouping-current';await mkdir(dir,{recursive:true});await writeFile(`${dir}/shards-floor.png`,Buffer.from(result.shot.data.split(',')[1],'base64'));delete result.shot.data;await writeFile(`${dir}/shards-floor.json`,JSON.stringify(result,null,2));console.log(`${profile} floor captured ${result.floor.age.toFixed(4)} s: ${result.grouping.bodies} bodies, histogram ${result.grouping.histogram}`);
}assert.deepEqual(errors,[]);}finally{await browser.close();}
