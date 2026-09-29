/* eslint-disable @typescript-eslint/no-explicit-any */
import { StorageBufferAttribute, Vector3, Vector4 } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import * as TSL from 'three/tsl';
const {
  Fn, If, Loop, atomicAdd, atomicMin, atomicStore, clamp, cos, cross, dot, exp, float, floor, hash, instanceIndex, instancedArray, length, max, min,
  mix, normalize, select, sin, smoothstep, sqrt, step, storage, uint, uniform, vec3, vec4, abs, fract, int,
} = TSL as any;
import { SWIM_BOUNDS, WORLD } from '../config';
import { waterLevel } from '../state';

/** Uniform grid over the water volume (cell = largest neighbour radius). */
export const GRID = { cell: 0.6, min: [-WORLD.half, 0.5, -WORLD.half], x: 20, y: 13, z: 20, slots: 48 } as const;
const CELLS = GRID.x * GRID.y * GRID.z;

/** Uniforms shared by every school (behaviours, lure, predator, panic waves...). */
export function createEnv() {
  const u = uniform;
  const env = {
    dt: u(0.016), clock: u(0), frame: u(0),
    // boids
    speed: u(1), sepW: u(1.2), aliW: u(1.0), cohW: u(1.0), sepR: u(0.2), neighR: u(0.5), scanCap: u(5, 'int'),
    // milling
    millBlend: u(0), millStrength: u(1), millRadius: u(2.4), millHeight: u(1.6), millDir: u(1), millCenter: u(new Vector3(0.8, 4.1, 0.8)),
    // predator / fountain
    predPos: u(new Vector3(0, -50, 0)), predVel: u(new Vector3(1, 0, 0)), predActive: u(0), fearRadius: u(3.2), fountain: u(1),
    // panic
    panicOrigin: [0, 1, 2, 3].map(() => u(new Vector4(0, 0, 0, -1000))),
    panicStrength: u(new Vector4(0, 0, 0, 0)),
    panicSpeed: u(6.5), burst: u(6.0), calm: u(0.55), transmission: u(0.96),
    // lure
    lurePos: u(new Vector3(0, 5, 0)), lureActive: u(0), curiosity: u(0), curiosityRadius: u(3.5),
    strike: u(0), land: u(0), respawn: u(10),
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

export const STATS_SLOTS = 16; // 0 near, 1..3 centroid sums, 4 fear sum, 5 alive count, 6 biter state, 7 biter dist*1000, 8 strike selection key
export const CENTROID_SCALE = 256, CENTROID_OFFSET = 16, FEAR_SCALE = 1024;

export function createSim(o: SimOptions) {
  const { renderer, env, seabed } = o, N = o.count;
  const half = WORLD.half, res = seabed.resolution;

  // ---------- buffers ----------
  // WebGPU allows 8 storage buffers per stage: pos, vel, aux (flash, bank, turn, state), snap (2 vec4 per fish), grid, heights, stats = 7
  const pos = instancedArray(N, 'vec4'), vel = instancedArray(N, 'vec4'), aux = instancedArray(N, 'vec4');
  const snap = instancedArray(N * 2, 'vec4');
  const S1 = GRID.slots + 1; // per cell: [count, slot0 .. slotK-1]
  const gridAttr = new StorageBufferAttribute(new Uint32Array(CELLS * S1), 1);
  const gridAtomic = storage(gridAttr, 'uint', CELLS * S1).toAtomic(), gridRead = storage(gridAttr, 'uint', CELLS * S1).toReadOnly();
  const heightBuf = instancedArray(seabed.heights, 'float');
  const statsAttr = new StorageBufferAttribute(new Uint32Array(STATS_SLOTS), 1);
  const statsAtomic = storage(statsAttr, 'uint', STATS_SLOTS).toAtomic(), statsWrite = storage(statsAttr, 'uint', STATS_SLOTS);

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
      const c = centers[Math.floor(rng() * centers.length)], gauss = () => (rng() + rng() + rng() - 1.5) * 1.15;
      let x = c[0] + gauss() * o.clusterRadius, z = c[2] + gauss() * o.clusterRadius, y = c[1] + gauss() * o.clusterRadius * 0.55;
      x = Math.max(SWIM_BOUNDS.min[0] + 0.3, Math.min(SWIM_BOUNDS.max[0] - 0.3, x)); z = Math.max(SWIM_BOUNDS.min[2] + 0.3, Math.min(SWIM_BOUNDS.max[2] - 0.3, z));
      const h = sampleHeight(seabed, x, z); y = Math.max(h + 0.5, Math.min(SWIM_BOUNDS.max[1] - 0.4, y));
      if (h > WORLD.surface - 1.5) { x = c[0]; z = c[2]; y = c[1]; }
      const th = rng() * Math.PI * 2, sp = o.cruise * (0.8 + 0.4 * rng());
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
    If(a.w.lessThan(0.5), () => {
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
    const flash = ax.x.toVar(), state = ax.w.toVar(), trait = rnd(11);
    const bank = ax.y.toVar(), turnS = ax.z.toVar();
    const rA = rnd(1), rB = rnd(2), rC = rnd(3);
    const phaseRate = float(0).toVar(); // cycles per second, set by each branch
    const Vold = V.toVar();
    const alive = float(1).toVar();

    // --- strike selection commit
    If(env.strike.greaterThan(0.5).and(state.lessThan(0.5)), () => {
      const key = statsWrite.element(8);
      If(key.notEqual(uint(0xffffffff)).and(key.bitAnd(uint(0x3ffff)).equal(i)), () => { state.assign(1); });
    });

    If(state.greaterThan(2.5), () => {
      // ------------------------------------------------ hidden (caught): countdown, then respawn from the edge
      alive.assign(0);
      const t = state.sub(3).sub(dt);
      If(t.lessThanEqual(0), () => {
        const side = floor(rA.mul(4)), along = rB.mul(2).sub(1).mul(half - 1.2), edge = half - 0.7;
        const px = select(side.lessThan(1), float(-edge), select(side.lessThan(2), float(edge), along));
        const pz = select(side.lessThan(1), along, select(side.lessThan(2), along, select(side.lessThan(3), float(-edge), float(edge))));
        const h = terrainH(px, pz);
        const py = max(h.add(0.6), float(SWIM_BOUNDS.min[1] + 0.4).add(rC.mul(waterLevel.sub(2.4).sub(SWIM_BOUNDS.min[1] + 0.4))));
        P.assign(vec3(px, min(py, waterLevel.sub(0.6)), pz));
        V.assign(normalize(vec3(env.millCenter.x.sub(px), 0, env.millCenter.z.sub(pz))).mul(o.cruise));
        state.assign(0); fear.assign(0); flash.assign(0.3); alive.assign(1);
      }).Else(() => { state.assign(t.add(3)); });
    }).ElseIf(state.greaterThan(1.5), () => {
      // ------------------------------------------------ hooked: pinned to the lure, thrashing
      const w = clock.mul(23).add(rA.mul(40));
      const thrash = vec3(sin(w), sin(w.mul(1.31).add(1.7)).mul(0.6), cos(w.mul(0.87))).mul(0.07);
      P.assign(env.lurePos.add(thrash));
      V.assign(normalize(vec3(sin(w.mul(0.41)), 0.25, cos(w.mul(0.37)))).mul(3.2));
      fear.assign(1); flash.assign(max(flash.mul(0.9), sin(w.mul(0.7)).mul(0.5).add(0.5).mul(0.7)));
      phaseRate.assign(9);
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
      V.assign(mix(V, toL.div(max(d, 0.001)).mul(5.5), clamp(dt.mul(12), 0, 1)));
      P.addAssign(V.mul(dt));
      phaseRate.assign(7); flash.assign(max(flash.mul(0.95), 0.25));
      statsWrite.element(6).assign(uint(1)); statsWrite.element(7).assign(uint(clamp(d.mul(1000), 0, 60000)));
      If(d.lessThan(0.2), () => { state.assign(2); });
      If(env.lureActive.lessThan(0.5).or(env.land.greaterThan(0.5)), () => { state.assign(0); fear.assign(0.6); statsWrite.element(6).assign(uint(0)); });
    }).Else(() => {
      // ================================================ free swimming
      const spd = env.speed;
      const speed = length(V).toVar();
      const dirV = V.div(max(speed, 0.001));

      // --- neighbours
      const cs = cellOf(P);
      const sep = vec3(0).toVar(), aliSum = vec3(0).toVar(), cohSum = vec3(0).toVar(), cnt = float(0).toVar();
      const fearN = float(0).toVar(), fearDir = vec3(0).toVar();
      const sepR = env.sepR, nR = env.neighR, nR2 = nR.mul(nR);
      const scan = (dx: any, dy: any, dz: any) => {
        const nx = cs.cx.add(dx), ny = cs.cy.add(dy), nz = cs.cz.add(dz);
        If(nx.greaterThanEqual(0).and(nx.lessThan(GRID.x)).and(ny.greaterThanEqual(0)).and(ny.lessThan(GRID.y)).and(nz.greaterThanEqual(0)).and(nz.lessThan(GRID.z)), () => {
          const c = nz.mul(GRID.y).add(ny).mul(GRID.x).add(nx);
          const n = min(gridRead.element(c.mul(S1)), uint(GRID.slots)).toInt();
          If(n.greaterThan(0), () => {
            const take = min(n, env.scanCap);
            const start = hash(iF.add(env.frame.mul(13.7)).add(c.toFloat().mul(3.1))).mul(n.toFloat()).toInt();
            const wScale = n.toFloat().div(take.toFloat());
            Loop({ start: 0, end: take, type: 'int', name: 's', condition: '<' }, ({ s }: any) => {
              const j = gridRead.element(c.mul(S1).add(start.add(s).mod(n)).add(1));
              If(j.notEqual(i), () => {
                const pj = snap.element(j.mul(2)), d3 = P.sub(pj.xyz), d2 = dot(d3, d3);
                If(d2.lessThan(nR2).and(d2.greaterThan(1e-6)), () => {
                  const vj = snap.element(j.mul(2).add(1)), d = sqrt(d2);
                  aliSum.addAssign(vj.xyz.mul(wScale)); cohSum.addAssign(pj.xyz.mul(wScale)); cnt.addAssign(wScale);
                  const k = clamp(float(1).sub(d.div(sepR)), 0, 1);
                  sep.addAssign(d3.div(d).mul(k.mul(k)).mul(wScale));
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
      acc.addAssign(sep.mul(env.sepW).mul(11));
      acc.addAssign(aliSum.mul(inv).sub(V).mul(hasN).mul(env.aliW).mul(3.0).mul(boidScale));
      acc.addAssign(cohSum.mul(inv).sub(P).mul(hasN).mul(env.cohW).mul(3.2).mul(boidScale));

      // --- wander
      const tt = clock.mul(0.8);
      acc.addAssign(vec3(sin(tt.add(rA.mul(50))), sin(tt.mul(1.3).add(rB.mul(50))).mul(0.35), sin(tt.mul(0.9).add(rC.mul(50)))).mul(0.9));

      // --- cruise speed relaxation (per-fish cruise variation)
      const cruise = spd.mul(o.cruise).mul(rB.mul(0.4).add(0.8));
      acc.addAssign(dirV.mul(cruise.sub(speed)).mul(1.6));

      // --- species home (angelfish: hover low over the terrain, stay near the island)
      if (o.homeStrength > 0) {
        const ht = terrainH(P.x, P.z).add(o.homeClear);
        acc.y.addAssign(ht.sub(P.y).mul(o.homeStrength));
        const dxz = vec3(o.homeXZ[0], 0, o.homeXZ[1]).sub(vec3(P.x, 0, P.z)), dl = length(dxz);
        acc.addAssign(dxz.div(max(dl, 0.01)).mul(smoothstep(o.homeRadius, o.homeRadius + 2.5, dl)).mul(2.5));
      }

      // --- bounds (soft walls)
      const m = float(1.0), lo = vec3(SWIM_BOUNDS.min[0], SWIM_BOUNDS.min[1], SWIM_BOUNDS.min[2]), hi = vec3(SWIM_BOUNDS.max[0], waterLevel.sub(0.3), SWIM_BOUNDS.max[2]);
      const pen = clamp(lo.add(m).sub(P).div(m), 0, 1).sub(clamp(P.sub(hi.sub(m)).div(m), 0, 1));
      acc.addAssign(pen.mul(abs(pen).mul(0.6).add(0.4)).mul(14));

      // --- terrain avoidance
      const ahead = P.add(V.mul(0.7));
      const hP = terrainH(P.x, P.z), hA = terrainH(ahead.x, ahead.z);
      const clr = min(P.y.sub(hP), ahead.y.sub(hA));
      const tw = clamp(float(1.0).sub(clr).div(1.0), 0, 1);
      const tn = terrainNormal(ahead.x, ahead.z);
      acc.addAssign(tn.mul(tw.mul(tw)).mul(38));
      V.subAssign(tn.mul(min(dot(V, tn), 0)).mul(tw).mul(clamp(dt.mul(8), 0, 1)));

      // --- milling (torus)
      If(millW.greaterThan(0.001), () => {
        const C = env.millCenter, r = vec3(P.x.sub(C.x), 0, P.z.sub(C.z)), dist = max(length(r), 0.05), er = r.div(dist);
        const et = vec3(er.z.negate(), 0, er.x).mul(env.millDir);
        const R = env.millRadius.mul(rA.mul(0.55).add(0.72));
        const yMid = C.y.add(rB.sub(0.5).mul(env.millHeight));
        const want = et.mul(spd.mul(1.75)).add(er.mul(clamp(R.sub(dist).mul(1.6), -1.4, 1.4))).add(vec3(0, clamp(yMid.sub(P.y).mul(1.4), -0.7, 0.7), 0));
        acc.addAssign(want.sub(V).mul(3.6).mul(env.millStrength).mul(millW).mul(float(1).sub(fear)));
      });

      // --- fountain: flee the predator laterally + backward relative to its heading
      const dP = P.sub(env.predPos), dl = length(dP), H = normalize(env.predVel), along = dot(dP, H), perp = dP.sub(H.mul(along)), pl = length(perp);
      const fr = env.fearRadius;
      const zone = env.predActive.mul(smoothstep(fr, fr.mul(0.3), dl)).mul(smoothstep(fr.mul(-0.45), fr.mul(0.25), along));
      const lateral = select(pl.greaterThan(0.06), perp.div(pl), cross(H, vec3(0, 1, 0)).mul(rA.sub(0.5).sign()));
      const flee = lateral.add(H.mul(-0.55)).add(vec3(0, rB.sub(0.5).mul(0.6), 0));
      acc.addAssign(flee.mul(zone).mul(env.fountain).mul(o.fearSensitivity).mul(34));
      fear.assign(max(fear, zone.mul(0.55).mul(clamp(env.fountain, 0, 1)).mul(o.fearSensitivity)));

      // --- lure curiosity
      if (o.lureInfluence > 0) {
        const toL = env.lurePos.sub(P), d = length(toL), dirL = toL.div(max(d, 0.001));
        const curious = env.lureActive.mul(step(trait, env.curiosity.mul(o.lureInfluence))).mul(step(d, env.curiosityRadius)).mul(step(fear, 0.25));
        const orbit = rB.mul(0.6).add(0.4);
        const tang = normalize(cross(vec3(0, 1, 0), dirL)).mul(rA.sub(0.5).sign());
        const want = dirL.mul(clamp(d.sub(orbit).mul(1.2), -0.6, 1.3)).add(tang.mul(0.45));
        acc.addAssign(want.sub(V).mul(3.2).mul(curious));
        acc.addAssign(sep.mul(env.sepW).mul(11).mul(curious.mul(0.5)));
      }

      // --- panic waves: spherical front + burst
      const hitAny = float(0).toVar();
      env.panicOrigin.forEach((oU: any, k: number) => {
        const str = k === 0 ? env.panicStrength.x : k === 1 ? env.panicStrength.y : k === 2 ? env.panicStrength.z : env.panicStrength.w;
        const age = clock.sub(oU.w), Rf = age.mul(env.panicSpeed), Rp = Rf.sub(env.panicSpeed.mul(dt));
        const dO = P.sub(oU.xyz), d = length(dO);
        const hit = step(0, age).mul(step(d, Rf)).mul(step(Rp, d)).mul(step(Rf, str.mul(11))).mul(step(0.001, str));
        If(hit.greaterThan(0.5), () => {
          const away = normalize(select(d.greaterThan(0.05), dO.div(max(d, 0.05)), randDir(4)).add(randDir(6).mul(0.25)));
          V.assign(mix(V, away.mul(env.burst).mul(clamp(str, 0.3, 1.2)).mul(rB.mul(0.3).add(0.85)), 0.9));
          fear.assign(max(fear, clamp(str, 0.3, 1))); flash.assign(1); hitAny.assign(1);
        });
      });

      // --- fear: decay, then propagate through neighbours (wave of alarm)
      const fear0 = fear.toVar();
      fear.assign(max(fear.sub(env.calm.mul(dt)), 0));
      const target = fearN.mul(env.transmission).mul(o.fearSensitivity);
      fear.assign(mix(fear, max(fear, target), clamp(dt.mul(9), 0, 1)));
      const crossed = step(fear0.max(0.0), 0.4).mul(step(0.4, fear)).mul(float(1).sub(hitAny));
      If(crossed.greaterThan(0.5).and(fearN.greaterThan(0.5)), () => {
        const away = normalize(fearDir.add(randDir(7).mul(0.2)).add(dirV.mul(0.5)));
        V.assign(mix(V, away.mul(env.burst).mul(0.75).mul(rB.mul(0.3).add(0.85)), 0.8));
        flash.assign(1);
      });

      // --- integrate (turn rate limited)
      const accMax = float(7.0).mul(fear.mul(4).add(1)).add(select(millW.greaterThan(0.5), float(2), float(0)));
      const al = length(acc);
      acc.mulAssign(min(float(1), accMax.div(max(al, 0.001))));
      V.addAssign(acc.mul(dt));
      const sp2 = length(V);
      const vmax = spd.mul(o.maxSpeed).mul(float(1).add(fear.mul(3.2))).max(spd.mul(o.cruise).mul(1.1));
      const vmin = spd.mul(o.minSpeed).mul(float(1).sub(fear.mul(0.8)));
      const sp2c = clamp(sp2, vmin, vmax);
      V.assign(V.mul(sp2c.div(max(sp2, 0.001))));
      // flatten the pitch when calm
      const pitchLim = mix(float(0.42), float(0.95), clamp(fear.mul(1.5), 0, 1));
      const spN = max(length(V), 0.001);
      V.y.assign(clamp(V.y, spN.mul(pitchLim).negate(), spN.mul(pitchLim)));

      const Pn = P.add(V.mul(dt)).toVar();
      // terrain hard constraint
      const hn = terrainH(Pn.x, Pn.z);
      If(Pn.y.lessThan(hn.add(0.12)), () => {
        const n2 = terrainNormal(Pn.x, Pn.z);
        If(hn.sub(Pn.y).greaterThan(0.35), () => {
          Pn.assign(P); V.assign(V.sub(n2.mul(dot(V, n2).min(0))).add(n2.mul(0.6)));
        }).Else(() => { Pn.y.assign(hn.add(0.12)); V.y.assign(max(V.y, 0)); });
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
      bank.assign(mix(bank, clamp(lat.mul(0.11), -1.0, 1.0), clamp(dt.mul(7), 0, 1)));
      const ang = length(cross(dirV, dirN)).div(max(dt, 0.0005));
      turnS.assign(mix(turnS, ang, clamp(dt.mul(10), 0, 1)));
      flash.assign(max(flash.mul(exp(dt.mul(-3.2))), smoothstep(4.0, 11.0, turnS).mul(fear.mul(0.9).add(0.1)).min(1).mul(0.6)));
      phaseRate.assign(float(0.9).add(speedNow.mul(0.85)).add(fear.mul(1.2)));
      alive.assign(1);
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
    If(a.w.lessThan(0.5).and(fear.lessThan(0.35)).and(d.lessThan(env.curiosityRadius)).and(env.lureActive.greaterThan(0.5)), () => {
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
      If(a.w.lessThan(0.5).and(env.lureActive.greaterThan(0.5)).and(length(p.xyz.sub(env.lurePos)).lessThan(env.curiosityRadius)), () => { atomicAdd(statsAtomic.element(0), uint(1)); });
    });
  })().compute(N).setName('fishAccumulate');

  return {
    count: N, pos, vel, aux, statsAttr,
    /** read-only views for the vertex stage */
    read: {
      pos: storage(pos.value, 'vec4', N).toReadOnly(), vel: storage(vel.value, 'vec4', N).toReadOnly(),
      aux: storage(aux.value, 'vec4', N).toReadOnly(),
    },
    step(withStrike: boolean) {
      renderer.compute(clearGrid);
      renderer.compute(insert);
      if (withStrike) { renderer.compute(resetSel); renderer.compute(select_); }
      renderer.compute(simulate);
    },
    stats() { renderer.compute(clearStats); renderer.compute(accumulate); },
  };
}
export type Sim = ReturnType<typeof createSim>;
