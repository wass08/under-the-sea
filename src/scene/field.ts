import { WORLD } from '../config';
import { createNoise2D, fbm } from '../lib/noise';

/** Analytic height field of the seabed and island, shared by the mesh, the fish contract and the shaders. */
const noiseA = createNoise2D(7), noiseB = createNoise2D(23), noiseC = createNoise2D(91);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const ISLAND = { x: -2.9, z: -2.9 };
/** Basin centre: the big open space where the school lives. */
export const BASIN = { x: 2.0, z: 1.9 };

// Radius (from island centre) -> height above the seabed. Monotone cubic (PCHIP) through the anchors.
const ANCHORS: [number, number][] = [
  [0, 8.1], [1.0, 7.9], [1.7, 7.5], [2.3, 6.8], [2.75, 5.9], [3.2, 4.9], [3.7, 3.7], [4.4, 2.1], [5.2, 0.85], [6.2, 0],
];
const xs = ANCHORS.map(a => a[0]), ys = ANCHORS.map(a => a[1]);
const deltas = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
const tangents = ys.map((_, i) => {
  if (i === 0) return 0;
  if (i === ys.length - 1) return 0;
  if (deltas[i - 1] * deltas[i] <= 0) return 0;
  const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
  return (w1 + w2) / (w1 / deltas[i - 1] + w2 / deltas[i]);
});
function profile(r: number) {
  if (r >= xs[xs.length - 1]) return 0;
  let i = 0; while (r > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], t = (r - xs[i]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * tangents[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * tangents[i + 1];
}

export function seabedHeight(x: number, z: number) {
  const relief = fbm(x * 0.30 + 11, z * 0.30 - 5, { noise: noiseA, octaves: 3 });
  const d = Math.hypot(x - BASIN.x, z - BASIN.z);
  const lift = 1.25 * smooth(4.6, 11, d) * (0.78 + 0.22 * noiseB(x * 0.4, z * 0.4));
  const dip = 0.16 * Math.exp(-((d / 3.8) ** 2));
  return WORLD.bed - 0.05 + relief * 0.34 + noiseC(x * 1.4, z * 1.4) * 0.035 + lift - dip;
}

export function islandBump(x: number, z: number) {
  const dx = x - ISLAND.x, dz = z - ISLAND.z;
  let r = Math.hypot(dx / 1.04, dz / 0.93) * (1 + 0.15 * noiseB(dx * 0.33 + 3, dz * 0.33 - 1));
  r += 0.42 * fbm(dx * 0.55, dz * 0.55, { noise: noiseC, octaves: 3 });
  const crag = noiseA(x * 1.05 + 4, z * 1.05) * 0.32 * smooth(4.2, 1.6, r) + noiseC(x * 2.6, z * 2.6) * 0.09 * smooth(3.6, 1.0, r);
  return profile(Math.max(0, r)) + crag * (r < 6.3 ? 1 : 0);
}

export function terrainHeight(x: number, z: number) {
  return seabedHeight(x, z) + islandBump(x, z);
}

export function sampleGrid(resolution: number) {
  const heights = new Float32Array(resolution * resolution), size = WORLD.half * 2;
  for (let iz = 0; iz < resolution; iz++) for (let ix = 0; ix < resolution; ix++) {
    heights[iz * resolution + ix] = terrainHeight(-WORLD.half + (ix + 0.5) / resolution * size, -WORLD.half + (iz + 0.5) / resolution * size);
  }
  return heights;
}
