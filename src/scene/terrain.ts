import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three/webgpu';
import { WORLD } from '../config';
import { poissonDiskFast } from '../lib/poisson-fast';
import { delaunayFrom, type Point2 } from '../lib/triangulate';
import { terrainHeight } from './field';

const R = WORLD.half;

export type EdgeProfile = { t: number; h: number }[];
/** Sides in order: -z, +x, +z, -x. Profiles run along +x (for +-z) or +z (for +-x). */
export type Edges = [EdgeProfile, EdgeProfile, EdgeProfile, EdgeProfile];

/**
 * The Lab's level-3 pipeline: slope-weighted Poisson-disk sampling (denser where the ground is steep, and
 * along the shoreline), Delaunay triangulation, boundary samples on the square so it clips cleanly. Dense
 * enough for smooth shading: normals come from the analytic height field, so no facets show.
 */
export function buildTerrain() {
  const size = R * 2, cells = 288, step = size / cells;
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) grid[j * (cells + 1) + i] = terrainHeight(-R + i * step, -R + j * step);
  const at = (i: number, j: number) => grid[Math.max(0, Math.min(cells, j)) * (cells + 1) + Math.max(0, Math.min(cells, i))];
  const slopeAt = (x: number, z: number) => {
    const i = Math.round((x + R) / step), j = Math.round((z + R) / step);
    return Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * step);
  };
  const heightGrid = (x: number, z: number) => at(Math.round((x + R) / step), Math.round((z + R) / step));

  const base = 0.62;
  const radius = (x: number, z: number) => {
    const shore = Math.abs(heightGrid(x, z) - WORLD.surface);
    const shoreFactor = 0.55 + 0.45 * Math.min(1, shore / 1.4);
    return base / Math.sqrt(0.65 + Math.min(2, slopeAt(x, z)) * 1.8) * shoreFactor;
  };
  const interior = poissonDiskFast({ bounds: [-R, -R, R, R], radius, minRadius: base / Math.sqrt(4.25) * 0.55, maxRadius: base / Math.sqrt(0.65), seed: 17 });

  const points: Point2[] = [];
  const sides: { t: number; index: number }[][] = [[], [], [], []];
  const boundaryCount = 192;
  for (let i = 0; i < boundaryCount; i++) {
    const t = -R + size * i / boundaryCount;
    sides[0].push({ t, index: points.length }); points.push([t, -R]);
    sides[1].push({ t, index: points.length }); points.push([R, t]);
    sides[2].push({ t: -t, index: points.length }); points.push([-t, R]);
    sides[3].push({ t: -t, index: points.length }); points.push([-R, -t]);
  }
  for (const p of interior) if (Math.abs(p[0]) < R - 0.3 && Math.abs(p[1]) < R - 0.3) points.push(p);

  const delaunay = delaunayFrom(points);
  const heights = Float32Array.from(points, ([x, z]) => terrainHeight(x, z));
  const positions = new Float32Array(points.length * 3), normals = new Float32Array(points.length * 3);
  const e = 0.08;
  points.forEach(([x, z], i) => {
    positions.set([x, heights[i], z], i * 3);
    const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    const inv = 1 / Math.hypot(dx, 1, dz);
    normals.set([-dx * inv, inv, -dz * inv], i * 3);
  });
  const tri = delaunay.triangles, index = new Uint32Array(tri.length);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < tri.length; i += 3) {
    const ids = [tri[i], tri[i + 1], tri[i + 2]];
    a.fromArray(positions, ids[0] * 3); b.fromArray(positions, ids[1] * 3); c.fromArray(positions, ids[2] * 3);
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    if (cross.y < 0) { const t = ids[1]; ids[1] = ids[2]; ids[2] = t; }
    index.set(ids, i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(new Uint32BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  const corner = (side: number, t: number) => side === 0 ? terrainHeight(t, -R) : side === 1 ? terrainHeight(R, t) : side === 2 ? terrainHeight(t, R) : terrainHeight(-R, t);
  const edges = sides.map((s, side) => {
    const profile = s.sort((p, q) => p.t - q.t).map(({ t, index: id }) => ({ t, h: heights[id] }));
    if (profile[0].t > -R + 1e-6) profile.unshift({ t: -R, h: corner(side, -R) });
    if (profile[profile.length - 1].t < R - 1e-6) profile.push({ t: R, h: corner(side, R) });
    return profile;
  }) as Edges;
  return { geometry, edges, vertexCount: points.length };
}

/** Interpolated edge height for water strips. */
export function edgeHeight(profile: EdgeProfile, t: number) {
  if (t <= profile[0].t) return profile[0].h;
  for (let i = 1; i < profile.length; i++) {
    if (t <= profile[i].t) { const u = (t - profile[i - 1].t) / (profile[i].t - profile[i - 1].t); return profile[i - 1].h * (1 - u) + profile[i].h * u; }
  }
  return profile[profile.length - 1].h;
}

/**
 * Open-sea seabed beyond the detailed terrain: one grid whose cells are 1 unit up to a few units past the old block
 * and then widen geometrically out to `far`, sampling the same analytic height field. Vertices strictly inside the
 * detailed square are pushed under it so the two never fight; every vertex on or outside ±R is exact.
 */
export function buildOuterSeabed(far = 150) {
  const axis: number[] = [];
  for (let x = -R - 8; x <= R + 8; x++) axis.push(x);
  for (let x = R + 8, step = 1.4; x < far; step *= 1.22) { x = Math.min(far, x + step); axis.push(x); axis.unshift(-x); }
  const n = axis.length, positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3), index: number[] = [];
  const e = 0.2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = axis[i], z = axis[j], k = (j * n + i) * 3, inside = Math.abs(x) < R - 1e-6 && Math.abs(z) < R - 1e-6;
    positions.set([x, terrainHeight(x, z) - (inside ? 0.6 : 0), z], k);
    const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    const inv = 1 / Math.hypot(dx, 1, dz);
    normals.set([-dx * inv, inv, -dz * inv], k);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(new Uint32BufferAttribute(new Uint32Array(index), 1));
  geometry.computeBoundingSphere();
  return geometry;
}
