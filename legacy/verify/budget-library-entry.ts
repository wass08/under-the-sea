import assert from 'node:assert/strict';
import {generateShatterPattern,generateAquariumPattern,AQUARIUM_WALL_FRACTIONS,IMPACT_CORE_RADIUS,type ShatterOptions} from '../src/lib/shatter';
import {polygonCentroid} from '../src/lib/triangulate';
for(const wall of [0,1,2,3])for(const fraction of AQUARIUM_WALL_FRACTIONS)for(const impact of [[0,-.17],[.6,.23],[0,1.25],[0,1.42],[wall<2?3.8:2.2,1.42]] as [number,number][]){
 const options:ShatterOptions={level:3,width:wall<2?7.6:4.4,height:2.84,impact,count:220,seed:93+wall},full=generateShatterPattern(options),same=generateAquariumPattern(options,1);
 assert.deepEqual(same.cells,full.cells);assert.deepEqual(same.seeds,full.seeds,'100% preserves original vertex/seed order');
 const next=generateAquariumPattern(options,fraction);
 const core=full.cells.filter(c=>{const p=polygonCentroid(c.polygon);return Math.hypot(p[0]-impact[0],p[1]-impact[1])<IMPACT_CORE_RADIUS;});
 const key=(p:number[])=>p.join(',');assert.ok(core.every(c=>next.seeds.some(p=>key(p)===key(c.seed))),'Every original strike-core seed survives');
 assert.equal(next.cells.length,Math.round(220*fraction),'Exact gentle budget takes priority over optional outer anchors');assert.equal(next.fraction,fraction);
 if(fraction<1)assert.equal(next.cells.filter(c=>c.impactCore).length,core.length);
 const ringCount=[1,2,3,4].filter(r=>full.cells.some(c=>c.ring===r)).length,anchors=Math.min(4,Math.floor((next.cells.length-core.length-2)/Math.max(1,ringCount)));
 for(let ring=1;ring<=4;ring++)assert.ok(next.cells.filter(c=>c.ring===ring).length>=Math.min(anchors,full.cells.filter(c=>c.ring===ring).length),'Evenly spaced ring anchors survive within the exact budget');
 const area=next.cells.reduce((n,c)=>n+Math.abs(c.polygon.reduce((a,p,i)=>{const q=c.polygon[(i+1)%c.polygon.length];return a+p[0]*q[1]-p[1]*q[0];},0))/2,0);assert.ok(Math.abs(area-options.width*options.height)<1e-7,'Entire wall still covered by convex Voronoi cells');
 assert.deepEqual(generateAquariumPattern(options,fraction),next,'Budgeted patterns are deterministic');
}
const sequence=[0,2,1,3].map((wall,i)=>generateAquariumPattern({level:3,width:wall<2?7.6:4.4,height:2.84,impact:[0,-.17],count:220,seed:93+wall},AQUARIUM_WALL_FRACTIONS[i]).cells.length);
assert.deepEqual(sequence,[220,176,143,110]);assert.equal(sequence.reduce((n,c)=>n+c,0),649);
console.log('PASS aquarium wall budgets: 220/176/143/110 = 649 independent cells; protected strike seeds, ring anchors, full coverage and deterministic patterns.');
console.log('PASS aquarium first-wall pattern: all seeds, polygons and vertex order bit-identical at 100%.');
