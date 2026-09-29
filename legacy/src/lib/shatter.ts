import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, Vector2 } from 'three/webgpu';
import { random } from './random';
import { lloydRelax, polygonCentroid, voronoiCells, type Bounds, type Point2 } from './triangulate';
export type ShatterCell = { polygon: Point2[]; seed: Point2; ring: number; distance: number; impactCore?: boolean };
export type ShatterOptions = { level: 1 | 2 | 3; width: number; height: number; impact: Point2; count: number; seed: number };
/** Merge only edge-adjacent cells, preferring small groups, until the body budget is met. */
export function groupAdjacentCells(cells: ShatterCell[], budget: number, minimumArea = 0): ShatterCell[][] {
  if (minimumArea <= 0 && budget >= cells.length) return cells.map(cell => [cell]);
  const parents = cells.map((_, i) => i), groups = new Map(cells.map((cell, i) => [i, [cell]]));
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]));
  const edges = new Map<string, number>(), neighbours: [number, number][] = [];
  const key = (p: Point2) => p.map(v => Math.round(v * 1e7)).join(',');
  cells.forEach((cell, id) => cell.polygon.forEach((p, i) => {
    const edge = [key(p), key(cell.polygon[(i + 1) % cell.polygon.length])].sort().join('/');
    const other = edges.get(edge);
    if (other === undefined) edges.set(edge, id); else neighbours.push([other, id]);
  }));
  const area = (group: ShatterCell[]) => group.reduce((sum, cell) => sum + Math.abs(cell.polygon.reduce((a, p, i) => { const q = cell.polygon[(i + 1) % cell.polygon.length]; return a + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2, 0);
  const areas = new Map([...groups].map(([id, group]) => [id, area(group)]));
  while (groups.size > Math.max(1, budget) || (minimumArea > 0 && [...areas.values()].some(a => a < minimumArea))) {
    let pair: [number, number] | undefined, smallest = Infinity;
    for (const [a, b] of neighbours) {
      const x = root(a), y = root(b);
      if (x === y) continue;
      const ax = areas.get(x)!, ay = areas.get(y)!;
      if (groups.size <= Math.max(1, budget) && Math.min(ax, ay) >= minimumArea) continue;
      const size = minimumArea > 0 ? ax + ay : groups.get(x)!.length + groups.get(y)!.length;
      if (size < smallest) { smallest = size; pair = [x, y]; }
    }
    if (!pair) { if (groups.size <= Math.max(1, budget)) break; throw new Error('Body budget is smaller than the number of disconnected fracture regions'); }
    const [a, b] = pair; parents[b] = a; groups.get(a)!.push(...groups.get(b)!); groups.delete(b); areas.set(a, areas.get(a)! + areas.get(b)!); areas.delete(b);
  }
  return [...groups.values()];
}
/** Local, centred fracture cells: grid, random Voronoi, or radial density with ring cracks. */
export function generateShatterPattern({ level, width, height, impact, count, seed }: ShatterOptions) {
  if (!(width > 0 && height > 0 && count >= 12 && Number.isFinite(count))) throw new Error('Fracture dimensions must be positive and count at least 12');
  if (Math.abs(impact[0]) > width / 2 + 1e-6 || Math.abs(impact[1]) > height / 2 + 1e-6) throw new Error('Impact must lie inside the pane');
  const rng = random(seed), bounds: Bounds = [-width / 2, -height / 2, width / 2, height / 2];
  let seeds: Point2[] = []; const rings: number[] = [];
  const distance = (p: Point2) => Math.hypot(p[0] - impact[0], p[1] - impact[1]);
  if (level === 1) {
    const cols = Math.max(1, Math.round(Math.sqrt(count * width / height))), rows = Math.max(1, Math.round(count / cols));
    const cells: ShatterCell[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const x0 = x * width / cols - width / 2, y0 = y * height / rows - height / 2;
      const x1 = x0 + width / cols, y1 = y0 + height / rows;
      const p: Point2 = [(x0 + x1) / 2, (y0 + y1) / 2]; seeds.push(p);
      cells.push({ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], seed: p, ring: 0, distance: distance(p) });
    }
    return { cells, seeds };
  }
  if (level === 2) seeds = Array.from({ length: count }, () => [(rng() - 0.5) * width, (rng() - 0.5) * height]);
  else {
    const inside = (p: Point2) => p[0] > bounds[0] && p[0] < bounds[2] && p[1] > bounds[1] && p[1] < bounds[3];
    const push = (p: Point2, ring: number) => { if (inside(p)) { seeds.push(p); rings.push(ring); } };
    // A jagged dense core, then aligned angular spokes on separated rings.
    const coreRadius = Math.min(width, height) * 0.16, coreCount = Math.round(count * 0.55);
    while (seeds.length < coreCount) {
      const a = rng() * Math.PI * 2, r = coreRadius * Math.pow(rng(), 0.8);
      push([impact[0] + Math.cos(a) * r, impact[1] + Math.sin(a) * r], 0);
    }
    const spokes = Math.max(6, Math.round(count * 0.065)), phase = rng() * Math.PI * 2;
    for (let ring = 1; ring <= 4; ring++) for (let j = 0; j < spokes; j++) {
      const a = phase + (j + (rng() - 0.5) * 0.12) / spokes * Math.PI * 2;
      const r = coreRadius * [0, 1.45, 2.8, 4.9, 7.8][ring] * (0.97 + rng() * 0.06);
      push([impact[0] + Math.cos(a) * r, impact[1] + Math.sin(a) * r], ring);
    }
    while (seeds.length < count) {
      const p: Point2 = [(rng() - 0.5) * width, (rng() - 0.5) * height];
      if (rng() < 0.035 / (0.035 + distance(p) ** 2)) push(p, -1);
    }
    // Lloyd relaxation ONLY outside the ring structure: keep the impact core jagged.
    seeds = lloydRelax(seeds, bounds, 1, (p, i) => rings[i] === -1 && distance(p) > coreRadius * 3);
  }
  const polygons = voronoiCells(seeds, bounds);
  return { seeds, cells: polygons.map((polygon, i) => ({ polygon, seed: seeds[i], ring: rings[i] ?? 0, distance: distance(seeds[i]) })).filter(c => c.polygon.length >= 3) };
}
// Main-page policy only: gentle per-fracture budgets total 649 independent cells.
export const AQUARIUM_WALL_FRACTIONS = [1, .8, .65, .5] as const;
export const AQUARIUM_CELL_COUNT = 220, IMPACT_CORE_RADIUS = .28;
/** Thin outer seeds, never weld cells or remove the existing released strike core. */
export function generateAquariumPattern(options: ShatterOptions, fraction = 1): { cells: ShatterCell[]; seeds: Point2[]; fraction: number; requestedFraction: number } {
  const original = generateShatterPattern(options);
  // Preserve the entire original generation path, vertex order and RNG order for wall one.
  if (fraction >= 1) return { ...original, fraction: 1, requestedFraction: 1 };
  const core = new Set<number>(), keep = new Set<number>();
  original.cells.forEach((cell, i) => { const c = polygonCentroid(cell.polygon); if (Math.hypot(c[0]-options.impact[0], c[1]-options.impact[1]) < IMPACT_CORE_RADIUS) { core.add(i); keep.add(i); } });
  const target = Math.round(options.count*fraction);
  // Reserve the relaxed far field, then distribute ring anchors evenly within the
  // exact budget. Tight fourth-wall budgets thin outer rings, never the strike core.
  const relaxed = original.cells.map((c,i)=>({c,i})).filter(v=>v.c.ring===-1&&v.c.distance>Math.min(options.width,options.height)*.48);
  const first = relaxed.sort((a,b)=>b.c.distance-a.c.distance || a.i-b.i)[0];
  if (first && keep.size < target) { keep.add(first.i); const other = relaxed.filter(v=>v.i!==first.i).sort((a,b)=>Math.hypot(b.c.seed[0]-first.c.seed[0],b.c.seed[1]-first.c.seed[1])-Math.hypot(a.c.seed[0]-first.c.seed[0],a.c.seed[1]-first.c.seed[1]))[0]; if(other && keep.size < target)keep.add(other.i); }
  for (let round = 0; round < 4; round++) for (let ring = 1; ring <= 4 && keep.size < target; ring++) {
    const candidates = original.cells.map((c,i)=>({c,i})).filter(v=>v.c.ring===ring), chosen = candidates.filter(v=>keep.has(v.i));
    const next = candidates.filter(v=>!keep.has(v.i)).sort((a,b)=>{
      const score = (v: typeof a) => chosen.length ? Math.min(...chosen.map(w=>(v.c.seed[0]-w.c.seed[0])**2+(v.c.seed[1]-w.c.seed[1])**2)) : -v.i;
      return score(b)-score(a) || a.i-b.i;
    })[0];
    if (next) keep.add(next.i);
  }
  // Removing farthest first takes the reduction from the low-density outskirts.
  const removable = original.cells.map((c,i)=>({c,i})).filter(v=>!keep.has(v.i)).sort((a,b)=>b.c.distance-a.c.distance || b.i-a.i);
  const removed = new Set(removable.slice(0,Math.max(0,original.cells.length-target)).map(v=>v.i));
  const retained = original.cells.map((c,i)=>({c,i})).filter(v=>!removed.has(v.i)), rawSeeds = retained.map(v=>v.c.seed);
  const seeds = lloydRelax(rawSeeds,[-options.width/2,-options.height/2,options.width/2,options.height/2],1,(_,i)=>retained[i].c.ring===-1&&retained[i].c.distance>Math.min(options.width,options.height)*.48);
  const polygons = voronoiCells(seeds,[-options.width/2,-options.height/2,options.width/2,options.height/2]);
  const cells = retained.map(({c,i},j)=>({...c,seed:seeds[j],distance:Math.hypot(seeds[j][0]-options.impact[0],seeds[j][1]-options.impact[1]),polygon:polygons[j],impactCore:core.has(i)}));
  return { cells, seeds, fraction: cells.length/options.count, requestedFraction: fraction };
}
/** Extruded convex slab centred on its area centroid; offset is in pane-local x/y. */
export function buildShardGeometry(cell: ShatterCell, thickness: number) {
  const centroid = polygonCentroid(cell.polygon);
  const shape = new Shape(cell.polygon.map(p => new Vector2(p[0] - centroid[0], p[1] - centroid[1])));
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -thickness / 2); geometry.computeBoundingSphere();
  return { geometry, centroid, offset: centroid };
}
/** Offset the convex cell's edges inward; clamp the inset for tiny impact fragments. */
export function insetCell(cell: ShatterCell, amount = 0.004): ShatterCell {
  const p = cell.polygon, center = polygonCentroid(p);
  const area = p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0);
  const sign = area >= 0 ? 1 : -1;
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    const nx = -dy / length * sign, ny = dx / length * sign;
    return { nx, ny, c: nx * a[0] + ny * a[1] };
  });
  const inset = Math.min(amount, ...lines.map(l => (l.nx * center[0] + l.ny * center[1] - l.c) * 0.35));
  // Clip against offset half-planes: a short edge can disappear when inset.
  // Intersecting successive infinite lines instead creates spikes at those corners.
  let polygon: Point2[] = p.map(v => [...v]);
  for (const line of lines) {
    const next: Point2[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = line.nx * a[0] + line.ny * a[1] - line.c - inset, db = line.nx * b[0] + line.ny * b[1] - line.c - inset;
      if (da >= -1e-10) next.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    polygon = next;
  }
  return { ...cell, polygon };
}
/** Cell edges in pane-local x/y at z=0; suitable for a LineSegments reveal. */
export function buildOutlineGeometry(cells: ShatterCell[]) {
  const vertices: number[] = [];
  for (const { polygon } of cells) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]; vertices.push(...a, 0, ...b, 0);
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3));
}
/** Seed positions as a Points geometry in pane-local x/y. */
export function buildSeedPoints(seeds: Point2[]) {
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(seeds.flatMap(p => [...p, 0]), 3));
}
