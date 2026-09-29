import { WORLD } from '../config';
import { createNoise2D, fbm } from '../lib/noise';

/** Analytic height field: a wide sandy seabed with one sand island in the middle. Shared by mesh, fish contract and shaders. */
const noiseA = createNoise2D(7), noiseB = createNoise2D(23), noiseC = createNoise2D(91);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const ISLAND = { x: 0, z: 0, shoreRadius: 5 };

// Radius from the island centre -> height above the sea floor. Monotone cubic (PCHIP): dune top, flat beach
// ring just above the waterline, then a sandy shelf descending to the seabed by r ~ 11.
const ANCHORS: [number, number][] = [
  [0, 10.9], [1.5, 10.6], [3.0, 9.9], [4.0, 9.4], [4.6, 9.15], [5.1, 8.8], [5.6, 7.6], [6.2, 5.5], [7.2, 3.0], [8.5, 1.2], [10, 0.3], [11.5, 0],
];
const xs = ANCHORS.map(a => a[0]), ys = ANCHORS.map(a => a[1]);
const deltas = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
const tangents = ys.map((_, i) => {
  if (i === 0 || i === ys.length - 1) return 0;
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
  const relief = fbm(x * 0.075 + 11, z * 0.075 - 5, { noise: noiseA, octaves: 3 });
  const rim = 0.55 * smooth(11, 18, Math.max(Math.abs(x), Math.abs(z)));
  return WORLD.bed - 0.05 + relief * 0.55 + noiseC(x * 0.4, z * 0.4) * 0.05 + rim;
}

export function islandBump(x: number, z: number) {
  const dx = x - ISLAND.x, dz = z - ISLAND.z;
  let r = Math.hypot(dx / 1.06, dz / 0.94) * (1 + 0.07 * noiseB(dx * 0.11 + 3, dz * 0.11 - 1));
  r += 0.55 * fbm(dx * 0.16, dz * 0.16, { noise: noiseC, octaves: 3 });
  const dunes = noiseA(x * 0.22 + 4, z * 0.22) * 0.32 * smooth(5.2, 1.5, r) + noiseC(x * 0.6, z * 0.6) * 0.08 * smooth(6.5, 2.0, r);
  const under = noiseB(x * 0.35 + 8, z * 0.35) * 0.18 * smooth(11, 7, r) * smooth(4.5, 6.5, r);
  return profile(Math.max(0, r)) + (r < 11.5 ? dunes + under : 0);
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
