import { AgXToneMapping, Color, FogExp2, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Raycaster, Scene, Vector2, WebGPURenderer } from 'three/webgpu';
import { createCamera } from './camera';
import { createPost } from './post';
import { createTank } from './scene/tank';
import { createWater } from './scene/water';
import { createIsland } from './scene/island';
import { createLighting } from './scene/lighting';
import { createShafts } from './scene/shafts';
import { createDust } from './scene/dust';
import { simTime, state, TANK, waterHeight, waterNormal } from './state';
import { createUI } from './ui';

const loading = document.querySelector<HTMLElement>('#loading')!;
function fail(message: string, error?: unknown, status = 'error') {
  loading.hidden = false; loading.textContent = message;
  document.documentElement.dataset.status = status;
  if (error) console.error(message, error);
}
async function boot() {
  if (!('gpu' in navigator)) { fail('WebGPU is unavailable. Open this study in current Chrome or Edge on a WebGPU-capable device (localhost or HTTPS).', undefined, 'unavailable'); return; }
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  try { await renderer.init(); } catch (error) { fail('WebGPU could not start. Enable hardware acceleration and open in current Chrome or Edge.', error, 'unavailable'); return; }
  if (!('isWebGPUBackend' in renderer.backend) || !renderer.backend.isWebGPUBackend) { renderer.dispose(); fail('No WebGPU adapter is available. Enable hardware acceleration and try Chrome or Edge.', undefined, 'unavailable'); return; }
  document.querySelector('#app')!.appendChild(renderer.domElement);
  const scene = new Scene(); scene.background = new Color('#15232e'); scene.fog = new FogExp2('#26333e', 0.025);
  const rig = createCamera(renderer.domElement);
  const lighting = await createLighting(scene, renderer);
  const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardNodeMaterial({ color: '#202e34', roughness: 0.28, metalness: 0.27 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const tank = createTank(scene), water = createWater(scene), island = createIsland(scene);
  const shafts = createShafts(scene); createDust(scene);
  const post = createPost(renderer, scene, rig.camera, island.focus);
  const actions = {
    shatter() {
      if (state.mode === 'shattered') return;
      const hit = tank.shatter(state.impact, state.wall);
      if (!hit.count) return;
      state.mode = 'shattered'; state.shatterTime = state.elapsed; state.brokenCount = hit.count;
      water.drain(hit.bottom); rig.shatter(state.impact);
    },
    reset() {
      state.mode = 'idle'; state.brokenCount = 0; state.hasImpact = false;
      state.wall = 0; state.impact.set(0.6, TANK.base - 0.44, TANK.depth / 2);
      tank.reset(); water.reset(); rig.reset();
    },
    toggleTime() { state.timeScale = state.timeScale === 1 ? 0.15 : 1; },
  };
  const ui = createUI(actions);
  const pointer = new Vector2(), raycaster = new Raycaster();
  let down: { x: number; y: number; id: number; moved: boolean } | null = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; });
  canvas.addEventListener('pointermove', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true; });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', e => {
    if (!down || down.id !== e.pointerId) return;
    const click = !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6; down = null;
    if (!click) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, rig.camera);
    const hit = raycaster.intersectObjects(tank.panels, false)[0];
    if (hit) {
      state.impact.copy(hit.point); state.wall = hit.object.userData.wall; state.hasImpact = true;
      water.slosh(hit.point);
    }
  });
  addEventListener('resize', () => {
    rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  });
  // A small read-only diagnostics surface makes runtime verification observable.
  Object.defineProperty(window, 'aquarium', { get: () => ({ mode: state.mode, timeScale: state.timeScale, elapsed: state.elapsed, brokenCount: state.brokenCount, hasImpact: state.hasImpact, impact: state.impact.toArray(), wall: state.wall, height: waterHeight.value, normal: waterNormal.value.toArray(), renderer: 'WebGPU', environment: lighting.environment, drawCalls: renderer.info.render.drawCalls }) });
  let previous = performance.now(), rendered = false;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), realDt = Math.max(0.001, (now - previous) / 1000); previous = now;
    const dt = Math.min(realDt, 0.05) * state.timeScale;
    state.elapsed += dt; simTime.value = state.elapsed;
    water.update(dt); tank.update(dt); lighting.update(state.elapsed); shafts.update(); rig.update(dt); post.update(dt); ui.update(realDt);
    try {
      renderer.info.reset(); post.render();
      if (!rendered) { rendered = true; loading.hidden = true; document.documentElement.dataset.status = 'ready'; console.info(`Aquarium ready: Three r186 / WebGPU / ${lighting.environment}`); }
    } catch (error) { renderer.setAnimationLoop(null); fail('The WebGPU scene could not render. See the browser console for details.', error); }
  });
}
boot().catch(error => fail('The aquarium could not load. See the browser console for details.', error));
