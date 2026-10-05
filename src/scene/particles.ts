import type { Node } from 'three/webgpu';
import { AdditiveBlending, DataTexture, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PointsNodeMaterial, Scene, Sprite, SphereGeometry } from 'three/webgpu';
import { float, hash, instanceIndex, instancedBufferAttribute, mix, normalWorld, cameraPosition, positionWorld, positionLocal, sin, smoothstep, texture, uv, vec3, color, fract, reflect } from 'three/tsl';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { random } from '../lib/random';
import { godRayStrength } from './lighting';
import { lanternLight } from './night';
import { surfaceShaft, waterSun } from './rays';
import { terrainHeight } from './field';
import { emitRipple, oceanField } from '../lib/ocean';
import { skyColor } from './atmosphere';

const R = WORLD.half;

/** Bioluminescent plankton drifting in the water: dim motes, a few flaring cyan, warm near the lantern. Fully GPU-driven. */
export function createPlankton(scene: Scene, heightTexture: DataTexture, count = 6000) {
  const id = float(instanceIndex);
  const r = (k: number) => hash(id.mul(1 + k * 17.13).add(k * 71.7));
  const phase = r(1).mul(6.283);
  const t = simTime;
  const x = r(2).sub(0.5).mul(2 * R - 1.5).add(sin(t.mul(0.09).add(phase)).mul(0.5));
  const y = r(3).pow(0.8).mul(WORLD.surface - WORLD.bed - 0.6).add(WORLD.bed + 0.35).add(sin(t.mul(0.13).add(phase.mul(1.3))).mul(0.2));
  const z = r(4).sub(0.5).mul(2 * R - 1.5).add(sin(t.mul(0.11).add(phase.mul(0.7))).mul(0.5));
  const position = vec3(x, y, z);
  const material = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  material.positionNode = position;
  // Mostly fine suspended silt with a few larger motes; grow gently in close views.
  material.sizeNode = r(5).pow(3).mul(2.8).add(1.1).mul(float(48).div(cameraPosition.sub(position).length().clamp(14, 90)));
  const under = waterLevel.sub(y).max(0);
  const s = position.xz.add(waterSun.xz.mul(under.div(waterSun.y)));
  const beam = surfaceShaft(s, under).mul(2.4).clamp();
  const twinkle = sin(t.mul(r(6).mul(0.35).add(0.15)).add(phase)).mul(0.5).add(0.5);
  const depthFade = waterLevel.sub(y).mul(-0.06).exp();
  // A third of the motes are dinoflagellates: they flare cyan-green now and then, the rest only catch light.
  const flare = smoothstep(0.93, 1.0, sin(t.mul(r(6).mul(0.9).add(0.3)).add(phase.mul(3))).mul(0.5).add(0.5)).mul(r(7).greaterThan(0.66).toFloat());
  const lamp = lanternLight(position, vec3(0, 1, 0), 1.0);
  material.colorNode = color('#2a4a66').mul(beam.mul(godRayStrength).mul(0.8).add(0.35)).mul(depthFade)
    .add(color('#5dffd8').mul(flare.mul(2.2))).add(lamp.mul(0.35));
  const ground = texture(heightTexture, position.xz.div(R * 2).add(0.5)).level(float(0)).r;
  const wet = smoothstep(0.08, 0.35, y.sub(ground)).mul(smoothstep(0.15, 0.5, waterLevel.sub(y)));
  material.opacityNode = uv().sub(0.5).length().pow(2).mul(-20).exp().mul(twinkle.mul(0.35).add(0.65)).mul(0.42).mul(wet);
  const points = new Sprite(material); points.count = count; points.frustumCulled = false; points.renderOrder = 9; points.name = 'Plankton';
  scene.add(points);
  return points;
}

/** A few bubble streams rising from the seabed; each pops on the surface with a tiny ripple. */
export function createBubbles(scene: Scene) {
  const vents = [[-9, 7], [6, -3]].map(([x, z]) => ({ x, z, y: terrainHeight(x, z) }));
  const perVent = 12, count = vents.length * perVent, rng = random(77);
  const origin = new Float32Array(count * 3), params = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = vents[i % vents.length];
    origin.set([v.x + (rng() - 0.5) * 0.12, v.y + 0.02, v.z + (rng() - 0.5) * 0.12], i * 3);
    params.set([0.035 + Math.pow(rng(), 1.8) * 0.095, rng(), 0.10 + rng() * 0.09], i * 3); // radius, phase, cycles per second
  }
  const o = instancedBufferAttribute(new InstancedBufferAttribute(origin, 3), 'vec3') as unknown as Node<'vec3'>, p = instancedBufferAttribute(new InstancedBufferAttribute(params, 3), 'vec3') as unknown as Node<'vec3'>;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const age = fract(simTime.mul(p.z).add(p.y));
  const top = waterLevel.add(oceanField(o.xz, simTime).h);
  const rise = top.sub(o.y).mul(age.pow(0.92));
  const wiggle = sin(age.mul(11).add(p.y.mul(20))).mul(age.mul(0.10).add(0.02));
  const pop = smoothstep(0.0, 0.025, age).mul(float(1).sub(smoothstep(0.985, 1.0, age)));
  const radius = p.x.mul(age.mul(0.7).add(0.75)).mul(pop);
  const wobble = sin(simTime.mul(3).add(p.y.mul(31))).mul(0.045);
  material.positionNode = positionLocal.mul(vec3(wobble.add(1), float(0.96).sub(wobble), float(1).sub(wobble.mul(0.6)))).mul(radius).add(vec3(o.x.add(wiggle), o.y.add(rise), o.z.add(wiggle.mul(0.7))));
  const view = cameraPosition.sub(positionWorld).normalize();
  const rim = float(1).sub(normalWorld.dot(view).abs().clamp()).pow(3.5);
  const glint = normalWorld.dot(waterSun.add(view).normalize()).max(0).pow(100);
  const reflected = skyColor(reflect(view.negate(), normalWorld)).min(1.3);
  material.colorNode = mix(reflected, color('#eefaff'), rim.mul(0.6)).add(glint.mul(1.4));
  material.opacityNode = rim.mul(0.32).add(glint.mul(0.4)).add(0.012).mul(waterLevel.sub(o.y.add(rise)).max(0).mul(-0.055).exp());
  const mesh = new InstancedMesh(new SphereGeometry(1, 32, 24), material, count);
  mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.name = 'Bubbles';
  scene.add(mesh);
  const cycles = Array.from({ length: count }, (_, i) => Math.floor(simTime.value * params[i * 3 + 2] + params[i * 3 + 1]));
  return {
    mesh,
    update(_dt: number) {
      for (let i = 0; i < count; i++) {
        const cycle = Math.floor(simTime.value * params[i * 3 + 2] + params[i * 3 + 1]);
        if (cycle > cycles[i]) {
          const wiggle = Math.sin(11 + params[i * 3 + 1] * 20) * 0.12;
          emitRipple(origin[i * 3] + wiggle, origin[i * 3 + 2] + wiggle * 0.7, params[i * 3] * 0.5, true);
        }
        cycles[i] = cycle;
      }
    },
  };
}
