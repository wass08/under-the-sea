import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, attribute, cameraPosition, color, cos, float, floor, hash, mix, mx_noise_float, normalize, normalWorldGeometry, positionWorld, sin, smoothstep, texture, transformNormalToView, uniform, vec2, vec3 } from 'three/tsl';
import { worley } from '../lib/worley';
import { createSandTexture, SAND_TILE } from './sandtex';
import { OFF, moonOnly, sunVisibilityRef, toSun, sunRadianceRef, waterDepthAt, waterTransmittance } from './lighting';
import { lanternLight, moonCaustic } from './night';
import { waterSun } from './rays';

/**
 * Night shading for opaque underwater surfaces: depth tint on the albedo, then the lights the PBR pipeline does not
 * see down here (the material's lightsNode is moon-only): the boat lantern and the global moon caustics. Returns the adjusted albedo and the emissive that carries that light.
 */
export function underwaterShading(albedo: Node<'vec3'>, normal: Node<'vec3'>, gain = 6.0, withCaustics = true, p: Node<'vec3'> = positionWorld, visibility: Node<'float'> = sunVisibilityRef.node) {
  void visibility;
  const depth = waterDepthAt(p.y);
  const submerged = smoothstep(-0.03, 0.22, depth);
  // Lighter depth tint than by day: the lantern's own path is absorbed in lanternLight(), so the sand under it stays golden.
  const tinted = albedo.mul(mix(vec3(1), waterTransmittance(depth).mul(vec3(0.9, 1.0, 1.0)), submerged.mul(0.45)));
  // Damp surfaces just above the waterline.
  const wet = float(1).sub(smoothstep(-0.5, -0.05, depth).mul(float(1).sub(submerged)).mul(0.24));
  const k = gain / 6;
  const emissive = Fn(() => {
    const light = lanternLight(p, normal).toVar();
    if (withCaustics && !OFF.has('caustics')) {
      // Global moon caustics (not the lantern: they would ride along with the boat). Only near enough to be seen.
      // Lit by the refracted moonlight's direction (it arrives slanted), with a little wrap for soft relief.
      const up = normal.dot(waterSun).mul(0.8).add(0.2).max(0);
      If(submerged.greaterThan(0.002).and(p.sub(cameraPosition).length().lessThan(70)), () => {
        light.addAssign(moonCaustic(p, depth).mul(submerged).mul(up));
      });
    }
    return tinted.mul(light).mul(k);
  })();
  return { albedo: tinted.mul(wet), emissive };
}

export const sandLook = { brightness: uniform(0.12) };

const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;

/** One sand appearance for the visible terrain and the optical continuation beyond a cut face. */
function sandShading(p: Node<'vec3'>, n0: Node<'vec3'>, visibility: Node<'float'>, footprint?: Node<'float'>) {
  const depth = waterDepthAt(p.y);
  const flat = smoothstep(0.35, 0.85, n0.y).mul(0.45).add(smoothstep(0.72, 0.93, n0.y).mul(0.55));
  const { texture: sandMap, maxSlope } = createSandTexture();
  const sample = (uv: Node<'vec2'>, scale: number) => {
    const tex = texture(sandMap, uv);
    // Virtual sand executes only in missing-capture fragments. Explicit mip levels avoid
    // implicit derivatives inside divergent control flow and match the real floor's footprint.
    return footprint ? tex.level(footprint.mul(512 / SAND_TILE * scale).max(1).log2()) : tex;
  };
  const t1 = sample(p.xz.div(SAND_TILE), 1), t2 = sample(p.xz.div(SAND_TILE).mul(3.7).add(0.31), 3.7), t3 = sample(p.xz.div(SAND_TILE * 4.3).add(0.6), 1 / 4.3);
  const slope = vec2(t1.r.sub(0.5), t1.g.sub(0.5)).add(vec2(t2.r.sub(0.5), t2.g.sub(0.5)).mul(0.55)).mul(2 * maxSlope);
  const drySoften = mix(float(1), float(0.55), smoothstep(0.1, -0.4, depth));
  const nWorld = normalize(n0.sub(vec3(slope.x, 0, slope.y).mul(drySoften).mul(flat)));

  // Colour: golden underwater sand, paler dry beach, darker damp band; broad patches and fine speckle.
  const patch = t3.b.mul(0.6).add(t1.b.mul(0.4)), speck = t1.a.add(t2.a.mul(0.6)).mul(0.62);
  let sand = mix(c('#dcb97c'), c('#c69f63'), smoothstep(0.3, 0.75, patch));
  sand = mix(sand, c('#e9d3a2'), smoothstep(0.55, 0.9, t3.b.mul(0.5).add(t2.b.mul(0.5))).mul(0.55));
  sand = sand.mul(float(0.94).add(speck.mul(0.12))).mul(float(0.94).add(t1.b.mul(0.14).mul(flat)));
  sand = sand.mul(mix(float(1), sandLook.brightness, smoothstep(0.3, 3, depth)));
  // The submerged sand albedo is deliberately dark; enough direct caustic light
  // must survive that tint for the connected sunlight pattern to remain readable.
  const shaded = underwaterShading(sand, nWorld, 6.0, true, p, visibility);
  return { ...shaded, nWorld };
}

/** Lit floor radiance for missing refraction pixels, with the same albedo, normals, tint and
 * caustic emission as the terrain. No extra visible geometry is placed outside the diorama. */
export function terrainRefractionRadiance(p: Node<'vec3'>, n0: Node<'vec3'>, footprint: Node<'float'>) {
  const shaded = sandShading(p, n0, float(1), footprint);
  const diffuse = sunRadianceRef.node.mul(shaded.nWorld.dot(toSun).max(0).div(Math.PI)).add(vec3(0.018, 0.03, 0.06));
  return shaded.albedo.mul(diffuse).add(shaded.emissive);
}

/** Smooth sand: analytic normals from the mesh + baked ripple/grain texture, colour patches and speckle. */
export function createTerrainMaterial() {
  const material = new MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
  material.lightsNode = moonOnly();
  const shaded = sandShading(positionWorld, normalWorldGeometry, sunVisibilityRef.node);
  material.normalNode = transformNormalToView(shaded.nWorld);
  material.colorNode = shaded.albedo;
  material.emissiveNode = shaded.emissive;
  return material;
}
