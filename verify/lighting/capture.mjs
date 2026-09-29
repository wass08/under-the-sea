import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const session='aquarium-lighting',base=process.env.VERIFY_URL||'http://localhost:4176/';
const run=(...args)=>execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',maxBuffer:4e6});
const evaluate=js=>JSON.parse(run('eval',js)).data.result;
await mkdir('verify/lighting',{recursive:true});const report=[];
try {
 run('--webgpu','open',`${base}?camera=lighting-idle`);run('set','viewport','1920','1080');
 for(const [name,preset] of [['idle-default','lighting-idle'],['floor-wide','floor-wide'],['lamp-side','lamp-side'],['shafts-closeup','shafts-closeup'],['tip-closeup','tip-closeup'],['shafts-side','shafts-side'],['rock-underwater','rock-underwater']]) {
  if(process.env.CAPTURES&&!process.env.CAPTURES.split(',').includes(name))continue;
  run('open',`${base}?camera=${preset}`);
  evaluate('new Promise(resolve=>{const tick=()=>window.aquarium?.elapsed>2?resolve(true):requestAnimationFrame(tick);tick();})');
  const performance=await evaluate('new Promise(async resolve=>{const samples=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);samples.push(window.aquarium.fps);}samples.sort((a,b)=>a-b);resolve({medianFPS:samples[45]});})');
  run('screenshot',`verify/lighting/${name}.png`);
  report.push({name,...performance,...evaluate('({lampPosition:aquarium.lampPosition,lampTarget:aquarium.lampTarget,elevation:aquarium.lampElevation,camera:aquarium.camera,fps:aquarium.fps})')});
 }
 await writeFile('verify/lighting/captures.json',JSON.stringify(report,null,2));
} finally {run('close');}
