import { Mesh, MeshStandardNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { color, mix, positionWorld, smoothstep, uniform, vec2 } from 'three/tsl';
import { createNoise2D } from '../lib/noise';
import { causticsField, createCausticsUniforms } from '../lib/worley';
import type { Bench, BenchContext } from './types';
export function createCausticsBench({ root, camera, controls, pane, settings, level }: BenchContext): Bench {
  camera.position.set(12, 13, 16); controls.target.set(0, 0.4, 0); controls.minDistance = 10; controls.maxDistance = 35; controls.autoRotate = false;
  const params = Object.assign({ rawField: false, showSeeds: false, layer: 0, freeze: false, scaleA: 2.3, scaleB: 3.7, speed: 0.32, sharpness: 18, intensity: 1.65, rgbOffset: 0.012, waterLevel: 1.05 }, settings);
  const uniforms = createCausticsUniforms(), clock = uniform(0), waterLevel = uniform(params.waterLevel);
  const geometry = new PlaneGeometry(14, 11, 110, 90); geometry.rotateX(-Math.PI / 2);
  const noise = createNoise2D(81), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    positions.setY(i, 0.1 + (x + 7) / 14 * 1.65 + noise(x * 0.3, z * 0.3) * 0.11);
  }
  geometry.computeVertexNormals();
  const depth = waterLevel.sub(positionWorld.y), projected = positionWorld.xz.sub(vec2(-0.45, 0.35).mul(positionWorld.y.div(0.8)));
  const light = causticsField(projected, clock, { ...uniforms, level, depth });
  const material = new MeshStandardNodeMaterial({ roughness: 0.92 });
  const base = level < 3 ? color('#386b70').rgb : mix(color('#c9b98a'), color('#477e78'), smoothstep(0, 0.25, depth).mul(0.72));
  // Add the projected caustic term to diffuse sand; raw reveal removes the sand shading entirely.
  material.colorNode = mix(base.add(light), color('#000000'), uniforms.rawField);
  material.emissiveNode = light.mul(uniforms.rawField);
  const sand = new Mesh(geometry, material); sand.receiveShadow = true; root.add(sand);
  const water = new Mesh(new PlaneGeometry(14, 11), new MeshStandardNodeMaterial({ color: '#679d99', transparent: true, opacity: 0.065, roughness: 0.22, metalness: 0.15, depthWrite: false }));
  water.rotation.x = -Math.PI / 2; water.position.y = params.waterLevel; root.add(water);
  function sync() {
    for (const key of ['scaleA', 'scaleB', 'speed', 'sharpness', 'intensity', 'rgbOffset', 'layer'] as const) uniforms[key].value = params[key];
    for (const key of ['rawField', 'showSeeds', 'freeze'] as const) uniforms[key].value = +params[key];
    waterLevel.value = params.waterLevel; water.position.y = params.waterLevel; water.visible = !params.rawField;
  }
  const reveal = pane.addFolder({ title: 'Reveal' });
  reveal.addBinding(params, 'rawField', { label: level === 2 ? 'raw F2 − F1' : 'raw F1' });
  reveal.addBinding(params, 'showSeeds', { label: 'cell seeds' });
  if (level === 3) reveal.addBinding(params, 'layer', { options: { both: 0, A: 1, B: 2 } });
  reveal.addBinding(params, 'freeze');
  const folder = pane.addFolder({ title: 'Parameters' });
  for (const [key, min, max, step] of [['scaleA', 0.5, 6, 0.1], ['scaleB', 0.5, 8, 0.1], ['speed', 0, 1, 0.01], ['sharpness', 2, 40, 1], ['intensity', 0, 4, 0.05], ['rgbOffset', 0, 0.05, 0.001], ['waterLevel', 0.2, 2, 0.01]] as const) {
    if (level < 3 && (key === 'scaleB' || key === 'rgbOffset')) continue;
    if (level === 1 && key === 'sharpness') continue;
    folder.addBinding(params, key, { min, max, step, label: key === 'rgbOffset' ? 'rgb offset' : key === 'waterLevel' ? 'water level' : key });
  }
  pane.on('change', sync); sync();
  return { update(dt) { uniforms.advance(clock, dt); }, dispose() { Object.assign(settings, params); }, setReveal(values) { Object.assign(params, values); sync(); pane.refresh(); }, diagnostics: () => ({ elapsed: clock.value, ...params }) };
}
