/**
 * Single-fish inspector (fish.html): one school fish rendered with the real school shader, LODs and night lighting,
 * on a turntable, so its shape and look can be examined and discussed. Not part of the main experience.
 */
import { AgXToneMapping, Color, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, RenderPipeline, Scene, SphereGeometry, Vector3, WebGPURenderer } from 'three/webgpu';
import { attribute, float, mix, pass, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import { createFlyingFishAsset } from './fish/flyingfish';
import { SCHOOL_LENGTH, VARIANT_B, VARIANT_C, VARIANT_NAMES, createFishMesh, schoolLook } from './fish/render';
import type { InstanceNodes } from './fish/render';
import { createLighting } from './scene/lighting';
import { FISH_SIZE } from './config';
import { lanternPosition, lanternPower, waterLevel } from './state';

/** CPU port of three's TSL hash (PCG), to find seeds for each colour variant exactly as the shader picks them. */
const hash = (seed: number) => {
  const state = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return (((word >>> 22) ^ word) >>> 0) / 2 ** 32;
};
/** The shader's choice: hash(uint(seed · 53.1)) against the variant thresholds. */
const variantOf = (seed: number) => { const v = hash(Math.floor(seed * 53.1)); return VARIANT_NAMES[v < VARIANT_B ? 0 : v < VARIANT_C ? 1 : 2]; };
const seedFor = (variant: string) => { for (let i = 0; i < 2000; i++) { const s = (i + 0.5) / 2000; if (variantOf(s) === variant) return s; } return 0.5; };

const status = document.querySelector<HTMLElement>('#status')!;

async function boot() {
  if (!('gpu' in navigator)) { status.textContent = 'WebGPU is unavailable in this browser.'; return; }
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = AgXToneMapping;
  await renderer.init();
  document.querySelector('#app')!.appendChild(renderer.domElement);

  const scene = new Scene();
  const bg = new Color('#04070f');
  scene.background = bg;
  const lighting = await createLighting(scene);
  lighting.sun.castShadow = false;

  const camera = new PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 100);
  camera.position.set(0.25, 0.12, 1.25);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.target.set(0, 0, 0); controls.minDistance = 0.15; controls.maxDistance = 8;

  // ---- The fish: real asset, real shader, one instance driven by uniforms ------------------------------------------
  const asset = createFlyingFishAsset();
  const settings = {
    variant: 'cyan', lod: 'near (full)', size: 1.2, depth: 3, tailBeat: 2.2, swim: true, phase: 0, wings: 0, airborne: false,
    bank: 0, flash: 0, lantern: true, lanternDistance: 4, parts: false, wireframe: false,
    turntable: false, background: '#04070f',
  };
  // Shareable starting state: ?variant=cyan|teal|violet&mesh=near|normal|shadow&wings=0..1&airborne&parts&wireframe&pause&view=side|top|below|nose|tail|34
  const q = new URLSearchParams(location.search);
  if ((VARIANT_NAMES as readonly string[]).includes(q.get('variant') ?? '')) settings.variant = q.get('variant')!;
  if (q.has('wings')) settings.wings = Math.max(0, Math.min(1, Number(q.get('wings')) || 1));
  if (q.has('airborne')) { settings.airborne = true; settings.wings = 1; }
  settings.lod = ({ near: 'near (full)', normal: 'normal', shadow: 'shadow proxy' } as Record<string, string>)[q.get('mesh') ?? ''] ?? settings.lod;
  settings.parts = q.has('parts'); settings.wireframe = q.has('wireframe'); settings.swim = !q.has('pause');
  const u = { phase: uniform(0), size: uniform(settings.size), bank: uniform(0), flash: uniform(0), seed: uniform(seedFor(settings.variant)), air: uniform(settings.wings) };
  const inst: InstanceNodes = { P: vec3(0, 0, 0), V: uniform(new Vector3(1, 0, 0)), phase: u.phase, size: u.size, flash: u.flash, bank: u.bank, hidden: float(0), fear: float(0), seed: u.seed, air: u.air };
  const lods: Record<string, number> = { 'near (full)': -1, 'normal': 0, 'shadow proxy': 1 };
  const meshes = Object.fromEntries(Object.entries(lods).map(([name, index]) => {
    const m = createFishMesh(asset, index, null, inst, SCHOOL_LENGTH, 1, schoolLook).mesh;
    m.visible = false; scene.add(m);
    // Parts view: the same LOD, static pose, coloured by part with the pattern masks laid over the body.
    const g = index < 0 ? asset.full!.geometry : asset.lods[index].geometry;
    const pm = new MeshBasicNodeMaterial({ side: 2 });
    const id = attribute('matId', 'float'), along = uv().x, up = uv().y;
    const stripe = smoothstep(0.018, 0.004, up.sub(0.47).abs()).mul(smoothstep(0.2, 0.32, along)).mul(smoothstep(0.92, 0.82, along));
    const belly = smoothstep(0.48, 0.23, up);
    let col = mix(vec3(0.35, 0.4, 0.5), vec3(0.85, 0.25, 0.25), belly);
    col = mix(col, vec3(0.2, 0.8, 1.0), stripe);
    col = mix(col, vec3(1.0, 0.65, 0.15), smoothstep(0.5, 0.6, id).mul(float(1).sub(smoothstep(1.5, 1.6, id))));
    col = mix(col, vec3(0.95), smoothstep(1.5, 1.6, id));
    col = mix(col, vec3(0.05), smoothstep(2.5, 2.6, id));
    col = mix(col, vec3(0.75, 0.35, 1.0), smoothstep(3.5, 3.6, id));
    col = mix(col, vec3(0.3, 0.95, 0.5), smoothstep(4.5, 4.6, id));
    pm.colorNode = vec4(col, 1);
    const scale = SCHOOL_LENGTH / asset.length;
    const parts = new Mesh(g, pm); parts.visible = false; parts.userData.scale = scale; scene.add(parts);
    return [name, { shaded: m, parts, partsMat: pm }];
  }));
  const tris = Object.fromEntries(Object.entries(lods).map(([n, i]) => [n, (i < 0 ? asset.full! : asset.lods[i]).triCount]));

  // Lantern marker.
  const lamp = new Mesh(new SphereGeometry(0.03, 16, 8), new MeshBasicNodeMaterial({ color: new Color(3, 1.5, 0.5) }));
  scene.add(lamp);

  const apply = () => {
    for (const [name, m] of Object.entries(meshes)) {
      const on = name === settings.lod;
      m.shaded.visible = on && !settings.parts;
      m.parts.visible = on && settings.parts;
      m.parts.scale.setScalar(m.parts.userData.scale * settings.size);
      m.shaded.material.wireframe = settings.wireframe;
      m.partsMat.wireframe = settings.wireframe;
    }
    u.air.value = settings.wings;
    u.size.value = settings.size; u.bank.value = settings.bank; u.flash.value = settings.flash; u.seed.value = seedFor(settings.variant);
    // The fish sits at the origin; the water surface is `depth` above it (depth tint, lantern path through water).
    waterLevel.value = settings.airborne ? -0.8 : settings.depth;
    lanternPower.value = settings.lantern ? 1 : 0;
    lamp.visible = settings.lantern;
    bg.set(settings.background);
    controls.autoRotate = settings.turntable;
  };

  // ---- UI ------------------------------------------------------------------------------------------------------------
  const pane = new Pane({ title: 'Fish inspector', container: document.querySelector<HTMLElement>('#pane')! });
  const fish = pane.addFolder({ title: 'Fish' });
  fish.addBinding(settings, 'variant', { label: 'sheen', options: { 'Cyan (most of the school)': 'cyan', 'Teal': 'teal', 'Violet (rare)': 'violet' } });
  fish.addBinding(settings, 'lod', { label: 'mesh', options: Object.fromEntries(Object.keys(lods).map(n => [`${n} · ${tris[n]} tris`, n])) });
  fish.addBinding(settings, 'size', { min: FISH_SIZE.min, max: FISH_SIZE.max, step: 0.01, label: 'size (school range)' });
  fish.addBinding(settings, 'parts', { label: 'parts view' });
  fish.addBinding(settings, 'wireframe');
  const motion = pane.addFolder({ title: 'Motion' });
  motion.addBinding(settings, 'wings', { min: 0, max: 1, step: 0.01, label: 'wing spread' });
  motion.addBinding(settings, 'airborne', { label: 'airborne (above water)' });
  motion.addBinding(settings, 'swim');
  motion.addBinding(settings, 'tailBeat', { min: 0, max: 8, step: 0.1, label: 'tail beats / s' });
  motion.addBinding(settings, 'phase', { min: 0, max: 1, step: 0.01, label: 'pose (paused)' });
  motion.addBinding(settings, 'bank', { min: -1.2, max: 1.2, step: 0.01 });
  motion.addBinding(settings, 'flash', { min: 0, max: 1, step: 0.01, label: 'alarm flash' });
  const light = pane.addFolder({ title: 'Light' });
  light.addBinding(settings, 'depth', { min: 0.2, max: 9, step: 0.1, label: 'depth below surface' });
  light.addBinding(settings, 'lantern');
  light.addBinding(settings, 'lanternDistance', { min: 0.5, max: 8, step: 0.1, label: 'lantern distance' });
  const view = pane.addFolder({ title: 'View' });
  view.addBinding(settings, 'turntable');
  view.addBinding(settings, 'background', { view: 'color' });
  const presets: Record<string, [number, number, number]> = {
    'Side': [0, 0, 1.2], 'Other side': [0, 0, -1.2], 'Top': [0, 1.2, 0.001], 'Below': [0, -1.2, 0.001], 'Nose': [1.2, 0, 0], 'Tail': [-1.2, 0, 0], '3/4': [0.7, 0.45, 0.85],
  };
  const grid = view.addBlade({ view: 'separator' }); void grid;
  for (const [name, p] of Object.entries(presets)) view.addButton({ title: name }).on('click', () => {
    const k = Math.max(0.6, settings.size); camera.position.set(p[0] * k, p[1] * k, p[2] * k); controls.target.set(0, 0, 0);
  });
  view.addButton({ title: 'Copy view + settings' }).on('click', async () => {
    const text = JSON.stringify({ camera: camera.position.toArray().map(v => +v.toFixed(3)), target: controls.target.toArray().map(v => +v.toFixed(3)), ...settings });
    try { await navigator.clipboard.writeText(text); status.textContent = 'Copied: paste it along with your note.'; } catch { status.textContent = text; }
    setTimeout(() => { status.textContent = ''; }, 3500);
  });
  pane.on('change', apply);
  apply();
  const startView = q.get('view');
  if (startView) { const key = Object.keys(presets).find(k => k.toLowerCase().replace(/\W/g, '') === startView.toLowerCase().replace(/\W/g, '')); if (key) { const p = presets[key], k = Math.max(0.6, settings.size); camera.position.set(p[0] * k, p[1] * k, p[2] * k); } }

  // ---- Render --------------------------------------------------------------------------------------------------------
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  pipeline.outputNode = beauty.add(bloom(beauty.min(8), 0.2, 0.5, 0.62));

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (settings.swim) { u.phase.value = (u.phase.value + dt * settings.tailBeat) % 1; settings.phase = u.phase.value; pane.refresh(); }
    else u.phase.value = settings.phase;
    // Lantern above and ahead of the fish, like the boat's lamp over the school.
    lanternPosition.value.set(0.4, 1.2, 0.5).normalize().multiplyScalar(settings.lanternDistance);
    lanternPosition.value.y = Math.max(lanternPosition.value.y, waterLevel.value + 0.3);
    lamp.position.copy(lanternPosition.value);
    lighting.syncLantern();
    controls.update();
    pipeline.render();
  });
  status.textContent = '';
  document.documentElement.dataset.status = 'ready';
}
boot().catch(error => { console.error(error); status.textContent = 'The fish inspector could not start. See the console.'; document.documentElement.dataset.status = 'error'; });
