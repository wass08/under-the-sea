import { AdditiveBlending, DoubleSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, Vector3 } from 'three/webgpu';
import { Discard, Fn, color, mx_noise_float, positionWorld, smoothstep, uv, vec3 } from 'three/tsl';
import { shaftMask, signedWaterDistance, waterDepth } from './lighting';
import { simTime, sunDirection, sunElevation, TANK } from '../state';

export function createShafts(scene: Scene) {
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  material.colorNode = color('#bcf4d1').mul(1.3);
  material.opacityNode = Fn(() => {
    Discard(signedWaterDistance.greaterThan(0));
    Discard(positionWorld.y.lessThan(TANK.floor + 0.12));
    Discard(positionWorld.x.abs().greaterThan(2.94));
    Discard(positionWorld.z.abs().greaterThan(1.69));
    const feather = smoothstep(0, 0.13, uv().x).mul(smoothstep(1, 0.75, uv().x));
    const noise = mx_noise_float(positionWorld.mul(2).add(vec3(0, simTime.mul(0.12), 0))).mul(0.3).add(0.7);
    return feather.mul(shaftMask.mul(0.8).add(0.015)).mul(noise).mul(sunElevation).mul(waterDepth.mul(-0.3).exp()).mul(0.16);
  })();
  // Six differently rotated sheets fill a 3D region, all containing the sun ray.
  const slabs: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const slab = new Mesh(new PlaneGeometry(6.5, 7), material);
    slab.position.set((i - 2.5) * 0.55, 1.7, Math.sin(i * 2.1) * 0.7);
    slab.renderOrder = 5; scene.add(slab); slabs.push(slab);
  }
  const up = new Vector3(0, 1, 0);
  return { update() {
    slabs.forEach((slab, i) => { slab.quaternion.setFromUnitVectors(up, sunDirection.value); slab.rotateY(i * Math.PI / 6); });
  } };
}
