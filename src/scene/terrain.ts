import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from 'three/webgpu';
import { WORLD } from '../config';
import { poissonDisk } from '../lib/poisson';
import { delaunayFrom, type Point2 } from '../lib/triangulate';
import { createNoise2D, fbm } from '../lib/noise';
import { random } from '../lib/random';
import { ISLAND, terrainHeight } from './field';

const R = WORLD.half;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const noise = createNoise2D(311);

export type EdgeProfile = { t: number; h: number }[];
/** Sides in order: -z, +x, +z, -x. Profiles run along +x (for +-z) or +z (for +-x). */
export type Edges = [EdgeProfile, EdgeProfile, EdgeProfile, EdgeProfile];

const palette = {
  sand: new Color('#dcc08a'), sandDark: new Color('#bf9c62'), sandWet: new Color('#b89c6c'), silt: new Color('#a99b7c'),
  beach: new Color('#f1dfae'), grassA: new Color('#77a13b'), grassB: new Color('#5b8f35'), grassC: new Color('#8bb046'), grassDark: new Color('#3f7031'),
  rockA: new Color('#8a8479'), rockB: new Color('#6e685f'), rockC: new Color('#a59c8d'), rockWarm: new Color('#87684d'), rockSand: new Color('#a08260'), algae: new Color('#5d8a63'), algaeDark: new Color('#3f6f5a'), moss: new Color('#66804a'),
};

/** Flat-shaded Poisson/Delaunay terrain (seabed + island) clipped exactly to the square. */
export function buildTerrain() {
  const rng = random(4242), size = R * 2;
  const boundaryCount = 40;
  const points: Point2[] = [];
  const sides: { t: number; index: number }[][] = [[], [], [], []];
  for (let i = 0; i < boundaryCount; i++) {
    const t = -R + size * i / boundaryCount;
    sides[0].push({ t, index: points.length }); points.push([t, -R]);
    sides[1].push({ t, index: points.length }); points.push([R, t]);
    sides[2].push({ t: -t, index: points.length }); points.push([-t, R]);
    sides[3].push({ t: -t, index: points.length }); points.push([-R, -t]);
  }
  // Variable density: finer around the island where the silhouette matters.
  const density = (x: number, z: number) => {
    const d = Math.hypot(x - ISLAND.x, z - ISLAND.z);
    return 0.62 - 0.30 * smooth(6.2, 1.8, d);
  };
  const interior = poissonDisk({ bounds: [-R, -R, R, R], radius: density, minRadius: 0.30, maxRadius: 0.65, seed: 17 });
  for (const p of interior) if (Math.abs(p[0]) < R - 0.27 && Math.abs(p[1]) < R - 0.27) points.push(p);
  const delaunay = delaunayFrom(points);
  const heights = Float32Array.from(points, ([x, z]) => terrainHeight(x, z));

  const positions: number[] = [], colors: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), col = new Color();
  const tri = delaunay.triangles;
  for (let i = 0; i < tri.length; i += 3) {
    let ids = [tri[i], tri[i + 1], tri[i + 2]];
    a.set(points[ids[0]][0], heights[ids[0]], points[ids[0]][1]);
    b.set(points[ids[1]][0], heights[ids[1]], points[ids[1]][1]);
    c.set(points[ids[2]][0], heights[ids[2]], points[ids[2]][1]);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.y < 0) { ids = [ids[0], ids[2], ids[1]]; n.negate(); }
    n.normalize();
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3, cy = (a.y + b.y + c.y) / 3;
    terrainColor(cx, cz, cy, n.y, rng(), col);
    for (const id of ids) { positions.push(points[id][0], heights[id], points[id][1]); colors.push(col.r, col.g, col.b); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const corner = (side: number, t: number) => side === 0 ? terrainHeight(t, -R) : side === 1 ? terrainHeight(R, t) : side === 2 ? terrainHeight(t, R) : terrainHeight(-R, t);
  const edges = sides.map((s, side) => {
    const profile = s.sort((p, q) => p.t - q.t).map(({ t, index }) => ({ t, h: heights[index] }));
    if (profile[0].t > -R + 1e-6) profile.unshift({ t: -R, h: corner(side, -R) });
    if (profile[profile.length - 1].t < R - 1e-6) profile.push({ t: R, h: corner(side, R) });
    return profile;
  }) as Edges;
  return { geometry, edges };
}

function terrainColor(x: number, z: number, y: number, ny: number, jitter: number, out: Color) {
  const level = WORLD.surface;
  const patch = fbm(x * 0.5 + 7, z * 0.5 - 3, { noise, octaves: 3 }) * 0.5 + 0.5;
  const fine = noise(x * 1.7, z * 1.7) * 0.5 + 0.5;
  const steep = 1 - ny;
  if (y < level - 0.35) {
    // Seabed: warm sand, silty patches, greyish rock on steeper flanks.
    out.copy(palette.sand).lerp(palette.sandDark, smooth(0.25, 0.75, patch)).lerp(palette.silt, smooth(0.6, 0.9, fine) * 0.4);
    const rocky = smooth(0.30, 0.52, steep + (fine - 0.5) * 0.14);
    out.lerp(Math.abs(noise(x * 0.9, z * 0.9)) > 0.45 ? palette.rockWarm : palette.rockSand, rocky * 0.85);
    const moss = smooth(0.15, 0.5, noise(x * 1.1 + 40, z * 1.1 - 9)) * smooth(0.14, 0.4, steep);
    out.lerp(fine > 0.5 ? palette.algae : palette.algaeDark, moss * 0.75);
  } else if (y < level + 0.45 && steep < 0.28) {
    out.copy(palette.beach).lerp(palette.sandDark, smooth(0.5, 0.9, fine) * 0.35);
    if (y < level + 0.05) out.lerp(palette.sandWet, 0.4);
  } else {
    const grass = patch < 0.35 ? palette.grassB : patch < 0.65 ? palette.grassA : palette.grassC;
    out.copy(grass).lerp(palette.grassDark, smooth(0.6, 0.95, fine) * 0.5);
    const rocky = Math.max(smooth(0.36, 0.56, steep + (fine - 0.5) * 0.1), smooth(9.6, 10.2, y) * 0.5);
    out.lerp(fine > 0.55 ? palette.rockA : palette.rockB, rocky).lerp(palette.moss, rocky * 0.15 * patch);
    if (y < level + 0.9 && steep < 0.35) out.lerp(palette.beach, smooth(level + 0.9, level + 0.45, y) * 0.7);
  }
  const k = 0.93 + jitter * 0.14;
  out.multiplyScalar(k);
}

/** Interpolated edge height for water strips. side/profile as in Edges. */
export function edgeHeight(profile: EdgeProfile, t: number) {
  if (t <= profile[0].t) return profile[0].h;
  for (let i = 1; i < profile.length; i++) {
    if (t <= profile[i].t) { const u = (t - profile[i - 1].t) / (profile[i].t - profile[i - 1].t); return profile[i - 1].h * (1 - u) + profile[i].h * u; }
  }
  return profile[profile.length - 1].h;
}

/** Earth block: four strata side faces following the terrain profile, plus a craggy rocky underbelly. */
export function buildSlab(edges: Edges) {
  const positions: number[] = [], normals: number[] = [], tops: number[] = [];
  const ab = new Vector3(), ac = new Vector3(), nn = new Vector3();
  const tri = (p: Vector3[], expected: Vector3, top: number[]) => {
    ab.subVectors(p[1], p[0]); ac.subVectors(p[2], p[0]); nn.crossVectors(ab, ac);
    if (nn.dot(expected) < 0) { p = [p[0], p[2], p[1]]; top = [top[0], top[2], top[1]]; }
    p.forEach((v, i) => { positions.push(v.x, v.y, v.z); normals.push(expected.x, expected.y, expected.z); tops.push(top[i]); });
  };
  const outward = [new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(-1, 0, 0)];
  const at = (side: number, t: number, y: number) => side === 0 ? new Vector3(t, y, -R) : side === 1 ? new Vector3(R, y, t) : side === 2 ? new Vector3(t, y, R) : new Vector3(-R, y, t);
  edges.forEach((profile, side) => {
    for (let i = 0; i + 1 < profile.length; i++) {
      const p0 = profile[i], p1 = profile[i + 1];
      tri([at(side, p0.t, 0), at(side, p1.t, 0), at(side, p0.t, p0.h)], outward[side], [p0.h, p1.h, p0.h]);
      tri([at(side, p1.t, 0), at(side, p1.t, p1.h), at(side, p0.t, p0.h)], outward[side], [p1.h, p1.h, p0.h]);
    }
  });
  // Underbelly: inverted, noise-carved super-ellipse cone. Zero depth exactly on the border so it meets the sides.
  const n = 60, noiseB = createNoise2D(577), depthMax = 2.55;
  const belly = (x: number, z: number) => {
    const u = Math.abs(x) / R, v = Math.abs(z) / R;
    const rho = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
    if (rho >= 1) return { x, y: 0, z };
    const inner = 1 - rho;
    const ridge = 1 - Math.abs(noiseB(x * 0.45 + 2, z * 0.45 - 4));
    const crag = fbm(x * 0.7, z * 0.7, { noise: noiseB, octaves: 3 });
    let y = -depthMax * Math.pow(inner, 0.5) * (0.78 + 0.34 * crag);
    y -= 0.85 * Math.pow(Math.max(0, ridge - 0.62) * 2.6, 1.7) * Math.pow(inner, 0.5);
    const jitter = smooth(0.0, 0.3, inner) * 0.28;
    return { x: x + noiseB(x * 0.9 + 9, z * 0.9) * jitter, y, z: z + noiseB(x * 0.9, z * 0.9 + 5) * jitter };
  };
  const grid: Vector3[] = [];
  for (let iz = 0; iz <= n; iz++) for (let ix = 0; ix <= n; ix++) {
    const p = belly(-R + size2(ix, n), -R + size2(iz, n)); grid.push(new Vector3(p.x, p.y, p.z));
  }
  const down = new Vector3(0, -1, 0);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const a = grid[iz * (n + 1) + ix], b = grid[iz * (n + 1) + ix + 1], c = grid[(iz + 1) * (n + 1) + ix], d = grid[(iz + 1) * (n + 1) + ix + 1];
    const flip = (ix + iz) % 2 === 0;
    const t: Vector3[][] = flip ? [[a, c, b], [b, c, d]] : [[a, c, d], [a, d, b]];
    for (let p of t) {
      ab.subVectors(p[1], p[0]); ac.subVectors(p[2], p[0]); nn.crossVectors(ab, ac).normalize();
      if (nn.dot(down) < 0) { nn.negate(); p = [p[0], p[2], p[1]]; }
      p.forEach(v => { positions.push(v.x, v.y, v.z); normals.push(nn.x, nn.y, nn.z); tops.push(0); });
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('topY', new Float32BufferAttribute(tops, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
const size2 = (i: number, n: number) => i / n * R * 2;
