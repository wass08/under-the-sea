/** Deterministic 200-seed search of the production landform, scored before choosing. */
import { build } from 'vite';
import { mkdir,writeFile } from 'node:fs/promises';
await mkdir('verify/run-j',{recursive:true});
await build({configFile:false,logLevel:'error',build:{ssr:'src/lib/terrain.ts',outDir:'verify/run-j',emptyOutDir:false,rollupOptions:{output:{entryFileNames:'terrain.bundle.mjs'}}}});
const {generateIslandTerrain}=await import('./run-j/terrain.bundle.mjs');
const results=[];
for(let seed=1;seed<=200;seed++) {
 const d=generateIslandTerrain(seed),areas=[0,0,0,0];let total=0,shore=0,speckle=0,clipping=0;
 for(const f of d.faces) {
  const [a,b,c]=f.ids.map(i=>[d.seeds[i*2],d.heights[i],d.seeds[i*2+1]]);
  const area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/2;
  areas[f.biome]+=area;total+=area;
  if(f.height>2.10&&f.height<2.50)shore+=area;
  if(f.adjacent.length===3&&f.adjacent.every(j=>d.faces[j].biome!==f.biome))speckle++;
  if(f.height>.7&&(Math.abs(f.x)>2.85||Math.abs(f.z)>1.60))clipping+=area;
 }
 const peaks=[];
 for(let i=0;i<d.heights.length;i++)if([...d.delaunay.neighbors(i)].every(j=>d.heights[j]<=d.heights[i]))peaks.push({i,h:d.heights[i],x:d.seeds[i*2],z:d.seeds[i*2+1]});
 peaks.sort((a,b)=>b.h-a.h);const main=peaks[0],second=peaks.find(p=>Math.hypot(p.x-main.x,p.z-main.z)>.65)||{h:0};
 const balance=areas.map(a=>a/total), shoreFraction=shore/total;
 const ridge=Math.exp(-(((second.h/main.h-.79)/.16)**2));
 const dominant=peaks.filter(p=>p.h>main.h*.95).length;
 const score=35*ridge+25*Math.exp(-(((shoreFraction-.12)/.08)**2))+20*Math.min(1,Math.min(...balance)/.025)+20/(1+Math.max(0,dominant-1))-speckle*.8-clipping*50;
 results.push({seed,score:+score.toFixed(3),peak:+(main.h+.18).toFixed(3),secondary:+second.h.toFixed(3),shorePct:+(shoreFraction*100).toFixed(2),biomePct:balance.map(v=>+(v*100).toFixed(1)),speckle,clipping});
 d.geometry.dispose();
}
results.sort((a,b)=>b.score-a.score); console.table(results.slice(0,5).map(r=>({...r,biomePct:r.biomePct.join(" / ")})));
await writeFile('verify/run-j/seed-scores.json',JSON.stringify(results,null,2));
