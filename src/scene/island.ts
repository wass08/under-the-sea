import { BufferGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, MeshStandardNodeMaterial, Object3D, Scene, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, color, cos, float, hash, instanceIndex, mix, mx_noise_float, positionLocal, sin, smoothstep, uv, vec3 } from 'three/tsl';
import { WORLD } from '../config';
import { simTime } from '../state';
import { random } from '../lib/random';
import { ISLAND, terrainHeight } from './field';

const level = WORLD.surface;
const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;

/** Curved trunk with ring scars, root flare and taper. uv.x around, uv.y = height in world units. */
function buildTrunk(seed: number) {
  const rng = random(seed);
  const height = 6.6 + rng() * 2.2, lean = 1.1 + rng() * 1.5, wob = rng() * 6.28, bendAngle = rng() * 6.28;
  const rings = 44, sides = 16, r0 = 0.3 + rng() * 0.06;
  const dirX = Math.cos(bendAngle), dirZ = Math.sin(bendAngle);
  const centre = (t: number) => new Vector3(dirX * lean * Math.pow(t, 1.9) + Math.sin(t * 5 + wob) * 0.09 * t, t * height, dirZ * lean * Math.pow(t, 1.9) + Math.cos(t * 4 + wob) * 0.09 * t);
  const positions: number[] = [], uvs: number[] = [], sway: number[] = [], indices: number[] = [];
  const pts: Vector3[] = [];
  for (let i = 0; i <= rings; i++) pts.push(centre(i / rings));
  let ref = new Vector3(1, 0, 0);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const tangent = pts[Math.min(rings, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const side = ref.clone().sub(tangent.clone().multiplyScalar(ref.dot(tangent))).normalize(), up = new Vector3().crossVectors(tangent, side);
    ref = side;
    const scar = Math.pow(Math.abs(Math.sin(Math.PI * t * height * 2.6)), 6);
    const radius = r0 * (1 - 0.42 * t) * (1 + 0.55 * Math.exp(-t * 16)) * (1 + 0.07 * scar);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, wobble = 1 + 0.03 * Math.sin(a * 3 + t * 9 + wob);
      const p = pts[i].clone().addScaledVector(side, Math.cos(a) * radius * wobble).addScaledVector(up, Math.sin(a) * radius * wobble);
      positions.push(p.x, p.y, p.z); uvs.push(j / sides, t * height); sway.push(Math.pow(t, 1.7));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + 1, cc = a + sides + 1, d = cc + 1;
    indices.push(a, b, cc, b, d, cc);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('aSway', new Float32BufferAttribute(sway, 1)); g.setIndex(indices); g.computeVertexNormals();
  return { geometry: g, top: pts[rings], topTangent: pts[rings].clone().sub(pts[rings - 1]).normalize(), height };
}

/** A crown of drooping pinnate fronds: rachis + many thin tapered leaflets. */
function buildCrown(top: Vector3, height: number, seed: number) {
  const rng = random(seed), positions: number[] = [], uvs: number[] = [], leaf: number[] = [], sway: number[] = [], flutter: number[] = [], tint: number[] = [], indices: number[] = [];
  const nFronds = 14, up = new Vector3(0, 1, 0);
  const push = (p: Vector3, u: number, v: number, isLeaf: number, fl: number, tn: number) => {
    positions.push(p.x, p.y, p.z); uvs.push(u, v); leaf.push(isLeaf); flutter.push(fl); tint.push(tn);
    sway.push(Math.pow(Math.min(1, p.y / height), 1.7));
  };
  for (let f = 0; f < nFronds; f++) {
    const a = f / nFronds * Math.PI * 2 + rng() * 0.35, old = f % 3 === 0 ? 1 : f % 3 === 1 ? 0.5 : 0;
    const elevation = 0.62 - old * 0.95 + rng() * 0.2, length = 3.3 + rng() * 0.9 + (1 - old) * 0.2, droop = 0.55 + old * 0.75 + rng() * 0.25;
    const horizontal = new Vector3(Math.cos(a), 0, Math.sin(a)), d0 = horizontal.clone().multiplyScalar(Math.cos(elevation)).addScaledVector(up, Math.sin(elevation)).normalize();
    const tn = rng();
    const rachis = (s: number) => top.clone().addScaledVector(d0, length * s).addScaledVector(up, -droop * length * 0.55 * s * s);
    const segs = 24;
    // rachis strip
    const rBase = positions.length / 3;
    for (let k = 0; k <= segs; k++) {
      const s = k / segs, p = rachis(s), w = 0.035 * (1 - s * 0.7), side = new Vector3().crossVectors(d0, up).normalize().multiplyScalar(w);
      push(p.clone().add(side), 0.5, s, 0, 0, tn); push(p.clone().sub(side), 0.5, s, 0, 0, tn);
      if (k < segs) { const i = rBase + k * 2; indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const maxLeaflet = 1.55 + rng() * 0.35;
    for (let k = 0; k < segs; k++) {
      const s = 0.06 + 0.93 * k / segs, p = rachis(s), tangent = rachis(Math.min(1, s + 0.02)).sub(rachis(s - 0.02)).normalize();
      const sideV = new Vector3().crossVectors(tangent, up).normalize();
      const ell = maxLeaflet * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.85)), 0.75) + 0.12;
      for (const sd of [-1, 1]) {
        const dir = sideV.clone().multiplyScalar(sd * 0.92).addScaledVector(tangent, 0.42).addScaledVector(up, -0.22 - old * 0.25 - s * 0.15).normalize();
        const parts = 4, base = positions.length / 3, width = 0.2 * (0.75 + 0.25 * Math.sin(s * 3));
        for (let m = 0; m <= parts; m++) {
          const t = m / parts, q = p.clone().addScaledVector(dir, ell * t).addScaledVector(up, -0.32 * ell * t * t);
          const w = width * (1 - Math.pow(t, 1.6) * 0.92) * 0.5, wv = tangent.clone().multiplyScalar(w);
          push(q.clone().add(wv), 0, t, 1, t, tn); push(q.clone().sub(wv), 1, t, 1, t, tn);
          if (m < parts) { const i = base + m * 2; if (sd > 0) indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); else indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('aLeaf', new Float32BufferAttribute(leaf, 1)); g.setAttribute('aSway', new Float32BufferAttribute(sway, 1));
  g.setAttribute('aFlutter', new Float32BufferAttribute(flutter, 1)); g.setAttribute('aTint', new Float32BufferAttribute(tint, 1));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function buildCoconuts(top: Vector3, seed: number) {
  const rng = random(seed), parts: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    let g: BufferGeometry = new IcosahedronGeometry(0.16 + rng() * 0.03, 2);
    g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g, 1e-4); g.computeVertexNormals();
    const a = rng() * 6.28, r = 0.22 + rng() * 0.12;
    g.translate(top.x + Math.cos(a) * r, top.y - 0.28 - rng() * 0.1, top.z + Math.sin(a) * r);
    g.setAttribute('aSway', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(Math.pow(Math.min(1, (top.y - 0.3) / 7.5), 1.7)), 1));
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

export function createIsland(scene: Scene) {
  const rng = random(555), dummy = new Object3D(), group = new Object3D();
  group.name = 'Island palms'; scene.add(group);
  const phase = hash(float(instanceIndex)).mul(6.283);
  const windAt = (sw: Node<'float'>, amplitude: number) => {
    const a = sw.mul(sw).mul(amplitude);
    return vec3(sin(simTime.mul(1.15).add(phase)).mul(a), 0, cos(simTime.mul(0.9).add(phase.mul(1.3))).mul(a).mul(0.7));
  };

  // Materials
  const swayAttr = attribute('aSway', 'float') as unknown as Node<'float'>;
  const trunkMat = new MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
  trunkMat.positionNode = positionLocal.add(windAt(swayAttr, 0.55));
  {
    const u = uv().x, v = uv().y;
    const fibre = mx_noise_float(vec3(u.mul(34), v.mul(1.1), 1.0)).mul(0.5).add(0.5);
    const scar = sin(v.mul(Math.PI * 2.6)).abs().pow(6);
    const bark = mix(c('#5c412a'), c('#9a7852'), fibre.mul(0.8).add(mx_noise_float(vec3(u.mul(9), v.mul(4), 3)).mul(0.1)));
    trunkMat.colorNode = mix(bark, c('#3b2a1c'), scar.mul(0.75)).mul(mix(float(0.75), float(1.0), smoothstep(0.0, 1.2, v)));
  }
  const leafMat = new MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0, side: DoubleSide });
  {
    const flutter = attribute('aFlutter', 'float') as unknown as Node<'float'>, isLeaf = attribute('aLeaf', 'float') as unknown as Node<'float'>, tintA = attribute('aTint', 'float') as unknown as Node<'float'>;
    const wp = positionLocal;
    const flap = sin(simTime.mul(3.1).add(wp.x.mul(2.3)).add(wp.z.mul(1.9)).add(phase)).mul(0.05).mul(flutter).mul(swayAttr.mul(0.6).add(0.4));
    leafMat.positionNode = positionLocal.add(windAt(swayAttr, 0.6)).add(vec3(0, flap, 0));
    const u = uv().x, v = uv().y;
    const base = mix(c('#2a6a2b'), c('#86bf3d'), v.mul(0.7).add(tintA.mul(0.25)));
    const yellow = mix(base, c('#c9cf62'), smoothstep(0.7, 1.0, v).mul(tintA).mul(0.6));
    const vein = smoothstep(0.08, 0.0, u.sub(0.5).abs()).mul(isLeaf).mul(0.18);
    const shade = yellow.mul(float(0.85).add(mx_noise_float(vec3(u.mul(6), v.mul(5), tintA.mul(9))).mul(0.15))).add(vec3(vein));
    leafMat.colorNode = mix(c('#c8c98a'), shade, isLeaf);
    leafMat.emissiveNode = leafMat.colorNode!.mul(0.14);
  }
  const nutMat = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 });
  nutMat.positionNode = positionLocal.add(windAt(swayAttr, 0.55));
  nutMat.colorNode = mix(c('#4a3220'), c('#6f4d2c'), mx_noise_float(positionLocal.mul(9)).mul(0.5).add(0.5));

  // Placement on the sandy top
  type Spot = { x: number; z: number; y: number; s: number; ry: number };
  const spots: Spot[] = [];
  for (let tries = 0; tries < 4000 && spots.length < 6; tries++) {
    const a = rng() * Math.PI * 2, d = 0.9 + Math.sqrt(rng()) * 3.3, x = ISLAND.x + Math.cos(a) * d, z = ISLAND.z + Math.sin(a) * d;
    const y = terrainHeight(x, z);
    if (y < level + 0.4 || spots.some(o => Math.hypot(o.x - x, o.z - z) < 2.4)) continue;
    spots.push({ x, z, y, s: 0.85 + rng() * 0.4, ry: rng() * 6.28 });
  }
  const variants = [0, 1, 2].map(i => {
    const trunk = buildTrunk(11 + i * 7), crown = buildCrown(trunk.top, trunk.height, 31 + i * 5), nuts = buildCoconuts(trunk.top, 61 + i);
    return { trunk: trunk.geometry, crown, nuts, list: spots.filter((_, k) => k % 3 === i) };
  });
  for (const v of variants) {
    if (!v.list.length) continue;
    for (const [geometry, material, name] of [[v.trunk, trunkMat, 'Palm trunks'], [v.crown, leafMat, 'Palm fronds'], [v.nuts, nutMat, 'Coconuts']] as [BufferGeometry, MeshStandardNodeMaterial, string][]) {
      const mesh = new InstancedMesh(geometry, material, v.list.length);
      v.list.forEach((p, i) => { dummy.position.set(p.x, p.y - 0.2, p.z); dummy.rotation.set(0, p.ry, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = name; mesh.layers.enable(1);
      group.add(mesh);
    }
  }
  return { group, palms: spots };
}
