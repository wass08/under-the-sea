import { BoxGeometry, Color, DoubleSide, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, Scene, Sphere, Vector3, Vector4 } from 'three/webgpu';
import { Fn, Discard, float, uniform, min, smoothstep, transformNormalToView, output, vec4, color, positionLocal, positionWorld, cameraPosition, normalWorld, vec3 } from 'three/tsl';
import { waveField } from '../lib/waves';
import { signedWaterDistance, waterDepth } from './lighting';
import { simTime, state, TANK, waterHeight, waterNormal } from '../state';

export function createWater(scene: Scene) {
  const surfaceMaterial = new MeshPhysicalNodeMaterial({ color: '#010709', transmission: 1, roughness: 0.035, metalness: 0, ior: 1.333, thickness: 0.10, attenuationColor: new Color('#2d9da9'), attenuationDistance: 5, side: DoubleSide, transparent: true, depthWrite: false });
  surfaceMaterial.fog = false;
  const agitation = uniform(0);
  const ripples = Array.from({ length: 4 }, () => uniform(new Vector4(0, 0, -100, 0)));
  let rippleIndex = 0;
  const field = Fn(() => {
    const xz=positionLocal.xz;
    const wave=waveField(xz,simTime,agitation.mul(2).add(1)).toVar();
    const direction=waterNormal.xz.div(waterNormal.xz.length().max(0.0001));
    const phase=xz.dot(direction).mul(4).sub(simTime.mul(7)), strength=agitation.mul(.035);
    wave.x.addAssign(phase.sin().mul(strength));
    wave.yz.addAssign(direction.mul(phase.cos().mul(strength).mul(4)));
    for(const ripple of ripples) {
      const age=simTime.sub(ripple.z).max(0), delta=xz.sub(ripple.xy), radius=delta.length().max(.0001);
      const ring=radius.sub(age.mul(1.35)), envelope=ring.mul(ring).mul(-7).exp().mul(age.mul(-1.3).exp()).mul(ripple.w).mul(simTime.greaterThanEqual(ripple.z).select(1,0)).mul(.012);
      wave.x.addAssign(ring.mul(22).sin().mul(envelope));
      const derivative=ring.mul(22).cos().mul(22).sub(ring.mul(22).sin().mul(ring).mul(14)).mul(envelope);
      wave.yz.addAssign(delta.div(radius).mul(derivative));
    }
    // Fade relief as the tank empties; conserve the hydraulic mean plane.
    return wave.mul(waterHeight.sub(TANK.floor).div(.15).clamp());
  })();
  const slope=waterNormal.xz.div(waterNormal.y.max(.2));
  surfaceMaterial.positionNode=vec3(positionLocal.x,waterHeight.sub(positionLocal.xz.dot(slope)).add(field.x),positionLocal.z);
  surfaceMaterial.normalNode=transformNormalToView(vec3(slope.x.sub(field.y),1,slope.y.sub(field.z)).normalize());
  const fresnel=float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).clamp().pow(5);
  surfaceMaterial.opacityNode=fresnel.mul(.52).add(cameraPosition.y.lessThan(waterHeight).select(.10,.23)).min(.85);
  surfaceMaterial.envMapIntensity=1.65;
  const wallDistance=min(float(TANK.width/2-.026).sub(positionWorld.x.abs()),float(TANK.depth/2-.026).sub(positionWorld.z.abs()));
  const meniscus=color('#b7e9ef').mul(float(1).sub(smoothstep(.002,.018,wallDistance))).mul(.20);
  surfaceMaterial.emissiveNode=meniscus.add(color('#075462').mul(.14));
  surfaceMaterial.outputNode=vec4(output.rgb.div(output.rgb.div(1.1).add(1)),output.a);
  const geometry = new PlaneGeometry(TANK.width - 0.052, TANK.depth - 0.052, 128, 80);
  geometry.rotateX(-Math.PI / 2);
  // One conservative bound covers every spring-constrained position of the GPU plane.
  geometry.boundingSphere = new Sphere(new Vector3(0, (TANK.floor + TANK.top) / 2, 0), Math.hypot(TANK.width / 2, TANK.depth / 2, (TANK.top - TANK.floor) / 2));
  const surface = new Mesh(geometry, surfaceMaterial);
  surface.renderOrder = 3; scene.add(surface);

  const volumeMaterial = new MeshPhysicalNodeMaterial({ color: '#bbdfd8', transmission: 1, roughness: 0.04, ior: 1.333, thickness: 0.22, attenuationColor: new Color('#429b91'), attenuationDistance: 1, side: DoubleSide, transparent: true, opacity: 0.10, depthWrite: false });
  volumeMaterial.fog = false;
  volumeMaterial.emissiveNode = color('#b4e4de').mul(signedWaterDistance.add(0.004).div(0.006).abs().pow(2).negate().exp()).mul(0.5);
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
    state.lastSlosh = state.elapsed; agitation.value = Math.min(1, agitation.value + .65);
    targetTilt.set(-point.x, 0, -point.z).normalize().multiplyScalar(0.025);
  }
  function update(dt: number) {
    agitation.value += ((draining && height > drainHeight + .005 ? .45 : 0) - agitation.value) * (1 - Math.exp(-dt * 1.4));
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
    capture() { return { height, normal: waterNormal.value.toArray(), agitation: agitation.value, ripples: ripples.map(r=>r.value.toArray()) }; },
    restore(a: { height: number; normal: number[]; agitation: number; ripples: number[][] }, b: { height: number; normal: number[]; agitation: number; ripples: number[][] }, t: number) {
      ripples.forEach((r,i)=>r.value.fromArray((t<.5?a:b).ripples[i]));
      agitation.value = a.agitation * (1-t) + b.agitation * t;
      height = a.height * (1 - t) + b.height * t; waterHeight.value = height;
      waterNormal.value.fromArray(a.normal).lerp(new Vector3().fromArray(b.normal), t).normalize();
      surface.visible = volume.visible = height > TANK.floor + 0.015;
    },
    drain(bottom: number, full = false) {
    drainHeight = Math.max(TANK.floor, Math.min(drainHeight, bottom)); draining = true; fast = full; agitation.value = full ? 1 : .7;
  }, reset() {
    height = drainHeight = TANK.base; agitation.value = 0; draining = fast = false;
    tilt.set(0, 0, 0); tiltVelocity.set(0, 0, 0); targetTilt.set(0, 0, 0);
    waterHeight.value = TANK.base; waterNormal.value.set(0, 1, 0);
    ripples.forEach(r => r.value.w = 0); state.lastSlosh = -100;
  } };
}
