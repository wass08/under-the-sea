import { type Node, Mesh, MeshStandardNodeMaterial, MeshBasicNodeMaterial, CylinderGeometry, TubeGeometry, CubicBezierCurve3, Color, SpotLight, EquirectangularReflectionMapping, HemisphereLight, PMREMGenerator, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { Fn, float, texture, color, mix, normalWorldGeometry, positionWorld, shadow, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { simTime, sunDirection, sunElevation, waterHeight, waterNormal, waterAgitation, TANK } from '../state';

const head = new Vector3(-3.8, 5.5, -2.7), aim = new Vector3(.3, 1, .3);
const coneAngle = Math.PI*50/180, penumbra = .50;
const lampLight = new SpotLight('#fff2df', 155, 0, coneAngle, penumbra, 2);
const lampOrigin = uniform(head.clone());
// sunDirection is the central ray (head -> target); lighting normals use its inverse.
export const towardLamp = sunDirection.negate();
export function spotlightFalloff(point: Node<'vec3'>) {
  const fromLamp = point.sub(lampOrigin);
  return smoothstep(Math.cos(coneAngle), Math.cos(coneAngle*(1-penumbra)), fromLamp.normalize().dot(sunDirection));
}
export const spotlightCone = spotlightFalloff(positionWorld);
export const lampAttenuation = float(48).div(positionWorld.sub(lampOrigin).length().pow(2)).min(1);
export const signedWaterDistance = positionWorld.sub(vec3(0, waterHeight, 0)).dot(waterNormal);
export const waterDepth = signedWaterDistance.negate().max(0);
export const submerged = smoothstep(0, 0.09, waterDepth);
// Project a world-space point back along the sun ray onto a horizontal reference plane.
export const sunProjection = positionWorld.xz.sub(sunDirection.xz.mul(positionWorld.y.div(sunDirection.y.min(-0.2))));
// Exactly the Lab level-3 two-layer RGB Worley field, in lamp-aligned coordinates.
export const causticDirection = sunDirection.xz.div(sunDirection.xz.length().max(.001));
export const causticParams = createCausticsUniforms();
export function causticCoordinates(stretch = 1) {
  const along = sunProjection.dot(causticDirection).mul(stretch).sub(simTime.mul(.10));
  const across = sunProjection.dot(vec2(causticDirection.y.negate(), causticDirection.x));
  return vec2(along, across);
}
export const causticDrain = smoothstep(TANK.floor, TANK.floor + .2, waterHeight);
export const causticLight = causticsField(causticCoordinates(), simTime, { ...causticParams, level: 3, depth: waterDepth })
  .mul(vec3(.55, .88, 1)).mul(waterDepth.mul(-.30).exp()).mul(causticDrain).mul(submerged).mul(spotlightCone).mul(vec3(shadow(lampLight) as unknown as Node<'vec3'>).r);
export const rockCaustics = causticLight.mul(normalWorldGeometry.dot(towardLamp).max(0))
  .mul(smoothstep(0.15, 0.8, normalWorldGeometry.y)).mul(0.24);
export function underwaterColor(base: Node<'vec3'>) {
  return mix(base, base.mul(color('#c0dbe5')).mul(waterDepth.mul(-0.14).exp()), submerged.mul(0.55));
}
// Apertures live in the surface plane around the cone axis, never at tank corners.
// Along/across offsets aim one opening at the lit flank and two at open foreground water.
const apertures = [[-1.35,.12,.70],[.25,1.50,1],[1.9,-.35,.90]].map(([along,across,gain])=>({along,across,gain,node:uniform(new Vector3())}));
const rayAxis = aim.clone().sub(head).normalize(), surfaceAim = new Vector3();
const alongAxis = new Vector3(rayAxis.x,0,rayAxis.z).normalize(), acrossAxis = new Vector3(-alongAxis.z,0,alongAxis.x);
export function updateLightApertures() {
  const time=simTime.value,n=waterNormal.value;
  surfaceAim.copy(head).addScaledVector(rayAxis,(waterHeight.value*n.y-head.dot(n))/rayAxis.dot(n));
  apertures.forEach((a,i)=>{
    const along=a.along+Math.sin(time*.23+i*2)*.055,across=a.across+Math.cos(time*.19+i*3)*.055;
    a.node.value.set(surfaceAim.x+alongAxis.x*along+acrossAxis.x*across,surfaceAim.z+alongAxis.z*along+acrossAxis.z*across,a.gain*(.88+Math.sin(time*.48+i*1.7)*.12)*(1+waterAgitation.value*.12));
  });
}
updateLightApertures();
// Backtrace to the tilted surface along the central ray; constant mask coordinates
// describe diagonal beams, shared verbatim by the raymarch and mote lighting.
export function lightShaftMask(point: Node<'vec3'>) {
  const signed = point.sub(vec3(0,waterHeight,0)).dot(waterNormal);
  const surfacePoint = point.sub(sunDirection.mul(signed.div(sunDirection.dot(waterNormal).min(-.2))));
  const mask = float(0).toVar();
  for (const a of apertures) {
    const delta = surfacePoint.xz.sub(a.node.xy);
    mask.addAssign(smoothstep(.60,.06,delta.length()).mul(a.node.z));
  }
  const edge = (p: Node<'vec3'>) => smoothstep(0,.15,float(TANK.width/2).sub(p.x.abs()).min(float(TANK.depth/2).sub(p.z.abs())));
  return mask.min(1).mul(spotlightFalloff(surfacePoint)).mul(spotlightFalloff(point)).mul(edge(surfacePoint)).mul(edge(point));
}
export const shaftMask = Fn(() => lightShaftMask(positionWorld))();

export async function createLighting(scene: Scene, renderer: WebGPURenderer) {
  let environment = 'Poly Haven · CC0';
  try {
    const hdr = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}hdri/sky.hdr`);
    hdr.mapping = EquirectangularReflectionMapping;
    scene.environment = hdr; scene.background = hdr;
    scene.backgroundBlurriness = 0.65; scene.backgroundIntensity = 0.09;
    scene.environmentIntensity = 0.40;
  } catch (error) {
    console.warn('HDRI unavailable; using RoomEnvironment PMREM.', error);
    const generator = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = generator.fromScene(room, 0.04).texture;
    scene.background = new Color('#192b35');
    room.dispose(); generator.dispose(); environment = 'RoomEnvironment fallback';
  }
  scene.environmentIntensity = .40;
  const sun = lampLight;
  sun.castShadow = true; sun.shadow.intensity = 0.72; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { near: .2, far: 35 });
  sun.shadow.radius = 4;
  // Fixed 4×4 tent PCF: soft penumbra without per-pixel stochastic rotation.
  // Hardware bilinear comparison filters each tap; no VSM intermediate targets.
  (sun.shadow as typeof sun.shadow & { filterNode: unknown }).filterNode = Fn(({depthTexture, shadowCoord}: any) => {
    const result=float(0).toVar();
    for(let y=0;y<4;y++)for(let x=0;x<4;x++) {
      const weight=[1,3,3,1][x]*[1,3,3,1][y]/64;
      result.addAssign(texture(depthTexture,shadowCoord.xy.add(vec2(x-1.5,y-1.5).mul(3/2048))).compare(shadowCoord.z).mul(weight));
    }
    return result;
  }); sun.shadow.normalBias = 0.018; sun.shadow.bias = -0.00008;
  scene.add(sun, sun.target, new HemisphereLight('#a6c8ff', '#857352', .45));
  // Perspective shadow projection follows the cone; orthographic texel snapping does not apply.
  sun.target.position.copy(aim); sun.position.copy(head);
  sunDirection.value.copy(aim).sub(head).normalize();
  sunElevation.value = -sunDirection.value.y;
  const dark = new MeshStandardNodeMaterial({ color: '#111b28', roughness: .68, metalness: .35 });
  const foot = new Mesh(new CylinderGeometry(.45, .50, .10, 48), dark);
  foot.position.set(-5.5, -.37, -3.4); foot.castShadow = true; scene.add(foot);
  const curve = new CubicBezierCurve3(new Vector3(-5.5,-.32,-3.4), new Vector3(-5.65,6.5,-3.4), new Vector3(-4.6,6.3,-3.2), head);
  const arc = new Mesh(new TubeGeometry(curve, 80, .037, 8, false), dark); arc.castShadow = true; scene.add(arc);
  const housing = new Mesh(new CylinderGeometry(.48,.48,.10,64), dark);
  housing.quaternion.setFromUnitVectors(new Vector3(0,-1,0), sunDirection.value);
  housing.position.copy(head); scene.add(housing);
  const diffuser = new Mesh(new CylinderGeometry(.445,.445,.025,64), new MeshBasicNodeMaterial({ color: new Color('#fff0d5').multiplyScalar(5), toneMapped: false }));
  diffuser.quaternion.copy(housing.quaternion);
  diffuser.position.copy(head).addScaledVector(sunDirection.value, .06); scene.add(diffuser);
  return { environment, sun, lampPosition: head.toArray(), lampTarget: aim.toArray(), elevation: Math.asin(sunElevation.value)*180/Math.PI };
}
