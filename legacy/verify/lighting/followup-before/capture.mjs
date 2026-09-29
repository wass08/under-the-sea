import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const session='aquarium-lighting',base=process.env.VERIFY_URL||'http://localhost:4174/';
const run=(...args)=>execFileSync('agent-browser',['--session',session,'--json',...args],{encoding:'utf8',maxBuffer:4e6});
const evaluate=js=>JSON.parse(run('eval',js)).data.result;
await mkdir('verify/lighting',{recursive:true});const report=[];
try {
 run('--webgpu','open',`${base}?camera=lighting-idle`);run('set','viewport','1920','1080');
 for(const [name,preset] of [['idle-default','lighting-idle'],['floor-wide','floor-wide'],['lamp-side','lamp-side'],['shafts-closeup','shafts-closeup'],['tip-closeup','tip-closeup']]) {
  run('open',`${base}?camera=${preset}`);
  evaluate('new Promise(resolve=>{const tick=()=>window.aquarium?.elapsed>2?resolve(true):requestAnimationFrame(tick);tick();})');
  run('screenshot',`verify/lighting/${name}.png`);
  report.push({name,...evaluate('({lampPosition:aquarium.lampPosition,lampTarget:aquarium.lampTarget,elevation:aquarium.lampElevation,camera:aquarium.camera,fps:aquarium.fps})')});
 }
 await writeFile('verify/lighting/captures.json',JSON.stringify(report,null,2));
} finally {run('close');}
