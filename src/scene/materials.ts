import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, attribute, color, cos, float, floor, hash, mix, mx_noise_float, normalize, normalWorldGeometry, positionWorld, sin, smoothstep, transformNormalToView, vec2, vec3 } from 'three/tsl';
import { worley } from '../lib/worley';
import { causticAt, causticStrength, sunVisibilityRef, toSun, waterDepthAt, waterTransmittance } from './lighting';

/**
 * Underwater shading for opaque terrain-like surfaces: depth tint on the albedo and sun caustics that
 * follow the sun through the water surface. Returns the adjusted albedo and the caustic emissive.
 */
export function underwaterShading(albedo: Node<'vec3'>, normal: Node<'vec3'>, gain = 8.0, withCaustics = true) {
  const depth = waterDepthAt(positionWorld.y);
  const submerged = smoothstep(-0.03, 0.22, depth);
  const tinted = albedo.mul(mix(vec3(1), waterTransmittance(depth).mul(vec3(0.9, 1.0, 1.0)), submerged.mul(0.92)));
  // Damp sand just above the waterline.
  const wet = float(1).sub(smoothstep(-0.5, -0.05, depth).mul(float(1).sub(submerged)).mul(0.24));
  const light = normal.dot(toSun).max(0);
  if (!withCaustics) return { albedo: tinted.mul(wet), emissive: vec3(0) as unknown as Node<'vec3'> };
  const gate = light.mul(sunVisibilityRef.node).mul(submerged);
  // Only pay for the Worley field where sunlight actually reaches the underwater surface.
  const emissive = Fn(() => {
    const out = vec3(0).toVar();
    If(gate.greaterThan(0.002), () => {
      const caustic = causticAt(positionWorld, depth).mul(vec3(0.75, 1.0, 1.05));
      out.assign(tinted.mul(caustic).mul(gate).mul(depth.mul(-0.05).exp()).mul(causticStrength).mul(gain));
    });
    return out;
  })();
  return { albedo: tinted.mul(wet), emissive };
}

const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;

/** Smooth sand: analytic normals from the mesh + shader-level ripples, grain and colour variation. */
export function createTerrainMaterial() {
  const material = new MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
  const p = positionWorld, n0 = normalWorldGeometry;
  const depth = waterDepthAt(p.y);
  const flat = smoothstep(0.72, 0.93, n0.y);
  // Sand ripples: two warped wave trains + fine grain, as a height gradient subtracted from the normal.
  const warp = mx_noise_float(vec3(p.xz.mul(0.07), 1.3)).mul(2.6);
  const dirA = vec2(0.83, 0.56), dirB = vec2(-0.42, 0.91);
  const kA = 2 * Math.PI / 1.05, kB = 2 * Math.PI / 0.42;
  const phaseA = p.xz.dot(dirA).mul(kA).add(warp.mul(kA * 0.55)), phaseB = p.xz.dot(dirB).mul(kB).add(warp.mul(kB * 0.35)).add(mx_noise_float(vec3(p.xz.mul(0.35), 4.0)).mul(2.0));
  const gradA = dirA.mul(cos(phaseA).mul(0.036 * kA)), gradB = dirB.mul(cos(phaseB).mul(0.011 * kB));
  const grainN = vec3(mx_noise_float(vec3(p.xz.mul(9), 2.0)), 0, mx_noise_float(vec3(p.xz.mul(9), 7.0))).mul(0.06);
  const drySoften = mix(float(1), float(0.55), smoothstep(0.1, -0.4, depth));
  const bump = vec3(gradA.x.add(gradB.x), 0, gradA.y.add(gradB.y)).mul(drySoften).add(grainN);
  const nWorld = normalize(n0.sub(bump.mul(flat)));
  material.normalNode = transformNormalToView(nWorld);

  // Colour: golden underwater sand, paler dry beach, darker damp band; broad patches and fine speckle.
  const patch = mx_noise_float(vec3(p.xz.mul(0.12), 3.1)).mul(0.5).add(0.5);
  const speck = mx_noise_float(vec3(p.xz.mul(26), 5.0)).mul(0.5).add(0.5);
  const rippleShade = sin(phaseA).mul(0.5).add(0.5);
  let sand = mix(c('#dcb97c'), c('#c69f63'), smoothstep(0.3, 0.75, patch));
  sand = mix(sand, c('#e9d3a2'), smoothstep(0.7, 0.95, mx_noise_float(vec3(p.xz.mul(0.31), 9.0)).mul(0.5).add(0.5)).mul(0.6));
  sand = sand.mul(float(0.94).add(speck.mul(0.12))).mul(float(0.95).add(rippleShade.mul(0.1).mul(flat)));
  const dryness = smoothstep(0.0, -0.5, depth);
  sand = mix(sand, c('#f0dfb4').mul(float(0.95).add(speck.mul(0.1))), dryness);
  const shaded = underwaterShading(sand, nWorld);
  material.colorNode = shaded.albedo;
  material.emissiveNode = shaded.emissive;
  return material;
}

/** Earth strata on the cut faces of the slab; the bottom is one flat dark layer. */
export function createSlabMaterial() {
  const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const n = normalWorldGeometry, p = positionWorld;
  const belly = n.y.abs().greaterThan(0.5).select(float(1), float(0));
  const along = n.x.abs().greaterThan(n.z.abs()).select(p.z, p.x);
  const uv2 = belly.greaterThan(0.5).select(vec2(p.x, p.z), vec2(along, p.y));
  const warp = mx_noise_float(vec3(along.mul(0.16), p.y.mul(1.5), 0.5)).mul(0.16).add(mx_noise_float(vec3(along.mul(0.6), p.y.mul(4.2), 2.0)).mul(0.045));
  const yy = p.y.mul(1.15).add(warp);
  const step = (edge: number, width = 0.03) => smoothstep(edge - width, edge + width, yy);
  let col: Node<'vec3'> = c('#3a373e');
  col = mix(col, c('#5a5259'), step(0.06));
  col = mix(col, c('#7d6a5b'), step(0.2));
  col = mix(col, c('#a4603f'), step(0.42));
  col = mix(col, c('#d2a774'), step(0.66));
  col = mix(col, c('#eddcb1'), step(0.86));
  col = mix(col, c('#84573b'), step(1.02));
  col = mix(col, c('#c6935b'), step(1.3));
  col = mix(col, c('#d9bd85'), step(1.62));
  const bandVariation = hash(floor(yy.mul(11.0))).mul(0.22).add(0.89);
  col = col.mul(bandVariation);
  const w = worley(uv2.mul(vec2(3.4, 3.4)), float(0));
  const cluster = smoothstep(-0.1, 0.35, mx_noise_float(vec3(uv2.mul(0.25), 3.3)));
  const pebble = smoothstep(0.30, 0.22, w.f1).mul(cluster);
  const pebbleShade = float(1).sub(w.f1.mul(2.2)).max(0).mul(0.5).add(0.62);
  const pebbleColor = mix(c('#6d6860'), c('#8f7a5e'), smoothstep(-0.2, 0.4, mx_noise_float(vec3(uv2.mul(0.9), 1.7)))).mul(pebbleShade);
  col = mix(col, pebbleColor, pebble.mul(0.55));
  col = col.mul(mx_noise_float(p.mul(20)).mul(0.06).add(1));
  const topY = attribute('topY', 'float');
  const below = topY.sub(p.y);
  const cap = smoothstep(0.34, 0.22, below.add(mx_noise_float(vec3(along.mul(1.6), 0, 1)).mul(0.06))).mul(float(1).sub(belly));
  col = mix(col, c('#ead6a4').mul(bandVariation), cap);
  material.colorNode = mix(col, c('#3a373e').mul(mx_noise_float(p.mul(1.4)).mul(0.15).add(0.9)), belly);
  return material;
}
