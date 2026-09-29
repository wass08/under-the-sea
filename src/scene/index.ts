import { DataTexture, Mesh, PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu';
import { Color, InstancedMesh, MeshStandardNodeMaterial, Object3D, SphereGeometry } from 'three/webgpu';
import type { Ctx, InsetRect, World } from '../contracts';
import type { FolderApi } from 'tweakpane';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { setHullMask, emitRipple, oceanHeightCpu, oceanParams, oceanAmplitude } from '../lib/ocean';
import { sampleGrid } from './field';
import { buildSlab, buildTerrain } from './terrain';
import { createSlabMaterial, createTerrainMaterial } from './materials';
import { OFF, applySunAngles, causticStrength, createLighting, godRayStrength, sunParams, waterClarity } from './lighting';
import { createAtmosphere } from './atmosphere';
import { createHeightTexture, createWater } from './water';
import { createPost, postParams } from './post';
import { createFlora } from './flora';
import { createIsland } from './island';
import { createFloatingProps } from './props';
import { createBubbles, createPlankton } from './particles';

const gradient = { gx: 0, gz: 0 };
/** ?lookAt=x,y,z (debug): aim the camera after the orbit controls have updated. */
const lookAtParam = new URLSearchParams(location.search).get('lookAt')?.split(',').map(Number);
const lookAt = lookAtParam && lookAtParam.length === 3 ? new Vector3(...lookAtParam) : null;

export async function createWorld({ renderer, scene, camera }: Ctx): Promise<World> {
  applyCameraPreset(camera);
  const lighting = await createLighting(scene);
  const { sun } = lighting;
  createAtmosphere(scene, lighting.visibility);

  // Terrain
  const terrainData = buildTerrain();
  const terrainMesh = new Mesh(terrainData.geometry, createTerrainMaterial());
  terrainMesh.name = 'Terrain'; terrainMesh.castShadow = true; terrainMesh.receiveShadow = true; terrainMesh.layers.enable(1);
  const slabMesh = new Mesh(buildSlab(terrainData.edges), createSlabMaterial());
  slabMesh.name = 'Earth slab'; slabMesh.castShadow = true; slabMesh.receiveShadow = true;
  scene.add(terrainMesh, slabMesh);

  const resolution = 256;
  const heights = sampleGrid(resolution);
  const heightTexture: DataTexture = createHeightTexture(heights, resolution);
  const water = createWater(scene, camera, heightTexture, terrainData.edges);
  if (!OFF.has('flora')) createFlora(scene);
  if (!OFF.has('palms')) createIsland(scene);
  if (!OFF.has('plankton')) createPlankton(scene);
  const props = OFF.has('props') ? null : createFloatingProps(scene);
  const bubbles = createBubbles(scene);
  if (OFF.has('bubbles')) bubbles.mesh.visible = false;
  if (OFF.has('reflect')) water.reflection.target.visible = false;
  if (OFF.has('water')) { water.surface.visible = false; water.front.visible = false; water.back.visible = false; }
  if (OFF.has('wtop')) water.surface.visible = false;
  if (OFF.has('wside')) { water.front.visible = false; water.back.visible = false; }
  if (OFF.has('terrain')) { terrainMesh.visible = false; slabMesh.visible = false; }
  if (new URLSearchParams(location.search).has('testfish')) addTestFish(scene);
  const heightProbe = new URLSearchParams(location.search).has('testheight') ? addHeightProbes(scene) : null;
  const post = createPost(renderer, scene, camera, heightTexture);
  // One shadow-map render per frame, shared by the main and inset passes.
  sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
  if (new URLSearchParams(location.search).has('noshadow')) sun.castShadow = false;
  let insetCam: PerspectiveCamera | null = null, insetRect: InsetRect | null = null;
  const size = new Vector2();
  const applyInset = () => {
    renderer.getSize(size);
    const on = !!(insetCam && insetRect);
    water.setInsetActive(on);
    if (on) post.setInset(insetCam, insetRect, size.x, size.y); else post.setInset(null, null, size.x, size.y);
  };
  const debugInset = new URLSearchParams(location.search).get('inset')?.split(',').map(Number);
  if (debugInset && debugInset.length >= 3) {
    // ?inset=x,y,z[,tx,ty,tz]: a test picture-in-picture camera (default target: the school's middle).
    const cam = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    cam.position.set(debugInset[0], debugInset[1], debugInset[2]);
    cam.lookAt(debugInset[3] ?? 4, debugInset[4] ?? 6, debugInset[5] ?? 4); cam.updateMatrixWorld();
    insetCam = cam; insetRect = { x: 24, y: innerHeight - 24 - 270, width: 480, height: 270 };
    queueMicrotask(applyInset);
  }
  // Let the planar reflection (layer 1) also pick up other modules' boat / fisherman meshes.
  let reflectTimer = 0, boat: import('three/webgpu').Object3D | null = null;
  const markReflective = () => scene.children.forEach(child => {
    if (/boat|fisher|rod|lure/i.test(child.name) && !child.userData.reflective) { child.userData.reflective = true; child.traverse(o => o.layers.enable(1)); }
  });

  const world: World = {
    sun, surface: water.surface, terrain: [terrainMesh, slabMesh],
    seabed: { heights, resolution },
    heightAt(x, z) { return waterLevel.value + oceanHeightCpu(x, z, simTime.value); },
    normalAt(x, z, target) {
      oceanHeightCpu(x, z, simTime.value, gradient);
      return target.set(-gradient.gx, 1, -gradient.gz).normalize();
    },
    ripple(point: Vector3, strength = 1) { emitRipple(point.x, point.z, Math.max(0, Math.min(3, strength))); },
    update(dt: number) {
      if (lookAt) camera.lookAt(lookAt);
      bubbles.update(dt); props?.update(dt);
      if (!boat) boat = scene.getObjectByName('Fishing boat') ?? null;
      if (boat) { const k = boat.scale.x; setHullMask(boat.position.x, boat.position.z, 0.8 * k, 0.33 * k, boat.rotation.y); }
      const p = camera.position, inside = Math.abs(p.x) < WORLD.half && Math.abs(p.z) < WORLD.half && p.y > WORLD.bed - 0.6;
      const depth = world.heightAt(p.x, p.z) - p.y;
      const amount = inside ? Math.max(0, Math.min(1, depth / 0.12)) : 0;
      post.setUnderwater(amount);
      let insideAny = amount > 0;
      if (insetCam) {
        const q = insetCam.position, qi = Math.abs(q.x) < WORLD.half && Math.abs(q.z) < WORLD.half && q.y > WORLD.bed - 0.6;
        const qa = qi ? Math.max(0, Math.min(1, (world.heightAt(q.x, q.z) - q.y) / 0.12)) : 0;
        post.setInsetUnderwater(qa); insideAny = insideAny || qa > 0;
      }
      water.setInside(insideAny);
      heightProbe?.(world);
      reflectTimer -= dt;
      if (reflectTimer <= 0) { reflectTimer = 1; markReflective(); }
    },
    render() { sun.shadow.needsUpdate = true; post.render(); },
    setInset(cam, rect) {
      insetCam = cam; insetRect = rect ?? insetRect;
      applyInset();
    },
    resize() { applyInset(); },
    addControls(folder: FolderApi) {
      const sunFolder = folder.addFolder({ title: 'Sun', expanded: true });
      const refit = () => { applySunAngles(); lighting.fitShadow(); };
      sunFolder.addBinding(sunParams, 'azimuth', { min: 0, max: 360, step: 1 }).on('change', refit);
      sunFolder.addBinding(sunParams, 'elevation', { min: 8, max: 80, step: 1 }).on('change', refit);
      sunFolder.addBinding(sunParams, 'intensity', { min: 0, max: 8, step: 0.1 }).on('change', () => { sun.intensity = sunParams.intensity; });
      const water = folder.addFolder({ title: 'Water', expanded: true });
      water.addBinding(oceanParams, 'amplitude', { min: 0, max: 3, step: 0.05, label: 'waves' }).on('change', () => { oceanAmplitude.value = oceanParams.amplitude; });
      const look = { caustics: 1, godRays: 1, clarity: 1 };
      water.addBinding(look, 'caustics', { min: 0, max: 3, step: 0.05 }).on('change', () => { causticStrength.value = look.caustics; });
      water.addBinding(look, 'godRays', { min: 0, max: 3, step: 0.05, label: 'god rays' }).on('change', () => { godRayStrength.value = look.godRays; });
      water.addBinding(look, 'clarity', { min: 0.2, max: 3, step: 0.05, label: 'murk' }).on('change', () => { waterClarity.value = look.clarity; });
      const fx = folder.addFolder({ title: 'Post', expanded: false });
      fx.addBinding(postParams, 'bloom', { min: 0, max: 2, step: 0.02 }).on('change', () => post.setBloom(postParams.bloom));
      fx.addBinding(postParams, 'exposure', { min: 0.4, max: 2, step: 0.02 }).on('change', () => post.setExposure(postParams.exposure));
    },
  };
  return world;
}

/** ?cam=side|top|close|front|under|island|boat repositions the orbit camera (target stays at the diorama centre). */
function applyCameraPreset(camera: Ctx['camera']) {
  const cam = new URLSearchParams(location.search).get('cam');
  const presets: Record<string, [number, number, number]> = {
    side: [0, 12, 78], top: [0.01, 96, 0.01], close: [22, 15, 30], front: [6, 14, 64], under: [8, 5, 27], island: [-8, 24, 36],
    corner: [32, 16, 32], low: [50, 9, 60], inside: [4, 8, 10], deep: [15, 2.8, 8], window: [16.5, 2.4, 2], deep2: [-12, 3.2, 12], closeup: [40, 27, 48], backside: [-42, 15, -46], backhigh: [-30, 28, -34], props: [-20, 12, 24], propsB: [-6, 10, 26], surf: [20, 26, 26], seabed: [15, 14, 20], grazing: [42, 22, 48],
  };
  if (cam && presets[cam]) camera.position.set(...presets[cam]);
  void WORLD;
}

/** ?testfish drops a few opaque spheres inside the water to verify refraction and depth in the water shaders. */
function addTestFish(scene: Ctx['scene']) {
  const mesh = new InstancedMesh(new SphereGeometry(0.16, 12, 8), new MeshStandardNodeMaterial({ color: new Color('#ff8a3c'), roughness: 0.5 }), 300);
  const o = new Object3D();
  for (let i = 0; i < 300; i++) {
    o.position.set((Math.sin(i * 12.9898) * 43758.5453 % 1) * 5, 2 + Math.abs(Math.sin(i * 78.233) * 43758.5453 % 1) * 4.5, (Math.sin(i * 39.346) * 43758.5453 % 1) * 5 + 1);
    o.scale.set(1.8, 1, 1); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
  }
  mesh.castShadow = true; mesh.frustumCulled = false; scene.add(mesh);
}

/** ?testheight: markers riding heightAt() so the CPU mirror can be compared with the rendered surface. */
function addHeightProbes(scene: Ctx['scene']) {
  const mesh = new InstancedMesh(new SphereGeometry(0.07, 10, 8), new MeshStandardNodeMaterial({ color: new Color('#ff2255'), emissive: new Color('#ff2255'), emissiveIntensity: 0.6 }), 60);
  const o = new Object3D(); mesh.frustumCulled = false; scene.add(mesh);
  let ripple = 0;
  return (world: World) => {
    if (ripple++ === 90) { world.ripple(new Vector3(0.5, WORLD.surface, 0.5), 1.5); world.ripple(new Vector3(-2, WORLD.surface, 3), 1); }
    for (let i = 0; i < 60; i++) {
      const x = -5.7 + (i % 30) / 29 * 11.4, z = i < 30 ? 0.5 : 3.0;
      o.position.set(x, world.heightAt(x, z), z); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
}
