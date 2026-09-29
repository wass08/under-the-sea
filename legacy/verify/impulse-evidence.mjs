import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const read=async p=>JSON.parse(await readFile(p,'utf8')),runs={before:{},after:{}},lines=[];
for(const r of ['before','after'])for(const c of ['L2','L3','main'])runs[r][c]=await read(`verify/impulse-${r}/${c}.json`);
lines.push('DEFAULTS: impulse=1.60 (0.5–3), falloff=3.8 (0.5–6), forward=0.60 (0.15–0.9), spin=1.00 (0–2); applied next break.',
'LAB: faster core/slower outer fan, forward velocity and bounded small-fragment tumble; L1 and aquarium formulas unchanged.',
'case stage t(s) radialMean radialP90 outwardFraction');
const f=n=>n.toFixed(3);
for(const c of ['L2','L3'])for(const r of ['before','after'])for(const a of runs[r][c].summary.at)lines.push(`${c} ${r} ${a.t.toFixed(2)} ${f(a.radialMean)} ${f(a.radial90)} ${f(a.outward)}`);
assert.deepEqual(runs.before.main.summary.at,runs.after.main.summary.at);assert.deepEqual(runs.before.main.summary.radius,runs.after.main.summary.radius);
assert.deepEqual(runs.before.main.steps.map(s=>s.bodies),runs.after.main.steps.map(s=>s.bodies));
for(const a of runs.after.main.summary.at)lines.push(`aquarium before=after ${a.t.toFixed(2)} ${f(a.radialMean)} ${f(a.radial90)} ${f(a.outward)}`);
lines.push('Cloud radius = p90 body-centre distance from impact (scene units); retention = median speed(0.25s)/median speed(0.10s).',
'case stage radius@0.25 radius@0.50 radius@1.00 retention');
for(const c of ['L2','L3'])for(const r of ['before','after']){const d=runs[r][c].summary;lines.push(`${c} ${r} ${d.radius.map(a=>f(a.r90)).join(' ')} ${f(d.retention)}`);}
{const d=runs.after.main.summary;lines.push(`aquarium before=after ${d.radius.map(a=>f(a.r90)).join(' ')} ${f(d.retention)}`);}
for(const c of ['L2','L3']){const d=runs.after[c].summary;assert.ok(d.fpsAirborne>=55&&d.fpsSettled>=55);assert.equal(d.awake,0);assert.ok(d.radius[1].r90>runs.before[c].summary.radius[1].r90*1.25);lines.push(`FPS ${c}: airborne median ${d.fpsAirborne.toFixed(2)}, settled median ${d.fpsSettled.toFixed(2)}`);}
lines.push(`L3 core radius@0.5s (initial radius<0.35): ${f(runs.before.L3.summary.radius[1].core90)} -> ${f(runs.after.L3.summary.radius[1].core90)}.`);
for(const [file,patterns]of [['lab',[/^PASS shatter L[123]:/]],['library',[/^PASS Run D regressions:/,/^PASS Run K:/,/^PASS Run N:/,/^PASS aquarium profile:/,/^PASS Lab profile:/]],['controls',[/^PASS/]]]){const t=await readFile(`verify/impulse-${file}.txt`,'utf8');for(const p of patterns){const found=t.split('\n').filter(l=>p.test(l));assert.ok(found.length);lines.push(...found);}}
const camera=(await read('verify/perf-before/lab-L3-burst-015.json')).camera;
for(const n of ['010','025','050','100']){const s=await read(`verify/perf-after/lab-L3-impulse-${n}.json`);assert.equal(s.elapsed,Number(n)/100);assert.deepEqual(s.camera,camera);}
lines.push('FRAMES: verify/perf-after/lab-L3-impulse-010.png / -025.png / -050.png / -100.png; exact solver times, original burst camera.',
'LOOK: core opens first, the outer fan follows; wider airborne spread at 0.5s; many shards land by 1s and scatter across the floor/plinth by 2s. Fast core pieces can leave the framing.',
'TRAJECTORIES: existing Run D/K/N expectations unchanged; added Lab-profile determinism and frozen-source aquarium equality checks.');
assert.ok(lines.length<60);await writeFile('verify/impulse-evidence.txt',lines.join('\n')+'\n');console.log(lines.join('\n'));
