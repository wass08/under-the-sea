import { WORLD } from '../config';
import { createNoise2D, fbm } from '../lib/noise';

/** Open-sea height field (no island): sandy floor, a few reef mounds, shared by the terrain mesh, fish and water shaders. */
const noiseA = createNoise2D(7), noiseB = createNoise2D(23), noiseC = createNoise2D(91);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Reef mounds (x, z, radius, height): away from the basin and the boat, framing the open water. */
export const REEFS = [
  // inner ring (around the basin)
  [-9.5, -8.5, 5.2, 2.6], [10.5, -10, 4.2, 1.9], [-12.5, 9.5, 3.6, 1.5], [12.5, 8, 3.0, 1.1], [1, -14, 3.4, 1.4],
  // outer ring (the doubled area): bigger, scattered mounds that fade into the fog
  [-24, -20, 6.5, 3.0], [22, -24, 5.5, 2.4], [-27, 14, 6.0, 2.2], [26, 18, 5.0, 2.6], [3, -29, 5.8, 2.0],
  [-7, 26, 4.8, 1.8], [16, 28, 4.4, 1.6], [30, -4, 5.2, 2.2], [-30, -2, 4.6, 1.9], [-17, -30, 4.0, 1.5],
] as const;

export function seabedHeight(x: number, z: number) {
  const relief = fbm(x * 0.075 + 11, z * 0.075 - 5, { noise: noiseA, octaves: 3 });
  const rim = 0.7 * smooth(WORLD.half * 0.55, WORLD.half, Math.max(Math.abs(x), Math.abs(z)));
  // A gentle bowl under the basin so the school has the most water where it mills.
  const bowl = -0.45 * (1 - smooth(3, 12, Math.hypot(x, z)));
  let reef = 0;
  for (const [rx, rz, r, h] of REEFS) {
    const d = Math.hypot(x - rx, z - rz) / r;
    const lumps = 1 + 0.35 * noiseB(x * 0.35 + rx, z * 0.35 + rz);
    reef = Math.max(reef, h * lumps * Math.pow(1 - smooth(0, 1, d), 1.6));
  }
  return WORLD.bed - 0.05 + relief * 0.55 + noiseC(x * 0.4, z * 0.4) * 0.05 + rim + bowl + reef;
}

export function terrainHeight(x: number, z: number) {
  return seabedHeight(x, z);
}

export function sampleGrid(resolution: number) {
  const heights = new Float32Array(resolution * resolution), size = WORLD.half * 2;
  for (let iz = 0; iz < resolution; iz++) for (let ix = 0; ix < resolution; ix++) {
    heights[iz * resolution + ix] = terrainHeight(-WORLD.half + (ix + 0.5) / resolution * size, -WORLD.half + (iz + 0.5) / resolution * size);
  }
  return heights;
}
