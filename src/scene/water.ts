import { AdditiveBlending, BackSide, BufferGeometry, ClampToEdgeWrapping, DataTexture, DoubleSide, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, PlaneGeometry, RedFormat, Scene, Sphere, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Fn, Loop, float, vec2, vec3, vec4, mix, smoothstep, exp, max, min, pow, refract, reflect, normalize,
  positionGeometry, positionWorld, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraProjectionMatrixInverse,
  screenUV, screenCoordinate, viewportDepthTexture, viewportOpaqueMipTexture, getViewPosition, texture, mx_noise_float, attribute,
  reflector, dot, abs, fract, sin,
} from 'three/tsl';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { oceanField } from '../lib/ocean';
import { godRayStrength, toSun, waterClarity } from './lighting';
import { skyColor } from './atmosphere';
import { edgeHeight, type Edges } from './terrain';

const R = WORLD.half;
const bottomY = 0;

/** Terrain height field as a texture (R = world y), for cheap sun-occlusion tests inside the water volume. */
export function createHeightTexture(heights: Float32Array, resolution: number) {
  const data = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) data[i] = toHalf(heights[i]);
  const tex = new DataTexture(data, resolution, resolution, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.wrapS = tex.wrapT = ClampToEdgeWrapping; tex.needsUpdate = true;
  return tex;
}
function toHalf(v: number) {
  const f = new Float32Array(1), i = new Uint32Array(f.buffer); f[0] = v;
  const x = i[0], sign = (x >> 16) & 0x8000; let e = ((x >> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) return sign; if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >> 13);
}

/** Absorption (per world unit) — red dies first, then green, leaving deep teal-blue. */
const sigma = vec3(0.30, 0.085, 0.04);

export function createWater(scene: Scene, camera: PerspectiveCamera, heightTexture: DataTexture, edges: Edges) {
  const box = { lo: vec3(-R, bottomY, -R), hi: vec3(R, WORLD.surface + 0.6, R) };
  const safeAxis = (v: Node<'float'>) => v.greaterThanEqual(0).select(v.max(1e-5), v.min(-1e-5));

  // ---- Volume optics shared by the top surface and the side faces -----------------------------------------
  /** Beams of sunlight inside the water volume (single scattering, raymarched from the entry point). */
  const scatterRays = Fn(([origin, dir, length]: [Node<'vec3'>, Node<'vec3'>, Node<'float'>]) => {
    const steps = 14;
    const acc = float(0).toVar();
    const stepLen = length.div(steps);
    const jitter = fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)).fract().mul(52.9829189));
    Loop(steps, ({ i }) => {
      const t = float(i).add(jitter).mul(stepLen);
      const p = origin.add(dir.mul(t));
      const under = waterLevel.sub(p.y);
      const towardSurface = under.div(toSun.y.max(0.15));
      const ps = p.xz.add(toSun.xz.mul(towardSurface));
      const beamA = mx_noise_float(vec3(ps.mul(0.42), simTime.mul(0.16))).mul(0.5).add(0.5);
      const beamB = mx_noise_float(vec3(ps.mul(1.15).add(11.3), simTime.mul(0.27))).mul(0.5).add(0.5);
      const beam = smoothstep(0.52, 0.8, beamA.mul(0.6).add(beamB.mul(0.4)));
      // Terrain (island) shades the beams: two height probes toward the sun.
      const q1 = p.add(toSun.mul(0.7)), q2 = p.add(toSun.mul(2.0)), q3 = p.add(toSun.mul(4.2));
      const h1 = texture(heightTexture, q1.xz.div(R * 2).add(0.5)).level(float(0)).r;
      const h2 = texture(heightTexture, q2.xz.div(R * 2).add(0.5)).level(float(0)).r;
      const h3 = texture(heightTexture, q3.xz.div(R * 2).add(0.5)).level(float(0)).r;
      const open = smoothstep(-0.05, 0.25, q1.y.sub(h1)).mul(smoothstep(-0.05, 0.25, q2.y.sub(h2))).mul(smoothstep(-0.05, 0.25, q3.y.sub(h3)));
      const inside = smoothstep(-0.02, 0.2, under);
      acc.addAssign(beam.mul(open).mul(inside).mul(under.mul(-0.10).exp()).mul(stepLen));
    });
    return acc;
  });

  /** Everything that lies below a water fragment: refracted opaque scene, absorption, in-scatter, god rays. */
  function volume(entry: Node<'vec3'>, normal: Node<'vec3'>) {
    const toEntry = entry.sub(cameraPosition);
    const d0 = toEntry.length(), rd = toEntry.div(d0);
    const opaque = getViewPosition(screenUV, viewportDepthTexture().r, cameraProjectionMatrixInverse).length();
    const dir = vec3(safeAxis(rd.x), safeAxis(rd.y), safeAxis(rd.z));
    const t0 = box.lo.sub(cameraPosition).div(dir), t1 = box.hi.sub(cameraPosition).div(dir);
    const exitDist = max(t0, t1).x.min(max(t0, t1).y).min(max(t0, t1).z);
    const path = min(opaque, exitDist).sub(d0).max(0).min(24).toVar();
    // Screen-space refraction: look up where the refracted ray would land.
    const refracted = refract(rd, normal, float(1 / 1.333));
    const target = entry.add(rd.mul(path)).add(refracted.sub(rd).mul(path.min(2.5)));
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(target, 1)));
    const uvRaw = clip.xy.div(clip.w).mul(vec2(0.5, -0.5)).add(0.5);
    // Limit the offset: shrink it at grazing angles and clamp its length so nothing gets stretched into streaks.
    const facing = dot(normal, rd.negate()).abs();
    const delta = uvRaw.sub(screenUV), deltaLen = delta.length().max(1e-5);
    const uvR = screenUV.add(delta.mul(min(float(1), float(0.02).div(deltaLen))).mul(smoothstep(0.12, 0.55, facing))).clamp(0.002, 0.998);
    const depthR = getViewPosition(uvR, viewportDepthTexture(uvR).r, cameraProjectionMatrixInverse).length();
    const mismatch = depthR.sub(opaque).abs().div(opaque.sub(d0).max(0.5));
    const weight = float(1).sub(smoothstep(0.12, 0.45, mismatch)).mul(depthR.greaterThan(d0.add(0.05)).select(float(1), float(0)));
    const straight = vec4(viewportOpaqueMipTexture(screenUV, float(0)) as Node<'vec4'>).rgb;
    const shifted = vec4(viewportOpaqueMipTexture(uvR, float(0)) as Node<'vec4'>).rgb;
    const sampleColor = mix(straight, shifted, weight);
    const transmittance = exp(sigma.mul(waterClarity).mul(path).negate());
    const deep = float(1).sub(exp(path.mul(-0.09).mul(waterClarity)));
    const inscatter = mix(vec3(0.02, 0.30, 0.32), vec3(0.008, 0.10, 0.32), deep).mul(float(1).sub(exp(path.mul(-0.24).mul(waterClarity)))).mul(1.25);
    const rays = scatterRays(entry, rd, path);
    const phase = float(0.6).add(pow(dot(rd, toSun).max(0), 3).mul(2.4));
    const rayColor = vec3(1.0, 0.95, 0.75).mul(rays).mul(phase).mul(godRayStrength).mul(0.3);
    const baseTint = vec3(0.004, 0.045, 0.06);
    return { color: sampleColor.mul(transmittance).mul(vec3(0.94, 0.99, 1.0)).add(baseTint).add(inscatter).add(rayColor), path, rd, d0, opaque };
  }

  const fresnel = (n: Node<'vec3'>, rd: Node<'vec3'>) => float(0.02).add(float(0.98).mul(float(1).sub(dot(n, rd.negate()).abs().clamp()).pow(5)));

  // ---- Top surface ------------------------------------------------------------------------------------------
  const surfaceMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  surfaceMaterial.fog = false;
  const field = oceanField(positionGeometry.xz, simTime);
  surfaceMaterial.positionNode = vec3(positionGeometry.x, waterLevel.add(field.h), positionGeometry.z);
  const baseNormal = normalize(vec3(field.gx.negate(), 1, field.gz.negate())).toVarying();

  const reflection = reflector({ resolutionScale: 0.5, bounces: false });
  reflection.target.rotation.x = -Math.PI / 2;
  scene.add(reflection.target);
  (reflection as unknown as { reflector: { getVirtualCamera(c: PerspectiveCamera): PerspectiveCamera } }).reflector.getVirtualCamera(camera).layers.set(1);

  surfaceMaterial.colorNode = Fn(() => {
    const fineA = mx_noise_float(vec3(positionWorld.xz.mul(6.5).add(simTime.mul(0.35)), simTime.mul(0.2)));
    const fineB = mx_noise_float(vec3(positionWorld.xz.mul(15).sub(simTime.mul(0.5)), 7.1));
    const N = normalize(baseNormal.add(vec3(fineA, 0, fineB).mul(0.075))).toVar();
    const body = volume(positionWorld, N);
    const F = fresnel(N, body.rd).mul(1.7).min(1);
    const R3 = reflect(body.rd, N).toVar();
    const reflUV = screenUV.flipX().add(N.xz.mul(vec2(-0.05, 0.05)).mul(-1)).clamp(0.002, 0.998);
    const planar = reflection.sample(reflUV).rgb;
    const analytic = skyColor(vec3(R3.x, R3.y.abs(), R3.z));
    const reflected = mix(analytic, planar, 0.85);
    // Sun glitter: tight lobe on the detailed normal plus a soft lobe on the base wave normal.
    const sunDot = dot(R3, toSun).max(0);
    const facet = normalize(N.add(vec3(mx_noise_float(vec3(positionWorld.xz.mul(34).add(simTime.mul(0.6)), simTime.mul(0.9))), 0, mx_noise_float(vec3(positionWorld.xz.mul(41).sub(simTime.mul(0.5)), 3.7))).mul(0.16)));
    const sparkle = pow(dot(reflect(body.rd, facet), toSun).max(0), 1400);
    const glint = sparkle.mul(140).add(pow(sunDot, 40).mul(0.22)).min(7);
    // Shoreline foam from the depth below the surface.
    const depthBelow = body.path.mul(body.rd.y.abs());
    const swirl = mx_noise_float(vec3(positionWorld.xz.mul(4.2), simTime.mul(0.35))).mul(0.5).add(0.5);
    const lap = float(0.2).add(sin(simTime.mul(1.1).add(swirl.mul(6))).mul(0.06));
    const foam = smoothstep(lap, lap.mul(0.35), depthBelow).mul(smoothstep(0.35, 0.75, swirl.add(mx_noise_float(positionWorld.mul(9)).mul(0.25)))).mul(0.85)
      .add(smoothstep(0.55, 0.0, depthBelow).mul(0.18).mul(swirl));
    const surfaceLight = vec3(0.95, 0.98, 1.0);
    const base = body.color.mul(float(1).sub(F)).add(reflected.mul(F)).add(vec3(1.0, 0.86, 0.62).mul(glint).mul(F.mul(6).min(1).max(0.25)));
    const rippleSlope = smoothstep(0.22, 0.65, N.xz.length());
    return mix(base, surfaceLight.mul(1.1), max(foam.min(0.9), rippleSlope.mul(0.42)).mul(float(1).sub(F)));
  })();
  surfaceMaterial.opacityNode = float(1);
  const geometry = new PlaneGeometry(R * 2, R * 2, 224, 224); geometry.rotateX(-Math.PI / 2);
  geometry.boundingSphere = new Sphere(new Vector3(0, WORLD.surface, 0), R * 1.6);
  const surface = new Mesh(geometry, surfaceMaterial);
  surface.name = 'Water surface'; surface.renderOrder = 4; surface.frustumCulled = false;
  scene.add(surface);

  // ---- Side faces --------------------------------------------------------------------------------------------
  const segments = 192;
  const positions: number[] = [], bottoms: number[] = [], isTop: number[] = [], normals: number[] = [], sideId: number[] = [], indices: number[] = [];
  const outward = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  edges.forEach((profile, side) => {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = -R + (2 * R) * i / segments, h = edgeHeight(profile, t);
      const x = side === 0 ? t : side === 1 ? R : side === 2 ? t : -R, z = side === 0 ? -R : side === 1 ? t : side === 2 ? R : t;
      for (const top of [0, 1]) {
        positions.push(x, 0, z); bottoms.push(h); isTop.push(top); normals.push(...outward[side]); sideId.push(side);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      // Winding chosen so the front face points outward for every side.
      if (side === 0 || side === 3) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
    }
  });
  const sideGeometry = new BufferGeometry();
  sideGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  sideGeometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  sideGeometry.setAttribute('aBottom', new Float32BufferAttribute(bottoms, 1));
  sideGeometry.setAttribute('aTop', new Float32BufferAttribute(isTop, 1));
  sideGeometry.setIndex(indices);
  sideGeometry.boundingSphere = new Sphere(new Vector3(0, WORLD.surface / 2, 0), R * 2);

  const aBottom = attribute('aBottom', 'float'), aTop = attribute('aTop', 'float');
  const sideField = oceanField(positionGeometry.xz, simTime);
  const topY = max(aBottom, waterLevel.add(sideField.h)).toVarying();
  const sideNormal = attribute('normal', 'vec3');
  const sidePosition = vec3(positionGeometry.x, mix(aBottom, topY, aTop), positionGeometry.z).add(sideNormal.mul(0.004));

  /** Bright lines: the surface meniscus and the vertical cube corners. */
  const edgeLines = (p: Node<'vec3'>, top: Node<'float'>) => {
    const below = top.sub(p.y).max(0);
    const meniscus = exp(below.div(0.03).mul(below.div(0.03)).negate()).add(exp(below.div(0.16).negate()).mul(0.16));
    const cornerDist = max(float(R).sub(abs(p.x)), float(R).sub(abs(p.z))).max(0);
    return { meniscus, corner: exp(cornerDist.div(0.035).mul(cornerDist.div(0.035)).negate()) };
  };

  const frontMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  frontMaterial.fog = false;
  frontMaterial.positionNode = sidePosition;
  frontMaterial.colorNode = Fn(() => {
    const wobble = mx_noise_float(vec3(positionWorld.xz.mul(1.3).add(positionWorld.y.mul(0.9)), simTime.mul(0.3)));
    const wobbleB = mx_noise_float(vec3(positionWorld.y.mul(3.0), positionWorld.x.add(positionWorld.z).mul(2.2), simTime.mul(0.45)));
    const n0 = normalize(sideNormal);
    const N = normalize(n0.add(vec3(wobble, wobbleB.mul(0.5), wobbleB).mul(0.05).mul(vec3(1, 1, 1)))).toVar();
    const body = volume(positionWorld, N);
    const F = fresnel(n0, body.rd);
    const R3 = reflect(body.rd, N);
    const refl = skyColor(vec3(R3.x, R3.y.abs().mul(0.6).add(R3.y.max(0).mul(0.4)), R3.z)).mul(mix(float(1), float(0.55), smoothstep(0.0, -0.4, R3.y)));
    const lines = edgeLines(positionWorld, topY);
    const rim = vec3(0.86, 1.0, 0.96);
    const sunDot = dot(R3, toSun).max(0);
    const glint = pow(sunDot, 600).mul(6).min(4);
    const rimFresnel = pow(float(1).sub(dot(n0, body.rd.negate()).abs()), 3).mul(0.25);
    return body.color.mul(float(1).sub(F)).add(refl.mul(F.max(rimFresnel).mul(0.7))).add(rim.mul(lines.meniscus.mul(0.55).add(lines.corner.mul(0.35)))).add(vec3(1, 0.85, 0.6).mul(glint).mul(F));
  })();
  frontMaterial.opacityNode = float(1);
  const front = new Mesh(sideGeometry, frontMaterial);
  front.name = 'Water side faces'; front.renderOrder = 5; front.frustumCulled = false;
  scene.add(front);

  // Far walls seen through the block: faint additive edges so the cube reads as a solid body of water.
  const backMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: BackSide, blending: AdditiveBlending });
  backMaterial.fog = false;
  backMaterial.positionNode = sidePosition;
  backMaterial.colorNode = Fn(() => {
    const lines = edgeLines(positionWorld, topY);
    return vec3(0.45, 0.75, 0.72).mul(lines.meniscus.mul(0.30).add(lines.corner.mul(0.20)));
  })();
  backMaterial.opacityNode = float(1);
  const back = new Mesh(sideGeometry, backMaterial);
  back.name = 'Water far walls'; back.renderOrder = 6; back.frustumCulled = false;
  scene.add(back);

  return { surface, front, back, reflection };
}
