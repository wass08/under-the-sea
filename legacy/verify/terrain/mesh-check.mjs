import assert from 'node:assert/strict';
import {bundle} from '../temp-build.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const before=process.argv.includes('--before');
const {generateIslandTerrain}=await bundle('src/lib/terrain.ts',before?[{name:'before',transform:async(code,id)=>id.endsWith('/src/lib/terrain.ts')?await readFile('verify/terrain/before/mesh/terrain.ts','utf8'):null}]:[]),{chosen}=JSON.parse(await readFile('verify/terrain/seed-scores.json','utf8'));
const results=[];
for(const seed of new Set([166,...chosen.map(s=>s.seed)])){
 const d=generateIslandTerrain(seed),p=d.geometry.attributes.position,edges=new Map();let degenerate=0,downward=0,minArea=Infinity,interiorBoundary=0,nonmanifold=0,edgeOrientation=0,coplanar=0;
 for(let i=0;i<p.count;i+=3){const v=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]),a=v[1].map((x,k)=>x-v[0][k]),b=v[2].map((x,k)=>x-v[0][k]),cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],area=Math.hypot(...cross)/2;
  if(v.every(p=>Math.abs(p[1]-.10)<1e-7))coplanar++;
  minArea=Math.min(minArea,area);if(!Number.isFinite(area)||area<=1e-10)degenerate++;if(!(cross[1]>0))downward++;
  for(let j=0;j<3;j++){const a=v[j].join(','),b=v[(j+1)%3].join(','),key=[a,b].sort().join('|'),edge=edges.get(key)||{count:0,balance:0,points:[v[j],v[(j+1)%3]]};edge.count++;edge.balance+=a<b?1:-1;edges.set(key,edge);}
 }
 for(const e of edges.values()){if(e.count>2)nonmanifold++;if(e.count===2&&e.balance!==0)edgeOrientation++;if(e.count===1&&!e.points.every(p=>Math.abs(p[1]-.10)<1e-7)&&!([0,2].some(k=>Math.abs(e.points[0][k]-e.points[1][k])<1e-6&&((k===0?[-3.25,2.35]:[-1.8,1.7]).some(bound=>Math.abs(e.points[0][k]-bound)<1e-6)))))interiorBoundary++;}
 const belowSand=Array.from(d.heights).filter(h=>h<.10-1e-7).length;
 results.push({seed,vertices:d.heights.length,triangles:p.count/3,degenerate,downward,belowSand,coplanar,interiorBoundary,nonmanifold,edgeOrientation,minArea});d.geometry.dispose();
}
await writeFile(`verify/terrain/mesh-${before?'before':'after'}.json`,JSON.stringify(results,null,2));console.table(results);
const {breachDrawdowns}=await bundle('src/state.ts');assert.ok(breachDrawdowns.every(u=>u.value.w===0),'Inactive breaches must not displace the water vertex at the origin');
if(!before)for(const r of results)for(const k of ['degenerate','downward','belowSand','coplanar','interiorBoundary','nonmanifold','edgeOrientation'])assert.equal(r[k],0,`seed ${r.seed}: ${k}`);
if(!before)console.log(`Mesh summary: PASS ${results.length} sheet seeds, 0 bad faces, 0 coplanar bed faces, 0 unexpected boundary edges`);
