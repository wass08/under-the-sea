import { DirectionalLight, EquirectangularReflectionMapping, HemisphereLight, Scene, Vector3, Matrix4 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { float, vec2, vec3, color, shadow, smoothstep, uniform, exp } from 'three/tsl';
import { createCausticsUniforms, worley } from '../lib/worley';
import { WORLD } from '../config';
import { simTime, sunDirection, waterLevel } from '../state';

/** User-facing sun parameters (degrees). */
const q = new URLSearchParams(location.search).get('sun')?.split(',').map(Number);
export const sunParams = { azimuth: q?.[0] ?? 198, elevation: q?.[1] ?? 30, intensity: 5.2 };
export const lookParams = { caustics: 1, godRays: 1, clarity: 1 };
export const causticStrength = uniform(1);
export const godRayStrength = uniform(1);
export const waterClarity = uniform(1);
/** Direction toward the sun. */
export const toSun = sunDirection.negate();
/** Sun shadow visibility (0..1) at the fragment being shaded; set once the sun exists. */
export const sunVisibilityRef: { node: Node<'float'> } = { node: float(1) };

export function applySunAngles() {
  const az = sunParams.azimuth * Math.PI / 180, el = sunParams.elevation * Math.PI / 180;
  const v = new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  sunDirection.value.copy(v).negate().normalize();
}

// ---- Caustics -----------------------------------------------------------------------------------------------
export const causticParams = createCausticsUniforms();
causticParams.scaleA.value = 0.42; causticParams.scaleB.value = 0.68; causticParams.speed.value = 0.30;
causticParams.sharpness.value = 18; causticParams.intensity.value = 1.35; causticParams.rgbOffset.value = 0.02;
/** Point on the surface plane from which sunlight reaches `p` (world position node). */
export const sunSurfacePoint = (p: Node<'vec3'>) => p.xz.sub(sunDirection.xz.mul(p.y.sub(waterLevel).div(sunDirection.y.min(-0.15))));
/** Two-layer Worley caustics (same field as lib/worley level 3, without the per-channel dispersion: 3x cheaper). */
export function causticAtSurface(s: Node<'vec2'>, depth: Node<'float'>) {
  const p = causticParams, t = simTime.mul(p.speed);
  const a = worley(s.mul(p.scaleA).add(vec2(t.mul(0.33), t.mul(0.12))), t);
  const b = worley(s.mul(p.scaleB).sub(vec2(t.mul(0.20), t.mul(0.29))).add(7.3), t.mul(0.83));
  const edgeA = float(1).sub(a.f2.sub(a.f1).clamp()).pow(p.sharpness), edgeB = float(1).sub(b.f2.sub(b.f1).clamp()).pow(p.sharpness);
  return vec3(edgeA.mul(edgeB).sqrt().mul(p.intensity).mul(smoothstep(0, 0.15, depth)));
}
/** Feature switches for profiling: ?off=plankton,flora,reflect,rays,palms,bubbles */
export const OFF = new Set((new URLSearchParams(location.search).get('off') ?? '').split(',').filter(Boolean));
export function causticAt(p: Node<'vec3'>, depth: Node<'float'>) { return causticAtSurface(sunSurfacePoint(p), depth); }

// ---- Sun + environment --------------------------------------------------------------------------------------
export async function createLighting(scene: Scene) {
  applySunAngles();
  const sun = new DirectionalLight('#ffd7a3', sunParams.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const hemi = new HemisphereLight('#bfe2ff', '#9c8763', 0.5);
  scene.add(sun, sun.target, hemi);
  const sunShadow = shadow(sun);
  sun.shadow.shadowNode = sunShadow;
  const visibility = vec3(sunShadow as unknown as Node<'vec3'>).r;
  sunVisibilityRef.node = visibility;

  try {
    const hdr = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}hdri/sky.hdr`);
    hdr.mapping = EquirectangularReflectionMapping;
    scene.environment = hdr; scene.environmentIntensity = 0.7;
  } catch (error) { console.warn('HDRI unavailable, using hemisphere light only', error); }

  const center = new Vector3(0, 8, 0), view = new Matrix4();
  /** Fit the orthographic shadow frustum tightly around the diorama (and the ground patch it shadows). */
  function fitShadow() {
    const dir = sunDirection.value.clone().normalize();
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(dir, -120);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    view.lookAt(sun.position, center, new Vector3(0, 1, 0)).setPosition(sun.position);
    const inv = view.clone().invert();
    const cam = sun.shadow.camera;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    const p = new Vector3();
    const h = WORLD.half + 0.4;
    const box = (yMin: number, yMax: number, half: number, lateral: boolean) => {
      for (const sx of [-1, 1]) for (const sy of [yMin, yMax]) for (const sz of [-1, 1]) {
        p.set(sx * half, sy, sz * half).applyMatrix4(inv);
        if (lateral) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        z0 = Math.min(z0, -p.z); z1 = Math.max(z1, -p.z);
      }
    };
    box(0, 21, h, true);
    box(WORLD.ground, WORLD.ground, 90, false);
    cam.left = x0 - 0.3; cam.right = x1 + 0.3; cam.bottom = y0 - 0.3; cam.top = y1 + 0.3;
    cam.near = Math.max(0.5, z0 - 1); cam.far = z1 + 2;
    cam.updateProjectionMatrix();
  }
  fitShadow();
  return { sun, hemi, visibility, fitShadow, sunColor: color('#ffd7a3') };
}

/** Fog/tint the sun undergoes on its way through `depth` units of water. */
export const waterTransmittance = (depth: Node<'float'>) => exp(vec3(0.11, 0.04, 0.023).mul(waterClarity).mul(depth.max(0)).negate());
export const waterDepthAt = (y: Node<'float'>) => waterLevel.sub(y);
