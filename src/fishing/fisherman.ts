import { BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, Object3D, Quaternion, SphereGeometry, Vector3 } from 'three/webgpu';
import type { Boat } from './boat';
import type { Game } from './game';
import { clamp, damp, flatMaterial, merge, mk } from './build';

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
  const skin = '#f0bf9a', jacket = '#e0a22e', jacketDark = '#c0841a', pants = '#4b6584', boot = '#3a2a20';
  const box = new BoxGeometry(1, 1, 1), sphere = new SphereGeometry(1, 8, 6), cyl = new CylinderGeometry(1, 1, 1, 8);
  const mat = flatMaterial(0.8);
  const rig = new Group();
  boat.group.add(rig);
  rig.position.set(-0.12, 0.09, 0);

  const meshOf = (parts: ReturnType<typeof mk>[]) => { const m = new Mesh(merge(parts), mat); m.castShadow = m.receiveShadow = true; return m; };

  // legs (static): pelvis, thighs, shins, rolled cuffs, boots
  const legParts = [mk(box, pants, [0, -0.005, 0], [0, 0, 0], [0.2, 0.1, 0.3])];
  for (const s of [-1, 1]) {
    legParts.push(mk(box, pants, [0.14, 0.0, s * 0.075], [0, 0, 0], [0.3, 0.11, 0.11]));
    legParts.push(mk(box, pants, [0.285, -0.14, s * 0.075], [0, 0, 0], [0.11, 0.17, 0.11]));
    legParts.push(mk(box, '#7d93b0', [0.285, -0.075, s * 0.075], [0, 0, 0], [0.125, 0.035, 0.125]));
    legParts.push(mk(box, boot, [0.335, -0.215, s * 0.075], [0, 0, 0], [0.21, 0.09, 0.12]));
  }
  rig.add(meshOf(legParts));

  const torsoYaw = new Group(); torsoYaw.position.set(0, 0.03, 0); rig.add(torsoYaw);
  const torsoLean = new Group(); torsoYaw.add(torsoLean);
  torsoLean.add(meshOf([
    mk(new CapsuleGeometry(0.14, 0.2, 2, 8), jacket, [0, 0.23, 0], [0, 0, 0], [0.78, 1, 1.18]),
    mk(box, '#5a3b22', [0, 0.06, 0], [0, 0, 0], [0.23, 0.035, 0.36]), // belt
    mk(box, '#f5e9c8', [0.001, 0.06, 0], [0, 0, 0], [0.232, 0.03, 0.04]), // buckle band
    mk(box, jacketDark, [0.11, 0.27, 0], [0, 0, 0], [0.02, 0.2, 0.05]), // front placket
    mk(cyl, jacketDark, [0, 0.43, 0], [0, 0, 0], [0.11, 0.045, 0.11]), // collar
  ]));

  // head
  const head = new Group(); head.position.set(0, 0.5, 0); torsoLean.add(head);
  const headYaw = new Group(); head.add(headYaw);
  const headPitch = new Group(); headYaw.add(headPitch);
  headPitch.add(meshOf([
    mk(sphere, skin, [0, 0.1, 0], [0, 0, 0], [0.1, 0.105, 0.098]),
    mk(sphere, skin, [0.095, 0.09, 0], [0, 0, 0], [0.028, 0.028, 0.028]), // nose
    mk(sphere, '#222', [0.085, 0.125, 0.04], [0, 0, 0], [0.014, 0.016, 0.014], 0),
    mk(sphere, '#222', [0.085, 0.125, -0.04], [0, 0, 0], [0.014, 0.016, 0.014], 0),
    mk(new ConeGeometry(1, 1, 6), '#e9e4d8', [0.06, 0.03, 0], [Math.PI, 0, -0.35], [0.07, 0.09, 0.09]), // beard
    mk(cyl, '#e8cf7a', [0, 0.18, 0], [0, 0, 0], [0.235, 0.014, 0.235], 0.08), // straw hat brim
    mk(cyl, '#e8cf7a', [0, 0.225, 0], [0, 0, 0], [0.118, 0.06, 0.118], 0.08), // crown
    mk(cyl, '#c8493d', [0, 0.2, 0], [0, 0, 0], [0.122, 0.018, 0.122], 0), // hat band
  ]));

  // arms
  interface Arm { shoulder: Group; elbow: Group; side: number }
  const arms: Arm[] = [];
  for (const side of [1, -1]) {
    const shoulder = new Group(); shoulder.position.set(0, SHOULDER_Y, side * SHOULDER_Z); torsoLean.add(shoulder);
    shoulder.add(meshOf([mk(new CapsuleGeometry(0.05, 0.14, 2, 6), jacket, [0, -0.11, 0]), mk(sphere, jacket, [0, 0, 0], [0, 0, 0], [0.058, 0.058, 0.058])]));
    const elbow = new Group(); elbow.position.set(0, -L1, 0); shoulder.add(elbow);
    elbow.add(meshOf([mk(new CapsuleGeometry(0.041, 0.13, 2, 6), jacket, [0, -0.11, 0]), mk(cyl, jacketDark, [0, -0.19, 0], [0, 0, 0], [0.046, 0.02, 0.046]), mk(sphere, skin, [0, -L2 + 0.01, 0], [0, 0, 0], [0.05, 0.05, 0.05])]));
    arms.push({ shoulder, elbow, side });
  }
  const [armR, armL] = arms;

  // rod (child of torso space, positioned at the right-hand grip), tapered segments that bend under tension
  const rod = new Group(); rod.rotation.order = 'YZX'; torsoLean.add(rod);
  const rodMat = mat;
  rod.add(meshOf([
    mk(cyl, '#c9a26b', [-0.02, 0, 0], [0, 0, Math.PI / 2], [0.028, 0.32, 0.028]),
    mk(cyl, '#3a3a40', [0.06, -0.055, 0], [Math.PI / 2, 0, 0], [0.05, 0.04, 0.05]), // reel body
    mk(cyl, '#8c95a0', [0.06, -0.055, 0.0], [Math.PI / 2, 0, 0], [0.036, 0.048, 0.036]),
    mk(box, '#3a3a40', [0.06, -0.03, 0], [0, 0, 0], [0.05, 0.03, 0.02]), // reel foot
  ]));
  const crank = new Group(); crank.position.set(0.06, -0.055, -0.03); rod.add(crank);
  crank.add(meshOf([mk(box, '#8c95a0', [0.03, 0, 0], [0, 0, 0], [0.06, 0.01, 0.01]), mk(sphere, '#c8493d', [0.06, 0, -0.012], [0, 0, 0], [0.016, 0.016, 0.016])]));
  const CRANK_R = 0.06;
  const segs: Group[] = [];
  let parent: Object3D = rod;
  for (let i = 0; i < ROD_SEGMENTS; i++) {
    const seg = new Group(); seg.position.set(i === 0 ? 0.14 : ROD_SEG_LEN, 0, 0);
    const r0 = 0.02 - i * 0.0026, r1 = 0.02 - (i + 1) * 0.0026;
    const g = new CylinderGeometry(Math.max(r1, 0.004), r0, ROD_SEG_LEN, 6); g.rotateZ(-Math.PI / 2); g.translate(ROD_SEG_LEN / 2, 0, 0);
    const m = new Mesh(merge([mk(g, i % 2 ? '#2b2b30' : '#1f1f24', [0, 0, 0], [0, 0, 0], [1, 1, 1], 0.03), ...(i > 0 ? [mk(cyl, '#c8493d', [0.01, 0, 0], [0, 0, Math.PI / 2], [r0 * 1.5, 0.014, r0 * 1.5], 0)] : [])]), rodMat);
    m.castShadow = true; seg.add(m); parent.add(seg); segs.push(seg); parent = seg;
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
        case 'idle': setGoal(game.auto ? 'wait' : 'idle'); rate = 4; break;
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
