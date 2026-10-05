import './style.css';
import { Raycaster, Scene, Vector2, Vector3, WebGPURenderer, AgXToneMapping } from 'three/webgpu';
import { createCamera } from './camera';
import { createCleanFrame, createDock, createPanel } from './ui';
import { createWorld } from './scene';
import { createSchool } from './fish';
import { createFishing } from './fishing';
import { simTime, state } from './state';
import { QUERY } from './config';
import type { Ctx } from './contracts';

const loading = document.querySelector<HTMLElement>('#loading')!;
function fail(message: string, error?: unknown, status = 'error') {
  loading.hidden = false; loading.textContent = message; loading.classList.add('error');
  document.documentElement.classList.add('revealing');
  document.documentElement.dataset.status = status;
  if (error) console.error(message, error);
}

async function boot() {
  if (!('gpu' in navigator)) { fail('WebGPU is unavailable. Open this in current Chrome or Edge on a WebGPU-capable device.', undefined, 'unavailable'); return; }
  const renderer = new WebGPURenderer({ antialias: true, alpha: true, trackTimestamp: QUERY.debug });
  renderer.setClearColor(0x000000, 0);
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
  // Let the school settle (?prewarm=seconds, default 25; 0 to watch it form) while the loader is still up. After the
  // fishing setup, so the lantern the schools gather under is already in place.
  const prewarm = Number(new URLSearchParams(location.search).get('prewarm') ?? 25);
  if (prewarm > 0) { fishing.update(0); world.update(0); school.prewarm?.(prewarm); }
  if (QUERY.debug) (window as any).sceneDebug = { scene, renderer, state, world, frozen: false, camera: rig.camera, controls: rig.controls };
  createCleanFrame();

  const panel = createPanel();
  const dock = createDock(school, fishing);
  rig.addControls(panel.folder('Camera', true));
  school.addControls(panel.folder('School', true));
  world.addFogControls(panel.folder('Fog & volumetrics', true));
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
  const maxPixelRatio = () => Math.min(devicePixelRatio, 1.5);
  let renderScale = 1, qualityFrames = 0, qualityTime = 0, qualityStart = performance.now(), recoveryWindows = 0;
  function adaptResolution(realDt: number) {
    if (document.hidden || performance.now() - qualityStart < 5000) return;
    qualityFrames++; qualityTime += realDt;
    if (qualityTime < 2) return;
    const fps = qualityFrames / qualityTime;
    recoveryWindows = fps > 58 ? recoveryWindows + 1 : 0;
    const next = fps < 48 ? Math.max(0.6, renderScale - 0.1) : recoveryWindows >= 3 ? Math.min(1, renderScale + 0.05) : renderScale;
    if (next !== renderScale) recoveryWindows = 0;
    qualityFrames = 0; qualityTime = 0;
    if (Math.abs(next - renderScale) < 0.001) return;
    renderScale = next;
    renderer.setPixelRatio(maxPixelRatio() * renderScale); renderer.setSize(innerWidth, innerHeight);
    world.resize();
  }
  document.addEventListener('visibilitychange', () => { qualityFrames = 0; qualityTime = 0; qualityStart = performance.now(); });
  addEventListener('resize', () => {
    rig.resize();
    renderer.setPixelRatio(maxPixelRatio() * renderScale); renderer.setSize(innerWidth, innerHeight);
    world.resize();
  });

  const gpuTiming: { render: number | null; compute: number | null } = { render: null, compute: null };
  Object.defineProperty(window, 'school', { get: () => ({ fps: state.fps, count: school.count, stats: school.stats, elapsed: state.elapsed, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, computeSubmissions: renderer.info.compute.frameCalls, pixelRatio: renderer.getPixelRatio(), gpuRenderMs: gpuTiming.render, gpuComputeMs: gpuTiming.compute }) });

  // Precompile the scene's materials while the loader shows (the post pipeline and the water variants compile during
  // the hidden warm-up frames below).
  try { await renderer.compileAsync(scene, rig.camera); } catch (error) { console.warn('compileAsync failed, compiling on first frames', error); }

  /**
   * Reveal: the canvas stays invisible while the first frames compile pipelines (they are slow), then fades in as the
   * camera glides from far out in the fog to the opening shot, and the UI fades in after it. `data-status=ready` is set
   * when the intro ends (the tools wait for it). Debug cameras that pin the view skip the glide.
   */
  const params = new URLSearchParams(location.search);
  const pinned = ['fishingCam', 'lookAt', 'fishCam', 'fishFollow', 'inset', 'cam'].some(k => params.has(k)) || params.has('nointro');
  const reveal = { phase: 'warm' as 'warm' | 'intro' | 'done', frames: 0, calm: 0, t: 0, dur: 3.4, from: new Vector3(), to: new Vector3() };
  const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const startIntro = () => {
    reveal.phase = 'intro'; reveal.t = 0;
    document.documentElement.classList.add('revealing');
    if (pinned) { reveal.dur = 0.9; return; }
    const c = rig.camera, target = rig.controls.target;
    reveal.to.copy(c.position);
    const away = reveal.to.clone().sub(target), len = away.length();
    reveal.from.copy(target).addScaledVector(away.normalize(), len * 2.7).add(new Vector3(0, len * 0.55, 0));
    rig.controls.enabled = false; c.position.copy(reveal.from); c.lookAt(target);
  };
  const finishIntro = () => {
    reveal.phase = 'done';
    if (!pinned) { rig.camera.position.copy(reveal.to); rig.controls.enabled = true; rig.controls.update(); }
    loading.hidden = true;
    document.documentElement.classList.add('revealed');
    document.documentElement.dataset.status = 'ready';
    qualityFrames = 0; qualityTime = 0; qualityStart = performance.now(); // judge frame rate only once it is all visible
  };
  let previous = performance.now(), timingPending = false, lastTiming = 0;
  const resolveTiming = (now: number) => {
    if (!QUERY.debug || timingPending || now - lastTiming < 1000) return;
    timingPending = true; lastTiming = now;
    Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')])
      .then(([render, compute]) => { gpuTiming.render = render ?? null; gpuTiming.compute = compute ?? null; })
      .catch(() => {}).finally(() => { timingPending = false; });
  };
  renderer.setAnimationLoop(() => {
    const now = performance.now(), realDt = Math.max(0.001, (now - previous) / 1000); previous = now;
    const frozen = QUERY.debug && (window as any).sceneDebug.frozen;
    const dt = frozen ? 0 : Math.min(realDt, 1 / 20) * state.timeScale;
    renderer.info.reset();
    adaptResolution(realDt);
    state.elapsed += dt; simTime.value += dt;
    if (reveal.phase === 'intro') {
      reveal.t += realDt;
      if (!pinned) { const e = easeInOut(Math.min(1, reveal.t / reveal.dur)); rig.camera.position.lerpVectors(reveal.from, reveal.to, e); rig.camera.lookAt(rig.controls.target); }
      if (reveal.t >= reveal.dur) finishIntro();
    }
    rig.update();
    fishing.update(dt); world.update(dt); school.update(dt);
    panel.update(realDt); dock.update();
    try {
      world.render();
      resolveTiming(now);
      if (reveal.phase === 'warm') {
        // Warm up hidden until a few consecutive frames run at a normal pace (pipelines compiled), at most ~4 s.
        reveal.frames++; reveal.calm = realDt < 1 / 30 ? reveal.calm + 1 : 0;
        if ((reveal.frames > 8 && reveal.calm >= 5) || reveal.frames > 240) startIntro();
      }
    } catch (error) { renderer.setAnimationLoop(null); fail('The WebGPU scene could not render. See the console.', error); }
  });
}
boot().catch(error => fail('The scene could not load. See the browser console for details.', error));
