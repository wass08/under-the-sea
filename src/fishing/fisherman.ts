import { BufferGeometry, CapsuleGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Boat } from './boat';
import type { Game } from './game';
import { clamp, damp, merge, mk, smoothMaterial } from './build';
import { fabricTexture, strawTexture } from './textures';

/**
 * Low-poly fisherman sitting on the aft thwart. Frame of every group under `torsoLean`:
 * +x = in front of him, +y = up, +z = his right. Arms are solved with a tiny analytic 2-bone IK toward
 * hand targets, so the rod grip (right hand) and the reel crank (left hand) always connect.
 */

const L1 = 0.22, L2 = 0.23; // upper arm, forearm
const SHOULDER_Y = 0.38, SHOULDER_Z = 0.17;
const ROD_SEGMENTS = 6, ROD_SEG_LEN = 0.205;
const DOWN = new Vector3(0, -1, 0);

interface Pose {
  gx: number; gy: number; gz: number; // right hand / rod grip, in torso space
  alpha: number; psi: number; // rod elevation and yaw in torso space
  lean: number; // torso lean (negative = forward)
  headPitch: number; shrug: number; cheer: number;
  wRod: number; wCrank: number; wCheer: number; wOut: number; wRest: number; // left hand target weights
}
const P = (o: Partial<Pose>): Pose => ({ gx: 0.3, gy: 0.2, gz: 0.14, alpha: 0.7, psi: 0, lean: 0, headPitch: 0.2, shrug: 0, cheer: 0, wRod: 1, wCrank: 0, wCheer: 0, wOut: 0, wRest: 0, ...o });

const POSES = {
  idle: P({ gx: 0.28, gy: 0.16, gz: 0.14, alpha: 0.5, psi: -0.12, headPitch: 0.1 }),
  wait: P({ gx: 0.3, gy: 0.2, gz: 0.14, alpha: 0.72 }),
  windup: P({ gx: 0.02, gy: 0.52, gz: 0.2, alpha: 1.95, lean: 0.22, headPitch: 0.05 }),
  whip: P({ gx: 0.4, gy: 0.4, gz: 0.16, alpha: 0.3, lean: -0.3, headPitch: 0.15 }),
  follow: P({ gx: 0.4, gy: 0.3, gz: 0.14, alpha: 0.2, lean: -0.2 }),
  bite: P({ gx: 0.34, gy: 0.18, gz: 0.14, alpha: 0.42, lean: -0.3, headPitch: 0.35 }),
  jerk: P({ gx: 0.16, gy: 0.52, gz: 0.14, alpha: 1.38, lean: 0.26, headPitch: 0.0 }),
  reel: P({ gx: 0.3, gy: 0.3, gz: 0.14, alpha: 0.95, lean: 0.06, wRod: 0, wCrank: 1, headPitch: 0.2 }),
  cheer: P({ gx: 0.22, gy: 0.5, gz: 0.18, alpha: 1.1, lean: 0.12, wRod: 0, wCheer: 1, headPitch: -0.25, cheer: 1 }),
  drop: P({ gx: 0.3, gy: 0.34, gz: 0.16, alpha: 0.9, lean: -0.22, headPitch: 0.35 }),
  shrug: P({ gx: 0.3, gy: 0.18, gz: 0.14, alpha: 0.5, lean: 0.06, wRod: 0, wOut: 1, shrug: 1, headPitch: 0.1 }),
};
type PoseName = keyof typeof POSES;

export function createFisherman(boat: Boat, game: Game) {
  // palette: yellow oilskin, navy trousers, green rubber boots, ruddy skin, white beard, straw hat
  const skin = '#e3ab86', jacket = '#e3a72f', jacketDark = '#bf861f', pants = '#3f5670', pantsCuff = '#6f86a3', boot = '#2f4a35', hair = '#e7e3da';
  const S = (r: number) => new SphereGeometry(r, 24, 16);
  const cap = (r: number, len: number, rs = 16) => new CapsuleGeometry(r, len, 8, rs);
  const cylG = (r0: number, r1: number, h: number, rs = 20) => new CylinderGeometry(r0, r1, h, rs);
  const tor = (R: number, r: number, arc = Math.PI * 2, rs = 24) => new TorusGeometry(R, r, 10, rs, arc);
  const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r);

  const fabric = fabricTexture(), straw = strawTexture();
  fabric.repeat.set(5, 5);
  const cloth = smoothMaterial({ roughness: 0.88, map: fabric });
  const skinMat = smoothMaterial({ roughness: 0.5 });
  const strawMat = smoothMaterial({ roughness: 0.92, map: straw });

  const rig = new Group();
  boat.group.add(rig);
  rig.position.set(-0.12, 0.105, 0);

  /** cloth + skin geometry lists -> a group with one mesh per material. */
  const body = (clothParts: BufferGeometry[], skinParts: BufferGeometry[]) => {
    const g = new Group();
    for (const [list, mat] of [[clothParts, cloth], [skinParts, skinMat]] as const) {
      if (!list.length) continue;
      const m = new Mesh(merge(list), mat); m.castShadow = m.receiveShadow = true; g.add(m);
    }
    return g;
  };

  // ---- legs (static): pelvis, thighs, knees, shins, rolled cuffs, rubber boots ----
  const legCloth: BufferGeometry[] = [mk(S(1), pants, [0, -0.01, 0], [0, 0, 0], [0.13, 0.08, 0.165])];
  const legSkin: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const z = s * 0.08;
    legCloth.push(mk(cap(0.06, 0.17), pants, [0.15, 0, z], [0, 0, Math.PI / 2]));
    legCloth.push(mk(S(0.062), pants, [0.29, 0, z]));
    legCloth.push(mk(cap(0.05, 0.06), pants, [0.29, -0.115, z]));
    legCloth.push(mk(tor(0.056, 0.02), pantsCuff, [0.29, -0.16, z], [Math.PI / 2, 0, 0]));
    legSkin.push(mk(cylG(0.056, 0.06, 0.105), boot, [0.29, -0.205, z]));
    legSkin.push(mk(cap(0.054, 0.1), boot, [0.33, -0.21, z], [0, 0, Math.PI / 2], [1, 1, 0.98]));
    legSkin.push(mk(rbox(0.23, 0.02, 0.112, 0.008), '#1d1d1d', [0.335, -0.255, z]));
  }
  rig.add(body(legCloth, legSkin));

  const torsoYaw = new Group(); torsoYaw.position.set(0, 0.03, 0); rig.add(torsoYaw);
  const torsoLean = new Group(); torsoYaw.add(torsoLean);
  const oval: [number, number, number] = [0.82, 1, 1.12];
  const torsoProfile = [[0.001, -0.02], [0.1, -0.015], [0.135, 0.02], [0.145, 0.08], [0.138, 0.15], [0.15, 0.24], [0.162, 0.32], [0.155, 0.37], [0.11, 0.415], [0.06, 0.44], [0.001, 0.452]].map(p => new Vector2(p[0], p[1]));
  const torsoCloth: BufferGeometry[] = [
    mk(new LatheGeometry(torsoProfile, 40), jacket, [0, 0, 0], [0, 0, 0], oval),
    mk(tor(0.146, 0.016), '#5a3b22', [0, 0.07, 0], [Math.PI / 2, 0, 0], [0.82, 1.12, 1]),
    mk(rbox(0.018, 0.03, 0.05, 0.006), '#c9a24b', [0.121, 0.07, 0]),
    mk(tor(0.108, 0.03), jacketDark, [0, 0.415, 0], [Math.PI / 2, 0, 0], [0.82, 1.12, 1]),
  ];
  for (const [y, x] of [[0.14, 0.113], [0.21, 0.12], [0.28, 0.13], [0.34, 0.132]] as const) torsoCloth.push(mk(S(0.011), '#4a3a22', [x, y, 0], [0, 0, 0], [0.7, 1, 1]));
  for (const s of [-1, 1]) torsoCloth.push(mk(rbox(0.024, 0.07, 0.1, 0.01), jacketDark, [0.1, 0.13, s * 0.085], [0, s * -0.55, 0]));
  torsoCloth.push(mk(rbox(0.012, 0.3, 0.05, 0.005), jacketDark, [0.122, 0.235, 0]));
  torsoLean.add(body(torsoCloth, [mk(cylG(0.046, 0.05, 0.09), skin, [0, 0.46, 0])]));

  // ---- head: skull, nose, ears, brows, eyes, moustache & beard, straw hat with a woven texture ----
  const head = new Group(); head.position.set(0, 0.5, 0); torsoLean.add(head);
  const headYaw = new Group(); head.add(headYaw);
  const headPitch = new Group(); headYaw.add(headPitch);
  const headSkin: BufferGeometry[] = [
    mk(S(1), skin, [0, 0.1, 0], [0, 0, 0], [0.095, 0.105, 0.09]),
    mk(S(1), '#e9a184', [0.07, 0.083, 0.052], [0, 0, 0], [0.03, 0.03, 0.03]),
    mk(S(1), '#e9a184', [0.07, 0.083, -0.052], [0, 0, 0], [0.03, 0.03, 0.03]),
    mk(S(1), '#e9a184', [0.094, 0.09, 0], [0, 0, 0], [0.025, 0.03, 0.023]),
    mk(S(1), skin, [-0.005, 0.1, 0.092], [0, 0, 0], [0.015, 0.03, 0.02]),
    mk(S(1), skin, [-0.005, 0.1, -0.092], [0, 0, 0], [0.015, 0.03, 0.02]),
    mk(S(1), '#f4f1ea', [0.078, 0.117, 0.036], [0, 0, 0], [0.012, 0.014, 0.014]),
    mk(S(1), '#f4f1ea', [0.078, 0.117, -0.036], [0, 0, 0], [0.012, 0.014, 0.014]),
    mk(S(1), '#2b4a63', [0.088, 0.117, 0.036], [0, 0, 0], [0.007, 0.009, 0.009]),
    mk(S(1), '#2b4a63', [0.088, 0.117, -0.036], [0, 0, 0], [0.007, 0.009, 0.009]),
    mk(cap(0.0085, 0.03), '#cfcabf', [0.083, 0.143, 0.038], [Math.PI / 2, 0, 0.12]),
    mk(cap(0.0085, 0.03), '#cfcabf', [0.083, 0.143, -0.038], [Math.PI / 2, 0, -0.12]),
    mk(cap(0.011, 0.034), hair, [0.09, 0.066, 0.024], [Math.PI / 2, 0, 0.25]),
    mk(cap(0.011, 0.034), hair, [0.09, 0.066, -0.024], [Math.PI / 2, 0, -0.25]),
    mk(S(1), hair, [0.03, 0.028, 0], [0, 0, 0], [0.072, 0.055, 0.078]),
    mk(S(1), hair, [0.06, -0.012, 0], [0, 0, 0], [0.04, 0.05, 0.045]),
    mk(S(1), hair, [-0.03, 0.13, 0.084], [0, 0, 0], [0.032, 0.036, 0.03]),
    mk(S(1), hair, [-0.03, 0.13, -0.084], [0, 0, 0], [0.032, 0.036, 0.03]),
    mk(S(1), hair, [-0.075, 0.115, 0], [0, 0, 0], [0.04, 0.05, 0.06]),
  ];
  headPitch.add(body([mk(tor(0.108, 0.013), '#c8493d', [0, 0.198, 0], [Math.PI / 2, 0, 0])], headSkin));
  const hatProfile = [[0.001, 0.292], [0.05, 0.29], [0.088, 0.278], [0.104, 0.245], [0.108, 0.2], [0.14, 0.192], [0.19, 0.192], [0.232, 0.202], [0.245, 0.218], [0.24, 0.212], [0.23, 0.192], [0.19, 0.181], [0.14, 0.181], [0.106, 0.185]].map(p => new Vector2(p[0], p[1]));
  const hat = new Mesh(merge([mk(new LatheGeometry(hatProfile, 48), '#ffffff', [0, 0, 0], [0, 0, 0], [1, 1, 1], [8, 3])]), strawMat);
  hat.castShadow = hat.receiveShadow = true; headPitch.add(hat);

  // ---- arms: sleeve + rolled cuff + hand (thumb + fist) ----
  interface Arm { shoulder: Group; elbow: Group; side: number }
  const arms: Arm[] = [];
  for (const side of [1, -1]) {
    const shoulder = new Group(); shoulder.position.set(0, SHOULDER_Y, side * SHOULDER_Z); torsoLean.add(shoulder);
    shoulder.add(body([mk(S(0.058), jacket), mk(cap(0.047, 0.13), jacket, [0, -0.112, 0])], []));
    const elbow = new Group(); elbow.position.set(0, -L1, 0); shoulder.add(elbow);
    elbow.add(body([mk(S(0.045), jacket), mk(cap(0.039, 0.115), jacket, [0, -0.105, 0]), mk(tor(0.043, 0.016), jacketDark, [0, -0.19, 0], [Math.PI / 2, 0, 0])],
      [mk(S(1), skin, [0, -L2 - 0.004, 0], [0, 0, 0], [0.04, 0.05, 0.036]), mk(cap(0.012, 0.03), skin, [0.03, -L2 + 0.02, 0], [0, 0, -0.6]), mk(S(1), skin, [0.006, -L2 - 0.03, 0], [0, 0, 0], [0.034, 0.028, 0.03])]));
    arms.push({ shoulder, elbow, side });
  }
  const [armR, armL] = arms;

  // ---- rod: cork grip, detailed reel with a crank, carbon blank in bending segments with guides ----
  const rod = new Group(); rod.rotation.order = 'YZX'; torsoLean.add(rod);
  const cork = new Mesh(merge([
    mk(cylG(0.03, 0.031, 0.27, 20), '#c79b62', [-0.03, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], [4, 1]),
    mk(cylG(0.034, 0.034, 0.03, 20), '#1d1d21', [-0.175, 0, 0], [0, 0, Math.PI / 2]),
    mk(cylG(0.034, 0.03, 0.02, 20), '#1d1d21', [0.11, 0, 0], [0, 0, Math.PI / 2]),
    ...[-0.12, -0.06, 0.0, 0.05].map(x => mk(tor(0.031, 0.0035, Math.PI * 2, 20), '#8d6a3e', [x, 0, 0], [0, Math.PI / 2, 0])),
  ]), smoothMaterial({ roughness: 0.95 }));
  cork.castShadow = true; rod.add(cork);
  const reelParts: BufferGeometry[] = [
    mk(cylG(0.046, 0.046, 0.05, 28), '#25272c', [0.06, -0.06, 0], [Math.PI / 2, 0, 0]),
    mk(cylG(0.052, 0.052, 0.008, 28), '#c9a24b', [0.06, -0.06, 0.03], [Math.PI / 2, 0, 0]),
    mk(cylG(0.052, 0.052, 0.008, 28), '#c9a24b', [0.06, -0.06, -0.03], [Math.PI / 2, 0, 0]),
    mk(cylG(0.038, 0.038, 0.042, 24), '#d9dde2', [0.06, -0.06, 0], [Math.PI / 2, 0, 0]),
    mk(cylG(0.01, 0.01, 0.075, 12), '#9aa0a8', [0.06, -0.06, 0], [Math.PI / 2, 0, 0]),
    mk(rbox(0.07, 0.024, 0.03, 0.008), '#25272c', [0.06, -0.012, 0]),
    mk(cylG(0.014, 0.014, 0.014, 12), '#c8493d', [0.02, -0.066, 0.036], [Math.PI / 2, 0, 0]),
  ];
  const reel = new Mesh(merge(reelParts), smoothMaterial({ roughness: 0.35, metalness: 0.8 })); reel.castShadow = true; rod.add(reel);
  const crank = new Group(); crank.position.set(0.06, -0.06, -0.036); rod.add(crank);
  const crankMesh = new Mesh(merge([
    mk(rbox(0.066, 0.011, 0.008, 0.004), '#c0c7cf', [0.03, 0, 0]),
    mk(cylG(0.006, 0.006, 0.03, 10), '#3a3a40', [0.062, 0, -0.014], [Math.PI / 2, 0, 0]),
    mk(S(0.014), '#c8493d', [0.062, 0, -0.03], [0, 0, 0], [1, 1, 1.5]),
  ]), smoothMaterial({ roughness: 0.4, metalness: 0.6 })); crankMesh.castShadow = true; crank.add(crankMesh);
  const CRANK_R = 0.062;
  const blankMat = smoothMaterial({ roughness: 0.26, metalness: 0.35 });
  const segs: Group[] = [];
  let parent: Object3D = rod;
  for (let i = 0; i < ROD_SEGMENTS; i++) {
    const seg = new Group(); seg.position.set(i === 0 ? 0.14 : ROD_SEG_LEN, 0, 0);
    const r0 = 0.019 - i * 0.0027, r1 = 0.019 - (i + 1) * 0.0027;
    const g = new CylinderGeometry(Math.max(r1, 0.0045), r0, ROD_SEG_LEN, 12, 1); g.rotateZ(-Math.PI / 2); g.translate(ROD_SEG_LEN / 2, 0, 0);
    const list = [mk(g, '#17191e'), mk(tor(r0 * 1.06, 0.0035, Math.PI * 2, 14), '#c8493d', [0.004, 0, 0], [0, Math.PI / 2, 0]),
      mk(tor(0.012, 0.0022, Math.PI * 2, 12), '#a9b0b8', [ROD_SEG_LEN * 0.55, -(r0 + r1) / 2 - 0.011, 0], [0, Math.PI / 2, 0])];
    const m = new Mesh(merge(list), blankMat); m.castShadow = true; seg.add(m); parent.add(seg); segs.push(seg); parent = seg;
  }
  const tip = new Object3D(); tip.position.set(ROD_SEG_LEN, 0, 0); parent.add(tip);

  // state
  const cur: Pose = { ...POSES.idle }, goal: Pose = { ...POSES.idle };
  let torsoAim = 0, headAim = 0, crankAngle = 0, bend = 0, clock = 0, lookT = 4, lookYaw = 0, lookHold = 0;
  const tipWorld = new Vector3(), tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3(), tmpQ = new Quaternion();
  const targetR = new Vector3(), targetL = new Vector3();
  const rodQuat = new Quaternion();

  function solveArm(arm: Arm, target: Vector3, pole: Vector3) {
    const v = tmpA.copy(target).sub(arm.shoulder.position);
    let d = v.length();
    if (d < 1e-4) return;
    d = clamp(d, Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.004);
    v.normalize();
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const p = tmpB.copy(pole).addScaledVector(v, -pole.dot(v));
    if (p.lengthSq() < 1e-6) p.set(0, -1, 0).addScaledVector(v, v.y);
    p.normalize();
    const u = new Vector3().copy(v).multiplyScalar(Math.cos(a)).addScaledVector(p, Math.sin(a));
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, u);
    const f = new Vector3().copy(v).multiplyScalar(d).addScaledVector(u, -L1).normalize();
    f.applyQuaternion(tmpQ.copy(arm.shoulder.quaternion).invert());
    arm.elbow.quaternion.setFromUnitVectors(DOWN, f);
  }
  const poleR = new Vector3(-0.1, -1, 0.7).normalize(), poleL = new Vector3(-0.1, -1, -0.7).normalize();

  function setGoal(name: PoseName) { Object.assign(goal, POSES[name]); }

  return {
    rod, tip,
    /** World position of the rod tip after the last update. */
    tipWorld,
    /** Aim angles (torso yaw relative to the hull, radians) after the last update. */
    update(dt: number, aimTarget: Vector3 | null) {
      clock += dt;
      const ph = game.phase, t = game.t;
      let rate = 6;
      // ---- choose the pose from the game state ----
      switch (ph) {
        case 'idle': setGoal(game.auto ? 'wait' : 'idle'); rate = 7; break;
        case 'casting': {
          const wind = game.castWind;
          if (t < wind * 0.62) { setGoal('windup'); rate = 9; }
          else if (t < wind + 0.08) { setGoal('whip'); rate = 26; }
          else if (t < wind + 0.55) { setGoal('follow'); rate = 10; }
          else { setGoal('wait'); rate = 5; }
          break;
        }
        case 'bite': setGoal('bite'); rate = 10; break;
        case 'reeling': if (t < game.jerkTime) { setGoal('jerk'); rate = 24; } else { setGoal('reel'); rate = 8; } break;
        case 'celebrate': if (t < game.celebrateHold) { setGoal('cheer'); rate = 9; } else { setGoal('drop'); rate = 14; } break;
        case 'missed': setGoal('shrug'); rate = 8; break;
        case 'retrieving': setGoal('reel'); rate = 10; break;
        default: setGoal('wait'); rate = 5;
      }
      for (const k of Object.keys(goal) as (keyof Pose)[]) cur[k] = damp(cur[k], goal[k], rate, dt);

      // ---- procedural extras ----
      const breathe = Math.sin(clock * 1.9) * 0.012, sway = Math.sin(clock * 0.7) * 0.02;
      let lean = cur.lean, extraAlpha = Math.sin(clock * 1.3) * 0.015 + sway * 0.5;
      if (ph === 'bite') lean += Math.sin(clock * 38) * 0.02;
      if (ph === 'reeling' && t >= game.jerkTime) { lean += Math.sin(crankAngle) * 0.03; extraAlpha += Math.sin(clock * 30) * 0.03 * game.tension; }
      if (ph === 'celebrate' && t < game.celebrateHold) lean += Math.sin(t * 12) * 0.03;
      if (ph === 'curious' || ph === 'approaching') extraAlpha += game.dip * -0.12;

      // ---- aim: twist the torso toward the bobber, the head takes the rest ----
      let aim = 0;
      const looking = aimTarget && ph !== 'idle' && ph !== 'celebrate' && ph !== 'retrieving';
      if (aimTarget) {
        const b = boat.state, c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = aimTarget.x - b.x, dz = aimTarget.z - b.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        aim = Math.atan2(-lz, lx);
      }
      // idle look-around
      lookT -= dt;
      if (lookT <= 0) { lookT = 3 + Math.random() * 5; lookYaw = (Math.random() - 0.5) * 1.1; lookHold = 1.2 + Math.random(); }
      lookHold -= dt; if (lookHold < 0) lookYaw = damp(lookYaw, 0, 2, dt);
      const torsoT = looking || ph === 'casting' ? clamp(aim, -1.9, 1.9) : ph === 'idle' ? lookYaw * 0.3 : torsoAim;
      const rateAim = ph === 'casting' ? 7 : 4;
      torsoAim = damp(torsoAim, torsoT, rateAim, dt);
      const headT = looking || ph === 'casting' ? clamp(aim - torsoAim, -1.1, 1.1) : lookYaw;
      headAim = damp(headAim, headT, 6, dt);
      let shake = 0;
      if (ph === 'missed') shake = Math.sin(t * 10) * 0.4 * Math.exp(-t * 1.6);

      torsoYaw.rotation.y = torsoAim;
      torsoLean.rotation.z = lean; torsoLean.scale.set(1, 1 + breathe, 1 + breathe * 0.6);
      headYaw.rotation.y = headAim + shake;
      headPitch.rotation.z = -cur.headPitch - breathe * 2;
      headPitch.rotation.x = Math.sin(clock * 0.5) * 0.02;
      armR.shoulder.position.y = armL.shoulder.position.y = SHOULDER_Y + cur.shrug * 0.03;

      // ---- rod: placed at the grip, bent by tension ----
      const tension = game.tension;
      bend = damp(bend, tension, 12, dt);
      rod.position.set(cur.gx, cur.gy, cur.gz);
      rod.rotation.set(0, cur.psi, cur.alpha + extraAlpha);
      const totalBend = bend * 1.25 + Math.sin(clock * 2.1) * 0.02;
      let wsum = 0; const weights: number[] = [];
      for (let i = 0; i < ROD_SEGMENTS; i++) { const w = 0.35 + i * 0.5; weights.push(w); wsum += w; }
      for (let i = 0; i < ROD_SEGMENTS; i++) segs[i].rotation.z = -(totalBend * weights[i]) / wsum;

      // ---- crank + left hand target ----
      if (ph === 'reeling' && t >= game.jerkTime || ph === 'retrieving') crankAngle += dt * 15; else crankAngle += dt * 0.5 * 0;
      crank.rotation.z = crankAngle;
      rodQuat.setFromEuler(rod.rotation);
      const toTorso = (x: number, y: number, z: number, out: Vector3) => out.set(x, y, z).applyQuaternion(rodQuat).add(rod.position);
      targetR.set(cur.gx, cur.gy, cur.gz);
      // left hand: weighted between rod fore-grip, crank knob, raised fist, shrug-out, knee
      const knob = toTorso(0.06 + Math.cos(crankAngle) * CRANK_R, -0.055 + Math.sin(crankAngle) * CRANK_R, -0.045, new Vector3());
      const fore = toTorso(0.5, 0.0, -0.01, new Vector3());
      const wTot = cur.wRod + cur.wCrank + cur.wCheer + cur.wOut + cur.wRest || 1;
      targetL.set(0, 0, 0)
        .addScaledVector(fore, cur.wRod).addScaledVector(knob, cur.wCrank)
        .addScaledVector(tmpA.set(0.12 + Math.sin(clock * 14) * 0.02, 0.86 + Math.sin(clock * 9) * 0.03, -0.26), cur.wCheer)
        .addScaledVector(tmpB.set(0.1, 0.2, -0.46), cur.wOut)
        .addScaledVector(tmpC.set(0.18, 0.08, -0.13), cur.wRest)
        .multiplyScalar(1 / wTot);
      solveArm(armR, targetR, poleR);
      solveArm(armL, targetL, poleL);

      // ---- hull recoil on the whip ----
      // (handled by game events in index)
      rig.updateMatrixWorld(true);
      tip.getWorldPosition(tipWorld);
      return tipWorld;
    },
    /** The rod tip in world space (last update). */
    get tipPos() { return tipWorld; },
  };
}
export type Fisherman = ReturnType<typeof createFisherman>;
