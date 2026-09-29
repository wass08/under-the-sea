import {build} from 'rolldown';
import {writeFile} from 'node:fs/promises';
await build({input:'verify/run-o/before/src/lib/terrain.ts',external:['three/webgpu'],output:{file:'verify/run-o/before-terrain.mjs',format:'esm'}});
const {generateIslandTerrain,generateTerrain}=await import('./before-terrain.mjs');
const data=generateIslandTerrain(42);
await writeFile('verify/run-o/baseline-42.json',JSON.stringify(Object.fromEntries(Object.entries(data.geometry.attributes).map(([k,a])=>[k,{array:Array.from(a.array),itemSize:a.itemSize}]))));
const stats=d=>({vertices:d.heights.length,min:Math.min(...d.heights),max:Math.max(...d.heights),mean:d.heights.reduce((a,b)=>a+b)/d.heights.length,rms:Math.sqrt(d.heights.reduce((a,b)=>a+b*b)/d.heights.length)});
const rows=[];for(const [warp,erosion] of [[0,0],[.16,0],[.16,8]]){const d=generateTerrain({level:3,size:5.6,count:1200,seed:42,amplitude:3.1,mask:(x,z)=>Math.max(0,1-(Math.abs(x/2.8)**4+Math.abs(z/2.8)**4))**.8,warp,erosion,island:true});rows.push({warp,erosion,...stats(d)});d.geometry.dispose();}
console.table(rows);await writeFile('verify/run-o/before-height-stats.json',JSON.stringify(rows,null,2));
