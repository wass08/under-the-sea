/* eslint-disable @typescript-eslint/no-explicit-any */
import { CylinderGeometry, Mesh, MeshStandardNodeMaterial, Vector3, Vector4 } from 'three/webgpu';
import * as TSL from 'three/tsl';
const { float, uniform, vec3, hash, instanceIndex } = TSL as any;
import type { FolderApi } from 'tweakpane';
import type { Ctx, School, SchoolStats, World } from '../contracts';
import { BASIN, ISLAND, QUERY, SWIM_BOUNDS, WORLD } from '../config';
import { loadFishAsset } from './geometry';
import { createEnv, createSim, sampleHeight, CENTROID_OFFSET, CENTROID_SCALE, FEAR_SCALE } from './sim';
import { createFishMesh, instanceFromSim, visuals } from './render';
import type { InstanceNodes } from './render';
import { Predator } from './predator';
import { createLod } from './lod';
import { simTime } from '../state';

const MAIN_LENGTH = 0.3, ANGEL_LENGTH = 0.6, ANGEL_COUNT = 512, PREDATOR_LENGTH = 1.4;
const base = import.meta.env.BASE_URL;
const query = new URLSearchParams(location.search);

export async function createSchool(ctx: Ctx, world: World): Promise<School> {
  const { renderer, scene } = ctx;
  // with the 36-unit world, fish need ~1-2 body lengths of clear space to stay individually readable: default to 16384 unless ?fish= is given
  const N = query.has('fish') ? QUERY.fish : 12288;
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
  const [main, angel, big] = await Promise.all([
    loadFishAsset(`${base}models/fish_01.glb`, { frames: 32, body: 280, fins: 90, eye: 20, proxies: [70], full: { eye: 700 } }),
    loadFishAsset(`${base}models/angel_fish.glb`, { frames: 32, body: 520, fins: 0, eye: 24, proxies: [140] }),
    loadFishAsset(`${base}models/fish_02.glb`, { frames: 32, body: 1500, fins: 0, eye: 60, proxies: [] }),
  ]);
  const tris = { fish: main.lods[0].triCount, fishShadow: main.lods[1].triCount, angel: angel.lods[0].triCount, angelShadow: angel.lods[1].triCount, predator: big.lods[0].triCount };
  console.info('[fish] triangles per fish', tris, 'vertices', main.lods[0].vertexCount);

  // ------------------------------------------------------------------ island centre (for the angelfish)
  let ix = 0, iz = 0, ic = 0;
  const { heights, resolution } = seabed;
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) if (heights[z * resolution + x] > WORLD.surface) { ix += -WORLD.half + (x + 0.5) / resolution * 2 * WORLD.half; iz += -WORLD.half + (z + 0.5) / resolution * 2 * WORLD.half; ic++; }
  const homeXZ: [number, number] = ic > 10 ? [ix / ic, iz / ic] : [ISLAND.x, ISLAND.z];

  env.millCenter.value.x = BASIN.x; env.millCenter.value.z = BASIN.z; env.millRadius.value = 6; // milling ring / tornado in the open basin
  // ------------------------------------------------------------------ simulations
  const mainSim = createSim({
    renderer, env, count: N, seabed, cruise: 3.0, minSpeed: 1.4, maxSpeed: 5.0, millInfluence: 1, lureInfluence: 1, fearSensitivity: 1,
    homeClear: 0, homeStrength: 0, homeXZ: [0, 0], homeRadius: 99, clusters: 3, clusterRadius: 3.0, seed: 1, main: true,
    groupCenters: [0, 1, 2].map(k => [BASIN.x + Math.cos(k * 2.094) * 6, 6.4, BASIN.z + Math.sin(k * 2.094) * 6] as [number, number, number]),
  });
  const angelSim = createSim({
    renderer, env, count: ANGEL_COUNT, seabed, cruise: 1.1, minSpeed: 0.45, maxSpeed: 2.4, millInfluence: 0.25, lureInfluence: 0, fearSensitivity: 0.7,
    homeClear: 2.4, homeStrength: 1.6, homeXZ, homeRadius: 9, clusters: 3, clusterRadius: 2.5, seed: 2, main: false,
  });

  // ------------------------------------------------------------------ meshes
  const lureInspect = (() => {
    // fish that are inspecting the lure face it
    return null;
  })();
  void lureInspect;
  const silver = (seed: any) => vec3(1).add(vec3(hash(seed.mul(91)), hash(seed.mul(57)), hash(seed.mul(33))).sub(0.5).mul(0.2));
  // GPU culling + LOD: near fish draw the full-detail mesh, the rest the simplified one, both via drawIndexedIndirect
  const lod = createLod(renderer, mainSim, N, [main.full!.triCount * 3, main.lods[0].triCount * 3], MAIN_LENGTH * 2.2);
  main.full!.geometry.setIndirect(lod.args, 0); main.lods[0].geometry.setIndirect(lod.args, 20);
  const fishLook = { tint: silver, sparkle: 1, roughness: 0.62, shape: [1.1, 0.82] as [number, number] };
  const fishMeshes = createFishMesh(main, 0, 1, instanceFromSim(mainSim.read, 1, lod.read.list1), MAIN_LENGTH, N, fishLook);
  const fishNear = createFishMesh(main, -1, null, instanceFromSim(mainSim.read, 1, lod.read.list0), MAIN_LENGTH, N, fishLook);
  // the shadow proxy is not culled: it needs every fish index
  if (fishMeshes.shadowMesh) { const sm = createFishMesh(main, 0, 1, instanceFromSim(mainSim.read, 1), MAIN_LENGTH, N, fishLook); fishMeshes.shadowMesh = sm.shadowMesh; }
  const lodStats = { near: 0, far: 0 };
  const angelMeshes = createFishMesh(angel, 0, 1, instanceFromSim(angelSim.read, 2), ANGEL_LENGTH, ANGEL_COUNT, { tint: silver, sparkle: 0.6, roughness: 0.6 });

  // predator: one instance driven by uniforms
  const pU = { pos: uniform(new Vector3(0, -40, 0)), vel: uniform(new Vector3(1, 0, 0)), phase: uniform(0), bank: uniform(0), size: uniform(0) };
  const predInst: InstanceNodes = { P: pU.pos, V: pU.vel, phase: pU.phase, size: pU.size, flash: float(0), bank: pU.bank, hidden: float(0), fear: float(0), seed: float(0.5) };
  const steel = () => vec3(1);
  const predMeshes = createFishMesh(big, 0, null, predInst, PREDATOR_LENGTH, 1, { tint: steel, sparkle: 0.15, roughness: 0.4, shape: [1.3, 0.85], procedural: true });
  void instanceIndex;

  const all = [fishMeshes, fishNear, angelMeshes, predMeshes];
  for (const m of all) { scene.add(m.mesh); if (m.shadowMesh) scene.add(m.shadowMesh); }
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
  const stats: SchoolStats = { nearLure: 0, biter: 'none', centroid: new Vector3(0, 6, 0), meanFear: 0 };
  const behaviour = { millingDirection: 1 as 1 | -1, milling: query.get('fishDemo') === 'milling' || query.get('milling') === '1', fountain: false, angel: true };
  const predator = new Predator(seabed);
  const pend = { strike: 0, land: 0, lure: false, biterSince: -1, biterLocal: 'none' as SchoolStats['biter'], strikeQueued: false };
  const angelOn = () => behaviour.angel;
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
    lod.readCounts().then(c => { lodStats.near = c[0]; lodStats.far = c[1]; }).catch(() => {});
    renderer.getArrayBufferAsync(mainSim.statsAttr).then((buf: ArrayBuffer) => {
      const a = new Uint32Array(buf), n = Math.max(1, a[5]);
      stats.nearLure = a[0];
      if (a[5] > 0) {
        stats.centroid.set(a[1] / (CENTROID_SCALE * n) - CENTROID_OFFSET, a[2] / (CENTROID_SCALE * n) - CENTROID_OFFSET, a[3] / (CENTROID_SCALE * n) - CENTROID_OFFSET);
        stats.meanFear = Math.min(1, a[4] / (FEAR_SCALE * n));
      }
      const remote = performance.now() < landUntil ? 0 : a[6]; // ignore stale readbacks right after land()
      if (remote === 2) { stats.biter = 'hooked'; pend.biterSince = -1; }
      else if (remote === 1) { stats.biter = 'approaching'; pend.biterSince = -1; }
      else if (performance.now() - pend.biterSince > 700 || pend.biterSince < 0) { stats.biter = 'none'; }
      statsPending = false;
    }).catch(() => { statsPending = false; });
  }

  let lastReal = performance.now();
  const school: School & { env: typeof env; predator: Predator } = {
    count: N, env, predator,
    stats,
    update(dt: number) {
      const now = performance.now(), realDt = Math.min(0.1, (now - lastReal) / 1000); lastReal = now;
      env.dt.value = dt; env.clock.value += dt; env.frame.value += 1;
      // milling blend
      const target = behaviour.milling ? 1 : Math.max(0, autoRing);
      env.millBlend.value += (target - env.millBlend.value) * (1 - Math.exp(-dt / 0.9));
      // predator (CPU, single fish)
      // 'Send predator' with the predator switched off: it appears for one charge, then leaves ~5 s later
      if (tempPred && predator.chargesDone > tempPredCharges) { tempPredTimer = 5; tempPredCharges = predator.chargesDone; }
      if (tempPred && tempPredTimer >= 0 && (tempPredTimer -= dt) < 0) tempPred = false;
      const wantPred = behaviour.fountain || tempPred;
      updateLureThreat(dt);
      predator.update(dt, stats.centroid, wantPred);
      updateAttractor(dt);
      pU.pos.value.copy(predator.pos); pU.vel.value.copy(predator.dir); pU.phase.value = predator.phase; pU.bank.value = predator.bank; pU.size.value = predator.scale;
      predMeshes.mesh.visible = predator.scale > 0.01;
      env.predPos.value.copy(predator.pos); env.predVel.value.copy(predator.dir); env.predActive.value = predator.active ? 1 : 0;

      env.hooked.value = stats.biter === 'hooked' ? 1 : 0;
      env.strike.value = pend.strike; env.land.value = pend.land;
      if (!noSim) mainSim.step(pend.strike > 0);
      lod.update(ctx.camera, insetCamera);
      if (angelOn()) angelSim.step(false);
      if (pend.strike > 0) pend.strike = 0;
      if (pend.land > 0 && --landFrames <= 0) pend.land = 0;
      angelMeshes.mesh.visible = angelOn();
      if (angelMeshes.shadowMesh) angelMeshes.shadowMesh.visible = angelOn() && shadowState.enabled;

      if (follow) ctx.camera.position.copy(predator.pos).add(followOffset);
      if (!statsPending && now - lastStats > 100) { lastStats = now; readStats(); }
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
  let autoRing = 0, ballW = 0, splitW = 0, modeT = 0, modeIdx = 0;
  // mode scheduler (like the reference's ball / tornado / ring / split): the school keeps changing shape, cross-faded
  const MODES: [string, number][] = [['schools', 26], ['ball', 15], ['schools', 18], ['ring', 20], ['schools', 22], ['split', 16]];
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
  const kick = [0, 0, 0], kickTarget = [0, 0, 0], nextKick = [3, 7, 11];
  function updateAttractor(dt: number) {
    attT += dt;
    const t = attT;
    panicEnv *= Math.exp(-dt / 3.2);
    modeT += dt; if (modeT > MODES[modeIdx][1]) { modeT = 0; modeIdx = (modeIdx + 1) % MODES.length; }
    const mode = MODES[modeIdx][0], km = 1 - Math.exp(-dt * 0.3);
    ballW += ((mode === 'ball' ? 1 : 0) - ballW) * km; splitW += ((mode === 'split' ? 1 : 0) - splitW) * km; autoRing += ((mode === 'ring' ? 0.85 : 0) - autoRing) * km;
    // density breathes; after a panic the school contracts defensively, then relaxes
    env.axesScale.value = (1 + 0.28 * Math.sin(t * 0.35)) * (1 + 0.45 * ballW) * (1 - 0.5 * panicEnv);
    env.peel.value = 0.03 + 0.15 * Math.max(0, Math.sin(t * 0.13 + 1));
    // three sub-group attractors: a shared wandering centre plus offsets whose spread breathes, so groups split and merge
    // three sub-schools sail around the island; their angular spread breathes so they separate and merge
    // leaders occasionally swerve: the group's angular offset jumps and eases toward a new value
    for (let k = 0; k < 3; k++) {
      nextKick[k] -= dt;
      if (nextKick[k] <= 0) { kickTarget[k] = (Math.random() - 0.5) * 1.6; nextKick[k] = 5 + Math.random() * 9; }
      kick[k] += (kickTarget[k] - kick[k]) * (1 - Math.exp(-dt * 0.6));
    }
    const lim = WORLD.half - 5, path = (k: number, tt: number, out: number[]) => {
      const spread = (2.0 * (0.5 + 0.5 * Math.sin(tt * 0.05 + 1.0)) + kick[k]) * (1 - ballW) * (1 + 0.6 * splitW);
      const th = tt * 0.11 + 0.7 + (k - 1) * spread + 0.2 * Math.sin(tt * (0.09 + k * 0.03) + k), r = 7 + 2.5 * Math.sin(tt * (0.04 + k * 0.017) + k * 2.0);
      // the schools wander around a centre that itself drifts inside the open basin, and never head for the island
      const bx = BASIN.x + 4 * Math.sin(tt * 0.031 + 1), bz = BASIN.z + 3.5 * Math.sin(tt * 0.043);
      let x = bx + Math.cos(th) * r, z = bz + Math.sin(th) * r;
      const ddx = x - homeXZ[0], ddz = z - homeXZ[1], dd = Math.hypot(ddx, ddz);
      if (dd < 11.5) { x = homeXZ[0] + ddx / dd * 11.5; z = homeXZ[1] + ddz / dd * 11.5; }
      out[0] = Math.max(-lim, Math.min(lim, x)); out[2] = Math.max(-lim, Math.min(lim, z));
      out[1] = 6.4 + 1.2 * Math.sin(tt * (0.11 + k * 0.05) + k * 2.1);
    };
    const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      path(k, t, a); path(k, t + 0.6, b);
      env.attractors[k].value.set(a[0], a[1], a[2]);
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      env.attractDirs[k].value.set(dx / l, 0, dz / l);
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
    b.addBinding(behaviour, 'angel', { label: 'Angel fish' });
    b.addBinding({ count: N }, 'count', { readonly: true, label: 'Fish', format: (v: number) => v.toLocaleString() });
    b.addBinding(lodStats, 'near', { readonly: true, label: 'Visible LOD0', format: (v: number) => v.toLocaleString() });
    b.addBinding(lodStats, 'far', { readonly: true, label: 'Visible LOD1', format: (v: number) => v.toLocaleString() });
    b.addBinding(lod.dist, 'value', { label: 'LOD0 distance', min: 2, max: 20, step: 0.5 });

    const f = folder.addFolder({ title: 'Flocking', expanded: false });
    f.addBinding(env.speed, 'value', { label: 'Speed', min: 0.3, max: 2.5, step: 0.05 });
    f.addBinding(env.sepW, 'value', { label: 'Separation', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.aliW, 'value', { label: 'Alignment', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.cohW, 'value', { label: 'Cohesion', min: 0, max: 4, step: 0.05 });
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

    const l = folder.addFolder({ title: 'Lure', expanded: false });
    l.addBinding(env.curiosityRadius, 'value', { label: 'Curiosity radius', min: 2, max: 10, step: 0.1 });

    const v = folder.addFolder({ title: 'Look', expanded: false });
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
