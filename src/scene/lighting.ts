import { DirectionalLight, HemisphereLight, PointLight, Scene, Vector3, Matrix4 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, vec2, vec3, color, shadow, smoothstep, uniform, exp, sin, mix, reference, lights } from 'three/tsl';
import { createCausticsUniforms, worley } from '../lib/worley';
import { WORLD } from '../config';
import { lanternPosition, simTime, sunDirection, waterLevel } from '../state';
import { createNightEnvironment } from './night';

/**
 * User-facing moon parameters (degrees). The directional light keeps its historical "sun" names: at night it is the
 * moon, low over the far ridges to the right of the default view, so it hangs in the fogged sky.
 */
const q = new URLSearchParams(location.search).get('sun')?.split(',').map(Number);
export const sunParams = { azimuth: q?.[0] ?? 252, elevation: q?.[1] ?? 7.5, intensity: 0.9 };
/** godRays: the moon shafts underwater (kept low at night: they lift the blacks the lantern should own). */
export const lookParams = { caustics: 3, godRays: 0.1, clarity: 1 };
/** Caustic exposure. Callers multiply by it linearly; causticAtSurface pre-divides a soft shoulder so 3 stays bounded. */
export const causticStrength = uniform(lookParams.caustics);
export const godRayStrength = uniform(lookParams.godRays);
export const waterClarity = uniform(0.7);
/** Direction toward the sun. */
export const toSun = sunDirection.negate();
/** Sun shadow visibility (0..1) at the fragment being shaded; set once the sun exists. */
export const sunVisibilityRef: { node: Node<'float'> } = { node: float(1) };
export const sunRadianceRef: { node: Node<'vec3'> } = { node: vec3(1) };

export function applySunAngles() {
  const az = sunParams.azimuth * Math.PI / 180, el = sunParams.elevation * Math.PI / 180;
  const v = new Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  sunDirection.value.copy(v).negate().normalize();
}

// ---- Caustics -----------------------------------------------------------------------------------------------
export const causticParams = createCausticsUniforms();
causticParams.scaleA.value = 0.42; causticParams.scaleB.value = 0.71; causticParams.speed.value = 0.26;
causticParams.sharpness.value = 10; causticParams.intensity.value = 1; causticParams.rgbOffset.value = 0.02;
/** E = pattern × strength × exposure; strength 3 lands a typical filament at E≈1.6, just past the shoulder's knee. */
const CAUSTIC_EXPOSURE = 0.7;
/** Ceiling of the shouldered light (before the caller's per-material gain and the depth compensation below). */
const CAUSTIC_CEILING = 1.0;
/**
 * underwaterShading already darkens caustics by the depth-tinted albedo (waterTransmittance + bed darkening) and then
 * again by exp(−0.05·depth). Undo that second falloff (capped at 10 units, ≈1.65×) so the bed network keeps contrast
 * against the sun-lit sand; transmittance still dims and tints it once.
 */
const CAUSTIC_DEPTH_FALLOFF = 0.05, CAUSTIC_DEPTH_CAP = 10;
/** 1 on a Voronoi edge (F2 − F1 → 0), falling towards cell centres. */
const ridge = (w: ReturnType<typeof worley>) => float(1).sub(w.f2.sub(w.f1).clamp());
/**
 * Sun caustics at surface point `s`: one refraction-warped Worley network (A) whose filaments are brightened where a
 * second, finer layer (B) reinforces them, both drifting along one current, under a slow wave-group swell. Deeper
 * light defocuses mildly (wider lines, slight gap fill). Output is pre-shouldered against causticStrength (see below).
 */
export function causticAtSurface(s: Node<'vec2'>, depth: Node<'float'>) {
  const p = causticParams, t = simTime.mul(p.speed);
  // Low-frequency refraction warp shared by both layers, so filaments bend together like a refracting swell.
  const warp = vec2(
    sin(s.x.mul(0.53).add(s.y.mul(0.31)).add(t.mul(1.7))),
    sin(s.y.mul(0.47).sub(s.x.mul(0.37)).sub(t.mul(1.4))),
  ).mul(0.55);
  const q = s.add(warp);
  // One current direction with slightly different rates (≈0.26 / 0.20 u/s): coherent drift, no counter-scrolling shimmer.
  const drift = vec2(0.86, 0.5).mul(t);
  const a = worley(q.mul(p.scaleA).add(drift.mul(0.42)), t);
  const b = worley(q.mul(p.scaleB).add(drift.mul(0.55)).add(vec2(7.3, 3.1)), t.mul(0.77));
  // Mild defocus with depth: lines widen (sharpness 10 → 7) and only a little light spills into the gaps, so the bed
  // keeps dark cells between soft filaments rather than relaxing into a uniform glow.
  const focus = smoothstep(1.0, 10.0, depth);
  const sharp = p.sharpness.mul(mix(float(1), float(0.7), focus));
  const rA = ridge(a), rB = ridge(b);
  const lineA = rA.pow(sharp), lineB = rB.pow(sharp.mul(1.3)), haloB = rB.pow(sharp.mul(0.3));
  // Primary filaments vary 0.45..1.15 along their length where B's halo crosses; B adds faint secondary threads.
  const net = lineA.mul(haloB.mul(0.7).add(0.45)).add(lineB.mul(0.3)).div(1.45);
  // Broad wave-group swell (0.6..1.1) so whole patches brighten and dim slowly instead of uniform tiling.
  const swell = sin(s.x.mul(0.21).add(s.y.mul(0.13)).add(t.mul(0.9))).mul(sin(s.y.mul(0.19).sub(s.x.mul(0.11)).sub(t.mul(0.6)))).mul(0.25).add(0.85);
  const onset = smoothstep(0.02, 0.5, depth);
  const pattern = mix(net, float(0.16), focus.mul(0.12)).mul(swell).mul(onset).mul(p.intensity);
  // Soft shoulder: callers multiply by causticStrength linearly, so return pattern·k·(1 − e^−E)/E with E = pattern·k·strength.
  // After their ×strength this becomes (1 − e^−E): linear for small strength, bounded at CAUSTIC_CEILING (× depthComp) for strong ones.
  const e = pattern.mul(causticStrength).mul(CAUSTIC_EXPOSURE).max(1e-4);
  const lit = float(1).sub(exp(e.negate()));
  const shoulder = lit.div(e);
  // Faint dispersion stand-in: dim fringes lean cyan, bright cores lean warm sunlight (luminance ≈ preserved).
  const tint = mix(vec3(0.88, 1.0, 1.08), vec3(1.07, 1.0, 0.9), lit.div(0.85).clamp());
  const depthComp = exp(depth.clamp(0, CAUSTIC_DEPTH_CAP).mul(CAUSTIC_DEPTH_FALLOFF));
  return tint.mul(pattern.mul(CAUSTIC_EXPOSURE * CAUSTIC_CEILING).mul(shoulder).mul(depthComp));
}
/** Feature switches for profiling: ?off=plankton,flora,reflect,rays,props,bubbles,water,terrain,horizon,caustics,ripples */
export const OFF = new Set((new URLSearchParams(location.search).get('off') ?? '').split(',').filter(Boolean));

/**
 * Lights for materials that shade the lantern themselves (everything underwater: terrain, flora, fish).
 * The real PointLight only reaches the boat, the fisherman and other above-water props; underwater surfaces add the
 * lantern through lanternLight() with water absorption and caustics instead. Filled in by createLighting().
 */
export const underwaterLights: { moon: DirectionalLight | null; hemi: HemisphereLight | null } = { moon: null, hemi: null };
/** A LightsNode with only the moon + sky fill, for `material.lightsNode` on underwater materials. */
export const moonOnly = () => lights([underwaterLights.moon!, underwaterLights.hemi!].filter(Boolean));

// ---- Moon + lantern + environment ----------------------------------------------------------------------------
export async function createLighting(scene: Scene) {
  applySunAngles();
  const sun = new DirectionalLight('#9fb8ff', sunParams.intensity);
  sunRadianceRef.node = reference('color', 'color', sun).rgb.mul(reference('intensity', 'float', sun));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const hemi = new HemisphereLight('#4f6fb8', '#06080f', 0.12);
  // The paper lantern on the boat: warm, no shadow map. Its position follows lanternPosition (set by the rig).
  const lantern = new PointLight('#ffa257', 7, 14, 1.6);
  lantern.name = 'Lantern light';
  scene.add(sun, sun.target, hemi, lantern);
  underwaterLights.moon = sun; underwaterLights.hemi = hemi;
  // The planar reflection camera only renders layer 1. Lights must be visible to it too: otherwise its pass sees an
  // empty light set, the scene's light cache key flips whenever the reflection starts or stops (every surface
  // crossing), and three rebuilds every material that uses the scene lights (~150 ms stall).
  for (const light of [sun, hemi, lantern]) light.layers.enable(1);
  const sunShadow = shadow(sun);
  sun.shadow.shadowNode = sunShadow;
  const visibility = vec3(sunShadow as unknown as Node<'vec3'>).r;
  sunVisibilityRef.node = visibility;

  // Procedural night HDRI: blue dome, moon disc + halo, stars. Provides the cool fill and moon highlights.
  scene.environment = createNightEnvironment(sunDirection.value.clone().negate());
  scene.environmentIntensity = 0.6;

  const center = new Vector3(0, WORLD.surface * 0.6, 0), view = new Matrix4();
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
    box(0, WORLD.surface + 11, h, true);
    box(WORLD.ground, WORLD.ground, 90, false);
    cam.left = x0 - 0.3; cam.right = x1 + 0.3; cam.bottom = y0 - 0.3; cam.top = y1 + 0.3;
    cam.near = Math.max(0.5, z0 - 1); cam.far = z1 + 2;
    cam.updateProjectionMatrix();
  }
  fitShadow();
  const syncLantern = () => { lantern.position.copy(lanternPosition.value); };
  return { sun, hemi, lantern, syncLantern, visibility, fitShadow, sunColor: color('#9fb8ff') };
}

/** Fog/tint the sun undergoes on its way through `depth` units of water. */
export const waterTransmittance = (depth: Node<'float'>) => exp(vec3(0.11, 0.04, 0.023).mul(waterClarity).mul(depth.max(0)).negate());
export const waterDepthAt = (y: Node<'float'>) => waterLevel.sub(y);
