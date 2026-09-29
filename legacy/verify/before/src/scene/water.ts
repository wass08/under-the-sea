import { BoxGeometry, Color, DoubleSide, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, Scene, Vector3 } from 'three/webgpu';
import { Fn, Discard, float, bumpMap, color, mx_noise_float, positionWorld, vec3 } from 'three/tsl';
import { signedWaterDistance, waterDepth } from './lighting';
import { simTime, state, TANK, waterHeight, waterNormal } from '../state';

export function createWater(scene: Scene) {
  const surfaceMaterial = new MeshPhysicalNodeMaterial({ color: '#c4ede4', transmission: 0.94, roughness: 0.095, metalness: 0, ior: 1.333, thickness: 0.22, attenuationColor: new Color('#268c87'), attenuationDistance: 3, side: DoubleSide, depthWrite: false });
  const waves = mx_noise_float(positionWorld.mul(vec3(3.5, 0, 3.5)).add(vec3(simTime.mul(0.24), simTime.mul(0.17), 0)))
    .add(positionWorld.x.mul(7).add(positionWorld.z.mul(4)).sub(simTime.mul(1.6)).sin().mul(0.25));
  surfaceMaterial.normalNode = bumpMap(waves, float(0.035));
  const geometry = new PlaneGeometry(TANK.width - 0.09, TANK.depth - 0.09, 32, 20);
  geometry.rotateX(-Math.PI / 2);
  const surface = new Mesh(geometry, surfaceMaterial);
  surface.renderOrder = 3; scene.add(surface);

  const volumeMaterial = new MeshPhysicalNodeMaterial({ color: '#bbdfd8', transmission: 0.98, roughness: 0.08, ior: 1.333, thickness: 0.5, attenuationColor: new Color('#429b91'), attenuationDistance: 5.5, side: DoubleSide, depthWrite: false });
  volumeMaterial.colorNode = Fn(() => {
    Discard(signedWaterDistance.greaterThan(0));
    return color('#bbdfd8').mul(waterDepth.mul(-0.05).exp());
  })();
  const volume = new Mesh(new BoxGeometry(TANK.width - 0.10, TANK.top - TANK.floor - 0.02, TANK.depth - 0.10), volumeMaterial);
  volume.position.y = (TANK.top + TANK.floor) / 2; volume.renderOrder = 2; scene.add(volume);

  let height = TANK.base, velocity = 0, targetHeight = TANK.base, drainHeight = TANK.base;
  const tilt = new Vector3(), tiltVelocity = new Vector3(), targetTilt = new Vector3();
  const normal = new Vector3(0, 1, 0);
  function slosh(point: Vector3) {
    state.lastSlosh = state.elapsed;
    targetHeight = 0.6 * Math.max(TANK.floor + 0.3, Math.min(TANK.top - 0.2, point.y)) + 0.4 * TANK.base;
    // n·(x-center)=0: negative horizontal normal makes the clicked side rise.
    targetTilt.set(-point.x, 0, -point.z).normalize().multiplyScalar(0.4);
    if (state.mode === 'shattered') targetHeight = Math.min(targetHeight, drainHeight);
  }
  function update(dt: number) {
    if (state.mode === 'shattered') {
      targetHeight += (drainHeight - targetHeight) * (1 - Math.exp(-dt * 0.65));
      targetTilt.multiplyScalar(Math.exp(-dt * 0.6));
    } else if (state.elapsed - state.lastSlosh > 1.3) {
      targetHeight += (TANK.base - targetHeight) * (1 - Math.exp(-dt * 0.38));
      targetTilt.multiplyScalar(Math.exp(-dt * 0.38));
    }
    // Small substeps keep the damped spring stable after a slow frame.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      velocity += ((targetHeight - height) * 13 - velocity * 4.2) * h;
      height += velocity * h;
      tiltVelocity.addScaledVector(targetTilt.clone().sub(tilt), 13 * h).multiplyScalar(Math.exp(-4.2 * h));
      tilt.addScaledVector(tiltVelocity, h);
    }
    // Keep the planar sheet inside the open tank, including spring overshoot.
    const extent = Math.abs(tilt.x) * TANK.width / 2 + Math.abs(tilt.z) * TANK.depth / 2;
    height = Math.max(TANK.floor + extent + 0.04, Math.min(TANK.top - extent - 0.04, height));
    normal.set(tilt.x, 1, tilt.z).normalize();
    waterHeight.value = height; waterNormal.value.copy(normal);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) positions.setY(i, height - tilt.x * positions.getX(i) - tilt.z * positions.getZ(i));
    positions.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  }
  return { surface, slosh, update, drain(bottom: number) { drainHeight = Math.max(TANK.floor + 0.12, bottom); }, reset() {
    targetHeight = TANK.base; drainHeight = TANK.base; targetTilt.set(0, 0, 0); state.lastSlosh = -100;
  } };
}
