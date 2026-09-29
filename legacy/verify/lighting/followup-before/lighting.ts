import { type Node, Mesh, MeshStandardNodeMaterial, MeshBasicNodeMaterial, BoxGeometry, CylinderGeometry, TubeGeometry, CubicBezierCurve3, Color, SpotLight, EquirectangularReflectionMapping, HemisphereLight, PMREMGenerator, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { Fn, float, texture, color, mix, mx_noise_float, normalWorldGeometry, positionWorld, shadow, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { lampOn, simTime, sunDirection, sunElevation, waterHeight, waterNormal, waterAgitation, TANK } from '../state';

const head = new Vector3(-3.4, 5.25, -2.4), aim = new Vector3(.2, .9, .2);
const coneAngle = Math.PI*43/180, penumbra = .50;
const lampLight = new SpotLight('#fff2df', 125, 0, coneAngle, penumbra, 2);
// Keep the tighter illumination cone independent of the full plinth shadow coverage.
lampLight.shadow.focus = 1.25;
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
// Reuse one depth map for direct lighting, caustics, contact fill and the floor.
export const lampShadow=shadow(lampLight);
lampLight.shadow.shadowNode=lampShadow;
export const lampVisibility = vec3(lampShadow as unknown as Node<'vec3'>).r;
export const causticLight = causticsField(causticCoordinates(), simTime, { ...causticParams, level: 3, depth: waterDepth })
  .mul(vec3(.55, .88, 1)).mul(waterDepth.mul(-.30).exp()).mul(causticDrain).mul(submerged).mul(lampOn).mul(spotlightCone).mul(lampVisibility);
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
  sun.castShadow = true; sun.shadow.intensity = 0.90; sun.shadow.mapSize.set(2048, 2048);
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
  }); sun.shadow.normalBias = 0.028; sun.shadow.bias = -0.00008;
  const ambient = new HemisphereLight('#a6c8ff', '#857352', .45);
  scene.add(sun, sun.target, ambient);
  // Perspective shadow projection follows the cone; orthographic texel snapping does not apply.
  sun.target.position.copy(aim); sun.position.copy(head);
  sunDirection.value.copy(aim).sub(head).normalize();
  sunElevation.value = -sunDirection.value.y;
  const dark = new MeshStandardNodeMaterial({ color: '#111b28', roughness: .68, metalness: .35 });
  const brass = new MeshStandardNodeMaterial({ color: '#bd975b', roughness: .38, metalness: .78 });
  brass.roughnessNode=mx_noise_float(positionWorld.mul(vec3(8,180,180))).mul(.07).add(.38);
  const basePosition = new Vector3(-5.5, -.42, -3.4);
  const foot = new Mesh(new CylinderGeometry(.92, .98, .24, 64), dark);
  foot.name='Weighted lamp base'; foot.position.copy(basePosition).y+=.12;
  const top = new Mesh(new CylinderGeometry(.88, .92, .065, 64), brass);
  top.name='Brushed brass base disc'; top.position.copy(basePosition).y+=.2725;
  const collar = new Mesh(new CylinderGeometry(.115, .16, .28, 32), dark);
  collar.position.copy(basePosition).y+=.425;
  const bezel = new Mesh(new BoxGeometry(.29,.045,.39), dark);
  bezel.position.copy(basePosition).add(new Vector3(.46,.33,.28));
  const lampSwitch = new Mesh(new BoxGeometry(.22,.085,.31), brass);
  lampSwitch.name='Lamp switch'; lampSwitch.position.copy(bezel.position).y+=.045; lampSwitch.rotation.x=-.14;
  for(const mesh of [foot,top,collar,bezel,lampSwitch]) {mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);}
  const curve = new CubicBezierCurve3(new Vector3(-5.5,.08,-3.4), new Vector3(-5.65,6.15,-3.4), new Vector3(-4.2,6.0,-2.9), head);
  const arc = new Mesh(new TubeGeometry(curve, 80, .037, 8, false), dark); arc.castShadow = true; scene.add(arc);
  const housing = new Mesh(new CylinderGeometry(.48,.48,.10,64), dark);
  housing.quaternion.setFromUnitVectors(new Vector3(0,-1,0), sunDirection.value);
  housing.position.copy(head); housing.castShadow=true; scene.add(housing);
  const diffuserMaterial=new MeshBasicNodeMaterial({toneMapped:false});
  diffuserMaterial.colorNode=mix(color('#383d43'),color('#fff0d5').mul(5),lampOn);
  const diffuser = new Mesh(new CylinderGeometry(.445,.445,.025,64), diffuserMaterial);
  diffuser.quaternion.copy(housing.quaternion);
  diffuser.position.copy(head).addScaledVector(sunDirection.value, .06); scene.add(diffuser);
  let enabled=true, ramp=1, from=1;
  return { environment, sun, lampSwitch, toggle() {enabled=!enabled;from=lampOn.value;ramp=0;lampSwitch.rotation.x=enabled?-.14:.14;},
    update(dt:number) {ramp=Math.min(1,ramp+dt/.35);const t=ramp*ramp*(3-2*ramp);lampOn.value=from+((enabled?1:0)-from)*t;sun.intensity=125*lampOn.value;scene.environmentIntensity=.12+.28*lampOn.value;ambient.intensity=.22+.23*lampOn.value;},
    get enabled(){return enabled;}, cone:coneAngle*180/Math.PI, lampPosition: head.toArray(), lampTarget: aim.toArray(), elevation: Math.asin(sunElevation.value)*180/Math.PI };
}
