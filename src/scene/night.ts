import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, RGBAFormat, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, color, dot, exp, float, floor, fract, hash, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import { lanternPosition, lanternPower, waterLevel } from '../state';
import { causticAtSurface, causticStrength, toSun } from './lighting';
import { random } from '../lib/random';
import { surfaceShaft, waterSun } from './rays';

/**
 * Night lighting shared by every underwater material: the moon (the directional "sun" light, cool and dim), the
 * boat's paper lantern (a warm point source above the water) and the global moon caustics.
 */

/** Lantern colour (linear) and gains, tweakable from the World panel. */
export const lanternColor = uniform(new Vector3(1.0, 0.5, 0.17));
export const lanternGain = uniform(9);
/** Distance (world units) at which the lantern's light has halved; a softened inverse square. */
export const lanternReach = uniform(6);

/** Shared fish/post medium prevents distant schools from becoming a brighter fog band. */
export const waterMedium = {
  near: uniform(new Vector3(0.0007, 0.0035, 0.0095)),
  deep: uniform(new Vector3(0.0002, 0.0008, 0.0028)),
  sigma: uniform(new Vector3(0.06, 0.028, 0.016)),
};

const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;

/**
 * Lantern irradiance (already coloured) reaching point p with normal n. Below the surface the light travels a slanted
 * path through the water and is tinted by it; `wrap` softens the terminator for thin or double-sided geometry.
 */
export function lanternLight(p: Node<'vec3'>, n: Node<'vec3'>, wrap = 0.2) {
  const d = lanternPosition.sub(p), dist = d.length().max(0.05), l = d.div(dist);
  const ndl = dot(n, l).add(wrap).div(1 + wrap).max(0);
  const below = waterLevel.sub(p.y).max(0);
  const drop = lanternPosition.y.sub(p.y).max(0.5);
  const waterPath = below.mul(dist).div(drop);
  const falloff = float(1).div(dist.div(lanternReach).pow(2).add(1));
  // Below the surface most light arrives steeply (Fresnel losses grow at grazing entry), so the lit pool and its
  // caustics gather under the lamp instead of washing the whole floor.
  const cone = mix(float(1), smoothstep(0.25, 0.92, l.y), smoothstep(0.0, 0.4, below));
  // Clear tropical water: absorption mild enough that the lamp stays amber on the sand below.
  const absorb = exp(vec3(0.07, 0.04, 0.032).mul(waterPath).negate());
  return lanternColor.mul(lanternPower).mul(lanternGain).mul(falloff).mul(ndl).mul(cone).mul(absorb) as unknown as Node<'vec3'>;
}

/** Moon caustics strength (tunable): global, aligned with the moon shafts, independent of the boat. */
export const moonCausticGain = uniform(0.9);

/**
 * Global caustics from the moon, faked like the shafts: trace p back along the refracted moonlight to the surface,
 * evaluate the shared Worley caustic network there, and let the same moving surface openings that carve the moon
 * shafts (surfaceShaft) brighten or starve it, so caustic patches sit where the rays land. Returns coloured light.
 */
export function moonCaustic(p: Node<'vec3'>, depth: Node<'float'>) {
  const s = p.xz.add(waterSun.xz.mul(depth.max(0).div(waterSun.y.max(0.2))));
  const caustic = causticAtSurface(s, depth).mul(causticStrength);
  const beams = surfaceShaft(s, depth).mul(2.4).add(0.4);
  return vec3(0.5, 0.68, 1.0).mul(caustic).mul(beams).mul(moonCausticGain) as unknown as Node<'vec3'>;
}

// ---- Night sky -----------------------------------------------------------------------------------------------
const zenith = c('#02040c'), upper = c('#060c1f'), horizon = c('#14213f'), below = c('#03050b');
const MOON_DISC = Math.cos(0.032), MOON_EDGE = Math.cos(0.026);

/** Night sky radiance for a normalized world direction: a deep blue dome, the moon with its halo, sparse stars. */
export const nightSky = Fn(([dir]: [Node<'vec3'>]) => {
  const y = dir.y;
  const dome = mix(horizon, mix(upper, zenith, smoothstep(0.25, 0.9, y)), smoothstep(0.0, 0.35, y).pow(0.7));
  const sky = mix(below, dome, smoothstep(-0.12, 0.02, y));
  const m = dot(dir, toSun).max(0);
  const disc = smoothstep(MOON_DISC, MOON_EDGE, m);
  const halo = m.pow(220).mul(0.55).add(m.pow(18).mul(0.07)).add(m.pow(4).mul(0.012));
  const moon = vec3(1.0, 0.96, 0.88).mul(disc.mul(9)).add(vec3(0.55, 0.68, 1.0).mul(halo));
  // Stars: a jittered point per direction cell, only above the horizon haze.
  const q = dir.mul(150), cell = floor(q), h = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)));
  const local = fract(q).sub(0.5).sub(vec3(hash(cell.x.add(7)), hash(cell.y.add(31)), hash(cell.z.add(59))).sub(0.5).mul(0.6));
  const star = smoothstep(0.16, 0.0, local.length()).mul(smoothstep(0.986, 0.999, h)).mul(smoothstep(0.08, 0.3, y));
  return sky.add(moon).add(vec3(0.8, 0.85, 1).mul(star.mul(h.sub(0.986).mul(140).add(0.6))));
});

/**
 * Procedural equirectangular night HDRI (linear float): the same dome, moon and stars as nightSky, used as
 * scene.environment so metallic fish flanks, the boat and every PBR surface get a cool blue fill from above and a
 * moon highlight. Mapping matches three's equirectUV (u = atan(z, x), v = asin(y)).
 */
export function createNightEnvironment(moonDir: Vector3, width = 1024, height = 512) {
  const data = new Float32Array(width * height * 4), rng = random(4242);
  const lin = (hex: string) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => Math.pow(x / 255, 2.2)); };
  const Z = lin('#02040c'), U = lin('#060c1f'), H = lin('#14213f'), B = lin('#03050b');
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mixv = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const m = moonDir.clone().normalize();
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI, cy = Math.sin(lat), cr = Math.cos(lat);
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2, x = Math.cos(phi) * cr, z = Math.sin(phi) * cr;
      const dome = mixv(H, mixv(U, Z, ss(0.25, 0.9, cy)), Math.pow(ss(0, 0.35, cy), 0.7));
      const sky = mixv(B, dome, ss(-0.12, 0.02, cy));
      const k = Math.max(0, x * m.x + cy * m.y + z * m.z);
      const disc = ss(MOON_DISC, MOON_EDGE, k), halo = Math.pow(k, 220) * 0.55 + Math.pow(k, 18) * 0.07 + Math.pow(k, 4) * 0.012;
      const o = (j * width + i) * 4;
      data[o] = sky[0] + disc * 9 + halo * 0.55;
      data[o + 1] = sky[1] + disc * 8.6 + halo * 0.68;
      data[o + 2] = sky[2] + disc * 7.9 + halo * 1.0;
      data[o + 3] = 1;
    }
  }
  // Stars: single bright texels (PMREM turns them into a faint, even sparkle on glossy surfaces).
  for (let s = 0; s < 1400; s++) {
    const i = Math.floor(rng() * width), j = Math.floor(height * 0.5 + rng() * height * 0.5);
    const lat = ((j + 0.5) / height - 0.5) * Math.PI;
    if (Math.sin(lat) < 0.1) continue;
    const b = 0.4 + Math.pow(rng(), 6) * 6, o = (j * width + i) * 4;
    data[o] += b * 0.85; data[o + 1] += b * 0.9; data[o + 2] += b;
  }
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
