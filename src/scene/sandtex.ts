import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { random } from '../lib/random';

/** World size (units) covered by one repeat of the sand texture. */
export const SAND_TILE = 12;

/**
 * Baked tiling sand detail, generated once at load: R,G = ripple/grain surface slope (x,z), B = albedo
 * variation, A = fine speckle. Replaces per-pixel noise in the terrain shader.
 */
export function createSandTexture(size = 512) {
  const TAU = Math.PI * 2, rng = random(2024);
  const grain = new Float32Array(size * size);
  for (let i = 0; i < grain.length; i++) grain[i] = rng();
  // Blur the white noise (wrapped) so the grain has a soft, sandy size.
  const blur = (src: Float32Array, passes: number) => {
    let a: Float32Array = src, b: Float32Array = new Float32Array(src.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const xm = (x + size - 1) % size, xp = (x + 1) % size, ym = (y + size - 1) % size, yp = (y + 1) % size;
        b[y * size + x] = (a[y * size + x] * 4 + a[y * size + xm] + a[y * size + xp] + a[ym * size + x] + a[yp * size + x]) / 8;
      }
      [a, b] = [b, a];
    }
    return a;
  };
  const soft = blur(grain, 2), speck = blur(grain, 1);
  const data = new Uint8Array(size * size * 4), maxSlope = 0.6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    // Two warped ripple trains with integer wave vectors so the tile is seamless.
    const wa = 2.2 * Math.sin(TAU * (2 * u + v)) + 1.4 * Math.sin(TAU * (3 * u - 2 * v));
    const pa = TAU * (9 * u + 6 * v) + wa;
    const dpa_du = TAU * 9 + 2.2 * TAU * 2 * Math.cos(TAU * (2 * u + v)) + 1.4 * TAU * 3 * Math.cos(TAU * (3 * u - 2 * v));
    const dpa_dv = TAU * 6 + 2.2 * TAU * Math.cos(TAU * (2 * u + v)) - 1.4 * TAU * 2 * Math.cos(TAU * (3 * u - 2 * v));
    const wb = 1.8 * Math.sin(TAU * (u + 2 * v));
    const pb = TAU * (-5 * u + 11 * v) + wb;
    const dpb_du = -5 * TAU + 1.8 * TAU * Math.cos(TAU * (u + 2 * v)), dpb_dv = 11 * TAU + 1.8 * TAU * 2 * Math.cos(TAU * (u + 2 * v));
    const aA = 0.036, aB = 0.011;
    let sx = (aA * Math.cos(pa) * dpa_du + aB * Math.cos(pb) * dpb_du) / SAND_TILE;
    let sz = (aA * Math.cos(pa) * dpa_dv + aB * Math.cos(pb) * dpb_dv) / SAND_TILE;
    // Grain slope from the softened noise.
    const xm = (x + size - 1) % size, xp = (x + 1) % size, ym = (y + size - 1) % size, yp = (y + 1) % size;
    sx += (soft[y * size + xp] - soft[y * size + xm]) * 1.6; sz += (soft[yp * size + x] - soft[ym * size + x]) * 1.6;
    const patch = 0.5 + 0.22 * Math.sin(TAU * (u + 2 * v) + 1.3) + 0.16 * Math.sin(TAU * (3 * u - v) + 0.4) + 0.12 * Math.sin(TAU * (5 * u + 4 * v));
    const shade = Math.max(0, Math.min(1, patch * 0.8 + 0.1 + 0.1 * Math.sin(pa)));
    data[i * 4] = Math.max(0, Math.min(255, (0.5 + sx / (2 * maxSlope)) * 255));
    data[i * 4 + 1] = Math.max(0, Math.min(255, (0.5 + sz / (2 * maxSlope)) * 255));
    data[i * 4 + 2] = shade * 255;
    data[i * 4 + 3] = Math.max(0, Math.min(255, (speck[i] - 0.5) * 3.2 * 255 + 128));
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.anisotropy = 8;
  texture.needsUpdate = true;
  return { texture, maxSlope };
}
