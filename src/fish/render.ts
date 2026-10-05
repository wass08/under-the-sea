/* eslint-disable @typescript-eslint/no-explicit-any */
import { Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import * as TSL from 'three/tsl';
const {
  cameraPosition, clamp, cos, cross, dot, exp, faceDirection, float, floor, fract, fwidth, hash, instanceIndex, length, max, min, mix, mod, normalize, positionWorld,
  select, sin, smoothstep, sqrt, step, storage, texture, transformNormalToView, uniform, uv, vec3, vec4, vertexIndex, attribute, pow, abs,
} = TSL as any;
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { moonOnly } from '../scene/lighting';
import { lanternLight, waterMedium } from '../scene/night';
import { lanternPosition, predatorLure } from '../state';
import { simTime, sunDirection, waterLevel } from '../state';
import type { FishAsset, FishLod } from './geometry';
import { airSpread, fishRand } from './sim';
import { WING } from './flyingfish';
import { FISH_SIZE } from '../config';

/** Per-instance data the vertex stage needs (from sim buffers or from uniforms). */
export interface InstanceNodes {
  P: any; V: any; phase: any; size: any; flash: any; bank: any; hidden: any; fear: any; seed: any; mouthAttached?: any;
  /** 0..1 wing spread (flying fish): 0 swimming, wings folded along the flanks; 1 gliding. */
  air?: any;
}

export const visuals = {
  /** School size multiplier; 1 uses the smaller art-directed world length. */
  sizeScale: uniform(1.15),
  /** Symmetric fractional size spread around the mean (0..0.6). */
  sizeVariation: uniform(0.45),
  /** Slow individual pitch/roll motion; 1 is a few degrees. */
  wobble: uniform(1),
  /** Absorbed lantern response on silver skin: wrap, broad sheen and tight glint. */
  lanternDiffuse: uniform(1.4),
  lanternSheen: uniform(1.4),
  lanternSpecular: uniform(1.6),
  /** 0..1: how strongly fish flanks glint in the sun. */
  sheen: uniform(1),
  ambientGlint: uniform(1),
  causticsAmount: uniform(1),
  flashGain: uniform(1.9),
  /** Legacy inspector control; flying fish now reflect light rather than emit neon. */
  neon: uniform(0),
  /** Fish depth fade (School → Look): fog density multiplier, clear distance underwater (units), how much of the fog
   *  is lifted for fish inside the lantern's lit pool (0 none … 1 lit fish never fade), and that pool's radius. */
  fogDensity: uniform(0.4),
  fogClear: uniform(8),
  lanternClarity: uniform(0.75),
  lanternPool: uniform(13),
};
const causticParams = createCausticsUniforms();
causticParams.scaleA.value = 3.4; causticParams.intensity.value = 1.35; causticParams.sharpness.value = 14;

export function instanceFromSim(read: { pos: any; vel: any; aux: any }, seed: number, list?: any, hook?: any): InstanceNodes {
  const i = list ? list.element(instanceIndex) : instanceIndex, p = read.pos.element(i), v = read.vel.element(i), a = read.aux.element(i);
  const attached = a.w.greaterThan(1.5).and(a.w.lessThan(2.5));
  const P = hook ? select(attached, hook, p.xyz) : p.xyz;
  const mean = (FISH_SIZE.min + FISH_SIZE.max) * 0.5;
  const size = fishRand(i, seed, 12).pow(FISH_SIZE.distribution).mul(2).sub(1)
    .mul(clamp(visuals.sizeVariation, 0, 0.6)).add(1).mul(mean).mul(visuals.sizeScale)
    .mul(smoothstep(0.45, 1.0, length(P.sub(cameraPosition))));
  return { mouthAttached: attached.toFloat(), P, V: v.xyz, phase: p.w, size, flash: a.x, bank: a.y, hidden: step(2.5, a.w), fear: v.w, seed: fishRand(i, seed, 13), air: airSpread(read, i) };
}

function vatNodes(lod: FishLod, frames: number) {
  const attr = new StorageBufferAttribute(lod.vat, 4);
  return storage(attr, 'vec4', lod.vat.length / 4).toReadOnly();
}

/** Builds the vertex-stage world position + normal for one LOD. `scale` = world size / model length. */
function buildVertex(lod: FishLod, frames: number, inst: InstanceNodes, scale: number, inspect?: any, shape?: [number, number], flying = false) {
  const vat = vatNodes(lod, frames), V = lod.vertexCount;
  const ph = fract(inst.phase).mul(frames), f0 = floor(ph), a = fract(ph), f1 = mod(f0.add(1), frames);
  const vid = vertexIndex.toFloat();
  const i0 = f0.mul(V).add(vid).mul(2).toUint(), i1 = f1.mul(V).add(vid).mul(2).toUint();
  const mouth0 = f0.mul(V).add(lod.mouthVertex).mul(2).toUint(), mouth1 = f1.mul(V).add(lod.mouthVertex).mul(2).toUint();
  const mouth = mix(vat.element(mouth0).xyz, vat.element(mouth1).xyz, a);
  const p0 = mix(vat.element(i0).xyz, vat.element(i1).xyz, a).sub(mouth.mul(inst.mouthAttached ?? float(0)));
  let p = shape ? vec3(p0.x.mul(shape[0]), p0.y, p0.z.mul(shape[1])) : p0;
  let n = mix(vat.element(i0.add(1)).xyz, vat.element(i1.add(1)).xyz, a);
  // Flying-fish wings (matId 4 pectoral, 5 pelvic) are modelled spread. Folded, each fan closes like a real fin:
  // its rays swing back to lie along the flank (pectorals high, pelvics under the belly), following the body wave.
  const id = attribute('matId', 'float'), wingMask = step(3.5, id), pelvic = step(4.5, id);
  {
    const fold = float(1).sub(clamp(inst.air ?? float(0), 0, 1)).mul(wingMask);
    const side = select(p.z.greaterThanEqual(0), float(1), float(-1));
    const W = (key: 'pectoral' | 'pelvic', i: 0 | 1) => vec3(...WING[key].root[i]);
    const root = mix(mix(W('pectoral', 0), W('pectoral', 1), uv().y), mix(W('pelvic', 0), W('pelvic', 1), uv().y), pelvic);
    const rootS = vec3(root.x, root.y, root.z.mul(side));
    const reach = length(p.sub(rootS));
    const beta = mix(mix(float(0.03), float(0.3), uv().y), mix(float(0.15), float(0.45), uv().y), pelvic);
    const flank = mix(float(0.071), float(0.052), pelvic);
    const xf = root.x.sub(cos(beta).mul(reach)), flex = max(float(0), float(0.32).sub(xf).div(0.9));
    const bend = sin(fract(inst.phase).mul(Math.PI * 2).sub(flex.mul(3.4))).mul(flex.mul(flex)).mul(0.075);
    const folded = vec3(xf, root.y.sub(sin(beta).mul(reach)), side.mul(flank.add(reach.mul(0.02))).add(bend));
    // A faint tremble of the spread wings in the airflow.
    const tremble = sin(fract(inst.phase).mul(Math.PI * 2 * 9).add(p.x.mul(30))).mul(0.004).mul(uv().x).mul(float(1).sub(fold)).mul(wingMask);
    p = mix(p, folded, fold).add(vec3(0, tremble, 0));
    n = normalize(mix(n, vec3(0, 0, side), fold));
  }

  const speed = length(inst.V);
  let fwd = select(speed.greaterThan(0.001), inst.V.div(max(speed, 0.001)), vec3(1, 0, 0));
  if (inspect) fwd = normalize(mix(fwd, inspect, 0.85));
  const fy = clamp(fwd.y, -0.8, 0.8), fxz = fwd.xz.div(max(length(fwd.xz), 1e-4)).mul(sqrt(float(1).sub(fy.mul(fy))));
  let f = vec3(fxz.x, fy, fxz.y);
  const s = normalize(cross(f, vec3(0, 1, 0)));
  let u = cross(s, f), bank = inst.bank;
  if (flying) {
    const seed = hash(inst.seed.mul(179.3)), offset = hash(inst.seed.mul(317.7)).mul(Math.PI * 2);
    const clock = simTime.mul(seed.mul(0.55).add(0.65));
    const pitch = sin(clock.mul(0.83).add(offset)).mul(0.055).mul(visuals.wobble);
    bank = bank.add(sin(clock.mul(1.17).add(offset.mul(1.73))).mul(0.09).mul(visuals.wobble));
    const pitched = f.mul(cos(pitch)).add(u.mul(sin(pitch)));
    u = u.mul(cos(pitch)).sub(f.mul(sin(pitch)));
    f = pitched;
  }
  const cb = cos(bank), sb = sin(bank);
  const uB = u.mul(cb).add(s.mul(sb)), sB = s.mul(cb).sub(u.mul(sb));
  const k = inst.size.mul(scale).mul(float(1).sub(inst.hidden));
  const world = inst.P.add(f.mul(p.x).add(uB.mul(p.y)).add(sB.mul(p.z)).mul(k));
  const nWorld = normalize(f.mul(n.x).add(uB.mul(n.y)).add(sB.mul(n.z)));
  return { world, normal: nWorld, dorsal: n.y };
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
  /** Night cá chuồn (flying fish): cobalt back, reflective silver scales, translucent fin rays and airborne rim light. */
  flying?: boolean;
  /** Dorado: blue-green back, spotted gold flanks and wet, light-driven reflections. */
  predator?: boolean;
}

/** World length of a school fish at size 1 (per-fish sizes scale it by FISH_SIZE.min…max). */
export const SCHOOL_LENGTH = 0.39;
/** The school's look, shared by the GPU school and the single-fish inspector (fish.html). */
export const schoolLook: FishLook = {
  tint: (seed: any) => vec3(hash(seed.mul(91)).mul(0.12).add(0.92)),
  sparkle: 0.85, roughness: 0.38, procedural: true, flying: true,
};
/** Variant thresholds on hash(seed · 53.1): below VARIANT_B cyan, below VARIANT_C teal, else violet. */
export const VARIANT_B = 0.72, VARIANT_C = 0.9;
export const VARIANT_NAMES = ['cyan', 'teal', 'violet'] as const;

/** Subtle structural-colour variants in the silver sheen and dorsal band. */
const FLYING = {
  sheen: [vec3(0.66, 0.82, 1.0), vec3(0.66, 0.94, 0.86), vec3(0.85, 0.75, 1.0)],
  back: [vec3(0.012, 0.035, 0.13), vec3(0.01, 0.06, 0.09), vec3(0.04, 0.025, 0.12)],
};

export function createFishMesh(asset: FishAsset, lodIndex: number, // -1 = the full-detail LOD
   shadowLodIndex: number | null, inst: InstanceNodes, worldLength: number, count: number, look: FishLook, inspect?: any) {
  const lod = lodIndex < 0 ? asset.full! : asset.lods[lodIndex], scale = worldLength / asset.length;
  const v = buildVertex(lod, asset.frames, inst, scale, inspect, look.shape, look.flying);
  const positionNode = v.world.toVarying('fishPos'), normalW = v.normal.toVarying('fishNormal');
  const flashV = inst.flash.toVarying('fishFlash'), seedV = inst.seed.toVarying('fishSeed'), fearV = inst.fear.toVarying('fishFear');

  const material = new MeshStandardNodeMaterial();
  material.side = 2; // DoubleSide: thin fins
  // Underwater: the moon and sky fill come from the scene; the lantern is added below with water absorption.
  material.lightsNode = moonOnly();
  material.metalness = 0.0;
  const id = attribute('matId', 'float');
  const uvs = uv();
  const A = texture(asset.textures[0], uvs), B = texture(asset.textures[1], uvs);
  let albedo = mix(A.rgb, B.rgb, step(0.5, id));
  albedo = mix(albedo, vec3(0.92, 0.9, 0.82), step(1.5, id));
  albedo = mix(albedo, vec3(0.006, 0.01, 0.016), step(2.5, id));
  const isBody = float(1).sub(step(1.5, id));
  const isFin = step(0.5, id).mul(float(1).sub(step(1.5, id)));
  const back = look.procedural ? smoothstep(0.25, 0.85, v.dorsal.toVarying('fishDorsal')) : float(0);
  // Pattern masks. Body uv: x 0 tail tip → 1 nose, y = 0.5 + 5·height. Wing uv: x along the ray, y across the fan.
  const variant = hash(seedV.mul(53.1)), vB = step(VARIANT_B, variant), vC = step(VARIANT_C, variant);
  const pal = (list: any[]) => mix(mix(list[0], list[1], vB), list[2], vC);
  const along = uvs.x, up = uvs.y;
  const isWing = step(3.5, id);
  const airV = (inst.air ?? float(0)).toVarying('fishAir');
  const skin = float(1).sub(step(0.5, id));
  const eyeRing = step(1.5, id).mul(float(1).sub(step(2.5, id)));
  const pupil = step(2.5, id).mul(float(1).sub(step(3.5, id)));
  const lateral = smoothstep(0.018, 0.004, abs(up.sub(0.47))).mul(smoothstep(0.2, 0.32, along)).mul(smoothstep(0.92, 0.82, along)).mul(skin);
  const belly = smoothstep(0.48, 0.23, up).mul(skin);
  // Fine rays run root to tip. Fade unresolved detail instead of sparkling on distant fish.
  const rayCoord = up.mul(18);
  const rayAA = max(fwidth(rayCoord), 0.025);
  const rayLines = float(1).sub(smoothstep(0.012, rayAA.add(0.025), abs(fract(rayCoord.add(0.5)).sub(0.5))))
    .mul(float(1).sub(smoothstep(0.3, 0.9, rayAA))).mul(smoothstep(0.03, 0.22, along));
  const wingEdge = smoothstep(0.84, 1.0, along);
  // Small overlapping scale arcs, staggered along the flank. Only albedo/roughness vary:
  // no extra geometry, texture fetches or unstable normal noise on a few-pixel fish.
  const rows = up.mul(13), scaleX = fract(along.mul(46).add(floor(rows).mul(0.5))).sub(0.5);
  const scaleY = fract(rows).sub(0.5);
  const arc = length(TSL.vec2(scaleX.mul(0.85), scaleY.add(0.2)));
  const scaleDetail = float(1).sub(smoothstep(0.3, 0.85, max(fwidth(along.mul(46)), fwidth(rows))))
    .mul(smoothstep(0.25, 0.42, along)).mul(smoothstep(0.89, 0.78, along)).mul(float(1).sub(back)).mul(skin);
  const scaleEdge = smoothstep(0.025, 0.075, abs(arc.sub(0.48))).oneMinus().mul(scaleDetail);
  const scaleFacet = cos(scaleX.mul(5)).mul(cos(scaleY.mul(4))).mul(scaleDetail);
  const viewFacing = abs(dot(normalize(normalW), normalize(cameraPosition.sub(positionNode))));
  const grazing = pow(float(1).sub(viewFacing), 3);
  const film = mix(pal(FLYING.sheen), vec3(0.8).add(cos(vec3(0, 2.1, 4.2).add(viewFacing.mul(8))).mul(0.2)), 0.55);
  if (look.flying) {
    const dorsal = smoothstep(0.53, 0.86, up).max(back.mul(0.75));
    const flank = mix(vec3(0.72, 0.8, 0.86), pal(FLYING.back), dorsal);
    let body = mix(flank, vec3(0.9, 0.94, 0.96), belly);
    body = body.mul(float(1).sub(scaleEdge.mul(0.07)).add(scaleFacet.mul(0.035)));
    body = mix(body, vec3(0.12, 0.21, 0.28), lateral.mul(0.38));
    const gillCurve = along.sub(float(0.837).add(pow(up.sub(0.5), 2).mul(0.18)));
    const gill = smoothstep(0.004, 0.001, abs(gillCurve)).mul(smoothstep(0.15, 0.3, up)).mul(smoothstep(0.85, 0.69, up));
    body = body.mul(float(1).sub(gill.mul(0.3)));
    body = body.mul(mix(vec3(1), film, grazing.mul(0.35)));
    const finPhase = up.mul(95).add(along.mul(32));
    const finRays = pow(cos(finPhase).mul(0.5).add(0.5), 18).mul(float(1).sub(smoothstep(0.6, 2, fwidth(finPhase))));
    const fins = mix(vec3(0.035, 0.07, 0.11), vec3(0.16, 0.25, 0.3), finRays.mul(0.5));
    const membrane = mix(vec3(0.025, 0.049, 0.078), vec3(0.095, 0.145, 0.18), wingEdge.mul(0.65));
    const wings = mix(membrane, vec3(0.3, 0.4, 0.46), rayLines.mul(0.68));
    albedo = mix(albedo, body, skin);
    albedo = mix(albedo, fins, isFin);
    albedo = mix(albedo, wings, isWing);
    albedo = mix(albedo, vec3(0.62, 0.72, 0.8), eyeRing);
    albedo = mix(albedo, vec3(0.0015, 0.003, 0.006), pupil);
  } else if (look.predator) {
    // Dorado body UVs preserve height in model space, so countershading banks with the fish.
    const dorsal = smoothstep(0.62, 0.94, up);
    const ventral = smoothstep(0.44, 0.24, up);
    const blueGreen = mix(vec3(0.018, 0.19, 0.17), vec3(0.012, 0.065, 0.20), grazing.mul(0.7).add(dorsal.mul(0.3)));
    let body = mix(vec3(0.78, 0.61, 0.20), blueGreen, dorsal);
    body = mix(body, vec3(0.79, 0.84, 0.68), ventral);
    body = body.mul(float(1).sub(scaleEdge.mul(0.055)).add(scaleFacet.mul(0.025)));
    // Sparse, irregular small spots, faded when their footprint becomes subpixel.
    const cell = TSL.vec2(along.mul(34), up.mul(15));
    const cellId = floor(cell), random = hash(dot(cellId, TSL.vec2(127.1, 311.7)));
    const offset = TSL.vec2(hash(random.mul(71)), hash(random.mul(137))).sub(0.5).mul(0.48);
    const spotDistance = length(fract(cell).sub(0.5).sub(offset));
    const spotAA = max(fwidth(spotDistance), 0.025);
    const spotRadius = random.mul(0.09).add(0.055);
    const spots = float(1).sub(smoothstep(spotRadius.mul(0.6), spotAA.add(spotRadius), spotDistance))
      .mul(step(0.67, random)).mul(smoothstep(0.32, 0.45, up)).mul(smoothstep(0.99, 0.83, along))
      .mul(float(1).sub(smoothstep(0.5, 1.1, max(fwidth(cell.x), fwidth(cell.y)))));
    body = mix(body, vec3(0.008, 0.045, 0.053), spots.mul(0.78));
    // Subtle operculum and closed jaw seams follow the head, not the lighting normal.
    const gillX = float(0.831).sub(cos(up.sub(0.52).mul(7)).mul(0.044));
    const gill = float(1).sub(smoothstep(0.001, max(fwidth(along), 0.0015).add(0.0025), abs(along.sub(gillX))))
      .mul(smoothstep(0.25, 0.36, up)).mul(smoothstep(0.9, 0.76, up));
    const jaw = float(1).sub(smoothstep(0.002, max(fwidth(up), 0.003).add(0.005), abs(up.sub(float(0.456).add(along.sub(0.94).mul(0.16))))))
      .mul(smoothstep(0.925, 0.972, along));
    body = mix(body, vec3(0.022, 0.063, 0.049), gill.mul(0.34).max(jaw.mul(0.48)));
    // All dorado fins use root-to-edge UVs and a ray coordinate along their outlines.
    const ray = up.mul(43), aa = max(fwidth(ray), 0.03);
    const rays = float(1).sub(smoothstep(0.025, aa.add(0.08), abs(fract(ray).sub(0.5))))
      .mul(float(1).sub(smoothstep(0.4, 1.0, aa)));
    let fins = mix(vec3(0.012, 0.042, 0.085), vec3(0.07, 0.19, 0.25), rays.mul(0.65));
    fins = mix(fins, vec3(0.035, 0.21, 0.38), smoothstep(0.88, 1.0, along).mul(0.72));
    albedo = mix(albedo, body, skin);
    albedo = mix(albedo, fins, isFin);
    albedo = mix(albedo, vec3(0.58, 0.64, 0.39), eyeRing);
    albedo = mix(albedo, vec3(0.002, 0.005, 0.01), pupil);
    const lurePart = attribute('lurePart', 'float');
    albedo = mix(albedo, vec3(0.045, 0.15, 0.16), step(.5, lurePart));
    albedo = mix(albedo, vec3(0.65, 0.96, 1), step(1.5, lurePart));
  } else if (look.procedural) {
    // Countershading belongs to the fish, so its dark back rotates with the roll.
    const luma = dot(albedo, vec3(0.3, 0.5, 0.2));
    const proc = mix(vec3(0.8, 0.86, 0.9), vec3(0.008, 0.026, 0.042), back).mul(luma.mul(0.12).add(0.88));
    albedo = mix(albedo, mix(proc, vec3(0.12, 0.2, 0.24), isFin), isBody);
  }
  const tinted = albedo.mul(look.tint(seedV));

  // underwater grading: deeper = bluer/darker
  const depth = max(waterLevel.sub(positionNode.y), 0);
  const deep = smoothstep(1.6, 6.0, depth); // shallow fish keep their saturated colour
  const graded = mix(tinted, tinted.mul(vec3(0.68, 0.84, 1.0)), deep.mul(0.4));
  material.colorNode = vec4(graded, 1);

  const N = normalW.normalize();
  material.normalNode = transformNormalToView(N).mul(faceDirection).normalize();
  const above = smoothstep(0.0, 0.3, positionNode.y.sub(waterLevel)); // fish lifted out of the water: dry lighting + wet sheen
  material.metalnessNode = isBody.mul(mix(float(look.flying ? 0.55 : 0.65), float(0.15), isFin)).mul(float(1).sub(above.mul(0.5)));
  material.roughnessNode = mix(float(look.roughness).mul(mix(1.0, 0.7, isBody)), float(0.6), isFin).mul(mix(1.0, 0.5, above));

  if (look.flying) {
    // Reuse the scene's filtered night HDRI, with more reflection exposure on silver skin.
    // envMapIntensity alone does not affect a scene.environment in three r186.
    material.envNode = (TSL as any).Fn((builder: any) => {
      const env = builder.environmentNode;
      if (!env) return vec3(0);
      const radiance = env.isTextureNode ? (TSL as any).pmremTexture(env.value) : env;
      // A restrained neutral component keeps guanine silver from reading as blue paint.
      const reflected = mix(radiance, vec3(dot(radiance, vec3(0.22, 0.5, 0.28))), 0.55);
      return reflected.mul(mix(8, 18, skin.add(eyeRing).clamp()));
    })();
    material.metalnessNode = skin.mul(mix(0.86, 0.5, back)).add(eyeRing.mul(0.9)).add(isFin.add(isWing).mul(0.12));
    const skinRoughness = float(0.25).add(scaleEdge.mul(0.07)).sub(scaleFacet.mul(0.045)).add(back.mul(0.04));
    material.roughnessNode = mix(float(0.42).sub(rayLines.mul(0.1)), skinRoughness, skin)
      .mul(mix(1, 0.85, above)).mul(float(1).sub(pupil.mul(0.78))).mul(float(1).sub(eyeRing.mul(0.4)));
  }

  if (look.predator) {
    // Same filtered scene reflections as the school, with neutral fill to retain the gold in blue water.
    material.envNode = (TSL as any).Fn((builder: any) => {
      const env = builder.environmentNode;
      if (!env) return vec3(0);
      const radiance = env.isTextureNode ? (TSL as any).pmremTexture(env.value) : env;
      return mix(radiance, vec3(dot(radiance, vec3(0.22, 0.5, 0.28))), 0.6)
        .mul(mix(12, 34, skin.add(eyeRing).clamp()));
    })();
    material.metalnessNode = skin.mul(0.72).add(isFin.mul(0.16)).add(eyeRing.mul(0.82));
    material.roughnessNode = mix(float(look.roughness).add(scaleEdge.mul(0.045)), float(0.4), isFin)
      .mul(float(1).sub(eyeRing.mul(0.4))).mul(float(1).sub(pupil.mul(0.82)));
  }

  // --- emissive: sun-flank sheen, caustics on the back, panic flash
  const toSun = sunDirection.negate(), Vw = normalize(cameraPosition.sub(positionNode));
  const H = normalize(Vw.add(toSun));
  const flank = float(1).sub(abs(N.y)).clamp(0, 1);
  const NH = max(dot(N, H), 0), NV = abs(dot(N, Vw));
  // silvery / iridescent flank: tight sun glint + soft lobe, hue shifting with view angle (thin-film look), glinting as fish bank and turn
  const irid = vec3(0.5).add(cos(vec3(0, 2.09, 4.19).add(NV.mul(5).add(seedV.mul(6.28)))).mul(0.5));
  const silver = mix(vec3(0.82, 0.94, 1.0), irid, 0.06);
  // A broad reflection stays visible between alarm flashes; slow microfacet variation makes
  // glints pass through the school, with sunlight and body orientation controlling visibility.
  const lightWave = sin(positionNode.x.mul(0.34).add(positionNode.z.mul(0.23)).sub(simTime.mul(0.65)).add(seedV.mul(0.9)));
  const micro = normalize(N.add(vec3(sin(seedV.mul(31).add(simTime.mul(0.7))), 0, cos(seedV.mul(47).sub(simTime.mul(0.55)))).mul(0.18)));
  const reflectedSun = pow(max(dot(micro, H), 0), 38).mul(smoothstep(-0.15, 0.45, dot(N, toSun))).mul(smoothstep(-0.4, 0.75, lightWave).mul(0.7).add(0.3));
  const lobe = pow(NH, 70).mul(1.5).add(pow(NH, 10).mul(0.16)).add(reflectedSun.mul(0.9).mul(visuals.ambientGlint));
  const flicker = sin(seedV.mul(60).add(simTime.mul(2.2)).add(N.x.mul(6))).mul(0.2).add(0.8);
  const sheen = mix(silver, vec3(1.0, 0.98, 0.94), above).mul(lobe.mul(above.mul(1.2).add(1))).mul(flank.mul(0.8).add(0.2)).mul(isBody).mul(flicker).mul(visuals.sheen).mul(look.sparkle).mul(float(1).sub(back.mul(0.92)));
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
  const silverFill = look.procedural ? tinted.mul(0.14).mul(isBody) : vec3(0);
  // Night light the PBR pass does not see underwater: the boat lantern (with water absorption).
  let nightLight = lanternLight(positionNode, N, 0.35);
  if (look.flying) {
    const delta = predatorLure.xyz.sub(positionNode), distance = length(delta);
    const falloff = float(1).sub(smoothstep(0.5, 5.5, distance)).pow(2).div(distance.mul(distance).mul(.45).add(1));
    const facing = max(dot(N.mul(faceDirection), delta.div(max(distance, .001))), 0).mul(.7).add(.3);
    nightLight = nightLight.add(vec3(.16, .85, 1).mul(falloff).mul(facing).mul(predatorLure.w).mul(12));
  }
  if (look.flying) {
    // The lamp sits ABOVE the school. Its incident irradiance already includes the entry
    // cone, inverse-square falloff, power and absorption through the water.
    const L = normalize(lanternPosition.sub(positionNode));
    const litN = N.mul(faceDirection);
    const lampH = normalize(Vw.add(L));
    const lampNH = max(dot(litN, lampH), 0), lampNL = max(dot(litN, L), 0);
    const lamp = lanternLight(positionNode, L, 0);
    const lampEnergy = max(max(lamp.r, lamp.g), lamp.b);
    const schoolLight = mix(mix(0.12, 0.65, smoothstep(0.015, 0.8, lampEnergy)), 1, above);
    const specPower = mix(100, 75, scaleEdge);
    const specLobe = pow(lampNH, specPower).mul(specPower.add(2).div(8 * Math.PI)).mul(lampNL);
    const wetSilver = mix(vec3(0.83, 0.9, 0.95), film, grazing.mul(0.22));
    // Dark dorsal pigment still has a reflective wet silver coat.
    const reflectance = mix(vec3(0.04), wetSilver.mul(mix(0.84, 0.38, back)), skin.add(eyeRing).clamp());
    // A broad low lobe catches the paper lantern across turning flanks, beneath the tight silver flash.
    // lamp already contains lanternColor and water absorption: keep its gold separate from the cool film.
    const lampLobe = specLobe.mul(visuals.lanternSpecular)
      .add(pow(lampNH, 14).mul(lampNL).mul(visuals.lanternSheen));
    const lampSpec = lamp.mul(reflectance).mul(lampLobe).mul(visuals.sheen).mul(mix(1, 0.5, above));
    // Wrapped light reaches the shoulders, but the downward-facing belly stays dark.
    // Neutral guanine under the dorsal pigment lets warm light land on the back.
    const wrap = max(dot(litN, L).add(0.45).div(1.45), 0);
    const silverCoat = mix(tinted, vec3(0.48, 0.53, 0.56), back.mul(0.65).mul(skin));
    const diffuse = silverCoat.mul(lamp).mul(wrap).mul(visuals.lanternDiffuse)
      .mul(skin.add(eyeRing.mul(0.45)).add(isWing.add(isFin).mul(0.12)))
      .add(tinted.mul(nightLight).mul(0.035).mul(float(1).sub(pupil.mul(0.8))));
    // Thin membranes transmit incident light from the far side, strongest with the lamp
    // behind the fish; keeping them opaque avoids sorting thousands of instanced fins.
    const through = max(dot(litN.negate(), L), 0).mul(0.012)
      .add(pow(max(dot(Vw.negate(), L), 0), 5).mul(airV).mul(above).mul(0.06));
    const membraneLight = lamp.mul(vec3(0.32, 0.42, 0.5)).mul(through).mul(isWing.add(isFin))
      .mul(float(1).sub(rayLines.mul(0.45)));
    const moonFacing = smoothstep(-0.2, 0.6, dot(N, toSun));
    const rimAir = pow(float(1).sub(NV), 3.5).mul(lamp.mul(lampNL).mul(0.025).add(vec3(0.13, 0.19, 0.3).mul(moonFacing)))
      .mul(above).mul(skin.add(isWing.mul(0.22)));
    const silverRim = pow(float(1).sub(NV), 4).mul(vec3(0.15, 0.23, 0.34)).mul(moonFacing)
      .mul(skin).mul(float(1).sub(above)).mul(visuals.ambientGlint);
    const lampTint = lamp.div(max(max(lamp.r, lamp.g), max(lamp.b, 0.001)));
    const flashTint = mix(mix(vec3(0.86, 0.94, 1), pal(FLYING.sheen), 0.06), lampTint,
      smoothstep(0.08, 1.2, lamp.r).mul(0.7));
    const silverFlash = flashTint.mul(schoolLight)
      .mul(glint.mul(0.65).add(pow(glint, 3).mul(0.32))).mul(skin).mul(float(1).sub(back.mul(0.65)));
    // Eye: a glossy dark eyeball, not a hole. A deep-blue iris tone and a tight wet catchlight from the lantern
    // and the moon, so it reads as a lens at any distance.
    const eyeGloss = pow(lampNH, 260).mul(lamp).mul(2.2).add(pow(max(dot(litN, normalize(toSun.add(Vw))), 0), 160).mul(vec3(0.5, 0.6, 0.85)).mul(0.6).mul(schoolLight));
    const eye = pupil.mul(eyeGloss.add(vec3(0.004, 0.012, 0.03)).add(pow(float(1).sub(NV), 2).mul(vec3(0.02, 0.05, 0.1))));
    material.emissiveNode = dbg === '1' ? silverFlash : diffuse.add(lampSpec).add(membraneLight)
      .add(sheen.mul(0.16).mul(skin).add(silverRim.mul(0.35)).mul(schoolLight)).add(rimAir).add(silverFlash).add(eye);

    // Attenuate the complete PBR reflection (moon + environment), independently of the warm lamp above.
    // output includes emissive; subtract its evaluated value so neither the lamp nor airborne rim is dimmed twice.
    const lit = (TSL as any).output.rgb.sub((TSL as any).emissive).mul(schoolLight).add((TSL as any).emissive);
    const cameraDistance = length(cameraPosition.sub(positionNode));
    const cameraUnder = cameraPosition.y.lessThan(waterLevel);
    // A tunable clear foreground, then exponential extinction into the shared ink-blue medium.
    const underwaterPath = max(cameraDistance.sub(visuals.fogClear), 0);
    const underwaterExtinction = underwaterPath.mul(underwaterPath).mul(0.0048);
    // Only the submerged segment of the sightline absorbs when viewed from above.
    const waterPath = cameraDistance.mul(depth.div(max(cameraPosition.y.sub(positionNode.y), 0.1)).clamp(0, 1));
    const surfaceExtinction = waterPath.mul(0.055).add(depth.mul(0.025));
    // Fish in the lantern's lit pool stay readable from afar: their fade is lifted (art-directed, not physical).
    const inPool = smoothstep(visuals.lanternPool, visuals.lanternPool.mul(0.35), length(lanternPosition.sub(positionNode)))
      .mul(smoothstep(0.015, 0.3, lampEnergy)); // no fog lift when the lamp is off or outside its entry cone
    const fogScale = visuals.fogDensity.mul(float(1).sub(inPool.mul(visuals.lanternClarity)));
    const transmission = exp(select(cameraUnder, underwaterExtinction, surfaceExtinction).mul(fogScale).negate());
    // Match the post medium's depth tint; leave nearby fish intact to avoid double absorption.
    const mediumDepth = depth.add(max(waterLevel.sub(cameraPosition.y), 0)).mul(0.5);
    const medium = mix(waterMedium.near, waterMedium.deep, smoothstep(0, 16, mediumDepth));
    material.outputNode = vec4(mix(medium, lit, transmission), (TSL as any).output.a);

  } else if (look.predator) {
    // The esca softly lights the forehead; a dim broad rim keeps the hunter readable in deep water.
    const L = normalize(lanternPosition.sub(positionNode)), litN = N.mul(faceDirection);
    const lamp = lanternLight(positionNode, L, 0), lampH = normalize(Vw.add(L));
    const lampNH = max(dot(litN, lampH), 0), lampNL = max(dot(litN, L), 0);
    const specLobe = pow(lampNH, 110).mul(112 / (8 * Math.PI)).mul(lampNL);
    const reflectance = mix(vec3(0.045), mix(tinted, vec3(0.85, 0.91, 0.88), 0.4), skin.add(eyeRing).clamp());
    const specular = lamp.mul(reflectance).mul(specLobe).mul(0.32).mul(visuals.sheen);
    const diffuse = tinted.mul(nightLight).mul(mix(0.07, 0.04, isFin)).mul(float(1).sub(pupil.mul(0.9)));
    const transmitted = lamp.mul(vec3(0.07, 0.17, 0.24)).mul(max(dot(litN.negate(), L), 0)).mul(isFin).mul(0.012);
    const eyeGloss = lamp.mul(pow(lampNH, 260)).mul(lampNL).mul(pupil).mul(1.4);
    const lurePart = attribute('lurePart', 'float'), bulb = step(1.5, lurePart), rod = step(.5, lurePart).sub(bulb);
    const delta = predatorLure.xyz.sub(positionNode), distance = length(delta), lureL = delta.div(max(distance, .001));
    const falloff = float(1).sub(smoothstep(.4, 4.5, distance)).pow(2).div(distance.mul(distance).mul(1.8).add(1));
    const lureNL = max(dot(litN, lureL), 0), lureH = normalize(Vw.add(lureL));
    const lureLight = vec3(.16, .85, 1).mul(falloff).mul(predatorLure.w);
    const headLight = lureLight.mul(tinted.mul(lureNL.mul(.8).add(.08))
      .add(pow(max(dot(litN, lureH), 0), 65).mul(lureNL).mul(.5))).mul(float(1).sub(pupil.mul(.85)));
    const bodyRim = vec3(.055, .14, .18).mul(pow(float(1).sub(NV), 2.5).mul(.85).add(.13))
      .mul(skin.add(isFin.mul(.55))).add(tinted.mul(.035).mul(skin));
    const finEdge = vec3(.025, .09, .13).mul(smoothstep(.8, 1, along)).mul(isFin);
    const rodLight = vec3(.025, .12, .14).mul(rod).add(lureLight.mul(.2).mul(rod));
    const bulbLight = vec3(.48, 1.35, 1.6).mul(7).mul(predatorLure.w).mul(bulb);
    material.emissiveNode = diffuse.add(specular).add(transmitted).add(eyeGloss).add(headLight)
      .add(bodyRim).add(finEdge).add(rodLight).mul(float(1).sub(bulb)).add(bulbLight);
  } else {
    material.emissiveNode = dbg === '1' ? glintColor : dbg === '2' ? glintColor.add(sheen) : tinted.mul(caustic).mul(0.55).add(silverFill).add(sheen).add(rim).add(glintColor).add(tinted.mul(nightLight));
  }

  material.positionNode = v.world;

  const mesh = new Mesh(lod.geometry, material);
  mesh.count = count; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;

  // Cheap shadow proxy: separate low-poly geometry, only seen by the shadow camera (layer 1).
  let shadowMesh: Mesh | null = null;
  if (shadowLodIndex !== null) {
    const sl = asset.lods[shadowLodIndex], sv = buildVertex(sl, asset.frames, inst, scale, inspect, undefined, look.flying);
    const sm = new MeshBasicNodeMaterial();
    sm.positionNode = sv.world; sm.side = 2;
    shadowMesh = new Mesh(sl.geometry, sm);
    shadowMesh.count = count; shadowMesh.frustumCulled = false; shadowMesh.castShadow = true; shadowMesh.layers.set(3);
  }
  return { mesh, shadowMesh, material };
}
