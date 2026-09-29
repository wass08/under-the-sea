import { BufferGeometry, Color, ConeGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, Object3D, Quaternion, Scene, Vector3, CylinderGeometry } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, float, hash, instanceIndex, mix, normalWorldGeometry, positionLocal, sin, cos, smoothstep, uv, vec3, mx_noise_float, positionWorld } from 'three/tsl';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { random } from '../lib/random';
import { BASIN, ISLAND, terrainHeight } from './field';
import { underwaterShading } from './materials';

const R = WORLD.half;
const slopeAt = (x: number, z: number) => {
  const e = 0.25, dx = terrainHeight(x + e, z) - terrainHeight(x - e, z), dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
};
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;

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

function jitteredRock(radius: number, detail: number, jitter: number, seed: number, squash = 1) {
  const g = ni(new IcosahedronGeometry(radius, detail));
  const rng = random(seed), pos = g.getAttribute('position');
  const cache = new Map<string, Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let v = cache.get(key);
    if (!v) { const k = 1 + (rng() - 0.5) * jitter; v = new Vector3(pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k); cache.set(key, v); }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createFlora(scene: Scene) {
  const rng = random(9001), dummy = new Object3D();
  const group = new Object3D(); group.name = 'Flora'; scene.add(group);
  const level = WORLD.surface;

  /** Pick cluster centres on gentle, underwater ground outside the school's basin. */
  const centres = (count: number, accept: (x: number, z: number, y: number) => boolean, minGap: number) => {
    const out: { x: number; z: number; y: number }[] = [];
    for (let tries = 0; tries < 6000 && out.length < count; tries++) {
      const x = (rng() * 2 - 1) * (R - 0.5), z = (rng() * 2 - 1) * (R - 0.5), y = terrainHeight(x, z);
      if (y > level - 1.2 || slopeAt(x, z) > (Math.hypot(x - ISLAND.x, z - ISLAND.z) < 5.6 ? 1.0 : 0.5)) continue;
      if (!accept(x, z, y)) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
      out.push({ x, z, y });
    }
    return out;
  };
  const outsideBasin = (r: number) => (x: number, z: number) => Math.hypot(x - BASIN.x, z - BASIN.z) > r;

  // ---- Seagrass + kelp -----------------------------------------------------------------------------------------
  type Blade = { x: number; y: number; z: number; h: number; w: number; ry: number };
  const grass: Blade[] = [], kelp: Blade[] = [];
  for (const cc of centres(24, (x, z) => outsideBasin(4.2)(x, z) && Math.hypot(x - ISLAND.x, z - ISLAND.z) > 2.2, 1.6)) {
    const n = 18 + Math.floor(rng() * 26);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (0.35 + rng() * 0.45);
      const x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.2 || Math.abs(z) > R - 0.2) continue;
      grass.push({ x, z, y: terrainHeight(x, z) - 0.03, h: 0.55 + rng() * 0.75, w: 0.10 + rng() * 0.07, ry: rng() * Math.PI });
    }
  }
  for (const cc of centres(8, (x, z) => outsideBasin(5.0)(x, z) && (x < 2.5 && z < 2.5) && Math.hypot(x - ISLAND.x, z - ISLAND.z) > 3.0, 2.4)) {
    const n = 5 + Math.floor(rng() * 7);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.5;
      const x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.25 || Math.abs(z) > R - 0.25) continue;
      const y = terrainHeight(x, z);
      const height = Math.min(level - y - 0.5, 2.2 + rng() * 3.4);
      if (height < 1) continue;
      kelp.push({ x, z, y: y - 0.05, h: height, w: 0.2 + rng() * 0.12, ry: rng() * Math.PI });
    }
  }

  const swayMaterial = (light: string, dark: string, tipGlow: string, amplitude: number, speed: number, depthOfFade: number) => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0, side: DoubleSide });
    const t = uv().y;
    const id = float(instanceIndex);
    const phase = hash(id).mul(6.283);
    const bend = t.mul(t);
    const sway = sin(simTime.mul(speed).add(phase).add(t.mul(2.2)));
    const sway2 = cos(simTime.mul(speed * 0.73).add(phase.mul(1.7)).add(t.mul(1.4)));
    m.positionNode = positionLocal.add(vec3(sway.mul(amplitude).mul(bend), 0, sway2.mul(amplitude * 0.7).mul(bend)));
    const tone = hash(id.add(17)).mul(0.6).add(0.7);
    const base = mix(c(dark), c(light), t.mul(0.9).add(0.1)).mul(tone);
    const glow = c(tipGlow).mul(smoothstep(0.65, 1.0, t)).mul(0.35);
    const shaded = underwaterShading(base, normalWorldGeometry, 0.9);
    m.colorNode = shaded.albedo;
    m.emissiveNode = shaded.emissive.add(glow.mul(0.25));
    void depthOfFade;
    return m;
  };

  const place = (mesh: InstancedMesh, items: Blade[]) => {
    const q = new Quaternion(), up = new Vector3(0, 1, 0);
    items.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      q.setFromAxisAngle(up, b.ry); dummy.quaternion.copy(q);
      dummy.scale.set(b.w, b.h, b.w); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false;
    mesh.receiveShadow = false; mesh.castShadow = false;
  };
  const grassMesh = new InstancedMesh(bladeGeometry(5, 0.75, 0.15), swayMaterial('#9bd85a', '#2f7a3d', '#e8ff9a', 0.16, 1.5, 6), grass.length);
  place(grassMesh, grass); grassMesh.name = 'Seagrass';
  const kelpMesh = new InstancedMesh(bladeGeometry(14, 0.55, 0.0), swayMaterial('#b6a640', '#4d5f1f', '#ffe27a', 0.55, 0.8, 8), kelp.length);
  place(kelpMesh, kelp); kelpMesh.name = 'Kelp';
  group.add(grassMesh, kelpMesh);

  // ---- Coral ----------------------------------------------------------------------------------------------------
  const branchParts: BufferGeometry[] = [];
  const branch = (base: Vector3, dir: Vector3, length: number, radius: number, depth: number) => {
    const cone = ni(new ConeGeometry(radius, length, 6, 1, true));
    cone.translate(0, length / 2, 0);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    cone.applyQuaternion(q); cone.translate(base.x, base.y, base.z);
    branchParts.push(cone.deleteAttribute('uv') as BufferGeometry);
    if (depth > 0) {
      const tip = base.clone().addScaledVector(dir.clone().normalize(), length);
      const kids = depth > 1 ? 2 : 3;
      for (let i = 0; i < kids; i++) {
        const a = (i / kids) * Math.PI * 2 + depth, d = dir.clone().normalize().multiplyScalar(1).add(new Vector3(Math.cos(a) * 0.75, 0.15, Math.sin(a) * 0.75)).normalize();
        branch(tip, d, length * 0.68, radius * 0.62, depth - 1);
      }
    }
  };
  branch(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.42, 0.075, 2);
  const branchGeometry = mergeGeometries(branchParts.map(g => { const n = ni(g); n.computeVertexNormals(); return n; }))!;
  const brainGeometry = jitteredRock(0.34, 2, 0.14, 12, 0.62);
  const tubeParts: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.32 + (i % 3) * 0.14, r = 0.065 + (i % 2) * 0.02, a = i * 1.7;
    const g = ni(new CylinderGeometry(r, r * 1.35, h, 7, 1, true)); g.translate(Math.cos(a) * 0.14, h / 2, Math.sin(a) * 0.14);
    g.deleteAttribute('uv'); tubeParts.push(g);
  }
  const tubeGeometry = mergeGeometries(tubeParts)!;
  const coralPalette = ['#ff6f8a', '#ff9b52', '#c86bd6', '#ffd15c', '#ff5d5d', '#7ad7c9'];
  const coralMaterial = (glow: number) => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0, flatShading: true });
    const id = float(instanceIndex), pick = hash(id.add(3));
    let col: Node<'vec3'> = c(coralPalette[0]);
    coralPalette.forEach((hex, i) => { if (i > 0) col = mix(col, c(hex), smoothstep((i - 0.5) / coralPalette.length, (i - 0.5) / coralPalette.length + 0.001, pick)); });
    const var2 = mx_noise_float(positionWorld.mul(9)).mul(0.12).add(1);
    const shaded = underwaterShading(col.mul(var2), normalWorldGeometry, 1.0);
    m.colorNode = shaded.albedo; m.emissiveNode = shaded.emissive.add(shaded.albedo.mul(glow));
    return m;
  };
  const coralSpots = centres(7, (x, z) => Math.hypot(x - BASIN.x, z - BASIN.z) > 4.3 && Math.hypot(x - ISLAND.x, z - ISLAND.z) > 3.3 && !(x < -1 && z < -1), 2.6);
  const corals: { g: BufferGeometry; items: { x: number; y: number; z: number; s: number; ry: number }[] }[] = [
    { g: branchGeometry, items: [] }, { g: brainGeometry, items: [] }, { g: tubeGeometry, items: [] },
  ];
  coralSpots.forEach(cc => {
    const n = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = 0.15 + Math.sqrt(rng()) * 0.85, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.4 || Math.abs(z) > R - 0.4) continue;
      const kind = corals[Math.floor(rng() * 3)];
      kind.items.push({ x, z, y: terrainHeight(x, z) - 0.04, s: 0.75 + rng() * 0.9, ry: rng() * 6.28 });
    }
  });
  corals.forEach(({ g, items }, k) => {
    if (!items.length) return;
    const mesh = new InstancedMesh(g, coralMaterial(k === 1 ? 0.05 : 0.08), items.length);
    items.forEach((it, i) => { dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry, 0); dummy.scale.setScalar(it.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'Coral';
    group.add(mesh);
  });

  // ---- Rocks ---------------------------------------------------------------------------------------------------
  const rockGeometry = mergeGeometries([jitteredRock(0.5, 1, 0.55, 31), jitteredRock(0.5, 1, 0.5, 47, 0.7)].map(g => { g.deleteAttribute('uv'); return g; }))!;
  void rockGeometry;
  const rockA = jitteredRock(0.5, 1, 0.6, 31, 0.8), rockB = jitteredRock(0.5, 1, 0.5, 47, 0.6);
  const rockMaterial = () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
    const id = float(instanceIndex), pick = hash(id.add(11));
    const base = mix(mix(c('#7d786f'), c('#5f5a54'), smoothstep(0.3, 0.6, pick)), c('#9a8a72'), smoothstep(0.65, 0.9, pick));
    const grain = mx_noise_float(positionWorld.mul(5)).mul(0.12).add(1);
    const shaded = underwaterShading(base.mul(grain), normalWorldGeometry, 1.0);
    m.colorNode = shaded.albedo; m.emissiveNode = shaded.emissive;
    return m;
  };
  const rockSpots: { x: number; z: number; y: number; s: number }[] = [];
  for (let tries = 0; tries < 4000 && rockSpots.length < 46; tries++) {
    const x = (rng() * 2 - 1) * (R - 0.3), z = (rng() * 2 - 1) * (R - 0.3), y = terrainHeight(x, z);
    const dBasin = Math.hypot(x - BASIN.x, z - BASIN.z);
    const nearIsland = Math.hypot(x - ISLAND.x, z - ISLAND.z);
    if (y > level + 2.0) continue;
    if (dBasin < 3.4 && y < level) continue;
    if (nearIsland < 2.0) continue;
    if (y < level && slopeAt(x, z) > 0.9) continue;
    // Bias toward the edges and toward the beach.
    const bias = Math.max(smooth01(3.5, 8, dBasin), Math.exp(-((nearIsland - 3.0) ** 2) / 1.5));
    if (rng() > bias * 0.9) continue;
    rockSpots.push({ x, z, y, s: 0.25 + Math.pow(rng(), 2.2) * 0.95 });
  }
  [rockA, rockB].forEach((g, k) => {
    const list = rockSpots.filter((_, i) => i % 2 === k);
    const mesh = new InstancedMesh(g, rockMaterial(), list.length);
    list.forEach((r, i) => {
      dummy.position.set(r.x, r.y + r.s * 0.12, r.z); dummy.rotation.set(rng() * 0.5, rng() * 6.28, rng() * 0.5); dummy.scale.set(r.s * (0.8 + rng() * 0.6), r.s * (0.7 + rng() * 0.5), r.s * (0.8 + rng() * 0.6));
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'Rocks'; mesh.layers.enable(1);
    group.add(mesh);
  });
  void [Color, Matrix4, Mesh, waterLevel, sin, WORLD];
  return { group };
}
const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
