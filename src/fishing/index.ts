import './style.css';
import { Vector3 } from 'three/webgpu';
import type { Raycaster } from 'three/webgpu';
import type { FolderApi } from 'tweakpane';
import type { Ctx, Fishing, School, World } from '../contracts';
import { WORLD } from '../config';
import { createBoat } from './boat';
import { createFisherman } from './fisherman';
import { createFx } from './fx';
import { Game, settings } from './game';
import type { GameEnv } from './game';
import { createHud } from './hud';
import { createMockSchool } from './mock-school';
import { createRig } from './rig';

/**
 * Boat + fisherman + rod/line/bobber/lure + splash FX + game state machine + HUD.
 * Uses the real School when it has fish, otherwise a mock with plausible timing (so the game loop stays testable).
 */
export async function createFishing(ctx: Ctx, world: World, realSchool: School): Promise<Fishing> {
  const { scene, camera } = ctx;
  const query = new URLSearchParams(location.search);
  const usingMock = realSchool.count === 0;
  const mock = usingMock ? createMockSchool() : null;
  const school: School = mock ?? realSchool;
  if (query.has('autofish')) settings.auto = true;

  const boat = createBoat(world);
  scene.add(boat.group);
  boat.group.traverse(o => { if ('isMesh' in o) { (o as { castShadow: boolean }).castShadow = true; (o as { receiveShadow: boolean }).receiveShadow = true; } });

  const tip = new Vector3();
  const boatPos = new Vector3();
  const seabed = world.seabed;
  const env: GameEnv = {
    heightAt: (x, z) => world.heightAt(x, z),
    seabedAt: (x, z) => {
      const r = seabed.resolution, ix = Math.min(r - 1, Math.max(0, Math.floor(((x + WORLD.half) / (2 * WORLD.half)) * r)));
      const iz = Math.min(r - 1, Math.max(0, Math.floor(((z + WORLD.half) / (2 * WORLD.half)) * r)));
      return seabed.heights[iz * r + ix];
    },
    tip, bucket: out => boat.bucket(out), boat: boatPos,
  };
  boat.group.updateMatrixWorld(true);
  boat.update(0.016);
  boatPos.set(boat.state.x, 0, boat.state.z);

  const game = new Game(school, env);
  const fisherman = createFisherman(boat, game);
  fisherman.update(0.016, null);
  tip.copy(fisherman.tipWorld);
  const rig = createRig(scene, world, game, camera);
  rig.setMock(usingMock);
  const rippleThrottle = { t: 0 };
  const fx = createFx(scene, world, p => { if (rippleThrottle.t <= 0) { rippleThrottle.t = 0.1; world.ripple(p, 0.22); fx.ring(p, 0.22, 0.6, 0.35); } });
  const hud = createHud();

  // ---- camera override (debug / video framing) ----
  let camOverride: { pos: Vector3; look: Vector3; relative: boolean } | null = null;
  const cam = query.get('fishingCam');
  if (cam) {
    const off = (query.get('camOff') ?? (cam === 'cast' ? '4.5,3.2,5' : '1.9,1.25,2.3')).split(',').map(Number);
    const look = (query.get('camLook') ?? (cam === 'cast' ? '-1.5,0.3,-1.2' : '0,0.45,0')).split(',').map(Number);
    camOverride = { pos: new Vector3(off[0], off[1], off[2]), look: new Vector3(look[0], look[1], look[2]), relative: true };
  }

  const surface = new Vector3();
  function ripple(p: Vector3, s: number) { surface.set(p.x, world.heightAt(p.x, p.z), p.z); world.ripple(surface, s); }

  function handleEvents() {
    for (const e of game.events) {
      switch (e.type) {
        case 'release': boat.kick(0.5, 0.25); break;
        case 'splash': ripple(e.pos, 1.5); fx.splash(surfacePoint(e.pos), 1); boat.kick(-0.15); break;
        case 'nibble': ripple(e.pos, 0.28); fx.ring(surfacePoint(e.pos), 0.3, 0.7, 0.4); break;
        case 'bite': ripple(e.pos, 0.5); fx.ring(surfacePoint(e.pos), 0.5, 0.9, 0.5); break;
        case 'hook': boat.kick(0.8, 0.3); ripple(e.pos, 0.6); break;
        case 'surface': ripple(e.pos, 0.9); fx.smallSplash(surfacePoint(e.pos)); break;
        case 'drop': fx.splash(e.pos, 0.12, false); boat.kick(-0.3); break;
        case 'catch': boat.kick(0.2); break;
        case 'miss': ripple(e.pos, 0.4); break;
      }
    }
    game.events.length = 0;
  }
  const sp = new Vector3();
  function surfacePoint(p: Vector3) { return sp.set(p.x, world.heightAt(p.x, p.z), p.z); }

  const aim = new Vector3(), tmpO = new Vector3(), tmpL = new Vector3();
  let dripT = 0;
  const lureAir = new Vector3();

  function update(dt: number) {
    mock?.update(dt);
    rippleThrottle.t -= dt;
    boat.update(dt);
    boatPos.set(boat.state.x, 0, boat.state.z);
    tip.copy(fisherman.tipWorld);
    game.update(dt);
    handleEvents();
    const ph = game.phase;
    let aimAt: Vector3 | null = null;
    if (ph === 'casting') aimAt = game.target;
    else if (game.inWater && ph !== 'retrieving') aimAt = aim.copy(game.bobber);
    fisherman.update(dt, aimAt);
    rig.update(dt, fisherman.tipWorld);
    // drips off the fish while it is in the air
    if ((ph === 'reeling' || ph === 'celebrate') && game.fishVisible && game.lure.y > world.heightAt(game.lure.x, game.lure.z) + 0.05) {
      dripT -= dt;
      if (dripT <= 0) { dripT = 0.045; fx.drip(lureAir.copy(game.lure).setY(game.lure.y - 0.08)); }
    }
    fx.update(dt);
    hud.update(game);
    if (camOverride) {
      const o = camOverride.relative ? tmpO.set(boat.state.x, boat.group.position.y, boat.state.z) : tmpO.set(0, 0, 0);
      camera.position.copy(camOverride.pos).add(o);
      camera.lookAt(tmpL.copy(camOverride.look).add(o));
    }
  }

  function click(raycaster: Raycaster): boolean {
    if (game.phase === 'bite') return game.hook();
    const hits = raycaster.intersectObject(world.surface, false);
    if (!hits.length) return false;
    const terrain = raycaster.intersectObjects(world.terrain, false);
    if (terrain.length && terrain[0].distance < hits[0].distance - 1e-3) return false; // island in the way
    return game.requestCast(hits[0].point);
  }

  addEventListener('keydown', e => { if (e.code === 'Space' && game.phase === 'bite') { e.preventDefault(); game.hook(); } });

  function addControls(folder: FolderApi) {
    folder.addBinding(settings, 'auto', { label: 'auto-fish' });
    folder.addBinding(settings, 'autoSuccess', { min: 0, max: 1, step: 0.05, label: 'auto hook %' });
    folder.addBinding(settings, 'lureDepth', { min: 0.5, max: 3, step: 0.05, label: 'lure depth' });
    folder.addBinding(settings, 'biteMin', { min: 0.5, max: 12, step: 0.25, label: 'bite min s' });
    folder.addBinding(settings, 'biteMax', { min: 0.5, max: 20, step: 0.25, label: 'bite max s' });
    folder.addBinding(settings, 'hookWindow', { min: 0.5, max: 4, step: 0.1, label: 'hook window' });
    folder.addBinding(settings, 'castSpeed', { min: 0.5, max: 2, step: 0.05, label: 'cast speed' });
    const dbg = { linePhysics: false };
    folder.addBinding(dbg, 'linePhysics', { label: 'debug line' }).on('change', ev => { rig.debug.visible = ev.value; });
    folder.addButton({ title: 'Reset counter' }).on('click', () => game.reset());
  }

  // ---- debug API for headless testing ----
  Object.defineProperty(window, 'fishing', {
    configurable: true,
    get: () => ({
      game, settings, boat, mock: usingMock,
      get state() { return { phase: game.phase, t: +game.t.toFixed(2), caught: game.caught, hint: game.hint, tension: +game.tension.toFixed(2), lure: game.lure.toArray().map(v => +v.toFixed(2)), bobber: game.bobber.toArray().map(v => +v.toFixed(2)), biter: school.stats.biter, nearLure: school.stats.nearLure }; },
      cast: (x: number, z: number) => game.requestCast(new Vector3(x, world.heightAt(x, z), z)),
      hook: () => game.hook(),
      auto: (v = true) => { settings.auto = v; },
      /** Absolute camera: cam([px,py,pz],[lx,ly,lz]); cam(null) hands the camera back. */
      cam: (p: number[] | null, l?: number[]) => { if (!p) { camOverride = null; return; } camOverride = { pos: new Vector3(...(p as [number, number, number])), look: new Vector3(...((l ?? [0, 0, 0]) as [number, number, number])), relative: false }; },
      /** Camera relative to the boat. */
      camBoat: (p: number[], l: number[]) => { camOverride = { pos: new Vector3(...(p as [number, number, number])), look: new Vector3(...(l as [number, number, number])), relative: true }; },
    }),
  });

  return { update, click, addControls };
}
