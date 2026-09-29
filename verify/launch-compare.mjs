import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const profiles=(process.env.PROFILES||'legacy,economy,launch').split(','),shots=process.argv.includes('--shots'),only=process.env.CASE;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.aquarium),click=async p=>{await page.mouse.click(p.x,p.y);await page.waitForTimeout(200);};
const base=process.env.VERIFY_URL||'http://localhost:4175/';
const open=async(profile,single)=>{await page.goto(`${base}?fourWallPerf&launchProbe&physics=${profile}${single?'&camera=default':''}`);await page.waitForFunction(()=>window.aquarium?.elapsed>2,null,{timeout:90000});};
const four=async()=>{
 await click((await state()).aboveTarget);await page.waitForTimeout(1000);await click((await state()).wallTargets[0]);await click((await state()).wallTargets[2]);
 await page.mouse.move(900,350);await page.mouse.down();await page.mouse.move(1440,350,{steps:30});await page.mouse.up();await page.waitForTimeout(2000);
 await click((await state()).wallTargets[1]);await click((await state()).wallTargets[3]);const s=await state();assert.equal(s.cracks,4);
 await page.waitForFunction(sill=>!window.aquarium.spilling&&Math.abs(window.aquarium.height-sill)<.001,Math.min(...s.holes.map(h=>h.bottom)),{timeout:90000});
};
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]??0,round=n=>+n.toFixed(3);
try{
 for(const profile of profiles) {
  const dir=`verify/perf-${profile==='legacy'?'before':profile==='launch'?'after':'current'}`;await mkdir(dir,{recursive:true});
  if(!shots)for(const scenario of (only?[only]:['single','four'])) {
   await open(profile,scenario==='single');if(scenario==='four')await four();
   await page.evaluate(()=>{window.launchProbe.arm();window.fourWallPerf.samples.length=0;});await page.keyboard.press('Space');
   await page.waitForFunction(()=>window.launchProbe.frames.at(-1)?.age>=10,null,{timeout:180000});
   const data=await page.evaluate(()=>({launch:window.launchProbe.launch,frames:window.launchProbe.frames,perf:window.fourWallPerf.samples,physics:window.aquarium.physics}));
   const closest=(t,key='age')=>data.frames.reduce((a,b)=>Math.abs(a[key]-t)<=Math.abs(b[key]-t)?a:b),fps=(a,b,key='wallAge')=>round(1000/median(data.frames.filter(s=>s[key]>=a&&s[key]<b).map(s=>s.frameMs)));
   const row={profile,scenario,impulseFrames:data.launch.impulseFrames,impulses:data.launch.impulses,stepsFirstHalfSecond:closest(.5,'wallAge').totalSteps,stepsFirstHalfSimSecond:closest(.5).totalSteps,fpsAirborne:fps(.1,1.5),fpsSettled:fps(8,10),fpsSceneAirborne:fps(.1,1.5,'age'),at:[0,.1,.3,.6,1,1.5].map(t=>({target:t,...closest(t)})),wallAt:[.3,.6].map(t=>({target:t,...closest(t,'wallAge')}))};
   results.push(row);await writeFile(`${dir}/launch-${scenario}.json`,JSON.stringify({...row,...data},null,2));console.log(JSON.stringify(row));
  }
  if(shots)for(const t of [.1,.3,.6,1]) {
   await open(profile,true);await page.evaluate(t=>window.launchProbe.arm([t]),t);await page.keyboard.press('Space');
   await page.waitForFunction(()=>window.launchProbe.images.length===1,null,{timeout:90000});
   const shot=await page.evaluate(()=>window.launchProbe.images[0]);await writeFile(`${dir}/launch-${String(Math.round(t*10)).padStart(2,'0')}.png`,Buffer.from(shot.data.split(',')[1],'base64'));
   console.log(`${profile} launch-${String(Math.round(t*10)).padStart(2,'0')}.png requested ${t}s captured ${shot.actual.toFixed(4)}s`);
  }
 }
 assert.deepEqual(errors,[]);await writeFile(`verify/launch-${shots?'shots':'comparison'}.json`,JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
