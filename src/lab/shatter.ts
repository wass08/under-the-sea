import { attribute, color } from 'three/tsl';
import { BoxGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, Sprite, Raycaster, SphereGeometry, Quaternion, Vector2, Vector3 } from 'three/webgpu';
import { buildOutlineGeometry, buildSeedPoints, generateShatterPattern } from '../lib/shatter';
import { type PhysicsWorld } from '../lib/physics';
import { createShardWorld, releaseShards, launchDiagnostics, migrateLabReleaseSettings, LAB_RELEASE_DEFAULTS, type ReleasedShard } from '../lib/release';
import { batchShardDrawing } from '../lib/shardBatch';
import { random } from '../lib/random';
import type { Point2 } from '../lib/triangulate';
import { disposeGraph } from './dispose';
import { createSeedDots } from './seedDots';
import type { Bench, BenchContext } from './types';
export async function createShatterBench({ root, camera, controls, renderer, pane, hint, settings, level }: BenchContext): Promise<Bench> {
  camera.position.set(4.1, 3.0, 6.3); controls.target.set(0, 1.05, 0); controls.minDistance = 3; controls.maxDistance = 13; controls.autoRotate = false;
  migrateLabReleaseSettings(settings);
  const params = Object.assign({ count: 220, ...LAB_RELEASE_DEFAULTS, seeds: false, outlines: false, freeze: false, slowMotion: false }, settings);
  const glass = new MeshPhysicalNodeMaterial({ color: '#e8fffc', transmission: 1, thickness: 0.05, roughness: 0.05, ior: 1.5, attenuationColor: new Color('#b3e2d7'), attenuationDistance: 3, envMapIntensity: 1.3 });
  const intact = new Mesh(new BoxGeometry(3.2, 2, 0.05), glass); intact.position.y = 1.25; root.add(intact);
  const frame = new LineSegments(buildOutlineGeometry([{ polygon: [[-1.6, -1], [1.6, -1], [1.6, 1], [-1.6, 1]], seed: [0, 0], ring: 0, distance: 0 }]), new LineBasicMaterial({ color: '#bdddd5', transparent: true, opacity: 0.6 })); frame.position.copy(intact.position); root.add(frame);
  const plinth = new Mesh(new BoxGeometry(3.55, 0.22, 0.55), new MeshStandardNodeMaterial({ color: '#123550', roughness: 0.3, metalness: 0.6 })); plinth.position.y = 0.11; root.add(plinth);
  // Low-frequency colour makes transmission/refraction legible through the intact slab.
  for (const [x, y, z, radius, tint] of [[-1.25, 1.1, -1.1, 0.75, '#dd9474'], [0.4, 0.85, -1.45, 0.72, '#5cacaa'], [1.4, 1.6, -1.7, 0.6, '#aeacd3']] as const) {
    const sphere = new Mesh(new SphereGeometry(radius, 40, 24), new MeshStandardNodeMaterial({ color: tint, roughness: 0.33, metalness: 0.15 })); sphere.position.set(x, y, z); sphere.castShadow = true; root.add(sphere);
  }
  let world: PhysicsWorld = await createShardWorld(), fragments = new Group(), overlay = new Group(), broken = false, clicked = false;
  root.add(fragments, overlay);
  let released: ReleasedShard[] = [], drawing: ReturnType<typeof batchShardDrawing> | undefined;
  let impact: Point2 = [0, 0], pattern = generateShatterPattern({ level, width: 3.2, height: 2, impact, count: params.count, seed: 912 });
  let dots: Sprite, outlines: LineSegments;
  function setupFloor() {
    world.addStaticBox({ x: 0, y: -0.1, z: 0 }, { x: 80, y: 0.2, z: 80 });
    world.addStaticBox({ x: 0, y: 0.11, z: 0 }, { x: 3.55, y: 0.22, z: 0.55 }, true);
  }
  function makePattern() {
    pattern = generateShatterPattern({ level, width: 3.2, height: 2, impact, count: params.count, seed: 912 });
    disposeGraph(overlay); overlay = new Group(); root.add(overlay); overlay.position.set(0, 1.25, 0.032);
    dots = createSeedDots(buildSeedPoints(pattern.seeds), 4);
    outlines = new LineSegments(buildOutlineGeometry(pattern.cells), new LineBasicMaterial({ color: '#bdece3', transparent: true, opacity: 0.8 })); overlay.add(dots, outlines); reveal();
  }
  function reveal() { dots.visible = params.seeds; outlines.visible = params.outlines; overlay.visible = !broken; world.frozen = params.freeze; world.timeScale = params.slowMotion ? 0.15 : 1; }
  let disposed = false, resetting = false;
  async function reset() {
    if (resetting || disposed) return; resetting = true;
    const next = await createShardWorld();
    if (disposed) { next.dispose(); return; }
    world.dispose(); world = next; setupFloor();
    disposeGraph(fragments); fragments = new Group(); root.add(fragments);
    released = []; drawing = undefined; broken = false; intact.visible = true; frame.visible = true; impact = [0, 0]; makePattern(); hint.hidden = clicked; resetting = false;
  }
  function fracture(point: Point2) {
    if (broken || resetting) return;
    // Match the main page: pixel rounding must not perturb seeded fracture geometry.
    impact = [Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100]; makePattern(); broken = true; clicked = true; hint.hidden = true; intact.visible = false; frame.visible = false; overlay.visible = false;
    const rng = random(117);
    // Each fracture owns its material so reset also releases its per-shard GPU bindings.
    const shardGlass = glass.clone();
    shardGlass.emissiveNode = color('#cbefff').mul(attribute('impactGlow', 'float')).mul(.45);
    released = releaseShards({ cells: pattern.cells, world, material: shardGlass, origin: intact.position, rotation: new Quaternion(),
      impact: new Vector3(impact[0], impact[1] + 1.25, 0), width: 3.2, height: 2, level, budget: pattern.cells.length,
      minimumArea: 0, floorY: 0, random: rng,
      profile: new URLSearchParams(location.search).get('labRelease') === 'before' ? 'aquarium' : { kind: 'lab', impulse: params.impulse, falloff: params.falloff, forward: params.forward, spin: params.spin } });
    for (const { mesh } of released) fragments.add(mesh);
    drawing = batchShardDrawing(released); fragments.add(drawing.mesh);
  }

  const ray = new Raycaster(), pointer = new Vector2(), canvas = renderer.domElement;
  let down: { x: number; y: number } | undefined;
  const pointerDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; };
  const pointerUp = (e: PointerEvent) => {
    const start = down; down = undefined;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5 || broken) return;
    const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(pointer, camera); const hit = ray.intersectObject(intact)[0];
    if (hit) { const p = intact.worldToLocal(hit.point); fracture([p.x, p.y]); }
  };
  const cancel = () => { down = undefined; };
  const key = (e: KeyboardEvent) => { if (e.code === 'KeyR' && !(e.target instanceof HTMLInputElement) && !e.ctrlKey && !e.metaKey) void reset(); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', cancel); addEventListener('keydown', key);
  pane.addBinding(params, 'count', { min: 60, max: 600, step: 10 }).on('change', e => { if (e.last) void reset(); });
  const launch = pane.addFolder({ title: level === 1 ? 'Burst · levels 2–3' : 'Burst · next break' }); launch.disabled = level === 1;
  launch.addBinding(params, 'impulse', { min: .5, max: 3, step: .05 });
  launch.addBinding(params, 'falloff', { min: .5, max: 6, step: .1 });
  launch.addBinding(params, 'forward', { min: .15, max: .9, step: .05 });
  launch.addBinding(params, 'spin', { min: 0, max: 2, step: .05 });
  const folder = pane.addFolder({ title: 'Reveal' });
  folder.addBinding(params, 'seeds'); folder.addBinding(params, 'outlines', { label: 'cell outlines' }); folder.addBinding(params, 'freeze'); folder.addBinding(params, 'slowMotion', { label: 'slow motion · 0.15×' });
  pane.on('change', reveal); pane.addButton({ title: 'Reset pane · R' }).on('click', () => { void reset(); });
  setupFloor(); makePattern(); hint.textContent = 'Click the glass'; hint.hidden = false;
  return {
    update(dt) { world.step(dt); world.sync(); drawing?.update(); },
    dispose() { Object.assign(settings, params); disposed = true; world.dispose(); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', cancel); removeEventListener('keydown', key); },
    setReveal(values) { Object.assign(params, values); reveal(); pane.refresh(); },
    diagnostics() {
      const center = new Vector3(0, 1.25, 0).project(camera), rect = canvas.getBoundingClientRect();
      const shardTransforms = released.map(({ mesh }) => [...mesh.position.toArray(), ...mesh.quaternion.toArray()]);
      return { cellsPerBody: released.map(s => s.body.numColliders()), launch: launchDiagnostics(released), broken, elapsed: world.elapsed, shardCount: released.length, cellCount: pattern.cells.length, awakeCount: released.filter(s => !s.body.isSleeping()).length, fixedFallbacks: released.filter(s => !s.body.isDynamic()).length, shardTransforms, bodyCount: world.world.bodies.len(), colliderCount: world.world.colliders.len(), impact, paneCenter: { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 }, ...params };
    },
  };
}
