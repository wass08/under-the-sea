import { createNoise2D as simplex } from 'simplex-noise';
import { random } from './random';
export type Noise2D = (x: number, y: number) => number;
export type FractalOptions = { octaves?: number; lacunarity?: number; gain?: number; noise?: Noise2D };
/** Seeded simplex field; pass it to the fractal helpers to share one landscape. */
export function createNoise2D(seed: number): Noise2D { return simplex(random(seed)); }
const defaultNoise = createNoise2D(1);
function fractal(x: number, y: number, options: FractalOptions, ridge: boolean) {
  const { octaves = 5, lacunarity = 2, gain = 0.5, noise = defaultNoise } = options;
  let sum = 0, weight = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise(x, y); sum += (ridge ? 1 - Math.abs(n) : n) * weight;
    total += weight; weight *= gain; x *= lacunarity; y *= lacunarity;
  }
  return sum / total;
}
/** Normalized fractional Brownian motion of simplex octaves. */
export function fbm(x: number, y: number, options: FractalOptions = {}) { return fractal(x, y, options, false); }
/** fBm of 1 − |noise|: creases become mountain ridges. */
export function ridged(x: number, y: number, options: FractalOptions = {}) { return fractal(x, y, options, true); }
export type HeightParams = FractalOptions & { amplitude?: number; frequency?: number; power?: number };
/** Blend broad fBm landforms with ridged detail, then flatten valleys with a power curve. */
export function terrainHeight(x: number, y: number, params: HeightParams = {}) {
  const { amplitude = 4, frequency = 0.14, power = 2.7 } = params;
  x *= frequency; y *= frequency;
  const broad = fbm(x, y, { ...params, octaves: 3, gain: 0.42 }) * 0.5 + 0.5;
  const ridge = ridged(x * 0.8 + 9, y * 0.8 - 4, { ...params, octaves: 3, gain: 0.3 });
  const shape = Math.max(0, Math.min(1, (broad * 0.82 + ridge * 0.18 - 0.29) / 0.48));
  return amplitude * Math.pow(shape, power);
}
