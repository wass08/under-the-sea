import { BoxGeometry, Color, DoubleSide, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, Scene, Sphere, Vector3, Vector4 } from 'three/webgpu';
import { Fn, Discard, float, uniform, min, smoothstep, bumpMap, color, mx_noise_float, normalLocal, positionLocal, positionWorld, cameraPosition, normalWorld, vec3 } from 'three/tsl';
import { signedWaterDistance, waterDepth } from './lighting';
import { simTime, sunDirection, state, TANK, waterHeight, waterNormal } from '../state';

export function createWater(scene: Scene) {
  const surfaceMaterial = new MeshPhysicalNodeMaterial({ color: '#a2d5cd', transmission: 1, roughness: 0.03, metalness: 0, ior: 1.333, thickness: 0.16, attenuationColor: new Color('#b5e6dc'), attenuationDistance: 4, side: DoubleSide, transparent: true, opacity: 0.88, depthWrite: false });
  surfaceMaterial.fog = false;
  const ripples = Array.from({ length: 4 }, () => uniform(new Vector4(0, 0, -100, 0)));
  let rippleIndex = 0;
  let waves = mx_noise_float(positionWorld.mul(vec3(3.5, 0, 3.5)).add(vec3(simTime.mul(0.24), simTime.mul(0.17), 0)))
    .add(mx_noise_float(positionWorld.mul(vec3(8.2, 0, 8.2)).add(vec3(simTime.mul(-0.31), 0, simTime.mul(0.22)))).mul(0.32))
    .add(mx_noise_float(positionWorld.mul(vec3(15.3, 0, 15.3)).add(vec3(simTime.mul(0.16), 0, simTime.mul(-0.24)))).mul(0.12))
    .add(positionWorld.x.mul(7).add(positionWorld.z.mul(4)).sub(simTime.mul(1.6)).sin().mul(0.25));
  for (const ripple of ripples) {
    const age = simTime.sub(ripple.z).max(0), radius = positionWorld.xz.sub(ripple.xy).length();
    const ring = radius.sub(age.mul(1.35));
    waves = waves.add(ring.mul(22).sin().mul(ring.mul(ring).mul(-7).exp()).mul(age.mul(-1.3).exp()).mul(ripple.w).mul(1.8));
  }
  // Schlick Fresnel keeps the overhead view clear and strengthens grazing reflections.
  const fresnel = float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).pow(5);
  // Restrain the underside reflection: the waterline must not become a pale sheet
  // when the camera drops below it. Retain stronger sky reflection from above.
  surfaceMaterial.opacityNode = cameraPosition.y.lessThan(waterHeight).select(fresnel.mul(0.10).add(0.08), fresnel.mul(0.20).add(0.35));
  surfaceMaterial.envMapIntensity = 0.65;
  surfaceMaterial.normalNode = bumpMap(waves, float(0.048));
  const wallDistance = min(float(TANK.width / 2 - 0.026).sub(positionWorld.x.abs()), float(TANK.depth / 2 - 0.026).sub(positionWorld.z.abs()));
  const meniscus = color('#c9eee7').mul(float(1).sub(smoothstep(0.002, 0.014, wallDistance))).mul(0.06);
  const halfVector = cameraPosition.sub(positionWorld).normalize().add(sunDirection).normalize();
  surfaceMaterial.emissiveNode = meniscus.add(normalWorld.dot(halfVector).max(0).pow(3200).mul(color('#fff3da')).mul(4));
  surfaceMaterial.positionNode = Fn(() => {
    // Analytic deformation preserves x/z bounds and supplies the same sloped normal.
    normalLocal.assign(waterNormal);
    const y = waterHeight.sub(waterNormal.x.mul(positionLocal.x).add(waterNormal.z.mul(positionLocal.z)).div(waterNormal.y));
    return vec3(positionLocal.x, y, positionLocal.z);
  })();
  const geometry = new PlaneGeometry(TANK.width - 0.052, TANK.depth - 0.052, 32, 20);
  geometry.rotateX(-Math.PI / 2);
  // One conservative bound covers every spring-constrained position of the GPU plane.
  geometry.boundingSphere = new Sphere(new Vector3(0, (TANK.floor + TANK.top) / 2, 0), Math.hypot(TANK.width / 2, TANK.depth / 2, (TANK.top - TANK.floor) / 2));
  const surface = new Mesh(geometry, surfaceMaterial);
  surface.renderOrder = 3; scene.add(surface);

  const volumeMaterial = new MeshPhysicalNodeMaterial({ color: '#bbdfd8', transmission: 1, roughness: 0.04, ior: 1.333, thickness: 0.22, attenuationColor: new Color('#429b91'), attenuationDistance: 1, side: DoubleSide, transparent: true, opacity: 0.10, depthWrite: false });
  volumeMaterial.fog = false;
  volumeMaterial.colorNode = Fn(() => {
    Discard(signedWaterDistance.greaterThan(0));
    return color('#89c6bc').rgb.mul(vec3(0.16, 0.025, 0.018).mul(waterDepth).negate().exp());
  })();
  // Beer–Lambert transmittance: clear just below the plane, denser teal at depth.
  volumeMaterial.attenuationColorNode = vec3(0.34, 0.10, 0.085).mul(waterDepth).negate().exp();
  const volume = new Mesh(new BoxGeometry(TANK.width - 0.10, TANK.top - TANK.floor - 0.02, TANK.depth - 0.10), volumeMaterial);
  volume.position.y = (TANK.top + TANK.floor) / 2; volume.renderOrder = 2; scene.add(volume);

  let height = TANK.base, drainHeight = TANK.base, draining = false, fast = false;
  const tilt = new Vector3(), tiltVelocity = new Vector3(), targetTilt = new Vector3(), tiltDelta = new Vector3();
  function ripple(point: Vector3, strength = 1) {
    ripples[rippleIndex++ % 4].value.set(point.x, point.z, simTime.value, strength);
  }
  function slosh(point: Vector3) {
    state.lastSlosh = state.elapsed;
    targetTilt.set(-point.x, 0, -point.z).normalize().multiplyScalar(0.025);
  }
  function update(dt: number) {
    // Torricelli: integrate sqrt(head) analytically so the level stops exactly at the sill.
    if (draining && height > drainHeight) {
      const root = Math.max(0, Math.sqrt(height - drainHeight) - dt * (fast ? 1.25 : 0.12));
      height = drainHeight + root * root;
    }
    targetTilt.multiplyScalar(Math.exp(-dt * 2));
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      tiltVelocity.addScaledVector(tiltDelta.subVectors(targetTilt, tilt), 18 * h).multiplyScalar(Math.exp(-4.2 * h));
      tilt.addScaledVector(tiltVelocity, h);
    }
    const extent = Math.abs(tilt.x) * TANK.width / 2 + Math.abs(tilt.z) * TANK.depth / 2;
    if (extent > Math.min(height - TANK.floor, TANK.top - height) - 0.01) tilt.multiplyScalar(0.8);
    waterHeight.value = height; waterNormal.value.set(tilt.x, 1, tilt.z).normalize();
    surface.visible = volume.visible = height > TANK.floor + 0.015;
  }
  return { surface, slosh, ripple, update,
    capture() { return { height, normal: waterNormal.value.toArray() }; },
    restore(a: { height: number; normal: number[] }, b: { height: number; normal: number[] }, t: number) {
      height = a.height * (1 - t) + b.height * t; waterHeight.value = height;
      waterNormal.value.fromArray(a.normal).lerp(new Vector3().fromArray(b.normal), t).normalize();
      surface.visible = volume.visible = height > TANK.floor + 0.015;
    },
    drain(bottom: number, full = false) {
    drainHeight = Math.max(TANK.floor, Math.min(drainHeight, bottom)); draining = true; fast = full;
  }, reset() {
    height = drainHeight = TANK.base; draining = fast = false;
    tilt.set(0, 0, 0); tiltVelocity.set(0, 0, 0); targetTilt.set(0, 0, 0);
    waterHeight.value = TANK.base; waterNormal.value.set(0, 1, 0);
    ripples.forEach(r => r.value.w = 0); state.lastSlosh = -100;
  } };
}
