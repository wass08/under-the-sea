import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const read=async f=>JSON.parse(await readFile(f,'utf8')),runs={};
for(const r of ['reference','before','after','reference600','before600','after600']){runs[r]={};for(const c of ['L2','L3',...(r.endsWith('600')?[]:['main'])])runs[r][c]=await read(`verify/burst-${r}/${c}.json`);}
const lines=['ROOT CAUSE: Dense Lab launch fidelity was gated by aquarium collision grace: 48/12 became 4/1 immediately. Default 220-cell Lab trajectories already matched the reference.',
'R=pre-perf reference; B=before fix; A=after fix. Equality labels mean exact measured equality.',
'Time is solver seconds; velocity scene units/s; angular velocity rad/s; outward is a fraction.',
'stage case t radialMean radialP90 outward speedP50 speedP90 angularP50 angularP90'];
const fmt=n=>n.toFixed(3),row=(stage,c,d)=>{for(const a of d.summary.at)lines.push(`${stage} ${c} ${a.t.toFixed(2)} ${[a.radialMean,a.radial90,a.outward,a.speed50,a.speed90,a.angular50,a.angular90].map(fmt).join(' ')}`);};
for(const c of ['L2','L3']){assert.deepEqual(runs.reference[c].summary.at,runs.before[c].summary.at);assert.deepEqual(runs.reference[c].summary.at,runs.after[c].summary.at);row('R=B=A',c,runs.after[c]);}
row('R','main',runs.reference.main);assert.deepEqual(runs.before.main.summary.at,runs.after.main.summary.at);row('B=A','main',runs.after.main);
lines.push('Speed retention at 0.25/0.10s: p50 ratio / mean-speed ratio (R, B, A)');
for(const c of ['L2','L3','main'])lines.push(`${c}: ${['reference','before','after'].map(r=>`${fmt(runs[r][c].summary.speedRatio)}/${fmt(runs[r][c].summary.meanSpeedRatio)}`).join(' | ')}`);
lines.push('First 0.5 solver seconds: 30 steps in every case; solver 12/4; no sleeping or pose-cached bodies.');
for(const c of ['L2','L3','main'])lines.push(`Steps completed in first 0.5 wall seconds ${c} R/B/A: ${['reference','before','after'].map(r=>runs[r][c].frames.filter(f=>f.wallTime<=.5).reduce((n,f)=>n+f.steps,0)).join('/')}`);
lines.push('Damping body-steps airborne/supported/quiet: L2 R=B=A 972/258/0; L3 R=B=A 1905/338/7; main R 2098/242/0, B=A 5805/775/20.',
'Damping linear/angular: airborne 0.45/1.2; supported Lab 3/1, individual main 6/5; quiet 8/20. First-step support count: zero.',
'Dense Lab 600-cell check: radial mean at 0.10/0.25/0.50s; effective solver/PGS');
for(const c of ['L2','L3']){assert.deepEqual(runs.reference600[c].summary.at,runs.after600[c].summary.at);for(const [label,r]of [['R=A','after600'],['B','before600']])lines.push(`${c}/600 ${label}: ${runs[r][c].summary.at.map(a=>fmt(a.radialMean)).join('/')} solver ${runs[r][c].summary.solver}/${runs[r][c].summary.pgs}`);}
for(const c of ['single','four']){const d=await read(`verify/burst-fps-after/launch-${c}.json`);assert.ok(d.fpsAirborne>=45);assert.ok(d.fpsSettled>=55);lines.push(`FPS ${c}: airborne median ${d.fpsAirborne.toFixed(2)}, settled median ${d.fpsSettled.toFixed(2)}`);}
for(const [file,patterns]of [['reference',[/^PASS/]],['edges',[/^PASS four-wall full break/,/^PASS expanded launch budget/]],['lab',[/^PASS shatter L[123]:/]],['library',[/^PASS Run [DKN]:/,/^PASS Run D regressions:/,/^PASS Lab launch fidelity:/]],['runtime',[/^PASS:/]]]){const t=await readFile(`verify/burst-${file}.txt`,'utf8');for(const p of patterns){const matches=t.split('\n').filter(l=>p.test(l));assert.ok(matches.length);lines.push(...matches);}}
for(const n of ['015','040']){const a=await read(`verify/perf-before/lab-L3-burst-${n}.json`),b=await read(`verify/perf-after/lab-L3-burst-${n}.json`);assert.equal(a.elapsed,b.elapsed);assert.deepEqual(a.shardTransforms,b.shardTransforms);lines.push(`FRAME L3 ${a.elapsed.toFixed(2)}s: perf-before/lab-L3-burst-${n}.png and perf-after/lab-L3-burst-${n}.png; exact displayed transforms match.`);}
lines.push('UNMET: main-page +/-10% radial target; reference has 78 compounds, current has 220 independent cells and much higher outward speeds. Main speed/contact trials were reverted.');
assert.ok(lines.length<70);await writeFile('verify/burst-evidence.txt',lines.join('\n')+'\n');console.log(lines.join('\n'));
