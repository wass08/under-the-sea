import { type Node, Color, DirectionalLight, EquirectangularReflectionMapping, HemisphereLight, PMREMGenerator, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { Fn, float, texture, color, mix, normalWorldGeometry, positionWorld, smoothstep, vec2, vec3 } from 'three/tsl';
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { simTime, sunDirection, sunElevation, waterHeight, waterNormal } from '../state';

export const signedWaterDistance = positionWorld.sub(vec3(0, waterHeight, 0)).dot(waterNormal);
export const waterDepth = signedWaterDistance.negate().max(0);
export const submerged = smoothstep(0, 0.09, waterDepth);
// Project a world-space point back along the sun ray onto a horizontal reference plane.
export const sunProjection = positionWorld.xz.sub(sunDirection.xz.mul(positionWorld.y.div(sunDirection.y.max(0.2))));
const caustics = createCausticsUniforms();
caustics.scaleA.value = 2.3; caustics.scaleB.value = 2.65;
caustics.sharpness.value = 36; caustics.intensity.value = 2.4;
caustics.rgbOffset.value = 0.006;
// One light-space basis for refraction: long axis points away from the sun.
export const causticDirection = sunDirection.xz.negate().div(sunDirection.xz.length().max(.001));
const lightPoint = sunProjection.add(waterNormal.xz);
export const causticCoordinates = vec2(lightPoint.dot(causticDirection).mul(.43).sub(simTime.mul(.16)), lightPoint.dot(vec2(causticDirection.y.negate(),causticDirection.x)).mul(1.25));
export const causticLight = causticsField(causticCoordinates, simTime.mul(.18), { ...caustics, level: 3, depth: waterDepth })
  .mul(sunElevation.mul(0.6).add(0.4)).mul(waterDepth.mul(-0.16).exp());
// Flat terrain normals keep projected sunlight off steep, back-facing rock.
export const rockCaustics = causticLight.mul(normalWorldGeometry.dot(sunDirection).max(0))
  .mul(smoothstep(0.15, 0.8, normalWorldGeometry.y)).mul(0.24);
export function underwaterColor(base: Node<'vec3'>) {
  return mix(base, base.mul(color('#439f98')).mul(waterDepth.mul(-0.14).exp()), submerged.mul(0.80));
}
// Light-space mask for drifting motes.
export function lightShaftMask(point: Node<'vec3'>) {
  const projected = point.xz.sub(sunDirection.xz.mul(point.y.div(sunDirection.y.max(0.2))));
  return projected.x.mul(3.5).add(projected.y.mul(1.7)).add(simTime.mul(0.12)).sin().mul(0.5).add(0.5).pow(12);
}
export const shaftMask = lightShaftMask(positionWorld);

export async function createLighting(scene: Scene, renderer: WebGPURenderer) {
  let environment = 'Poly Haven · CC0';
  try {
    const hdr = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}hdri/sky.hdr`);
    hdr.mapping = EquirectangularReflectionMapping;
    scene.environment = hdr; scene.background = hdr;
    scene.backgroundBlurriness = 0.65; scene.backgroundIntensity = 0.09;
    scene.environmentIntensity = 0.85;
  } catch (error) {
    console.warn('HDRI unavailable; using RoomEnvironment PMREM.', error);
    const generator = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = generator.fromScene(room, 0.04).texture;
    scene.background = new Color('#192b35');
    room.dispose(); generator.dispose(); environment = 'RoomEnvironment fallback';
  }
  const sun = new DirectionalLight('#eef5ff', 2.5);
  sun.castShadow = true; sun.shadow.intensity = 0.32; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6, near: 0.1, far: 35 });
  sun.shadow.radius = 12;
  // Fixed 4×4 tent PCF: soft penumbra without per-pixel stochastic rotation.
  // Hardware bilinear comparison filters each tap; no VSM intermediate targets.
  (sun.shadow as typeof sun.shadow & { filterNode: unknown }).filterNode = Fn(({depthTexture, shadowCoord}: any) => {
    const result=float(0).toVar();
    for(let y=0;y<4;y++)for(let x=0;x<4;x++) {
      const weight=[1,3,3,1][x]*[1,3,3,1][y]/64;
      result.addAssign(texture(depthTexture,shadowCoord.xy.add(vec2(x-1.5,y-1.5).mul(8/2048))).compare(shadowCoord.z).mul(weight));
    }
    return result;
  }); sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.0002;
  sun.target.position.set(0, 0.7, 0);
  scene.add(sun, sun.target, new HemisphereLight('#b8dce1', '#344753', 0.85));
  const cold = new Color('#fff3dc'), warm = new Color('#ffc78a');
  const direction = new Vector3(), origin = new Vector3();
  const updateShadow = sun.shadow.updateMatrices.bind(sun.shadow);
  sun.shadow.updateMatrices = light => {
    const camera = sun.shadow.camera;
    camera.left=-7; camera.right=7; camera.top=6; camera.bottom=-6; camera.updateProjectionMatrix();
    updateShadow(light);
    origin.set(0,0,0).project(camera);
    const dx=(Math.round(origin.x*1024)-origin.x*1024)*14/2048;
    const dy=(Math.round(origin.y*1024)-origin.y*1024)*12/2048;
    camera.left-=dx;camera.right-=dx;camera.bottom-=dy;camera.top-=dy;camera.updateProjectionMatrix();
    updateShadow(light);
  };
  return { environment, sun, update(time: number) {
    const phase = time * Math.PI * 2 / 60;
    const elevation = 0.65 + Math.sin(phase) * 0.12;
    direction.set(Math.cos(phase + 2.3), elevation, Math.sin(phase + 2.3)).normalize();
    sunDirection.value.copy(direction); sunElevation.value = direction.y;
    sun.position.copy(direction).multiplyScalar(14).add(sun.target.position);
    sun.color.copy(warm).lerp(cold, (elevation - 0.53) / 0.24);
    sun.intensity = 1.6 + elevation * 0.7;
  } };
}
