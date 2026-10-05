import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { createNoise4D } from 'simplex-noise';
import { hullAxis, hullMask } from '../lib/ocean';
import { random } from '../lib/random';
import { simTime, sunDirection } from '../state';

// Moonlight bends toward the vertical on entering water (Snell's law, n = 1.333).
const airSun = sunDirection.negate();
export const waterSun = vec3(airSun.x.div(1.333), float(1).sub(airSun.xz.dot(airSun.xz).div(1.333 * 1.333)).sqrt(), airSun.z.div(1.333));

/** Seamless seeded aperture fields. A torus embedding avoids texture seams; the
 * 96-unit period is much wider than the diorama. Baking keeps volume marches cheap. */
const size = 256, data = new Uint8Array(size * size * 4), raw = new Float32Array(data.length);
const fields = [113, 251, 419, 677].map(seed => createNoise4D(random(seed)));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const a = x / size * Math.PI * 2, b = y / size * Math.PI * 2;
  for (let c = 0; c < 4; c++) {
    const radius = [1.8, 8, 2.7, 1.6][c], noise = fields[c];
    const sample = (r: number) => noise(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r, Math.sin(b) * r);
    const value = sample(radius) * 0.72 + sample(radius * 2.13) * 0.2 + sample(radius * 4.37) * 0.08;
    raw[(y * size + x) * 4 + c] = Math.max(0, Math.min(1, value * 0.5 + 0.5));
  }
}
const ease = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let c = 0; c < 4; c++) {
  const bins = new Uint32Array(512), cumulative = new Float32Array(512);
  for (let i = c; i < raw.length; i += 4) bins[Math.min(511, Math.floor(raw[i] * 512))]++;
  let total = 0;
  for (let i = 0; i < bins.length; i++) { total += bins[i]; cumulative[i] = total / (size * size); }
  for (let i = c; i < raw.length; i += 4) {
    const rank = cumulative[Math.min(511, Math.floor(raw[i] * 512))];
    // Threshold BEFORE generating mips: deep blur widens a real opening instead
    // of blurring raw noise toward 0.5 and lighting every previously dark gap.
    const value = c === 0 ? ease(0.48, 0.82, rank) : c === 1 ? ease(0.45, 0.8, rank) : raw[i];
    data[i] = Math.round(value * 255);
  }
}
const aperture = new DataTexture(data, size, size);
aperture.wrapS = aperture.wrapT = RepeatWrapping;
aperture.magFilter = LinearFilter; aperture.minFilter = LinearMipmapLinearFilter;
aperture.generateMipmaps = true; aperture.needsUpdate = true;

/** Moving openings in the surface lighting, projected through a genuine volume.
 * Independent currents and low-frequency warping make rays divide, broaden and
 * fade instead of translating a fixed set of cone silhouettes. */
export function surfaceShaft(p: Node<'vec2'>, depth: Node<'float'> = float(0)) {
  const baseUV = p.div(96).add(0.5);
  // Sample the displacement at a fixed mip so changing depth cannot bend the
  // shaft axis. Only the narrower opening mask softens as light travels deeper.
  const broad = texture(aperture, baseUV.add(vec2(simTime.mul(0.0031), simTime.mul(-0.0017)))).level(float(0));
  const warp = broad.ba.sub(0.5).mul(depth.max(0).min(12).mul(0.0007).add(0.07));
  const fine = texture(aperture, baseUV.add(warp).add(vec2(simTime.mul(-0.0018), simTime.mul(0.0024)))).level(depth.max(0).mul(0.06).min(1));
  const opening = broad.r.mul(fine.g);
  const delta = p.sub(hullMask.xy);
  const local = vec2(delta.dot(hullAxis.xy), delta.dot(hullAxis.zw));
  const hull = local.div(hullMask.zw.max(vec2(0.001))).length();
  const shadow = smoothstep(float(0.85).sub(depth.max(0).mul(0.04)), float(1.15).add(depth.max(0).mul(0.09)), hull);
  // Keep the integrated energy restrained: bright gaps should reveal clear blue
  // between rays rather than adding an opaque white cloud over the whole scene.
  return opening.mul(shadow).mul(0.42);
}

/** Thin cloud veils drifting across the reflected night sky (the page backdrop is CSS). */
export function skyCloud(dir: Node<'vec3'>) {
  const cloudUV = dir.xz.div(dir.y.max(0).add(0.55)).mul(0.075).add(0.5)
    .add(vec2(simTime.mul(0.0005), simTime.mul(-0.0003)));
  const n = texture(aperture, cloudUV).level(float(0));
  return smoothstep(0.42, 0.62, n.a).mul(smoothstep(0.0, 0.16, dir.y));
}
