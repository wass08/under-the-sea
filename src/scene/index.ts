import { DataTexture, Mesh, Vector3 } from 'three/webgpu';
import { Color, InstancedMesh, MeshStandardNodeMaterial, Object3D, SphereGeometry } from 'three/webgpu';
import type { Ctx, World } from '../contracts';
import type { FolderApi } from 'tweakpane';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { emitRipple, oceanHeightCpu, oceanParams, oceanAmplitude } from '../lib/ocean';
import { sampleGrid } from './field';
import { buildSlab, buildTerrain } from './terrain';
import { createSlabMaterial, createTerrainMaterial } from './materials';
import { applySunAngles, causticStrength, createLighting, godRayStrength, sunParams, waterClarity } from './lighting';
import { createAtmosphere } from './atmosphere';
import { createHeightTexture, createWater } from './water';
import { createPost, postParams } from './post';
import { createFlora } from './flora';
import { createIsland } from './island';
import { createBubbles, createPlankton } from './particles';

const gradient = { gx: 0, gz: 0 };

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

  const resolution = 128;
  const heights = sampleGrid(resolution);
  const heightTexture: DataTexture = createHeightTexture(sampleGrid(256), 256);
  const water = createWater(scene, camera, heightTexture, terrainData.edges);
  createFlora(scene); createIsland(scene);
  createPlankton(scene); const bubbles = createBubbles(scene);
  if (new URLSearchParams(location.search).has('testfish')) addTestFish(scene);
  const heightProbe = new URLSearchParams(location.search).has('testheight') ? addHeightProbes(scene) : null;
  const post = createPost(renderer, scene, camera);
  // Let the planar reflection (layer 1) also pick up other modules' boat / fisherman meshes.
  let reflectTimer = 0;
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
      bubbles.update(dt);
      const p = camera.position, inside = Math.abs(p.x) < WORLD.half && Math.abs(p.z) < WORLD.half && p.y > WORLD.bed - 0.6;
      const depth = world.heightAt(p.x, p.z) - p.y;
      post.setUnderwater(inside ? Math.max(0, Math.min(1, depth / 0.12)) : 0, Math.max(0, depth));
      heightProbe?.(world);
      reflectTimer -= dt;
      if (reflectTimer <= 0) { reflectTimer = 1; markReflective(); }
    },
    render() { post.render(); },
    resize() {},
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
    side: [0, 4.5, 26], top: [0.01, 34, 0.01], close: [7.5, 5.2, 10.5], front: [2, 5, 22], under: [3, 1.8, 9.5],
    island: [-2, 9, 13], corner: [11, 6, 11], low: [17, 3.4, 20], grazing: [14, 8.2, 16], inside: [1, 4, 3.5], surf: [7, 9.5, 9.5], seabed: [5, 6, 7],
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
