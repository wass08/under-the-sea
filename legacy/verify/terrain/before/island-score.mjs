/** All terms use production geometry, topology and labels; no screenshot ranking. */
export function scoreIsland(d,seed) {
 const areas=[0,0,0,0];let total=0,beach=0,speckle=0,clipping=0;
 for(const f of d.faces){const [a,b,c]=f.ids.map(i=>[d.seeds[i*2],d.seeds[i*2+1]]);const area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;
  if(f.height>.20){areas[f.biome]+=area;total+=area;if(f.height>1.88&&f.height<2.23&&f.slope<.18&&f.biome===0)beach+=area;}
  if(f.adjacent.length===3&&f.adjacent.every(j=>d.faces[j].biome!==f.biome))speckle++;
  if(f.height>.20&&(Math.abs(f.x)>3.7||Math.abs(f.z)>2.1))clipping+=area;
 }
 const peaks=[];for(let i=0;i<d.heights.length;i++)if([...d.delaunay.neighbors(i)].every(j=>d.heights[j]<=d.heights[i]))peaks.push({i,h:d.heights[i],x:d.seeds[i*2],z:d.seeds[i*2+1]});
 peaks.sort((a,b)=>b.h-a.h);const main=peaks[0],second=peaks.find(p=>p.x>main.x+.85&&Math.hypot(p.x-main.x,p.z-main.z)>.95)||{h:0,x:0,z:0};
 // Maximum bottleneck path gives the real graph saddle between the two peaks.
 let saddle=0;if(second.i!==undefined){const capacities=new Float32Array(d.heights.length).fill(-1),visited=new Uint8Array(d.heights.length);capacities[main.i]=main.h;
  for(let n=0;n<d.heights.length;n++){let i=-1,best=-1;for(let j=0;j<capacities.length;j++)if(!visited[j]&&capacities[j]>best){i=j;best=capacities[j];}if(i<0)break;if(i===second.i){saddle=best;break;}visited[i]=1;for(const j of d.delaunay.neighbors(i))capacities[j]=Math.max(capacities[j],Math.min(best,d.heights[j]));}
 }
 const ridgeLine=Array.from({length:28},()=>0);for(let i=0;i<d.heights.length;i++){const bin=Math.min(27,Math.floor((d.seeds[i*2]+2.8)/5.6*28));ridgeLine[bin]=Math.max(ridgeLine[bin],d.heights[i]);}
 const ridgeMean=ridgeLine.reduce((a,b)=>a+b)/ridgeLine.length, silhouetteVariance=ridgeLine.reduce((a,b)=>a+(b-ridgeMean)**2,0)/ridgeLine.length;
 const balance=areas.map(a=>a/total),beachFraction=beach/total,gullies=d.diagnostics?.gullyCount??0;
 const bell=(x,target,width)=>Math.exp(-(((x-target)/width)**2));
 const terms={dominant:15*bell(main.h+.18-2.25,.6,.18),ridge:18*bell(second.h/main.h,.79,.15),saddle:14*bell((second.h-saddle)/main.h,.13,.10),beach:17*bell(beachFraction,.10,.065),biomes:14*Math.min(1,Math.min(...balance)/.018),silhouette:12*Math.min(1,silhouetteVariance/.7),gullies:10*Math.min(1,gullies/3),speckle:-speckle*2,clipping:-clipping*100};
 return {seed,score:+Object.values(terms).reduce((a,b)=>a+b).toFixed(3),peak:+(main.h+.18).toFixed(3),secondary:+(second.h+.18).toFixed(3),saddle:+(saddle+.18).toFixed(3),beachPct:+(beachFraction*100).toFixed(2),biomePct:balance.map(v=>+(v*100).toFixed(2)),speckle,clipping,gullies,silhouetteVariance:+silhouetteVariance.toFixed(4),terms};
}
