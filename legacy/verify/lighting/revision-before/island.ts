import { DataTexture, FloatType, RedFormat, LinearFilter, BoxGeometry, DodecahedronGeometry, InstancedMesh, Mesh, MeshStandardNodeMaterial, Object3D, Raycaster, Scene, Vector3 } from 'three/webgpu';
import { attribute, color, float, mix, mx_noise_float, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { causticLight, rockCaustics, signedWaterDistance, submerged, underwaterColor, waterDepth } from './lighting';
import { generateIslandTerrain } from '../lib/terrain';
import { random, TANK } from '../state';

// Presenter choice: use any seed labelled on verify/island-sheet.png.
export const ISLAND_SEED = 166;

/** Poisson/Delaunay landform: unequal twin peaks, a drowned saddle and a front sand skirt. */
export function createIslandMaterial() {
  const material = new MeshStandardNodeMaterial({ roughness: .98, metalness: 0, flatShading: true });
  const region = attribute('biome', 'float');
  const weights = attribute('biomeWeights', 'vec4');
  const tint = color('#d7b477').mul(weights.x).add(color('#527b32').mul(weights.y)).add(color('#746957').mul(weights.z)).add(color('#746957').mul(weights.w));
  const wet = smoothstep(-.08, .015, signedWaterDistance).mul(float(1).sub(smoothstep(0.04, 0.16, signedWaterDistance)));
  // Neutral teal absorption preserves rock/sand albedo instead of multiplying it by dark green.
  const slate = region.greaterThan(1.5).and(region.lessThan(2.5));
  const albedo = mix(tint.rgb, tint.rgb.mul(vec3(0.84, 1.04, 1.30)), submerged.mul(slate.select(1, 0)));
  const dry = mix(albedo, color('#527b32'), smoothstep(.01,.16,signedWaterDistance).mul(weights.y).mul(1.6).min(.65)).mul(float(1).sub(wet.mul(0.55)));
  material.colorNode = mix(dry, dry.mul(color('#a8d9db')).mul(waterDepth.mul(-0.14).exp()), submerged.mul(0.80)).mul(mix(float(1), float(.80), submerged));
  // Restrained indirect fill leaves the spot-facing facets distinct under water.
  material.aoNode = mix(float(1), float(.80), submerged);
  material.emissiveNode = rockCaustics.add(tint.rgb.mul(color('#b7d2e8')).mul(.045).mul(submerged));
  return material;
}
export function createIsland(scene: Scene) {
  const data = generateIslandTerrain(ISLAND_SEED);
  const geometry=data.geometry, positions=geometry.getAttribute('position');
  const material=createIslandMaterial();
  const peak = new Mesh(geometry, material);
  peak.position.y = TANK.floor + 0.02; peak.castShadow = true; peak.receiveShadow = true; scene.add(peak);

  const sand = new MeshStandardNodeMaterial({ roughness: 0.87 });
  const grain = mx_noise_float(positionWorld.mul(38)).mul(0.5).add(0.5);
  sand.colorNode = underwaterColor(mix(color('#9f9173'), color('#d0b98b'), grain));
  sand.emissiveNode = causticLight;
  const bed = new Mesh(new BoxGeometry(TANK.width - .13, 0.12, TANK.depth - .13), sand);
  bed.position.y = TANK.floor + 0.06; bed.receiveShadow = true; scene.add(bed);
  const gravelMaterial = new MeshStandardNodeMaterial({ roughness: 0.85 });
  gravelMaterial.colorNode = underwaterColor(color('#a19882').rgb); gravelMaterial.emissiveNode = causticLight;
  const gravel = new InstancedMesh(new DodecahedronGeometry(1, 0), gravelMaterial, 130);
  const rng = random(765), transform = new Object3D(), ray = new Raycaster();
  peak.updateMatrixWorld(true);
  const clear=(x:number,z:number,r:number)=>{
    for(let j=0;j<9;j++){
      const a=j*Math.PI/4,px=x+(j===8?0:Math.cos(a)*r),pz=z+(j===8?0:Math.sin(a)*r);
      ray.set(new Vector3(px,TANK.top+1,pz),new Vector3(0,-1,0));
      if((ray.intersectObject(peak,false)[0]?.point.y??0)>TANK.floor+.12) return false;
    }
    return true;
  };
  for (let i = 0; i < gravel.count; i++) {
    const size = 0.025 + rng() ** 3 * 0.16;
    do { transform.position.set((rng() - 0.5) * (TANK.width - .35), TANK.floor + 0.12 + size * 0.25, (rng() - 0.5) * (TANK.depth - .4)); } while(!clear(transform.position.x,transform.position.z,size*1.15));
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
    const ix = (v: number) => Math.max(0, Math.min(resolution - 1, Math.floor((v / TANK.width + 0.5) * resolution)));
    const iz = (v: number) => Math.max(0, Math.min(resolution - 1, Math.floor((v / TANK.depth + 0.5) * resolution)));
    for (let b = iz(Math.min(...z)); b <= iz(Math.max(...z)); b++) for (let a = ix(Math.min(...x)); a <= ix(Math.max(...x)); a++) {
      const px = ((a + 0.5) / resolution - 0.5) * TANK.width, pz = ((b + 0.5) / resolution - 0.5) * TANK.depth;
      const u = ((z[1] - z[2]) * (px - x[2]) + (x[2] - x[1]) * (pz - z[2])) / denominator;
      const v = ((z[2] - z[0]) * (px - x[2]) + (x[0] - x[2]) * (pz - z[2])) / denominator;
      if (u >= 0 && v >= 0 && u + v <= 1) heights[b * resolution + a] = Math.max(heights[b * resolution + a], u * y[0] + v * y[1] + (1 - u - v) * y[2]);
    }
  }
  const heightTexture = new DataTexture(heights, resolution, resolution, RedFormat, FloatType);
  heightTexture.minFilter = heightTexture.magFilter = LinearFilter; heightTexture.needsUpdate = true;
  return { peak, focus: new Vector3(-.30,1.45,.15), heightTexture };
}
