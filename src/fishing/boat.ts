import { BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardNodeMaterial, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { World } from '../contracts';
import { BASIN, BOAT } from '../config';
import { RIG_SCALE, clamp, damp, grid, merge, mk, rnd, smoothMaterial, tube } from './build';
import { woodTextures } from './textures';

/**
 * Procedural clinker rowboat. Local frame: +x = bow, +y = up, +z = starboard, y = 0 is the waterline.
 * Smooth-shaded, textured (procedural wood grain), ~2.0 long before RIG_SCALE. Three meshes: wood, metal, misc (+ lantern glass).
 */

/** Bow points at the island / open water, turned a bit so the default camera sees a 3/4 view. */
export const BOAT_HEADING = (() => {
  // bow toward the basin, pulled a little toward the default camera (46, 31, 56) for a 3/4 view of the fisherman
  const bx = BASIN.x - BOAT.x, bz = BASIN.z - BOAT.z, bl = Math.hypot(bx, bz);
  const cx = 46 - BOAT.x, cz = 56 - BOAT.z, cl = Math.hypot(cx, cz);
  const fx = bx / bl + 0.45 * (cx / cl), fz = bz / bl + 0.45 * (cz / cl);
  return Math.atan2(-fz, fx);
})();

const NS = 48; // stations along the hull
const gunY = (u: number) => 0.16 + 0.12 * u * u; // sheer line (rises at the ends)
const beam = (u: number) => 0.44 * Math.pow(Math.max(1 - Math.pow(Math.abs(u), 2.3), 0), 0.55); // half beam at the gunwale
const keelY = (u: number) => { const k = Math.pow(Math.abs(u), 3); return -0.3 + (gunY(u) - 0.02 + 0.3) * k; };
const prof = (s: number) => 0.1 + 0.9 * Math.pow(Math.sin(s * Math.PI * 0.5), 0.8); // cross-section curve
const U = (i: number, n = NS) => -1 + (2 * i) / n;

type V3 = [number, number, number];
const outerPt = (u: number, s: number, side: number, extra: number): V3 => {
  const b = beam(u), y0 = keelY(u), y1 = gunY(u);
  return [u, y0 + (y1 - y0) * s, side * (b * prof(s) + (b > 0.01 ? extra : 0))];
};
const innerPt = (u: number, s: number, side: number, inset = 0): V3 => {
  const b = Math.max(beam(u) - 0.04 - inset, 0), y0 = keelY(u) + 0.035, y1 = gunY(u);
  return [u, y0 + (y1 - y0) * s, side * b * prof(s)];
};

function buildWood(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // ---- clinker outer planks: 6 strakes x 3 rows, smooth inside a plank, hard step between planks ----
  const S = [0, 0.15, 0.31, 0.47, 0.63, 0.8, 1], R = 3;
  const colors = ['#7d5a38', '#d8a672', '#e2b484', '#d8a672', '#e2b484', '#c0463a'];
  for (const side of [-1, 1]) {
    for (let j = 0; j < S.length - 1; j++) {
      const off = rnd() * 4;
      parts.push(grid(NS, R,
        (i, k) => { const t = k / R, lap = 0.02 * Math.pow(1 - t, 1.6) + 0.006 * Math.sin(Math.PI * t); return outerPt(U(i), S[j] + (S[j + 1] - S[j]) * t, side, lap); },
        (i, k) => [((i / NS) * 4) + off, j * 0.29 + (k / R) * 0.27 + (side > 0 ? 0.5 : 0)],
        colors[j], 0.05));
    }
    // inner skin (3 broad strips)
    const IS = [0, 0.35, 0.7, 1];
    for (let j = 0; j < 3; j++) {
      parts.push(grid(NS, 3, (i, k) => innerPt(U(i), IS[j] + (IS[j + 1] - IS[j]) * (k / 3), side),
        (i, k) => [(i / NS) * 4, j * 0.3 + (k / 3) * 0.3 + 0.13], j % 2 ? '#d9b283' : '#cfa676', 0.04));
    }
    // gunwale caps (rounded rails) + inwale stringer
    const rail: V3[] = [], inwale: V3[] = [];
    for (let i = 0; i <= 32; i++) { const u = U(i, 32); rail.push([u, gunY(u) + 0.004, side * (beam(u) - 0.02)]); inwale.push([u, gunY(u) - 0.075, side * Math.max(beam(u) - 0.052, 0)]); }
    parts.push(tube(rail, 0.024, '#e8bf82', 10, [8, 1]));
    parts.push(tube(inwale, 0.014, '#c69558', 8, [8, 1]));
  }
  // keel + stems
  const keel: V3[] = []; for (let i = 0; i <= 24; i++) { const u = U(i, 24) * 0.965; keel.push([u, keelY(u) - 0.012, 0]); }
  parts.push(tube(keel, 0.03, '#6b4a2c', 8, [6, 1]));
  for (const sgn of [-1, 1]) parts.push(tube([[sgn * 0.93, 0.1, 0], [sgn * 0.985, 0.2, 0], [sgn * 1.02, 0.3, 0], [sgn * 1.03, 0.37, 0]], 0.026, '#8a6238', 8));
  // ribs (frames) over the floor
  for (let n = 0; n < 9; n++) {
    const u = -0.72 + n * 0.18, pts: V3[] = [];
    for (let k = 0; k <= 8; k++) pts.push(innerPt(u, 1 - k / 8, -1, 0.006));
    for (let k = 1; k <= 8; k++) pts.push(innerPt(u, k / 8, 1, 0.006));
    parts.push(tube(pts, 0.012, '#b58048', 6, [6, 1]));
  }
  // floor boards, thwarts, deck caps
  const rb = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r);
  for (let i = -1; i <= 1; i++) parts.push(mk(rb(0.9, 0.022, 0.092, 0.008), '#c9955a', [0, -0.175, i * 0.1], [0, 0, 0], [1, 1, 1], [3, 1]));
  parts.push(mk(rb(0.2, 0.036, 0.82, 0.014), '#dcaa70', [-0.12, 0.05, 0], [0, 0, 0], [1, 1, 1], [1, 2]));
  parts.push(mk(rb(0.17, 0.032, 0.62, 0.012), '#dcaa70', [0.5, 0.07, 0], [0, 0, 0], [1, 1, 1], [1, 2]));
  parts.push(mk(rb(0.24, 0.03, 0.4, 0.01), '#e0b078', [-0.78, 0.14, 0], [0, 0, 0.35], [1, 1, 1], [1, 1]));
  parts.push(mk(rb(0.18, 0.028, 0.26, 0.01), '#e0b078', [0.86, 0.2, 0], [0, 0, -0.35], [1, 1, 1], [1, 1]));
  // thwart knees
  for (const side of [-1, 1]) for (const x of [-0.12, 0.5]) parts.push(mk(rb(0.05, 0.1, 0.02, 0.006), '#a97a45', [x, -0.005, side * (x < 0 ? 0.4 : 0.32)]));
  // oars (shipped: blades trailing aft over the water)
  for (const side of [-1, 1]) {
    const d = new Vector3(-0.5, 0.16, side).normalize(), lock = new Vector3(0.3, 0.245, side * 0.42), centre = lock.clone().addScaledVector(d, 0.3);
    const oar = merge([
      mk(new CylinderGeometry(0.02, 0.02, 1.2, 14), '#c08a55', [0, 0, 0], [0, 0, 0], [1, 1, 1], [1, 6]),
      mk(rb(0.1, 0.36, 0.022, 0.01), '#c0463a', [0, 0.52, 0], [0, 0, 0], [1, 1, 1], [1, 2]),
      mk(new CylinderGeometry(0.024, 0.024, 0.14, 12), '#8a6238', [0, -0.53, 0]),
    ]);
    const axis = new Vector3(0, 1, 0).cross(d).normalize();
    oar.applyQuaternion(new Quaternion().setFromAxisAngle(axis, Math.acos(clamp(d.y, -1, 1))));
    oar.translate(centre.x, centre.y, centre.z);
    parts.push(oar);
  }
  return merge(parts);
}

function buildMetal(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(mk(new CylinderGeometry(0.012, 0.012, 0.07, 10), '#7d848c', [0.3, 0.21, side * 0.42]));
    parts.push(mk(new TorusGeometry(0.032, 0.008, 8, 20, Math.PI * 1.5), '#7d848c', [0.3, 0.255, side * 0.42], [Math.PI / 2, 0, 0.8]));
    parts.push(mk(new CylinderGeometry(0.02, 0.02, 0.012, 12), '#6a7078', [0.3, 0.18, side * 0.42]));
  }
  parts.push(mk(new TorusGeometry(0.036, 0.008, 8, 20), '#7d848c', [1.005, 0.17, 0], [0, Math.PI / 2, 0]));
  parts.push(mk(new RoundedBoxGeometry(0.07, 0.016, 0.028, 2, 0.006), '#7d848c', [0.92, 0.222, 0]));
  // bucket (galvanised)
  const bx = 0.74;
  parts.push(mk(new CylinderGeometry(0.115, 0.088, 0.22, 28, 1, true), '#a9b1ba', [bx, 0, 0]));
  parts.push(mk(new CylinderGeometry(0.109, 0.083, 0.22, 28, 1, true), '#7d848c', [bx, 0, 0]));
  parts.push(mk(new CylinderGeometry(0.088, 0.088, 0.01, 24), '#8d949c', [bx, -0.11, 0]));
  parts.push(mk(new TorusGeometry(0.116, 0.009, 8, 32), '#c0c7cf', [bx, 0.11, 0], [Math.PI / 2, 0, 0]));
  parts.push(mk(new TorusGeometry(0.1, 0.005, 8, 24, Math.PI), '#5c636b', [bx, 0.11, 0], [0, Math.PI / 2, 0]));
  parts.push(mk(new TorusGeometry(0.104, 0.006, 6, 28), '#8d949c', [bx, -0.02, 0], [Math.PI / 2, 0, 0]));
  // lantern frame
  const lx = -0.68, lz = 0.02;
  parts.push(mk(new CylinderGeometry(0.058, 0.064, 0.024, 16), '#3b3f45', [lx, -0.137, lz]));
  parts.push(mk(new CylinderGeometry(0.03, 0.062, 0.03, 16), '#3b3f45', [lx, -0.0, lz]));
  parts.push(mk(new SphereGeometry(0.014, 8, 6), '#3b3f45', [lx, 0.026, lz]));
  parts.push(mk(new TorusGeometry(0.048, 0.005, 6, 16, Math.PI), '#3b3f45', [lx, 0.0, lz], [0, 0, 0]));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.78; parts.push(mk(new CylinderGeometry(0.004, 0.004, 0.12, 6), '#3b3f45', [lx + Math.cos(a) * 0.05, -0.07, lz + Math.sin(a) * 0.05])); }
  return merge(parts);
}

function buildMisc(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rb = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r);
  // tackle box
  parts.push(mk(rb(0.26, 0.09, 0.15, 0.014), '#d0463c', [-0.38, -0.12, -0.2], [0, 0.25, 0]));
  parts.push(mk(rb(0.27, 0.02, 0.16, 0.008), '#f0d9a8', [-0.38, -0.065, -0.2], [0, 0.25, 0]));
  parts.push(mk(rb(0.09, 0.014, 0.024, 0.005), '#8d949c', [-0.38, -0.05, -0.2], [0, 0.25, 0]));
  parts.push(mk(new TorusGeometry(0.05, 0.007, 6, 16, Math.PI), '#3b3f45', [-0.38, -0.05, -0.2], [0, 0.25, 0]));
  // rope coil (three turns) + mooring rope through the bow ring
  for (let i = 0; i < 3; i++) parts.push(mk(new TorusGeometry(0.07 - i * 0.004, 0.017, 8, 24), i % 2 ? '#cdb37a' : '#d8c08a', [-0.15, -0.155 + i * 0.026, 0.24], [Math.PI / 2, 0, 0]));
  parts.push(tube([[1.0, 0.19, 0], [1.1, 0.09, 0.03], [1.2, 0.02, 0.06], [1.24, -0.04, 0.0], [1.3, -0.05, -0.06]], 0.011, '#d3ba82', 6));
  parts.push(mk(new SphereGeometry(0.05, 14, 10), '#eee7d4', [0.16, -0.135, -0.22]));
  // water inside the bucket
  parts.push(mk(new CylinderGeometry(0.107, 0.107, 0.008, 24), '#4fb0d8', [0.74, 0.05, 0]));
  return merge(parts);
}

export function createBoat(world: World) {
  const group = new Group();
  group.rotation.order = 'YZX';
  group.scale.setScalar(RIG_SCALE);

  const wood = woodTextures();
  const parts: [BufferGeometry, ReturnType<typeof smoothMaterial>][] = [
    [buildWood(), smoothMaterial({ roughness: 1, map: wood.map, roughnessMap: wood.rough })],
    [buildMetal(), smoothMaterial({ roughness: 0.38, metalness: 0.85 })],
    [buildMisc(), smoothMaterial({ roughness: 0.6 })],
  ];
  for (const [g, m] of parts) { const mesh = new Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }

  const glassMat = new MeshStandardNodeMaterial({ color: '#ffd889', emissive: new Color('#ffa726'), emissiveIntensity: 2.2, roughness: 0.3, transparent: true, opacity: 0.92 });
  const glass = new Mesh(new CylinderGeometry(0.043, 0.043, 0.115, 16), glassMat);
  glass.position.set(-0.68, -0.07, 0.02);
  group.add(glass);

  const p = { x: BOAT.x as number, z: BOAT.z as number, y: world.heightAt(BOAT.x, BOAT.z), yaw: BOAT_HEADING, pitch: 0, roll: 0 };
  const kick = { roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
  let clock = 0, rippleT = 1.5;
  const tmp = new Vector3();

  const sample = (lx: number, lz: number) => {
    lx *= RIG_SCALE; lz *= RIG_SCALE;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    return world.heightAt(p.x + lx * c + lz * s, p.z - lx * s + lz * c);
  };

  return {
    group,
    /** Current planar position / yaw (for the fisherman and the game). */
    state: p,
    /** Give the hull a push: roll (rad/s impulse, +z side goes down) and pitch (bow up). */
    kick(roll: number, pitch = 0) { kick.rollV += roll; kick.pitchV += pitch; },
    localToWorld(x: number, y: number, z: number, out: Vector3) { return group.localToWorld(out.set(x, y, z)); },
    /** World-space centre of the bucket opening. */
    bucket(out: Vector3) { return group.localToWorld(out.set(0.74, 0.08, 0)); },
    update(dt: number) {
      clock += dt;
      const px = BOAT.x + Math.sin(clock * 0.31) * 0.05 + Math.sin(clock * 0.13 + 1) * 0.03;
      const pz = BOAT.z + Math.cos(clock * 0.27) * 0.05 + Math.sin(clock * 0.11) * 0.025;
      const yaw = BOAT_HEADING + Math.sin(clock * 0.21) * 0.035 + Math.sin(clock * 0.09 + 2) * 0.03;
      p.x = damp(p.x, px, 2, dt); p.z = damp(p.z, pz, 2, dt); p.yaw = damp(p.yaw, yaw, 2, dt);
      const hb = sample(0.9, 0), hs = sample(-0.9, 0), hr = sample(0, 0.4), hl = sample(0, -0.4), hc = sample(0, 0);
      const target = (hb + hs + hr + hl + hc * 2) / 6 + 0.1 * RIG_SCALE;
      const pitchT = Math.atan2(hb - hs, 1.8 * RIG_SCALE), rollT = -Math.atan2(hr - hl, 0.8 * RIG_SCALE);
      const k = 1 - Math.exp(-dt * 6);
      p.y += (target - p.y) * k; p.pitch += (pitchT - p.pitch) * k; p.roll += (rollT - p.roll) * k;
      kick.rollV += (-40 * kick.roll - 3.2 * kick.rollV) * dt; kick.roll += kick.rollV * dt;
      kick.pitchV += (-46 * kick.pitch - 3.4 * kick.pitchV) * dt; kick.pitch += kick.pitchV * dt;
      const bob = Math.sin(clock * 1.7) * 0.012 * RIG_SCALE;
      group.position.set(p.x, p.y + bob, p.z);
      group.rotation.set(p.roll + kick.roll + Math.sin(clock * 1.3) * 0.012, p.yaw, p.pitch + kick.pitch + Math.sin(clock * 1.1 + 1) * 0.01);
      group.updateMatrixWorld(true);
      glassMat.emissiveIntensity = 2 + Math.sin(clock * 9) * 0.15 + Math.sin(clock * 23) * 0.1;
      rippleT -= dt;
      if (rippleT <= 0) {
        rippleT = 1.6 + Math.random() * 1.8;
        const side = Math.random() < 0.5 ? -1 : 1, lx = (Math.random() - 0.5) * 1.4 * RIG_SCALE, lz = side * (0.3 + Math.random() * 0.1) * RIG_SCALE;
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        tmp.set(p.x + lx * c + lz * s, 0, p.z - lx * s + lz * c); tmp.y = world.heightAt(tmp.x, tmp.z);
        world.ripple(tmp, 0.12 + Math.abs(kick.roll) * 2);
      }
    },
  };
}
export type Boat = ReturnType<typeof createBoat>;
