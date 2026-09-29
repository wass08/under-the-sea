import { DynamicDrawUsage, Mesh, type BufferAttribute } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ReleasedShard } from './release';
/** One draw for independent glass cells. Physics retains each original mesh/body. */
export function batchShardDrawing(shards: ReleasedShard[]) {
  const geometry = mergeGeometries(shards.map(s => s.mesh.geometry), false)!;
  const position = geometry.getAttribute('position') as BufferAttribute, normal = geometry.getAttribute('normal') as BufferAttribute;
  position.setUsage(DynamicDrawUsage); normal.setUsage(DynamicDrawUsage);
  const mesh = new Mesh(geometry, shards[0].mesh.material); mesh.castShadow = true; mesh.frustumCulled = false;
  let offset = 0;
  const entries = shards.map(shard => { const start = offset; offset += shard.mesh.geometry.getAttribute('position').count; shard.mesh.visible = false; return { shard, start, sleeping: false }; });
  function update() {
    let changed = false;
    for (const entry of entries) {
      const { shard, start } = entry, sleeping = shard.body.isSleeping();
      if (sleeping && entry.sleeping) continue;
      entry.sleeping = sleeping; changed = true; shard.mesh.updateMatrix(); const e = shard.mesh.matrix.elements;
      const p = shard.mesh.geometry.getAttribute('position'), n = shard.mesh.geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
        position.setXYZ(start+i,e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);
        normal.setXYZ(start+i,e[0]*nx+e[4]*ny+e[8]*nz,e[1]*nx+e[5]*ny+e[9]*nz,e[2]*nx+e[6]*ny+e[10]*nz);
      }
    }
    if (changed) { position.needsUpdate = true; normal.needsUpdate = true; }
  }
  update(); return { mesh, update };
}
