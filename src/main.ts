import './style.css';
import { Raycaster, Scene, Vector2, WebGPURenderer, AgXToneMapping } from 'three/webgpu';
import { createCamera } from './camera';
import { createDock, createPanel } from './ui';
import { createWorld } from './scene';
import { createSchool } from './fish';
import { createFishing } from './fishing';
import { simTime, state } from './state';
import type { Ctx } from './contracts';

const loading = document.querySelector<HTMLElement>('#loading')!;
function fail(message: string, error?: unknown, status = 'error') {
  loading.hidden = false; loading.textContent = message;
  document.documentElement.dataset.status = status;
  if (error) console.error(message, error);
}

async function boot() {
  if (!('gpu' in navigator)) { fail('WebGPU is unavailable. Open this in current Chrome or Edge on a WebGPU-capable device.', undefined, 'unavailable'); return; }
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  try { await renderer.init(); } catch (error) { fail('WebGPU could not start. Enable hardware acceleration and open in current Chrome or Edge.', error, 'unavailable'); return; }
  if (!('isWebGPUBackend' in renderer.backend) || !renderer.backend.isWebGPUBackend) { renderer.dispose(); fail('No WebGPU adapter is available.', undefined, 'unavailable'); return; }
  document.querySelector('#app')!.appendChild(renderer.domElement);

  const scene = new Scene();
  const rig = createCamera(renderer.domElement);
  const ctx: Ctx = { renderer, scene, camera: rig.camera };

  const world = await createWorld(ctx);
  const school = await createSchool(ctx, world);
  const fishing = await createFishing(ctx, world, school);

  const panel = createPanel();
  const dock = createDock(school, fishing);
  school.addControls(panel.folder('School', true));
  fishing.addControls(panel.folder('Fishing'));
  world.addControls(panel.folder('World'));

  // Click (not drag) → fishing.
  const canvas = renderer.domElement, pointer = new Vector2(), raycaster = new Raycaster();
  let down: { x: number; y: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || down.id !== e.pointerId) return;
    const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6; down = null;
    if (!click) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, rig.camera);
    fishing.click(raycaster);
  });
  addEventListener('resize', () => {
    rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
    world.resize();
  });

  Object.defineProperty(window, 'school', { get: () => ({ fps: state.fps, count: school.count, stats: school.stats, elapsed: state.elapsed, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }) });

  let previous = performance.now(), shown = false;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), realDt = Math.max(0.001, (now - previous) / 1000); previous = now;
    const dt = Math.min(realDt, 1 / 20) * state.timeScale;
    state.elapsed += dt; simTime.value += dt;
    rig.update();
    world.update(dt); school.update(dt); fishing.update(dt);
    panel.update(realDt); dock.update();
    try {
      renderer.info.reset();
      world.render();
      if (!shown) { shown = true; loading.hidden = true; document.documentElement.dataset.status = 'ready'; }
    } catch (error) { renderer.setAnimationLoop(null); fail('The WebGPU scene could not render. See the console.', error); }
  });
}
boot().catch(error => fail('The scene could not load. See the browser console for details.', error));
