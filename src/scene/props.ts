import { BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Euler, Float32BufferAttribute, LatheGeometry, Mesh, MeshStandardNodeMaterial, Object3D, Quaternion, Scene, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, color, float, mix, mx_noise_float, normalWorldGeometry, positionLocal, positionWorld, smoothstep, vec3, vertexColor } from 'three/tsl';
import { BOAT, WORLD } from '../config';
import { simTime } from '../state';
import { random } from '../lib/random';
import { emitRipple, oceanHeightCpu } from '../lib/ocean';
import { underwaterShading } from './materials';

const c = (hex: string) => color(hex) as unknown as Node<'vec3'>;

/** Adds vertex colour + a per-part grain scale (x,y,z noise frequency) to a geometry. */
function paint(g: BufferGeometry, hex: string, grain: [number, number, number], jitter = 0.08, seed = 1) {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('position').count, rng = random(seed), col = new Float32Array(n * 3), gr = new Float32Array(n * 3);
  const base = c;
  void base;
  const tmp = new Object3D();
  void tmp;
  const r = parseInt(hex.slice(1, 3), 16) / 255, gg = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const k = 1 + (rng() - 0.5) * 2 * jitter;
  const lin = (v: number) => Math.pow(v, 2.2);
  for (let i = 0; i < n; i++) { col.set([lin(r) * k, lin(gg) * k, lin(b) * k], i * 3); gr.set(grain, i * 3); }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aGrain', new Float32BufferAttribute(gr, 3));
  geo.computeVertexNormals();
  return geo;
}
const place = (g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.applyQuaternion(new Quaternion().setFromEuler(new Euler(rx, ry, rz))); g.translate(x, y, z); return g;
};

/** A weathered slatted crate with corner posts, cross braces and nails. About 1.6 units. */
function crateGeometry(seed: number) {
  const rng = random(seed), parts: BufferGeometry[] = [], h = 0.8;
  const woods = ['#a67c4e', '#96703f', '#b58a57', '#8a6538', '#a07848'];
  const wood = () => woods[Math.floor(rng() * woods.length)];
  parts.push(paint(new BoxGeometry(2 * h - 0.2, 2 * h - 0.2, 2 * h - 0.2), '#2a2118', [4, 4, 4], 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(paint(new BoxGeometry(0.2, 2 * h, 0.2), '#7c5730', [3, 0.25, 3], 0.1, seed + sx * 3 + sz));
  const planksPerSide = 4, ph = (2 * h - 0.06) / planksPerSide;
  for (let side = 0; side < 4; side++) {
    const a = side * Math.PI / 2;
    for (let i = 0; i < planksPerSide; i++) {
      const y = -h + 0.03 + ph * (i + 0.5), len = 2 * h - 0.28 + (rng() - 0.5) * 0.02;
      const plank = paint(new BoxGeometry(len, ph - 0.03, 0.07), wood(), [0.3, 22, 22], 0.1, seed + side * 9 + i);
      place(plank, 0, y, h - 0.02); plank.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a)); parts.push(plank);
      for (const sx of [-1, 1]) {
        const nail = paint(new CylinderGeometry(0.022, 0.022, 0.03, 6), '#3b3733', [8, 8, 8], 0.2, seed + i);
        place(nail, sx * (len / 2 - 0.05), y, h + 0.03, Math.PI / 2); nail.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a)); parts.push(nail);
      }
    }
    // diagonal brace
    const brace = paint(new BoxGeometry(2.05, 0.15, 0.06), '#7c5a33', [0.3, 22, 22], 0.1, seed + side);
    brace.rotateZ(0.66); place(brace, 0, 0, h + 0.03); brace.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a)); parts.push(brace);
  }
  for (let i = 0; i < 5; i++) {
    if (i === 2 && seed % 2 === 0) continue; // a missing top plank on some crates
    const top = paint(new BoxGeometry(0.29, 0.07, 2 * h - 0.02), wood(), [22, 22, 0.3], 0.1, seed + 40 + i);
    place(top, -h + 0.16 + i * 0.32, h - 0.02, 0); parts.push(top);
  }
  return mergeGeometries(parts)!;
}

/** Red and white lifebuoy: smooth torus with alternating bands and a rope loop. */
function lifebuoyGeometry() {
  const parts: BufferGeometry[] = [];
  const ring = new TorusGeometry(0.72, 0.24, 28, 72).toNonIndexed();
  const pos = ring.getAttribute('position'), col = new Float32Array(pos.count * 3);
  const red = [Math.pow(0.86, 2.2), Math.pow(0.12, 2.2), Math.pow(0.1, 2.2)], white = [Math.pow(0.93, 2.2), Math.pow(0.92, 2.2), Math.pow(0.88, 2.2)];
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i)), band = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2;
    col.set(band ? white : red, i * 3);
  }
  ring.deleteAttribute('uv'); ring.setAttribute('color', new Float32BufferAttribute(col, 3));
  ring.setAttribute('aGrain', new Float32BufferAttribute(new Float32Array(pos.count * 3).fill(0), 3));
  ring.computeVertexNormals(); parts.push(ring);
  // rope: a garland hanging in swags around the outside
  const swags = 4, points: Vector3[] = [];
  for (let i = 0; i <= swags * 12; i++) {
    const t = i / (swags * 12), a = t * Math.PI * 2, sag = Math.sin((t * swags % 1) * Math.PI);
    const r = 0.96 + 0.02 * Math.sin(a * 8), y = -sag * 0.16 + 0.02;
    points.push(new Vector3(Math.cos(a) * (r - sag * 0.1), Math.sin(a) * (r - sag * 0.1), y));
  }
  const rope = new TubeGeometry(new CatmullRomCurve3(points, true), 160, 0.028, 6, true).toNonIndexed();
  const rp = rope.getAttribute('position').count, rc = new Float32Array(rp * 3), rg = new Float32Array(rp * 3);
  for (let i = 0; i < rp; i++) { rc.set([Math.pow(0.78, 2.2), Math.pow(0.66, 2.2), Math.pow(0.46, 2.2)], i * 3); }
  rope.deleteAttribute('uv'); rope.setAttribute('color', new Float32BufferAttribute(rc, 3)); rope.setAttribute('aGrain', new Float32BufferAttribute(rg, 3)); rope.computeVertexNormals();
  parts.push(rope);
  return mergeGeometries(parts)!;
}

/** Barrel: bulged staves with three metal hoops. */
function barrelGeometry() {
  const profile: Vector2[] = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16, y = (t - 0.5) * 1.5; profile.push(new Vector2(0.5 + 0.13 * Math.sin(t * Math.PI) - (Math.abs(t - 0.5) > 0.48 ? 0.02 : 0), y)); }
  const body = paint(new LatheGeometry(profile, 32), '#8a6238', [30, 0.3, 30], 0.06, 3);
  const parts = [body];
  for (const t of [0.14, 0.5, 0.86]) {
    const y = (t - 0.5) * 1.5, r = 0.5 + 0.13 * Math.sin(t * Math.PI);
    const hoop = paint(new CylinderGeometry(r + 0.02, r + 0.02, 0.07, 32, 1, true), '#494b50', [2, 2, 2], 0.05, 7);
    place(hoop, 0, y, 0); parts.push(hoop);
  }
  const lid = paint(new CylinderGeometry(0.5, 0.5, 0.05, 32), '#6d4d2b', [3, 20, 20], 0.05, 5); place(lid, 0, 0.74, 0); parts.push(lid);
  return mergeGeometries(parts)!;
}

/** A bleached, bent log with a stub of a branch. */
function driftwoodGeometry() {
  const curve = new CatmullRomCurve3([new Vector3(-1.5, 0, 0), new Vector3(-0.6, 0.12, 0.2), new Vector3(0.4, 0.05, -0.15), new Vector3(1.4, 0.16, 0.05)]);
  const main = new TubeGeometry(curve, 40, 0.17, 10, false);
  const p = main.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const k = 1 + 0.12 * Math.sin(i * 0.37) + 0.08 * Math.sin(i * 1.1); p.setXYZ(i, p.getX(i) * (1 + (k - 1) * 0.3), p.getY(i) * k, p.getZ(i) * k); }
  const parts = [paint(main, '#b7aa94', [0.6, 14, 14], 0.1, 11)];
  const stub = new CylinderGeometry(0.06, 0.1, 0.5, 8); stub.rotateZ(-0.9); stub.translate(-0.3, 0.3, 0.1);
  parts.push(paint(stub, '#a89b86', [0.6, 14, 14], 0.1, 12));
  return mergeGeometries(parts)!;
}

function propMaterial(gloss: number) {
  const m = new MeshStandardNodeMaterial({ roughness: gloss, metalness: 0 });
  const grain = attribute('aGrain', 'vec3') as unknown as Node<'vec3'>;
  const p = positionLocal;
  const fibre = mx_noise_float(p.mul(grain)).mul(0.5).add(0.5), fine = mx_noise_float(p.mul(grain.mul(3.1)).add(4)).mul(0.5).add(0.5);
  const hasGrain = smoothstep(0.1, 0.5, grain.x.add(grain.y).add(grain.z));
  const base = vertexColor().rgb;
  const weathered = base.mul(mix(float(1), fibre.mul(0.5).add(fine.mul(0.2)).add(0.55), hasGrain));
  // Salt-stained pale top, darker soaked lower part, faint algae right at the waterline.
  const shaded = underwaterShading(weathered, normalWorldGeometry, 3);
  const dirt = mx_noise_float(positionWorld.mul(2.3)).mul(0.5).add(0.5);
  m.colorNode = mix(shaded.albedo, shaded.albedo.mul(vec3(0.65, 0.78, 0.6)), smoothstep(0.55, 0.9, dirt).mul(0.4));
  m.emissiveNode = shaded.emissive;
  return m;
}

type Prop = { mesh: Mesh; home: Vector3; drift: number; phase: number; yawSpeed: number; draft: number; spread: number; size: number; pitch: number; roll: number; ry: number; y: number; ripple: number };

/**
 * Floating props: crates, a lifebuoy, a barrel and a piece of driftwood. They drift in small loops, sit at a draft
 * below the animated surface (heightAt), tilt to the wave normal with some lag, cast shadows and reflect in the water.
 */
export function createFloatingProps(scene: Scene) {
  const group = new Object3D(); group.name = 'Floating props'; scene.add(group);
  const wood = propMaterial(0.8), painted = propMaterial(0.5), metal = propMaterial(0.7);
  void metal;
  const rng = random(77);
  const defs: { geo: BufferGeometry; mat: MeshStandardNodeMaterial; at: [number, number]; draft: number; size: number; spread: number; yaw: number }[] = [
    { geo: crateGeometry(2), mat: wood, at: [-12, 9], draft: 0.34, size: 1, spread: 2.6, yaw: 0.06 },
    { geo: crateGeometry(5), mat: wood, at: [-9.2, 11.4], draft: 0.4, size: 0.9, spread: 2.2, yaw: -0.05 },
    { geo: crateGeometry(7), mat: wood, at: [12.5, -8], draft: 0.36, size: 1.05, spread: 2.8, yaw: 0.04 },
    { geo: crateGeometry(4), mat: wood, at: [3, -13.5], draft: 0.38, size: 0.85, spread: 2.4, yaw: -0.07 },
    { geo: lifebuoyGeometry(), mat: painted, at: [-4.5, 13], draft: 0.12, size: 1.1, spread: 2.0, yaw: 0.08 },
    { geo: barrelGeometry(), mat: wood, at: [13.5, 1.5], draft: 0.55, size: 1, spread: 2.2, yaw: 0.03 },
    { geo: driftwoodGeometry(), mat: wood, at: [-13.5, -8], draft: 0.08, size: 1.3, spread: 3.0, yaw: 0.05 },
  ];
  const props: Prop[] = defs.map((d, i) => {
    const mesh = new Mesh(d.geo, d.mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.enable(1); mesh.frustumCulled = false; mesh.scale.setScalar(d.size * 1.7);
    mesh.name = 'Floating prop'; group.add(mesh);
    if (i === 4) mesh.rotation.order = 'YXZ';
    return { mesh, home: new Vector3(d.at[0], 0, d.at[1]), drift: 0.05 + rng() * 0.05, phase: rng() * 6.28, yawSpeed: d.yaw, draft: d.draft, spread: d.spread, size: d.size * 1.7, pitch: 0, roll: 0, ry: rng() * 6.28, y: WORLD.surface, ripple: rng() * 3, isBuoy: i === 4 } as Prop & { isBuoy: boolean };
  });
  // Keep clear of the boat's mooring.
  props.forEach(p => { if (Math.hypot(p.home.x - BOAT.x, p.home.z - BOAT.z) < 6) p.home.x -= 8; });

  const grad = { gx: 0, gz: 0 }, up = new Vector3(0, 1, 0), q = new Quaternion(), qy = new Quaternion(), normal = new Vector3();
  return {
    group,
    update(dt: number) {
      const t = simTime.value;
      for (const p of props as (Prop & { isBuoy: boolean })[]) {
        const x = p.home.x + Math.sin(t * p.drift + p.phase) * p.spread, z = p.home.z + Math.cos(t * p.drift * 0.83 + p.phase * 1.7) * p.spread * 0.8;
        const half = p.size * 0.6;
        // Waterline height: average of a few samples under the footprint; tilt from the wave slope.
        const h0 = WORLD.surface + oceanHeightCpu(x, z, t, grad);
        const hx = WORLD.surface + oceanHeightCpu(x + half, z, t), hz = WORLD.surface + oceanHeightCpu(x, z + half, t);
        const hxm = WORLD.surface + oceanHeightCpu(x - half, z, t), hzm = WORLD.surface + oceanHeightCpu(x, z - half, t);
        const target = (h0 * 2 + hx + hz + hxm + hzm) / 6 - p.draft * p.size;
        const k = 1 - Math.exp(-dt * 4);
        p.y += (target - p.y) * k;
        p.roll += (Math.atan2(hxm - hx, half * 2) - p.roll) * k; p.pitch += (Math.atan2(hz - hzm, half * 2) - p.pitch) * k;
        p.ry += p.yawSpeed * dt;
        p.mesh.position.set(x, p.y, z);
        normal.set(0, 1, 0);
        qy.setFromAxisAngle(up, p.ry);
        q.setFromEuler(new Euler(p.pitch + (p.isBuoy ? -Math.PI / 2 : 0), 0, p.roll * 1.0, 'XYZ'));
        // Lifebuoy lies flat: its torus axis (z) is the up axis of the prop.
        if (p.isBuoy) { const flat = new Quaternion().setFromEuler(new Euler(-Math.PI / 2 + p.pitch, 0, -p.roll, 'XYZ')); p.mesh.quaternion.copy(qy).multiply(flat); }
        else p.mesh.quaternion.copy(qy).premultiply(q.setFromEuler(new Euler(p.pitch, 0, p.roll, 'XYZ')));
        p.ripple -= dt;
        if (p.ripple <= 0) { p.ripple = 2.5 + Math.random() * 3.5; emitRipple(x + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6, 0.16, true); }
      }
    },
  };
}
