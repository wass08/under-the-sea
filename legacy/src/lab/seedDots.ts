import { type BufferGeometry, InstancedBufferAttribute, PointsNodeMaterial, Sprite } from 'three/webgpu';
import { instancedBufferAttribute, shapeCircle } from 'three/tsl';
/** Visible WebGPU seed dots: native Points are fixed at 1px, so use r186 instanced sprites. Consumes geometry. */
export function createSeedDots(geometry: BufferGeometry, size = 3.5) {
  const positions = new InstancedBufferAttribute(new Float32Array(geometry.getAttribute('position').array), 3);
  geometry.dispose();
  const material = new PointsNodeMaterial({ color: '#ffe0a1', positionNode: instancedBufferAttribute(positions), opacityNode: shapeCircle(), size, sizeAttenuation: false, alphaToCoverage: true, depthWrite: false });
  const dots = new Sprite(material); dots.count = positions.count; dots.frustumCulled = false;
  // Own the quad and instance buffer so bench disposal releases both.
  dots.geometry = dots.geometry.clone(); dots.geometry.setAttribute('seedPosition', positions);
  return dots;
}
