import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Sprite, WireframeGeometry } from 'three/webgpu';
import { attribute, color, float, mix, uniform, positionWorld, normalWorld, normalViewGeometry, smoothstep, sin, normalize, mx_noise_float, mx_noise_vec3, mx_fractal_noise_float } from 'three/tsl';
import { generateTerrain, setTerrainSmooth } from '../lib/terrain';
import { disposeGraph } from './dispose';
import { createSeedDots } from './seedDots';
import type { Bench, BenchContext } from './types';
export function createTerrainBench(ctx: BenchContext): Bench {
  const { root, camera, controls, pane, settings, level } = ctx;
  camera.position.set(16, 15, 19); controls.target.set(0, 1, 0); controls.minDistance = 12; controls.maxDistance = 42;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.3;
  const stopOrbit = () => { controls.autoRotate = false; }; controls.addEventListener('start', stopOrbit);
  const countKey = level === 1 ? 'denseCount' : 'coarseCount', smoothKey = `smoothL${level}`;
  const params = Object.assign({ level, count: 1500, amplitude: 4.2, seed: 42, wireframe: false, seeds: false, biomes: true, sea: true, sampling: 'poisson' as 'poisson' | 'random', smooth: level === 1 }, settings, {
    level, count: Number(settings[countKey] ?? (level === 1 ? 30000 : 1500)), smooth: Boolean(settings[smoothKey] ?? (level === 1)),
  });
  const tint = uniform(1), amplitude = uniform(params.amplitude), slope = attribute('slope', 'float');
  const material = new MeshStandardNodeMaterial({ roughness: 0.92, flatShading: !params.smooth });
  const weights = attribute('biomeWeights', 'vec4');
  const biomeColor = color('#c9b98a').mul(weights.x).add(color('#718668').mul(weights.y)).add(color('#697780').mul(weights.z)).add(color('#edf2f4').mul(weights.w));
  material.colorNode = mix(color('#99a5a2'), biomeColor, tint).mul(slope.mul(-0.25).add(1));
  if (level === 1) {
    // Per-pixel height/slope bands deliberately expose smooth, streaky terrain.
    // Normalize altitude to keep the same bands when the amplitude slider changes.
    const h = positionWorld.y.div(amplitude), pixelSlope = float(1).sub(normalWorld.y).clamp();
    const n1 = mx_noise_float(positionWorld.mul(5));
    const n2 = mx_fractal_noise_float(positionWorld.mul(2.4), 3).mul(0.5).add(0.5);
    const sand = color('#c9b98a').mul(n1.mul(0.12).add(0.94));
    const strata = sin(positionWorld.y.mul(24).add(n1.mul(4))).mul(0.5).add(0.5);
    const rock = mix(color('#343c40'), color('#697780'), n2).mul(strata.mul(0.3).add(0.8));
    const rockMask = smoothstep(0.14, 0.24, h).max(smoothstep(0.3, 0.55, pixelSlope));
    let bands = mix(sand, rock, rockMask);
    const moss = smoothstep(0.16, 0.20, h).mul(float(1).sub(smoothstep(0.29, 0.38, h)))
      .mul(float(1).sub(smoothstep(0.35, 0.7, pixelSlope))).mul(smoothstep(0.2, 0.5, n2));
    bands = mix(bands, color('#718668'), moss);
    const snow = smoothstep(0.75, 0.84, h.add(n1.mul(0.014)))
      .mul(float(1).sub(smoothstep(0.4, 0.75, pixelSlope)));
    bands = mix(bands, color('#edf2f4'), snow);
    const wet = smoothstep(0.19, 0.17, h).mul(smoothstep(0.16, 0.17, h));
    material.colorNode = mix(color('#99a5a2'), bands.mul(float(1).sub(wet.mul(0.3))), tint);
    material.roughnessNode = mix(float(0.95), float(0.72), rockMask);
    const bump = mx_noise_vec3(positionWorld.mul(11)).mul(mix(float(0.05), float(0.3), rockMask));
    material.normalNode = normalize(normalViewGeometry.add(bump));
  }
  let content = new Group(); root.add(content);
  let data: ReturnType<typeof generateTerrain>, wire: LineSegments, seeds: Sprite, boundaries: LineSegments, sea: Mesh;
  function rebuild() {
    // This material survives regeneration; scene disposal handles it on bench exit.
    content.traverse(o => { const m = o as Mesh; if (m.material === material) m.material = []; });
    disposeGraph(content); content = new Group(); root.add(content);
    amplitude.value = params.amplitude;
    data = generateTerrain({ level, size: 14, count: params.count, seed: params.seed, amplitude: params.amplitude, sampling: params.sampling, smooth: params.smooth });
    const mesh = new Mesh(data.geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; content.add(mesh);
    wire = new LineSegments(new WireframeGeometry(data.geometry), new LineBasicMaterial({ color: '#e4f7df', transparent: true, opacity: 0.36 })); wire.position.y = 0.018; content.add(wire);
    const positions: number[] = [];
    // Cap dense-grid seed dots at 2,000; wireframe always shows every triangle.
    const seedStride = level === 1 ? Math.max(1, Math.ceil(data.heights.length / 2000)) : 1;
    for (let i = 0; i < data.heights.length; i += seedStride) positions.push(data.seeds[i * 2], data.heights[i] + 0.05, data.seeds[i * 2 + 1]);
    seeds = createSeedDots(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))); content.add(seeds);
    const edges: number[] = [], { triangles, halfedges } = data.delaunay;
    for (let i = 0; i < halfedges.length; i++) {
      const other = halfedges[i];
      if (other < i || data.biome[Math.floor(i / 3) * 3] === data.biome[Math.floor(other / 3) * 3]) continue;
      for (const id of [triangles[i], triangles[i % 3 === 2 ? i - 2 : i + 1]]) edges.push(data.seeds[id * 2], data.heights[id] + 0.023, data.seeds[id * 2 + 1]);
    }
    boundaries = new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(edges, 3)), new LineBasicMaterial({ color: '#b1c8a3', transparent: true, opacity: 0.18 })); content.add(boundaries);
    sea = new Mesh(new PlaneGeometry(14, 14), new MeshStandardNodeMaterial({ color: '#497f82', transparent: true, opacity: 0.38, roughness: 0.25, metalness: 0.3, depthWrite: false }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = params.amplitude * 0.17; content.add(sea); reveal();
  }
  function reveal() { wire.visible = params.wireframe; seeds.visible = params.seeds; boundaries.visible = params.biomes; sea.visible = params.sea; tint.value = +params.biomes; }
  pane.addBinding(params, 'level', { readonly: true });
  pane.addBinding(params, 'count', { label: 'seed count ≈', min: level === 1 ? 2000 : 200, max: level === 1 ? 40000 : 4000, step: 100 }).on('change', e => { if (e.last) rebuild(); });
  pane.addBinding(params, 'amplitude', { min: 1, max: 7, step: 0.1 }).on('change', e => { if (e.last) rebuild(); });
  pane.addButton({ title: 'Regenerate seed' }).on('click', () => { params.seed++; rebuild(); });
  const folder = pane.addFolder({ title: 'Reveal' });
  const syncSmooth = () => { setTerrainSmooth(data.geometry, params.smooth); material.flatShading = !params.smooth; material.needsUpdate = true; };
  folder.addBinding(params, 'smooth', { label: 'smooth shading' }).on('change', syncSmooth);
  if (level === 3) folder.addBinding(params, 'sampling', { options: { poisson: 'poisson', random: 'random' } }).on('change', rebuild);
  for (const [key, label] of [['wireframe', 'wireframe'], ['seeds', level === 1 ? 'seeds ≤2000' : 'seeds'], ['biomes', 'biome regions'], ['sea', 'sea level']] as const) folder.addBinding(params, key, { label }).on('change', reveal);
  rebuild();
  return { update() {}, dispose() { Object.assign(settings, params, { [countKey]: params.count, [smoothKey]: params.smooth }); controls.removeEventListener('start', stopOrbit); material.dispose(); }, setReveal(values) {
    const regenerate = ['sampling', 'count', 'amplitude', 'seed'].some(key => key in values && values[key] !== params[key as keyof typeof params]);
    Object.assign(params, values);
    if (regenerate) rebuild();
    if ('smooth' in values) syncSmooth();
    reveal(); pane.refresh();
  }, diagnostics: () => ({ seedCount: data.heights.length, triangleCount: data.biome.length / 3, seedCoordinates: Array.from(data.seeds), heightAt: data.heightAt, meshPositions: Array.from(data.geometry.getAttribute('position').array), ...params, sampling: level < 3 ? 'grid' : params.sampling }) };
}
