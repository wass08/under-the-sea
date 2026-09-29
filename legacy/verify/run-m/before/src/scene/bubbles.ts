import { InstancedMesh, MeshPhysicalNodeMaterial, Object3D, Scene, SphereGeometry, Vector3 } from 'three/webgpu';
import { cameraPosition, color, float, normalWorld, output, positionWorld, vec4 } from 'three/tsl';
import { random, simTime, state, TANK, waterHeight, waterNormal } from '../state';

/** One batch of thin bubbles; analytic simulation-time trajectories also run backwards. */
export function createBubbles(scene: Scene, vents: Vector3[], ripple: (p: Vector3, strength: number) => void) {
  const count = 66, rng = random(219), transform = new Object3D();
  const material = new MeshPhysicalNodeMaterial({ color: '#c5f8ec', roughness: 0.09, transmission: 1, ior: 1.04, thickness: 0.002, transparent: true, depthWrite: false });
  material.fog = false; material.envMapIntensity = 0.3;
  const rim = float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).clamp().pow(3);
  material.opacityNode = rim.mul(0.65).add(0.05); material.emissiveNode = color('#a7eee4').mul(rim).mul(0.36);
  material.outputNode = vec4(output.rgb.min(0.8), output.a);
  const mesh = new InstancedMesh(new SphereGeometry(1, 10, 7), material, count); mesh.name = 'Rising bubbles'; mesh.frustumCulled = false; mesh.renderOrder = 4; scene.add(mesh);
  const bubbles = Array.from({ length: count }, (_, i) => {
    const origin = vents[i % vents.length].clone(), radius = 0.010 + rng() * 0.020, speed = 0.23 + radius * 7;
    const period = (TANK.base - origin.y) / speed + 0.25;
    return { origin, radius, speed, period, phase: rng() * period, popped: false, previousAge: -1 };
  });
  let live = 0, pops = 0;
  return { update() {
    live = 0;
    for (const b of bubbles) {
      const age = ((simTime.value + b.phase) % b.period + b.period) % b.period;
      if (age < b.previousAge) b.popped = false;
      const p = b.origin.clone(); p.y += age * b.speed;
      p.x += Math.sin(age * 1.9 + b.phase) * 0.045; p.z += Math.sin(age * 1.35 + b.phase) * 0.035;
      const n = waterNormal.value, surface = waterHeight.value - (n.x * p.x + n.z * p.z) / n.y;
      if (p.y + b.radius >= surface && !b.popped && b.previousAge >= 0) {
        if (!state.rewinding && surface > b.origin.y + 0.10) { ripple(p.clone().setY(surface), 0.025 + b.radius * 0.3); pops++; }
        b.popped = true;
      }
      if (p.y + b.radius < surface && b.origin.y + 0.08 < surface && waterHeight.value > TANK.floor + 0.15) {
        transform.position.copy(p); transform.scale.setScalar(b.radius); transform.updateMatrix(); mesh.setMatrixAt(live++, transform.matrix);
      }
      b.previousAge = age;
    }
    mesh.count = live; mesh.visible = live > 0; mesh.instanceMatrix.needsUpdate = true;
  }, get count() { return live; }, get pops() { return pops; }, reset() { for (const b of bubbles) { b.previousAge = -1; b.popped = false; } pops = 0; } };
}
