import { Mesh, MeshStandardNodeMaterial, PlaneGeometry, Scene } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, cameraPosition, color, float, mix, output, positionWorld, positionWorldDirection, smoothstep, vec2, vec3, vec4, mx_noise_float } from 'three/tsl';
import { WORLD } from '../config';
import { waterLevel } from '../state';
import { causticAtSurface, causticStrength, toSun } from './lighting';

export const skyParams = { fogDistance: 58 };
const zenith = color('#052540'), upper = color('#0f5478'), horizonCool = color('#58b4c2'), horizonWarm = color('#f7ae7c');

/** Sky/horizon gradient with a soft sun glow. dir is a normalized world direction. */
export const skyColor = Fn(([dir]: [Node<'vec3'>]) => {
  const y = dir.y.max(0);
  const c = dir.dot(toSun).max(0);
  const warm = smoothstep(0.55, 0.99, c);
  const horizon = mix(horizonCool, horizonWarm, warm);
  const body = mix(upper, zenith, smoothstep(0.15, 0.85, y));
  const sky = mix(horizon, body, smoothstep(0.0, 0.42, y).pow(0.8));
  const glow = vec3(1.0, 0.72, 0.42).mul(c.pow(10).mul(0.35).add(c.pow(64).mul(0.9)).add(c.pow(900).mul(6.0)));
  return sky.add(glow);
});
const horizonAt = (dir: Node<'vec3'>) => skyColor(vec3(dir.x, 0, dir.z).normalize());

export function createAtmosphere(scene: Scene, sunVisibility: Node<'float'>) {
  scene.backgroundNode = skyColor(positionWorldDirection);
  scene.backgroundIntensity = 1;

  // Ground far below: dark teal slate that dissolves into the horizon; hosts the diorama's shadow and the caustic pool.
  const ground = new MeshStandardNodeMaterial({ color: '#5d7c82', roughness: 0.95, metalness: 0 });
  const viewDir = positionWorld.sub(cameraPosition);
  const dist = viewDir.length();
  const dir = viewDir.div(dist);
  // Radial falloff darkens the ground near the base of the diorama (ambient occlusion) and lights a soft vignette.
  const patchDist = positionWorld.xz.abs().sub(vec2(WORLD.half + 0.5)).max(0).length();
  const contact = smoothstep(0.0, 5.5, patchDist).mul(0.55).add(0.45);
  const tone = mx_noise_float(vec3(positionWorld.xz.mul(0.35), 0)).mul(0.06).add(1);
  ground.colorNode = color('#1a4653').mul(contact).mul(tone);

  // Light that passed through the water block and left through a side face (analytic ray vs water box).
  const rayD = toSun;
  const safe = (v: Node<'float'>) => v.greaterThanEqual(0).select(v.max(1e-4), v.min(-1e-4));
  const d = vec3(safe(rayD.x), safe(rayD.y), safe(rayD.z));
  const lo = vec3(-WORLD.half, WORLD.bed + 0.4, -WORLD.half), hi = vec3(WORLD.half, WORLD.surface, WORLD.half);
  const t0 = lo.sub(positionWorld).div(d), t1 = hi.sub(positionWorld).div(d);
  const tn = t0.min(t1), tf = t0.max(t1);
  const entry = tn.x.max(tn.y).max(tn.z).max(0), exit = tf.x.min(tf.y).min(tf.z);
  const through = exit.sub(entry);
  const waterRay = smoothstep(0.0, 0.6, through);
  const inPath = through.max(0);
  const surfaceHit = positionWorld.xz.add(rayD.xz.mul(waterLevel.sub(positionWorld.y).div(rayD.y.max(0.15))));
  ground.emissiveNode = Fn(() => {
    const light = vec3(0).toVar();
    If(waterRay.greaterThan(0.001), () => {
      const cst = causticAtSurface(surfaceHit, float(2.0));
      light.assign(cst.mul(vec3(0.35, 0.85, 1.0)).mul(waterRay).mul(inPath.mul(-0.05).exp()));
    });
    return light.mul(sunVisibility).mul(causticStrength).mul(0.32);
  })();
  const fog = float(1).sub(dist.div(skyParams.fogDistance * 1.6).pow(1.5).negate().exp()).clamp();
  ground.outputNode = vec4(mix(output.rgb, horizonAt(dir), fog), 1);
  ground.fog = false;
  const geometry = new PlaneGeometry(1500, 1500); geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, ground);
  mesh.position.y = WORLD.ground; mesh.receiveShadow = true; mesh.name = 'Ground';
  scene.add(mesh);
  return { ground: mesh };
}
