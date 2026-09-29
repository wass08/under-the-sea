/* eslint-disable @typescript-eslint/no-explicit-any */
import { Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import * as TSL from 'three/tsl';
const {
  cameraPosition, clamp, cos, cross, dot, exp, faceDirection, float, floor, fract, hash, instanceIndex, length, max, min, mix, mod, normalize, positionWorld,
  select, sin, smoothstep, sqrt, step, storage, texture, transformNormalToView, uniform, uv, vec3, vec4, vertexIndex, attribute, pow, abs,
} = TSL as any;
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { simTime, sunDirection, waterLevel } from '../state';
import type { FishAsset, FishLod } from './geometry';
import { fishRand } from './sim';

/** Per-instance data the vertex stage needs (from sim buffers or from uniforms). */
export interface InstanceNodes {
  P: any; V: any; phase: any; size: any; flash: any; bank: any; hidden: any; fear: any; seed: any;
}

export const visuals = {
  /** 0..1: how strongly fish flanks glint in the sun. */
  sheen: uniform(1),
  causticsAmount: uniform(1),
  flashGain: uniform(1),
};
const causticParams = createCausticsUniforms();
causticParams.scaleA.value = 3.4; causticParams.intensity.value = 1.35; causticParams.sharpness.value = 14;

export function instanceFromSim(read: { pos: any; vel: any; aux: any }, seed: number): InstanceNodes {
  const i = instanceIndex, p = read.pos.element(i), v = read.vel.element(i), a = read.aux.element(i);
  return { P: p.xyz, V: v.xyz, phase: p.w, size: fishRand(i, seed, 12).mul(0.3).add(0.85), flash: a.x, bank: a.y, hidden: step(2.5, a.w), fear: v.w, seed: fishRand(i, seed, 13) };
}

function vatNodes(lod: FishLod, frames: number) {
  const attr = new StorageBufferAttribute(lod.vat, 4);
  return storage(attr, 'vec4', lod.vat.length / 4).toReadOnly();
}

/** Builds the vertex-stage world position + normal for one LOD. `scale` = world size / model length. */
function buildVertex(lod: FishLod, frames: number, inst: InstanceNodes, scale: number, inspect?: any, shape?: [number, number]) {
  const vat = vatNodes(lod, frames), V = lod.vertexCount;
  const ph = fract(inst.phase).mul(frames), f0 = floor(ph), a = fract(ph), f1 = mod(f0.add(1), frames);
  const vid = vertexIndex.toFloat();
  const i0 = f0.mul(V).add(vid).mul(2).toUint(), i1 = f1.mul(V).add(vid).mul(2).toUint();
  const p0 = mix(vat.element(i0).xyz, vat.element(i1).xyz, a);
  const p = shape ? vec3(p0.x.mul(shape[0]), p0.y, p0.z.mul(shape[1])) : p0;
  const n = mix(vat.element(i0.add(1)).xyz, vat.element(i1.add(1)).xyz, a);

  const speed = length(inst.V);
  let fwd = select(speed.greaterThan(0.001), inst.V.div(max(speed, 0.001)), vec3(1, 0, 0));
  if (inspect) fwd = normalize(mix(fwd, inspect, 0.85));
  const fy = clamp(fwd.y, -0.8, 0.8), fxz = fwd.xz.div(max(length(fwd.xz), 1e-4)).mul(sqrt(float(1).sub(fy.mul(fy))));
  const f = vec3(fxz.x, fy, fxz.y);
  const s = normalize(cross(f, vec3(0, 1, 0))), u = cross(s, f);
  const cb = cos(inst.bank), sb = sin(inst.bank);
  const uB = u.mul(cb).add(s.mul(sb)), sB = s.mul(cb).sub(u.mul(sb));
  const k = inst.size.mul(scale).mul(float(1).sub(inst.hidden));
  const world = inst.P.add(f.mul(p.x).add(uB.mul(p.y)).add(sB.mul(p.z)).mul(k));
  const nWorld = normalize(f.mul(n.x).add(uB.mul(n.y)).add(sB.mul(n.z)));
  return { world, normal: nWorld };
}

export interface FishLook {
  /** Multiplies the albedo. */
  tint: (seed: any) => any;
  /** Caustics / sheen strength (predator: less sparkle). */
  sparkle: number;
  roughness: number;
  /** Non-uniform body scale [length, width]. */
  shape?: [number, number];
  /** Dark steel-blue back / silver belly instead of the texture colours (keeps texture detail). */
  procedural?: boolean;
}

export function createFishMesh(asset: FishAsset, lodIndex: number, shadowLodIndex: number | null, inst: InstanceNodes, worldLength: number, count: number, look: FishLook, inspect?: any) {
  const lod = asset.lods[lodIndex], scale = worldLength / asset.length;
  const v = buildVertex(lod, asset.frames, inst, scale, inspect, look.shape);
  const positionNode = v.world.toVarying('fishPos'), normalW = v.normal.toVarying('fishNormal');
  const flashV = inst.flash.toVarying('fishFlash'), seedV = inst.seed.toVarying('fishSeed'), fearV = inst.fear.toVarying('fishFear');

  const material = new MeshStandardNodeMaterial();
  material.side = 2; // DoubleSide: thin fins
  material.metalness = 0.0;
  const id = attribute('matId', 'float');
  const uvs = uv();
  const A = texture(asset.textures[0], uvs), B = texture(asset.textures[1], uvs);
  let albedo = mix(A.rgb, B.rgb, step(0.5, id));
  albedo = mix(albedo, vec3(0.92, 0.9, 0.82), step(1.5, id));
  albedo = mix(albedo, vec3(0.006, 0.01, 0.016), step(2.5, id));
  const isBody = float(1).sub(step(1.5, id));
  if (look.procedural) {
    const luma = dot(albedo, vec3(0.3, 0.5, 0.2)), up = smoothstep(-0.35, 0.25, normalW.y);
    const proc = mix(vec3(0.62, 0.68, 0.76), vec3(0.015, 0.04, 0.1), up).mul(luma.mul(1.0).add(0.4));
    albedo = mix(albedo, proc, isBody);
  }
  const tinted = albedo.mul(look.tint(seedV));

  // underwater grading: deeper = bluer/darker
  const depth = max(waterLevel.sub(positionNode.y), 0);
  const deep = smoothstep(1.6, 6.0, depth); // shallow fish keep their saturated colour
  const graded = mix(tinted, tinted.mul(vec3(0.5, 0.74, 1.0)).mul(0.78), deep.mul(0.6));
  material.colorNode = vec4(graded, 1);

  const N = normalW.normalize();
  material.normalNode = transformNormalToView(N).mul(faceDirection).normalize();
  const above = smoothstep(0.0, 0.3, positionNode.y.sub(waterLevel)); // fish lifted out of the water: dry lighting + wet sheen
  material.metalnessNode = isBody.mul(0.3).mul(float(1).sub(above.mul(0.5)));
  material.roughnessNode = float(look.roughness).mul(mix(1.0, 0.7, isBody)).mul(mix(1.0, 0.5, above));

  // --- emissive: sun-flank sheen, caustics on the back, panic flash
  const toSun = sunDirection.negate(), Vw = normalize(cameraPosition.sub(positionNode));
  const H = normalize(Vw.add(toSun));
  const flank = float(1).sub(abs(N.y)).clamp(0, 1);
  const NH = max(dot(N, H), 0), NV = abs(dot(N, Vw));
  // silvery / iridescent flank: tight sun glint + soft lobe, hue shifting with view angle (thin-film look), glinting as fish bank and turn
  const irid = vec3(0.5).add(cos(vec3(0, 2.09, 4.19).add(NV.mul(5).add(seedV.mul(6.28)))).mul(0.5));
  const silver = mix(vec3(0.82, 0.94, 1.0), irid, 0.45);
  const lobe = pow(NH, 90).mul(2.4).add(pow(NH, 12).mul(0.16));
  const flicker = sin(seedV.mul(60).add(simTime.mul(2.2)).add(N.x.mul(6))).mul(0.2).add(0.8);
  const sheen = mix(silver, vec3(1.0, 0.98, 0.94), above).mul(lobe.mul(above.mul(1.2).add(1))).mul(flank.mul(0.8).add(0.2)).mul(isBody).mul(flicker).mul(visuals.sheen).mul(look.sparkle);
  const rim = pow(float(1).sub(NV), 3).mul(vec3(0.25, 0.6, 0.75)).mul(0.22).mul(float(1).sub(above)).mul(isBody).mul(look.sparkle); // subsurface-ish rim

  const proj = positionNode.xz.sub(sunDirection.xz.mul(positionNode.y.div(sunDirection.y.min(-0.2))));
  const cau = causticsField(proj, simTime, { ...causticParams, level: 2, depth } as any);
  const sunFacing = smoothstep(-0.1, 0.6, dot(N, toSun));
  const caustic = cau.mul(vec3(0.55, 0.88, 1.0)).mul(exp(depth.mul(-0.32))).mul(smoothstep(0, 0.2, depth)).mul(sunFacing).mul(visuals.causticsAmount).mul(look.sparkle);

  const glint = flashV.mul(visuals.flashGain).mul(float(1).sub(above)).mul(abs(dot(N, Vw)).mul(0.5).add(0.5)).mul(isBody);
  // silvery cyan flank glint that keeps a hint of the texture (feeds the bloom above 1)
  // short metallic glint: white-silver-cyan highlight, peak well below a full white fish
  const glintColor = vec3(0.62, 0.86, 1.0).mul(glint.mul(0.85)).add(vec3(0.95, 1.0, 1.0).mul(pow(glint, 3).mul(0.6)));
  const dbg = new URLSearchParams(location.search).get('fishLite');
  material.emissiveNode = dbg === '1' ? glintColor : dbg === '2' ? glintColor.add(sheen) : tinted.mul(caustic).mul(0.55).add(sheen).add(rim).add(glintColor);

  material.positionNode = v.world;

  const mesh = new Mesh(lod.geometry, material);
  mesh.count = count; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;

  // Cheap shadow proxy: separate low-poly geometry, only seen by the shadow camera (layer 1).
  let shadowMesh: Mesh | null = null;
  if (shadowLodIndex !== null) {
    const sl = asset.lods[shadowLodIndex], sv = buildVertex(sl, asset.frames, inst, scale, inspect);
    const sm = new MeshBasicNodeMaterial();
    sm.positionNode = sv.world; sm.side = 2;
    shadowMesh = new Mesh(sl.geometry, sm);
    shadowMesh.count = count; shadowMesh.frustumCulled = false; shadowMesh.castShadow = true; shadowMesh.layers.set(3);
  }
  return { mesh, shadowMesh, material };
}
