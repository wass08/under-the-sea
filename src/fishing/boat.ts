import { BufferGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, MeshBasicNodeMaterial, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { World } from '../contracts';
import { BASIN, BOAT } from '../config';
import { RIG_SCALE, damp, merge, mk, rnd, smoothMaterial, tube } from './build';
import { cameraPosition, cos, float, materialColor, mix, mx_noise_float, output, positionLocal, positionWorld, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { lanternPosition, lanternPower, waterLevel } from '../state';

/**
 * Procedural bamboo raft (Li River style): nine lashed poles whose bows sweep up, three cross poles, a stool for the
 * fisherman, a woven fish creel and a bamboo lantern pole arching out over the water with a paper lantern hanging
 * from it. Local frame: +x = bow, +y = up, +z = starboard, y = 0 is the waterline; ~2.2 long before RIG_SCALE.
 */

/** Bow points into open water, turned a bit so the default camera sees a 3/4 view. */
export const BOAT_HEADING = (() => {
  const bx = BASIN.x - BOAT.x, bz = BASIN.z - BOAT.z, bl = Math.hypot(bx, bz) || 1;
  const cx = 24 - BOAT.x, cz = 33 - BOAT.z, cl = Math.hypot(cx, cz);
  const fx = bx / bl + 0.45 * (cx / cl), fz = bz / bl + 0.45 * (cz / cl);
  return Math.atan2(-fz, fx);
})();

type V3 = [number, number, number];
const POLES = 9, POLE_R = 0.047, HALF_W = 0.4;
/** Pole centreline height along the raft: flat, sweeping up at the bow (more in the middle), a small kick at the stern. */
const poleY = (x: number, z: number) => {
  const mid = 1 - Math.abs(z) / HALF_W;
  const bow = Math.max(0, x - 0.5) / 0.6, stern = Math.max(0, -x - 0.72) / 0.36;
  return -0.006 + (0.16 + 0.26 * mid) * bow * bow + 0.07 * stern * stern;
};
const poleLen = (z: number) => [-1.08 + Math.abs(z) * 0.18, 1.1 - Math.abs(z) * 0.32];

/** Fisherman's seat height (top of the stool), and the fisherman's rig origin above it. */
export const SEAT = { x: -0.12, top: 0.235, rigY: 0.31 } as const;
/** Lantern pole tip (cord anchor) and cord length, boat-local. */
const LANTERN_TIP: V3 = [1.3, 1.16, 0.62], CORD = 0.2;
/** Fish creel (basket) position and opening height. */
const CREEL: V3 = [0.62, 0.05, -0.2];

function buildBamboo(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const greens = ['#c2ad62', '#b8a254', '#cbb46a', '#a99a4e', '#bfa95c'];
  for (let i = 0; i < POLES; i++) {
    const z = -HALF_W + (2 * HALF_W * i) / (POLES - 1), [x0, x1] = poleLen(z), r = POLE_R * (0.92 + rnd() * 0.16);
    const pts: V3[] = [];
    for (let k = 0; k <= 16; k++) { const x = x0 + (x1 - x0) * k / 16; pts.push([x, poleY(x, z), z]); }
    parts.push(tube(pts, r, greens[i % greens.length], 12, [6, 1]));
    // Nodes: slightly proud rings every ~0.3, offset per pole.
    const off = rnd() * 0.3;
    for (let x = x0 + 0.12 + off; x < x1 - 0.08; x += 0.29 + rnd() * 0.04) {
      const e = 0.02, dy = (poleY(x + e, z) - poleY(x - e, z)) / (2 * e);
      parts.push(mk(new TorusGeometry(r * 1.02, 0.0065, 6, 16), '#8a7a3a', [x, poleY(x, z), z], [0, Math.PI / 2, -Math.atan(dy)]));
    }
  }
  // Cross poles on top, lashed to every pole.
  for (const x of [-0.66, 0.02, 0.58]) {
    const y = poleY(x, 0) + POLE_R + 0.026;
    parts.push(tube([[x, y, -HALF_W - 0.07], [x, y + 0.004, 0], [x, y, HALF_W + 0.07]], 0.028, '#a8924c', 10, [3, 1]));
  }
  // Punting pole lying along the port side.
  parts.push(tube([[-1.0, 0.085, -0.31], [0, 0.088, -0.3], [1.02, 0.09, -0.29]], 0.019, '#b9a35a', 8, [8, 1]));
  // Lantern pole: lashed to the bow cross pole, arching up and out over the starboard bow.
  parts.push(tube([[0.5, 0.06, 0.34], [0.62, 0.42, 0.42], [0.86, 0.84, 0.52], [1.1, 1.08, 0.59], LANTERN_TIP], 0.022, '#bfa95c', 10, [5, 1]));
  // Stool: four bamboo legs, two rails and a slatted seat.
  const sx = SEAT.x;
  for (const [dx, dz] of [[-0.09, -0.12], [0.09, -0.12], [-0.09, 0.12], [0.09, 0.12]]) {
    parts.push(mk(new CylinderGeometry(0.016, 0.018, SEAT.top - 0.06, 8), '#a8924c', [sx + dx, 0.06 + (SEAT.top - 0.06) / 2 - 0.012, dz]));
  }
  for (const dz of [-0.12, 0.12]) parts.push(mk(new CylinderGeometry(0.011, 0.011, 0.2, 8), '#a8924c', [sx, 0.13, dz], [0, 0, Math.PI / 2]));
  for (let k = 0; k < 5; k++) parts.push(mk(new RoundedBoxGeometry(0.24, 0.016, 0.052, 2, 0.006), '#c6b06a', [sx, SEAT.top - 0.008, -0.11 + k * 0.055]));
  return merge(parts);
}

/** Rope lashings and the lantern cord (matte fibre). */
function buildRope(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const x of [-0.66, 0.02, 0.58]) {
    for (let i = 0; i < POLES; i++) {
      const z = -HALF_W + (2 * HALF_W * i) / (POLES - 1);
      const y = poleY(x, z) + POLE_R * 0.4;
      parts.push(mk(new TorusGeometry(0.046, 0.0075, 5, 14), '#7a5f3a', [x, y, z], [0, 0, Math.PI / 2 + 0.5], [1, 1.25, 1]));
    }
  }
  // Pole-to-crosspole lashing for the lantern pole.
  for (let k = 0; k < 3; k++) parts.push(mk(new TorusGeometry(0.03, 0.007, 5, 12), '#7a5f3a', [0.54 + k * 0.025, 0.12 + k * 0.05, 0.36], [Math.PI / 2, 0, 0]));
  // Coiled rope by the stool.
  for (let i = 0; i < 3; i++) parts.push(mk(new TorusGeometry(0.065 - i * 0.004, 0.015, 6, 20), i % 2 ? '#a8885a' : '#b89a68', [-0.5, 0.075 + i * 0.022, 0.22], [Math.PI / 2, 0, 0]));
  // Mooring line trailing from the bow.
  parts.push(tube([[1.08, 0.3, 0], [1.16, 0.12, 0.02], [1.24, 0.0, 0.05], [1.32, -0.06, 0.0]], 0.008, '#a8885a', 6));
  return merge(parts);
}

/** Woven fish creel: bulbous lathe body with a narrow neck; the weave is shaded procedurally. */
function buildCreel(): BufferGeometry {
  const profile = [[0.001, 0], [0.08, 0.004], [0.115, 0.04], [0.125, 0.1], [0.112, 0.16], [0.075, 0.2], [0.062, 0.225], [0.068, 0.245], [0.064, 0.25]].map(p => new Vector2(p[0], p[1]));
  const body = mk(new LatheGeometry(profile, 32), '#b49352', CREEL, [0, 0, 0], [1, 1, 1], [12, 10]);
  const rim = mk(new TorusGeometry(0.066, 0.008, 6, 24), '#8a6c3a', [CREEL[0], CREEL[1] + 0.246, CREEL[2]], [Math.PI / 2, 0, 0]);
  return merge([body, rim]);
}

/**
 * Paper lantern (chochin): ribbed glowing paper between dark lacquered caps, with a tassel. Built around its own
 * origin (the cord anchor) so it can swing as a pendulum. Returns the meshes and the glow uniform.
 */
function buildLantern() {
  const pendulum = new Group();
  const H = 0.36, Rr = 0.16, top = -CORD;
  const prof: Vector2[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24, y = (t - 0.5) * H, e = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(y / (H * 0.5)), 2.4)));
    prof.push(new Vector2(Math.max(0.066, Rr * e), y));
  }
  const paper = new LatheGeometry(prof, 40);
  paper.translate(0, top - H / 2 - 0.02, 0);
  const glow = uniform(1);
  const mat = new MeshBasicNodeMaterial({ side: 2 });
  // Ribs every ~1.5 cm show as darker hoops; the paper is hottest at the belly and toward the flame.
  const ribs = smoothstep(0.82, 1.0, cos(uv().y.mul(Math.PI * 2 * 15)).mul(0.5).add(0.5));
  const belly = smoothstep(0.0, 0.5, float(0.5).sub(uv().y.sub(0.5).abs()));
  const mottled = mx_noise_float(positionLocal.mul(38)).mul(0.12).add(1);
  const hot = vec3(1.0, 0.62, 0.26), deep = vec3(0.95, 0.28, 0.07);
  mat.colorNode = mix(deep, hot, belly).mul(mix(float(1), float(0.35), ribs)).mul(belly.mul(5).add(2.2)).mul(mottled).mul(glow);
  const paperMesh = new Mesh(paper, mat); paperMesh.name = 'Lantern paper';
  const capMat = smoothMaterial({ roughness: 0.35 });
  const caps = new Mesh(merge([
    mk(new CylinderGeometry(0.07, 0.072, 0.028, 20), '#2a1610', [0, top - 0.022, 0]),
    mk(new CylinderGeometry(0.072, 0.07, 0.028, 20), '#2a1610', [0, top - H - 0.018, 0]),
    mk(new TorusGeometry(0.018, 0.004, 6, 12), '#2a1610', [0, top + 0.002, 0]),
    mk(new CylinderGeometry(0.0025, 0.0025, CORD, 4), '#3a2a1a', [0, -CORD / 2 + 0.004, 0]),
    mk(new SphereGeometry(0.014, 8, 6), '#c0392b', [0, top - H - 0.045, 0]),
    mk(new CylinderGeometry(0.004, 0.022, 0.11, 10, 1, true), '#c0392b', [0, top - H - 0.105, 0]),
  ]), capMat);
  pendulum.add(paperMesh, caps);
  return { pendulum, glow, centre: new Vector3(0, top - H / 2 - 0.02, 0) };
}

export function createBoat(world: World) {
  const group = new Group();
  group.rotation.order = 'YZX';
  group.scale.setScalar(RIG_SCALE);

  const bamboo = smoothMaterial({ roughness: 0.55 });
  // Bamboo: faint lengthwise fibres and a waxy sheen.
  const fibre = mx_noise_float(vec3(uv().x.mul(3), uv().y.mul(90), 1.3)).mul(0.1).add(1);
  const parts: [BufferGeometry, ReturnType<typeof smoothMaterial>][] = [
    [buildBamboo(), bamboo],
    [buildRope(), smoothMaterial({ roughness: 0.95 })],
    [buildCreel(), smoothMaterial({ roughness: 0.9 })],
  ];
  for (const [g, m] of parts) {
    // Moonlit/lantern-lit above the water; the wet underside reads as a silhouette through the surface.
    const submergedView = smoothstep(0, 0.6, waterLevel.sub(cameraPosition.y));
    const wetHull = smoothstep(-0.03, 0.12, waterLevel.sub(positionWorld.y));
    const weave = m === parts[2]?.[1] ? mix(float(0.7), float(1.12), smoothstep(-0.2, 0.4, cos(uv().x.mul(Math.PI * 2 * 3)).mul(cos(uv().y.mul(Math.PI * 2 * 3))))) : float(1);
    m.colorNode = materialColor.mul(m === bamboo ? fibre : float(1)).mul(weave).mul(mix(float(1), float(0.55), wetHull)).mul(mix(float(1), float(0.06), submergedView.mul(wetHull)));
    // From below the albedo alone is not enough: the waxy sheen still catches the night sky along every pole as grey
    // rims. Damp the whole lit result of the wet underside so the hull is one dark silhouette against the lantern pool.
    m.outputNode = vec4(output.rgb.mul(mix(float(1), float(0.22), submergedView.mul(wetHull))), output.a);
    const mesh = new Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }

  const lantern = buildLantern();
  const pivot = new Group(); pivot.position.set(...LANTERN_TIP); pivot.add(lantern.pendulum); group.add(pivot);

  const p = { x: BOAT.x as number, z: BOAT.z as number, y: world.heightAt(BOAT.x, BOAT.z), yaw: BOAT_HEADING, pitch: 0, roll: 0 };
  const kick = { roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
  const swing = { x: 0, vx: 0, z: 0, vz: 0 };
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
    kick(roll: number, pitch = 0) { kick.rollV += roll; kick.pitchV += pitch; swing.vx -= pitch * 0.8; swing.vz += roll * 0.8; },
    localToWorld(x: number, y: number, z: number, out: Vector3) { return group.localToWorld(out.set(x, y, z)); },
    /** World-space centre of the creel opening. */
    bucket(out: Vector3) { return group.localToWorld(out.set(CREEL[0], CREEL[1] + 0.25, CREEL[2])); },
    /** World-space centre of the glowing lantern. */
    lantern(out: Vector3) { return lantern.pendulum.localToWorld(out.copy(lantern.centre)); },
    update(dt: number) {
      clock += dt;
      const px = BOAT.x + Math.sin(clock * 0.31) * 0.05 + Math.sin(clock * 0.13 + 1) * 0.03;
      const pz = BOAT.z + Math.cos(clock * 0.27) * 0.05 + Math.sin(clock * 0.11) * 0.025;
      const yaw = BOAT_HEADING + Math.sin(clock * 0.21) * 0.035 + Math.sin(clock * 0.09 + 2) * 0.03;
      p.x = damp(p.x, px, 2, dt); p.z = damp(p.z, pz, 2, dt); p.yaw = damp(p.yaw, yaw, 2, dt);
      const hb = sample(0.9, 0), hs = sample(-0.9, 0), hr = sample(0, 0.4), hl = sample(0, -0.4), hc = sample(0, 0);
      // A raft floats high: the centreline sits on the mean surface.
      const target = (hb + hs + hr + hl + hc * 2) / 6 + 0.02 * RIG_SCALE;
      const pitchT = Math.atan2(hb - hs, 1.8 * RIG_SCALE), rollT = -Math.atan2(hr - hl, 0.8 * RIG_SCALE);
      const k = 1 - Math.exp(-dt * 6);
      const prevRoll = p.roll, prevPitch = p.pitch;
      p.y += (target - p.y) * k; p.pitch += (pitchT - p.pitch) * k; p.roll += (rollT - p.roll) * k;
      kick.rollV += (-40 * kick.roll - 3.2 * kick.rollV) * dt; kick.roll += kick.rollV * dt;
      kick.pitchV += (-46 * kick.pitch - 3.4 * kick.pitchV) * dt; kick.pitch += kick.pitchV * dt;
      const bob = Math.sin(clock * 1.7) * 0.012 * RIG_SCALE;
      group.position.set(p.x, p.y + bob, p.z);
      group.rotation.set(p.roll + kick.roll + Math.sin(clock * 1.3) * 0.012, p.yaw, p.pitch + kick.pitch + Math.sin(clock * 1.1 + 1) * 0.01);
      // The lantern hangs as a damped pendulum: the hull's rocking drives it (it lags, then swings back).
      if (dt > 0) {
        const dr = (p.roll - prevRoll) / dt, dp = (p.pitch - prevPitch) / dt;
        swing.vz += (-14 * swing.z - 1.1 * swing.vz) * dt - dr * 0.9 * dt * 8;
        swing.vx += (-14 * swing.x - 1.1 * swing.vx) * dt + dp * 0.9 * dt * 8;
        swing.x += swing.vx * dt; swing.z += swing.vz * dt;
      }
      pivot.rotation.set(swing.z + Math.sin(clock * 0.9) * 0.03, 0, swing.x + Math.sin(clock * 0.7 + 1) * 0.025);
      group.updateMatrixWorld(true);
      // Candle flicker: slow breathing plus quick, small gutters.
      const flicker = 1 + Math.sin(clock * 7.3) * 0.05 + Math.sin(clock * 17.9 + 1.3) * 0.035 + Math.sin(clock * 2.1) * 0.04;
      lantern.glow.value = flicker;
      lanternPower.value = flicker;
      lantern.pendulum.localToWorld(lanternPosition.value.copy(lantern.centre));
      rippleT -= dt;
      if (rippleT <= 0) {
        rippleT = 1.6 + Math.random() * 1.8;
        const side = Math.random() < 0.5 ? -1 : 1, lx = (Math.random() - 0.5) * 1.6 * RIG_SCALE, lz = side * (0.42 + Math.random() * 0.06) * RIG_SCALE;
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        tmp.set(p.x + lx * c + lz * s, 0, p.z - lx * s + lz * c); tmp.y = world.heightAt(tmp.x, tmp.z);
        world.ripple(tmp, 0.12 + Math.abs(kick.roll) * 2);
      }
    },
  };
}
export type Boat = ReturnType<typeof createBoat>;
