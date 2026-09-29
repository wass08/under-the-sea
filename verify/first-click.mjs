import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Same Chrome/WebGPU configuration and render resolution as runtime.mjs.
// Interleave archived before/after builds with:
// VERIFY_BEFORE_DIST=/archive VERIFY_DIST=dist node verify/first-click.mjs compare
const mode=process.argv[2]||'after', measurements={}, transcripts={};
if(mode==='compare')assert.ok(process.env.VERIFY_BEFORE_DIST,'Archive the baseline before changing the application');
const log=(label,line)=>{console.log(line);(transcripts[label]??=[]).push(line);};
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
try {
  for(let run=1;run<=3;run++) for(const label of mode==='compare'?['before','after']:[mode]) {
    const results=measurements[label]??=[];
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
    // Optional archived build, served at the same origin for paired measurements.
    const archive=label==='before'&&mode==='compare'?process.env.VERIFY_BEFORE_DIST:process.env.VERIFY_DIST;
    if(archive)await page.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path!=='/'&&!/\.(js|css)$/.test(path))return route.continue();
      const body=await readFile(resolve(archive,path==='/'?'index.html':path.slice(1)));
      await route.fulfill({body,contentType:path==='/'?'text/html':path.endsWith('.js')?'text/javascript':'text/css'});
    });
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{
      const probe=window.clickProbe={ready:0,click:0,handlers:[],frames:[],ticks:[],pipelines:[]};
      const add=EventTarget.prototype.addEventListener;
      const remove=EventTarget.prototype.removeEventListener, listeners=new WeakMap();
      EventTarget.prototype.addEventListener=function(type,listener,options){
        if(type==='pointerup' && typeof listener==='function') {
          const original=listener;
          if(!listeners.has(original))listeners.set(original,function(e){const start=performance.now();try{return original.call(this,e);}finally{probe.handlers.push({start,ms:performance.now()-start});}});
          listener=listeners.get(original);
        }
        return add.call(this,type,listener,options);
      };
      EventTarget.prototype.removeEventListener=function(type,listener,options){return remove.call(this,type,type==='pointerup'?(listeners.get(listener)||listener):listener,options);};
      add.call(window,'pointerup',()=>{probe.click=performance.now();},{capture:true});
      const raf=requestAnimationFrame;
      window.requestAnimationFrame=callback=>raf.call(window,t=>{const start=performance.now();try{callback(t);}finally{probe.frames.push({start,ms:performance.now()-start});}});
      const observe=()=>{const now=performance.now();probe.ticks.push(now);if(document.documentElement?.dataset.status==='ready'&&!probe.ready)probe.ready=now;raf.call(window,observe);};raf.call(window,observe);
      for(const name of ['createRenderPipeline','createRenderPipelineAsync']) {
        const original=GPUDevice.prototype[name];
        GPUDevice.prototype[name]=function(...args){const start=performance.now();const result=original.apply(this,args);probe.pipelines.push({name,start,ms:performance.now()-start});return result;};
      }
    });
    await page.goto((process.env.VERIFY_URL||'http://localhost:4174/')+'?camera=default');
    await page.waitForFunction(()=>document.documentElement.dataset.status==='ready'&&window.aquarium.elapsed>2);
    const target=await page.evaluate(()=>window.aquarium.crackTarget);
    await page.mouse.click(target.x,target.y);
    await page.waitForTimeout(750);
    const measure=()=>page.evaluate(()=>{
      const p=window.clickProbe, frames=p.frames.filter(f=>f.start>=p.click-100&&f.start<=p.click+750);
      // Include any refresh gap intersecting the 500 ms window, even a stall
      // whose ending frame arrives beyond that window. No screenshots during sampling.
      const gaps=p.ticks.slice(1).map((t,i)=>({start:p.ticks[i],ms:t-p.ticks[i]})).filter(f=>f.start+f.ms>=p.click&&f.start<p.click+500);
      return {loadMs:p.ready,longestFrameGapMs:Math.max(...gaps.map(f=>f.ms)),handlerMs:Math.max(...p.handlers.filter(f=>f.start>=p.click).map(f=>f.ms)),longestRenderMs:Math.max(...frames.filter(f=>f.start>=p.click&&f.start<=p.click+500).map(f=>f.ms)),pipelinesAfterClick:p.pipelines.filter(f=>f.start>=p.click&&f.start<=p.click+500),frames:gaps,cracks:window.aquarium.cracks};
    });
    const result=await measure();
    assert.equal(result.cracks,1);assert.deepEqual(errors,[]);results.push(result);
    log(label,`${label} run ${run}: longest frame gap ${result.longestFrameGapMs.toFixed(1)} ms, load time ${result.loadMs.toFixed(1)} ms, handler ${result.handlerMs.toFixed(1)} ms, render ${result.longestRenderMs.toFixed(1)} ms, new pipelines ${result.pipelinesAfterClick.length}`);
    if(label==='after') {
      await page.keyboard.press('r');await page.keyboard.press('r');await page.waitForTimeout(4200);
      assert.equal(await page.evaluate(()=>window.aquarium.cracks),0);
      const target=await page.evaluate(()=>window.aquarium.crackTarget);await page.mouse.click(target.x,target.y);await page.waitForTimeout(750);
      result.reset=await measure();assert.equal(result.reset.cracks,1);assert.equal(result.reset.pipelinesAfterClick.length,0);
      log(label,`reset run ${run}: longest frame gap ${result.reset.longestFrameGapMs.toFixed(1)} ms, new pipelines ${result.reset.pipelinesAfterClick.length}`);
      if(run===3) {
        const other=await page.evaluate(()=>window.aquarium.wallTargets[2]);await page.mouse.click(other.x,other.y);await page.waitForTimeout(750);
        result.secondWall=await measure();assert.equal(result.secondWall.cracks,2);assert.equal(result.secondWall.pipelinesAfterClick.length,0);
        assert.equal(await page.evaluate(()=>window.aquarium.spillFlow.length),2);
        log(label,`Second wall: ${result.secondWall.cracks} cracks, new pipelines ${result.secondWall.pipelinesAfterClick.length}`);
        await page.screenshot({path:'verify/two-wall-spill.png'});
      }
    }
    await page.close();
  }
  for(const [label,results] of Object.entries(measurements)) {
    await writeFile(`verify/first-click-${label}.json`,JSON.stringify(results,null,2));
    await writeFile(`verify/first-click-${label}.txt`,transcripts[label].join('\n')+'\n');
  }
  if(measurements.after) {
    const results=measurements.after,before=measurements.before??JSON.parse(await readFile('verify/first-click-before.json','utf8'));
    const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const delta=median(results.map(r=>r.loadMs))-median(before.map(r=>r.loadMs));
    const longest=Math.max(...results.map(r=>r.longestFrameGapMs));
    log('after',`Budget: longest first-click gap ${longest.toFixed(1)} ms (<50), median load delta ${delta.toFixed(1)} ms (<=300)`);
    await writeFile('verify/first-click-after.txt',transcripts.after.join('\n')+'\n');
    assert.ok(longest<50,'First-click frame budget');assert.ok(delta<=300,'Loading regression budget');
    assert.ok(results.every(r=>r.reset.longestFrameGapMs<50),'Retained warm-up after reset');
  }
} finally {await browser.close();}
