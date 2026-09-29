import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { attribute, color, float, hash, floor, mix, mx_noise_float, normalWorldGeometry, positionWorld, smoothstep, vec2, vec3, vertexColor, sin } from 'three/tsl';
import { worley } from '../lib/worley';
import { causticAt, causticStrength, sunVisibilityRef, toSun, waterDepthAt, waterTransmittance } from './lighting';

/**
 * Underwater shading for opaque terrain-like surfaces: depth tint on the albedo and sun caustics that
 * follow the sun through the water surface. Returns the adjusted albedo and the caustic emissive.
 */
export function underwaterShading(albedo: Node<'vec3'>, normal: Node<'vec3'>, gain = 2.6) {
  const depth = waterDepthAt(positionWorld.y);
  const submerged = smoothstep(-0.03, 0.22, depth);
  const tinted = albedo.mul(mix(vec3(1), waterTransmittance(depth).mul(vec3(0.9, 1.0, 1.0)), submerged.mul(0.92)));
  // Damp sand just above the waterline.
  const wet = float(1).sub(smoothstep(-0.4, -0.05, depth).mul(float(1).sub(submerged)).mul(0.22));
  const light = normal.dot(toSun).max(0);
  const caustic = causticAt(positionWorld, depth).mul(vec3(0.75, 1.0, 1.05));
  const emissive = tinted.mul(caustic).mul(light).mul(sunVisibilityRef.node).mul(submerged).mul(depth.mul(-0.12).exp()).mul(causticStrength).mul(gain);
  return { albedo: tinted.mul(wet), emissive };
}

export function createTerrainMaterial() {
  const material = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0 });
  const base = vertexColor().rgb;
  // Sand ripples: faint lines warped by noise, only visible on flat, light-coloured (sandy) ground.
  const warp = mx_noise_float(vec3(positionWorld.xz.mul(0.45), 0)).mul(2.2);
  const ripple = sin(positionWorld.x.mul(7.5).add(positionWorld.z.mul(3.2)).add(warp.mul(3))).mul(0.5).add(0.5);
  const grain = mx_noise_float(positionWorld.mul(26)).mul(0.05);
  const sandy = smoothstep(0.55, 0.75, base.r.add(base.g).mul(0.5)).mul(normalWorldGeometry.y.smoothstep(0.85, 0.97));
  const varied = base.mul(float(1).add(ripple.sub(0.5).mul(0.11).mul(sandy)).add(grain));
  const shaded = underwaterShading(varied, normalWorldGeometry);
  material.colorNode = shaded.albedo;
  material.emissiveNode = shaded.emissive;
  return material;
}

const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;
/** Earth strata on the cut faces of the slab, the craggy underbelly, pebbles. */
export function createSlabMaterial() {
  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  const n = normalWorldGeometry, p = positionWorld;
  const belly = n.y.abs().greaterThan(0.5).select(float(1), float(0));
  const along = n.x.abs().greaterThan(n.z.abs()).select(p.z, p.x);
  const uv2 = belly.greaterThan(0.5).select(vec2(p.x.add(p.z.mul(0.37)), p.z), vec2(along, p.y));
  const warp = mx_noise_float(p.mul(vec3(0.75, 1.5, 0.75))).mul(0.16).add(mx_noise_float(p.mul(vec3(2.6, 4.2, 2.6))).mul(0.045));
  const yy = p.y.add(warp);
  const step = (edge: number, width = 0.025) => smoothstep(edge - width, edge + width, yy);
  let col: Node<'vec3'> = c('#3a373e');
  col = mix(col, c('#514d56'), step(-1.5));
  col = mix(col, c('#6b645f'), step(-0.85));
  col = mix(col, c('#7d6a5b'), step(-0.3));
  col = mix(col, c('#a4603f'), step(0.10));
  col = mix(col, c('#d2a774'), step(0.33));
  col = mix(col, c('#eddcb1'), step(0.52));
  col = mix(col, c('#84573b'), step(0.65));
  col = mix(col, c('#c6935b'), step(0.95));
  // Above the seabed strata (cross-section of the island): stacked rock layers.
  const layer = floor(yy.mul(3.1));
  const pick = hash(layer);
  const rock = mix(mix(c('#8c857a'), c('#94704f'), smoothstep(0.25, 0.5, pick)), mix(c('#c9a577'), c('#5f5850'), smoothstep(0.5, 0.75, pick)), smoothstep(0.4, 0.6, pick));
  col = mix(col, rock, step(1.2, 0.03));
  // Band brightness variation.
  const bandVariation = hash(floor(yy.mul(9.0))).mul(0.24).add(0.88);
  col = col.mul(bandVariation);
  // Pebbles and grit.
  const w = worley(uv2.mul(vec2(2.4, 2.4)), float(0));
  const cluster = smoothstep(-0.1, 0.35, mx_noise_float(vec3(uv2.mul(0.55), 3.3)));
  const pebble = smoothstep(0.30, 0.22, w.f1).mul(cluster);
  const pebbleShade = float(1).sub(w.f1.mul(2.2)).max(0).mul(0.5).add(0.62);
  const pebbleColor = mix(c('#8f8a80'), c('#b19a7c'), smoothstep(-0.2, 0.4, mx_noise_float(vec3(uv2.mul(1.6), 1.7)))).mul(pebbleShade);
  col = mix(col, pebbleColor, pebble.mul(0.85));
  col = col.mul(mx_noise_float(p.mul(38)).mul(0.07).add(1));
  // Sandy cap right under the terrain top.
  const topY = attribute('topY', 'float');
  const below = topY.sub(p.y);
  const cap = smoothstep(0.24, 0.16, below.add(mx_noise_float(vec3(along.mul(3), 0, 1)).mul(0.05))).mul(float(1).sub(belly));
  col = mix(col, c('#ead6a4').mul(bandVariation), cap);
  // Darken the bottom of the underbelly a touch, tint toward cool grey in cavities.
  material.colorNode = col.mul(mix(float(1), smoothstep(-2.6, 0.0, p.y).mul(0.55).add(0.45), belly));
  return material;
}
