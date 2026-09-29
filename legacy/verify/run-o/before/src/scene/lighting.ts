import { type Node, Mesh, MeshStandardNodeMaterial, MeshBasicNodeMaterial, CylinderGeometry, TubeGeometry, CubicBezierCurve3, Color, DirectionalLight, EquirectangularReflectionMapping, HemisphereLight, PMREMGenerator, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { Fn, float, texture, color, mix, normalWorldGeometry, positionWorld, shadow, smoothstep, vec2, vec3 } from 'three/tsl';
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { simTime, sunDirection, sunElevation, waterHeight, waterNormal, TANK } from '../state';

const lampLight = new DirectionalLight('#fff2df', 2.5);
export const signedWaterDistance = positionWorld.sub(vec3(0, waterHeight, 0)).dot(waterNormal);
export const waterDepth = signedWaterDistance.negate().max(0);
export const submerged = smoothstep(0, 0.09, waterDepth);
// Project a world-space point back along the sun ray onto a horizontal reference plane.
export const sunProjection = positionWorld.xz.sub(sunDirection.xz.mul(positionWorld.y.div(sunDirection.y.max(0.2))));
// Exactly the Lab level-3 two-layer RGB Worley field, in lamp-aligned coordinates.
export const causticDirection = sunDirection.xz.negate().div(sunDirection.xz.length().max(.001));
export const causticParams = createCausticsUniforms();
export function causticCoordinates(stretch = 1) {
  const along = sunProjection.dot(causticDirection).mul(stretch).sub(simTime.mul(.10));
  const across = sunProjection.dot(vec2(causticDirection.y.negate(), causticDirection.x));
  return vec2(along, across);
}
export const causticDrain = smoothstep(TANK.floor, TANK.floor + .2, waterHeight);
export const causticLight = causticsField(causticCoordinates(), simTime, { ...causticParams, level: 3, depth: waterDepth })
  .mul(vec3(.55, .88, 1)).mul(waterDepth.mul(-.30).exp()).mul(causticDrain).mul(submerged).mul(vec3(shadow(lampLight) as unknown as Node<'vec3'>).r);
export const rockCaustics = causticLight.mul(normalWorldGeometry.dot(sunDirection).max(0))
  .mul(smoothstep(0.15, 0.8, normalWorldGeometry.y)).mul(0.24);
export function underwaterColor(base: Node<'vec3'>) {
  return mix(base, base.mul(color('#c0dbe5')).mul(waterDepth.mul(-0.14).exp()), submerged.mul(0.55));
}
// Light-space mask for drifting motes.
export function lightShaftMask(point: Node<'vec3'>) {
  const projected = point.xz.sub(sunDirection.xz.mul(point.y.div(sunDirection.y.max(0.2))));
  return projected.x.mul(3.5).add(projected.y.mul(1.7)).sin().mul(0.5).add(0.5).pow(12);
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
  const sun = lampLight;
  sun.castShadow = true; sun.shadow.intensity = 0.32; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -TANK.width, right: TANK.width, top: TANK.depth+2, bottom: -TANK.depth-2, near: 0.1, far: 35 });
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
  scene.add(sun, sun.target, new HemisphereLight('#8aafff', '#102746', 0.45));
  const origin = new Vector3();
  const updateShadow = sun.shadow.updateMatrices.bind(sun.shadow);
  sun.shadow.updateMatrices = light => {
    const camera = sun.shadow.camera;
    camera.left=-TANK.width; camera.right=TANK.width; camera.top=TANK.depth+2; camera.bottom=-TANK.depth-2; camera.updateProjectionMatrix();
    updateShadow(light);
    origin.set(0,0,0).project(camera);
    const dx=(Math.round(origin.x*1024)-origin.x*1024)*(TANK.width*2)/2048;
    const dy=(Math.round(origin.y*1024)-origin.y*1024)*((TANK.depth+2)*2)/2048;
    camera.left-=dx;camera.right-=dx;camera.bottom-=dy;camera.top-=dy;camera.updateProjectionMatrix();
    updateShadow(light);
  };
  // Fixed arc lamp: target and direction are the source for every optical effect.
  const head = new Vector3(-2.65, 6.1, -2.3);
  sun.target.position.set(0, 1.25, 0);
  sun.position.copy(head);
  sunDirection.value.copy(head).sub(sun.target.position).normalize();
  sunElevation.value = sunDirection.value.y;
  const dark = new MeshStandardNodeMaterial({ color: '#111b28', roughness: .68, metalness: .35 });
  const foot = new Mesh(new CylinderGeometry(.45, .50, .10, 48), dark);
  foot.position.set(-4.65, -.37, -3.15); foot.castShadow = true; scene.add(foot);
  const curve = new CubicBezierCurve3(new Vector3(-4.65,-.32,-3.15), new Vector3(-4.8,7.5,-3.15), new Vector3(-3.15,7.0,-2.6), head);
  const arc = new Mesh(new TubeGeometry(curve, 80, .037, 8, false), dark); arc.castShadow = true; scene.add(arc);
  const housing = new Mesh(new CylinderGeometry(.48,.48,.10,64), dark);
  housing.quaternion.setFromUnitVectors(new Vector3(0,-1,0), sunDirection.value.clone().negate());
  housing.position.copy(head); scene.add(housing);
  const diffuser = new Mesh(new CylinderGeometry(.445,.445,.025,64), new MeshBasicNodeMaterial({ color: new Color('#fff0d5').multiplyScalar(5), toneMapped: false }));
  diffuser.quaternion.copy(housing.quaternion);
  diffuser.position.copy(head).addScaledVector(sunDirection.value, -.06); scene.add(diffuser);
  return { environment, sun, lampPosition: head.toArray() };
}
