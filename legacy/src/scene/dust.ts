import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, PointsNodeMaterial, Scene, Sprite } from 'three/webgpu';
import { color, instancedBufferAttribute, mix, smoothstep, uv } from 'three/tsl';
import { shaftMask, submerged, waterDepth } from './lighting';
import { lampOn, random, simTime, sunElevation, TANK, waterHeight, waterNormal } from '../state';

export function createDust(scene: Scene) {
  const count = 440, rng = random(171), data = new Float32Array(count * 3), sizes = new Float32Array(count);
  const seeds = Array.from({ length: count }, () => ({ x: (rng() - 0.5) * (TANK.width - .35), fraction: Math.pow(rng(), 1.4), z: (rng() - 0.5) * (TANK.depth - .4), size: 1.3 + rng() * 2.1 }));
  const positions = new InstancedBufferAttribute(data, 3).setUsage(DynamicDrawUsage), size = new InstancedBufferAttribute(sizes, 1).setUsage(DynamicDrawUsage);
  const material = new PointsNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
  material.positionNode = instancedBufferAttribute(positions, 'vec3'); material.sizeNode = instancedBufferAttribute(size, 'float');
  material.colorNode = mix(color('#dae6c6'), color('#a9fff1'), submerged).mul(waterDepth.mul(-0.12).exp()).mul(shaftMask.mul(lampOn).mul(sunElevation).mul(1.5).add(lampOn.mul(.55).add(.15)));
  // The fragment fade uses the same tilted water plane as every other water layer.
  material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length()).mul(smoothstep(0, 0.055, waterDepth)).mul(0.34);
  const dust = new Sprite(material); dust.count = count; dust.frustumCulled = false; dust.renderOrder = 6; dust.name = 'Submerged motes'; scene.add(dust);
  let live = 0, above = 0;
  return { update() {
    const time = simTime.value, n = waterNormal.value; live = above = 0;
    seeds.forEach((s, i) => {
      const phase = s.x * 12 + s.fraction * 8;
      const x = s.x + Math.sin(time * 0.13 + phase) * 0.07, z = s.z + Math.sin(time * 0.17 + phase) * 0.07;
      const surface = waterHeight.value - (n.x * x + n.z * z) / n.y;
      const y = TANK.floor + 0.15 + s.fraction * Math.max(0, surface - TANK.floor - 0.23) + Math.sin(time * 0.21 + phase) * 0.045;
      data.set([x, y, z], i * 3);
      sizes[i] = surface > TANK.floor + 0.18 && y < surface - 0.015 ? s.size : 0;
      if (sizes[i] > 0) { live++; if ((y - waterHeight.value) * n.y + x * n.x + z * n.z > 0) above++; }
    });
    dust.visible = live > 0; positions.needsUpdate = size.needsUpdate = true;
  }, get count() { return live; }, get aboveSurface() { return above; } };
}
