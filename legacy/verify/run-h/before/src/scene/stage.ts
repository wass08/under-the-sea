import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene } from 'three/webgpu';
import { color, mix, positionWorld, smoothstep, vec2 } from 'three/tsl';

/** One unlit floor: evaluate its soft contact shadow in the same fragment.
 * A second plane only 0.003 units above the 10,000-unit floor can compete
 * for depth at shallow angles. No extra surface or directional shadow is needed. */
export function createStage(scene: Scene) {
  const material = new MeshBasicNodeMaterial();
  const base = mix(color('#26333e'), color('#41515c'), positionWorld.xz.length().mul(-0.035).exp().mul(0.6));
  const distance = positionWorld.xz.abs().sub(vec2(2.9, 1.65)).max(0).length();
  material.colorNode = mix(base, color('#0d1c25'), smoothstep(1.1, 0, distance).mul(0.44));
  const floor = new Mesh(new PlaneGeometry(10000, 10000), material);
  floor.name = 'Floor with integrated contact shadow'; floor.rotation.x = -Math.PI / 2; scene.add(floor);
}
