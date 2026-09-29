import { AgXToneMapping, Color, DirectionalLight, FogExp2, Group, HemisphereLight, Mesh, MeshStandardNodeMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, WebGPURenderer } from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import { createLabPost } from '../lib/post';
import { physicsDiagnostics } from '../lib/physics';
import { createTerrainBench } from './terrain';
import { createCausticsBench } from './caustics';
import { createShatterBench } from './shatter';
import { disposeGraph } from './dispose';
import { levels } from './levels';
import type { Bench, BenchName, Level } from './types';
import './style.css';
export function readLabRoute() {
  const [path, query] = location.hash.slice(1).split('?'), name = path.split('/')[2];
  const bench: BenchName = name === 'caustics' || name === 'shatter' ? name : 'terrain';
  const n = Number(new URLSearchParams(query).get('level') ?? 3);
  const level = Math.max(1, Math.min(3, Math.round(Number.isFinite(n) ? n : 3))) as Level;
  return { bench, level };
}
/** One renderer for the Lab; serialized bench transitions own and dispose every resource. */
export async function bootLab() {
  document.body.classList.add('lab-page'); document.querySelector('#app')!.setAttribute('aria-label', 'The Lab: Voronoi and Delaunay'); document.title = 'The Lab · Wawa Sensei';
  const shell = document.createElement('div'); shell.className = 'lab-shell';
  shell.innerHTML = `<aside class="lab-sidebar"><a class="lab-brand" href="https://wawasensei.dev" target="_blank" rel="noopener noreferrer"><img src="${import.meta.env.BASE_URL}brand/wawasensei-white.png" alt="Wawa Sensei"></a><div class="lab-eyebrow">The Lab / Voronoi & Delaunay</div><nav aria-label="Lab benches">${(['terrain', 'caustics', 'shatter'] as const).map((name, i) => `<a data-bench="${name}" href="#/lab/${name}?level=3"><span>0${i + 1}</span>${name[0].toUpperCase() + name.slice(1)}</a>`).join('')}</nav><label class="lab-level-label" for="lab-level">Technique level <small>← → &nbsp; / &nbsp; 1 2 3</small></label><input class="lab-range" id="lab-level" type="range" min="1" max="3" step="1" value="3"><div class="lab-ticks"><span>1</span><span>2</span><span>3</span></div><section class="lab-card" aria-live="polite"></section><div class="lab-pane"></div><a class="lab-back" href="#/">← Aquarium</a></aside><section class="lab-stage" aria-label="Interactive WebGPU demonstration"><div class="lab-stage-label"><span class="lab-eyebrow">You can't prompt what you can't name</span><strong></strong></div><span class="lab-fps">— FPS</span><span class="lab-hint" hidden></span><span class="lab-stage-caption">Drag to explore · Scroll to move closer</span></section>`;
  document.querySelector('#app')!.append(shell);
  const stage = shell.querySelector<HTMLElement>('.lab-stage')!, hint = shell.querySelector<HTMLElement>('.lab-hint')!;
  const renderer = new WebGPURenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1.1; renderer.shadowMap.enabled = true;
  await renderer.init();
  if (!('isWebGPUBackend' in renderer.backend) || !renderer.backend.isWebGPUBackend) { renderer.dispose(); throw new Error('The Lab requires a WebGPU adapter.'); }
  stage.prepend(renderer.domElement);
  const scene = new Scene(); scene.background = new Color('#1d2b34'); scene.fog = new FogExp2('#1d2b34', 0.017);
  const hdr = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}hdri/sky.hdr`), pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(hdr); scene.environment = environment.texture; scene.environmentIntensity = 0.65; hdr.dispose(); pmrem.dispose();
  const sun = new DirectionalLight('#fff0d8', 3); sun.position.set(-8, 16, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 0.1, far: 50 }); sun.shadow.normalBias = 0.035; sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target, new HemisphereLight('#cee9e5', '#263333', 1));
  const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardNodeMaterial({ color: '#26383d', roughness: 0.65, metalness: 0.15 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.025; floor.receiveShadow = true; scene.add(floor);
  const camera = new PerspectiveCamera(42, 1, 0.05, 240), controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48;
  let bench: Bench | undefined, root: Group | undefined, pane: Pane | undefined, post: ReturnType<typeof createLabPost> | undefined;
  const settings: Record<BenchName, Record<string, boolean | number | string>> = { terrain: {}, caustics: {}, shatter: {} };
  let current = '', requested = '', disposed = false, transitioning = false, ready = false, generation = 0;
  const resize = () => { const { width, height } = stage.getBoundingClientRect(); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); };
  addEventListener('resize', resize); resize();
  function releaseBench() { bench?.dispose(); bench = undefined; post?.dispose(); post = undefined; pane?.dispose(); pane = undefined; if (root) disposeGraph(root); root = undefined; }
  async function changeRoute() {
    requested = location.hash;
    if (transitioning) return; transitioning = true;
    try {
      while (current !== requested && !disposed) {
        const hash = requested, route = readLabRoute(); ready = false; document.documentElement.dataset.status = 'loading';
        releaseBench(); hint.hidden = true;
        const text = levels[route.bench][route.level - 1], card = shell.querySelector<HTMLElement>('.lab-card')!;
        card.innerHTML = `<span class="level-number">Level ${route.level} of 3</span><h1>${text.title}</h1><p>${text.technique}</p><p class="sees">${text.sees}</p>`;
        card.animate([{ opacity: 0.5, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220 });
        shell.querySelector<HTMLInputElement>('#lab-level')!.value = String(route.level);
        shell.querySelectorAll<HTMLAnchorElement>('nav a').forEach(a => { a.classList.toggle('active', a.dataset.bench === route.bench); if (a.dataset.bench === route.bench) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
        shell.querySelector('.lab-stage-label strong')!.textContent = route.bench[0].toUpperCase() + route.bench.slice(1);
        pane = new Pane({ container: shell.querySelector<HTMLElement>('.lab-pane')! }); root = new Group(); scene.add(root);
        const context = { scene, root, camera, controls, renderer, pane, settings: settings[route.bench], level: route.level, hint };
        controls.reset();
        bench = route.bench === 'terrain' ? createTerrainBench(context) : route.bench === 'caustics' ? createCausticsBench(context) : await createShatterBench(context);
        controls.update(); controls.saveState(); camera.updateMatrixWorld(); post = createLabPost(renderer, scene, camera);
        current = hash; generation++;
      }
    } finally { transitioning = false; }
  }
  const reportError = (error: unknown) => { renderer.setAnimationLoop(null); const loading = document.querySelector<HTMLElement>('#loading')!; loading.hidden = false; loading.textContent = `The Lab could not render: ${error instanceof Error ? error.message : error}`; document.documentElement.dataset.status = 'error'; console.error(error); };
  const routeListener = () => { if (location.hash.startsWith('#/lab')) void changeRoute().catch(reportError); };
  addEventListener('hashchange', routeListener);
  const setLevel = (level: number) => { const route = readLabRoute(); location.hash = `/lab/${route.bench}?level=${Math.min(3, Math.max(1, level))}`; };
  shell.querySelector<HTMLInputElement>('#lab-level')!.addEventListener('input', e => setLevel(Number((e.target as HTMLInputElement).value)));
  const keyboard = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLInputElement && e.target.id !== 'lab-level') || e.target instanceof HTMLSelectElement) return;
    if (['1', '2', '3', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setLevel(e.key === 'ArrowLeft' ? readLabRoute().level - 1 : e.key === 'ArrowRight' ? readLabRoute().level + 1 : Number(e.key)); }
  };
  addEventListener('keydown', keyboard);
  await changeRoute();
  let previous = performance.now(), total = 0, frames = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), realDt = (now - previous) / 1000; previous = now;
    if (transitioning || !post || !bench) return;
    const dt = Math.min(realDt, 0.05); bench.update(dt); controls.update(dt);
    try {
      post.render();
      if (!ready) { ready = true; document.documentElement.dataset.status = 'ready'; document.querySelector<HTMLElement>('#loading')!.hidden = true; }
      total += realDt; frames++; if (total > 0.5) { shell.querySelector('.lab-fps')!.textContent = `${Math.round(frames / total)} FPS`; total = 0; frames = 0; }
    } catch (error) { reportError(error); }
  });
  const hook = { get ready() { return ready && !transitioning; }, get state() { return { ...readLabRoute(), generation, renderer: 'WebGPU', resources: { ...renderer.info.memory }, physics: physicsDiagnostics(), ...bench?.diagnostics() }; }, setReveal(values: Record<string, boolean | number | string>) { bench?.setReveal(values); } };
  Object.assign(window, { lab: hook });
  return () => {
    disposed = true; renderer.setAnimationLoop(null); releaseBench(); controls.dispose(); removeEventListener('resize', resize); removeEventListener('keydown', keyboard); removeEventListener('hashchange', routeListener);
    disposeGraph(scene); sun.shadow.dispose(); environment.dispose(); renderer.dispose(); shell.remove(); delete (window as unknown as Record<string, unknown>).lab;
  };
}
