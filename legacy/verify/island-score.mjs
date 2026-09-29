/** Score production triangles; local zero is floor+.02, sand is floor+.12. */
export function scoreIsland(d,seed) {
 const water=2.25,offset=.18,floorArea=7.6*4.4,areas=[0,0,0,0];let footprint=0,speckle=0,clipping=0,dryArea=0;
 const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
 const above=(poly,h)=>{const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(a[2]>h)out.push(a);if((a[2]>h)!==(b[2]>h)){const t=(h-a[2])/(b[2]-a[2]);out.push(a.map((v,k)=>v+(b[k]-v)*t));}}return out;};
 for(const f of d.faces){const p=f.ids.map(i=>[d.seeds[i*2],d.seeds[i*2+1],d.heights[i]]),land=above(p,.15),a=area(land);footprint+=a;areas[f.biome]+=a;dryArea+=area(above(p,water-offset));
  if(land.some(p=>Math.abs(p[0])>3.4||Math.abs(p[1])>1.8))clipping+=a;
  if(f.adjacent.length===3&&f.adjacent.every(j=>d.faces[j].biome!==f.biome))speckle++;
 }
 const neighbours=Array.from(d.heights,(_,i)=>[...d.delaunay.neighbors(i)]),peaks=[];
 for(let i=0;i<d.heights.length;i++)if(neighbours[i].every(j=>d.heights[j]<=d.heights[i]))peaks.push({i,h:d.heights[i],x:d.seeds[i*2],z:d.seeds[i*2+1]});
 peaks.sort((a,b)=>b.h-a.h);const main=peaks[0],second=peaks.find(p=>p.x>main.x+.85&&Math.hypot(p.x-main.x,p.z-main.z)>.95)||{h:0,x:0,z:0};
 // Widest path on the height graph: the highest pass joining the actual summits.
 let saddle=0;if(second.i!==undefined){const capacities=new Float32Array(d.heights.length).fill(-1),visited=new Uint8Array(d.heights.length);capacities[main.i]=main.h;
  for(let n=0;n<d.heights.length;n++){let i=-1,best=-1;for(let j=0;j<capacities.length;j++)if(!visited[j]&&capacities[j]>best){i=j;best=capacities[j];}if(i<0)break;if(i===second.i){saddle=best;break;}visited[i]=1;for(const j of neighbours[i])capacities[j]=Math.max(capacities[j],Math.min(best,d.heights[j]));}
 }
 const ratio=second.h/main.h,mainAboveWater=main.h+offset-water,secondaryAboveWater=second.h+offset-water,saddleDepth=water-offset-saddle,footprintFraction=footprint/floorArea,gullies=d.diagnostics.gullyCount;
 const bell=(x,target,width)=>Math.exp(-(((x-target)/width)**2));
 const terms={summit:15*bell(mainAboveWater,.525,.075),ratio:15*bell(ratio,.78,.07),secondary:15*bell(secondaryAboveWater,-.035,.09),saddle:20*bell(saddleDepth,.65,.15),separation:10*Math.min(1,Math.max(0,second.h-saddle)/.4),footprint:15*bell(footprintFraction,.425,.025),gullies:10*Math.min(1,gullies/3),snow:-areas[3]*100,clipping:-clipping*100,speckle:-speckle*.25};
 const eligible=ratio>=.7&&ratio<=.85&&mainAboveWater>=.45&&mainAboveWater<=.6&&secondaryAboveWater>=-.18&&secondaryAboveWater<=.06&&saddleDepth>=.5&&saddleDepth<=.8&&second.h-saddle>=.4&&footprintFraction>=.40&&footprintFraction<=.45&&gullies>0&&clipping===0&&areas[3]===0;
 return {seed,eligible,score:+Object.values(terms).reduce((a,b)=>a+b).toFixed(3),mainAboveWater,secondaryAboveWater,saddleDepth,footprintFraction,ratio,peak:main.h+offset,secondary:second.h+offset,saddle:saddle+offset,main,second,dryHeightFraction:mainAboveWater/main.h,dryAreaFraction:dryArea/footprint,biomePct:areas.map(v=>v/footprint*100),gullies,speckle,clipping,terms};
}
