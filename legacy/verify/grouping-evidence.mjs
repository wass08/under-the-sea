import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const read=async p=>JSON.parse(await readFile(p,'utf8')),lines=[],runs=[];
const rootCause='ROOT CAUSE: Compounds were not increased by the performance pass: four-wall grouping is identical. Run D area thresholds (0.01 core / 0.1 rest) welded cells before flight; the previous fix ungrouped only the pristine core.';
lines.push(rootCause,'Released shard bodies; histogram bins count bodies. Areas are original cell area in scene units squared.','stage case bodies cells 1 2 3-5 6+ singlesArea compoundArea');
for(const [stage,dir] of [['pre-perf','before'],['previous','current'],['fixed','after']])for(const scenario of ['single','four']) {
 const d=await read(`verify/grouping-${dir}/launch-${scenario}.json`),g=d.grouping;runs.push({stage,scenario,d});
 assert.equal(g.histogram.reduce((a,b)=>a+b),g.bodies);assert.ok(Math.abs(g.singleArea+g.compoundArea-(scenario==='single'?21.584:68.16))<1e-8);
 lines.push(`${stage} ${scenario} ${g.bodies} ${g.cells} ${g.histogram.join(' ')} ${g.singleArea.toFixed(4)} ${g.compoundArea.toFixed(4)}`);
 if(stage==='fixed') {assert.deepEqual(g.histogram,[g.cells,0,0,0]);assert.equal(g.bodies,g.cells);assert.equal(g.compoundArea,0);assert.ok(d.fpsAirborne>=45,'Airborne FPS >=45');assert.ok(d.fpsSettled>=55,'Settled FPS >=55');const at5=d.frames.find(f=>f.age>=5);assert.equal(at5.asleep,at5.count,'All individual bodies sleep natively by5s');}
}
assert.deepEqual(runs.find(r=>r.stage==='pre-perf'&&r.scenario==='four').d.grouping.releases,runs.find(r=>r.stage==='previous'&&r.scenario==='four').d.grouping.releases);
lines.push('stage case FPSmedianAirborne FPSmedianSettled');for(const {stage,scenario,d} of runs)lines.push(`${stage} ${scenario} ${d.fpsAirborne.toFixed(2)} ${d.fpsSettled.toFixed(2)}`);
lines.push('PARAMETERS: minimum group area -> 0 everywhere; per-release budget -> cell count; total body ceiling 400 -> 880; native sleeping preserves separate identities.');
lines.push('SETTLING: individual-cell supported linear/angular damping 3/1 -> 6/5; airborne 0.45/1.2, impulses, quiet 8/20 and solver schedule unchanged.');
for(const [file,patterns] of [['edges',[/^PASS four-wall full break/,/^PASS expanded launch budget/,/^PASS reset after/]],['lab',[/^PASS shatter L3/]],['library',[/^PASS Run D regressions:/,/^PASS Run N:/,/^PASS individual aquarium cells:/]],['runtime',[/^PASS/]]]) {
 const text=await readFile(`verify/grouping-${file}.txt`,'utf8');for(const pattern of patterns){const found=text.split('\n').filter(l=>pattern.test(l));assert.ok(found.length,`Missing ${file} ${pattern}`);lines.push(...found);}
}
const shot=await read('verify/perf-after/shards-floor.json');lines.push(`FLOOR: verify/perf-after/shards-floor.png at ${shot.floor.age.toFixed(4)} s; all ${shot.grouping.bodies} bodies contain one cell, no fused outlines.`);
const result=lines.join('\n')+'\n';await writeFile('verify/grouping-evidence.txt',result);console.log(result);
