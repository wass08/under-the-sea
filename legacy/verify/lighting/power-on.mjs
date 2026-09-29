import {execFileSync} from 'node:child_process';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const run=(...args)=>JSON.parse(execFileSync('agent-browser',['--session','aquarium-lamp-power','--json',...args],{encoding:'utf8',maxBuffer:40e6}));
const dir=await mkdtemp(join(tmpdir(),'aquarium-power-')),file=join(dir,'power-capture.js');
try {
 const capture=`{
  const targets=[0,.2,.4,.6,.9,1.3],frames=[],raf=requestAnimationFrame.bind(window);let i=0,resolve;
  window.powerFramesPromise=new Promise(r=>resolve=r);
  // Capture after the application's render callback, before WebGPU presents/clears.
  window.requestAnimationFrame=callback=>raf(time=>{callback(time);
   const s=window.aquarium;if(i>=targets.length||!s||document.documentElement.dataset.status!=='ready'||s.lampSequenceTime<targets[i])return;
   const source=document.querySelector('#app canvas'),c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.drawImage(source,0,0);
   frames.push({target:targets[i++],actual:s.lampSequenceTime,value:s.lampOn,enabled:s.lampEnabled,canvas:c});
   if(i===targets.length)resolve({frames:frames.map(({canvas,...f})=>({...f,png:canvas.toDataURL()})),audio:aquarium.audio,done:aquarium.lampSequenceDone});
  });
 }`;
 await writeFile(file,capture);
 run('--webgpu','--init-script',file,'open','about:blank');run('set','viewport','1920','1080');
 run('open',`${process.env.VERIFY_URL||'http://localhost:4174/'}?camera=lighting-idle`);
 const data=run('eval','window.powerFramesPromise').data.result;
 assert.equal(data.frames.length,6);assert.equal(data.frames[0].value,0);assert.equal(data.done,true);assert.equal(data.audio.lampPlays,0);
 for(let i=0;i<data.frames.length;i++){const f=data.frames[i];await writeFile(`verify/lighting/power-on-${String(i).padStart(2,'0')}.png`,Buffer.from(f.png.split(',')[1],'base64'));delete f.png;assert.ok(f.actual-f.target<.08,`Frame ${i} missed: ${f.actual}`);}
 await writeFile('verify/lighting/power-on.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data));
}finally{try{run('close');}finally{await rm(dir,{recursive:true,force:true});}}
