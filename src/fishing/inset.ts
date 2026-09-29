import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { Ctx, InsetRect, School, World } from '../contracts';
import { WORLD } from '../config';
import type { Boat } from './boat';
import { clamp, damp, smooth } from './build';
import type { Game, Phase } from './game';

/**
 * "Lure cam": picture-in-picture camera director (lower-left). A dedicated camera follows the line through every
 * phase (chase the cast, splash, underwater look at the scattering / inspecting school, bite close-up, reel-up,
 * catch, pull-back) and is rendered by the world into a screen rect; a DOM frame with a live label sits over it.
 */

const HIDE_DELAY = 3; // seconds after the line is out / idle before the inset slides away
const LABELS: Record<Phase, string> = {
  idle: 'standby', casting: 'casting', scared: 'splash', calm: 'regrouping', curious: 'curious', approaching: 'incoming',
  bite: 'BITE!', reeling: 'reeling in', celebrate: 'caught!', missed: 'got away', retrieving: 'reeling in',
};

export function createInset(ctx: Ctx, world: World, school: School, game: Game, boat: Boat, seabedAt: (x: number, z: number) => number) {
  const cam = new PerspectiveCamera(48, 16 / 9, 0.08, 400);
  cam.position.set(0, WORLD.surface + 2, 0);

  // ---- DOM frame ----
  const frame = document.createElement('div');
  frame.className = 'fi-frame';
  frame.innerHTML = `<div class="fi-top"><span class="fi-live"><i></i>LURE CAM</span><span class="fi-state">standby</span></div>`;
  document.body.appendChild(frame);
  const stateEl = frame.querySelector<HTMLElement>('.fi-state')!;

  let active = false, appear = 0, idleT = 0, orbit = Math.random() * 6.28, clock = 0, forced = false;
  let shown: InsetRect | null = null;
  const pos = new Vector3(), look = new Vector3(), dPos = new Vector3(), dLook = new Vector3();
  const tmp = new Vector3(), tmp2 = new Vector3(), dir = new Vector3(), side = new Vector3();
  let init = false, lastLabel = '', reelDir = new Vector3(1, 0, 0);

  function fullRect(): InsetRect {
    const mobile = innerWidth <= 650;
    const w = mobile ? Math.min(210, innerWidth * 0.52) : clamp(innerWidth * 0.3, 260, 560), h = (w * 9) / 16;
    const m = mobile ? 12 : 24;
    return { x: m, y: mobile ? 112 : innerHeight - m - h, width: w, height: h };
  }
  /** Rect currently occupied on screen (used by the HUD to keep the hook prompt clear). */
  function rect(): InsetRect | null { return shown; }

  const under = () => WORLD.surface - 0.35;

  /** Desired camera position / look target for the current phase. */
  function direct(dt: number) {
    const L = game.lure, B = game.bobber, T = game.target, boatP = boat.group.position, ph = game.phase, t = game.t;
    const surf = WORLD.surface;
    let underwater = false;
    switch (ph) {
      case 'retrieving':
        if (game.inWater) { // the underwater drag: watch the school split around the lure
          underwater = true;
          side.set(-game.lure.z + boat.group.position.z, 0, game.lure.x - boat.group.position.x).normalize();
          dPos.copy(L).addScaledVector(side, 2.6); dPos.y = L.y + 0.5; dLook.copy(L);
          break;
        }
        // fallthrough
      case 'idle': {
        // over the boat's shoulder, looking at the rod tip / lure hanging
        dir.set(Math.cos(boat.state.yaw), 0, -Math.sin(boat.state.yaw));
        side.set(-dir.z, 0, dir.x);
        dPos.copy(boatP).addScaledVector(side, 3.4).addScaledVector(dir, 0.6); dPos.y = surf + 2.4;
        dLook.copy(L);
        break;
      }
      case 'casting': {
        const wind = game.castWind;
        dir.set(T.x - boatP.x, 0, T.z - boatP.z).normalize();
        side.set(-dir.z, 0, dir.x);
        if (t < wind + 0.05) { // wind-up: behind and beside the rod
          dPos.copy(boatP).addScaledVector(dir, -2.4).addScaledVector(side, 2.6); dPos.y = surf + 2.6;
          dLook.copy(game.lure).addScaledVector(dir, 2.5);
        } else { // chase the lure from behind, slightly to the side and above
          dPos.copy(L).addScaledVector(dir, -4.2).addScaledVector(side, 1.8); dPos.y = Math.max(L.y + 1.2, surf + 1.2);
          dLook.copy(L).addScaledVector(dir, 1.5);
        }
        break;
      }
      case 'scared': {
        dir.set(T.x - boatP.x, 0, T.z - boatP.z).normalize(); side.set(-dir.z, 0, dir.x);
        if (t < 0.9) { // watch the splash from just above the surface, side-on
          dPos.copy(T).addScaledVector(dir, -3.4).addScaledVector(side, 2.2); dPos.y = surf + 1.3;
          dLook.set(T.x, surf + 0.5, T.z);
        } else {
          underwater = true; schoolShot(L, 2.6);
        }
        break;
      }
      case 'calm': underwater = true; schoolShot(L, 2.4); break;
      case 'curious': case 'approaching': {
        underwater = true; orbit += dt * 0.28;
        const r = ph === 'approaching' ? 1.6 : 2.0;
        dPos.set(L.x + Math.cos(orbit) * r, L.y + 0.25 + Math.sin(orbit * 0.7) * 0.15, L.z + Math.sin(orbit) * r);
        dLook.copy(L);
        break;
      }
      case 'bite': {
        underwater = true; orbit += dt * 0.6;
        const r = 0.8, k = 0.03;
        dPos.set(L.x + Math.cos(orbit) * r, L.y + 0.1, L.z + Math.sin(orbit) * r);
        dPos.x += Math.sin(clock * 47) * k; dPos.y += Math.sin(clock * 39) * k; dPos.z += Math.cos(clock * 43) * k; // shake
        dLook.copy(L);
        break;
      }
      case 'reeling': {
        reelDir.set(boatP.x - L.x, 0, boatP.z - L.z).normalize();
        side.set(-reelDir.z, 0, reelDir.x);
        if (L.y < surf - 0.15) { // follow it up from below/side
          underwater = true;
          dPos.copy(L).addScaledVector(side, 1.5).addScaledVector(reelDir, -0.6); dPos.y = L.y - 0.3;
          dLook.copy(L); dLook.y += 0.25;
        } else { // it breaks the surface: watch it fly to the boat from the side
          dPos.copy(L).addScaledVector(side, 3.0).addScaledVector(reelDir, -1.2); dPos.y = Math.max(L.y - 0.2, surf + 0.4);
          dLook.copy(L);
        }
        break;
      }
      case 'celebrate': {
        dir.set(Math.cos(boat.state.yaw), 0, -Math.sin(boat.state.yaw)); side.set(-dir.z, 0, dir.x);
        dPos.copy(boatP).addScaledVector(side, 3.6).addScaledVector(dir, 1.2); dPos.y = surf + 1.9;
        dLook.copy(L).lerp(boatP, 0.25);
        break;
      }
      case 'missed': {
        underwater = true; orbit += dt * 0.15;
        dPos.set(L.x + Math.cos(orbit) * 3.6, L.y + 0.6, L.z + Math.sin(orbit) * 3.6);
        dLook.copy(L);
        break;
      }
    }
    return underwater;
  }

  /** Underwater shot on the lure with the school behind it (camera on the far side of the lure from the school). */
  function schoolShot(L: Vector3, r: number) {
    const c = school.stats.centroid;
    tmp.set(c.x - L.x, 0, c.z - L.z);
    if (!(school.count > 0) || !Number.isFinite(c.x) || tmp.lengthSq() < 1) { orbit += 0.004; tmp.set(-Math.cos(orbit), 0, -Math.sin(orbit)); }
    tmp.normalize();
    dPos.copy(L).addScaledVector(tmp, -r); dPos.y = L.y + 0.4;
    dLook.copy(L).addScaledVector(tmp, 0.6);
  }

  /** Keep the camera out of terrain / the boat / on the right side of the surface. */
  function constrain(underwater: boolean, anchor: Vector3) {
    if (underwater) {
      pos.y = Math.min(pos.y, under());
      for (let i = 0; i < 8; i++) {
        if (seabedAt(pos.x, pos.z) + 0.45 <= pos.y) break;
        pos.x += (anchor.x - pos.x) * 0.3; pos.z += (anchor.z - pos.z) * 0.3; pos.y = Math.min(pos.y, under());
      }
      pos.y = Math.max(pos.y, seabedAt(pos.x, pos.z) + 0.4);
      pos.x = clamp(pos.x, -WORLD.half + 0.4, WORLD.half - 0.4); pos.z = clamp(pos.z, -WORLD.half + 0.4, WORLD.half - 0.4);
    } else {
      pos.y = Math.max(pos.y, WORLD.surface + 0.35);
      const b = boat.group.position, dx = pos.x - b.x, dz = pos.z - b.z, d = Math.hypot(dx, dz);
      if (d < 2.6 && pos.y < b.y + 3.2 && d > 1e-3) { pos.x = b.x + (dx / d) * 2.6; pos.z = b.z + (dz / d) * 2.6; }
      // stay out of the island: if the ground below is above the water, lift over it
      const g = seabedAt(pos.x, pos.z); if (g > WORLD.surface - 0.5) pos.y = Math.max(pos.y, g + 1.0);
    }
  }

  let underNow = false;
  function update(dt: number) {
    clock += dt;
    // ---- visibility ----
    const line = game.phase !== 'idle';
    if (line) { active = true; idleT = 0; } else { idleT += dt; if (idleT > HIDE_DELAY) active = false; }
    if (forced) active = true;
    appear = clamp(appear + (active ? dt / 0.45 : -dt / 0.35), 0, 1);
    if (appear <= 0) {
      if (shown) { shown = null; world.setInset(null); school.setInsetCamera(null); frame.classList.remove('on'); init = false; }
      return;
    }
    // ---- camera ----
    underNow = direct(dt);
    if (!init) { pos.copy(dPos); look.copy(dLook); init = true; }
    const rp = game.phase === 'bite' ? 12 : game.phase === 'casting' ? 5 : 3.2;
    pos.x = damp(pos.x, dPos.x, rp, dt); pos.y = damp(pos.y, dPos.y, rp, dt); pos.z = damp(pos.z, dPos.z, rp, dt);
    look.x = damp(look.x, dLook.x, rp * 1.5, dt); look.y = damp(look.y, dLook.y, rp * 1.5, dt); look.z = damp(look.z, dLook.z, rp * 1.5, dt);
    constrain(underNow, game.lure);
    cam.position.copy(pos);
    cam.lookAt(look);
    cam.updateMatrixWorld();

    // ---- rect + frame ----
    const full = fullRect(), e = smooth(appear);
    const w = full.width * (0.8 + 0.2 * e), h = full.height * (0.8 + 0.2 * e);
    const r: InsetRect = { x: full.x, y: full.y + full.height - h, width: w, height: h };
    if (innerWidth <= 650) r.y = full.y;
    shown = r;
    cam.aspect = w / h; cam.updateProjectionMatrix();
    world.setInset(cam, r);
    school.setInsetCamera(cam);
    frame.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;opacity:${e};transform:translateY(${(1 - e) * 14}px)`;
    frame.classList.add('on');
    frame.classList.toggle('bite', game.phase === 'bite');
    let label = LABELS[game.phase];
    if (game.phase === 'curious') { const n = Math.round(school.stats.nearLure); label = n > 0 ? `curious · ${new Intl.NumberFormat('en').format(n)} fish` : 'curious'; }
    if (label !== lastLabel) { lastLabel = label; stateEl.textContent = label; }
  }

  return {
    camera: cam, update, rect,
    /** Keep the inset on regardless of phase (debug). */
    force(v: boolean) { forced = v; },
  };
}
export type Inset = ReturnType<typeof createInset>;
