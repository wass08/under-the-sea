import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three/webgpu';
import { random } from './random';
import { createNoise2D, fbm, terrainHeight } from './noise';
import { poissonDisk } from './poisson';
import { delaunayFrom, type Point2 } from './triangulate';
export type TerrainOptions = { level: 1 | 2 | 3; size: number; count: number; seed: number; amplitude: number; mask?: (x: number, y: number) => number };
/** Build a flat-shaded square patch. Seeds are local x/z pairs; biome and slope are per mesh vertex. */
export function generateTerrain({ level, size, count, seed, amplitude, mask }: TerrainOptions) {
  const rng = random(seed), noise = createNoise2D(seed), half = size / 2;
  const field = (x: number, y: number) => terrainHeight(x, y, { noise, amplitude, frequency: 1.5 / size });
  const e = size / 350;
  const slopeAt = (x: number, y: number) => Math.hypot(field(x + e, y) - field(x - e, y), field(x, y + e) - field(x, y - e)) / (2 * e);
  let points: Point2[];
  if (level === 3) {
    const base = size / Math.sqrt(count) * 1.05;
    const radius = (x: number, y: number) => base / Math.sqrt(0.65 + Math.min(2, slopeAt(x, y)) * 1.8);
    points = poissonDisk({ bounds: [-half, -half, half, half], radius, minRadius: base / Math.sqrt(4.25), maxRadius: base / Math.sqrt(0.65), seed });
  } else points = Array.from({ length: count }, () => [(rng() - 0.5) * size, (rng() - 0.5) * size]);
  // Boundary samples keep all four edges straight, including the square corners.
  const edges = Math.max(8, Math.ceil(Math.sqrt(count)));
  for (let i = 0; i < edges; i++) {
    const t = -half + size * i / edges;
    points.push([t, -half], [half, t], [-t, half], [-half, -t]);
  }
  const heights = Float32Array.from(points, ([x, y]) => {
    const h = level === 1 ? rng() * amplitude : level === 2 ? (fbm(x * 2 / size, y * 2 / size, { noise, octaves: 5 }) * 0.5 + 0.5) * amplitude : field(x, y);
    return h * (mask?.(x, y) ?? 1);
  });
  const delaunay = delaunayFrom(points), positions: number[] = [], biomes: number[] = [], slopes: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const ids = Array.from(delaunay.triangles.slice(i, i + 3));
    const vertices = ids.map(id => new Vector3(points[id][0], heights[id], points[id][1]));
    a.subVectors(vertices[1], vertices[0]); b.subVectors(vertices[2], vertices[0]); c.crossVectors(a, b).normalize();
    if (c.y < 0) vertices.reverse();
    const slope = 1 - Math.abs(c.y), height = ids.reduce((sum, id) => sum + heights[id], 0) / (3 * Math.max(amplitude, 0.001));
    const biome = height > 0.78 && slope < 0.58 ? 3 : slope > 0.36 || height > 0.58 ? 2 : height < 0.18 ? 0 : 1;
    for (const v of vertices) { positions.push(v.x, v.y, v.z); biomes.push(biome); slopes.push(slope); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const biome = new Float32Array(biomes);
  geometry.setAttribute('biome', new Float32BufferAttribute(biome, 1));
  geometry.setAttribute('slope', new Float32BufferAttribute(slopes, 1));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return { geometry, seeds: new Float32Array(points.flat()), heights, delaunay, biome };
}
