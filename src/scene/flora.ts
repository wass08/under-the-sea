import { BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, MeshStandardNodeMaterial, Object3D, Quaternion, Scene, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, cos, float, hash, instanceIndex, mix, mx_noise_float, normalWorldGeometry, positionLocal, positionWorld, sin, smoothstep, uv, vec3 } from 'three/tsl';
import { WORLD } from '../config';
import { simTime } from '../state';
import { random } from '../lib/random';
import { BASIN } from '../config';
import { ISLAND, terrainHeight } from './field';
import { underwaterShading } from './materials';

const R = WORLD.half, level = WORLD.surface;
const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const slopeAt = (x: number, z: number) => {
  const e = 0.3, dx = terrainHeight(x + e, z) - terrainHeight(x - e, z), dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
};
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;
const fromIsland = (x: number, z: number) => Math.hypot(x - ISLAND.x, z - ISLAND.z);

/** Tapered blade strip (0..1 tall, unit width at the base). uv.y runs along the height. */
function bladeGeometry(segments: number, taper: number, curl: number) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, w = (1 - t * taper) * 0.5, bend = curl * t * t;
    positions.push(-w, t, bend, w, t, bend); uvs.push(0, t, 1, t);
    if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

/** Smooth, lumpy boulder: welded icosphere pushed around by low-frequency noise (no facets). */
export function smoothRock(radius: number, seed: number, squash = 0.7) {
  const rng = random(seed), phase = [rng() * 9, rng() * 9, rng() * 9];
  let g: BufferGeometry = new IcosahedronGeometry(radius, 3);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / radius, y = pos.getY(i) / radius, z = pos.getZ(i) / radius;
    const k = 1 + 0.22 * Math.sin(x * 2.1 + phase[0]) * Math.cos(z * 1.7 + phase[1]) + 0.12 * Math.sin(y * 3.3 + x * 2.4 + phase[2]);
    pos.setXYZ(i, x * k * radius, y * k * radius * squash, z * k * radius);
  }
  g.computeVertexNormals();
  return g;
}

export function createFlora(scene: Scene) {
  const rng = random(9001), dummy = new Object3D();
  const group = new Object3D(); group.name = 'Flora'; scene.add(group);

  /** Cluster centres on gentle underwater ground, away from the island's shelf. */
  const centres = (count: number, accept: (x: number, z: number, y: number) => boolean, minGap: number) => {
    const out: { x: number; z: number; y: number }[] = [];
    for (let tries = 0; tries < 12000 && out.length < count; tries++) {
      const x = (rng() * 2 - 1) * (R - 0.8), z = (rng() * 2 - 1) * (R - 0.8), y = terrainHeight(x, z);
      if (y > level - 2 || slopeAt(x, z) > 0.45) continue;
      if (Math.hypot(x - BASIN.x, z - BASIN.z) < 8 || !accept(x, z, y) || out.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
      out.push({ x, z, y });
    }
    return out;
  };

  // ---- Seagrass + kelp: thin and elegant --------------------------------------------------------------------
  type Blade = { x: number; y: number; z: number; h: number; w: number; ry: number };
  const grass: Blade[] = [], kelp: Blade[] = [];
  for (const cc of centres(90, (x, z) => fromIsland(x, z) > 12.5, 2.6)) {
    const n = 26 + Math.floor(rng() * 40), spread = 0.6 + rng() * 1.2;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * spread;
      const x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.3 || Math.abs(z) > R - 0.3) continue;
      grass.push({ x, z, y: terrainHeight(x, z) - 0.03, h: 0.8 + rng() * 1.5, w: 0.04 + rng() * 0.035, ry: rng() * Math.PI });
    }
  }
  for (const cc of centres(16, (x, z) => fromIsland(x, z) > 14 && Math.max(Math.abs(x), Math.abs(z)) > 11, 5)) {
    const n = 4 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 1.2, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.4 || Math.abs(z) > R - 0.4) continue;
      const y = terrainHeight(x, z), height = Math.min(level - y - 1.2, 4 + rng() * 4.5);
      if (height < 2) continue;
      kelp.push({ x, z, y: y - 0.05, h: height, w: 0.1 + rng() * 0.07, ry: rng() * Math.PI });
    }
  }

  const swayMaterial = (light: string, dark: string, amplitude: number, speed: number) => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0, side: DoubleSide });
    const t = uv().y, id = float(instanceIndex), phase = hash(id).mul(6.283), bend = t.mul(t);
    const sway = sin(simTime.mul(speed).add(phase).add(t.mul(2.2))), sway2 = cos(simTime.mul(speed * 0.73).add(phase.mul(1.7)).add(t.mul(1.4)));
    m.positionNode = positionLocal.add(vec3(sway.mul(amplitude).mul(bend), 0, sway2.mul(amplitude * 0.7).mul(bend)));
    const tone = hash(id.add(17)).mul(0.5).add(0.75);
    const base = mix(c(dark), c(light), t.mul(0.85).add(0.1)).mul(tone);
    const shaded = underwaterShading(base, normalWorldGeometry, 3, false);
    m.colorNode = shaded.albedo;
    m.emissiveNode = shaded.emissive.add(c(light).mul(smoothstep(0.6, 1.0, t)).mul(0.05));
    return m;
  };
  const place = (mesh: InstancedMesh, items: Blade[]) => {
    const q = new Quaternion(), up = new Vector3(0, 1, 0);
    items.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z); q.setFromAxisAngle(up, b.ry); dummy.quaternion.copy(q);
      dummy.scale.set(b.w, b.h, b.w); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  };
  const grassMesh = new InstancedMesh(bladeGeometry(6, 0.9, 0.18), swayMaterial('#a8dc62', '#2f7f45', 0.32, 1.4), grass.length);
  place(grassMesh, grass); grassMesh.name = 'Seagrass';
  const kelpMesh = new InstancedMesh(bladeGeometry(18, 0.6, 0.0), swayMaterial('#b9ab48', '#4d5f1f', 1.1, 0.7), kelp.length);
  place(kelpMesh, kelp); kelpMesh.name = 'Kelp';
  group.add(grassMesh, kelpMesh);

  // ---- Coral: a few sparse clusters ------------------------------------------------------------------------
  const branchParts: BufferGeometry[] = [];
  const branch = (base: Vector3, dir: Vector3, length: number, radius: number, depth: number) => {
    const cone = ni(new ConeGeometry(radius, length, 8, 1, true));
    cone.translate(0, length / 2, 0);
    cone.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize())); cone.translate(base.x, base.y, base.z);
    branchParts.push(cone.deleteAttribute('uv') as BufferGeometry);
    if (depth > 0) {
      const tip = base.clone().addScaledVector(dir.clone().normalize(), length), kids = depth > 1 ? 2 : 3;
      for (let i = 0; i < kids; i++) {
        const a = (i / kids) * Math.PI * 2 + depth, d = dir.clone().normalize().add(new Vector3(Math.cos(a) * 0.7, 0.2, Math.sin(a) * 0.7)).normalize();
        branch(tip, d, length * 0.68, radius * 0.62, depth - 1);
      }
    }
  };
  branch(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.6, 0.07, 3);
  const branchGeometry = mergeGeometries(branchParts.map(g => { const n = ni(g); n.computeVertexNormals(); return n; }))!;
  const brainGeometry = smoothRock(0.5, 12, 0.6);
  const tubeParts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.45 + (i % 3) * 0.2, r = 0.08 + (i % 2) * 0.03, a = i * 1.7;
    const g = ni(new CylinderGeometry(r, r * 1.3, h, 10, 1, true)); g.translate(Math.cos(a) * 0.2, h / 2, Math.sin(a) * 0.2);
    g.deleteAttribute('uv'); tubeParts.push(g);
  }
  const tubeGeometry = mergeGeometries(tubeParts)!;
  const coralPalette = ['#ff6f8a', '#ff9b52', '#c86bd6', '#ffd15c', '#7ad7c9'];
  const coralMaterial = () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0, side: DoubleSide });
    const id = float(instanceIndex), pick = hash(id.add(3));
    let col: Node<'vec3'> = c(coralPalette[0]);
    coralPalette.forEach((hex, i) => { if (i > 0) col = mix(col, c(hex), smoothstep((i - 0.5) / coralPalette.length, (i - 0.5) / coralPalette.length + 0.001, pick)); });
    const shaded = underwaterShading(col.mul(mx_noise_float(positionWorld.mul(4)).mul(0.12).add(1)), normalWorldGeometry, 3);
    m.colorNode = shaded.albedo; m.emissiveNode = shaded.emissive.add(shaded.albedo.mul(0.06));
    return m;
  };
  const coralSpots = centres(6, (x, z) => fromIsland(x, z) > 13, 7);
  const corals = [{ g: branchGeometry, items: [] as { x: number; y: number; z: number; s: number; ry: number }[] }, { g: brainGeometry, items: [] as never[] as { x: number; y: number; z: number; s: number; ry: number }[] }, { g: tubeGeometry, items: [] as { x: number; y: number; z: number; s: number; ry: number }[] }];
  coralSpots.forEach(cc => {
    const n = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = 0.2 + Math.sqrt(rng()) * 1.6, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.6 || Math.abs(z) > R - 0.6) continue;
      corals[Math.floor(rng() * 3)].items.push({ x, z, y: terrainHeight(x, z) - 0.05, s: 0.8 + rng() * 1.1, ry: rng() * 6.28 });
    }
  });
  corals.forEach(({ g, items }) => {
    if (!items.length) return;
    const mesh = new InstancedMesh(g, coralMaterial(), items.length);
    items.forEach((it, i) => { dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry, 0); dummy.scale.setScalar(it.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'Coral';
    group.add(mesh);
  });

  // ---- Smooth boulders, sparse --------------------------------------------------------------------------------
  const rockMaterial = () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
    const id = float(instanceIndex), pick = hash(id.add(11));
    const base = mix(mix(c('#8d8579'), c('#6c665e'), smoothstep(0.3, 0.6, pick)), c('#a2917a'), smoothstep(0.65, 0.9, pick));
    const grain = mx_noise_float(positionWorld.mul(2.2)).mul(0.14).add(1);
    const shaded = underwaterShading(base.mul(grain), normalWorldGeometry, 3);
    m.colorNode = shaded.albedo; m.emissiveNode = shaded.emissive;
    return m;
  };
  const spots: { x: number; z: number; y: number; s: number }[] = [];
  for (let tries = 0; tries < 6000 && spots.length < 26; tries++) {
    const x = (rng() * 2 - 1) * (R - 1), z = (rng() * 2 - 1) * (R - 1), y = terrainHeight(x, z), d = fromIsland(x, z);
    if (d < 12.5 || Math.hypot(x - BASIN.x, z - BASIN.z) < 8 || y > level - 2 || slopeAt(x, z) > 0.6 || spots.some(o => Math.hypot(o.x - x, o.z - z) < 4)) continue;
    if (rng() > 0.3 + 0.7 * smooth01(12, 17, Math.max(Math.abs(x), Math.abs(z)))) continue;
    spots.push({ x, z, y, s: 0.5 + Math.pow(rng(), 1.8) * 1.5 });
  }
  [smoothRock(0.5, 31), smoothRock(0.5, 47, 0.55), smoothRock(0.5, 63, 0.85)].forEach((g, k) => {
    const list = spots.filter((_, i) => i % 3 === k);
    if (!list.length) return;
    const mesh = new InstancedMesh(g, rockMaterial(), list.length);
    list.forEach((r, i) => {
      dummy.position.set(r.x, r.y + r.s * 0.05, r.z); dummy.rotation.set(rng() * 0.3, rng() * 6.28, rng() * 0.3);
      dummy.scale.set(r.s * (0.9 + rng() * 0.6), r.s * (0.7 + rng() * 0.4), r.s * (0.9 + rng() * 0.6)); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'Rocks';
    group.add(mesh);
  });
  return { group };
}
