import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, MeshStandardNodeMaterial, Object3D, Scene, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, cos, float, hash, instanceIndex, positionLocal, sin, vec3, vertexColor } from 'three/tsl';
import { WORLD } from '../config';
import { simTime } from '../state';
import { random } from '../lib/random';
import { ISLAND, terrainHeight } from './field';

const level = WORLD.surface;
const slopeAt = (x: number, z: number) => {
  const e = 0.2, dx = terrainHeight(x + e, z) - terrainHeight(x - e, z), dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
};

/** Bake colour + sway weight into a non-indexed part. `top` colours vary along y between the two colours. */
function paint(g: BufferGeometry, bottom: string, top: string, jitter: number, seed: number, swayBase = 0, swayHeight = 1) {
  const geometry = g.index ? g.toNonIndexed() : g;
  geometry.deleteAttribute('uv');
  const rng = random(seed), pos = geometry.getAttribute('position'), colors: number[] = [], sway: number[] = [];
  geometry.computeBoundingBox();
  const y0 = geometry.boundingBox!.min.y, y1 = geometry.boundingBox!.max.y;
  const a = new Color(bottom), b = new Color(top), c = new Color();
  for (let i = 0; i < pos.count; i += 3) {
    const k = 1 + (rng() - 0.5) * jitter;
    for (let j = 0; j < 3; j++) {
      const t = (pos.getY(i + j) - y0) / Math.max(1e-4, y1 - y0);
      c.copy(a).lerp(b, t).multiplyScalar(k); colors.push(c.r, c.g, c.b);
      sway.push(Math.max(0, (pos.getY(i + j) - swayBase) / swayHeight));
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSway', new Float32BufferAttribute(sway, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function palmGeometry(seed: number) {
  const rng = random(seed), parts: BufferGeometry[] = [];
  const height = 2.3 + rng() * 0.5, lean = new Vector3(0.28 + rng() * 0.2, 0, 0.1 + rng() * 0.2), segments = 8;
  const points: Vector3[] = [];
  for (let i = 0; i <= segments; i++) { const t = i / segments; points.push(new Vector3(lean.x * t * t * height * 0.55, t * height, lean.z * t * t * height * 0.55)); }
  for (let i = 0; i < segments; i++) {
    const p = points[i], q = points[i + 1], len = p.distanceTo(q), r0 = 0.105 - i * 0.008, r1 = 0.105 - (i + 1) * 0.008;
    const seg = new CylinderGeometry(r1, r0, len * 1.02, 6, 1, false);
    seg.translate(0, len / 2, 0);
    seg.applyQuaternion(quatFromUp(q.clone().sub(p)));
    seg.translate(p.x, p.y, p.z);
    parts.push(paint(seg, i % 2 ? '#7a5b3c' : '#8c6a45', i % 2 ? '#82623f' : '#94724b', 0.1, seed + i, 0, height));
  }
  const top = points[segments];
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng() * 0.4, len = 1.1 + rng() * 0.45, droop = 0.55 + rng() * 0.3, segs = 6;
    const dirX = Math.cos(a), dirZ = Math.sin(a), pos: number[] = [];
    const rise = 0.35 + rng() * 0.2;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, w = 0.24 * Math.sin(Math.PI * Math.pow(t, 0.75)) + 0.02;
      const cx = top.x + dirX * len * t, cy = top.y + rise * Math.sin(t * 2.2) * len * 0.5 - droop * t * t * len * 0.7, cz = top.z + dirZ * len * t;
      pos.push(cx - dirZ * w, cy, cz + dirX * w, cx + dirZ * w, cy, cz - dirX * w);
    }
    const idx: number[] = [];
    for (let s = 0; s < segs; s++) { const i = s * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const geo = paint(g, '#3f7a2c', '#8fc242', 0.22, seed + 100 + f, 0, height);
    parts.push(geo);
  }
  const coconuts = new IcosahedronGeometry(0.075, 0);
  coconuts.translate(top.x + 0.05, top.y - 0.08, top.z);
  parts.push(paint(coconuts, '#5a3d24', '#6d4a2b', 0.1, seed + 900, 0, height));
  return mergeGeometries(parts)!;
}
function quatFromUp(dir: Vector3) {
  const q = new Object3D().quaternion;
  return q.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
}

function pineGeometry(seed: number) {
  const rng = random(seed), parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.06, 0.09, 0.6, 6); trunk.translate(0, 0.3, 0);
  parts.push(paint(trunk, '#6b4a2e', '#7a5636', 0.1, seed, 0, 2.4));
  const tiers = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), r = 0.6 - t * 0.38, h = 0.85 - t * 0.2;
    const cone = new ConeGeometry(r, h, 7, 1); cone.rotateY(rng() * 3); cone.translate(0, 0.55 + i * 0.5 + h / 2, 0);
    parts.push(paint(cone, '#2b5d3a', i % 2 ? '#4f8a45' : '#3f7a44', 0.22, seed + i * 7, 0, 2.6));
  }
  return mergeGeometries(parts)!;
}

function bushGeometry(seed: number) {
  const rng = random(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new IcosahedronGeometry(0.22 + rng() * 0.12, 1); g.translate((rng() - 0.5) * 0.35, 0.16 + rng() * 0.1, (rng() - 0.5) * 0.35);
    const pos = g.getAttribute('position'); for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * (1 + (rng() - 0.5) * 0.2), pos.getY(k), pos.getZ(k) * (1 + (rng() - 0.5) * 0.2));
    parts.push(paint(g, '#3c7434', '#7bb045', 0.25, seed + i, 0, 0.6));
  }
  return mergeGeometries(parts)!;
}

export function createIsland(scene: Scene) {
  const rng = random(555), dummy = new Object3D();
  const material = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, flatShading: true, side: DoubleSide });
  const sway = attribute('aSway', 'float');
  const phase = hash(float(instanceIndex)).mul(6.283);
  const amp = sway.mul(sway).mul(0.045);
  material.positionNode = positionLocal.add(vec3(sin(simTime.mul(1.3).add(phase)).mul(amp), 0, cos(simTime.mul(1.05).add(phase.mul(1.3))).mul(amp).mul(0.7)));
  material.colorNode = vertexColor().rgb;

  type Spot = { x: number; z: number; y: number; s: number; ry: number };
  const pick = (count: number, accept: (x: number, z: number, y: number, slope: number, d: number) => boolean, gap: number) => {
    const out: Spot[] = [];
    for (let tries = 0; tries < 8000 && out.length < count; tries++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 3.6, x = ISLAND.x + Math.cos(a) * d, z = ISLAND.z + Math.sin(a) * d;
      if (Math.abs(x) > WORLD.half - 0.5 || Math.abs(z) > WORLD.half - 0.5) continue;
      const y = terrainHeight(x, z), s = slopeAt(x, z);
      if (!accept(x, z, y, s, d)) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < gap)) continue;
      out.push({ x, z, y, s: 0.85 + rng() * 0.35, ry: rng() * 6.28 });
    }
    return out;
  };
  const palms = pick(3, (x, z, y, s) => y > level + 0.02 && y < level + 1.1 && s < 0.9 && (x - ISLAND.x) + (z - ISLAND.z) > -0.5, 1.6);
  const pines = pick(4, (x, z, y, s) => y > level + 0.65 && y < level + 2.2 && s < 0.85, 1.05);
  const bushes = pick(7, (x, z, y, s) => y > level + 0.35 && y < level + 2.1 && s < 0.8, 0.7);
  const group = new Object3D(); group.name = 'Island props'; scene.add(group);
  const add = (spots: Spot[], geometry: BufferGeometry, name: string) => {
    if (!spots.length) return;
    const mesh = new InstancedMesh(geometry, material, spots.length);
    spots.forEach((p, i) => { dummy.position.set(p.x, p.y - 0.05, p.z); dummy.rotation.set(0, p.ry, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = name; mesh.layers.enable(1);
    group.add(mesh);
  };
  add(palms, palmGeometry(3), 'Palms'); add(pines, pineGeometry(8), 'Pines'); add(bushes, bushGeometry(5), 'Bushes');
  return { group, palms, pines };
}
