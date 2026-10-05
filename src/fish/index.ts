/* eslint-disable @typescript-eslint/no-explicit-any */
import { CylinderGeometry, Mesh, MeshStandardNodeMaterial, Vector3, Vector4 } from 'three/webgpu';
import * as TSL from 'three/tsl';
const { float, uniform, vec3, hash, instanceIndex } = TSL as any;
import type { FolderApi } from 'tweakpane';
import type { Ctx, School, SchoolStats, World } from '../contracts';
import { BASIN, COAST, FISH_SIZE, QUERY, SWIM_BOUNDS, WORLD } from '../config';
import { loadFishAsset } from './geometry';
import { createFlyingFishAsset } from './flyingfish';
import { MAX_SCHOOLS, createEnv, createSim, sampleHeight, SPLASH_SLOTS, CENTROID_OFFSET, CENTROID_SCALE, FEAR_SCALE } from './sim';
import { SCHOOL_LENGTH, createFishMesh, instanceFromSim, schoolLook, visuals } from './render';
import type { InstanceNodes } from './render';
import { Predator } from './predator';
import { createSplashes, splashGain } from './splash';
import { createLod } from './lod';
import { lanternPosition, simTime } from '../state';

const MAIN_LENGTH = SCHOOL_LENGTH, PREDATOR_LENGTH = 2.3;
const base = import.meta.env.BASE_URL;
const query = new URLSearchParams(location.search);

/** CPU port of three's TSL hash (PCG), matching fishRand() on the GPU. */
const pcg = (seed: number) => {
  const state = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return (((word >>> 22) ^ word) >>> 0) / 2 ** 32;
};
/**
 * Weight (g) of school fish `i`: its length from the same per-fish size the vertex shader uses (fishRand(i, 1, 12)),
 * 1 world unit ≈ 25 cm, and a flying-fish length–weight relation W ≈ 0.0105 · L³ (L in cm).
 */
export function fishGrams(i: number) {
  // Same formula as instanceFromSim() in render.ts: mean size × (1 ± variation) × scale.
  const mean = (FISH_SIZE.min + FISH_SIZE.max) * 0.5, variation = Math.max(0, Math.min(0.6, visuals.sizeVariation.value));
  const size = (Math.pow(pcg(i + 12 * 977 + 131), FISH_SIZE.distribution) * 2 - 1) * variation * mean + mean;
  const scaled = size * visuals.sizeScale.value;
  const cm = SCHOOL_LENGTH * scaled * 25;
  return Math.round(0.0105 * cm ** 3);
}

export async function createSchool(ctx: Ctx, world: World): Promise<School> {
  const { renderer, scene } = ctx;
  // One tropical school (a few colour variants); explicit ?fish= still supports stress testing.
  const N = QUERY.fish;
  const env = createEnv();
  // debug: ?fishFakeIsland=1 injects a test island into the height field (and a proxy mesh) to check terrain avoidance on the stub world
  let seabed = world.seabed;
  if (query.get('fishFakeIsland') === '1') {
    const r = seabed.resolution, h = new Float32Array(seabed.heights);
    for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) {
      const wx = -WORLD.half + (x + 0.5) / r * 2 * WORLD.half, wz = -WORLD.half + (z + 0.5) / r * 2 * WORLD.half, d = Math.hypot(wx + 2.5, wz + 2.5);
      const t = Math.min(1, Math.max(0, (2.8 - d) / 1.2)), k = t * t * (3 - 2 * t);
      h[z * r + x] = Math.max(h[z * r + x], WORLD.bed + (WORLD.surface + 2.5 - WORLD.bed) * k);
    }
    seabed = { heights: h, resolution: r };
    const cone = new Mesh(new CylinderGeometry(1.6, 2.8, WORLD.surface + 2.5 - WORLD.bed, 32), new MeshStandardNodeMaterial({ color: '#7a6a4a' }));
    cone.position.set(-2.5, (WORLD.surface + 2.5 + WORLD.bed) / 2, -2.5); scene.add(cone);
  }

  // ------------------------------------------------------------------ assets
  const main = createFlyingFishAsset();
  const big = (await import('./dorado')).createDoradoAsset();
  const tris = { fish: main.lods[0].triCount, fishNear: main.full!.triCount, fishShadow: main.lods[1].triCount, predator: big.lods[0].triCount };
  console.info('[fish] triangles per fish', tris, 'vertices', main.lods[0].vertexCount);

  // ------------------------------------------------------------------ island clearance for school routes
  let ix = 0, iz = 0, ic = 0;
  const { heights, resolution } = seabed;
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) if (heights[z * resolution + x] > WORLD.surface) { ix += -WORLD.half + (x + 0.5) / resolution * 2 * WORLD.half; iz += -WORLD.half + (z + 0.5) / resolution * 2 * WORLD.half; ic++; }
  const homeXZ: [number, number] = ic > 10 ? [ix / ic, iz / ic] : [COAST.x, COAST.z];

  env.millCenter.value.x = BASIN.x; env.millCenter.value.z = BASIN.z;
  env.millCenter.value.y = WORLD.bed + (WORLD.surface - WORLD.bed) * 0.6;
  env.millRadius.value = 6.6; env.millHeight.value = 2.4;
  env.schoolAxes.value.set(4.5, 3.6, 1.6); // half-length, half-width, half-height (× School size): tapered, bent along the route
  env.attractW.value = 0.4;
  const startMilling = query.get('fishDemo') === 'milling' || query.get('milling') === '1';
  env.millBlend.value = startMilling ? 1 : 0;
  /**
   * Where the school roams (tunable in School → Roaming): radius of the three sub-schools' loop around the basin,
   * how far that loop's centre drifts, how far apart the sub-schools spread, the size of each sub-school, and the
   * swim area (half-size of the square the fish may use; live, walls are uniforms in the sim).
   */
  const roam = {
    radius: Number(query.get('roam')) || 12, drift: 4.5, spread: 1.55, size: 1.8, area: Number(query.get('area')) || 20.4,
    /** 0..1: how strongly the schools gather under the boat's lantern (fish come to the light at night). */
    gather: query.has('gather') ? Number(query.get('gather')) : 0.55,
    /** Max turn rate of a school's travel heading (rad/s), and whether the automatic bait-ball / split phases run. */
    pathTurn: 25 * Math.PI / 180, modes: true,
    /** School-wide slow depth wander: amplitude (units) and period (s); each school is out of phase. */
    wanderAmp: 0.6, wanderPeriod: 30,
    routeOffsetZ: 0, depthStep: 0.35, wobble: 0.15, pathSpeed: 0.95, depthBase: 0.62, depthGather: 0.18, peelBase: 0.02, peelWave: 0.03,
  };
  env.swimHalf.value = Math.min(WORLD.half - 0.6, roam.area);
  /** Position on sub-school k's roaming path at time tt (also used to place the schools at start). */
  /** Integrated route phase (rad) at route time t. */
  const route = { phase: 0, t: 0 };
  const routeRate = (A: number) => roam.pathSpeed * (env.speed.value / 0.5) / Math.max(0.5, A);
  function schoolPath(k: number, tt: number, out: number[], kickK: number, ballW: number, splitW: number) {
    const lim = Math.max(1, Math.min(WORLD.half - 3, env.swimHalf.value - 3));
    const spread = (2.0 * (0.5 + 0.5 * Math.sin(tt * 0.05 + 1.0)) + kickK) * (1 - 0.5 * ballW) * (1 + 0.35 * splitW) * roam.spread;
    const n = Math.max(1, Math.round(env.schools.value));
    // Gathering at the light: the loop tightens and its centre slides under the lantern, so the school reads as a shape
    // in the lit cone and the water goes dark and empty a few metres out.
    const g = Math.max(0, Math.min(1, roam.gather)), lamp = lanternPosition.value;
    // One wide, gently wobbling loop around the lantern with the N schools a 1/N lap apart: separate schools that each
    // take long curves (tightest bend ≈ 0.6 × radius, longer than a school) and pass through the lantern's pool in turn.
    // The loop's centre wanders slowly around the lantern (Centre drift; two incommensurate rates, so no lap repeats):
    // each lap passes the light at a different place, now and then right through the middle. The oval slowly turns.
    const A = roam.radius * (1 - 0.3 * g) * (1 - 0.25 * ballW), wob = roam.wobble;
    const bx = BASIN.x * (1 - g) + lamp.x * g, bz = roam.routeOffsetZ + BASIN.z * (1 - g) + lamp.z * g;
    // The drift shrinks when a big loop would otherwise reach the swim-area clamp (a clamped route has corners).
    const drift = Math.max(0, Math.min(roam.drift, lim - 2 - A * (1 + wob) - Math.max(Math.abs(bx), Math.abs(bz))));
    const cx = bx + drift * (0.75 * Math.sin(tt * 0.021 + 1) + 0.25 * Math.sin(tt * 0.057 + 4));
    const cz = bz + drift * (0.75 * Math.cos(tt * 0.017 + 2) + 0.25 * Math.sin(tt * 0.049));
    // Route speed is a ground speed (u/s) that scales with the fishes' Speed (pathSpeed is at Speed 0.5), so the schools
    // never outrun or hold back their fish. The phase is integrated, so changing Speed or the radius doesn't jump.
    const th = route.phase + (tt - route.t) * routeRate(A) + 0.7 + k * Math.PI * 2 / n, tw = th - tt * 0.013;
    const rr = A * (1 + wob * Math.sin(2 * tw)), dr = 2 * A * wob * Math.cos(2 * tw);
    const tx = dr * Math.cos(th) - rr * Math.sin(th), tz = dr * Math.sin(th) + rr * Math.cos(th), tl = Math.max(1e-3, Math.hypot(tx, tz));
    // Each school drifts slowly to either side of the route, so they never ride a rail.
    const lat = spread * 0.3 * Math.sin(tt * 0.037 + k * 2.1);
    let x = cx + rr * Math.cos(th) - tz / tl * lat, z = cz + rr * Math.sin(th) + tx / tl * lat;
    const ddx = x - homeXZ[0], ddz = z - homeXZ[1], dd = Math.hypot(ddx, ddz);
    if (ic > 10 && dd < 6) { x = homeXZ[0] + ddx / Math.max(dd, 0.01) * 6; z = homeXZ[1] + ddz / Math.max(dd, 0.01) * 6; }
    out[0] = Math.max(-lim, Math.min(lim, x)); out[2] = Math.max(-lim, Math.min(lim, z));
    // Slow rise and dip through the lantern cone (two incommensurate sines: no obvious period).
    const w = Math.PI * 2 / Math.max(5, roam.wanderPeriod);
    const wander = roam.wanderAmp * (0.7 * Math.sin(tt * w + k * 1.9) + 0.3 * Math.sin(tt * w * 1.63 + k * 0.7));
    out[1] = wander + Math.min(WORLD.surface - 1, Math.max(sampleHeight(seabed, out[0], out[2]) + 2.2,
      WORLD.bed + (WORLD.surface - WORLD.bed) * (roam.depthBase + roam.depthGather * g) + (k % 3) * roam.depthStep * (1 - 0.4 * g) + 0.65 * Math.sin(tt * (0.06 + k * 0.01) + k * 2.1)));
  }
  // The fish start as three formed schools where their roaming paths begin, already swimming along them
  // (not scattered at random across the sea).
  const groupCenters: [number, number, number][] = [], groupDirs: [number, number][] = [];
  env.schools.value = Math.max(1, Math.min(MAX_SCHOOLS, Number(query.get('schools')) || 3));
  for (let k = 0; k < env.schools.value; k++) {
    const a = [0, 0, 0], b = [0, 0, 0]; schoolPath(k, 0, a, 0, 0, 0); schoolPath(k, 0.6, b, 0, 0, 0);
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
    groupCenters.push([a[0], a[1], a[2]]); groupDirs.push([dx / l, dz / l]);
    env.attractDirs[k].value.set(dx / l, 0, dz / l); // start the rate-limited headings on the real paths
  }

  // ------------------------------------------------------------------ simulations
  const mainSim = createSim({
    renderer, env, count: N, seabed, cruise: 2.2, minSpeed: 0.9, maxSpeed: 3.6, millInfluence: 1, lureInfluence: 1, fearSensitivity: 1,
    homeClear: 0, homeStrength: 0, homeXZ: [0, 0], homeRadius: 99, clusters: 3, clusterRadius: 2.6, seed: 1, main: true,
    initialRing: startMilling, initialSpread: false, groupCenters, groupDirs,
  });

  // ------------------------------------------------------------------ meshes
  const lureInspect = (() => {
    // fish that are inspecting the lure face it
    return null;
  })();
  void lureInspect;
  // GPU culling + LOD: near fish draw the full-detail mesh, the rest the simplified one, both via drawIndexedIndirect
  const lod = createLod(renderer, mainSim, N, [main.full!.triCount * 3, main.lods[0].triCount * 3], MAIN_LENGTH * 2.2);
  main.full!.geometry.setIndirect(lod.args, 0); main.lods[0].geometry.setIndirect(lod.args, 20);
  lod.dist.value = Number(query.get('lod0')) || 15; // fish within 15 units of a camera use the detailed (wings + eyes) mesh
  const fishLook = schoolLook;
  const fishMeshes = createFishMesh(main, 0, 1, instanceFromSim(mainSim.read, 1, lod.read.list1, env.lurePos), MAIN_LENGTH, N, fishLook);
  const fishNear = createFishMesh(main, -1, null, instanceFromSim(mainSim.read, 1, lod.read.list0, env.lurePos), MAIN_LENGTH, N, fishLook);
  // the shadow proxy is not culled: it needs every fish index
  if (fishMeshes.shadowMesh) { const sm = createFishMesh(main, 0, 1, instanceFromSim(mainSim.read, 1, undefined, env.lurePos), MAIN_LENGTH, N, fishLook); fishMeshes.shadowMesh = sm.shadowMesh; }
  const lodStats = { near: 0, far: 0, triangles: 0 };

  // predator: one instance driven by uniforms
  const pU = { pos: uniform(new Vector3(0, -40, 0)), vel: uniform(new Vector3(1, 0, 0)), phase: uniform(0), bank: uniform(0), size: uniform(0) };
  const predInst: InstanceNodes = { P: pU.pos, V: pU.vel, phase: pU.phase, size: pU.size, flash: float(0), bank: pU.bank, hidden: float(0), fear: float(0), seed: float(0.5) };
  const steel = () => vec3(1);
  const predMeshes = createFishMesh(big, 0, null, predInst, PREDATOR_LENGTH, 1, { tint: steel, sparkle: 0.15, roughness: 0.28, procedural: true, predator: true });
  predMeshes.mesh.name = 'Dorado predator';
  const predatorLureFx = (await import('./dorado')).createDoradoLure(PREDATOR_LENGTH / big.length);
  scene.add(predatorLureFx.sprite);
  void instanceIndex;

  const all = [fishMeshes, fishNear, predMeshes];
  fishMeshes.mesh.name = 'Tropical school'; fishNear.mesh.name = 'Tropical school · near';
  for (const m of all) { scene.add(m.mesh); if (m.shadowMesh) scene.add(m.shadowMesh); }
  // Flying-fish splashes: droplets + foam rings from the sim's GPU ring buffer (launches and re-entries).
  const splashFx = createSplashes(scene, mainSim.splashes, env.clock);
  if (query.get('off')?.split(',').includes('splash')) splashFx.meshes.forEach(m => { m.visible = false; });
  predMeshes.mesh.castShadow = false;

  // shadows: proxies live on layer 1, which only the sun's shadow camera renders
  const sun = world.sun;
  const shadowState = { enabled: query.get('fishShadow') !== '0' };
  const selfShadow = { enabled: query.get('fishRecv') === '1' };
  function applyShadows() {
    const on = shadowState.enabled;
    if (on) {
      sun.castShadow = true;
      sun.shadow.camera.layers.enable(3); // proxies live on layer 3 (layer 1 is the water reflector's)
      const sc: any = sun.shadow.camera;
      if (sc.right !== undefined && sc.right === 5 && sc.left === -5) { sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.far = 60; sc.updateProjectionMatrix(); sun.shadow.mapSize.set(2048, 2048); }
    }
    for (const m of all) { if (m.shadowMesh) m.shadowMesh.visible = on; m.mesh.receiveShadow = selfShadow.enabled && on; }
    predMeshes.mesh.castShadow = on;
  }
  applyShadows();
  if (query.get('fishShadowTest') === '1') for (const t of world.terrain) t.receiveShadow = true; // debug: show fish shadows on the terrain

  // ------------------------------------------------------------------ state
  const stats: SchoolStats = { biterGrams: 0, nearLure: 0, biter: 'none', centroid: new Vector3(0, 6, 0), meanFear: 0 };
  const behaviour = { millingDirection: 1 as 1 | -1, milling: query.get('fishDemo') === 'milling' || query.get('milling') === '1', fountain: false };
  const predator = new Predator(seabed);
  const pend = { strike: 0, land: 0, lure: false, biterSince: -1, biterLocal: 'none' as SchoolStats['biter'], strikeQueued: false };
  let landUntil = 0, panicIdx = 0, statsPending = false, lastStats = 0;

  let panicEnv = 0;
  function panic(origin: Vector3, strength = 1) {
    panicEnv = Math.max(panicEnv, Math.min(1, strength));
    const k = panicIdx++ % 4;
    env.panicOrigin[k].value.set(origin.x, origin.y, origin.z, env.clock.value);
    const s = env.panicStrength.value; if (k === 0) s.x = strength; else if (k === 1) s.y = strength; else if (k === 2) s.z = strength; else s.w = strength;
  }
  const randomInSchool = () => new Vector3().copy(stats.centroid).add(new Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.6));

  function readStats() {
    statsPending = true;
    mainSim.stats();
    lod.readCounts().then(c => { lodStats.near = c[0]; lodStats.far = c[1]; lodStats.triangles = c[0] * main.full!.triCount + c[1] * main.lods[0].triCount; }).catch(() => {});
    renderer.getArrayBufferAsync(mainSim.statsAttr).then((buf: ArrayBuffer) => {
      const a = new Uint32Array(buf), n = Math.max(1, a[5]);
      stats.nearLure = a[0];
      if (a[5] > 0) {
        stats.centroid.set(a[1] / (CENTROID_SCALE * n) - CENTROID_OFFSET, a[2] / (CENTROID_SCALE * n) - CENTROID_OFFSET, a[3] / (CENTROID_SCALE * n) - CENTROID_OFFSET);
        stats.meanFear = Math.min(1, a[4] / (FEAR_SCALE * n));
      }
      // Slot 8 keeps the strike selection key (low 18 bits = fish index) until the next strike.
      if (a[8] !== 0xffffffff) stats.biterGrams = fishGrams(a[8] & 0x3ffff);
      const remote = performance.now() < landUntil ? 0 : a[6]; // ignore stale readbacks right after land()
      if (remote === 2) { stats.biter = 'hooked'; pend.biterSince = -1; }
      else if (remote === 1) { stats.biter = 'approaching'; pend.biterSince = -1; }
      else if (performance.now() - pend.biterSince > 700 || pend.biterSince < 0) { stats.biter = 'none'; }
      statsPending = false;
    }).catch(() => { statsPending = false; });
  }

  // Read the existing storage attribute through its read-only view; only one readback in flight.
  const splashClocks = new Float32Array(SPLASH_SLOTS).fill(-1000), splashPoint = new Vector3();
  let splashesPending = false, lastSplashes = 0;
  function readSplashes() {
    splashesPending = true;
    renderer.getArrayBufferAsync(mainSim.splashes.value).then((buf: ArrayBuffer) => {
      const a = new Float32Array(buf);
      // Pick up to four newest events, then consume every observed clock so excess events
      // cannot turn into a delayed burst on the next readback. Reuse this small index buffer.
      splashCandidates.fill(-1);
      for (let i = 0; i < SPLASH_SLOTS; i++) {
        const clock = a[i * 4 + 2], strength = a[i * 4 + 3];
        if (!Number.isFinite(clock) || clock <= splashClocks[i]) continue;
        splashClocks[i] = clock;
        const age = env.clock.value - clock;
        // The GPU float clock can round a fraction of a millisecond ahead of the CPU clock.
        if (age < -0.01 || age > 1 || !Number.isFinite(strength) || strength === 0
          || !Number.isFinite(a[i * 4]) || !Number.isFinite(a[i * 4 + 1])) continue;
        for (let j = 0; j < splashCandidates.length; j++) {
          if (splashCandidates[j] < 0 || clock > a[splashCandidates[j] * 4 + 2]) {
            for (let k = splashCandidates.length - 1; k > j; k--) splashCandidates[k] = splashCandidates[k - 1];
            splashCandidates[j] = i; break;
          }
        }
      }
      for (const i of splashCandidates) {
        if (i < 0) continue;
        const clock = a[i * 4 + 2], strength = a[i * 4 + 3];
        splashPoint.set(a[i * 4], WORLD.surface, a[i * 4 + 1]);
        world.ripple(splashPoint, Math.abs(strength) * (strength < 0 ? 0.5 : 0.9), 'fish',
          simTime.value - (env.clock.value - clock));
      }
    }).catch(() => {}).finally(() => { splashesPending = false; });
  }
  const splashCandidates = new Int32Array(4);

  let lastReal = performance.now();
  const school: School & { env: typeof env; predator: Predator } = {
    count: N, env, predator,
    stats,
    prewarm(seconds: number) {
      // Fixed 1/30 s steps on the GPU: the boids, roaming paths and gathering at the lantern all settle before the reveal.
      const steps = Math.ceil(seconds * 30);
      for (let k = 0; k < steps; k++) school.update(1 / 30);
    },
    update(dt: number) {
      const now = performance.now(), realDt = Math.min(0.1, (now - lastReal) / 1000); lastReal = now;
      env.dt.value = dt; env.clock.value += dt; env.frame.value += 1;
      // milling blend
      const target = behaviour.milling ? 1 : 0;
      env.millBlend.value += (target - env.millBlend.value) * (1 - Math.exp(-dt / 0.9));
      // predator (CPU, single fish)
      // 'Send predator' with the predator switched off: it appears for one charge, then leaves ~5 s later
      if (tempPred && predator.chargesDone > tempPredCharges) { tempPredTimer = 5; tempPredCharges = predator.chargesDone; }
      if (tempPred && tempPredTimer >= 0 && (tempPredTimer -= dt) < 0) tempPred = false;
      const wantPred = behaviour.fountain || tempPred;
      updateLureThreat(dt);
      predator.update(dt, stats.centroid, wantPred, behaviour.milling ? { center: env.millCenter.value, radius: env.millRadius.value } : null);
      updateAttractor(dt);
      pU.pos.value.copy(predator.pos); pU.vel.value.copy(predator.dir); pU.phase.value = simTime.value / big.period; pU.bank.value = predator.bank; pU.size.value = predator.scale;
      predMeshes.mesh.visible = predator.scale > 0.01;
      predatorLureFx.update(pU.pos.value, pU.vel.value, pU.bank.value, pU.size.value, pU.phase.value, simTime.value);
      env.predPos.value.copy(predator.pos); env.predVel.value.copy(predator.dir); env.predActive.value = predator.active ? 1 : 0;

      env.hooked.value = stats.biter === 'hooked' ? 1 : 0;
      env.strike.value = pend.strike; env.land.value = pend.land;
      if (!noSim) mainSim.step(pend.strike > 0);
      lod.update(ctx.camera, insetCamera);
      env.camPos.value.copy(ctx.camera.position);
      if (pend.strike > 0) pend.strike = 0;
      if (pend.land > 0 && --landFrames <= 0) pend.land = 0;

      if (follow) ctx.camera.position.copy(predator.pos).add(followOffset);
      if (!statsPending && now - lastStats > 100) { lastStats = now; readStats(); }
      if (!noSim && !splashesPending && now - lastSplashes > 100) { lastSplashes = now; readSplashes(); }
      void realDt;
    },
    panic,
    setInsetCamera(c) { insetCamera = c; },
    setMilling(on: boolean) { behaviour.milling = on; behaviourFolder?.refresh(); },
    setMillingDirection(d: 1 | -1) { behaviour.millingDirection = d; env.millDir.value = d; behaviourFolder?.refresh(); },
    sendPredator() { if (!behaviour.fountain) { tempPred = true; tempPredTimer = -1; tempPredCharges = predator.chargesDone; } predator.send(); },
    flash(origin?: Vector3) { panic(origin ?? randomInSchool(), 1); },
    behaviour: {
      get milling() { return behaviour.milling; },
      get millingDirection(): 1 | -1 { return env.millDir.value >= 0 ? 1 : -1; },
      get predator(): 'off' | 'cruising' | 'charging' { return !(behaviour.fountain || tempPred) ? 'off' : predator.mode === 'charge' ? 'charging' : 'cruising'; },
    },
    setLure(p: Vector3 | null) {
      if (p) { env.lurePos.value.copy(p); env.lureActive.value = 1; } else env.lureActive.value = 0;
    },
    setCuriosity(a: number) { env.curiosity.value = Math.max(0, Math.min(1, a)); },
    strike() {
      if (env.lureActive.value < 0.5 || stats.nearLure <= 0 || stats.biter !== 'none') return false;
      pend.strike = 1; pend.biterSince = performance.now(); stats.biter = 'approaching';
      return true;
    },
    land(caught: boolean) {
      if (stats.biter === 'none') return;
      pend.land = caught ? 1 : 2; landFrames = 3;
      if (!caught) panic(env.lurePos.value.clone(), 0.35);
      stats.biter = 'none'; pend.biterSince = -1; landUntil = performance.now() + 700;
    },
    addControls(folder: FolderApi) { controls(folder); },
  };
  let landFrames = 0;
  let ballW = 0, splitW = 0, modeT = 0, modeIdx = 0;
  // Natural travelling groups change density; milling is controlled explicitly by the user.
  const MODES: [string, number][] = [['schools', 48], ['ball', 16], ['schools', 36], ['split', 18]];
  let tempPred = false, tempPredTimer = -1, tempPredCharges = 0;
  let behaviourFolder: FolderApi | null = null;
  // the lure is a threat when dragged fast through the water (velocity derived from the positions setLure receives)
  const prevLure = new Vector3(); let hadLure = false, lureSpeed = 0;
  function updateLureThreat(dt: number) {
    const cur = env.lurePos.value, ok = env.lureActive.value > 0.5 && cur.y < WORLD.surface - 0.4;
    if (ok && hadLure && dt > 1e-4) {
      const vx = (cur.x - prevLure.x) / dt, vy = (cur.y - prevLure.y) / dt, vz = (cur.z - prevLure.z) / dt, sp = Math.hypot(vx, vy, vz);
      lureSpeed += (sp - lureSpeed) * Math.min(1, dt * 8);
      if (sp > 0.3) { const k = Math.min(1, dt * 10), lv = env.lureVel.value; lv.set(lv.x + (vx / sp - lv.x) * k, lv.y + (vy / sp - lv.y) * k, lv.z + (vz / sp - lv.z) * k); if (lv.lengthSq() < 1e-4) lv.set(1, 0, 0); }
    } else lureSpeed *= Math.exp(-dt * 6);
    prevLure.copy(cur); hadLure = ok;
    const t = Math.min(1, Math.max(0, (lureSpeed - 1.2) / 1.3));
    env.lureThreat.value = ok ? t * t * (3 - 2 * t) : 0;
  }
  let insetCamera: import('three/webgpu').PerspectiveCamera | null = null;
  // slowly wandering attractor the school follows loosely (keeps it off the walls and away from the island)
  let attT = 0;
  const curv = Array(MAX_SCHOOLS).fill(0), kick = Array(MAX_SCHOOLS).fill(0), kickTarget = Array(MAX_SCHOOLS).fill(0), nextKick = Array.from({ length: MAX_SCHOOLS }, (_, k) => 3 + k * 4);
  function updateAttractor(dt: number) {
    attT += dt;
    route.phase += dt * routeRate(roam.radius * (1 - 0.3 * Math.max(0, Math.min(1, roam.gather))) * (1 - 0.25 * ballW)); route.t = attT;
    const t = attT;
    panicEnv *= Math.exp(-dt / 3.2);
    modeT += dt; if (modeT > MODES[modeIdx][1]) { modeT = 0; modeIdx = (modeIdx + 1) % MODES.length; }
    const mode = roam.modes ? MODES[modeIdx][0] : 'schools', km = 1 - Math.exp(-dt * 0.3);
    ballW += ((mode === 'ball' ? 1 : 0) - ballW) * km; splitW += ((mode === 'split' ? 1 : 0) - splitW) * km;
    // density breathes; after a panic the school contracts defensively, then relaxes
    env.ballShape.value = ballW;
    env.axesScale.value = (1 + 0.14 * Math.sin(t * 0.35)) * (1 - 0.18 * panicEnv) * roam.size * (1 - 0.5 * Math.max(0, Math.min(1, roam.gather)));
    env.peel.value = roam.peelBase + roam.peelWave * Math.max(0, Math.sin(t * 0.13 + 1));
    // Parallel lanes breathe and drift slightly; the common route keeps their headings coherent.
    const n = Math.round(env.schools.value);
    for (let k = 0; k < n; k++) {
      nextKick[k] -= dt;
      if (nextKick[k] <= 0) { kickTarget[k] = (Math.random() - 0.5) * 1.6; nextKick[k] = 5 + Math.random() * 9; }
      kick[k] += (kickTarget[k] - kick[k]) * (1 - Math.exp(-dt * 0.6));
    }
    const path = (k: number, tt: number, out: number[]) => schoolPath(k, tt, out, kick[k], ballW, splitW);
    const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0], c: number[] = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      path(k, t, a); path(k, t + 0.6, b); path(k, t + 1.2, c);
      // Route curvature (heading change per unit length), smoothed: the school bends into the same arc.
      const h1 = Math.atan2(b[2] - a[2], b[0] - a[0]), h2 = Math.atan2(c[2] - b[2], c[0] - b[0]);
      const len = Math.max(0.05, Math.hypot(c[0] - a[0], c[2] - a[2]) / 2), kWant = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)) / len;
      curv[k] += (Math.max(-0.2, Math.min(0.2, kWant)) - curv[k]) * (1 - Math.exp(-dt * 0.8));
      env.attractors[k].value.set(a[0], a[1], a[2]);
      // The school's travel heading turns no faster than roam.pathTurn (rad/s): a jumping or tightly curving path
      // otherwise swings every fish's lane at once and the whole school wheels round on itself.
      const dx = b[0] - a[0], dz = b[2] - a[2], want = Math.atan2(dz, dx), d = env.attractDirs[k].value;
      const cur = Math.atan2(d.z, d.x), delta = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const step = Math.max(-roam.pathTurn * dt, Math.min(roam.pathTurn * dt, delta)), h = d.lengthSq() > 0.5 ? cur + step : want;
      d.set(Math.cos(h), curv[k], Math.sin(h));
    }
  }
  const noSim = query.get('fishNoSim') === '1';
  if (query.has('fishScan')) env.scanCap.value = Number(query.get('fishScan'));
  const follow = query.has('fishFollow'), fd = Number(query.get('fishFollow')) || 1, followOffset = new Vector3(4 * fd, 3.5 * fd, 6 * fd);
  if (query.get('fishNoSurface') === '1') world.surface.visible = false;
  if (query.get('fishHide') === '1') { fishMeshes.mesh.visible = false; fishNear.mesh.visible = false; if (fishMeshes.shadowMesh) fishMeshes.shadowMesh.visible = false; }

  function controls(folder: FolderApi) {
    const b = folder.addFolder({ title: 'Behaviours', expanded: true });
    behaviourFolder = b;
    b.addBinding(behaviour, 'milling', { label: 'Milling' });
    b.addBinding(behaviour, 'fountain', { label: 'Fountain (predator)' });
    b.addButton({ title: 'Send predator' }).on('click', () => school.sendPredator());
    b.addButton({ title: 'Flash expansion' }).on('click', () => panic(randomInSchool(), 1));
    b.addBinding({ count: N }, 'count', { readonly: true, label: 'Fish', format: (v: number) => v.toLocaleString() });
    b.addBinding(lodStats, 'near', { readonly: true, label: 'Visible LOD0', format: (v: number) => v.toLocaleString() });
    b.addBinding(lodStats, 'far', { readonly: true, label: 'Visible LOD1', format: (v: number) => v.toLocaleString() });
    b.addBinding(lod.dist, 'value', { label: 'LOD0 distance', min: 2, max: 20, step: 0.5 });

    const r = folder.addFolder({ title: 'Roaming', expanded: true });
    // The fish buffers are sized at boot: changing the count reloads the page with ?fish=N.
    r.addBinding({ fish: N }, 'fish', { label: 'Fish count', options: Object.fromEntries([2048, 4096, 8192, 12288, 16384, 24576, 32768].map(n => [n.toLocaleString(), n])) })
      .on('change', ev => { const url = new URL(location.href); url.searchParams.set('fish', String(ev.value)); location.assign(url); });
    r.addBinding(roam, 'gather', { label: 'Gather at light', min: 0, max: 1, step: 0.05 });
    const deg = { path: roam.pathTurn * 180 / Math.PI };
    r.addBinding(deg, 'path', { label: 'Path turn °/s', min: 2, max: 60, step: 1 }).on('change', () => { roam.pathTurn = deg.path * Math.PI / 180; });
    r.addBinding(roam, 'modes', { label: 'Bait-ball / split cycle' });
    r.addBinding(roam, 'routeOffsetZ', { label: 'Route offset Z', min: -10, max: 10, step: 0.1 });
    r.addBinding(roam, 'depthStep', { label: 'Lane depth step', min: 0, max: 2, step: 0.05 });
    r.addBinding(roam, 'wobble', { label: 'Loop wobble', min: 0, max: 0.3, step: 0.01 });
    r.addBinding(roam, 'pathSpeed', { label: 'Route speed', min: 0.2, max: 3, step: 0.05 });
    r.addBinding(env.schoolAxes.value, 'y', { label: 'School half width', min: 1, max: 8, step: 0.1 });
    r.addBinding(roam, 'depthBase', { label: 'Depth fraction', min: 0.2, max: 0.9, step: 0.01 });
    r.addBinding(roam, 'depthGather', { label: 'Gather rise', min: 0, max: 0.4, step: 0.01 });
    r.addBinding(roam, 'peelBase', { label: 'Peel fraction', min: 0, max: 0.3, step: 0.01 });
    r.addBinding(roam, 'peelWave', { label: 'Peel wave', min: 0, max: 0.3, step: 0.01 });
    r.addBinding(roam, 'wanderAmp', { label: 'Depth wander', min: 0, max: 4, step: 0.1 });
    r.addBinding(roam, 'wanderPeriod', { label: 'Wander period s', min: 8, max: 80, step: 1 });
    r.addBinding(env.schools, 'value', { label: 'Schools', min: 1, max: MAX_SCHOOLS, step: 1 });
    r.addBinding(roam, 'radius', { label: 'Roam radius', min: 1, max: 30, step: 0.1 });
    r.addBinding(roam, 'drift', { label: 'Centre drift', min: 0, max: 16, step: 0.1 });
    r.addBinding(roam, 'spread', { label: 'Group spread', min: 0, max: 3, step: 0.05 });
    r.addBinding(roam, 'size', { label: 'School size', min: 0.4, max: 2.5, step: 0.05 });
    r.addBinding(env.attractW, 'value', { label: 'Stick to group', min: 0, max: 2, step: 0.05 });
    r.addBinding(roam, 'area', { label: 'Swim area (half)', min: 4, max: WORLD.half - 0.6, step: 0.5 }).on('change', () => { env.swimHalf.value = roam.area; });

    const f = folder.addFolder({ title: 'Flocking', expanded: false });
    f.addBinding(env.speed, 'value', { label: 'Speed', min: 0.3, max: 2.5, step: 0.05 });
    f.addBinding(env.speedVar, 'value', { label: 'Speed variation ±', min: 0, max: 0.5, step: 0.01 });
    f.addBinding(env.cohY, 'value', { label: 'Cohesion Y (× XZ)', min: 0, max: 1, step: 0.05 });
    f.addBinding(env.depthJitter, 'value', { label: 'Depth spread ±', min: 0, max: 1.5, step: 0.05 });
    f.addBinding(env.headingW, 'value', { label: 'School heading', min: 0, max: 8, step: 0.1 });
    f.addBinding(env.edgeW, 'value', { label: 'School edge return', min: 0, max: 6, step: 0.1 });
    f.addBinding(env.wander, 'value', { label: 'Individual wander', min: 0, max: 2, step: 0.05 });
    f.addBinding(env.flow, 'value', { label: 'Flow field', min: 0, max: 2, step: 0.05 });
    f.addBinding(env.lateralWave, 'value', { label: 'Lateral wave', min: 0, max: 2, step: 0.05 });
    f.addBinding(env.undulation, 'value', { label: 'Undulation', min: 0, max: 3, step: 0.05 });
    const pitch = { deg: 20 };
    f.addBinding(pitch, 'deg', { label: 'Pitch limit °', min: 5, max: 60, step: 1 }).on('change', () => { env.pitchLimit.value = pitch.deg * Math.PI / 180; });
    const turn = { deg: env.turnRate.value * 180 / Math.PI };
    f.addBinding(turn, 'deg', { label: 'Turn rate °/s (calm)', min: 10, max: 120, step: 1 }).on('change', () => { env.turnRate.value = turn.deg * Math.PI / 180; });
    f.addBinding(env.camBubble, 'value', { label: 'Diver bubble', min: 0, max: 4, step: 0.1 });
    f.addBinding(env.sepW, 'value', { label: 'Separation', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.aliW, 'value', { label: 'Alignment', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.cohW, 'value', { label: 'Cohesion', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.sepSoftening, 'value', { label: 'Separation soft core', min: 0.03, max: 0.3, step: 0.01 });
    f.addBinding(env.sepR, 'value', { label: 'Separation radius', min: 0.2, max: 1.2, step: 0.01 });
    f.addBinding(env.neighR, 'value', { label: 'Neighbour radius', min: 0.4, max: 1.2, step: 0.01 });
    f.addBinding(env.scanCap, 'value', { label: 'Neighbours / cell', min: 1, max: 12, step: 1 });

    const m = folder.addFolder({ title: 'Milling', expanded: false });
    m.addBinding(env.millStrength, 'value', { label: 'Strength', min: 0, max: 2, step: 0.05 });
    m.addBinding(env.millRadius, 'value', { label: 'Radius', min: 3, max: 16, step: 0.1 });
    m.addBinding(env.millHeight, 'value', { label: 'Torus height', min: 0.5, max: 6, step: 0.1 });
    m.addBinding(env.millDir, 'value', { label: 'Direction', min: -1, max: 1, step: 2 });
    m.addBinding(env.millCenter.value, 'x', { label: 'Center X', min: -14, max: 14, step: 0.1 });
    m.addBinding(env.millCenter.value, 'z', { label: 'Center Z', min: -14, max: 14, step: 0.1 });

    const p = folder.addFolder({ title: 'Fountain', expanded: false });
    p.addBinding(predator, 'speed', { label: 'Predator speed', min: 3, max: 14, step: 0.1 });
    p.addBinding(env.fearRadius, 'value', { label: 'Fear radius', min: 1.5, max: 10, step: 0.1 });
    p.addBinding(env.fountain, 'value', { label: 'Fountain strength', min: 0, max: 2, step: 0.05 });
    p.addBinding(predator, 'interval', { label: 'Charge every (s)', min: 5, max: 60, step: 1 });

    const fl = folder.addFolder({ title: 'Flash / panic', expanded: false });
    fl.addBinding(env.calm, 'value', { label: 'Calm rate', min: 0.1, max: 3, step: 0.05 });
    fl.addBinding(env.panicSpeed, 'value', { label: 'Wave speed', min: 3, max: 20, step: 0.1 });
    fl.addBinding(env.burst, 'value', { label: 'Burst speed', min: 3, max: 18, step: 0.1 });
    fl.addBinding(env.transmission, 'value', { label: 'Transmission', min: 0.5, max: 1, step: 0.01 });
    fl.addBinding(visuals.flashGain, 'value', { label: 'Flash glint', min: 0, max: 3, step: 0.05 });

    const air = folder.addFolder({ title: 'Flying fish', expanded: false });
    air.addBinding(env.airRate, 'value', { label: 'Ambient flights', min: 0, max: 0.3, step: 0.002 });
    air.addBinding(env.airPanic, 'value', { label: 'Panic take-off /s', min: 0, max: 4, step: 0.05 });
    air.addBinding(env.airFlyers, 'value', { label: 'Flyers share', min: 0, max: 1, step: 0.01 });
    air.addBinding(env.airSpeed, 'value', { label: 'Exit speed', min: 2, max: 9, step: 0.1 });
    air.addBinding(env.airLift, 'value', { label: 'Glide lift', min: 0, max: 0.2, step: 0.005 });
    air.addBinding(env.airGravity, 'value', { label: 'Gravity', min: 1, max: 10, step: 0.1 });
    air.addBinding(splashGain, 'value', { label: 'Splash', min: 0, max: 3, step: 0.05 });

    const l = folder.addFolder({ title: 'Lure', expanded: false });
    l.addBinding(env.curiosityRadius, 'value', { label: 'Curiosity radius', min: 2, max: 10, step: 0.1 });

    const v = folder.addFolder({ title: 'Look', expanded: true });
    v.addBinding(visuals.sizeScale, 'value', { label: 'Fish size', min: 0.4, max: 2, step: 0.05 });
    v.addBinding(visuals.sizeVariation, 'value', { label: 'Size variation ±', min: 0, max: 0.6, step: 0.01 });
    v.addBinding(visuals.wobble, 'value', { label: 'Pitch/roll wobble', min: 0, max: 3, step: 0.05 });
    v.addBinding(visuals.lanternDiffuse, 'value', { label: 'Lantern on backs', min: 0, max: 2, step: 0.02 });
    v.addBinding(visuals.lanternSheen, 'value', { label: 'Lantern sheen', min: 0, max: 2, step: 0.02 });
    v.addBinding(visuals.lanternSpecular, 'value', { label: 'Lantern glints', min: 0, max: 3, step: 0.05 });
    v.addBinding(visuals.fogDensity, 'value', { label: 'Depth fog', min: 0, max: 3, step: 0.05 });
    v.addBinding(visuals.fogClear, 'value', { label: 'Fog-free distance', min: 0, max: 20, step: 0.5 });
    v.addBinding(visuals.lanternClarity, 'value', { label: 'Lantern lifts fog', min: 0, max: 1, step: 0.05 });
    v.addBinding(visuals.lanternPool, 'value', { label: 'Lantern pool radius', min: 2, max: 25, step: 0.5 });
    v.addBinding(visuals.ambientGlint, 'value', { label: 'Natural glints', min: 0, max: 2, step: 0.05 });
    v.addBinding(visuals.sheen, 'value', { label: 'Body sheen', min: 0, max: 2, step: 0.05 });
    v.addBinding(visuals.causticsAmount, 'value', { label: 'Caustics', min: 0, max: 2, step: 0.05 });
    v.addBinding(shadowState, 'enabled', { label: 'Cast shadows' }).on('change', applyShadows);
    v.addBinding(selfShadow, 'enabled', { label: 'Self shadows' }).on('change', applyShadows);
  }

  // ------------------------------------------------------------------ debug hooks (kept)
  const camMode = query.get('fishCam');
  if (camMode) {
    const presets: Record<string, [number, number, number]> = { close: [9, 7, 13], mid: [16, 12, 21], top: [4, 42, 10] };
    const v = presets[camMode] ?? (camMode.split(',').map(Number) as [number, number, number]);
    if (v.length === 3 && v.every(Number.isFinite)) ctx.camera.position.set(v[0], v[1], v[2]);
  }
  const demo = query.get('fishDemo');
  if (demo === 'fountain') { behaviour.fountain = true; setTimeout(() => predator.send(), 2500); }
  if (demo === 'panic') setInterval(() => panic(randomInSchool(), 1), 5000);
  if (demo === 'flash') setInterval(() => panic(randomInSchool(), 1), 6000);
  (window as any).fishDebug = { school, camera: ctx.camera, lodStats, behaviour, env, tris, visuals, readPos: async () => new Float32Array(await renderer.getArrayBufferAsync(mainSim.pos.value)), readAux: async () => new Float32Array(await renderer.getArrayBufferAsync(mainSim.aux.value)), readVel: async () => new Float32Array(await renderer.getArrayBufferAsync(mainSim.vel.value)), panic: (x: number, y: number, z: number, s = 1) => panic(new Vector3(x, y, z), s) };
  void simTime; void Vector4; void SWIM_BOUNDS; void sampleHeight;

  return school;
}
