import type { Node } from 'three/webgpu';
import { AdditiveBlending, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PointsNodeMaterial, Scene, Sprite, SphereGeometry } from 'three/webgpu';
import { float, hash, instanceIndex, instancedBufferAttribute, mix, mx_noise_float, normalWorld, cameraPosition, positionWorld, positionLocal, sin, smoothstep, uv, vec3, color, fract } from 'three/tsl';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { random } from '../lib/random';
import { godRayStrength, sunSurfacePoint } from './lighting';
import { terrainHeight } from './field';
import { emitRipple } from '../lib/ocean';

const R = WORLD.half;

/** Plankton / dust motes drifting in the water, catching the sun beams. Fully GPU-driven. */
export function createPlankton(scene: Scene, count = 900) {
  const id = float(instanceIndex);
  const r = (k: number) => hash(id.add(k));
  const phase = r(1).mul(6.283);
  const t = simTime;
  const x = r(2).sub(0.5).mul(2 * R - 0.6).add(sin(t.mul(0.09).add(phase)).mul(0.25));
  const y = r(3).pow(0.8).mul(WORLD.surface - WORLD.bed - 0.6).add(WORLD.bed + 0.35).add(sin(t.mul(0.13).add(phase.mul(1.3))).mul(0.2));
  const z = r(4).sub(0.5).mul(2 * R - 0.6).add(sin(t.mul(0.11).add(phase.mul(0.7))).mul(0.25));
  const position = vec3(x, y, z);
  const material = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  material.positionNode = position;
  material.sizeNode = r(5).mul(2.2).add(1.4);
  const s = sunSurfacePoint(position);
  const beam = smoothstep(0.35, 0.85, mx_noise_float(vec3(s.mul(0.42), t.mul(0.16))).mul(0.5).add(0.5));
  const twinkle = sin(t.mul(r(6).mul(1.5).add(0.4)).add(phase)).mul(0.5).add(0.5);
  const depthFade = waterLevel.sub(y).mul(-0.11).exp();
  material.colorNode = mix(color('#8fd8d0'), color('#fff1cf'), beam.mul(0.8)).mul(beam.mul(godRayStrength).mul(1.6).add(0.35)).mul(depthFade);
  material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length()).mul(twinkle.mul(0.6).add(0.4)).mul(0.55).mul(smoothstep(0.0, 0.35, waterLevel.sub(y)));
  const points = new Sprite(material); points.count = count; points.frustumCulled = false; points.renderOrder = 9; points.name = 'Plankton';
  scene.add(points);
  return points;
}

/** A few bubble streams rising from the seabed; each pops on the surface with a tiny ripple. */
export function createBubbles(scene: Scene) {
  const vents = [[-4.3, 3.6], [4.5, -3.4], [0.8, -4.8], [-1.0, 4.9]].map(([x, z]) => ({ x, z, y: terrainHeight(x, z) }));
  const perVent = 16, count = vents.length * perVent, rng = random(77);
  const origin = new Float32Array(count * 3), params = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = vents[i % vents.length];
    origin.set([v.x + (rng() - 0.5) * 0.12, v.y + 0.02, v.z + (rng() - 0.5) * 0.12], i * 3);
    params.set([0.03 + Math.pow(rng(), 1.8) * 0.07, rng(), 0.16 + rng() * 0.14], i * 3); // radius, phase, cycles per second
  }
  const o = instancedBufferAttribute(new InstancedBufferAttribute(origin, 3), 'vec3') as unknown as Node<'vec3'>, p = instancedBufferAttribute(new InstancedBufferAttribute(params, 3), 'vec3') as unknown as Node<'vec3'>;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const age = fract(simTime.mul(p.z).add(p.y));
  const rise = waterLevel.sub(o.y).mul(age.pow(0.92));
  const wiggle = sin(age.mul(11).add(p.y.mul(20))).mul(age.mul(0.05).add(0.02));
  const pop = float(1).sub(smoothstep(0.965, 1.0, age));
  const radius = p.x.mul(age.mul(0.7).add(0.75)).mul(pop);
  material.positionNode = positionLocal.mul(radius).add(vec3(o.x.add(wiggle), o.y.add(rise), o.z.add(wiggle.mul(0.7))));
  const view = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(view).abs().clamp()).pow(2.2);
  material.colorNode = mix(color('#cffaf2'), color('#ffffff'), rim);
  material.opacityNode = rim.mul(0.85).add(0.08).mul(waterLevel.sub(o.y.add(rise)).mul(-0.08).exp());
  const mesh = new InstancedMesh(new SphereGeometry(1, 10, 8), material, count);
  mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.name = 'Bubbles';
  scene.add(mesh);
  const timers = vents.map((_, i) => i * 0.31);
  return {
    mesh,
    update(dt: number) {
      vents.forEach((v, i) => {
        timers[i] -= dt;
        if (timers[i] <= 0) { timers[i] = 0.9 + Math.random() * 0.8; emitRipple(v.x + (Math.random() - 0.5) * 0.2, v.z + (Math.random() - 0.5) * 0.2, 0.12, true); }
      });
    },
  };
}
