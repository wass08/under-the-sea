/* eslint-disable @typescript-eslint/no-explicit-any */
import { CylinderGeometry, Mesh, MeshStandardNodeMaterial, Vector3, Vector4 } from 'three/webgpu';
import * as TSL from 'three/tsl';
const { float, uniform, vec3, hash, instanceIndex } = TSL as any;
import type { FolderApi } from 'tweakpane';
import type { Ctx, School, SchoolStats, World } from '../contracts';
import { QUERY, SWIM_BOUNDS, WORLD } from '../config';
import { loadFishAsset } from './geometry';
import { createEnv, createSim, sampleHeight, CENTROID_OFFSET, CENTROID_SCALE, FEAR_SCALE } from './sim';
import { createFishMesh, instanceFromSim, visuals } from './render';
import type { InstanceNodes } from './render';
import { Predator } from './predator';
import { simTime } from '../state';

const MAIN_LENGTH = 0.22, ANGEL_LENGTH = 0.46, ANGEL_COUNT = 512, PREDATOR_LENGTH = 1.55;
const base = import.meta.env.BASE_URL;
const query = new URLSearchParams(location.search);

export async function createSchool(ctx: Ctx, world: World): Promise<School> {
  const { renderer, scene } = ctx;
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
  const [main, angel, big] = await Promise.all([
    loadFishAsset(`${base}models/fish_01.glb`, { frames: 32, body: 300, fins: 90, eye: 22, proxies: [110] }),
    loadFishAsset(`${base}models/angel_fish.glb`, { frames: 32, body: 520, fins: 0, eye: 24, proxies: [140] }),
    loadFishAsset(`${base}models/fish_02.glb`, { frames: 32, body: 1500, fins: 0, eye: 60, proxies: [] }),
  ]);
  const tris = { fish: main.lods[0].triCount, fishShadow: main.lods[1].triCount, angel: angel.lods[0].triCount, angelShadow: angel.lods[1].triCount, predator: big.lods[0].triCount };
  console.info('[fish] triangles per fish', tris, 'vertices', main.lods[0].vertexCount);

  // ------------------------------------------------------------------ island centre (for the angelfish)
  let ix = 0, iz = 0, ic = 0;
  const { heights, resolution } = seabed;
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) if (heights[z * resolution + x] > WORLD.surface) { ix += -WORLD.half + (x + 0.5) / resolution * 2 * WORLD.half; iz += -WORLD.half + (z + 0.5) / resolution * 2 * WORLD.half; ic++; }
  const homeXZ: [number, number] = ic > 10 ? [ix / ic, iz / ic] : [-2.2, -2.2];

  // ------------------------------------------------------------------ simulations
  const mainSim = createSim({
    renderer, env, count: N, seabed, cruise: 1.4, minSpeed: 0.55, maxSpeed: 2.4, millInfluence: 1, lureInfluence: 1, fearSensitivity: 1,
    homeClear: 0, homeStrength: 0, homeXZ: [0, 0], homeRadius: 99, clusters: 5, clusterRadius: 1.5, seed: 1, main: true,
  });
  const angelSim = createSim({
    renderer, env, count: ANGEL_COUNT, seabed, cruise: 0.75, minSpeed: 0.3, maxSpeed: 1.6, millInfluence: 0.25, lureInfluence: 0, fearSensitivity: 0.7,
    homeClear: 1.5, homeStrength: 1.6, homeXZ, homeRadius: 3.2, clusters: 3, clusterRadius: 1.0, seed: 2, main: false,
  });

  // ------------------------------------------------------------------ meshes
  const lureInspect = (() => {
    // fish that are inspecting the lure face it
    return null;
  })();
  void lureInspect;
  const silver = (seed: any) => vec3(1).add(vec3(hash(seed.mul(91)), hash(seed.mul(57)), hash(seed.mul(33))).sub(0.5).mul(0.2));
  const fishMeshes = createFishMesh(main, 0, 1, instanceFromSim(mainSim.read, 1), MAIN_LENGTH, N, { tint: silver, sparkle: 1, roughness: 0.62 });
  const angelMeshes = createFishMesh(angel, 0, 1, instanceFromSim(angelSim.read, 2), ANGEL_LENGTH, ANGEL_COUNT, { tint: silver, sparkle: 0.6, roughness: 0.6 });

  // predator: one instance driven by uniforms
  const pU = { pos: uniform(new Vector3(0, -40, 0)), vel: uniform(new Vector3(1, 0, 0)), phase: uniform(0), bank: uniform(0), size: uniform(0) };
  const predInst: InstanceNodes = { P: pU.pos, V: pU.vel, phase: pU.phase, size: pU.size, flash: float(0), bank: pU.bank, hidden: float(0), fear: float(0), seed: float(0.5) };
  const steel = () => vec3(0.38, 0.45, 0.55);
  const predMeshes = createFishMesh(big, 0, null, predInst, PREDATOR_LENGTH, 1, { tint: steel, sparkle: 0.35, roughness: 0.55 });
  void instanceIndex;

  const all = [fishMeshes, angelMeshes, predMeshes];
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
  const stats: SchoolStats = { nearLure: 0, biter: 'none', centroid: new Vector3(0.5, 4, 0.5), meanFear: 0 };
  const behaviour = { milling: query.get('fishDemo') === 'milling' || query.get('milling') === '1', fountain: false, angel: true };
  const predator = new Predator(seabed);
  const pend = { strike: 0, land: 0, lure: false, biterSince: -1, biterLocal: 'none' as SchoolStats['biter'], strikeQueued: false };
  const angelOn = () => behaviour.angel;
  let panicIdx = 0, statsPending = false, lastStats = 0;

  function panic(origin: Vector3, strength = 1) {
    const k = panicIdx++ % 4;
    env.panicOrigin[k].value.set(origin.x, origin.y, origin.z, env.clock.value);
    const s = env.panicStrength.value; if (k === 0) s.x = strength; else if (k === 1) s.y = strength; else if (k === 2) s.z = strength; else s.w = strength;
  }
  const randomInSchool = () => new Vector3().copy(stats.centroid).add(new Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.6));

  function readStats() {
    statsPending = true;
    mainSim.stats();
    renderer.getArrayBufferAsync(mainSim.statsAttr).then((buf: ArrayBuffer) => {
      const a = new Uint32Array(buf), n = Math.max(1, a[5]);
      stats.nearLure = a[0];
      if (a[5] > 0) {
        stats.centroid.set(a[1] / (CENTROID_SCALE * n) - CENTROID_OFFSET, a[2] / (CENTROID_SCALE * n) - CENTROID_OFFSET, a[3] / (CENTROID_SCALE * n) - CENTROID_OFFSET);
        stats.meanFear = Math.min(1, a[4] / (FEAR_SCALE * n));
      }
      const remote = a[6];
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
      const target = behaviour.milling ? 1 : 0;
      env.millBlend.value += (target - env.millBlend.value) * (1 - Math.exp(-dt / 0.9));
      // predator (CPU, single fish)
      const wantPred = behaviour.fountain;
      predator.update(dt, stats.centroid, wantPred);
      updateAttractor(dt);
      pU.pos.value.copy(predator.pos); pU.vel.value.copy(predator.dir); pU.phase.value = predator.phase; pU.bank.value = predator.bank; pU.size.value = predator.scale;
      predMeshes.mesh.visible = predator.scale > 0.01;
      env.predPos.value.copy(predator.pos); env.predVel.value.copy(predator.dir); env.predActive.value = predator.active ? 1 : 0;

      env.strike.value = pend.strike; env.land.value = pend.land;
      if (!noSim) mainSim.step(pend.strike > 0);
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
      stats.biter = 'none'; pend.biterSince = -1;
    },
    addControls(folder: FolderApi) { controls(folder); },
  };
  let landFrames = 0;
  // slowly wandering attractor the school follows loosely (keeps it off the walls and away from the island)
  let attT = 0;
  function updateAttractor(dt: number) {
    attT += dt;
    const t = attT, a = env.attractor.value;
    let x = 3.4 * Math.sin(t * 0.075 + 0.5) + 1.2 * Math.sin(t * 0.19), z = 3.4 * Math.sin(t * 0.058 + 2.0) + 1.2 * Math.cos(t * 0.17);
    const dx = x - homeXZ[0], dz = z - homeXZ[1], d = Math.hypot(dx, dz);
    if (ic > 10 && d < 4.2) { x = homeXZ[0] + dx / d * 4.2; z = homeXZ[1] + dz / d * 4.2; }
    a.set(Math.max(-4.2, Math.min(4.2, x)), 4.1 + 1.0 * Math.sin(t * 0.13 + 1) + 0.5 * Math.sin(t * 0.31), Math.max(-4.2, Math.min(4.2, z)));
  }
  const noSim = query.get('fishNoSim') === '1';
  const follow = query.has('fishFollow'), fd = Number(query.get('fishFollow')) || 1, followOffset = new Vector3(2.5 * fd, 2.2 * fd, 3.5 * fd);
  if (query.get('fishNoSurface') === '1') world.surface.visible = false;
  if (query.get('fishHide') === '1') { fishMeshes.mesh.visible = false; if (fishMeshes.shadowMesh) fishMeshes.shadowMesh.visible = false; }

  function controls(folder: FolderApi) {
    const b = folder.addFolder({ title: 'Behaviours', expanded: true });
    b.addBinding(behaviour, 'milling', { label: 'Milling' });
    b.addBinding(behaviour, 'fountain', { label: 'Fountain (predator)' });
    b.addButton({ title: 'Send predator' }).on('click', () => { behaviour.fountain = true; b.refresh(); predator.send(); });
    b.addButton({ title: 'Flash expansion' }).on('click', () => panic(randomInSchool(), 1));
    b.addBinding(behaviour, 'angel', { label: 'Angel fish' });
    b.addBinding({ count: N }, 'count', { readonly: true, label: 'Fish', format: (v: number) => v.toLocaleString() });

    const f = folder.addFolder({ title: 'Flocking', expanded: false });
    f.addBinding(env.speed, 'value', { label: 'Speed', min: 0.3, max: 2.5, step: 0.05 });
    f.addBinding(env.sepW, 'value', { label: 'Separation', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.aliW, 'value', { label: 'Alignment', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.cohW, 'value', { label: 'Cohesion', min: 0, max: 4, step: 0.05 });
    f.addBinding(env.sepR, 'value', { label: 'Separation radius', min: 0.1, max: 0.6, step: 0.01 });
    f.addBinding(env.neighR, 'value', { label: 'Neighbour radius', min: 0.2, max: 0.6, step: 0.01 });
    f.addBinding(env.scanCap, 'value', { label: 'Neighbours / cell', min: 1, max: 12, step: 1 });

    const m = folder.addFolder({ title: 'Milling', expanded: false });
    m.addBinding(env.millStrength, 'value', { label: 'Strength', min: 0, max: 2, step: 0.05 });
    m.addBinding(env.millRadius, 'value', { label: 'Radius', min: 0.8, max: 4.5, step: 0.05 });
    m.addBinding(env.millHeight, 'value', { label: 'Torus height', min: 0.2, max: 3, step: 0.05 });
    m.addBinding(env.millDir, 'value', { label: 'Direction', min: -1, max: 1, step: 2 });
    m.addBinding(env.millCenter.value, 'x', { label: 'Center X', min: -4, max: 4, step: 0.1 });
    m.addBinding(env.millCenter.value, 'z', { label: 'Center Z', min: -4, max: 4, step: 0.1 });

    const p = folder.addFolder({ title: 'Fountain', expanded: false });
    p.addBinding(predator, 'speed', { label: 'Predator speed', min: 2, max: 10, step: 0.1 });
    p.addBinding(env.fearRadius, 'value', { label: 'Fear radius', min: 1, max: 6, step: 0.1 });
    p.addBinding(env.fountain, 'value', { label: 'Fountain strength', min: 0, max: 2, step: 0.05 });
    p.addBinding(predator, 'interval', { label: 'Charge every (s)', min: 5, max: 60, step: 1 });

    const fl = folder.addFolder({ title: 'Flash / panic', expanded: false });
    fl.addBinding(env.calm, 'value', { label: 'Calm rate', min: 0.1, max: 3, step: 0.05 });
    fl.addBinding(env.panicSpeed, 'value', { label: 'Wave speed', min: 2, max: 14, step: 0.1 });
    fl.addBinding(env.burst, 'value', { label: 'Burst speed', min: 2, max: 10, step: 0.1 });
    fl.addBinding(env.transmission, 'value', { label: 'Transmission', min: 0.5, max: 1, step: 0.01 });
    fl.addBinding(visuals.flashGain, 'value', { label: 'Flash glint', min: 0, max: 3, step: 0.05 });

    const l = folder.addFolder({ title: 'Lure', expanded: false });
    l.addBinding(env.curiosityRadius, 'value', { label: 'Curiosity radius', min: 1, max: 5, step: 0.1 });

    const v = folder.addFolder({ title: 'Look', expanded: false });
    v.addBinding(visuals.sheen, 'value', { label: 'Body sheen', min: 0, max: 2, step: 0.05 });
    v.addBinding(visuals.causticsAmount, 'value', { label: 'Caustics', min: 0, max: 2, step: 0.05 });
    v.addBinding(shadowState, 'enabled', { label: 'Cast shadows' }).on('change', applyShadows);
    v.addBinding(selfShadow, 'enabled', { label: 'Self shadows' }).on('change', applyShadows);
  }

  // ------------------------------------------------------------------ debug hooks (kept)
  const camMode = query.get('fishCam');
  if (camMode) {
    const presets: Record<string, [number, number, number]> = { close: [3.6, 4.4, 5.2], mid: [7, 5.5, 9], top: [0.5, 15, 3] };
    const v = presets[camMode] ?? (camMode.split(',').map(Number) as [number, number, number]);
    if (v.length === 3 && v.every(Number.isFinite)) ctx.camera.position.set(v[0], v[1], v[2]);
  }
  const demo = query.get('fishDemo');
  if (demo === 'fountain') { behaviour.fountain = true; setTimeout(() => predator.send(), 2500); }
  if (demo === 'panic') setInterval(() => panic(randomInSchool(), 1), 5000);
  if (demo === 'flash') setInterval(() => panic(randomInSchool(), 1), 6000);
  (window as any).fishDebug = { school, behaviour, env, tris, visuals, readAux: async () => new Float32Array(await renderer.getArrayBufferAsync(mainSim.aux.value)), readVel: async () => new Float32Array(await renderer.getArrayBufferAsync(mainSim.vel.value)), panic: (x: number, y: number, z: number, s = 1) => panic(new Vector3(x, y, z), s) };
  void simTime; void Vector4; void SWIM_BOUNDS; void sampleHeight;

  return school;
}
