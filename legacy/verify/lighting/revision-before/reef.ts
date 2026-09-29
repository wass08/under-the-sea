import { BufferGeometry, Color, CylinderGeometry, DodecahedronGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Mesh, MeshStandardNodeMaterial, Object3D, Raycaster, Scene, TorusGeometry, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, color, float, mix, positionLocal, sin, smoothstep, vec3 } from 'three/tsl';
import { causticLight, submerged, underwaterColor } from './lighting';
import { random, simTime, TANK, waterHeight, waterNormal } from '../state';

/** Four instance batches: branching fans, hollow tubes, lobed brains, and seagrass. */
export function createReef(scene: Scene, terrain: Mesh) {
  const rng = random(614), up = new Vector3(0, 1, 0), ray = new Raycaster(); terrain.updateMatrixWorld(true);
  function ground(x: number, z: number) {
    ray.set(new Vector3(x, TANK.top + 1, z), new Vector3(0, -1, 0));
    const hit = ray.intersectObject(terrain, false)[0];
    return hit && hit.point.y > TANK.floor + 0.12 ? { point: hit.point, normal: hit.face!.normal.clone() } : { point: new Vector3(x, TANK.floor + 0.12, z), normal: up.clone() };
  }
  const centers = [[-2.25, 1.12], [-1.3, 1.45], [0.3, 1.42], [1.65, 1.35], [2.55, 0.65], [-2.6, -0.8], [1.9, -1.3], [-0.9, -1.35]].map(([x,z]) => [x * TANK.width / 6, z * TANK.depth / 3.5]);
  function sites(count: number) {
    const result = [];
    for (let tries = 0; result.length < count && tries < count * 100; tries++) {
      const c = centers[tries % centers.length], x = c[0] + (rng() - 0.5) * 0.7, z = c[1] + (rng() - 0.5) * 0.48;
      if (Math.abs(x) > TANK.width / 2 - .21 || Math.abs(z) > TANK.depth / 2 - .26) continue;
      const g = ground(x, z);
      // Keep the entire colony (including a swaying fan) on the flat sand bed.
      if (g.point.y > TANK.floor+.121 || g.normal.y < .99) continue;
      if(Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return ground(x+Math.cos(a)*.48,z+Math.sin(a)*.48).point.y;}).some(y=>y>TANK.floor+.121))continue;
      result.push(g);
    }
    return result;
  }
  function combine(parts: BufferGeometry[]) { const flat = parts.map(p => p.index ? p.toNonIndexed() : p); const g = mergeGeometries(flat); new Set([...parts, ...flat]).forEach(p => p.dispose()); return g; }
  const branches: BufferGeometry[] = [];
  function branch(a: Vector3, b: Vector3, radius: number) {
    const g = new CylinderGeometry(radius * 0.7, radius, a.distanceTo(b), 5, 1);
    const transform = new Object3D(); transform.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize()); transform.position.copy(a).add(b).multiplyScalar(0.5); transform.updateMatrix(); g.applyMatrix4(transform.matrix); branches.push(g);
  }
  branch(new Vector3(), new Vector3(0, 1, 0), 0.065);
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? -1 : 1, y = 0.18 + i * 0.10, tip = new Vector3(side * (0.38 - i * 0.025), y + 0.24, 0.02 * i);
    branch(new Vector3(0, y, 0), tip, 0.038); branch(tip, tip.clone().add(new Vector3(side * 0.07, 0.15, 0.02)), 0.025);
  }
  const tubes: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const x = Math.cos(i * 2.4) * 0.20, z = Math.sin(i * 2.4) * 0.20, h = 0.45 + i * 0.09;
    tubes.push(new CylinderGeometry(0.105, 0.08, h, 8, 1, true).translate(x, h / 2, z));
    const ring = new TorusGeometry(0.084, 0.025, 4, 8); ring.rotateX(Math.PI / 2); ring.translate(x, h, z); tubes.push(ring);
    // Inner wall gives each tube a real dark hollow opening.
    const inner = new CylinderGeometry(0.067, 0.055, h * 0.7, 8, 1, true); inner.scale(-1, 1, 1); inner.translate(x, h * 0.65, z); tubes.push(inner);
  }
  const brain = new DodecahedronGeometry(0.45, 1); const p = brain.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const v = new Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + Math.sin(v.x * 32 + v.z * 15) * 0.10); p.setXYZ(i, v.x, (v.y + 0.45) * 0.65, v.z); } brain.computeVertexNormals();
  const bladeParts: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute([-0.025,0,0, 0.025,0,0, -0.02,0.55,0.04, 0.025,0,0, 0.02,0.55,0.04, -0.02,0.55,0.04, -0.02,0.55,0.04, 0.02,0.55,0.04, 0.08,1,0.10],3));
    g.rotateY(i * 2.4); g.computeVertexNormals(); bladeParts.push(g);
  }
  const coralMaterial = new MeshStandardNodeMaterial({ roughness: 0.8, flatShading: true });
  coralMaterial.colorNode = underwaterColor(color('#ffffff').rgb); coralMaterial.aoNode = mix(float(1), float(0.46), submerged); coralMaterial.emissiveNode = causticLight.mul(0.12);
  const grassMaterial = coralMaterial.clone(); grassMaterial.side = 2;
  const anchor = attribute('reefAnchor', 'vec3');
  const wet = smoothstep(0.02, 0.18, waterHeight.sub(anchor.y).sub(waterNormal.x.mul(anchor.x).add(waterNormal.z.mul(anchor.z))));
  const top = positionLocal.y.max(0).pow(2);
  const sway = sin(simTime.mul(1.15).add(anchor.x.mul(4)).add(anchor.z.mul(3))).mul(0.12).add(waterNormal.x.mul(5));
  grassMaterial.positionNode = positionLocal.add(vec3(top.mul(sway.mul(wet).add(float(1).sub(wet).mul(0.55))), top.mul(float(1).sub(wet)).mul(-0.42), top.mul(waterNormal.z).mul(wet).mul(5)));
  const geometries = [combine(branches), combine(tubes), brain, combine(bladeParts)];
  const palettes = ['#ed683e', '#cd397a', '#cf7154', '#22956e']; const counts = [25, 23, 20, 135]; const vents: Vector3[] = [];
  geometries.forEach((geometry, kind) => {
    const places = sites(counts[kind]), mesh = new InstancedMesh(geometry, kind === 3 ? grassMaterial : coralMaterial, places.length), anchors = new Float32Array(places.length * 3), transform = new Object3D();
    places.forEach((g, i) => {
      transform.position.copy(g.point); transform.quaternion.setFromUnitVectors(up, g.normal); transform.rotateY(rng() * Math.PI * 2);
      const scale = kind === 3 ? 0.20 + rng() * 0.29 : 0.28 + rng() * 0.38; transform.scale.setScalar(scale); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      const shade = new Color(kind === 2 && i % 4 === 0 ? '#8d9bd6' : palettes[kind]).offsetHSL((rng() - 0.5) * 0.09, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.08);
      if (kind < 3) { const hsl = shade.getHSL({ h: 0, s: 0, l: 0 }); shade.setHSL(hsl.h, Math.min(1, hsl.s * 1.08), hsl.l); }
      mesh.setColorAt(i, shade); anchors.set(g.point.toArray(), i * 3);
      if (kind === 1 && i % 4 === 0) vents.push(g.point.clone().add(new Vector3(0, scale * 0.8, 0)));
    });
    geometry.setAttribute('reefAnchor', new InstancedBufferAttribute(anchors, 3)); mesh.receiveShadow = true; mesh.name = ['Coral fans', 'Tube coral', 'Brain coral', 'Seagrass'][kind]; scene.add(mesh);
  });
  // Two extra vents originate on the lower terrain, along with the tube colonies.
  for (const [x, z] of [[-2, 0.65], [2.2, 0.4]]) { const g = ground(x * TANK.width / 6, z * TANK.depth / 3.5); if (g.point.y < TANK.base - .55) vents.push(g.point.add(new Vector3(0, 0.07, 0))); }
  return { vents };
}
