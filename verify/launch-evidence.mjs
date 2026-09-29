import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8')),f=(n,d=2)=>n.toFixed(d),lines=[],runs=[];
lines.push('Wall-time samples: speed in units/s, spin in rad/s; radial = mean absolute projection fraction.');
lines.push('walls profile target actualWall physicsTime speed50/90 radial spin50/90 linked asleep/total');
for(const [profile,dir] of [['legacy','before'],['economy','current'],['new','after']])for(const scenario of ['single','four']) {
 const d=await read(`verify/perf-${dir}/launch-${scenario}.json`);runs.push({profile,scenario,d});
 for(const s of d.wallAt)lines.push(`${scenario==='single'?1:4} ${profile} ${f(s.target,1)} ${f(s.wallAge,3)} ${f(s.physicsAge,3)} ${f(s.speed50)}/${f(s.speed90)} ${f(s.radial,3)} ${f(s.angular50)}/${f(s.angular90)} ${s.linked} ${s.asleep}/${s.count}`);
}
lines.push('walls profile impulseFrames stepsInFirst0.5sWall FPSmedianAir/Settled');
for(const {profile,scenario,d} of runs)lines.push(`${scenario==='single'?1:4} ${profile} ${d.impulseFrames.length} ${d.stepsFirstHalfSecond} ${f(d.fpsAirborne)}/${f(d.fpsSettled)}`);
lines.push('Four-wall CPU ms/frame: physics(Rapier) sync batch spill rewind render(shadow) GC; steps mean/max; draws(shadow).');
for(const [profile,path] of [['legacy','verify/perf-legacy/measurements.json'],['new','verify/perf-after/measurements.json']]) {
 const d=await read(path);lines.push(`${profile} four-wall-perf FPS median airborne/settled: ${f(d.airborne.fpsMedian)}/${f(d.settled.fpsMedian)}`);
 for(const phase of ['airborne','settled']){const p=d[phase],m=p.ms;lines.push(`${profile} ${phase}: ${f(m.physics)}(${f(m.rapier)}) ${f(m.sync)} ${f(m.batch)} ${f(m.spill)} ${f(m.rewind)} ${f(m.render)}(${f(m.shadow)}) ${f(p.gcMsPerFrame)}; ${f(p.stepsMean)}/${p.stepsMax}; ${p.drawCalls}(${p.shadowCalls}).`);}
}
const newFour=runs.find(r=>r.profile==='new'&&r.scenario==='four').d,air=newFour.frames.filter(f=>f.wallAge>=.1&&f.wallAge<1.5),ordered=air.map(f=>f.frameMs).sort((a,b)=>a-b);
lines.push(`New four-wall launch frame time: p95 ${f(ordered[Math.floor((ordered.length-1)*.95)])} ms, max ${f(ordered.at(-1))} ms.`);
for(const [file,patterns] of [['edges',[/^PASS four-wall full break/,/^PASS reset after/]],['lab',[/^PASS shatter L3/]],['library',[/^PASS Run N:/,/^PASS launch phase:/]],['runtime',[/^PASS/]]]) {
 const text=await readFile(`verify/launch-${file}.txt`,'utf8');for(const pattern of patterns){const found=text.split('\n').filter(l=>pattern.test(l));if(!found.length)throw new Error(`Missing ${file} ${pattern}`);lines.push(...found);}
}
const result=lines.join('\n')+'\n';console.log(result);await writeFile('verify/launch-evidence.txt',result);
