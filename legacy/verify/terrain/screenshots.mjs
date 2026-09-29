import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const run=(...args)=>execFileSync('agent-browser',['--session','terrain','--webgpu',...args],{encoding:'utf8',timeout:60000}).trim();
const base=(process.env.VERIFY_URL||'http://localhost:4177/').replace(/\/$/,'');
run('set','viewport','1920','1080');
const results=[];
for(const [name,url,ready]of [['main-idle',base,'window.aquarium?.elapsed > 2'],['main-top',base+'/?camera=top','window.aquarium?.elapsed > 2'],['main-front-low',base+'/?camera=front','window.aquarium?.elapsed > 2'],['secondary-flank',base+'/?camera=rock-underwater','window.aquarium?.elapsed > 2'],['lab-terrain-L1',base+'/#/lab/terrain?level=1','window.lab?.ready && parseInt(document.querySelector(".lab-fps").textContent) >= 55'],['lab-terrain-L3',base+'/#/lab/terrain?level=3','window.lab?.ready && parseInt(document.querySelector(".lab-fps").textContent) >= 55']]){
 if(process.env.CAPTURES&&!process.env.CAPTURES.split(',').includes(name))continue;
 console.log(run('open',url));console.log(run('wait','--fn',ready));
 const sample=!name.startsWith('lab')?`(async()=>{const f=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);f.push(window.aquarium.fps);}f.sort((a,b)=>a-b);return {medianFPS:f[45],renderer:window.aquarium.renderer,drawCalls:window.aquarium.drawCalls,elapsed:window.aquarium.elapsed};})()`:`({renderer:window.lab.state.renderer,level:window.lab.state.level,seedCount:window.lab.state.seedCount,triangleCount:window.lab.state.triangleCount})`;
 // Default shot stays at initial framing; sample FPS only after its capture.
 console.log(run('screenshot',`verify/terrain/${name}.png`));
 results.push({name,url,diagnostics:JSON.parse(run('eval',sample)),errors:run('errors')});
}
await writeFile('verify/terrain/runtime.json',JSON.stringify(results,null,2));console.log(results);
