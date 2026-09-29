import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const session='aquarium-lamp-revision',base=process.env.VERIFY_URL||'http://localhost:4174/';
const run=(...args)=>JSON.parse(execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',maxBuffer:4e6}));
const evaluate=js=>run('eval',js).data.result;
const wait=()=>run('wait','--fn','window.aquarium?.elapsed>2 && aquarium.lampSequenceDone && aquarium.lampOn===1');
const report={captures:[]};
try {
 run('--webgpu','open','about:blank');run('set','viewport','1920','1080');run('open',`${base}?camera=lamp-base`);wait();
 const button=evaluate('aquarium.lampSwitch');run('mouse','move',String(Math.round(button.x)),String(Math.round(button.y)));run('mouse','down');run('mouse','up');run('wait','--fn','aquarium.lampOn===0');
 report.switch=evaluate('({lampOn:aquarium.lampOn,intensity:aquarium.lampIntensity,floor:aquarium.floorCausticIntensity,cracks:aquarium.cracks,hasImpact:aquarium.hasImpact})');
 assert.equal(report.switch.lampOn,0);assert.equal(report.switch.intensity,0);assert.equal(report.switch.floor,0);assert.equal(report.switch.cracks,0);assert.equal(report.switch.hasImpact,false);
 report.ramp=evaluate(`(async()=>{const samples=[],start=performance.now();dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL'}));do {await new Promise(requestAnimationFrame);samples.push({ms:performance.now()-start,value:aquarium.lampOn});}while(aquarium.lampOn<1&&performance.now()-start<1000);return samples;})()`);
 assert.ok(report.ramp.some(s=>s.value>0&&s.value<1));assert.equal(report.ramp.at(-1).value,1);assert.ok(report.ramp.at(-1).ms>=300&&report.ramp.at(-1).ms<450);
 for(const [name,preset,debug,off] of [['idle-default','lighting-idle'],['floor-wide','floor-wide'],['lamp-side-floor','lamp-side-floor'],['lamp-base','lamp-base'],['shadows','shadows-closeup'],['shadows-closeup','shadows-closeup'],['shadow-debug','shadows-closeup',true],['lamp-off','lighting-idle',false,true]]) {
  run('open',`${base}?camera=${preset}${debug?'&shadowDebug':''}`);wait();
  if(off){run('press','l');run('wait','--fn','aquarium.lampOn===0');}
  const performance=evaluate(`(async()=>{const samples=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);samples.push(aquarium.fps);}samples.sort((a,b)=>a-b);return {medianFPS:samples[45],drawCalls:aquarium.drawCalls};})()`);
  run('screenshot',`verify/lighting/${name}.png`);
  report.captures.push({name,...performance,...evaluate('({lampOn:aquarium.lampOn,lampIntensity:aquarium.lampIntensity,head:aquarium.lampPosition,target:aquarium.lampTarget,elevation:aquarium.lampElevation,cone:aquarium.lampCone})')});
 }
 report.errors=run('errors').data;report.console=run('console').data;
 await writeFile('verify/lighting/revision.json',JSON.stringify(report,null,2));
 console.log('Lamp switch: PASS (no wall crack; lamp, pool and caustic diagnostics reach zero)');
 console.log(`Keyboard L ramp: PASS (${report.ramp.at(-1).ms.toFixed(1)} ms; intermediate values observed)`);
 for(const c of report.captures)console.log(`${c.name}: ${c.medianFPS} FPS, ${c.drawCalls} draw calls`);
}finally{run('close');}
