import { type Node, Mesh, MeshStandardNodeMaterial, MeshBasicNodeMaterial, BoxGeometry, CylinderGeometry, TubeGeometry, CubicBezierCurve3, Color, SpotLight, EquirectangularReflectionMapping, HemisphereLight, PMREMGenerator, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { Fn, dFdx, dFdy, float, texture, color, mix, mx_noise_float, normalWorldGeometry, positionWorld, shadow, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { causticsField, createCausticsUniforms } from '../lib/worley';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { lampOn, simTime, sunDirection, sunElevation, waterHeight, waterNormal, waterAgitation, TANK } from '../state';

const head = new Vector3(-4.12, 4.65, -2.92), aim = new Vector3(.2, .9, .2);
const coneAngle = Math.PI*50/180, penumbra = .62;
const lampLight = new SpotLight('#fff2df', 0, 0, coneAngle, penumbra, 2);
// Keep the tighter illumination cone independent of the full plinth shadow coverage.
lampLight.shadow.focus = 1.08;
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
  scene.environmentIntensity = .12;
  const sun = lampLight;
  sun.castShadow = true; sun.shadow.intensity = 1; sun.shadow.mapSize.set(3072, 3072);
  Object.assign(sun.shadow.camera, { near: .2, far: 35 });
  sun.shadow.radius = 4;
  // Fixed 4×4 tent PCF: soft penumbra without per-pixel stochastic rotation.
  // Hardware bilinear comparison filters each tap; no VSM intermediate targets.
  (sun.shadow as typeof sun.shadow & { filterNode: unknown }).filterNode = Fn(({depthTexture, shadowCoord}: any) => {
    // Follow the receiver plane at each tap instead of detaching the receiver
    // with a large grazing-angle offset. The small residual covers bilinear taps.
    const dx=dFdx(vec3(shadowCoord)),dy=dFdy(vec3(shadowCoord)),det=dx.x.mul(dy.y).sub(dx.y.mul(dy.x));
    const safe=det.lessThan(0).select(det.min(-1e-10),det.max(1e-10));
    const gradient=vec2(dx.z.mul(dy.y).sub(dy.z.mul(dx.y)),dx.x.mul(dy.z).sub(dy.x.mul(dx.z))).div(safe).clamp(-2,2);
    const residual=gradient.abs().dot(vec2(1/3072)).min(.0004);
    const result=float(0).toVar();
    for(let y=0;y<4;y++)for(let x=0;x<4;x++) {
      const weight=[1,3,3,1][x]*[1,3,3,1][y]/64;
      const offset=vec2(x-1.5,y-1.5).mul(2.2/3072);
      result.addAssign(texture(depthTexture,shadowCoord.xy.add(offset)).compare(shadowCoord.z.add(gradient.dot(offset)).sub(residual)).mul(weight));
    }
    return result;
  }); sun.shadow.normalBias = .008; sun.shadow.bias = -.00002;
  // A bounded slope offset handles quantization; PCF footprint uses the plane above.
  sun.shadow.biasNode = float(-.00002).sub(float(1).sub(normalWorldGeometry.dot(lampOrigin.sub(positionWorld).normalize()).abs()).mul(.00003));
  const ambient = new HemisphereLight('#a6c8ff', '#857352', .22);
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
  lampSwitch.name='Lamp switch'; lampSwitch.position.copy(bezel.position).y+=.045; lampSwitch.rotation.x=.14;
  for(const mesh of [foot,top,collar,bezel,lampSwitch]) {mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);}
  const curve = new CubicBezierCurve3(new Vector3(-5.5,.08,-3.4), new Vector3(-5.6,5.6,-3.5), new Vector3(-4.55,5.45,-3.2), head);
  const arc = new Mesh(new TubeGeometry(curve, 80, .037, 8, false), dark); arc.castShadow = true; scene.add(arc);
  const housing = new Mesh(new CylinderGeometry(.48,.48,.10,64), dark);
  housing.quaternion.setFromUnitVectors(new Vector3(0,-1,0), sunDirection.value);
  housing.position.copy(head); housing.castShadow=true; scene.add(housing);
  const diffuserMaterial=new MeshBasicNodeMaterial({toneMapped:false});
  diffuserMaterial.colorNode=mix(color('#383d43'),color('#fff0d5').mul(5),lampOn);
  const diffuser = new Mesh(new CylinderGeometry(.445,.445,.025,64), diffuserMaterial);
  diffuser.quaternion.copy(housing.quaternion);
  diffuser.position.copy(head).addScaledVector(sunDirection.value, .06); scene.add(diffuser);
  let enabled=false, ramp=1, from=0, sequenceTime=-1, sequenceDone=false, clicked=false;
  let onClick:((on:boolean,automatic:boolean)=>void)|undefined;
  function setPower(on:boolean,automatic=false) {enabled=on;from=lampOn.value;ramp=0;lampSwitch.rotation.x=on?-.14:.14;onClick?.(on,automatic);}
  return { environment, sun, lampSwitch,
    warmup(on:boolean) {lampOn.value=on?1:0;sun.intensity=on?145:0;},
    start(onSwitch:(on:boolean,automatic:boolean)=>void) {onClick=onSwitch;sequenceTime=0;},
    toggle() {sequenceDone=true;setPower(!enabled);},
    update(dt:number) {
      if(sequenceTime>=0)sequenceTime+=dt;
      if(sequenceTime>=0&&!sequenceDone) {
        if(sequenceTime>=.18&&!clicked) {clicked=true;setPower(true,true);}
        lampOn.value=lampStartupLevel(sequenceTime);
        if(sequenceTime>=1.2) {sequenceDone=true;ramp=1;}
      } else if(sequenceDone) {ramp=Math.min(1,ramp+dt/.35);const t=ramp*ramp*(3-2*ramp);lampOn.value=from+((enabled?1:0)-from)*t;}
      sun.intensity=145*lampOn.value;scene.environmentIntensity=.12+.28*lampOn.value;ambient.intensity=.22+.23*lampOn.value;
    },
    get sequenceDone(){return sequenceDone;}, get sequenceTime(){return sequenceTime;},
    get enabled(){return enabled;}, cone:coneAngle*180/Math.PI, lampPosition: head.toArray(), lampTarget: aim.toArray(), elevation: Math.asin(sunElevation.value)*180/Math.PI };
}

export function lampStartupLevel(t:number) {
  const keys=[[0,0],[.18,0],[.20,.70],[.25,.06],[.32,.05],[.40,.55],[.46,.04],[.60,.08],[1.20,1]];
  for(let i=1;i<keys.length;i++)if(t<keys[i][0]) {const [a,x]=keys[i-1],[b,y]=keys[i],u=Math.max(0,(t-a)/(b-a));return x+(y-x)*u*u*(3-2*u);}
  return 1;
}
