import { AdditiveBlending, InstancedBufferAttribute, PointsNodeMaterial, Scene, Sprite } from 'three/webgpu';
import { color, instancedBufferAttribute, mix, sin, smoothstep, uv, vec3 } from 'three/tsl';
import { shaftMask, submerged, waterDepth } from './lighting';
import { random, simTime, sunElevation, TANK } from '../state';

export function createDust(scene: Scene) {
  const count = 440, rng = random(171), data = new Float32Array(count * 3), sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    data[i * 3] = (rng() - 0.5) * 5.65;
    data[i * 3 + 1] = TANK.floor + 0.2 + Math.pow(rng(), 1.4) * 3.05;
    data[i * 3 + 2] = (rng() - 0.5) * 3.1;
    sizes[i] = 1.3 + rng() * 2.1;
  }
  const positions = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(data, 3), 'vec3');
  const phase = positions.x.mul(12).add(positions.y.mul(8));
  const drift = vec3(sin(simTime.mul(0.13).add(phase)).mul(0.07), sin(simTime.mul(0.21).add(phase)).mul(0.08), sin(simTime.mul(0.17).add(phase)).mul(0.07));
  const material = new PointsNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
  material.positionNode = positions.add(drift);
  material.sizeNode = instancedBufferAttribute<'float'>(new InstancedBufferAttribute(sizes, 1), 'float');
  material.colorNode = mix(color('#dae6c6'), color('#a9fff1'), submerged).mul(waterDepth.mul(-0.12).exp()).mul(shaftMask.mul(sunElevation).mul(1.5).add(0.7));
  const softCircle = smoothstep(0.5, 0.05, uv().sub(0.5).length());
  material.opacityNode = softCircle.mul(sin(simTime.mul(0.7).add(phase)).mul(0.15).add(0.34));
  const dust = new Sprite(material); dust.count = count; dust.frustumCulled = false; dust.renderOrder = 6; scene.add(dust);
  return dust;
}
