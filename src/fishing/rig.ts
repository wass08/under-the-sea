import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PerspectiveCamera, Quaternion, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import type { World } from '../contracts';
import { clamp, flatMaterial, merge, mk } from './build';
import type { Game } from './game';

const A = 22; // points tip -> bobber
const B = 4; // points bobber -> lure
const P = A + B;
const UP = new Vector3(0, 1, 0);

/** Bobber, lure, camera-facing fishing line ribbon, debug markers and a placeholder fish (mock school only). */
export function createRig(scene: Scene, world: World, game: Game, camera: PerspectiveCamera) {
  // ---- line ribbon ----
  const positions = new Float32Array(P * 2 * 3);
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(positions, 3); posAttr.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  const index: number[] = [];
  for (let i = 0; i < P - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geometry.setIndex(index);
  const lineMat = new MeshBasicNodeMaterial({ color: new Color('#f2fbff'), side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
  const line = new Mesh(geometry, lineMat); line.frustumCulled = false; line.renderOrder = 2; scene.add(line);

  // ---- bobber ----
  const bobber = new Group(); bobber.name = "Fishing bobber";
  const sph = (r: number, ts: number, tl: number) => new SphereGeometry(r, 10, 6, 0, Math.PI * 2, ts, tl);
  const bobberMesh = new Mesh(merge([
    mk(sph(0.08, 0, Math.PI / 2), '#e8433a', [0, 0, 0], [0, 0, 0], [1, 1, 1], 0.03),
    mk(sph(0.08, Math.PI / 2, Math.PI / 2), '#f7f4ea', [0, 0, 0], [0, 0, 0], [1, 1, 1], 0.03),
    mk(new CylinderGeometry(0.085, 0.085, 0.014, 10), '#f7f4ea', [0, 0.02, 0]),
    mk(new CylinderGeometry(0.008, 0.008, 0.16, 5), '#e8433a', [0, 0.155, 0]),
    mk(new CylinderGeometry(0.008, 0.008, 0.06, 5), '#f7f4ea', [0, 0.105, 0]),
    mk(new SphereGeometry(0.014, 6, 4), '#ffef7a', [0, 0.24, 0]),
    mk(new CylinderGeometry(0.006, 0.006, 0.12, 5), '#333', [0, -0.12, 0]),
  ]), flatMaterial(0.5));
  bobberMesh.castShadow = true; bobber.add(bobberMesh); scene.add(bobber);

  // ---- lure (spoon + hook + glint) ----
  const lure = new Group();
  const spoonMat = new MeshStandardNodeMaterial({ color: '#dfeaf0', metalness: 0.95, roughness: 0.18, emissive: new Color('#bfe8ff'), emissiveIntensity: 0.8, flatShading: true });
  const spoon = new Mesh(new SphereGeometry(0.06, 8, 6), spoonMat); spoon.scale.set(0.5, 1.35, 0.2); spoon.position.y = -0.03;
  const hookMat = new MeshStandardNodeMaterial({ color: '#8f99a3', metalness: 1, roughness: 0.3 });
  const hook = new Mesh(new TorusGeometry(0.03, 0.006, 4, 10, Math.PI * 1.3), hookMat); hook.position.set(0, -0.13, 0); hook.rotation.z = Math.PI * 0.35;
  const bead = new Mesh(new SphereGeometry(0.018, 6, 4), new MeshStandardNodeMaterial({ color: '#e8433a', emissive: new Color('#ff3020'), emissiveIntensity: 0.5 }));
  bead.position.y = 0.045;
  const glowMat = new MeshBasicNodeMaterial({ color: new Color(1.8, 1.9, 1.6), transparent: true, opacity: 0.3, depthWrite: false });
  const glow = new Mesh(new SphereGeometry(0.045, 8, 6), glowMat);
  lure.add(spoon, hook, bead, glow); scene.add(lure);
  spoon.castShadow = true;

  // ---- placeholder fish (used only with the mock school) ----
  const fish = new Group();
  const fishMesh = new Mesh(merge([
    mk(new SphereGeometry(1, 8, 6), '#f28a30', [0, 0, 0], [0, 0, 0], [0.17, 0.065, 0.045]),
    mk(new SphereGeometry(1, 8, 6), '#f6e2c0', [0.01, -0.02, 0], [0, 0, 0], [0.14, 0.04, 0.046]),
    mk(new ConeGeometry(1, 1, 4), '#e2662a', [-0.21, 0, 0], [0, 0, Math.PI / 2], [0.07, 0.11, 0.012]),
    mk(new ConeGeometry(1, 1, 4), '#e2662a', [0, 0.07, 0], [0, 0, 0], [0.05, 0.07, 0.01]),
    mk(new SphereGeometry(1, 6, 4), '#111', [0.13, 0.02, 0.035], [0, 0, 0], [0.012, 0.012, 0.012], 0),
    mk(new SphereGeometry(1, 6, 4), '#111', [0.13, 0.02, -0.035], [0, 0, 0], [0.012, 0.012, 0.012], 0),
  ]), flatMaterial(0.5));
  fishMesh.position.x = -0.17;
  fishMesh.castShadow = true; fish.add(fishMesh); fish.visible = false; scene.add(fish);

  // ---- debug markers ----
  const debug = new Group(); debug.visible = false; scene.add(debug);
  const marker = (color: string) => { const m = new Mesh(new SphereGeometry(0.07, 8, 6), new MeshBasicNodeMaterial({ color, depthTest: false, transparent: true })); m.renderOrder = 10; debug.add(m); return m; };
  const dTip = marker('#00ff88'), dBobber = marker('#ff4444'), dLure = marker('#ffee00'), dTarget = marker('#44aaff');

  const tmp = new Vector3(), dir = new Vector3(), side = new Vector3(), toCam = new Vector3(), q = new Quaternion(), prevLure = new Vector3();
  const pts: Vector3[] = Array.from({ length: P }, () => new Vector3());
  let clock = 0, usingMock = false;

  function buildLine(tip: Vector3) {
    const b = game.bobber, l = game.lure, phase = game.phase;
    const dist = tip.distanceTo(b);
    let sag: number;
    if (phase === 'idle' || (phase === 'casting' && game.t < game.castWind) || phase === 'retrieving') sag = 0.03;
    else if (phase === 'casting') sag = 0.05 + dist * (0.09 + 0.08 * (1 - clamp((game.t - game.castWind) / game.castFlight, 0, 1)));
    else if (phase === 'reeling' || phase === 'celebrate') sag = 0.015 + dist * 0.02 * (1 - game.tension);
    else sag = 0.02 + dist * (0.045 * (1 - game.tension) + 0.006);
    const inWaterPhase = game.inWater && phase !== 'reeling' && phase !== 'celebrate' && phase !== 'retrieving' && phase !== 'casting';
    for (let i = 0; i < A; i++) {
      const f = i / (A - 1), p = pts[i];
      p.lerpVectors(tip, b, f);
      p.y -= sag * 4 * f * (1 - f);
      p.x += Math.sin(clock * 3 + f * 5) * 0.004 * dist * f * (1 - f) * (1 - game.tension);
      if (inWaterPhase && f > 0.05) { const h = world.heightAt(p.x, p.z) + 0.012; if (p.y < h) p.y = h; }
    }
    for (let i = 0; i < B; i++) { const f = (i + 1) / B; pts[A + i].lerpVectors(b, l, f); if (f < 1 && !(phase === 'reeling')) pts[A + i].x += Math.sin(clock * 1.7) * 0.01 * f * (1 - f); }
    // during reeling the whole thing is one taut segment tip -> lure through the bobber
    // ribbon
    const cam = camera.position;
    for (let i = 0; i < P; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(P - 1, i + 1)];
      dir.subVectors(c, a);
      toCam.subVectors(cam, p);
      const cd = toCam.length();
      side.crossVectors(dir, toCam);
      if (side.lengthSq() < 1e-12) side.set(1, 0, 0); else side.normalize();
      const w = clamp(cd * 0.00085, 0.006, 0.028);
      positions[i * 6] = p.x - side.x * w; positions[i * 6 + 1] = p.y - side.y * w; positions[i * 6 + 2] = p.z - side.z * w;
      positions[i * 6 + 3] = p.x + side.x * w; positions[i * 6 + 4] = p.y + side.y * w; positions[i * 6 + 5] = p.z + side.z * w;
    }
    posAttr.needsUpdate = true;
  }

  return {
    setMock(v: boolean) { usingMock = v; },
    debug,
    update(dt: number, tip: Vector3) {
      clock += dt;
      const phase = game.phase;
      // bobber: sits on the water, tilts with the surface, wobbles when dipped
      bobber.position.copy(game.bobber);
      const inAir = !game.inWater || phase === 'casting' || phase === 'reeling' || phase === 'celebrate' || phase === 'retrieving';
      if (inAir) {
        dir.subVectors(tip, game.bobber).normalize(); q.setFromUnitVectors(UP, dir); bobber.quaternion.slerp(q, 0.3);
      } else {
        world.normalAt(game.bobber.x, game.bobber.z, tmp);
        q.setFromUnitVectors(UP, tmp); bobber.quaternion.copy(q);
        bobber.rotateZ(Math.sin(clock * 2.1) * 0.06 + game.dip * Math.sin(clock * 35) * 0.25);
        bobber.rotateX(Math.cos(clock * 1.7) * 0.05);
      }
      // lure: hangs from the line (up axis toward the bobber / rod tip)
      lure.position.copy(game.lure);
      const upTo = phase === 'reeling' || phase === 'celebrate' ? tip : game.bobber;
      dir.subVectors(upTo, game.lure);
      if (dir.lengthSq() > 1e-6) { dir.normalize(); q.setFromUnitVectors(UP, dir); lure.quaternion.slerp(q, 0.35); }
      lure.rotateY(clock * 3);
      spoonMat.emissiveIntensity = 0.9 + Math.sin(clock * 7.3) * 0.5 + Math.max(0, Math.sin(clock * 2.9)) * 1.4;
      glowMat.opacity = 0.05 + Math.max(0, Math.sin(clock * 2.9 + 0.4)) * 0.22;

      // fish placeholder
      const fishOn = usingMock && (game.fishVisible || phase === 'bite');
      fish.visible = fishOn;
      if (fishOn) {
        const thrash = Math.sin(clock * 24) * 0.45 * (phase === 'celebrate' ? 0.3 : 1);
        fish.position.copy(game.lure);
        tmp.subVectors(game.lure, prevLure);
        fish.rotation.set(0, 0, phase === 'bite' ? thrash * 0.5 : Math.PI / 2 - 0.25 + thrash * 0.5);
        fish.rotateY(clock * 0.0);
        fish.position.y += phase === 'bite' ? 0 : -0.02;
      }
      prevLure.copy(game.lure);

      buildLine(tip);
      // debug
      if (debug.visible) { dTip.position.copy(tip); dBobber.position.copy(game.bobber); dLure.position.copy(game.lure); dTarget.position.copy(game.target); }
    },
    fishAt: fish,
  };
}
export type Rig = ReturnType<typeof createRig>;
void BoxGeometry;
