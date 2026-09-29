import { vec3, vec4 } from 'three/tsl';
import { type Node, AgXToneMapping, Mesh, MeshBasicNodeMaterial, Sprite, FogExp2, Raycaster, Scene, Vector2, Vector3, WebGPURenderer } from 'three/webgpu';
import { atmosphere, createStage } from './scene/stage';
import { createCamera } from './camera';
import { createPost } from './post';
import { createTank } from './scene/tank';
import { createWater } from './scene/water';
import { createIsland, ISLAND_SEED } from './scene/island';
import { createLighting, lampShadow } from './scene/lighting';
import { createShafts } from './scene/shafts';
import { createDust } from './scene/dust';
import { createReef } from './scene/reef';
import { createBubbles } from './scene/bubbles';
import { lampOn, simTime, state, TANK, waterHeight, waterNormal } from './state';
import { createSpill } from './scene/spill';
import { createAudio } from './audio';
import { createUI } from './ui';
import { createWaterProfile } from './water-profile';
import { createRewind } from './rewind';

const loading = document.querySelector<HTMLElement>('#loading')!;
function fail(message: string, error?: unknown, status = 'error') {
  loading.hidden = false; loading.textContent = message;
  document.documentElement.dataset.status = status;
  if (error) console.error(message, error);
}
async function boot() {
  if (!('gpu' in navigator)) { fail('WebGPU is unavailable. Open this study in current Chrome or Edge on a WebGPU-capable device (localhost or HTTPS).', undefined, 'unavailable'); return; }
  let frame = 0;
  const audio = createAudio(() => frame);
  addEventListener('pointerdown', () => { void audio.gesture(); }, { capture: true });
  addEventListener('keydown', () => { void audio.gesture(); }, { capture: true });
  const profiling = new URLSearchParams(location.search).has('waterProfile');
  const renderer = new WebGPURenderer({ antialias: true });
  const waterProfile = createWaterProfile(renderer, profiling);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  try { await renderer.init(); } catch (error) { fail('WebGPU could not start. Enable hardware acceleration and open in current Chrome or Edge.', error, 'unavailable'); return; }
  if (!('isWebGPUBackend' in renderer.backend) || !renderer.backend.isWebGPUBackend) { renderer.dispose(); fail('No WebGPU adapter is available. Enable hardware acceleration and try Chrome or Edge.', undefined, 'unavailable'); return; }
  document.querySelector('#app')!.appendChild(renderer.domElement);
  const scene = new Scene(); scene.fog = new FogExp2('#08324f', 0.018);
  const rig = createCamera(renderer.domElement);
  // HDR loading and native physics initialization are independent.
  const [lighting, tank] = await Promise.all([createLighting(scene, renderer), createTank(scene, rig.camera)]);
  tank.panels.forEach(panel=>{panel.castShadow=false;panel.receiveShadow=false;});
  // Match the fully fogged floor exactly; the HDRI remains scene.environment.
  scene.backgroundNode = atmosphere; scene.backgroundIntensity = 1;
  const stage = createStage(scene, lighting.sun);
  const island = createIsland(scene), water = createWater(scene, island.heightTexture);
  if(!new URLSearchParams(location.search).has('camera')) { rig.controls.target.copy(island.focus); rig.controls.update(); }
  rig.savePose();
  const spill = createSpill(scene, water.ripple);
  await audio.loading;
  state.muted = audio.muted;
  const shafts = createShafts(scene, island.heightTexture), dust = createDust(scene);
  const reef = createReef(scene, island.peak), bubbles = createBubbles(scene, reef.vents, water.ripple);
  const shadowDebug = new URLSearchParams(location.search).has('shadowDebug');
  if(shadowDebug) scene.traverse(object=>{
    if(!(object instanceof Mesh)) return;
    const material=Array.isArray(object.material)?object.material[0]:object.material;
    if(material.transparent) { object.visible=false; return; }
    if(object.receiveShadow) {
      const debug=new MeshBasicNodeMaterial(); debug.fragmentNode=vec4(vec3(lampShadow as unknown as Node<'vec3'>),1); debug.fog=false; object.material=debug;
    }
  });
  const post = createPost(renderer, scene, rig.camera);
  // Compile and upload retained impact geometry in the actual post/reflection
  // passes under the loading overlay. compileAsync yields per object in r186;
  // this single loading render avoids its extra scheduling delay and target variants.
  // Prime JS/native fracture work in an isolated world: warming the live world's
  // body allocator changes later contact ordering, even after removing every body.
  const preparation = await createTank(new Scene());
  try { preparation.crack(state.impact, 0); } finally { preparation.dispose(); }
  renderer.domElement.style.visibility = 'hidden';
  lighting.warmup(true); tank.warmup(true); spill.warmup(true); post.render();
  tank.warmup(false); spill.warmup(false); lighting.warmup(false);
  // Finish the warm-up GPU work while the loading overlay is still up, so it
  // cannot consume the first flicker when the real-time startup clock begins.
  post.render();
  await (renderer.backend as typeof renderer.backend & {device:{queue:{onSubmittedWorkDone():Promise<void>}}}).device.queue.onSubmittedWorkDone();
  let impactFrame = -1;
  function resetPristine() {
    state.mode = 'idle'; state.brokenCount = 0; state.cracks = 0; state.spilling = false; state.hasImpact = false;
    state.wall = 0; state.impact.set(0.6, TANK.base - 0.44, TANK.depth / 2);
    tank.reset(); water.reset(); spill.reset(); bubbles.reset(); audio.reset(); rig.reset(); rewind.clear();
  }
  const rewind = createRewind(tank, water, spill, resetPristine);
  const actions = {
    shatter() {
      if (state.mode === 'shattered' || state.rewinding) return;
      rewind.beforeBreak();
      const openings = tank.shatter(state.impact, state.wall);
      state.mode = 'shattered'; state.shatterTime = state.elapsed; state.brokenCount = tank.shards.length;
      state.cracks = tank.cracks;
      for (const opening of openings) spill.add(opening);
      water.drain(TANK.floor, true); water.ripple(state.impact, 2); rig.shatter(state.impact); impactFrame = frame; void audio.play(true); rewind.record(true);
    },
    reset() {
      audio.reset(); if (rewind.start()) void audio.rewind(state.timeScale);
    },
    toggleLamp() { lighting.toggle(); },
    toggleSound() { audio.toggle(); state.muted = audio.muted; },
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
    if(raycaster.intersectObject(lighting.lampSwitch,false).length) {actions.toggleLamp();return;}
    if(state.mode === 'shattered' || state.rewinding) return;
    const hit = raycaster.intersectObjects(tank.panels, false)[0];
    if (hit) {
      state.impact.copy(hit.point); state.wall = hit.object.userData.wall; state.hasImpact = true;
      rewind.beforeBreak();
      const opening = tank.crack(hit.point, state.wall);
      if (opening) {
        state.mode = 'cracked'; state.cracks = tank.cracks; state.brokenCount = tank.shards.length;
        water.ripple(hit.point); water.slosh(hit.point); water.drain(opening.bottom); spill.add(opening); impactFrame = frame; void audio.play(false); rewind.record(true);
      }
    }
  });
  addEventListener('resize', () => {
    rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
  });
  // A small read-only diagnostics surface makes runtime verification observable.
  const screenPoint = (point: Vector3) => {
    const p = point.project(rig.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  };
  // Opt-in verification probes: classify actual visible sand by geometry, not brightness.
  let sandSamples: {shadow:unknown[];lit:unknown[]}|undefined;
  function sampleSand() {
    if(sandSamples||!new URLSearchParams(location.search).has('shadowMeasure')) return sandSamples;
    scene.updateMatrixWorld(true);
    const meshes=scene.children.filter((o):o is Mesh=>o instanceof Mesh&&!Array.isArray(o.material)&&!o.material.transparent),casters=meshes.filter(o=>o.castShadow),ray=new Raycaster();
    const classify=(p:Vector3)=>{const d=lighting.sun.position.clone().sub(p);ray.set(p,d.normalize());ray.far=lighting.sun.position.distanceTo(p)-lighting.sun.shadow.camera.near;const hit=ray.intersectObjects(casters,false)[0];return !hit?0:hit.object===island.peak?1:2;};
    const samples:{world:Vector3;shadow:boolean;pixel:{x:number;y:number}}[]=[];
    for(let x=-TANK.width/2+.25;x<TANK.width/2-.25;x+=.12)for(let z=-TANK.depth/2+.25;z<TANK.depth/2-.25;z+=.12) {
      const p=new Vector3(x,TANK.floor+.121,z),kind=classify(p);if(kind===2)continue;
      if([[-.07,0],[.07,0],[0,-.07],[0,.07]].some(([dx,dz])=>classify(p.clone().add(new Vector3(dx,0,dz)))!==kind))continue;
      ray.set(rig.camera.position,p.clone().sub(rig.camera.position).normalize());ray.far=Infinity;
      if(ray.intersectObjects(meshes,false)[0]?.object!==island.bed)continue;
      samples.push({world:p,shadow:kind===1,pixel:screenPoint(p.clone())});
    }
    const dark=samples.filter(p=>p.shadow),lit=samples.filter(p=>!p.shadow&&dark.some(d=>d.world.distanceTo(p.world)<.65));
    return sandSamples={shadow:dark.map(p=>({world:p.world.toArray(),pixel:p.pixel})),lit:lit.map(p=>({world:p.world.toArray(),pixel:p.pixel}))};
  }
  Object.defineProperty(window, 'aquarium', { get: () => ({
    tank: TANK, sandSamples:sampleSand(),
    crackTarget: screenPoint(new Vector3(0.6, TANK.base - .84, TANK.depth / 2 + 0.026)),
    aboveTarget: screenPoint(new Vector3(0.6, TANK.top - .16, TANK.depth / 2 + 0.026)),
    wallTargets: [new Vector3(0, TANK.base-.84, TANK.depth/2+.026), new Vector3(0, TANK.base-.84, -TANK.depth/2-.026), new Vector3(TANK.width/2+.026, TANK.base-.84, 0), new Vector3(-TANK.width/2-.026, TANK.base-.84, 0)].map(screenPoint),
    cracks: state.cracks, spilling: state.spilling, rewinding: state.rewinding, rewindProgress: rewind.progress, historyFrames: rewind.count,
    shardBodies: tank.bodyCount, awakeShards: tank.awakeCount, physics: tank.diagnostics, shardTransforms: Array.from(tank.capture().poses), audio: audio.diagnostics, impactFrame,
    spillFlow: spill.flowDiagnostics,
    puddles: spill.puddles.map(p=>({...p, sample:screenPoint(new Vector3(p.position[0],p.position[1],p.position[2]+p.radius[1]*.55))})),
    holeBottom: tank.openings.length ? Math.min(...tank.openings.map(o => o.bottom)) : null,
    holes: tank.openings.map(o => ({ wall: o.wall, bottom: o.bottom })),
    fps: state.fps, pixelRatio: renderer.getPixelRatio(), mode: state.mode,
    timeScale: state.timeScale, elapsed: state.elapsed, brokenCount: state.brokenCount,
    hasImpact: state.hasImpact, impact: state.impact.toArray(), wall: state.wall,
    gpu: waterProfile.diagnostics, water: water.diagnostics, height: waterHeight.value, normal: waterNormal.value.toArray(), renderer: 'WebGPU',
    motes: dust.count, motesAboveSurface: dust.aboveSurface, bubbles: bubbles.count, bubblePops: bubbles.pops, floorCausticIntensity: stage.intensity,
    lampOn:lampOn.value, lampEnabled:lighting.enabled, lampSequenceDone:lighting.sequenceDone, lampSequenceTime:lighting.sequenceTime, lampIntensity:lighting.sun.intensity, lampCone:lighting.cone, lampSwitch:screenPoint(lighting.lampSwitch.position.clone()),
    shadowCasters:scene.children.filter(o=>o.castShadow).map(o=>o.name||o.type),
    lampPosition: lighting.lampPosition, lampTarget: lighting.lampTarget, lampElevation: lighting.elevation,
    lightDirection: lighting.sun.target.position.clone().sub(lighting.sun.position).normalize().toArray(),
    island: { seed: ISLAND_SEED, position: island.peak.position.toArray() },
    camera: { position: rig.camera.position.toArray(), target: rig.controls.target.toArray(), projection: rig.camera.projectionMatrix.toArray(), world: rig.camera.matrixWorld.toArray(), viewport: [innerWidth,innerHeight] },
    sunAzimuth: Math.atan2(lighting.sun.position.z-lighting.sun.target.position.z,lighting.sun.position.x-lighting.sun.target.position.x)*180/Math.PI,
    causticAzimuth: Math.atan2(-(lighting.sun.position.z-lighting.sun.target.position.z),-(lighting.sun.position.x-lighting.sun.target.position.x))*180/Math.PI,
    environment: lighting.environment, drawCalls: renderer.info.render.drawCalls,
  }) });
  let previous = performance.now(), rendered = false;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), realDt = Math.max(0.001, (now - previous) / 1000); previous = now;
    const dt = Math.min(realDt, 0.05) * state.timeScale;
    frame++;
    if (state.rewinding) { rewind.update(realDt); audio.updateRewind(state.timeScale, rewind.progress); }
    else {
      state.elapsed += dt; simTime.value += dt;
      water.update(dt); tank.update(dt); spill.update(dt); rewind.record();
      audio.update(spill.strength, state.timeScale); rig.update(dt);
    }
    lighting.update(realDt);
    state.spilling = spill.active; stage.update(); dust.update(); bubbles.update(); shafts.update(); ui.update(realDt);
    try {
      renderer.info.reset(); if(shadowDebug) scene.traverse(o=>{if((o instanceof Mesh || o instanceof Sprite) && !Array.isArray(o.material) && o.material.transparent)o.visible=false;}); post.render(); waterProfile.update();
      if (!rendered) { rendered = true; renderer.domElement.style.visibility = ''; loading.hidden = true; document.documentElement.dataset.status = 'ready'; lighting.start((on,automatic)=>audio.lamp(on,automatic)); }
    } catch (error) { renderer.setAnimationLoop(null); fail('The WebGPU scene could not render. See the browser console for details.', error); }
  });
}
boot().catch(error => fail('The aquarium could not load. See the browser console for details.', error));
