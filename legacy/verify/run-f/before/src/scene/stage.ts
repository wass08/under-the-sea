import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene } from 'three/webgpu';
import { color, mix, positionWorld, smoothstep, vec2 } from 'three/tsl';

/** A neutral cyclorama with a soft contact shadow, independent of the orbiting sun. */
export function createStage(scene: Scene) {
  const floor = new Mesh(new PlaneGeometry(10000, 10000), new MeshBasicNodeMaterial({ color: '#26333e' }));
  floor.material.colorNode = mix(color('#26333e'), color('#41515c'), positionWorld.xz.length().mul(-0.035).exp().mul(0.6));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const shadow = new MeshBasicNodeMaterial({ color: '#0d1c25', transparent: true, depthWrite: false });
  const distance = positionWorld.xz.abs().sub(vec2(2.9, 1.65)).max(0).length();
  shadow.opacityNode = smoothstep(1.1, 0, distance).mul(0.44);
  const contact = new Mesh(new PlaneGeometry(9, 6.5), shadow);
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.003; scene.add(contact);
}
