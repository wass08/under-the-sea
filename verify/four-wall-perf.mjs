import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
// Reuse an installed Puppeteer, including the browser skill's cache; install nothing.
let puppeteer;
const candidates=[process.env.PUPPETEER_PATH,'puppeteer-core','/opt/homebrew/lib/node_modules/mint/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'];
for(const d of await readdir(`${homedir()}/.npm/_npx`).catch(()=>[])) candidates.push(`${homedir()}/.npm/_npx/${d}/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js`);
for(const p of candidates.filter(Boolean)) {try{puppeteer=(await import(p.startsWith('/')?pathToFileURL(p).href:p)).default;break;}catch{}}
assert.ok(puppeteer,'Set PUPPETEER_PATH to an existing puppeteer-core entry point');
const label=process.argv[2]||'after',dir=`verify/perf-${label}`;await mkdir(dir,{recursive:true});
const browser=await puppeteer.launch({executablePath:chromium.executablePath(),headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist','--enable-precise-memory-info']});
const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1.5});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.aquarium),click=async p=>{await page.mouse.click(p.x,p.y);await new Promise(r=>setTimeout(r,200));};
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]??0,mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length),round=x=>+x.toFixed(3);
try {
 await page.goto(`${process.env.VERIFY_URL||'http://localhost:4175/'}?fourWallPerf&physics=${process.env.PHYSICS||'launch'}&wallBudget=${process.env.WALL_BUDGET||'adaptive'}`);await page.waitForFunction(()=>window.aquarium?.elapsed>2,{timeout:90000});
 // Same four-wall flow as edges.mjs, including the above-water first hole and rear orbit.
 await click((await state()).aboveTarget);await new Promise(r=>setTimeout(r,1000));await click((await state()).wallTargets[0]);await click((await state()).wallTargets[2]);
 await page.mouse.move(900,350);await page.mouse.down();await page.mouse.move(1440,350,{steps:30});await page.mouse.up();await new Promise(r=>setTimeout(r,2000));
 await click((await state()).wallTargets[1]);await click((await state()).wallTargets[3]);
 const multi=await state();assert.equal(multi.cracks,4);const sill=Math.min(...multi.holes.map(h=>h.bottom));
 await page.waitForFunction(sill=>!window.aquarium.spilling&&Math.abs(window.aquarium.height-sill)<.001,{timeout:90000},sill);
 const cdp=await page.createCDPSession(),events=[];cdp.on('Tracing.dataCollected',e=>events.push(...e.value));
 await cdp.send('Tracing.start',{categories:'v8,devtools.timeline,disabled-by-default-v8.gc',transferMode:'ReportEvents'});
 await page.evaluate(()=>{window.fourWallPerf.samples.length=0;window.fourWallPerf.origin=performance.now();console.timeStamp('four-wall-origin');addEventListener('keydown',e=>{if(e.code==='Space')window.fourWallPerf.start=window.aquarium.elapsed;},{once:true,capture:true});});
 await page.keyboard.press('Space');await page.waitForFunction(()=>window.aquarium.elapsed-window.fourWallPerf.start>=10.2,{timeout:180000});
 const data=await page.evaluate(()=>({origin:window.fourWallPerf.origin,samples:window.fourWallPerf.samples,start:window.fourWallPerf.start,state:{bodies:window.aquarium.shardBodies,awake:window.aquarium.awakeShards,physics:window.aquarium.physics}}));
 const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await done;
 const mainThreads=new Set(events.filter(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>e.tid));
 const origin=events.find(e=>e.name==='TimeStamp'&&e.args?.data?.message==='four-wall-origin');assert.ok(origin,'Trace clock anchor');const offset=origin.ts-data.origin*1000;
 const gc=events.filter(e=>e.ph==='X'&&['MinorGC','MajorGC'].includes(e.name)&&mainThreads.has(e.tid));
 const breakdown=(a,b)=>{
  const frames=data.samples.filter(s=>s.elapsed-data.start>=a&&s.elapsed-data.start<b),start=frames[0].now*1000+offset,end=frames.at(-1).now*1000+offset;
  const collections=gc.filter(e=>e.ts>=start&&e.ts<end),allocated=frames.reduce((sum,s,i)=>sum+(i?Math.max(0,s.heap-frames[i-1].heap):0),0);
  return {frames:frames.length,fpsMedian:round(1000/median(frames.map(s=>s.frame))),ms:Object.fromEntries(['frame','physics','rapier','collision','solver','ccd','sync','batch','spill','rewind','render','shadow'].map(k=>[k,round(mean(frames.map(s=>s[k])))])),stepsMean:round(mean(frames.map(s=>s.steps))),stepsMax:Math.max(...frames.map(s=>s.steps)),drawCalls:median(frames.map(s=>s.calls)),shadowCalls:median(frames.map(s=>s.shadowCalls)),gcMsPerFrame:round(collections.reduce((n,e)=>n+e.dur/1000,0)/frames.length),gcEvents:collections.length,heapGrowthKBPerFrame:round(allocated/1024/frames.length),uploadsKBPerFrame:round(mean(frames.map(s=>s.uploads))/1024),awakeMedian:median(frames.map(s=>s.awake))};
 };
 const report={label,viewport:[1920,1080],dpr:1.5,airborne:breakdown(.1,2),settled:breakdown(8,10),final:data.state,errors};
 await writeFile(`${dir}/measurements.json`,JSON.stringify(report,null,2));await writeFile(`${dir}/frames.json`,JSON.stringify(data));await writeFile(`${dir}/gc.json`,JSON.stringify(gc));
 console.log(JSON.stringify(report,null,2));assert.deepEqual(errors,[]);
 if(label==='after'){assert.ok(report.airborne.fpsMedian>=45,'Airborne median >=45 FPS');assert.ok(report.settled.fpsMedian>=55,'Settled median >=55 FPS');assert.ok(report.airborne.stepsMax<=3,'At most three launch steps per frame');assert.equal(report.settled.awakeMedian,0,'Native sleep in settled window');console.log('PASS four-wall-perf: airborne >=45 FPS, settled >=55 FPS, bounded physics steps, zero console errors');
 const before=JSON.parse(await readFile('verify/perf-before/measurements.json','utf8')),lines=[];
 for(const run of [before,report]) for(const phase of ['airborne','settled']) {
  const p=run[phase],m=p.ms;
  lines.push(`${run.label} ${phase}: FPS ${p.fpsMedian}; ms/frame physics ${m.physics} (Rapier ${m.rapier}), sync ${m.sync}, batch ${m.batch}, spill ${m.spill}, rewind ${m.rewind}, render ${m.render} (shadow ${m.shadow}), GC ${p.gcMsPerFrame}; steps mean/max ${p.stepsMean}/${p.stepsMax}; draws ${p.drawCalls} (shadow ${p.shadowCalls}); heap +KB/frame ${p.heapGrowthKBPerFrame}; shard upload KB/frame ${p.uploadsKBPerFrame}.`);
 }
 console.log(lines.join('\n'));await writeFile('verify/perf-evidence.txt',lines.join('\n')+'\n');}
}finally{await browser.close();}
