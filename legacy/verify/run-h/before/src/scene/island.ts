import { DataTexture, FloatType, RedFormat, LinearFilter, BoxGeometry, DodecahedronGeometry, InstancedMesh, Mesh, MeshStandardNodeMaterial, Object3D, Scene } from 'three/webgpu';
import { attribute, color, float, mix, mx_noise_float, positionWorld, smoothstep } from 'three/tsl';
import { causticLight, rockCaustics, signedWaterDistance, submerged, underwaterColor } from './lighting';
import { generateTerrain } from '../lib/terrain';
import { random, TANK } from '../state';

/** Poisson/Delaunay landform: a connected ridge softened into a submerged shore. */
export function createIsland(scene: Scene) {
  const mask = (x: number, z: number) => {
    const radius = (Math.abs(x / 2.45) ** 4 + Math.abs(z / 2.45) ** 4) ** 0.25;
    return Math.max(0, 1 - radius ** 4) ** 0.8;
  };
  const data = generateTerrain({ level: 3, size: 4.9, count: 1200, seed: 42, amplitude: 3.6, mask });
  const geometry = data.geometry, positions = geometry.getAttribute('position');
  let highest = 0;
  // A broad ridge under the noise connects the peaks and gives the shore room to breathe.
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const ridge = Math.exp(-((x / 2) ** 2 + ((z + x * 0.16) / 1.6) ** 2));
    const h = (positions.getY(i) * 0.48 + ridge * 2.1) * mask(x, z);
    positions.setY(i, h); highest = Math.max(highest, h);
  }
  for (let i = 0; i < positions.count; i++) positions.setXYZ(i, positions.getX(i), (positions.getY(i) / highest) ** 1.15 * 3.10, positions.getZ(i) * 3.05 / 4.9);
  geometry.computeVertexNormals();
  const biome = geometry.getAttribute('biome'), normals = geometry.getAttribute('normal');
  for (let i = 0; i < positions.count; i += 3) {
    const h = (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
    const kind = h > 2.86 && normals.getY(i) > 0.42 ? 3 : h < 2.44 && h > 2.25 ? 0 : normals.getY(i) < 0.52 || h > 2.78 ? 2 : h < 0.38 ? 0 : 1;
    for (let j = 0; j < 3; j++) biome.setX(i + j, kind);
  }
  const material = new MeshStandardNodeMaterial({ roughness: 0.93, flatShading: true });
  const region = attribute('biome', 'float');
  const tint = region.lessThan(0.5).select(color('#c2b394'), region.lessThan(1.5).select(color('#70835a'), region.lessThan(2.5).select(color('#85817a'), color('#e6ecf0'))));
  const wet = smoothstep(0, 0.035, signedWaterDistance).mul(float(1).sub(smoothstep(0.04, 0.16, signedWaterDistance)));
  material.colorNode = underwaterColor(tint.mul(float(1).sub(wet.mul(0.42))));
  // Water attenuates diffuse sky/environment fill; preserve direct sun contrast.
  material.aoNode = mix(float(1), float(0.045), submerged);
  material.emissiveNode = rockCaustics;
  const peak = new Mesh(geometry, material);
  peak.position.y = TANK.floor + 0.02; peak.castShadow = true; peak.receiveShadow = true; scene.add(peak);

  const sand = new MeshStandardNodeMaterial({ roughness: 0.87 });
  const grain = mx_noise_float(positionWorld.mul(38)).mul(0.5).add(0.5);
  sand.colorNode = underwaterColor(mix(color('#9f9173'), color('#d0b98b'), grain));
  sand.emissiveNode = causticLight;
  const bed = new Mesh(new BoxGeometry(5.87, 0.12, 3.37), sand);
  bed.position.y = TANK.floor + 0.06; bed.receiveShadow = true; scene.add(bed);
  const gravelMaterial = new MeshStandardNodeMaterial({ roughness: 0.85 });
  gravelMaterial.colorNode = underwaterColor(color('#a19882').rgb); gravelMaterial.emissiveNode = causticLight;
  const gravel = new InstancedMesh(new DodecahedronGeometry(1, 0), gravelMaterial, 130);
  const rng = random(765), transform = new Object3D();
  for (let i = 0; i < gravel.count; i++) {
    const size = 0.025 + rng() ** 3 * 0.16;
    transform.position.set((rng() - 0.5) * 5.65, TANK.floor + 0.12 + size * 0.25, (rng() - 0.5) * 3.1);
    transform.scale.set(size, size * 0.6, size * 0.8); transform.rotation.set(rng(), rng() * 6, rng()); transform.updateMatrix(); gravel.setMatrixAt(i, transform.matrix);
  }
  gravel.receiveShadow = true; gravel.castShadow = true; scene.add(gravel);
  // Rasterize the actual triangular terrain into a light-occlusion height field.
  const resolution = 128, heights = new Float32Array(resolution * resolution).fill(TANK.floor + 0.12);
  for (let i = 0; i < positions.count; i += 3) {
    const x = [0, 1, 2].map(j => positions.getX(i + j)), z = [0, 1, 2].map(j => positions.getZ(i + j));
    const y = [0, 1, 2].map(j => positions.getY(i + j) + peak.position.y);
    const denominator = (z[1] - z[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (z[0] - z[2]);
    if (Math.abs(denominator) < 1e-9) continue;
    const ix = (v: number) => Math.max(0, Math.min(resolution - 1, Math.floor((v / 6 + 0.5) * resolution)));
    const iz = (v: number) => Math.max(0, Math.min(resolution - 1, Math.floor((v / 3.5 + 0.5) * resolution)));
    for (let b = iz(Math.min(...z)); b <= iz(Math.max(...z)); b++) for (let a = ix(Math.min(...x)); a <= ix(Math.max(...x)); a++) {
      const px = ((a + 0.5) / resolution - 0.5) * 6, pz = ((b + 0.5) / resolution - 0.5) * 3.5;
      const u = ((z[1] - z[2]) * (px - x[2]) + (x[2] - x[1]) * (pz - z[2])) / denominator;
      const v = ((z[2] - z[0]) * (px - x[2]) + (x[0] - x[2]) * (pz - z[2])) / denominator;
      if (u >= 0 && v >= 0 && u + v <= 1) heights[b * resolution + a] = Math.max(heights[b * resolution + a], u * y[0] + v * y[1] + (1 - u - v) * y[2]);
    }
  }
  const heightTexture = new DataTexture(heights, resolution, resolution, RedFormat, FloatType);
  heightTexture.minFilter = heightTexture.magFilter = LinearFilter; heightTexture.needsUpdate = true;
  return { focus: peak.position.clone().setY(1.95), heightTexture };
}
