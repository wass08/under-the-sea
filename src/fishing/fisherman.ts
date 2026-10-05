import { BufferGeometry, CylinderGeometry, Group, LatheGeometry, Matrix4, Mesh, Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SEAT, type Boat } from './boat';
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
  // Sun-weathered skin, faded indigo cotton, charcoal trousers and sparse silver hair.
  const skin = '#c99770', jacket = '#496079', jacketDark = '#35495e', pants = '#353b43', pantsCuff = '#555c64', hair = '#a9a69a';
  const S = (r: number) => new SphereGeometry(r, 24, 16);
  const cylG = (r0: number, r1: number, h: number, rs = 20) => new CylinderGeometry(r0, r1, h, rs);
  const tor = (R: number, r: number, arc = Math.PI * 2, rs = 24) => new TorusGeometry(R, r, 10, rs, arc);
  const rbox = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 3, r);

  // Small bevels and sparse radial sections keep the silhouette tailored, not inflated.
  const bevel = (w: number, h: number, d: number, r = 0.006) => new RoundedBoxGeometry(w, h, d, 1, r);
  const lathe = (points: number[][], segments = 12) => new LatheGeometry(points.map(p => new Vector2(p[0], p[1])), segments);
  const strand = (a: [number, number, number], b: [number, number, number], radius: number, color: string, endRadius = radius) => {
    const start = new Vector3(...a), end = new Vector3(...b), delta = end.clone().sub(start);
    const g = new CylinderGeometry(endRadius, radius, delta.length(), 5);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
    g.translate(...start.add(end).multiplyScalar(0.5).toArray());
    return mk(g, color);
  };

  const fabric = fabricTexture(), straw = strawTexture();
  fabric.repeat.set(5, 5);
  const cloth = smoothMaterial({ roughness: 0.88, map: fabric });
  const skinMat = smoothMaterial({ roughness: 0.82 });
  const strawMat = smoothMaterial({ roughness: 0.92, map: straw });

  const rig = new Group();
  boat.group.add(rig);
  rig.position.set(SEAT.x, SEAT.rigY, 0);

  /** cloth + skin geometry lists -> a group with one mesh per material. */
  const body = (clothParts: BufferGeometry[], skinParts: BufferGeometry[]) => {
    const g = new Group();
    for (const [list, mat] of [[clothParts, cloth], [skinParts, skinMat]] as const) {
      if (!list.length) continue;
      const m = new Mesh(merge(list), mat); m.castShadow = m.receiveShadow = true; g.add(m);
    }
    return g;
  };

  // ---- legs (static): the seat is y=-0.075 and sandal soles rest at y=-0.265 ----
  const legCloth: BufferGeometry[] = [mk(lathe([[0, -0.075], [0.095, -0.075], [0.137, -0.06], [0.146, -0.025], [0.146, 0.025], [0.1, 0.055], [0, 0.055]], 16), pants, [0, 0, 0], [0, 0, 0], [0.82, 1, 1.08])];
  const legSkin: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const z = s * 0.082;
    legCloth.push(mk(lathe([[0, -0.145], [0.052, -0.145], [0.065, -0.12], [0.068, 0.08], [0.058, 0.135], [0, 0.14]]), pants, [0.145, -0.005, z], [0, 0, -Math.PI / 2]));
    legCloth.push(mk(lathe([[0, -0.14], [0.046, -0.14], [0.052, -0.08], [0.06, 0.015], [0.044, 0.04], [0, 0.04]]), pants, [0.28, -0.005, z]));
    legCloth.push(mk(cylG(0.05, 0.049, 0.025, 10), pantsCuff, [0.28, -0.132, z]));
    legSkin.push(mk(cylG(0.035, 0.024, 0.09, 10), skin, [0.28, -0.182, z]));
    legSkin.push(mk(bevel(0.15, 0.034, 0.071, 0.009), skin, [0.32, -0.235, z]));
    legCloth.push(mk(bevel(0.175, 0.012, 0.085, 0.008), '#39352f', [0.324, -0.259, z]));
    legCloth.push(mk(bevel(0.028, 0.008, 0.079, 0.003), '#5a5141', [0.335, -0.215, z], [0, 0, -0.12]));
    // Two shallow toe creases, visible only in close views.
    for (const dz of [-0.014, 0.008]) legSkin.push(strand([0.371, -0.217, z + dz], [0.386, -0.219, z + dz], 0.0008, '#866248'));
  }
  rig.add(body(legCloth, legSkin));

  const torsoYaw = new Group(); torsoYaw.position.set(0, 0.03, 0); rig.add(torsoYaw);
  const torsoLean = new Group(); torsoYaw.add(torsoLean);
  const oval: [number, number, number] = [0.78, 1, 1.12];
  const torsoProfile = [[0.001, -0.02], [0.135, -0.02], [0.146, 0.01], [0.139, 0.12], [0.15, 0.27], [0.158, 0.35], [0.139, 0.39], [0.054, 0.43], [0.001, 0.43]];
  const torsoCloth: BufferGeometry[] = [
    mk(lathe(torsoProfile, 16), jacket, [0, 0, 0], [0, 0, 0], oval),
    mk(lathe([[0.14, 0.028], [0.144, 0.033], [0.143, 0.063], [0.14, 0.068]], 16), '#525863', [0, 0, 0], [0, 0, 0], oval),
    mk(bevel(0.018, 0.09, 0.035, 0.003), '#525863', [0.112, 0.019, 0.08], [0.08, 0, -0.1]),
    // A low neckline binding leaves only a short, natural length of neck visible.
    mk(lathe([[0.053, 0.426], [0.054, 0.437], [0.059, 0.435], [0.06, 0.424]], 16), jacketDark, [0, 0, 0], [0, 0, 0], oval),
    mk(bevel(0.012, 0.275, 0.022, 0.002), jacketDark, [0.114, 0.245, 0], [0, 0, -0.055]),
  ];
  for (const [y, x] of [[0.14, 0.116], [0.21, 0.121], [0.28, 0.127], [0.35, 0.13]] as const) {
    torsoCloth.push(mk(bevel(0.006, 0.006, 0.018, 0.002), '#969b9d', [x, y, 0]));
  }
  for (const s of [-1, 1]) torsoCloth.push(mk(bevel(0.009, 0.072, 0.063, 0.003), jacketDark, [0.105, 0.145, s * 0.08], [0, s * -0.5, 0]));
  torsoLean.add(body(torsoCloth, [mk(cylG(0.037, 0.044, 0.061, 12), skin, [0, 0.44, 0])]));

  // ---- head: narrower jaw, quiet lids, small nose, weathered lines and sparse facial hair ----
  const head = new Group(); head.position.set(0, 0.462, 0); torsoLean.add(head);
  const headYaw = new Group(); head.add(headYaw);
  const headPitch = new Group(); headYaw.add(headPitch);
  const headSkin: BufferGeometry[] = [
    mk(lathe([[0, 0], [0.041, 0.007], [0.06, 0.028], [0.079, 0.072], [0.081, 0.13], [0.071, 0.167], [0.044, 0.188], [0, 0.195]], 16), skin, [0, 0, 0], [0, Math.PI / 16, 0], [1, 1, 0.92]),
    mk(bevel(0.021, 0.031, 0.019, 0.006), skin, [0.079, 0.096, 0], [0, 0, -0.18]),
    mk(bevel(0.018, 0.012, 0.023, 0.004), '#bc8964', [0.09, 0.084, 0]),
    mk(bevel(0.005, 0.002, 0.027, 0.0008), '#765448', [0.069, 0.053, 0]),
  ];
  for (const s of [-1, 1]) {
    headSkin.push(
      mk(bevel(0.022, 0.036, 0.014, 0.006), skin, [-0.009, 0.099, s * 0.073], [s * 0.1, 0, -0.13]),
      mk(bevel(0.012, 0.02, 0.003, 0.003), '#a87658', [-0.006, 0.1, s * 0.08]),
      // Shallow facets catch the lantern across the cheekbones and brow ridge.
      mk(bevel(0.017, 0.025, 0.033, 0.005), skin, [0.063, 0.091, s * 0.041], [0, s * 0.48, -0.12]),
      mk(bevel(0.012, 0.012, 0.031, 0.003), skin, [0.071, 0.13, s * 0.032], [0, s * 0.37, 0]),
      // Almost horizontal eyes, inset beneath soft upper lids; no protruding eyeballs.
      mk(bevel(0.005, 0.003, 0.023, 0.001), '#383331', [0.073, 0.117, s * 0.032], [0, s * 0.37, 0]),
      mk(bevel(0.006, 0.004, 0.027, 0.0015), '#b38260', [0.072, 0.121, s * 0.032], [0, s * 0.37, 0]),
      mk(bevel(0.004, 0.003, 0.026, 0.001), '#77766e', [0.071, 0.134, s * 0.033], [0, s * 0.36, 0]),
      mk(bevel(0.025, 0.045, 0.007, 0.002), '#646761', [-0.033, 0.125, s * 0.065], [0, s * -0.25, 0]),
      strand([0.067, 0.106, s * 0.043], [0.06, 0.102, s * 0.05], 0.0009, '#9b7156'),
      strand([0.082, 0.075, s * 0.012], [0.073, 0.058, s * 0.024], 0.0008, '#9b7156'),
    );
    for (let i = 0; i < 3; i++) headSkin.push(strand([0.08, 0.068 - i * 0.002, s * 0.003], [0.073, 0.06 - i * 0.002, s * (0.025 + i * 0.002)], 0.0012, hair, 0.0004));
  }
  // A few separate tapering whiskers let the skin show through the goatee.
  for (let i = -3; i <= 3; i++) headSkin.push(strand([0.054, 0.026, i * 0.0035], [0.053 + Math.abs(i) * 0.002, -0.021 + Math.abs(i) * 0.004, i * 0.002], 0.0014, hair, 0.00035));
  const headCloth: BufferGeometry[] = [
    // This inner bamboo band overlaps the crown and meets the inside of the cone.
    mk(lathe([[0.065, 0.172], [0.069, 0.176], [0.068, 0.201], [0.063, 0.208], [0.06, 0.204], [0.063, 0.175], [0.065, 0.172]], 20), '#9d8255'),
  ];
  for (const s of [-1, 1]) {
    headCloth.push(strand([-0.01, 0.173, s * 0.079], [0.012, 0.051, s * 0.072], 0.0022, '#716b51'));
    headCloth.push(strand([0.012, 0.051, s * 0.072], [0.036, 0.007, s * 0.006], 0.0022, '#716b51'));
    headCloth.push(strand([0.036, 0.007, 0], [0.025, -0.018, s * 0.011], 0.0018, '#716b51'));
  }
  headCloth.push(mk(bevel(0.008, 0.007, 0.01, 0.002), '#716b51', [0.036, 0.007, 0]));
  headPitch.add(body(headCloth, headSkin));
  // Retain the broad woven nón lá profile, lowering it onto the crown support.
  const hatProfile = [[0.001, 0.372], [0.03, 0.352], [0.09, 0.3], [0.16, 0.248], [0.225, 0.205], [0.262, 0.186], [0.268, 0.18], [0.258, 0.178], [0.2, 0.2], [0.12, 0.236], [0.06, 0.262], [0.001, 0.27]].map(p => new Vector2(p[0], p[1]));
  const hat = new Mesh(merge([mk(new LatheGeometry(hatProfile, 48), '#ffffff', [0.024, -0.054, 0], [0, 0, 0.1], [1, 1, 1], [8, 3])]), strawMat);
  hat.castShadow = hat.receiveShadow = true; headPitch.add(hat);

  // ---- arms: loose tapered sleeves, flat rolled cuffs, exposed wrists and small gripping hands ----
  interface Arm { shoulder: Group; elbow: Group; hand: Group; side: number }
  const arms: Arm[] = [];
  for (const side of [1, -1]) {
    const shoulder = new Group(); shoulder.position.set(0, SHOULDER_Y, side * SHOULDER_Z); torsoLean.add(shoulder);
    shoulder.add(body([mk(lathe([[0, 0.035], [0.037, 0.035], [0.056, 0.011], [0.058, -0.04], [0.046, -L1], [0, -L1]], 12), jacket)], []));
    const elbow = new Group(); elbow.position.set(0, -L1, 0); shoulder.add(elbow);
    elbow.add(body([
      mk(lathe([[0, 0.022], [0.039, 0.022], [0.045, 0], [0.041, -0.075], [0.035, -0.135], [0, -0.135]], 12), jacket),
      mk(cylG(0.042, 0.039, 0.025, 12), jacketDark, [0, -0.127, 0]),
      mk(cylG(0.0425, 0.0415, 0.008, 12), jacket, [0, -0.118, 0]),
    ], [
      mk(cylG(0.029, 0.023, 0.088, 10), skin, [0, -0.178, 0]),
    ]));
    // Hand-local x follows the handle; +y is the back of the palm, toward the wrist.
    // Leave an actual opening between the palm and fingertips for the grip/knob.
    const radius = side === 1 ? 0.031 : 0.017;
    const palm = bevel(0.071, 0.021, 0.055, 0.005);
    const positions = palm.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const taper = 0.86 - positions.getZ(i) * 5;
      positions.setX(i, positions.getX(i) * taper);
    }
    palm.computeVertexNormals();
    const handSkin = [mk(palm, skin, [0, radius + 0.006, 0])];
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.017;
      const r = radius + 0.007 - (i === 0 ? 0.002 : 0);
      const joints: [number, number, number][] = [
        [x, radius + 0.007, -0.018],
        [x, r * 0.42, -r * 0.94],
        [x, -r * 0.62, -r * 0.81],
        [x, -r, 0.001],
        [x, -r * 0.72, r * 0.47],
      ];
      for (let j = 0; j < joints.length - 1; j++) {
        handSkin.push(strand(joints[j], joints[j + 1], 0.0075 - j * 0.0005, skin, 0.007 - j * 0.0005));
      }
      // A tiny knuckle plane keeps the four fingers legible at boat-camera distance.
      handSkin.push(mk(bevel(0.013, 0.012, 0.013, 0.002), '#d0a07a', joints[1]));
    }
    handSkin.push(
      strand([side * 0.023, radius + 0.006, 0.017], [side * 0.041, radius * 0.48, 0.029], 0.012, skin, 0.011),
      strand([side * 0.041, radius * 0.48, 0.029], [side * 0.025, -radius * 0.32, 0.029], 0.011, skin, 0.009),
      strand([side * 0.025, -radius * 0.32, 0.029], [side * 0.012, -radius * 0.55, 0.023], 0.009, skin, 0.007),
    );
    const hand = body([], handSkin); hand.position.set(0, -L2, 0); elbow.add(hand);
    arms.push({ shoulder, elbow, hand, side });
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
  const wristBasis = new Matrix4(), forearmQuat = new Quaternion();
  const handX = new Vector3(), handY = new Vector3(), handZ = new Vector3();

  function orientHand(arm: Arm, crankWeight: number) {
    // Rotate only the wrist geometry; the existing two-bone solve and targets stay intact.
    forearmQuat.multiplyQuaternions(arm.shoulder.quaternion, arm.elbow.quaternion);
    handX.set(1 - crankWeight, 0, crankWeight).normalize().applyQuaternion(rodQuat);
    handY.set(0, 1, 0).applyQuaternion(forearmQuat);
    handY.addScaledVector(handX, -handY.dot(handX));
    if (handY.lengthSq() < 1e-6) handY.set(0, 1, 0).applyQuaternion(rodQuat);
    handY.normalize();
    handZ.crossVectors(handX, handY).normalize();
    handY.crossVectors(handZ, handX);
    arm.hand.quaternion.setFromRotationMatrix(wristBasis.makeBasis(handX, handY, handZ));
    arm.hand.quaternion.premultiply(forearmQuat.invert());
  }

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
      orientHand(armR, 0);
      orientHand(armL, cur.wCrank / wTot);

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
