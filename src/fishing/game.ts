import { Vector3 } from 'three/webgpu';
import type { School } from '../contracts';
import { WORLD } from '../config';
import { RIG_SCALE as K, clamp, damp, rand, smooth } from './build';

/**
 * Game state machine (no rendering). All timers run on the sim dt handed to update(), so slow motion slows
 * everything. The visual layers (fisherman, rig, fx, hud) only READ `phase`, `t`, `lure`, `bobber`, `tension`, `dip`
 * and drain `events`.
 *
 *  idle -> casting -> scared -> calm -> curious -> approaching -> bite -> reeling -> celebrate -> idle
 *                                          ^           |            |
 *                                          |           +------------+--(fish lost)--> missed -> curious
 *   any in-water phase --click--> retrieving --(queued target)--> casting
 */
export type Phase = 'idle' | 'casting' | 'scared' | 'calm' | 'curious' | 'approaching' | 'bite' | 'reeling' | 'celebrate' | 'missed' | 'retrieving';

export interface GameEnv {
  heightAt(x: number, z: number): number;
  /** Top of the terrain (seabed / island) under x,z. */
  seabedAt(x: number, z: number): number;
  /** Live rod tip in world space. */
  tip: Vector3;
  /** World position of the bucket opening. */
  bucket(out: Vector3): Vector3;
  boat: Vector3;
}

export interface GameEvent { type: 'cast' | 'release' | 'splash' | 'bite' | 'nibble' | 'hook' | 'surface' | 'drop' | 'catch' | 'miss' | 'retrieve'; pos: Vector3 }

/** Live-tunable settings (Tweakpane + URL). */
export const settings = {
  auto: false,
  autoSuccess: 0.8,
  lureDepth: 1.4,
  biteMin: 2,
  biteMax: 6,
  hookWindow: 1.5,
  castSpeed: 1,
  curiosityRamp: 3,
  scaredMin: 2,
  scaredMax: 3,
};

const JERK = 0.35, PULL = 0.9, OUT = 0.9, HOLD = 0.9, DROP = 0.35, RETRIEVE = 0.55, MISSED = 1.7;
const IN_WATER: Phase[] = ['scared', 'calm', 'curious', 'approaching', 'bite', 'missed'];

export class Game {
  phase: Phase = 'idle';
  t = 0;
  caught = 0;
  readonly target = new Vector3();
  readonly lure = new Vector3();
  readonly bobber = new Vector3();
  tension = 0;
  dip = 0;
  events: GameEvent[] = [];
  /** 0..1 how much of the hook window is left (bite phase). */
  hookLeft = 0;
  inWater = false; // lure below the surface / line out in the water
  fishVisible = false; // a hooked fish is on the line (for mock visuals)

  private queued: Vector3 | null = null;
  private sinkT = 0;
  private clock = 0;
  private scaredDur = 2.5;
  private biteAcc = 0; private biteAt = 3; private retry = 0; private totalWait = 0;
  private dipBase = 0; private nibbleV = 0; private nibbleT = 1;
  private tensionT = 0;
  private released = false;
  private readonly rel0 = new Vector3(); private readonly bob0 = new Vector3();
  private readonly S = new Vector3(); private readonly H = new Vector3(); private readonly tmp = new Vector3(); private readonly tmp2 = new Vector3();
  private autoT = 1.4; private autoReact = 0.5; private autoHook = true;
  private rippleT = 0;

  constructor(private school: School, private env: GameEnv) { this.hangLure(); }

  // ------- timing exposed to the animation layers -------
  get castWind() { return 0.6 / settings.castSpeed; }
  get castFlight() { return 0.9 / settings.castSpeed; }
  get jerkTime() { return JERK; }
  get celebrateHold() { return HOLD; }
  get auto() { return settings.auto; }

  get hint(): string {
    const n = Math.round(this.school.stats.nearLure);
    switch (this.phase) {
      case 'idle': return settings.auto ? 'Auto-fishing…' : 'Click the water to cast';
      case 'casting': return 'Casting…';
      case 'scared': return 'The school scatters…';
      case 'calm': return 'Calm returns…';
      case 'curious': return n > 0 ? `Curious… ${n === 1 ? '1 fish' : new Intl.NumberFormat('en').format(n) + ' fish'} inspecting the lure` : 'Curious… waiting for fish';
      case 'approaching': return 'Something is coming…';
      case 'bite': return 'Bite!';
      case 'reeling': return 'Reeling in…';
      case 'celebrate': return 'Nice catch!';
      case 'missed': return 'It got away…';
      case 'retrieving': return 'Reeling in…';
    }
  }

  // ------- input -------
  /** Is x,z a place we can cast to (inside the water square, away from the boat, not on the island)? */
  validSpot(x: number, z: number, minBoat = 1.5): boolean {
    const lim = WORLD.half - 0.4;
    if (Math.abs(x) >= lim || Math.abs(z) >= lim) return false;
    if (Math.hypot(x - this.env.boat.x, z - this.env.boat.z) < minBoat) return false;
    return this.env.seabedAt(x, z) < WORLD.surface - 0.8;
  }

  /** Cast (or recast) at a surface point. Returns true if the request was accepted. */
  requestCast(p: Vector3): boolean {
    if (!this.validSpot(p.x, p.z)) return false;
    if (this.phase === 'idle') { this.startCast(p); return true; }
    if (IN_WATER.includes(this.phase) && this.phase !== 'bite') { this.startRetrieve(p); return true; }
    if (this.phase === 'retrieving') { this.queued = p.clone(); return true; }
    return false;
  }

  /** The player clicked during the bite window. */
  hook(): boolean {
    if (this.phase !== 'bite') return false;
    this.enter('reeling');
    this.rel0.copy(this.lure); this.bob0.copy(this.bobber);
    this.S.set(this.rel0.x + (this.env.tip.x - this.rel0.x) * 0.3, 0, this.rel0.z + (this.env.tip.z - this.rel0.z) * 0.3);
    this.S.y = this.env.heightAt(this.S.x, this.S.z);
    this.emit('hook', this.lure);
    return true;
  }

  // ------- transitions -------
  private enter(p: Phase) { this.phase = p; this.t = 0; }
  private emit(type: GameEvent['type'], pos: Vector3) { this.events.push({ type, pos: pos.clone() }); }

  private startCast(p: Vector3) {
    this.target.set(p.x, this.env.heightAt(p.x, p.z), p.z);
    this.enter('casting'); this.released = false; this.inWater = false; this.totalWait = 0;
    this.emit('cast', this.env.tip);
  }
  private startRetrieve(next: Vector3 | null) {
    this.queued = next ? next.clone() : null;
    this.rel0.copy(this.lure); this.bob0.copy(this.bobber);
    this.enter('retrieving');
    this.school.setLure(null); this.school.setCuriosity(0);
    this.emit('retrieve', this.lure);
  }
  private hangLure() {
    const tip = this.env.tip, w = this.clock;
    this.bobber.set(tip.x + Math.sin(w * 1.7) * 0.03, tip.y - 0.55 * K, tip.z + Math.cos(w * 1.3) * 0.03);
    this.lure.set(tip.x + Math.sin(w * 1.9 + 1) * 0.06, tip.y - 0.95 * K, tip.z + Math.cos(w * 1.5) * 0.06);
  }
  private beginWait() { this.biteAcc = 0; this.biteAt = rand(settings.biteMin, Math.max(settings.biteMin, settings.biteMax)); this.retry = 0; }

  // ------- per frame -------
  update(dt: number) {
    this.clock += dt; this.t += dt;
    const stats = this.school.stats, env = this.env;
    let curiosity = 0;
    this.tensionT = 0; this.dipBase = 0;
    if (IN_WATER.includes(this.phase)) this.totalWait += dt;

    switch (this.phase) {
      case 'idle':
        this.hangLure(); this.school.setLure(null);
        if (settings.auto) {
          this.autoT -= dt;
          if (this.autoT <= 0) { const p = this.pickSpot(); if (p) this.startCast(p); else this.autoT = 0.5; }
        }
        break;

      case 'casting': {
        const wind = this.castWind, flight = this.castFlight;
        this.tensionT = 0.12;
        if (this.t < wind) this.hangLure();
        else {
          if (!this.released) { this.released = true; this.rel0.copy(env.tip); this.emit('release', env.tip); }
          const s = clamp((this.t - wind) / flight, 0, 1);
          this.target.y = env.heightAt(this.target.x, this.target.z);
          const dist = Math.hypot(this.target.x - this.rel0.x, this.target.z - this.rel0.z);
          const arc = (0.9 + dist * 0.16) * K;
          this.lure.lerpVectors(this.rel0, this.target, s); this.lure.y += arc * 4 * s * (1 - s);
          this.bobber.copy(this.lure);
          if (s >= 1) {
            this.enter('scared'); this.sinkT = 0; this.inWater = true;
            this.scaredDur = rand(settings.scaredMin, settings.scaredMax);
            this.emit('splash', this.target);
            this.school.panic(this.target, 1);
            this.waterPose(0);
          }
        }
        break;
      }

      case 'scared':
        this.waterPose(dt); if (this.t >= this.scaredDur) this.enter('calm'); break;
      case 'calm':
        curiosity = clamp(this.t / settings.curiosityRamp, 0, 1);
        this.waterPose(dt);
        if (this.t >= settings.curiosityRamp) { this.enter('curious'); this.beginWait(); }
        break;

      case 'curious': {
        curiosity = 1;
        this.waterPose(dt);
        if (stats.nearLure > 0) {
          this.biteAcc += dt; this.retry -= dt;
          this.nibbleT -= dt;
          if (this.nibbleT <= 0) { this.nibbleT = rand(0.9, 2.4); this.nibbleV = rand(0.35, 0.8); this.emit('nibble', this.bobber); }
          if (this.biteAcc >= this.biteAt && this.retry <= 0) {
            if (this.school.strike()) this.enter('approaching'); else this.retry = 0.8;
          }
        }
        if (settings.auto && this.totalWait > 24) { const p = this.pickSpot(); if (p) this.startRetrieve(p); }
        break;
      }

      case 'approaching':
        curiosity = 1; this.waterPose(dt);
        this.nibbleT -= dt;
        if (this.nibbleT <= 0) { this.nibbleT = rand(0.35, 0.8); this.nibbleV = rand(0.3, 0.6); }
        if (stats.biter === 'hooked') {
          this.enter('bite'); this.emit('bite', this.bobber); this.rippleT = 0;
          this.autoReact = rand(0.25, 0.9); this.autoHook = Math.random() < settings.autoSuccess;
        } else if ((stats.biter === 'none' && this.t > 0.6) || this.t > 8) { this.enter('curious'); this.beginWait(); }
        break;

      case 'bite': {
        curiosity = 1; this.dipBase = 1; this.tensionT = 0.55;
        this.hookLeft = clamp(1 - this.t / settings.hookWindow, 0, 1);
        this.waterPose(dt);
        this.lure.x += Math.sin(this.clock * 40) * 0.035; this.lure.y += Math.sin(this.clock * 33) * 0.03;
        this.rippleT -= dt;
        if (this.rippleT <= 0) { this.rippleT = 0.32; this.emit('nibble', this.bobber); }
        if (settings.auto && this.autoHook && this.t >= this.autoReact) this.hook();
        else if (this.t >= settings.hookWindow) {
          this.school.land(false);
          this.enter('missed'); this.emit('miss', this.bobber);
        }
        break;
      }

      case 'missed':
        curiosity = 1; this.waterPose(dt);
        if (this.t >= MISSED) { this.enter('curious'); this.beginWait(); this.biteAcc = -1.5; }
        break;

      case 'reeling': {
        curiosity = 1; this.fishVisible = true;
        const t = this.t;
        this.tensionT = t < JERK ? 1 : t < JERK + PULL ? 0.95 : 0.7;
        env.bucket(this.H); this.H.y += 0.85 * K;
        if (t < JERK) {
          this.lure.copy(this.rel0); this.lure.x += Math.sin(t * 60) * 0.05; this.lure.y += Math.sin(t * 47) * 0.04;
          this.bobber.copy(this.bob0); this.dipBase = 1;
        } else if (t < JERK + PULL) {
          const e = smooth((t - JERK) / PULL), amp = 0.2 * (1 - e);
          this.lure.lerpVectors(this.rel0, this.S, e);
          this.lure.x += Math.sin(t * 19) * amp; this.lure.z += Math.cos(t * 23) * amp;
          this.bobber.lerpVectors(this.bob0, this.tmp.lerpVectors(env.tip, this.S, 0.35), e * 0.8);
          this.school.setLure(this.lure);
        } else if (t < JERK + PULL + OUT) {
          const e = smooth((t - JERK - PULL) / OUT);
          this.lure.lerpVectors(this.S, this.H, e); this.lure.y += 0.8 * K * Math.sin(Math.PI * e) * (1 - e * 0.4);
          this.lure.x += Math.sin(t * 17) * 0.05 * (1 - e);
          this.bobber.lerpVectors(this.tmp.lerpVectors(env.tip, this.S, 0.35), this.tmp2.lerpVectors(env.tip, this.H, 0.3), e);
        } else { this.enter('celebrate'); }
        if (this.phase === 'reeling') {
          if (t >= JERK + PULL && !this.surfaced) { this.surfaced = true; this.emit('surface', this.S); }
          this.school.setLure(this.lure);
        }
        break;
      }

      case 'celebrate': {
        curiosity = 1; this.tensionT = 0.45; this.fishVisible = true;
        env.bucket(this.H); const bucketTop = this.tmp2.copy(this.H); bucketTop.y += 0.05 * K; this.H.y += 0.85 * K;
        const t = this.t;
        if (t < HOLD) {
          this.lure.copy(this.H); this.lure.y += Math.sin(t * 11) * 0.03; this.lure.x += Math.sin(t * 15) * 0.02;
          this.bobber.lerpVectors(env.tip, this.H, 0.3);
          this.school.setLure(this.lure);
        } else if (t < HOLD + DROP) {
          const e = (t - HOLD) / DROP;
          this.lure.lerpVectors(this.H, bucketTop, e * e);
          this.bobber.lerpVectors(env.tip, this.H, 0.3);
          this.school.setLure(this.lure);
        } else {
          this.emit('drop', bucketTop);
          this.school.land(true); this.school.setLure(null); this.school.setCuriosity(0);
          this.caught++; this.emit('catch', bucketTop);
          this.fishVisible = false; this.inWater = false; this.surfaced = false;
          this.enter('idle'); this.autoT = rand(1.4, 2.6); this.hangLure();
        }
        break;
      }

      case 'retrieving': {
        const e = smooth(this.t / RETRIEVE);
        this.tensionT = 0.35;
        const tip = env.tip;
        const hb = this.tmp.set(tip.x, tip.y - 0.55 * K, tip.z), hl = this.tmp2.set(tip.x, tip.y - 0.95 * K, tip.z);
        this.bobber.lerpVectors(this.bob0, hb, e); this.lure.lerpVectors(this.rel0, hl, e); this.lure.y += Math.sin(Math.PI * e) * 0.4;
        this.inWater = this.lure.y < env.heightAt(this.lure.x, this.lure.z);
        if (this.t >= RETRIEVE) {
          this.inWater = false;
          const q = this.queued; this.queued = null;
          if (q) this.startCast(q); else { this.enter('idle'); this.autoT = rand(1, 2); }
        }
        break;
      }
    }

    // smoothed visual channels
    this.tension = damp(this.tension, this.tensionT, 10, dt);
    this.dip = damp(this.dip, this.dipBase, 16, dt);
    this.nibbleV *= Math.exp(-5 * dt);
    this.dip = Math.max(this.dip, this.nibbleV);

    if (['scared', 'calm', 'curious', 'approaching', 'bite', 'missed'].includes(this.phase)) this.school.setLure(this.lure);
    this.school.setCuriosity(curiosity);
  }

  private surfaced = false;

  /** Bobber floats at the surface at the cast target, the lure hangs `lureDepth` below it. */
  private waterPose(dt: number) {
    this.sinkT += dt;
    const x = this.target.x, z = this.target.z, env = this.env;
    const h = env.heightAt(x, z);
    const room = Math.max(0.5, h - env.seabedAt(x, z) - 0.35);
    const depth = Math.min(settings.lureDepth, room) * (1 - Math.pow(1 - clamp(this.sinkT / 1.0, 0, 1), 2));
    const dipY = this.dip * 0.26;
    this.bobber.set(x, h + Math.sin(this.clock * 2.3) * 0.012 - dipY, z);
    this.lure.set(x + Math.sin(this.clock * 0.9) * 0.05, h - depth + Math.sin(this.clock * 1.7) * 0.02 - dipY * 0.5, z + Math.cos(this.clock * 0.8) * 0.05);
    this.inWater = true;
    this.surfaced = false;
  }

  private pickSpot(): Vector3 | null {
    const lim = WORLD.half - 0.9, c = this.school.stats.centroid;
    for (let i = 0; i < 40; i++) {
      let x = rand(-lim, lim), z = rand(-lim, lim);
      if (this.school.count > 0 && Number.isFinite(c.x) && (c.x !== 0 || c.z !== 0) && Math.random() < 0.6) { x = c.x + rand(-2.5, 2.5); z = c.z + rand(-2.5, 2.5); }
      if (this.validSpot(x, z, 2)) return new Vector3(x, this.env.heightAt(x, z), z);
    }
    return null;
  }

  /** Reset the counter (Tweakpane). */
  reset() { this.caught = 0; }
}
