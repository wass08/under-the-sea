import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three/webgpu';
import { random } from './random';
import { createNoise2D, fbm, terrainHeight } from './noise';
import { poissonDisk } from './poisson';
import { delaunayFrom, type Point2 } from './triangulate';
export type TerrainOptions = { level: 1 | 2 | 3; size: number; count: number; seed: number; amplitude: number; mask?: (x: number, y: number) => number; warp?: number; erosion?: number; island?: boolean };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
/** Flat-shaded Delaunay terrain; biome weights use the face-neighbour graph, not isolated normals. */
export function generateTerrain({ level, size, count, seed, amplitude, mask, warp = 0, erosion = 0, island = false }: TerrainOptions) {
  const rng = random(seed), noise = createNoise2D(seed), half = size / 2;
  const field = (x: number, y: number) => {
    const wx = x + warp * size * noise(x/size*1.3+31,y/size*1.3-17), wy = y + warp * size * noise(x/size*1.3-12,y/size*1.3+9);
    return terrainHeight(wx, wy, { noise, amplitude, frequency: 1.5 / size });
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
    if (island) {
      const bend = noise(x*.43+6,y*.43-3)*.38;
      const ridge = Math.exp(-((x/2.05)**2 + ((y+x*.18+bend)/1.35)**2));
      h = h*.62 + ridge*1.65;
    }
    return h * (mask?.(x, y) ?? 1);
  });
  const delaunay = delaunayFrom(points);
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
  if (island) {
    const high=Math.max(...heights);
    heights.forEach((h,i)=>heights[i]=(h/high)**1.1*2.67);
    points.forEach(p=>p[1]*=3.5/5.6);
    // Delaunay connectivity is retained under this affine compression.
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
  for (const f of faces) {
    const nearby=[f,...f.adjacent.map(i=>faces[i])];
    const h=nearby.reduce((s,v)=>s+v.height,0)/nearby.length/(island?2.67:amplitude);
    const slope=nearby.reduce((s,v)=>s+v.slope,0)/nearby.length;
    const boundary=noise(f.x/size*2.1+13,f.z/size*2.1-8)*.025;
    const snow=smooth(island?.84:.75,island?.915:.84,h+boundary);
    const shore=island?Math.max(1-smooth(.10,.17,h),smooth(.68,.72,h)*(1-smooth(.75,.79,h))*(1-smooth(.10,.25,slope))):1-smooth(.14,.22,h+boundary);
    const rock=Math.max(smooth(.24,.42,slope+boundary),smooth(.66,.83,h));
    f.weights=[shore*(1-snow),(1-shore)*(1-rock)*(1-snow),(1-shore)*rock*(1-snow),snow];
    f.biome=f.weights.indexOf(Math.max(...f.weights));
  }
  // Hysteresis: isolated holes inherit a unanimous surrounding region. Then blend
  // weights across shared edges, retaining flat geometric normals and reveal labels.
  for(let pass=0;pass<2;pass++) {
    const labels=faces.map(f=>f.biome);
    faces.forEach(f=>{if(f.adjacent.length===3 && f.adjacent.every(j=>labels[j]!==f.biome)) {
      f.biome=[0,1,2,3].sort((a,b)=>f.adjacent.filter(j=>labels[j]===b).length-f.adjacent.filter(j=>labels[j]===a).length)[0]; f.weights=f.weights.map((v,i)=>v*.15+(i===f.biome?.85:0));
    }});
  }
  const positions:number[]=[], biomes:number[]=[], slopes:number[]=[], weights:number[]=[];
  for(const f of faces) {
    const blend=f.weights.map((w,k)=>w*.8+f.adjacent.reduce((s,j)=>s+faces[j].weights[k],0)/Math.max(1,f.adjacent.length)*.2);
    for(const id of f.ids) { positions.push(points[id][0],heights[id],points[id][1]);biomes.push(f.biome);slopes.push(f.slope);weights.push(...blend); }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  const biome=new Float32Array(biomes);
  geometry.setAttribute('biome',new Float32BufferAttribute(biome,1));geometry.setAttribute('biomeWeights',new Float32BufferAttribute(weights,4));geometry.setAttribute('slope',new Float32BufferAttribute(slopes,1));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return {geometry,seeds:new Float32Array(points.flat()),heights,delaunay,biome,faces};
}
export const ISLAND_SEED = 42;
export function generateIslandTerrain(seed=ISLAND_SEED) {
  const mask=(x:number,z:number)=>Math.max(0,1-(Math.abs(x/2.8)**4+Math.abs(z/2.8)**4))**.8;
  return generateTerrain({level:3,size:5.6,count:1200,seed,amplitude:3.1,mask,warp:.16,erosion:8,island:true});
}
