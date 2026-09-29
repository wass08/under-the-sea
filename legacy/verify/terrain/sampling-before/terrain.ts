import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three/webgpu';
import { random } from './random';
import { createNoise2D, fbm, terrainHeight } from './noise';
import { poissonDisk } from './poisson';
import { delaunayFrom, type Point2 } from './triangulate';
export type TerrainOptions = { level: 1 | 2 | 3; size: number; count: number; seed: number; amplitude: number; mask?: (x: number, y: number) => number; warp?: number; erosion?: number; island?: boolean; carve?: number };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
/** Flat-shaded Delaunay terrain; biome weights use the face-neighbour graph, not isolated normals. */
export function generateTerrain({ level, size, count, seed, amplitude, mask, warp = 0, erosion = 0, island = false, carve = 0 }: TerrainOptions) {
  const rng = random(seed), noise = createNoise2D(seed), half = size / 2;
  // A composed prior remains a scalar height field: it changes neither the
  // Poisson/Delaunay technique nor flat face normals. Seeds vary its proportions.
  const design = random(seed + 8101);
  const peakX=-1.12+design()*.24, peakZ=-.95+design()*.22;
  const ridgeX=.92+design()*.30, ridgeZ=-.95+design()*.25;
  const peakWidth=1.18+design()*.12, ridgeWidth=.77+design()*.13, ridgeHeight=2.25+design()*.18;
  const field = (x: number, y: number, domainWarp = warp) => {
    const wx = x + domainWarp * size * noise(x/size*1.3+31,y/size*1.3-17), wy = y + domainWarp * size * noise(x/size*1.3-12,y/size*1.3+9);
    const detail = terrainHeight(wx, wy, { noise, amplitude, frequency: 1.5 / size });
    if (!island) return detail;
    // Unequal summits along x; a narrow rear flank and a long, low +z sand fan.
    const peak=3.05*Math.exp(-(Math.abs((x-peakX)/peakWidth)**1.65+Math.abs((y-peakZ)/(y<peakZ?.94:1.95))**1.7));
    const ridge=ridgeHeight*Math.exp(-(Math.abs((x-ridgeX)/ridgeWidth)**2.2+Math.abs((y-ridgeZ+(x-ridgeX)*.12)/(y<ridgeZ?.85:1.35))**1.8));
    const skirt=.52*(1-smooth(.35,1.38,Math.hypot((x+.10)/2.6,(y-.50)/2.4)));
    const saddle=1.72*Math.exp(-(Math.abs((x-.03)/1.18)**4+Math.abs((y+.83)/1.16)**2));
    const prior=Math.max(peak,ridge,saddle,skirt);
    return Math.max(0,prior+(detail/amplitude-.38)*.27+noise(wx*1.45+4,wy*1.45-6)*.055);
  };
  const e = size / 350;
  const slopeAt = (x: number, y: number) => Math.hypot(field(x + e, y) - field(x - e, y), field(x, y + e) - field(x, y - e)) / (2 * e);
  let points: Point2[];
  if (level === 3) {
    const base = size / Math.sqrt(count) * 1.05;
    const radius = (x: number, y: number) => base / Math.sqrt(0.65 + Math.min(2, slopeAt(x, y)) * 1.8);
    points = poissonDisk({ bounds: [-half, -half, half, half], radius, minRadius: base / Math.sqrt(4.25), maxRadius: base / Math.sqrt(0.65), seed });
  } else points = Array.from({ length: count }, () => [(rng() - 0.5) * size, (rng() - 0.5) * size]);
  const edges = Math.max(8, Math.ceil(Math.sqrt(count)));
  for (let i = 0; i < edges; i++) { const t = -half + size * i / edges; points.push([t, -half], [half, t], [-t, half], [-half, -t]); }
  const heights = Float32Array.from(points, ([x, y]) => {
    let h = level === 1 ? rng() * amplitude : level === 2 ? (fbm(x * 2 / size, y * 2 / size, { noise, octaves: 5 }) * 0.5 + 0.5) * amplitude : field(x, y);
    return h * (mask?.(x, y) ?? 1);
  });
  const delaunay = delaunayFrom(points);
  const beforeThermal = Float32Array.from(heights);
  const unwarped = Float32Array.from(points, ([x,y]) => field(x,y,0)*(mask?.(x,y)??1));
  // Thermal erosion: conservative transfers to each vertex's lowest Delaunay neighbour.
  // Boundary samples stay pinned; a 0.8 talus slope keeps cliffs while accumulating fans.
  const neighbours = points.map((_, i) => [...delaunay.neighbors(i)]);
  for (let step=0; step<erosion; step++) {
    const delta = new Float32Array(heights.length);
    for (let i=0;i<heights.length;i++) {
      if (Math.abs(points[i][0])>=half-1e-6 || Math.abs(points[i][1])>=half-1e-6) continue;
      let best=-1, excess=0;
      for (const j of neighbours[i]) {
        if (Math.abs(points[j][0])>=half-1e-6 || Math.abs(points[j][1])>=half-1e-6) continue;
        const d = Math.hypot(points[i][0]-points[j][0],points[i][1]-points[j][1]);
        const amount = heights[i]-heights[j]-.8*d;
        if (amount>excess) { best=j; excess=amount; }
      }
      if (best>=0) { const move=excess*.12; delta[i]-=move; delta[best]+=move; }
    }
    heights.forEach((_,i)=>heights[i]+=delta[i]);
  }
  const afterThermal = Float32Array.from(heights), carved = new Float32Array(heights.length);
  const waterRng = random(seed + 42091), paths: number[][] = [];
  // Hydraulic-style graph incision (not a fluid solver): seeded droplets follow
  // steepest downhill edges. Repeated drainage paths deepen into connected gullies.
  const sources = heights.map((h,i)=>h>amplitude*.42?i:-1).filter(i=>i>=0);
  for(let drop=0;drop<carve && sources.length;drop++) {
    let i=sources[Math.floor(waterRng()*sources.length)], sediment=0;
    const path:number[]=[];
    for(let step=0;step<55;step++) {
      path.push(i); let next=-1, steepest=0;
      for(const j of neighbours[i]) {
        const distance=Math.hypot(points[i][0]-points[j][0],points[i][1]-points[j][1]);
        const slope=(heights[i]-heights[j])/Math.max(.01,distance);
        if(slope>steepest){steepest=slope;next=j;}
      }
      if(next<0 || heights[i]<.25) break;
      const cut=Math.min(.018,steepest*.013,Math.max(0,.24-carved[i]));
      heights[i]-=cut;carved[i]+=cut;sediment+=cut;
      // A little bank widening prevents a single-vertex zigzag trench.
      for(const j of neighbours[i]) if(heights[j]>heights[i] && carved[j]<.12) {
        const bank=Math.min(cut*.16,.12-carved[j]);heights[j]-=bank;carved[j]+=bank;sediment+=bank;
      }
      i=next;
    }
    if(path.length>=4)paths.push(path);
    if(Math.abs(points[i][0])<half-1e-6 && Math.abs(points[i][1])<half-1e-6)heights[i]+=sediment*.12;
  }
  if(carve>0) {
    // Widen drainage channels over one ring; avoid needle pits and deposition spikes.
    heights.forEach((_,i)=>{
      const incision=carved[i]*.70+neighbours[i].reduce((sum,j)=>sum+carved[j],0)/Math.max(1,neighbours[i].length)*.30;
      heights[i]=Math.max(0,afterThermal[i]-incision);
    });
  }
  const visited=new Set<number>();let gullyCount=0;
  for(let i=0;i<carved.length;i++)if(carved[i]>.055 && !visited.has(i)){
    const component:number[]=[],pending=[i];visited.add(i);
    while(pending.length){const j=pending.pop()!;component.push(j);for(const k of neighbours[j])if(carved[k]>.055&&!visited.has(k)){visited.add(k);pending.push(k);}}
    const span=Math.max(...component.map(j=>afterThermal[j]))-Math.min(...component.map(j=>afterThermal[j]));
    if(component.length>=8 && span>.25)gullyCount++;
  }
  const stats=(values:Float32Array)=>({min:Math.min(...values),max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,rms:Math.sqrt(values.reduce((a,b)=>a+b*b,0)/values.length)});
  const difference=(a:Float32Array,b:Float32Array)=>({meanAbsolute:a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length,maxAbsolute:Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),changed:a.filter((v,i)=>Math.abs(v-b[i])>1e-6).length});
  const diagnostics={unwarped:stats(unwarped),warped:stats(beforeThermal),thermal:stats(afterThermal),carved:stats(heights),warpChange:difference(beforeThermal,unwarped),thermalChange:difference(afterThermal,beforeThermal),carveChange:difference(heights,afterThermal),dropletPaths:paths.length,gullyCount,gullyVertices:carved.filter(v=>v>.055).length,maximumIncision:Math.max(...carved)};
  if (island) {
    const high=Math.max(...heights);
    // Mesh origin is floor+.02; the sand top is floor+.12.
    heights.forEach((h,i)=>heights[i]=Math.max(.10,h/high*2.60));
    points.forEach(p=>{p[0]-=.45;p[1]=p[1]*3.5/5.6-.05;});
    // Keep the triangulation built in the square sampling domain when shaping
    // its footprint; anisotropic compression does not retriangulate the graph.
    points.forEach((p,i)=>{(delaunay.points as Float64Array)[i*2]=p[0];(delaunay.points as Float64Array)[i*2+1]=p[1];});
  }
  const faces: {ids:number[]; height:number; slope:number; x:number; z:number; adjacent:number[]; weights:number[]; biome:number}[]=[];
  const a=new Vector3(), b=new Vector3(), c=new Vector3();
  for (let i=0;i<delaunay.triangles.length;i+=3) {
    const ids=Array.from(delaunay.triangles.slice(i,i+3));
    a.set(points[ids[1]][0]-points[ids[0]][0],heights[ids[1]]-heights[ids[0]],points[ids[1]][1]-points[ids[0]][1]);
    b.set(points[ids[2]][0]-points[ids[0]][0],heights[ids[2]]-heights[ids[0]],points[ids[2]][1]-points[ids[0]][1]); c.crossVectors(a,b).normalize();
    if(c.y<0) ids.reverse();
    faces.push({ids,height:ids.reduce((s,j)=>s+heights[j],0)/3,slope:1-Math.abs(c.y),x:ids.reduce((s,j)=>s+points[j][0],0)/3,z:ids.reduce((s,j)=>s+points[j][1],0)/3,adjacent:[0,1,2].map(j=>delaunay.halfedges[i+j]).filter(j=>j>=0).map(j=>Math.floor(j/3)),weights:[],biome:0});
  }
  const cliffs=new Set<number>();
  if(island)faces.forEach((f,i)=>{if(f.slope>.48){cliffs.add(i);const bank=[...f.adjacent].sort((a,b)=>faces[b].slope-faces[a].slope)[0];if(bank!==undefined)cliffs.add(bank);}});
  for (const [faceIndex,f] of faces.entries()) {
    const nearby=[f,...f.adjacent.map(i=>faces[i])];
    const h=nearby.reduce((s,v)=>s+v.height,0)/nearby.length/(island?2.60:amplitude);
    const slope=nearby.reduce((s,v)=>s+v.slope,0)/nearby.length;
    const boundary=noise(f.x/size*2.1+13,f.z/size*2.1-8)*.025;
    const snow=island?0:smooth(.75,.84,h+boundary);
    // Island sea level is local 2.07: sand below, a narrow beach, rock at the tip.
    const shore=island?Math.max(1-smooth(.16,.30,h),smooth(.73,.78,h)*(1-smooth(.80,.83,h))*(1-smooth(.06,.18,slope))):1-smooth(.14,.22,h+boundary);
    const rock=island?Math.max(smooth(.22,.43,slope+boundary),.65*smooth(.85,.96,h+boundary)):Math.max(smooth(.24,.42,slope+boundary),smooth(.66,.83,h));
    f.weights=[shore*(1-snow),(1-shore)*(1-rock)*(1-snow),(1-shore)*rock*(1-snow),snow];
    if(cliffs.has(faceIndex))f.weights=[0,0,1,0]; // >58.7° is exposed rock at every altitude.
    f.biome=f.weights.indexOf(Math.max(...f.weights));
  }
  // Hysteresis: isolated holes inherit a unanimous surrounding region. Then blend
  // weights across shared edges, retaining flat geometric normals and reveal labels.
  for(let pass=0;pass<4;pass++) {
    const labels=faces.map(f=>f.biome);
    faces.forEach((f,i)=>{if(!cliffs.has(i) && f.adjacent.length===3 && f.adjacent.every(j=>labels[j]!==f.biome)) {
      f.biome=[0,1,2,3].sort((a,b)=>f.adjacent.filter(j=>labels[j]===b).length-f.adjacent.filter(j=>labels[j]===a).length)[0]; f.weights=f.weights.map((v,i)=>v*.15+(i===f.biome?.85:0));
    }});
  }
  const positions:number[]=[], biomes:number[]=[], slopes:number[]=[], weights:number[]=[];
  for(const [faceIndex,f] of faces.entries()) {
    if(island && f.ids.every(id=>heights[id]===Math.fround(.10))) continue; // The sand bed owns coplanar faces.
    const blend=cliffs.has(faceIndex)?[0,0,1,0]:f.weights.map((w,k)=>w*.8+f.adjacent.reduce((s,j)=>s+faces[j].weights[k],0)/Math.max(1,f.adjacent.length)*.2);
    for(const id of f.ids) { positions.push(points[id][0],heights[id],points[id][1]);biomes.push(f.biome);slopes.push(f.slope);weights.push(...blend); }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  const biome=new Float32Array(biomes);
  geometry.setAttribute('biome',new Float32BufferAttribute(biome,1));geometry.setAttribute('biomeWeights',new Float32BufferAttribute(weights,4));geometry.setAttribute('slope',new Float32BufferAttribute(slopes,1));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return {geometry,seeds:new Float32Array(points.flat()),heights,delaunay,biome,faces,diagnostics};
}
export function generateIslandTerrain(seed:number, options: {warp?:number;erosion?:number;carve?:number} = {}) {
  const mask=(x:number,z:number)=>1-smooth(.88,1.10,Math.hypot(x/2.8,(z+.05)/2.8));
  return generateTerrain({level:3,size:5.6,count:1200,seed,amplitude:3.1,mask,warp:.16,erosion:8,carve:420,island:true,...options});
}
