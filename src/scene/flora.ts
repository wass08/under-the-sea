import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, Object3D, PlaneGeometry, Quaternion, Scene, SphereGeometry, Vector3 } from 'three/webgpu';
import { glowBlending } from '../lib/blending';
import type { Node } from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cameraWorldMatrix, color, cos, float, hash, instancedBufferAttribute, instanceIndex, mix, mx_noise_float, normalWorldGeometry, positionGeometry, positionLocal, positionWorld, sin, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { WORLD } from '../config';
import { simTime } from '../state';
import { random } from '../lib/random';
import { BASIN } from '../config';
import { REEFS, terrainHeight } from './field';
import { underwaterShading } from './materials';
import { moonOnly } from './lighting';

const R = WORLD.half, level = WORLD.surface;
const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const slopeAt = (x: number, z: number) => {
  const e = 0.3, dx = terrainHeight(x + e, z) - terrainHeight(x - e, z), dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
};
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;
/** Open sea: every spot counts as offshore (kept so placement rules read the same as before). */
const fromShore = (_x: number, _z: number) => 99;

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

/** Glow algae bioluminescence multiplier (Fog & volumetrics → Plant glow). */
export const plantGlow = uniform(0.5);

export function createFlora(scene: Scene) {
  const rng = random(9001), dummy = new Object3D();
  const group = new Object3D(); group.name = 'Flora'; scene.add(group);

  /** Cluster centres on gentle underwater ground, clear of the basin. */
  const centres = (count: number, accept: (x: number, z: number, y: number) => boolean, minGap: number) => {
    const out: { x: number; z: number; y: number }[] = [];
    for (let tries = 0; tries < 12000 && out.length < count; tries++) {
      const x = (rng() * 2 - 1) * (R - 0.8), z = (rng() * 2 - 1) * (R - 0.8), y = terrainHeight(x, z);
      if (y > level - 2 || slopeAt(x, z) > 0.45) continue;
      if (Math.hypot(x - BASIN.x, z - BASIN.z) < 5.8 || !accept(x, z, y) || out.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
      out.push({ x, z, y });
    }
    return out;
  };

  // ---- Seagrass + kelp: thin and elegant --------------------------------------------------------------------
  type Blade = { x: number; y: number; z: number; h: number; w: number; ry: number };
  const grass: Blade[] = [], kelp: Blade[] = [];
  for (const cc of centres(44, (x, z) => fromShore(x, z) > 9, 3.2)) {
    const n = 14 + Math.floor(rng() * 18), spread = 0.5 + rng() * 0.8;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * spread;
      const x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.3 || Math.abs(z) > R - 0.3) continue;
      const y = terrainHeight(x, z);
      grass.push({ x, z, y: y - 0.03, h: Math.min(0.35 + rng() * 0.65, (level - y) * 0.15), w: 0.045 + rng() * 0.035, ry: rng() * Math.PI });
    }
  }
  for (const cc of centres(14, (x, z) => fromShore(x, z) > 10 && Math.max(Math.abs(x), Math.abs(z)) > R * 0.4, 5)) {
    const n = 4 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 1.2, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.4 || Math.abs(z) > R - 0.4) continue;
      const y = terrainHeight(x, z), height = Math.min((level - y) * 0.25, 1.0 + rng() * 1.2);
      if (height < 0.6) continue;
      kelp.push({ x, z, y: y - 0.05, h: height, w: 0.1 + rng() * 0.07, ry: rng() * Math.PI });
    }
  }

  /** Night seagrass / kelp: dark blades; the tips carry only a whisper of a slow pulse (the lantern stays the light). */
  const swayMaterial = (light: string, dark: string, amplitude: number, speed: number, glow: string, glowAmount: number) => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0, side: DoubleSide });
    m.lightsNode = moonOnly();
    const t = uv().y, id = float(instanceIndex), phase = hash(id).mul(6.283), bend = t.mul(t);
    const sway = sin(simTime.mul(speed).add(phase).add(t.mul(2.2))), sway2 = cos(simTime.mul(speed * 0.73).add(phase.mul(1.7)).add(t.mul(1.4)));
    m.positionNode = positionLocal.add(vec3(sway.mul(amplitude).mul(bend), 0, sway2.mul(amplitude * 0.7).mul(bend)));
    const tone = hash(id.add(17)).mul(0.5).add(0.75);
    const base = mix(c(dark), c(light), t.mul(0.85).add(0.1)).mul(tone);
    const shaded = underwaterShading(base, normalWorldGeometry, 3, false);
    m.colorNode = shaded.albedo;
    const wave = sin(simTime.mul(1.1).sub(t.mul(5)).add(phase)).mul(0.5).add(0.5).pow(3);
    const tips = smoothstep(0.55, 1.0, t).mul(wave.mul(0.8).add(0.2)).mul(hash(id.add(5)).greaterThan(0.35).toFloat());
    m.emissiveNode = shaded.emissive.add(c(glow).mul(tips).mul(glowAmount));
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
  const grassMesh = new InstancedMesh(bladeGeometry(6, 0.9, 0.18), swayMaterial('#2c4a3e', '#0d1a17', 0.12, 1.1, '#5fcfc4', 0.025), grass.length);
  place(grassMesh, grass); grassMesh.name = 'Seagrass';
  const kelpMesh = new InstancedMesh(bladeGeometry(12, 0.75, 0.15), swayMaterial('#34452f', '#101912', 0.24, 0.6, '#5fcfc4', 0.015), kelp.length);
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
  // Natural night reef tones: muted olive, brown, deep red-brown, dull ochre. They sit in the dark water, lit by the
  // moon caustics and the lantern; only a faint speckle of fluorescence on the polyps.
  const coralPalette = ['#4a4630', '#4b3727', '#4a2a22', '#5a4a2c', '#39402e'];
  const coralMaterial = () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0, side: DoubleSide });
    m.lightsNode = moonOnly();
    const id = float(instanceIndex), pick = hash(id.add(3));
    let col: Node<'vec3'> = c(coralPalette[0]);
    coralPalette.forEach((hex, i) => { if (i > 0) col = mix(col, c(hex), smoothstep((i - 0.5) / coralPalette.length, (i - 0.5) / coralPalette.length + 0.001, pick)); });
    const shaded = underwaterShading(col.mul(0.9).mul(mx_noise_float(positionWorld.mul(4)).mul(0.25).add(1)), normalWorldGeometry, 3);
    // Polyp dots: two noise octaves give a speckle of bright points over a dim fluorescent body.
    const dots = smoothstep(0.5, 0.8, mx_noise_float(positionWorld.mul(26)).mul(0.7).add(mx_noise_float(positionWorld.mul(9)).mul(0.3)));
    const breathe = sin(simTime.mul(0.5).add(pick.mul(30))).mul(0.3).add(0.7);
    // Barely-there fluorescence: a faint, desaturated speckle on the polyps only (no body glow).
    m.colorNode = shaded.albedo; m.emissiveNode = shaded.emissive.add(c('#3f5a50').mul(dots.mul(breathe).mul(0.05)));
    return m;
  };
  // Coral gardens crown the reef mounds, plus a couple of patches on the open sand.
  const coralSpots = [...REEFS.map(([x, z]) => ({ x, z, y: terrainHeight(x, z) })), ...centres(6, (x, z) => fromShore(x, z) > 9, 7)];
  const corals = [{ g: branchGeometry, items: [] as { x: number; y: number; z: number; s: number; ry: number }[] }, { g: brainGeometry, items: [] as never[] as { x: number; y: number; z: number; s: number; ry: number }[] }, { g: tubeGeometry, items: [] as { x: number; y: number; z: number; s: number; ry: number }[] }];
  coralSpots.forEach(cc => {
    const n = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = 0.2 + Math.sqrt(rng()) * 1.6, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      if (Math.abs(x) > R - 0.6 || Math.abs(z) > R - 0.6) continue;
      // Fewer tube clusters (they read as blocks); smaller overall so the reef stays low and in the dark.
      const kind = rng(), k = kind < 0.5 ? 0 : kind < 0.9 ? 1 : 2;
      corals[k].items.push({ x, z, y: terrainHeight(x, z) - 0.05, s: (0.6 + rng() * 0.7) * (k === 2 ? 0.75 : 1), ry: rng() * 6.28 });
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
    m.lightsNode = moonOnly();
    const id = float(instanceIndex), pick = hash(id.add(11));
    // Dark, slightly warm greys: the blue moonlight would otherwise turn them into flat blue shapes.
    const base = mix(mix(c('#2a2622'), c('#221f1c'), smoothstep(0.3, 0.6, pick)), c('#302a23'), smoothstep(0.65, 0.9, pick));
    const grain = mx_noise_float(positionWorld.mul(2.2)).mul(0.14).add(1);
    const shaded = underwaterShading(base.mul(grain), normalWorldGeometry, 3);
    m.colorNode = shaded.albedo; m.emissiveNode = shaded.emissive;
    return m;
  };
  const spots: { x: number; z: number; y: number; s: number }[] = [];
  for (let tries = 0; tries < 20000 && spots.length < 90; tries++) {
    const x = (rng() * 2 - 1) * (R - 1), z = (rng() * 2 - 1) * (R - 1), y = terrainHeight(x, z), d = fromShore(x, z);
    if (d < 12.5 || Math.hypot(x - BASIN.x, z - BASIN.z) < 5.8 || y > level - 2 || slopeAt(x, z) > 0.6 || spots.some(o => Math.hypot(o.x - x, o.z - z) < 4)) continue;
    if (rng() > 0.3 + 0.7 * smooth01(R * 0.35, R * 0.9, Math.max(Math.abs(x), Math.abs(z)))) continue;
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
  // ---- Glow algae: dark fronds and grape-algae beads with a barely-there bioluminescence in a few colours -----------
  // Kept far below the lantern, the fish and the rays: small accents of colour, not light sources.
  const GLOW = ['#4fc8c4', '#e05fc0', '#5a8cff', '#a66bff', '#6ee08a', '#4fc8c4'].map(h => new Color(h));
  // About half near the boat (where people look), the rest scattered out into the bigger sea.
  const glowSpots = [...centres(10, (x, z) => Math.hypot(x - BASIN.x, z - BASIN.z) < 18, 5), ...centres(10, () => true, 7)];
  const fronds: (Blade & { tint: Color })[] = [], beads: { x: number; y: number; z: number; r: number; tint: Color }[] = [];
  glowSpots.forEach((cc, k) => {
    const tint = GLOW[k % GLOW.length].clone();
    const n = 6 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.9, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      const y = terrainHeight(x, z);
      fronds.push({ x, z, y: y - 0.04, h: Math.min(0.6 + rng() * 1.0, (level - y) * 0.3), w: 0.07 + rng() * 0.05, ry: rng() * Math.PI, tint });
    }
    const m = 12 + Math.floor(rng() * 14);
    for (let i = 0; i < m; i++) {
      const a = rng() * Math.PI * 2, r = 0.3 + Math.sqrt(rng()) * 1.4, x = cc.x + Math.cos(a) * r, z = cc.z + Math.sin(a) * r;
      beads.push({ x, z, y: terrainHeight(x, z) + 0.03, r: 0.009 + Math.pow(rng(), 2) * 0.014, tint });
    }
  });
  const tints = (list: { tint: Color }[]) => {
    const a = new Float32Array(list.length * 3); list.forEach((f, i) => a.set([f.tint.r, f.tint.g, f.tint.b], i * 3));
    return instancedBufferAttribute(new InstancedBufferAttribute(a, 3), 'vec3') as unknown as Node<'vec3'>;
  };
  if (fronds.length) {
    const tint = tints(fronds);
    const m = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0, side: DoubleSide });
    m.lightsNode = moonOnly();
    const t = uv().y, id = float(instanceIndex), phase = hash(id).mul(6.283), bend = t.mul(t);
    m.positionNode = positionLocal.add(vec3(sin(simTime.mul(0.9).add(phase).add(t.mul(2.4))).mul(0.2).mul(bend), 0, cos(simTime.mul(0.66).add(phase.mul(1.7)).add(t.mul(1.6))).mul(0.14).mul(bend)));
    // Dark fronds lit by the moon/lantern like the seagrass; a slow, faint wave of light toward the tip.
    const shaded = underwaterShading(mix(c('#0d1a18'), c('#24403a'), t.mul(0.8).add(0.1)), normalWorldGeometry, 3, false);
    const wave = sin(simTime.mul(0.7).sub(t.mul(5)).add(phase)).mul(0.5).add(0.5).pow(4);
    const glow = smoothstep(0.5, 1.0, t).mul(wave.mul(0.7).add(0.3)).mul(sin(simTime.mul(0.25).add(phase.mul(3))).mul(0.2).add(0.8));
    m.colorNode = shaded.albedo;
    m.emissiveNode = shaded.emissive.add(tint.mul(glow).mul(0.65).mul(plantGlow));
    const mesh = new InstancedMesh(bladeGeometry(10, 0.9, 0.22), m, fronds.length);
    place(mesh, fronds); mesh.name = 'Glow algae'; group.add(mesh);
  }
  if (beads.length) {
    const tint = tints(beads);
    const m = new MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0 });
    m.lightsNode = moonOnly();
    const id = float(instanceIndex);
    // Slow, faint twinkle.
    const twinkle = sin(simTime.mul(hash(id.add(9)).mul(0.5).add(0.15)).add(hash(id).mul(40))).mul(0.5).add(0.5);
    m.colorNode = c('#1a2a28');
    // Small but hot: the twinkle peak rises above the bloom threshold so each bead blooms a little.
    m.emissiveNode = tint.mul(twinkle.pow(3).mul(4.5).add(0.25)).mul(plantGlow);
    const mesh = new InstancedMesh(new SphereGeometry(1, 8, 6), m, beads.length);
    beads.forEach((b, i) => { dummy.position.set(b.x, b.y + b.r * 0.6, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(b.r); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.name = 'Grape algae'; group.add(mesh);
    // A tiny soft halo per bead (local bloom; the global bloom is kept low): camera-facing, twinkling with its bead,
    // alpha-preserving additive and drawn before the water so it is refracted like the bead.
    const base = new Float32Array(beads.length * 4); beads.forEach((b, i) => base.set([b.x, b.y + b.r * 0.6, b.z, b.r * 7], i * 4));
    const B = instancedBufferAttribute(new InstancedBufferAttribute(base, 4), 'vec4') as unknown as Node<'vec4'>;
    const hm = glowBlending(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
    const camWorld = cameraWorldMatrix as unknown as { element(i: number): Node<'vec4'> };
    hm.positionNode = B.xyz.add(camWorld.element(0).xyz.mul(positionGeometry.x).add(camWorld.element(1).xyz.mul(positionGeometry.y)).mul(B.w));
    const r2 = uv().sub(0.5).mul(2).dot(uv().sub(0.5).mul(2));
    hm.colorNode = tint.mul(r2.mul(-7).exp().mul(float(1).sub(smoothstep(0.6, 1, r2)))).mul(twinkle.pow(3).mul(0.9).add(0.06)).mul(plantGlow);
    const halos = new InstancedMesh(new PlaneGeometry(2, 2), hm, beads.length);
    halos.frustumCulled = false; halos.renderOrder = 2; halos.name = 'Grape algae glow'; group.add(halos);
  }
  return { group };
}
