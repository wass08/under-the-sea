import { type Object3D, type Material, type BufferGeometry } from 'three/webgpu';
/** Dispose each shared material/geometry once, then detach the bench graph. */
export function disposeGraph(root: Object3D) {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
  root.traverse(object => {
    const drawable = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material) for (const m of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(m);
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); root.clear(); root.removeFromParent();
}
