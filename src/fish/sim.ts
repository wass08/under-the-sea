/* eslint-disable @typescript-eslint/no-explicit-any */
import { StorageBufferAttribute, Vector3, Vector4 } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import * as TSL from 'three/tsl';
const { atan, acos,
  Fn, If, Loop, atomicAdd, atomicMin, atomicStore, clamp, cos, cross, dot, exp, float, floor, hash, instanceIndex, instancedArray, length, max, min,
  mix, normalize, select, sign, sin, smoothstep, sqrt, step, storage, uint, uniform, vec3, vec4, abs, fract, int,
} = TSL as any;
import { SWIM_BOUNDS, WORLD } from '../config';
import { waterLevel } from '../state';

/** Uniform grid over the water volume (cell = largest neighbour radius). */
const CELL = 1.2, GMIN_Y = WORLD.bed - 0.5;
export const GRID = { cell: CELL, min: [-WORLD.half, GMIN_Y, -WORLD.half], x: Math.ceil(2 * WORLD.half / CELL), y: Math.ceil((WORLD.surface + 1 - GMIN_Y) / CELL), z: Math.ceil(2 * WORLD.half / CELL), slots: 96 } as const;
const CELLS = GRID.x * GRID.y * GRID.z;

/** Uniforms shared by every school (behaviours, lure, predator, panic waves...). */
/** Upper bound for the live number of sub-schools (School → Roaming → Schools). */
export const MAX_SCHOOLS = 6;

export function createEnv() {
  const u = uniform;
  const env = {
    dt: u(0.016), clock: u(0), frame: u(0),
    // boids
    // swim area: half-size (x/z) of the square the fish may use, centred on the scene (live; ≤ WORLD.half − 0.6)
    swimHalf: u(WORLD.half - 0.6),
    // calm heading-turn limit (rad/s); frightened fish add up to +5.5 rad/s for escapes
    turnRate: u(0.7),
    // 3D school: cohesion on Y relative to XZ (low = the school keeps thickness), calm pitch limit (rad), per-fish
    // preferred depth offset (units, ±), per-fish cruise-speed variation (±fraction)
    cohY: u(0.3), pitchLimit: u(20 * Math.PI / 180), depthJitter: u(0.5), speedVar: u(0.3),
    // vertical wave travelling along each school (the sheet undulates: neighbours tilt up and down together)
    undulation: u(0.6), wander: u(0.12), flow: u(0.35), lateralWave: u(0.5), headingW: u(3), edgeW: u(3), slotAlong: u(0.45), tubeW: u(0.45), tubeH: u(0.6), bend: u(1), ballShape: u(0),
    speed: u(0.8), sepW: u(3.2), aliW: u(1.8), cohW: u(0.45), sepR: u(0.85), sepSoftening: u(0.08), neighR: u(1.2), scanCap: u(10, 'int'),
    // milling
    millBlend: u(0), millStrength: u(1), millRadius: u(12.5), millHeight: u(2.5), millDir: u(1), millCenter: u(new Vector3(0, 6.4, 0)), attractors: Array.from({ length: MAX_SCHOOLS }, () => u(new Vector3(0, 4, 0))), attractDirs: Array.from({ length: MAX_SCHOOLS }, () => u(new Vector3(1, 0, 0))), schools: u(3), attractW: u(1), schoolAxes: u(new Vector3(9.5, 3.8, 1.9)), axesScale: u(1), peel: u(0.02),
    // predator / fountain
    predPos: u(new Vector3(0, -50, 0)), predVel: u(new Vector3(1, 0, 0)), predActive: u(0), fearRadius: u(4.5), fountain: u(1), lureVel: u(new Vector3(1, 0, 0)), lureThreat: u(0),
    // Calm diver clearance (free-swimming main school only).
    camPos: u(new Vector3(0, 100, 0)), camBubble: u(3.0),
    // panic
    panicOrigin: [0, 1, 2, 3].map(() => u(new Vector4(0, 0, 0, -1000))),
    panicStrength: u(new Vector4(0, 0, 0, 0)),
    panicSpeed: u(16.5), burst: u(13), calm: u(1.6), transmission: u(1),
    // lure
    lurePos: u(new Vector3(0, 5, 0)), lureActive: u(0), curiosity: u(0), curiosityRadius: u(5), inspectors: u(100), hooked: u(0),
    strike: u(0), land: u(0), respawn: u(10),
    // airborne (flying fish): ambient launch rate (fraction of 3×3 surface columns active per 7 s window), panic launches
    // per second at full fear, the fraction of fish that fly at all, exit speed, glide lift and gravity (world units)
    airRate: u(0.076), airPanic: u(0.6), airFlyers: u(0.3),
    airSpeed: u(5.0), airLift: u(0.075), airGravity: u(3.4),
    // misc
    seabedRes: 64,
  };
  return env;
}
export type Env = ReturnType<typeof createEnv>;

export interface SimOptions {
  renderer: WebGPURenderer;
  env: Env;
  count: number;
  seabed: { heights: Float32Array; resolution: number };
  /** Species parameters. */
  cruise: number; minSpeed: number; maxSpeed: number;
  millInfluence: number; lureInfluence: number; fearSensitivity: number;
  /** Prefer to hover this far above the terrain (0 = off) and gravitate toward homeXZ. */
  homeClear: number; homeStrength: number; homeXZ: [number, number]; homeRadius: number;
  /** Initial clusters. */
  clusters: number; clusterRadius: number;
  /** Optional explicit cluster centres (fish i starts in cluster i % centres.length). */
  groupCenters?: [number, number, number][];
  /** Initial swimming direction (xz) per group, aligned with groupCenters: fish start as formed, moving schools. */
  groupDirs?: [number, number][];
  /** Begin in a tangentially swimming torus, so the hero composition is readable immediately. */
  initialRing?: boolean;
  /** Scatter across navigable open water instead of spawning in a dense cluster. */
  initialSpread?: boolean;
  seed: number;
  /** Main school only: strike / stats machinery. */
  main: boolean;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const fishRand = (index: any, seed: number, k: number) => hash(index.toFloat().add(k * 977.0 + seed * 131.0));

export function sampleHeight(s: { heights: Float32Array; resolution: number }, x: number, z: number) {
  const r = s.resolution, u = (x + WORLD.half) / (2 * WORLD.half) * r - 0.5, w = (z + WORLD.half) / (2 * WORLD.half) * r - 0.5;
  const ix = Math.floor(u), iz = Math.floor(w), fx = u - ix, fz = w - iz;
  const g = (a: number, b: number) => s.heights[Math.min(r - 1, Math.max(0, b)) * r + Math.min(r - 1, Math.max(0, a))];
  return (g(ix, iz) * (1 - fx) + g(ix + 1, iz) * fx) * (1 - fz) + (g(ix, iz + 1) * (1 - fx) + g(ix + 1, iz + 1) * fx) * fz;
}

export const STATS_SLOTS = 16; // 0 near, 1..3 centroid sums, 4 fear sum, 5 alive count, 6 biter state, 7 biter dist*1000, 8 strike selection key, 9 splash counter (never cleared)
/** Splash ring buffer: SPLASH_SLOTS × vec4(x, z, env.clock at the splash, strength: >0 re-entry, <0 launch). */
export const SPLASH_SLOTS = 48;
const SPLASH_COUNTER = 9;
/**
 * aux.w state encoding: 0 free swimming, 1 darting at the lure, 2 hooked, >2.5 hidden (3 + respawn countdown),
 * and AIRBORNE as negative values: −1 − (seconds since launch), minus a further FLOWN (500) once the fish has broken
 * the surface, and DIVE (1000) for the short dive after re-entry. Airborne fish rise to break the surface, then fly a ballistic arc with a little lift; they are not
 * inserted in the neighbour grid and cannot be picked for a bite. Every transition is continuous: the run-up steers the
 * velocity toward the exit vector, the breach only blends it, and re-entry keeps position and direction (water drag
 * and the normal swim steering then slow and level the fish), so the body orientation never jumps.
 */
const isFree = (w: any) => w.greaterThan(-0.5).and(w.lessThan(0.5));
const FLOWN = 500, DIVE = 1000;
/** Wing spread for height h above the water and time t (s) since breaking the surface: opens over ~0.3 s, folds as it touches down. */
const spreadAt = (h: any, t: any) => smoothstep(-0.05, 0.35, h).mul(smoothstep(0.0, 0.3, t));
// Positions are packed as unsigned (x + OFFSET) · SCALE: OFFSET must exceed WORLD.half or far fish wrap around.
export const CENTROID_SCALE = 128, CENTROID_OFFSET = 48, FEAR_SCALE = 1024;

export function createSim(o: SimOptions) {
  const { renderer, env, seabed } = o, N = o.count;
  const half = WORLD.half, res = seabed.resolution;

  // ---------- buffers ----------
  // WebGPU allows 8 storage buffers per stage: pos, vel, aux (flash, bank, turn, state), snap (2 vec4 per fish), grid, heights, stats, steering = 8
  const pos = instancedArray(N, 'vec4'), vel = instancedArray(N, 'vec4'), aux = instancedArray(N, 'vec4');
  const steering = instancedArray(N, 'vec4'); // persistent acceleration: suppress neighbour-sampling jitter
  const snap = instancedArray(N * 2, 'vec4');
  const S1 = GRID.slots + 1; // per cell: [count, slot0 .. slotK-1]
  const gridAttr = new StorageBufferAttribute(new Uint32Array(CELLS * S1), 1);
  const gridAtomic = storage(gridAttr, 'uint', CELLS * S1).toAtomic(), gridRead = storage(gridAttr, 'uint', CELLS * S1).toReadOnly();
  const heightBuf = instancedArray(seabed.heights, 'float');
  const statsAttr = new StorageBufferAttribute(new Uint32Array(STATS_SLOTS), 1);
  const statsAtomic = storage(statsAttr, 'uint', STATS_SLOTS).toAtomic(), statsWrite = storage(statsAttr, 'uint', STATS_SLOTS);
  // Splash slots, written by a small pass after the simulation (the simulate pass already binds 8 storage buffers).
  const splashAttr = new StorageBufferAttribute(new Float32Array(SPLASH_SLOTS * 4).fill(-1000), 4);
  const splashWrite = storage(splashAttr, 'vec4', SPLASH_SLOTS);

  // ---------- CPU init: a few loose clusters ----------
  {
    const rng = mulberry(o.seed), P = pos.value.array as Float32Array, V = vel.value.array as Float32Array, A = aux.value.array as Float32Array;
    const centers: [number, number, number][] = [];
    while (centers.length < o.clusters) {
      const x = (rng() * 2 - 1) * (half - 2.2), z = (rng() * 2 - 1) * (half - 2.2), h = sampleHeight(seabed, x, z);
      if (h > WORLD.surface - 2.2) continue;
      const y = h + 1.3 + rng() * Math.max(0.5, WORLD.surface - 1.2 - (h + 1.3));
      centers.push([x, Math.min(y, WORLD.surface - 1.0), z]);
    }
    for (let i = 0; i < N; i++) {
      const c = o.groupCenters ? o.groupCenters[i % o.groupCenters.length] : centers[Math.floor(rng() * centers.length)], gauss = () => (rng() + rng() + rng() - 1.5) * 1.15;
      let x = c[0] + gauss() * o.clusterRadius, z = c[2] + gauss() * o.clusterRadius, y = c[1] + gauss() * o.clusterRadius * 0.55;
      const ringAngle = rng() * Math.PI * 2;
      if (o.initialRing) {
        const radius = env.millRadius.value * (.93 + rng() * .14);
        x = env.millCenter.value.x + Math.cos(ringAngle) * radius;
        z = env.millCenter.value.z + Math.sin(ringAngle) * radius;
        y = env.millCenter.value.y + (rng() - .5) * env.millHeight.value - (x - env.millCenter.value.x + z - env.millCenter.value.z) * .16;
      }
      if (o.initialSpread) {
        let ground: number;
        do {
          // Start around the basin (the swim area is larger than where the schools usually are), not as a carpet
          // across the whole sea: the roaming attractors then spread the groups out.
          const start = Math.min(half - 1.5, 16.5);
          x = (rng() * 2 - 1) * start; z = (rng() * 2 - 1) * start;
          ground = sampleHeight(seabed, x, z);
        } while (ground > WORLD.surface - 2.4);
        y = ground + 0.75 + rng() * (WORLD.surface - 0.9 - ground - 0.75);
      }
      x = Math.max(SWIM_BOUNDS.min[0] + 0.3, Math.min(SWIM_BOUNDS.max[0] - 0.3, x)); z = Math.max(SWIM_BOUNDS.min[2] + 0.3, Math.min(SWIM_BOUNDS.max[2] - 0.3, z));
      const h = sampleHeight(seabed, x, z); y = Math.max(h + 0.5, Math.min(SWIM_BOUNDS.max[1] - 0.4, y));
      if (h > WORLD.surface - 1.5) { x = c[0]; z = c[2]; y = c[1]; }
      const gd = o.groupDirs?.[i % o.groupDirs.length];
      const th = o.initialRing ? ringAngle + Math.PI / 2 : gd ? Math.atan2(gd[1], gd[0]) + (rng() - 0.5) * 0.5 : rng() * Math.PI * 2, sp = o.cruise * (0.8 + 0.4 * rng());
      P.set([x, y, z, rng()], i * 4); V.set([Math.cos(th) * sp, (rng() - 0.5) * 0.3, Math.sin(th) * sp, 0], i * 4);
      A.set([0, 0, 0, 0], i * 4);
    }
  }

  // ---------- helpers ----------
  const iF = instanceIndex.toFloat();
  const rnd = (k: number) => hash(iF.add(k * 977.0 + o.seed * 131.0));
  const randDir = (k: number) => {
    const th = rnd(k).mul(6.2831853), zz = rnd(k + 1).mul(2).sub(1), r = sqrt(max(float(0), float(1).sub(zz.mul(zz))));
    return vec3(cos(th).mul(r), zz, sin(th).mul(r));
  };
  const terrainH = Fn(([x, z]: [any, any]) => {
    const u = x.add(half).div(2 * half).mul(res).sub(0.5), w = z.add(half).div(2 * half).mul(res).sub(0.5);
    const ix = floor(u), iz = floor(w), fx = u.sub(ix), fz = w.sub(iz);
    const x0 = clamp(ix, 0, res - 1).toInt(), x1 = clamp(ix.add(1), 0, res - 1).toInt(), z0 = clamp(iz, 0, res - 1).toInt(), z1 = clamp(iz.add(1), 0, res - 1).toInt();
    const h = (a: any, b: any) => heightBuf.element(b.mul(res).add(a));
    return mix(mix(h(x0, z0), h(x1, z0), fx), mix(h(x0, z1), h(x1, z1), fx), fz);
  });
  const terrainNormal = Fn(([x, z]: [any, any]) => {
    const e = float(0.35);
    const gx = terrainH(x.add(e), z).sub(terrainH(x.sub(e), z)).div(e.mul(2)), gz = terrainH(x, z.add(e)).sub(terrainH(x, z.sub(e))).div(e.mul(2));
    return normalize(vec3(gx.negate(), 1, gz.negate()));
  });
  const cellOf = (p: any) => {
    const cx = clamp(floor(p.x.sub(GRID.min[0]).div(GRID.cell)), 0, GRID.x - 1), cy = clamp(floor(p.y.sub(GRID.min[1]).div(GRID.cell)), 0, GRID.y - 1), cz = clamp(floor(p.z.sub(GRID.min[2]).div(GRID.cell)), 0, GRID.z - 1);
    return { cx: cx.toInt(), cy: cy.toInt(), cz: cz.toInt() };
  };

  // ---------- passes ----------
  const clearGrid = Fn(() => { atomicStore(gridAtomic.element(instanceIndex.mul(S1)), uint(0)); })().compute(CELLS).setName('fishClearGrid');

  const insert = Fn(() => {
    const i = instanceIndex, p = pos.element(i), a = aux.element(i);
    snap.element(i.mul(2)).assign(vec4(p.xyz, a.w));
    snap.element(i.mul(2).add(1)).assign(vel.element(i));
    If(isFree(a.w), () => {
      const { cx, cy, cz } = cellOf(p.xyz);
      const c = cz.mul(GRID.y).add(cy).mul(GRID.x).add(cx).toUint();
      const n = atomicAdd(gridAtomic.element(c.mul(S1)), uint(1));
      If(n.lessThan(uint(GRID.slots)), () => { atomicStore(gridAtomic.element(c.mul(S1).add(n).add(1)), i); });
    });
  })().compute(N).setName('fishInsert');

  const dt = env.dt, clock = env.clock;

  const simulate = Fn(() => {
    const i = instanceIndex;
    const p4 = pos.element(i), v4 = vel.element(i), ax = aux.element(i);
    const P = p4.xyz.toVar(), V = v4.xyz.toVar(), fear = v4.w.toVar(), phase = p4.w.toVar();
    // Per-fish randoms are explicit shader variables: a plain node is emitted where it is first used, and a branch that
    // used it first (spawn, airborne) left every other branch reading 0 (all fish shared one slot, wander and speed phase).
    const flash = ax.x.toVar(), state = ax.w.toVar(), trait = rnd(11).toVar();
    const bank = ax.y.toVar(), turnS = ax.z.toVar();
    const rA = rnd(1).toVar(), rB = rnd(2).toVar(), rC = rnd(3).toVar();
    const phaseRate = float(0).toVar(); // cycles per second, set by each branch
    const Vold = V.toVar();
    const alive = float(1).toVar();

    // --- strike selection commit (main school only: other species never run the selection pass)
    if (o.main) If(env.strike.greaterThan(0.5).and(isFree(state)), () => {
      const key = statsWrite.element(8);
      If(key.notEqual(uint(0xffffffff)).and(key.bitAnd(uint(0x3ffff)).equal(i)), () => { state.assign(1); });
    });

    If(state.greaterThan(2.5), () => {
      // ------------------------------------------------ hidden (caught): countdown, then respawn from the edge
      alive.assign(0);
      const t = state.sub(3).sub(dt);
      If(t.lessThanEqual(0), () => {
        const side = floor(rA.mul(4)), along = rB.mul(2).sub(1).mul(env.swimHalf.sub(0.6)), edge = env.swimHalf.sub(0.1);
        const px = select(side.lessThan(1), edge.negate(), select(side.lessThan(2), edge, along));
        const pz = select(side.lessThan(1), along, select(side.lessThan(2), along, select(side.lessThan(3), edge.negate(), edge)));
        const h = terrainH(px, pz);
        const py = max(h.add(0.6), float(SWIM_BOUNDS.min[1] + 0.4).add(rC.mul(waterLevel.sub(2.4).sub(SWIM_BOUNDS.min[1] + 0.4))));
        P.assign(vec3(px, min(py, waterLevel.sub(0.6)), pz));
        V.assign(normalize(vec3(env.millCenter.x.sub(px), 0, env.millCenter.z.sub(pz))).mul(o.cruise));
        state.assign(0); fear.assign(0); flash.assign(0.3); alive.assign(1);
      }).Else(() => { state.assign(t.add(3)); });
    }).ElseIf(state.greaterThan(1.5), () => {
      // ------------------------------------------------ hooked: pinned to the lure, thrashing
      const w = clock.mul(4.8).add(rA.mul(6.283));
      P.assign(env.lurePos); // attachment point; rendering offsets the animated mouth, not the body centre
      V.assign(normalize(vec3(cos(rA.mul(6.283)).add(sin(w).mul(0.2)), sin(w.mul(0.7)).mul(0.18), sin(rA.mul(6.283)).add(cos(w).mul(0.2)))).mul(2));
      bank.assign(sin(w).mul(0.18));
      fear.assign(1); flash.assign(0);
      phaseRate.assign(4.5);
      statsWrite.element(6).assign(uint(2)); statsWrite.element(7).assign(uint(0));
      If(env.land.greaterThan(1.5), () => {
        state.assign(0); fear.assign(1); V.assign(randDir(9).mul(env.burst)); flash.assign(1);
        statsWrite.element(6).assign(uint(0));
      }).ElseIf(env.land.greaterThan(0.5), () => {
        state.assign(env.respawn.add(3)); statsWrite.element(6).assign(uint(0));
      });
    }).ElseIf(state.greaterThan(0.5), () => {
      // ------------------------------------------------ darting at the lure
      const toL = env.lurePos.sub(P), d = length(toL);
      V.assign(mix(V, toL.div(max(d, 0.001)).mul(8.0), clamp(dt.mul(12), 0, 1)));
      P.addAssign(V.mul(dt));
      phaseRate.assign(7); flash.assign(max(flash.mul(0.95), 0.25));
      statsWrite.element(6).assign(uint(1)); statsWrite.element(7).assign(uint(clamp(d.mul(1000), 0, 60000)));
      If(d.lessThan(0.2), () => { state.assign(2); });
      If(env.lureActive.lessThan(0.5).or(env.land.greaterThan(0.5)), () => { state.assign(0); fear.assign(0.6); statsWrite.element(6).assign(uint(0)); });
    }).ElseIf(state.lessThan(-0.5), () => {
      // ------------------------------------------------ airborne (flying fish)
      const flown = state.lessThan(-FLOWN + 0.5).toFloat().toVar();
      const diving = state.lessThan(-DIVE + 0.5).toFloat().toVar();
      const airT = state.negate().sub(1).mod(FLOWN).add(dt).toVar();
      const h = P.y.sub(waterLevel);
      const Vh = vec3(V.x, 0, V.z).toVar(), vh = length(Vh);
      const heading = normalize(Vh.add(vec3(0.0001, 0, 0)));
      const climb = rB.mul(0.26).add(0.26), exitSpeed = env.airSpeed.mul(rC.mul(0.3).add(0.85));
      const exitV = heading.mul(cos(climb).mul(exitSpeed)).add(vec3(0, sin(climb).mul(exitSpeed), 0));
      If(flown.lessThan(0.5), () => {
        If(h.lessThan(0), () => {
          // Run-up: steer smoothly toward a slightly steeper exit vector while the tail beats hard (no velocity snap).
          const runV = heading.mul(cos(climb.add(0.18)).mul(exitSpeed)).add(vec3(0, sin(climb.add(0.18)).mul(exitSpeed), 0));
          V.assign(mix(V, runV, clamp(dt.mul(2.4), 0, 1)));
          phaseRate.assign(11);
          If(airT.greaterThan(2.2), () => { state.assign(0); }); // never broke the surface: give up and swim on
        }).Else(() => {
          // Breaking the surface: blend toward the exit vector (the run-up already points close to it).
          V.assign(mix(V, exitV, 0.5));
          flown.assign(1); airT.assign(0);
        });
      }).ElseIf(diving.greaterThan(0.5), () => {
        // Dive after re-entry (~0.7 s): water drag eases the speed toward cruising, the nose curves back to level along a
        // swoop, and the tail beat ramps up from the still glide. Then the fish rejoins normal schooling.
        const sp = length(V).max(0.001), dir = V.div(sp).toVar(), cruiseSp = env.speed.mul(o.cruise);
        dir.y.assign(mix(dir.y, float(0), float(1).sub(exp(dt.mul(-2.4)))));
        V.assign(normalize(dir).mul(mix(sp, cruiseSp, float(1).sub(exp(dt.mul(-2.6))))));
        phaseRate.assign(mix(float(0), float(0.9).add(sp.mul(0.85)), smoothstep(0.0, 0.5, airT)));
      }).Else(() => {
        // In the air: gravity, lift from the spread wings (∝ horizontal speed²), mild drag. Taxiing beats right after
        // the breach while the tail is still near the water.
        const spread = spreadAt(h, airT);
        V.y.addAssign(env.airLift.mul(vh.mul(vh)).mul(spread).sub(env.airGravity).mul(dt));
        Vh.mulAssign(exp(dt.mul(-0.22)));
        // A slight, slow heading drift so flights are not ruler-straight.
        const drift = sin(clock.mul(0.9).add(rA.mul(40))).mul(0.12).mul(dt);
        Vh.assign(vec3(Vh.x.mul(cos(drift)).sub(Vh.z.mul(sin(drift))), 0, Vh.x.mul(sin(drift)).add(Vh.z.mul(cos(drift)))));
        V.x.assign(Vh.x); V.z.assign(Vh.z);
        // Long glides eventually lose it.
        If(airT.greaterThan(3.0), () => { V.y.subAssign(dt.mul(6)); });
        phaseRate.assign(select(h.lessThan(0.25).and(airT.lessThan(0.5)), float(9), float(0)));
      });
      P.addAssign(V.mul(dt));
      // Walls: the launch already aims inside the box; this is the safety net.
      P.x.assign(clamp(P.x, env.swimHalf.negate(), env.swimHalf)); P.z.assign(clamp(P.z, env.swimHalf.negate(), env.swimHalf));
      bank.assign(sin(clock.mul(2.1).add(rA.mul(6.28))).mul(0.08));
      fear.assign(max(fear.sub(env.calm.mul(dt)), 0)); flash.assign(flash.mul(exp(dt.mul(-6))));
      If(state.lessThan(-0.5), () => {
        If(diving.greaterThan(0.5).and(airT.greaterThan(0.7)), () => {
          // Dive done: back to schooling, with the steering filter reset so it eases in from zero (no old steer).
          state.assign(0); steering.element(i).assign(vec4(0));
        }).ElseIf(diving.lessThan(0.5).and(flown.greaterThan(0.5)).and(P.y.lessThan(waterLevel)).and(V.y.lessThan(0)), () => {
          // Re-entry: slice in where it is, keep the heading, shed a little speed on impact, start the dive clock.
          V.mulAssign(0.85);
          flash.assign(max(flash, 0.2)); fear.assign(max(fear, 0.2)); state.assign(-(1 + DIVE));
        }).Else(() => { state.assign(airT.add(1).add(diving.mul(DIVE).max(flown.mul(FLOWN))).negate()); });
      });
      alive.assign(1);
    }).Else(() => {
      // ================================================ free swimming
      const spd = env.speed;
      const speed = length(V).toVar();
      const dirV = V.div(max(speed, 0.001));

      // --- neighbours
      const cs = cellOf(P);
      const sep = vec3(0).toVar(), aliSum = vec3(0).toVar(), cohSum = vec3(0).toVar(), cnt = float(0).toVar();
      const fearN = float(0).toVar(), fearDir = vec3(0).toVar(), sepCount = float(0).toVar();
      const sepR = env.sepR, nR = env.neighR, nR2 = nR.mul(nR);
      const scan = (dx: any, dy: any, dz: any) => {
        const nx = cs.cx.add(dx), ny = cs.cy.add(dy), nz = cs.cz.add(dz);
        If(nx.greaterThanEqual(0).and(nx.lessThan(GRID.x)).and(ny.greaterThanEqual(0)).and(ny.lessThan(GRID.y)).and(nz.greaterThanEqual(0)).and(nz.lessThan(GRID.z)), () => {
          const c = nz.mul(GRID.y).add(ny).mul(GRID.x).add(nx);
          const population = gridRead.element(c.mul(S1));
          const n = min(population, uint(GRID.slots)).toInt();
          If(n.greaterThan(0), () => {
            const take = min(n, env.scanCap);
            const start = hash(iF.add(c.toFloat().mul(3.1))).mul(n.toFloat()).toInt();
            const wScale = population.toFloat().div(take.toFloat());
            Loop({ start: 0, end: take, type: 'int', name: 's', condition: '<' }, ({ s }: any) => {
              const j = gridRead.element(c.mul(S1).add(start.add(s).mod(n)).add(1));
              If(j.notEqual(i), () => {
                const pj = snap.element(j.mul(2)), d3 = P.sub(pj.xyz), d2 = dot(d3, d3);
                If(d2.lessThan(nR2).and(d2.greaterThan(1e-6)), () => {
                  const vj = snap.element(j.mul(2).add(1)), d = sqrt(d2);
                  aliSum.addAssign(vj.xyz.mul(wScale)); cohSum.addAssign(pj.xyz.mul(wScale)); cnt.addAssign(wScale);
                  const k = clamp(float(1).sub(d.div(sepR)), 0, 1);
                  sepCount.addAssign(step(d, sepR).mul(wScale));
                  sep.addAssign(d3.div(max(d2, env.sepSoftening.mul(env.sepSoftening))).mul(k.mul(k)).mul(wScale));
                  If(vj.w.greaterThan(fearN), () => { fearN.assign(vj.w); });
                  fearDir.addAssign(d3.div(d).mul(vj.w.mul(vj.w)));
                });
              });
            });
          });
        });
      };
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) scan(int(dx), int(dy), int(dz));

      const acc = vec3(0).toVar();
      const inv = float(1).div(max(cnt, 1));
      const hasN = step(0.5, cnt);
      const millW = env.millBlend.mul(o.millInfluence);
      const boidScale = float(1).sub(millW.mul(0.5));
      acc.addAssign(sep.div(max(sepCount, 1)).mul(env.sepW).mul(12).mul(cnt.div(12).sqrt().clamp(1, 3)));
      acc.addAssign(aliSum.mul(inv).sub(V).mul(hasN).mul(env.aliW).mul(3.0).mul(boidScale));
      // Cohesion is weaker vertically (cohY) so fish don't collapse into one plane; milling keeps full 3D cohesion.
      const cohVec = cohSum.mul(inv).sub(P), cohYW = mix(env.cohY, float(1), millW);
      acc.addAssign(vec3(cohVec.x, cohVec.y.mul(cohYW), cohVec.z).mul(hasN).mul(env.cohW).mul(3.2).mul(boidScale));

      // --- wander
      const tt = clock.mul(0.8);
      acc.addAssign(vec3(sin(tt.add(rA.mul(50))), sin(tt.mul(1.3).add(rB.mul(50))).mul(0.6), sin(tt.mul(0.9).add(rC.mul(50)))).mul(env.wander));

      // --- cruise speed relaxation (per-fish cruise variation)
      // speed varies per fish, over time, and as a wave travelling through the school
      const speedWave = sin(P.x.mul(0.3).add(P.z.mul(0.4)).sub(clock.mul(0.55))).mul(0.16).add(sin(clock.mul(0.25).add(rA.mul(40))).mul(0.10));
      const cruise = spd.mul(o.cruise).mul(float(1).add(rB.mul(2).sub(1).mul(env.speedVar)).add(speedWave));
      acc.addAssign(dirV.mul(cruise.sub(speed)).mul(1.6));

      // --- species home (angelfish: hover low over the terrain, stay near the island)
      if (o.homeStrength > 0) {
        const ht = terrainH(P.x, P.z).add(o.homeClear);
        acc.y.addAssign(ht.sub(P.y).mul(o.homeStrength));
        const dxz = vec3(o.homeXZ[0], 0, o.homeXZ[1]).sub(vec3(P.x, 0, P.z)), dl = length(dxz);
        acc.addAssign(dxz.div(max(dl, 0.01)).mul(smoothstep(o.homeRadius, o.homeRadius + 2.5, dl)).mul(2.5));
      }

      // --- large-scale flow: follow the wandering attractor loosely + coherent flow field (density waves, curling edges)
      if (o.main) {
        // N sub-schools (env.schools, live; fish i belongs to group i % N). Each is confined softly to an elongated ellipsoid that travels along its path,
        // so density fills the volume evenly (separation spreads fish out) instead of collapsing on a point.
        const groups = env.schools.max(1), grp0 = instanceIndex.toFloat().mod(groups);
        // peelers: a changing fraction of each group follows the next group's attractor (sub-groups split off and rejoin)
        const grp = grp0.add(step(rnd(41), env.peel)).mod(groups);
        const strag = step(rnd(43), 0.002); // very occasional outliers
        const sel = (list: any[]) => list.slice(0, -1).reduceRight((acc: any, v: any, k: number) => select(grp.lessThan(k + 0.5), v, acc), list[list.length - 1]);
        // attractDirs: xz = the school's travel heading, y = the route's signed curvature (1/u; > 0 bends towards `side`).
        const myAtt = sel(env.attractors), myDirK = sel(env.attractDirs), myDir = vec3(myDirK.x, 0, myDirK.z), kappa = myDirK.y.mul(env.bend);
        const rel = P.sub(myAtt), side = vec3(myDir.z.negate(), 0, myDir.x);
        const ax3 = env.schoolAxes.mul(env.axesScale);
        const e = length(vec3(dot(rel, myDir).div(ax3.x), dot(rel, side).div(ax3.y), rel.y.div(ax3.z)));
        // Each fish holds a slot in its school (this, more than separation/cohesion, sets the spacing). Slots drift slowly
        // back and forth along the school (triangle wave, uniform) and are packed towards the middle, so the head and the
        // longer tail thin out; the cross-section narrows towards both ends (a torpedo, not a ball or a box).
        const tri = abs(fract(clock.mul(0.0088).add(rA)).sub(0.5)).mul(4).sub(1);
        const sN = tri.mul(tri.mul(tri).mul(0.3).add(0.7));
        const along = sN.mul(ax3.x).mul(select(sN.lessThan(0), float(0.85), float(0.6))).mul(float(1).sub(env.ballShape.mul(0.6))).toVar();
        const taper = sqrt(max(float(0), float(1).sub(sN.mul(sN)))).mul(0.5).add(0.5);
        // The school bends along the route's curve (an arc), instead of a straight stick swinging round the bend.
        const lane = myAtt.add(myDir.mul(along)).add(side.mul(kappa.mul(along).mul(along).mul(0.5)))
          .add(side.mul(rB.sub(0.5).mul(ax3.y).mul(1.35).mul(taper))).add(vec3(0, rC.sub(0.5).mul(ax3.z).mul(1.4).mul(taper), 0)).toVar();
        const laneDir = normalize(myDir.add(side.mul(kappa.mul(along))));
        // Each fish also has its own preferred depth offset, so the school stays several fish deep.
        lane.y.addAssign(rnd(61).mul(2).sub(1).mul(env.depthJitter));
        lane.y.assign(min(waterLevel.sub(0.8), max(lane.y, terrainH(lane.x, lane.z).add(1.4).add(rC.mul(1.6)))));
        const freeFlow = float(1).sub(millW.mul(0.95)).mul(float(1).sub(fear));
        // Part of the slot pull has a fixed strength (the school's shape, stiffest along its length), independent of Stick to group:
        // otherwise each fish's own cruise speed decides whether it rides ahead or behind, and a loosely held school
        // bunches into a ball instead of stretching along its slots.
        const toLane = lane.sub(P);
        acc.addAssign(toLane.mul(0.22).add(laneDir.mul(dot(toLane, laneDir).mul(env.slotAlong))).mul(freeFlow));
        acc.addAssign(toLane.mul(0.32).add(laneDir.mul(cruise).sub(V).mul(env.headingW)).mul(freeFlow).mul(env.attractW));
        // Cross-section confinement: a stiff, tapered tube around the school's bent centre line (independent of Stick to
        // group). Separation sets a school's volume (fish count × spacing); with firm sides, top and bottom and a free
        // length it spreads lengthwise into a long, flat body instead of a ball, and the narrowing ends squeeze the head
        // and tail thin.
        const aP = dot(rel, myDir), sP = clamp(aP.div(ax3.x.mul(select(aP.lessThan(0), float(0.85), float(0.6)))), -1, 1);
        const tubeTaper = sqrt(max(float(0), float(1).sub(sP.mul(sP)))).mul(0.6).add(0.4);
        const dS = dot(rel, side).sub(kappa.mul(aP).mul(aP).mul(0.5)), dY = rel.y;
        // Bait ball (ballShape → 1): shorter slots and a fatter, untapered tube pull each school into a round knot.
        const ballT = mix(tubeTaper, float(1), env.ballShape), ballR = env.ballShape.mul(0.7).add(1);
        const qS = abs(dS).div(ax3.y.mul(env.tubeW).mul(ballT).mul(ballR)), qY = abs(dY).div(ax3.z.mul(env.tubeH).mul(ballT).mul(ballR));
        acc.addAssign(side.mul(sign(dS).negate().mul(smoothstep(0.75, 1.3, qS))).add(vec3(0, sign(dY).negate().mul(smoothstep(0.75, 1.3, qY)), 0))
          .mul(6).mul(freeFlow).mul(float(1).sub(strag)));
        acc.y.addAssign(sin(dot(rel, myDir).mul(0.55).sub(clock.mul(0.9)).add(grp)).mul(env.undulation).mul(freeFlow)); // vertical undulation along the school
        acc.addAssign(side.mul(sin(dot(rel, myDir).mul(0.4).sub(clock.mul(1.1)))).mul(env.lateralWave)); // lateral turning wave
        acc.addAssign(rel.div(max(length(rel), 0.01)).negate().mul(smoothstep(0.9, 1.35, e)).mul(env.edgeW).mul(env.attractW).mul(float(1).sub(millW.mul(0.9))).mul(float(1).sub(smoothstep(0.15, 0.6, fear))).mul(float(1).sub(strag.mul(0.85))));
      }
      acc.addAssign(vec3(sin(P.y.mul(0.6).add(clock.mul(0.6))).add(sin(P.z.mul(0.4).sub(clock.mul(0.4)))), sin(P.x.mul(0.45).add(clock.mul(0.5))).mul(0.4), sin(P.x.mul(0.5).sub(clock.mul(0.55))).add(sin(P.y.mul(0.3).add(clock.mul(0.3))))).mul(env.flow));

      // --- bounds (soft walls)
      const m = vec3(5.0, 2.0, 5.0), lo = vec3(env.swimHalf.negate(), SWIM_BOUNDS.min[1], env.swimHalf.negate()), hi = vec3(env.swimHalf, waterLevel.sub(0.3), env.swimHalf);
      const pen = clamp(lo.add(m).sub(P).div(m), 0, 1).sub(clamp(P.sub(hi.sub(m)).div(m), 0, 1));
      acc.addAssign(pen.mul(abs(pen)).mul(14).mul(float(1).sub(millW.mul(0.7))).add(pen.mul(abs(pen).mul(abs(pen))).mul(10)));

      // --- terrain avoidance
      const ahead = P.add(V.mul(1.0));
      const hP = terrainH(P.x, P.z), hA = terrainH(ahead.x, ahead.z);
      const clr = min(P.y.sub(hP), ahead.y.sub(hA));
      const tw = clamp(float(1.8).sub(clr).div(1.8), 0, 1);
      If(tw.greaterThan(0.001), () => { // only pay for the normal near the terrain
        const tn = terrainNormal(ahead.x, ahead.z);
        acc.addAssign(tn.mul(tw.mul(tw)).mul(38));
        V.subAssign(tn.mul(min(dot(V, tn), 0)).mul(tw).mul(clamp(dt.mul(8), 0, 1)));
      });

      // --- milling (torus)
      If(millW.greaterThan(0.001), () => {
        const C = env.millCenter, r = vec3(P.x.sub(C.x), 0, P.z.sub(C.z)), dist = max(length(r), 0.05), er = r.div(dist);
        const et = vec3(er.z.negate(), 0, er.x).mul(env.millDir);
        const R = env.millRadius.mul(rA.mul(0.14).add(0.93));
        const swirl = sin(atan(er.z, er.x).mul(2).add(clock.mul(0.7))).mul(0.3).add(sin(atan(er.z, er.x).sub(clock.mul(0.5))).mul(0.15));
        // A shallow incline exposes the hollow centre from the default camera.
        const yMid = min(waterLevel.sub(0.8), max(hP.add(1.4).add(rB.mul(1.4)), C.y.add(rB.sub(0.5).mul(env.millHeight)).add(swirl).sub(r.x.add(r.z).mul(0.16))));
        const want = et.mul(spd.mul(4.0)).add(er.mul(clamp(R.sub(dist).mul(1.6), -4, 4))).add(vec3(0, clamp(yMid.sub(P.y).mul(1.0), -1.2, 1.2), 0));
        acc.addAssign(want.sub(V).mul(3.6).mul(env.millStrength).mul(millW).mul(float(1).sub(fear)));
      });

      // --- fountain: flee any fast-moving threat (the predator, or the lure dragged quickly through the water) laterally + backward
      const fountainFrom = (tPos: any, tVel: any, active: any, fr: any, gain: any) => {
        const dP = P.sub(tPos), H = normalize(tVel), along = dot(dP, H), perp = dP.sub(H.mul(along)), pl = length(perp);
        // ellipsoidal zone: reaches further ahead of the threat, so the school opens a tunnel before it arrives
        const dEff = sqrt(pl.mul(pl).add(along.mul(select(along.greaterThan(0), float(0.5), float(1.0))).pow(2)));
        const zone = active.mul(smoothstep(fr, fr.mul(0.25), dEff)).mul(smoothstep(fr.mul(-0.6), fr.mul(0.1), along));
        const lateral = select(pl.greaterThan(0.06), perp.div(pl), cross(H, vec3(0, 1, 0)).mul(rA.sub(0.5).sign()));
        const flee = lateral.add(H.mul(-0.55)).add(vec3(0, rB.sub(0.5).mul(0.6), 0));
        acc.addAssign(flee.mul(zone).mul(env.fountain).mul(o.fearSensitivity).mul(gain).mul(float(1).add(smoothstep(fr.mul(0.7), 0, dEff).mul(2))));
        fear.assign(max(fear, zone.mul(0.55).mul(clamp(env.fountain, 0, 1)).mul(o.fearSensitivity)));
      };
      fountainFrom(env.predPos, env.predVel, env.predActive, env.fearRadius, float(75));
      if (o.main) fountainFrom(env.lurePos, env.lureVel, env.lureThreat, float(2.6), float(60));

      // --- calm diver bubble: airborne fish bypass this free-swimming branch entirely.
      const bubble = float(0).toVar();
      if (o.main) {
        const dC = P.sub(env.camPos), dc = length(dC);
        // Radius zero disables the bubble without equal smoothstep edges.
        If(env.camBubble.greaterThan(0), () => {
          // Underwater cameras only: no dimple under a camera hovering above the surface.
          bubble.assign(smoothstep(env.camBubble, env.camBubble.mul(0.45), dc).mul(smoothstep(waterLevel.add(0.4), waterLevel.sub(0.2), env.camPos.y)));
        });
        acc.addAssign(dC.div(max(dc, 0.05)).mul(bubble).mul(24));
      }

      // --- lure curiosity
      if (o.lureInfluence > 0) {
        const toL = env.lurePos.sub(P), d = length(toL), dirL = toL.div(max(d, 0.001));
        const bold = step(rnd(11), min(env.curiosity.mul(env.inspectors).div(N), 0.03));
        // All unhooked fish clear the bite, so the selected fish has a readable silhouette.
        const startle = env.hooked.mul(smoothstep(3.2, 1.4, d));
        const personalSpace = float(1).sub(bold).mul(env.lureActive).mul(env.curiosity).mul(smoothstep(1.8, 0.5, d));
        acc.subAssign(dirL.mul(personalSpace).mul(12));
        fear.assign(max(fear, startle.mul(0.45)));
        acc.subAssign(dirL.mul(startle).mul(24));
        // the school just drifts a little closer
        acc.addAssign(dirL.mul(env.lureActive).mul(env.curiosity).mul(0.6).mul(step(2.0, d)).mul(smoothstep(10, 4, d)));
        const curious = float(1).sub(env.hooked).mul(env.lureActive).mul(bold).mul(step(d, env.curiosityRadius)).mul(step(fear, 0.25));
        const orbit = rB.mul(0.8).add(0.6);
        const tang = normalize(cross(vec3(0, 1, 0), dirL)).mul(rA.sub(0.5).sign());
        const want = dirL.mul(clamp(d.sub(orbit).mul(1.2), -1.0, 2.0)).add(tang.mul(0.7));
        acc.addAssign(want.sub(V).mul(3.2).mul(curious));
        acc.addAssign(sep.mul(env.sepW).mul(11).mul(curious.mul(0.5)));
      }

      // --- panic waves: spherical front + burst
      const hitAny = float(0).toVar();
      env.panicOrigin.forEach((oU: any, k: number) => {
        const str = k === 0 ? env.panicStrength.x : k === 1 ? env.panicStrength.y : k === 2 ? env.panicStrength.z : env.panicStrength.w;
        const age = clock.sub(oU.w), Rf = age.mul(env.panicSpeed), Rp = Rf.sub(env.panicSpeed.mul(dt));
        const dO = P.sub(oU.xyz), d = length(dO);
        const maxR = str.mul(16);
        const hit = step(0, age).mul(step(d, Rf)).mul(step(Rp, d)).mul(step(Rf, maxR)).mul(step(0.001, str));
        const near = float(1).sub(clamp(d.div(max(maxR, 0.1)), 0, 1).mul(0.55)); // strongest at the splash
        If(hit.greaterThan(0.5), () => {
          const away = normalize(select(d.greaterThan(0.05), dO.div(max(d, 0.05)), randDir(4)).add(randDir(6).mul(0.25)));
          V.assign(mix(V, away.mul(env.burst).mul(clamp(str, 0.3, 1.2)).mul(near).mul(rB.mul(0.3).add(0.85)), 0.92));
          fear.assign(max(fear, clamp(str.mul(near).mul(1.2), 0.3, 1))); flash.assign(1); hitAny.assign(1);
        });
      });

      // --- fear: decay, then propagate through neighbours (wave of alarm)
      const fear0 = fear.toVar();
      fear.assign(max(fear.sub(env.calm.mul(dt)), 0));
      const target = fearN.mul(env.transmission).mul(o.fearSensitivity);
      fear.assign(mix(fear, max(fear, target), clamp(dt.mul(9), 0, 1)));
      // instant alarm: a calm fish whose neighbours are terrified bursts away (once; own fear then stays high so it cannot re-trigger)
      // each calm fish reacts after a random delay (~0.2 s per hop), so alarm ripples through the school slower than the spherical front
      const alarm = step(fear0, 0.25).mul(step(0.5, target)).mul(float(1).sub(hitAny)).mul(step(hash(iF.add(env.frame.mul(7.31))), clamp(dt.mul(5), 0, 1)));
      If(alarm.greaterThan(0.5), () => {
        fear.assign(max(fear, target.mul(0.95)));
        const away = normalize(fearDir.add(randDir(7).mul(0.2)).add(dirV.mul(0.5)));
        V.assign(mix(V, away.mul(env.burst).mul(0.75).mul(rB.mul(0.3).add(0.85)), 0.8));
        flash.assign(0.45);
      });

      // --- integrate (turn rate limited)
      const accMax = float(7.0).mul(fear.mul(8).add(1)).add(select(millW.greaterThan(0.5), float(3), float(0)));
      const al = length(acc);
      acc.mulAssign(min(float(1), accMax.div(max(al, 0.001))));
      const previousSteer = steering.element(i).xyz;
      const smoothAcc = mix(previousSteer, acc, float(1).sub(exp(dt.mul(mix(float(-5), float(-18), fear)))));
      steering.element(i).assign(vec4(smoothAcc, 0));
      V.addAssign(smoothAcc.mul(dt));
      const sp2 = length(V);
      const vmax = spd.mul(o.maxSpeed).mul(float(1).add(fear.mul(5.5))).max(spd.mul(o.cruise).mul(1.1));
      const vmin = spd.mul(o.minSpeed).mul(float(1).sub(fear.mul(0.8)));
      const sp2c = clamp(sp2, vmin, vmax);
      V.assign(V.mul(sp2c.div(max(sp2, 0.001))));
      // after an explosive burst fish decelerate back toward cruise speed
      V.mulAssign(float(1).sub(clamp(dt.mul(3.0), 0, 1).mul(step(spd.mul(o.cruise).mul(1.6), sp2c)).mul(float(1).sub(smoothstep(0.75, 0.95, fear)))));
      // flatten the pitch when calm
      // Calm pitch limit (sin of the angle) from env.pitchLimit; milling keeps its old limit; fear frees it.
      const pitchLim = mix(mix(sin(env.pitchLimit), float(0.55), millW), float(0.95), clamp(fear.mul(1.5), 0, 1));
      const spN = max(length(V), 0.001);
      V.y.assign(clamp(V.y, spN.mul(pitchLim).negate(), spN.mul(pitchLim)));

      // A real angular limit: acceleration and pitch constraints alone do not limit heading changes.
      const beforeDir = normalize(Vold.add(vec3(0.00001, 0, 0))), afterDir = normalize(V.add(vec3(0.00001, 0, 0)));
      const turnAngle = acos(dot(beforeDir, afterDir).clamp(-1, 1)), allowed = dt.mul(fear.mul(5.5).add(env.turnRate).add(bubble.mul(2.5)));
      If(turnAngle.greaterThan(allowed), () => {
        const axis = normalize(cross(beforeDir, afterDir).add(vec3(0.000001, 0, 0)));
        V.assign(beforeDir.mul(cos(allowed)).add(cross(axis, beforeDir).mul(sin(allowed))).mul(length(V)));
      });
      const Pn = P.add(V.mul(dt)).toVar();
      // terrain hard constraint
      const hn = terrainH(Pn.x, Pn.z);
      If(Pn.y.lessThan(hn.add(0.2)), () => {
        const n2 = terrainNormal(Pn.x, Pn.z);
        If(hn.sub(Pn.y).greaterThan(0.35), () => {
          Pn.assign(P); V.assign(V.sub(n2.mul(dot(V, n2).min(0))).add(n2.mul(0.6)));
        }).Else(() => { Pn.y.assign(hn.add(0.2)); V.y.assign(max(V.y, 0)); });
      });
      // bounds
      const ceilY = waterLevel.sub(0.22);
      If(Pn.y.greaterThan(ceilY), () => { Pn.y.assign(ceilY); V.y.assign(min(V.y, 0)); });
      Pn.x.assign(clamp(Pn.x, SWIM_BOUNDS.min[0] - 0.25, SWIM_BOUNDS.max[0] + 0.25));
      Pn.z.assign(clamp(Pn.z, SWIM_BOUNDS.min[2] - 0.25, SWIM_BOUNDS.max[2] + 0.25));
      Pn.y.assign(max(Pn.y, SWIM_BOUNDS.min[1] - 0.2));
      P.assign(Pn);

      // --- visual state: bank, turn rate, flash, tail rate
      const speedNow = length(V), dirN = V.div(max(speedNow, 0.001));
      const right = normalize(cross(dirN, vec3(0, 1, 0)).add(vec3(0.0001, 0, 0)));
      const lat = dot(V.sub(Vold).div(max(dt, 0.0005)), right);
      bank.assign(mix(bank, clamp(lat.mul(0.11), -1.0, 1.0), float(1).sub(exp(dt.mul(-3.8)))));
      const ang = length(cross(dirV, dirN)).div(max(dt, 0.0005));
      turnS.assign(mix(turnS, ang, float(1).sub(exp(dt.mul(-4)))));
      flash.assign(max(flash.mul(exp(dt.mul(-14.0))), smoothstep(4.0, 11.0, turnS).mul(smoothstep(0.35, 0.8, fear)).mul(0.4)));
      phaseRate.assign(float(0.9).add(speedNow.mul(0.85)).add(fear.mul(1.2)));
      alive.assign(1);

      // --- take off (flying fish): only flyers swimming in the top 3.5 units, a few at a time.
      // Ambient: 3×3-unit surface columns switch on now and then (per staggered 7 s window), and the flyers inside launch
      // at random moments, so single fish and small bursts of neighbours take off. Panic: frightened flyers escape upward.
      if (o.main) {
        const hd = normalize(vec3(V.x, 0, V.z).add(vec3(0.0001, 0, 0)));
        const landing = P.xz.add(hd.xz.mul(11));
        const inside = max(abs(landing.x), abs(landing.y)).lessThan(env.swimHalf.sub(0.9));
        const cellX = floor(P.x.add(30).div(3)), cellZ = floor(P.z.add(30).div(3)), cellKey = cellX.mul(37).add(cellZ);
        const window = floor(clock.div(7).add(hash(cellKey.add(500))));
        const active = step(hash(cellKey.mul(1.37).add(window.mul(113.1)).add(7)), env.airRate);
        // Within an active column only a few of its flyers take part this window (bursts of a handful, not the crowd).
        const takesPart = step(hash(iF.mul(0.71).add(window.mul(7.7)).add(cellKey)), 0.12);
        const pLaunch = active.mul(takesPart).mul(0.8).add(smoothstep(0.55, 0.9, fear).mul(step(rnd(53), 0.5)).mul(env.airPanic)).mul(dt);
        const roll = hash(iF.add(env.frame.mul(3.17)).add(11));
        If(P.y.greaterThan(waterLevel.sub(3.5)).and(step(rnd(51), env.airFlyers).greaterThan(0.5)).and(inside).and(speedNow.greaterThan(0.5)).and(roll.lessThan(pLaunch)), () => {
          // Start the run-up (the airborne branch steers toward the surface from the current velocity).
          state.assign(-1); flash.assign(0.4);
        });
      }
    });

    // --- write back
    phase.addAssign(phaseRate.mul(dt).mul(rC.mul(0.2).add(0.9)));
    p4.assign(vec4(P, fract(phase)));
    v4.assign(vec4(V, fear));
    ax.assign(vec4(flash, bank, turnS, state));
  })().compute(N).setName('fishSimulate');

  // ---------- strike selection: nearest calm fish inside the curiosity radius (atomicMin on packed key) ----------
  const resetSel = Fn(() => { atomicStore(statsAtomic.element(8), uint(0xffffffff)); })().compute(1).setName('fishResetSel');
  const select_ = Fn(() => {
    const i = instanceIndex, p = pos.element(i), a = aux.element(i), fear = vel.element(i).w;
    const d = length(p.xyz.sub(env.lurePos));
    If(isFree(a.w).and(fear.lessThan(0.25)).and(step(rnd(11), min(env.curiosity.mul(env.inspectors).div(N), 0.03)).greaterThan(0.5)).and(d.lessThan(env.curiosityRadius)).and(env.lureActive.greaterThan(0.5)), () => {
      const dq = clamp(d.div(env.curiosityRadius).mul(16383), 0, 16383).toUint();
      atomicMin(statsAtomic.element(8), dq.shiftLeft(uint(18)).bitOr(i));
    });
  })().compute(N).setName('fishSelect');

  // ---------- stats ----------
  const clearStats = Fn(() => { atomicStore(statsAtomic.element(instanceIndex), uint(0)); })().compute(6).setName('fishClearStats');
  const accumulate = Fn(() => {
    const i = instanceIndex, p = pos.element(i), a = aux.element(i), v = vel.element(i);
    If(a.w.lessThan(2.5), () => {
      atomicAdd(statsAtomic.element(5), uint(1));
      atomicAdd(statsAtomic.element(1), p.x.add(CENTROID_OFFSET).mul(CENTROID_SCALE).toUint());
      atomicAdd(statsAtomic.element(2), p.y.add(CENTROID_OFFSET).mul(CENTROID_SCALE).toUint());
      atomicAdd(statsAtomic.element(3), p.z.add(CENTROID_OFFSET).mul(CENTROID_SCALE).toUint());
      atomicAdd(statsAtomic.element(4), clamp(v.w, 0, 1).mul(FEAR_SCALE).toUint());
      If(isFree(a.w).and(v.w.lessThan(0.25)).and(step(rnd(11), min(env.curiosity.mul(env.inspectors).div(N), 0.03)).greaterThan(0.5)).and(env.lureActive.greaterThan(0.5)).and(length(p.xyz.sub(env.lurePos)).lessThan(env.curiosityRadius)), () => { atomicAdd(statsAtomic.element(0), uint(1)); });
    });
  })().compute(N).setName('fishAccumulate');

  // ---------- splashes: compare the state snapshot taken by `insert` (before this frame's simulate) with the result ----------
  const splashDetect = Fn(() => {
    const i = instanceIndex, before = snap.element(i.mul(2)), p = pos.element(i), a = aux.element(i);
    const wasAir = before.w.lessThan(-0.5), isAir = a.w.lessThan(-0.5);
    const breach = isAir.and(before.y.lessThan(waterLevel)).and(p.y.greaterThanEqual(waterLevel));
    // Entry = a flown fish crossing the surface downward (not a run-up that gave up underwater).
    const entry = wasAir.and(before.w.lessThan(-FLOWN + 0.5)).and(before.y.greaterThanEqual(waterLevel)).and(p.y.lessThan(waterLevel));
    If(breach.or(entry), () => {
      const n = atomicAdd(statsAtomic.element(SPLASH_COUNTER), uint(1));
      const strength = select(entry, float(1), float(-0.6)).mul(rnd(61).mul(0.4).add(0.8));
      splashWrite.element(n.mod(uint(SPLASH_SLOTS))).assign(vec4(p.x, p.z, clock, strength));
    });
  })().compute(N).setName('fishSplash');

  const cruisePasses = [clearGrid, insert, simulate, ...(o.main ? [splashDetect] : [])];
  const strikePasses = [clearGrid, insert, resetSel, select_, simulate, ...(o.main ? [splashDetect] : [])];
  const statsPasses = [clearStats, accumulate];
  return {
    count: N, pos, vel, aux, statsAttr,
    /** Splash ring buffer (SPLASH_SLOTS × vec4(x, z, clock, strength)), for the vertex stage. */
    splashes: storage(splashAttr, 'vec4', SPLASH_SLOTS).toReadOnly(),
    /** read-only views for the vertex stage */
    read: {
      pos: storage(pos.value, 'vec4', N).toReadOnly(), vel: storage(vel.value, 'vec4', N).toReadOnly(),
      aux: storage(aux.value, 'vec4', N).toReadOnly(),
    },
    step(withStrike: boolean) {
      renderer.compute(withStrike ? strikePasses : cruisePasses);
    },
    stats() { renderer.compute(statsPasses); },
  };
}
export type Sim = ReturnType<typeof createSim>;

/**
 * Airborne contract (flying fish), read by the vertex stage (render.ts): 0..1 wing spread for fish `i`.
 * 0 = swimming, wings folded against the flanks; 1 = gliding, wings fully spread. The sim's airborne state owns it;
 * it must be derivable from the existing read views (the simulate pass already uses all 8 storage buffers).
 */
export const airSpread = (read: { pos: any; vel: any; aux: any }, i: any): any => {
  const w = read.aux.element(i).w, h = read.pos.element(i).y.sub(waterLevel);
  // Spread over ~0.3 s once clear of the water, folded again as it touches down (the sim's lift uses the same easing).
  const flown = w.lessThan(-FLOWN + 0.5), airT = w.negate().sub(1).mod(FLOWN);
  return select(flown, spreadAt(h, airT), float(0));
};
/** 1 while fish `i` is in the airborne state (including the underwater run-up), else 0. */
export const airborne = (read: { aux: any }, i: any): any => read.aux.element(i).w.lessThan(-0.5).toFloat();
