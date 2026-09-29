import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, Quaternion, Scene, Vector2, Vector3 } from 'three/webgpu';
import { random, TANK } from '../state';

type Shard = { mesh: Mesh; home: Vector3; rotation: Quaternion; velocity: Vector3; spin: Vector3; wall: number; active: boolean; sleeping: boolean; faceCount: number; bottom: number };
// Sutherland–Hodgman clipping against the perpendicular bisector of two seeds.
function clipCell(polygon: Vector2[], a: Vector2, b: Vector2): Vector2[] {
  const nx = b.x - a.x, ny = b.y - a.y;
  const limit = (b.lengthSq() - a.lengthSq()) * 0.5;
  const output: Vector2[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = p.x * nx + p.y * ny - limit, dq = q.x * nx + q.y * ny - limit;
    if (dp <= 1e-9) output.push(p.clone());
    if ((dp < 0) !== (dq < 0)) output.push(p.clone().lerp(q, dp / (dp - dq)));
  }
  return output;
}
function shardGeometry(polygon: Vector2[], center: Vector2) {
  const p: number[] = [], thickness = 0.042;
  const vertex = (v: Vector2, z: number) => p.push(v.x - center.x, v.y - center.y, z);
  for (let i = 1; i < polygon.length - 1; i++) {
    vertex(polygon[0], thickness / 2); vertex(polygon[i], thickness / 2); vertex(polygon[i + 1], thickness / 2);
    vertex(polygon[0], -thickness / 2); vertex(polygon[i + 1], -thickness / 2); vertex(polygon[i], -thickness / 2);
  }
  const faceCount = p.length / 3;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    vertex(a, -thickness / 2); vertex(b, -thickness / 2); vertex(b, thickness / 2);
    vertex(a, -thickness / 2); vertex(b, thickness / 2); vertex(a, thickness / 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(p, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.setDrawRange(0, faceCount);
  return { geometry, faceCount };
}

export function createTank(scene: Scene) {
  const rng = random(912);
  const glass = new MeshPhysicalNodeMaterial({ color: '#efffff', transmission: 1, ior: 1.5, thickness: 0.075, roughness: 0.045, metalness: 0, attenuationColor: new Color('#b5e3d6'), attenuationDistance: 9, envMapIntensity: 1.3, depthWrite: false });
  const looseGlass = glass.clone(); looseGlass.depthWrite = true;
  const shards: Shard[] = [], panels: Mesh[] = [];
  const dimensions = [TANK.width, TANK.width, TANK.depth, TANK.depth];
  const origins = [new Vector3(0, TANK.floor, TANK.depth / 2), new Vector3(0, TANK.floor, -TANK.depth / 2), new Vector3(TANK.width / 2, TANK.floor, 0), new Vector3(-TANK.width / 2, TANK.floor, 0)];
  const angles = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
  const height = TANK.top - TANK.floor;
  for (let wall = 0; wall < 4; wall++) {
    const width = dimensions[wall];
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angles[wall]);
    const panel = new Mesh(new PlaneGeometry(width, height));
    panel.position.copy(origins[wall]).add(new Vector3(0, height / 2, 0));
    panel.quaternion.copy(rotation); panel.visible = false; panel.userData.wall = wall;
    // Raycast proxies are never rendered; DoubleSide allows clicks from inside as well.
    if (!Array.isArray(panel.material)) panel.material.side = 2; scene.add(panel); panels.push(panel);
    const columns = wall < 2 ? 7 : 4, rows = 5;
    const seeds: Vector2[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      seeds.push(new Vector2(((x + 0.18 + rng() * 0.64) / columns - 0.5) * width, (y + 0.18 + rng() * 0.64) / rows * height));
    }
    for (const seed of seeds) {
      let polygon = [new Vector2(-width / 2, 0), new Vector2(width / 2, 0), new Vector2(width / 2, height), new Vector2(-width / 2, height)];
      for (const other of seeds) if (other !== seed) polygon = clipCell(polygon, seed, other);
      const center = polygon.reduce((sum, v) => sum.add(v), new Vector2()).divideScalar(polygon.length);
      const { geometry, faceCount } = shardGeometry(polygon, center);
      const mesh = new Mesh(geometry, glass);
      mesh.position.set(center.x, center.y, 0).applyQuaternion(rotation).add(origins[wall]);
      mesh.quaternion.copy(rotation); scene.add(mesh);
      shards.push({ mesh, home: mesh.position.clone(), rotation: rotation.clone(), velocity: new Vector3(), spin: new Vector3(), wall, active: false, sleeping: false, faceCount, bottom: Math.min(...polygon.map(v => v.y)) + TANK.floor });
    }
  }
  const frameMaterial = new MeshPhysicalNodeMaterial({ color: '#a6d7cf', transmission: 0.82, roughness: 0.13, ior: 1.5, thickness: 0.06 });
  const edge = (size: Vector3, at: Vector3) => { const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), frameMaterial); mesh.position.copy(at); scene.add(mesh); };
  for (const x of [-3, 3]) for (const z of [-1.75, 1.75]) edge(new Vector3(0.026, height, 0.026), new Vector3(x, (TANK.top + TANK.floor) / 2, z));
  for (const y of [TANK.floor, TANK.top]) {
    for (const z of [-1.75, 1.75]) edge(new Vector3(6.03, 0.024, 0.036), new Vector3(0, y, z));
    for (const x of [-3, 3]) edge(new Vector3(0.036, 0.024, 3.5), new Vector3(x, y, 0));
  }
  const plinth = new Mesh(new BoxGeometry(6.18, 0.16, 3.68), new MeshStandardNodeMaterial({ color: '#273536', metalness: 0.55, roughness: 0.25 }));
  plinth.position.y = 0.08; plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);
  const axis = new Vector3(), rotated = new Vector3();
  function shatter(impact: Vector3, wall: number, radius = 1.45) {
    let count = 0, bottom = TANK.top;
    const outward = new Vector3(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), angles[wall]);
    for (const shard of shards) {
      if (shard.wall !== wall || shard.active || shard.home.distanceTo(impact) > radius) continue;
      shard.active = true; shard.mesh.material = looseGlass; shard.mesh.geometry.setDrawRange(0, Infinity);
      const radial = shard.home.clone().sub(impact).normalize();
      shard.velocity.copy(radial).multiplyScalar(1.2 + rng() * 1.9).addScaledVector(outward, 1.7 + rng() * 2.4);
      shard.velocity.y += 1.4 + rng() * 1.4;
      shard.spin.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(7);
      bottom = Math.min(bottom, shard.bottom); count++;
    }
    return { count, bottom };
  }
  function update(dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / steps;
    for (let step = 0; step < steps; step++) for (const shard of shards) {
      if (!shard.active || shard.sleeping) continue;
      shard.velocity.y -= 5.8 * h; shard.mesh.position.addScaledVector(shard.velocity, h);
      const speed = shard.spin.length();
      if (speed > 0.001) shard.mesh.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis.copy(shard.spin).normalize(), speed * h));
      // Lowest transformed vertex gives a stable floor contact while the polygon tumbles.
      let lowest = Infinity;
      const positions = shard.mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        rotated.fromBufferAttribute(positions, i).applyQuaternion(shard.mesh.quaternion);
        lowest = Math.min(lowest, rotated.y + shard.mesh.position.y);
      }
      if (lowest < 0.014) {
        shard.mesh.position.y += 0.014 - lowest;
        shard.velocity.y = Math.abs(shard.velocity.y) * 0.27;
        shard.velocity.x *= 0.72; shard.velocity.z *= 0.72; shard.spin.multiplyScalar(0.66);
        if (shard.velocity.length() < 0.16 && shard.spin.length() < 0.2) shard.sleeping = true;
      }
    }
  }
  return { panels, shards, shatter, update, reset() {
    for (const s of shards) { s.mesh.material = glass; s.mesh.position.copy(s.home); s.mesh.quaternion.copy(s.rotation); s.mesh.geometry.setDrawRange(0, s.faceCount); s.active = false; s.sleeping = false; s.velocity.set(0, 0, 0); s.spin.set(0, 0, 0); }
  } };
}
