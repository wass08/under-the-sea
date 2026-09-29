import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Sprite, WireframeGeometry } from 'three/webgpu';
import { attribute, color, mix, uniform } from 'three/tsl';
import { generateTerrain } from '../lib/terrain';
import { circumcircles } from '../lib/triangulate';
import { disposeGraph } from './dispose';
import { createSeedDots } from './seedDots';
import type { Bench, BenchContext } from './types';
export function createTerrainBench(ctx: BenchContext): Bench {
  const { root, camera, controls, pane, settings, level } = ctx;
  camera.position.set(16, 15, 19); controls.target.set(0, 1, 0); controls.minDistance = 12; controls.maxDistance = 42;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.3;
  const stopOrbit = () => { controls.autoRotate = false; }; controls.addEventListener('start', stopOrbit);
  const params = Object.assign({ level, count: 1500, amplitude: 4.2, seed: 42, wireframe: false, seeds: false, circumcircles: false, biomes: true, sea: true }, settings, { level });
  const tint = uniform(1), biome = attribute('biome', 'float'), slope = attribute('slope', 'float');
  const material = new MeshStandardNodeMaterial({ roughness: 0.92, flatShading: true });
  const weights = attribute('biomeWeights', 'vec4');
  const biomeColor = color('#c9b98a').mul(weights.x).add(color('#718668').mul(weights.y)).add(color('#697780').mul(weights.z)).add(color('#edf2f4').mul(weights.w));
  material.colorNode = mix(color('#99a5a2'), biomeColor, tint).mul(slope.mul(-0.25).add(1));
  let content = new Group(); root.add(content);
  let data: ReturnType<typeof generateTerrain>, wire: LineSegments, seeds: Sprite, circles: LineSegments, boundaries: LineSegments, sea: Mesh;
  function rebuild() {
    // This material survives regeneration; scene disposal handles it on bench exit.
    content.traverse(o => { const m = o as Mesh; if (m.material === material) m.material = []; });
    disposeGraph(content); content = new Group(); root.add(content);
    data = generateTerrain({ level, size: 14, count: params.count, seed: params.seed, amplitude: params.amplitude });
    const mesh = new Mesh(data.geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; content.add(mesh);
    wire = new LineSegments(new WireframeGeometry(data.geometry), new LineBasicMaterial({ color: '#e4f7df', transparent: true, opacity: 0.36 })); wire.position.y = 0.018; content.add(wire);
    const positions: number[] = [];
    for (let i = 0; i < data.heights.length; i++) positions.push(data.seeds[i * 2], data.heights[i] + 0.05, data.seeds[i * 2 + 1]);
    seeds = createSeedDots(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))); content.add(seeds);
    const vertices: number[] = [], plane = Math.max(...data.heights) + 0.08;
    for (const { center: [x, z], radius } of circumcircles(data.delaunay).slice(0, 1500)) {
      if (radius > 14) continue;
      for (let j = 0; j < 28; j++) {
        const a = j / 28 * Math.PI * 2, b = (j + 1) / 28 * Math.PI * 2;
        vertices.push(x + Math.cos(a) * radius, plane, z + Math.sin(a) * radius, x + Math.cos(b) * radius, plane, z + Math.sin(b) * radius);
      }
    }
    circles = new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3)), new LineBasicMaterial({ color: '#82dbdc', transparent: true, opacity: 0.16 })); content.add(circles);
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
  function reveal() { wire.visible = params.wireframe; seeds.visible = params.seeds; circles.visible = params.circumcircles; boundaries.visible = params.biomes; sea.visible = params.sea; tint.value = +params.biomes; }
  pane.addBinding(params, 'level', { readonly: true });
  pane.addBinding(params, 'count', { label: 'seed count ≈', min: 200, max: 4000, step: 100 }).on('change', e => { if (e.last) rebuild(); });
  pane.addBinding(params, 'amplitude', { min: 1, max: 7, step: 0.1 }).on('change', e => { if (e.last) rebuild(); });
  pane.addButton({ title: 'Regenerate seed' }).on('click', () => { params.seed++; rebuild(); });
  const folder = pane.addFolder({ title: 'Reveal' });
  for (const [key, label] of [['wireframe', 'wireframe'], ['seeds', 'seeds'], ['circumcircles', 'circumcircles ≤1500'], ['biomes', 'biome regions'], ['sea', 'sea level']] as const) folder.addBinding(params, key, { label }).on('change', reveal);
  rebuild();
  return { update() {}, dispose() { Object.assign(settings, params); controls.removeEventListener('start', stopOrbit); material.dispose(); }, setReveal(values) { Object.assign(params, values); reveal(); pane.refresh(); }, diagnostics: () => ({ seedCount: data.heights.length, triangleCount: data.biome.length / 3, seedCoordinates: Array.from(data.seeds), ...params }) };
}
