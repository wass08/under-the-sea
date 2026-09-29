import { timed } from '../../verify/four-wall-metrics';
import { type Node, AdditiveBlending, Float32BufferAttribute, BoxGeometry, PlaneGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, MeshPhysicalNodeMaterial, PointsNodeMaterial, Scene, Sprite, Vector3, Vector4 } from 'three/webgpu';
import { attribute, atan, bumpMap, mx_noise_float, normalWorld, cameraPosition, positionGeometry, transformNormalToView, cameraViewMatrix, color, float, instancedBufferAttribute, mix, output, positionWorld, smoothstep, uniform, uv, screenUV, viewportOpaqueMipTexture, vec2, vec3, vec4 } from 'three/tsl';
import { random, STAGE_Y, simTime, TANK, waterHeight, waterNormal, waterAgitation, waterChoppiness, wetFootprints, breachDrawdowns } from '../state';
import { gerstnerField, WATER_SCALE } from '../lib/waves';
import { waterOptics } from './water-optics';
import type { Opening } from './tank';

const POND_DEPTH = .025, POND_LIMIT = 1.6, POND_ASPECT = .85;
const POND_AREA = Math.PI * POND_ASPECT * (.94**2 + (.04**2 + .02**2)/2);

/** Ballistic water: one spray batch, a deformed slab per opening and a growing puddle. */
export function createSpill(scene: Scene, ripple: (point: Vector3, strength: number) => void) {
  const count = 2600, rng = random(761), positions = new Float32Array(count * 3), sizes = new Float32Array(count), alphas = new Float32Array(count), velocities = new Float32Array(count * 3);
  const positionAttribute = new InstancedBufferAttribute(positions, 3).setUsage(DynamicDrawUsage), sizeAttribute = new InstancedBufferAttribute(sizes, 1).setUsage(DynamicDrawUsage);
  const alphaAttribute = new InstancedBufferAttribute(alphas, 1).setUsage(DynamicDrawUsage);
  const velocityAttribute = new InstancedBufferAttribute(velocities, 3).setUsage(DynamicDrawUsage);
  const material = new PointsNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
  material.positionNode = instancedBufferAttribute(positionAttribute, 'vec3'); material.sizeNode = instancedBufferAttribute(sizeAttribute, 'float');
  const viewVelocity = cameraViewMatrix.mul(vec4(vec3(instancedBufferAttribute(velocityAttribute, 'vec3') as Node<'vec3'>), 0)).xy;
  material.scaleNode = vec2(1, viewVelocity.length().mul(0.18).add(1).min(2.8));
  material.rotationNode = atan(viewVelocity.x.negate(), viewVelocity.y.add(0.00001));
  material.colorNode = color('#b9e4ff').mul(1.35); material.opacityNode = smoothstep(0.5, 0.12, uv().sub(0.5).length()).mul(instancedBufferAttribute(alphaAttribute, 'float')).mul(.48);
  const sprites = new Sprite(material); sprites.count = count; sprites.frustumCulled = false; sprites.renderOrder = 20; scene.add(sprites);
  type Drop = { p: Vector3; v: Vector3; source: Vector3; initialVelocity: Vector3; born: number; life: number; size: number; splash: boolean; emitter?: Emitter; sheetSpeed?: number };
  const drops: (Drop | undefined)[] = Array(count); let cursor = 0;
  const sheetMaterial = new MeshPhysicalNodeMaterial({ color: '#000000', transmission: 0, ior: 1.33, roughness: .14, thickness: .04, side: DoubleSide, transparent: true, depthWrite: false, envMapIntensity:.55 });
  const crossWarp=mx_noise_float(vec3(uv().mul(3),simTime.mul(.3))).mul(.65);
  const streak=mx_noise_float(vec3(uv().x.mul(18).add(crossWarp),attribute('flowTime', 'float').sub(simTime).mul(18),simTime.mul(.35))).mul(.5).add(.5);
  const fine=mx_noise_float(vec3(uv().x.mul(47).add(4),attribute('flowTime', 'float').sub(simTime).mul(37),2.7)).mul(.5).add(.5);
  const fresnel=float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).clamp().pow(5).mul(.96).add(.04);
  sheetMaterial.normalNode=bumpMap(streak.add(fine.mul(.25)),float(.010));
  sheetMaterial.outputNode=vec4(output.rgb.div(output.rgb.div(.9).add(1)),output.a);
  const puddleMaterial = new MeshPhysicalNodeMaterial({ color: '#000000', transmission: 0, thickness: POND_DEPTH, ior: 1.33, metalness: 0, roughness: .22, specularIntensity: .45, clearcoat: .15, clearcoatRoughness: .24, transparent: true, depthWrite: false });
  // Bound the complete reflection, including the meniscus, below the 1.3 bloom threshold.
  puddleMaterial.fog = false; puddleMaterial.envMapIntensity = .28;
  puddleMaterial.outputNode = vec4(output.rgb.div(output.rgb.div(.85).add(1)), output.a);
  const puddleUV = uv().sub(.5), angle = atan(puddleUV.y, puddleUV.x);
  const outline = angle.mul(3).sin().mul(.04).add(angle.mul(5).add(.8).sin().mul(.02)).add(.94).mul(.5);
  const radiusUV = puddleUV.length().div(outline), edgeWidth = radiusUV.fwidth().max(.001);
  const rim = radiusUV.sub(1).div(edgeWidth).pow(2).negate().exp();
  // Sample the opaque floor so its texture survives wet darkening on any stage material.
  const wetFloor = vec4(viewportOpaqueMipTexture(screenUV, float(0)) as Node<'vec4'>).rgb.mul(vec3(.32,.48,.54));
  const puddleEmission = wetFloor.add(color('#88bbc8').mul(rim).mul(.018));
  puddleMaterial.emissiveNode = puddleEmission;
  puddleMaterial.opacityNode = smoothstep(float(1).add(edgeWidth),float(1).sub(edgeWidth),radiusUV).mul(.94);
  // One completed graph per material; object-group uniforms keep each wall's flow independent.
  const front=uniform(0).onObjectUpdate(({object})=>object!.userData.emitter.front.value);
  const flow=uniform(0).onObjectUpdate(({object})=>object!.userData.emitter.flow.value);
  const impact=uniform(new Vector3()).onObjectUpdate(({object})=>object!.userData.emitter.impact.value);
  const fray = streak.sub(.5).mul(.035).mul(uv().y);
  const edge=smoothstep(fray,fray.add(.07),uv().x).mul(smoothstep(float(1).sub(fray),float(.93).sub(fray),uv().x));
  const reach=smoothstep(front.add(.045),front.sub(.045),uv().y);
  const tip=smoothstep(1,.86,uv().y);
  const foam=smoothstep(.66,.88,streak.mul(.7).add(fine.mul(.3)).add(uv().y.mul(.12))).mul(flow.mul(.8).add(.2));
  const thickness = flow.mul(.050).add(.008).mul(float(1).sub(uv().y.mul(.78)));
  const optics = waterOptics(thickness);
  const aerated = uv().y.sub(front).div(.065).pow(2).negate().exp().mul(flow).mul(.30);
  const froth = foam.mul(.12).add(aerated).min(.85);
  const body=streak.mul(.09).add(.44).add(froth.mul(.18));
  sheetMaterial.opacityNode=fresnel.mul(.42).add(body).min(.78).mul(edge).mul(reach).mul(tip).mul(flow.min(1));
  sheetMaterial.emissiveNode=mix(optics.refracted.mul(float(1).sub(optics.fresnel)).add(color('#8ed8ef').mul(flow).mul(.40)),color('#d9f3fa'),froth);
  sheetMaterial.thicknessNode=thickness;
  const lipWave = gerstnerField(positionGeometry.xz, simTime, waterAgitation.mul(WATER_SCALE.agitationGain).add(1).mul(waterHeight.sub(TANK.floor).div(.18).clamp()), waterChoppiness);
  sheetMaterial.positionNode = positionGeometry.add(vec3(0, lipWave.offset.y.mul(smoothstep(.20,0,uv().y)), 0));
  const distance = positionWorld.xz.sub(impact.xz).length();
  const phase = distance.mul(29).sub(simTime.mul(12));
  const ringEnvelope = distance.mul(-1.8).exp().mul(smoothstep(.04,.16,distance)).mul(flow.min(1)).mul(smoothstep(.94,1,front));
  const rings = phase.sin().max(0).pow(8).mul(ringEnvelope);
  const puddleWave=gerstnerField(positionGeometry.xz.mul(2),simTime.mul(.6),float(.08),float(.15));
  // Keep geometry above the floor; millimetric ripples change normals, never depth ordering.
  const slowPhase = distance.mul(17).sub(simTime.mul(.8));
  const slowSlope = slowPhase.cos().mul(distance.mul(-2.5).exp()).mul(.006);
  const ringSlope=phase.cos().mul(ringEnvelope).mul(.055).add(slowSlope);
  const radial=positionWorld.xz.sub(impact.xz).div(distance.max(.0001));
  puddleMaterial.normalNode=transformNormalToView(vec3(puddleWave.normal.x.sub(radial.x.mul(ringSlope)),1,puddleWave.normal.z.sub(radial.y.mul(ringSlope))).normalize());
  const crown=distance.sub(.16).div(.075).pow(2).negate().exp().mul(ringEnvelope);
  const pondEmission=puddleEmission.add(color('#86bed7').mul(rings).mul(.16)).add(color('#bce3ee').mul(crown).mul(.12));
  puddleMaterial.emissiveNode=pondEmission;
  // Compress HDR highlights separately so a sky lobe cannot turn the wet floor grey.
  const gloss=output.rgb.sub(pondEmission).max(0);
  const radiance=pondEmission.add(gloss.div(gloss.div(.035).add(1)));
  puddleMaterial.outputNode=vec4(radiance.div(radiance.div(.85).add(1)),output.a);
  type Emitter = { opening: Opening; sheet: Mesh<BoxGeometry, MeshPhysicalNodeMaterial>; puddle: Mesh; volume: number; carry: number; splashCarry: number; stopped: number; strength: number; wet: boolean; rippleAt: number; started: number; front: { value: number }; flow: { value: number }; impact: { value: Vector3 }; arcLength: number; landingSpeed: number; scrollRate: number; measuredDrops: { drop: number; streak: number; error: number }[] };
  const emitters = new Map<number, Emitter>();
  const pool = new Map<number, Emitter>();
  const at = new Vector3(), tangent = new Vector3(), sheetPoint = new Vector3();
  function add(opening: Opening) {
    const old = emitters.get(opening.wall);
    if (old) { old.opening = opening; old.started = simTime.value; old.stopped = -1; old.wet = waterHeight.value > opening.bottom; return; }
    const retained = pool.get(opening.wall);
    if (retained) {
      pool.delete(opening.wall); emitters.set(opening.wall, retained);
      Object.assign(retained, { opening, volume:0, carry:0, splashCarry:0, stopped:-1, strength:0, wet:waterHeight.value>opening.bottom, rippleAt:simTime.value, started:simTime.value, arcLength:0, landingSpeed:0, scrollRate:0 });
      retained.front.value = retained.flow.value = 0; retained.impact.value.set(0,0,0); retained.measuredDrops.length = 0;
      retained.sheet.visible = retained.puddle.visible = false; return;
    }
    const geometry=new BoxGeometry(1,.04,1,16,1,32);
    const base=Float32Array.from(geometry.getAttribute('position').array);
    geometry.userData.base=base;
    geometry.setAttribute('flowTime', new Float32BufferAttribute(new Float32Array(base.length / 3), 1));
    geometry.userData.tip = Array.from({ length: base.length / 3 }, (_, i) => i).filter(i => Math.abs(base[i*3]) < 1e-5 && geometry.getAttribute('normal').getY(i) > .9).sort((a,b) => base[b*3+2] - base[a*3+2]).slice(0,2);
    const uvs=geometry.getAttribute('uv');
    for(let i=0;i<uvs.count;i++)uvs.setXY(i,base[i*3]+.5,base[i*3+2]+.5);
    const sheet=new Mesh(geometry,sheetMaterial);
    sheet.frustumCulled=false;sheet.renderOrder=4;scene.add(sheet);
    const puddleGeometry=new PlaneGeometry(2,2);puddleGeometry.rotateX(-Math.PI/2);
    const puddle=new Mesh(puddleGeometry,puddleMaterial);
    puddle.position.y=STAGE_Y+.015+opening.wall*.0002;puddle.scale.setScalar(.001);
    // Pond first, then water (3), cracks/sheets (4), and loose glass (5).
    // Depth remains read-only: floor occlusion survives, without covering resting shards.
    puddle.renderOrder=-4+opening.wall*.01;
    Object.assign(puddle.userData,{floorPond:true,wall:opening.wall,pondOrder:puddle.renderOrder});
    puddle.material.polygonOffset=true;puddle.material.polygonOffsetFactor=-4;puddle.material.polygonOffsetUnits=-8;
    const head = Math.max(0, waterHeight.value - opening.bottom);
    const landingDistance = Math.sqrt(2 * 9.81 * head) * 0.55 * Math.sqrt(Math.max(0.01, Math.min(opening.point.y, waterHeight.value) - STAGE_Y) * 2 / 9.81) + 0.38;
    puddle.position.x = opening.point.x + opening.normal.x * landingDistance;
    puddle.position.z = opening.point.z + opening.normal.z * landingDistance;
    scene.add(puddle);
    const emitter: Emitter = { opening, sheet, puddle, volume: 0, carry: 0, splashCarry: 0, stopped: -1, strength: 0, wet: waterHeight.value > opening.bottom, rippleAt: simTime.value, started: simTime.value, front:{value:0}, flow:{value:0}, impact:{value:new Vector3()}, arcLength: 0, landingSpeed: 0, scrollRate: 0, measuredDrops: [] };
    sheet.userData.emitter=puddle.userData.emitter=emitter; emitters.set(opening.wall,emitter);
  }
  // Compile the completed graphs with every wall's own uniform bindings and flowTime/UV geometry
  // during loading. Keep these exact objects and uniforms through every reset.
  for (let wall=0;wall<4;wall++) {
    add({ wall, point:new Vector3(0,TANK.base,0), normal:new Vector3(0,0,1), bottom:TANK.floor, width:1, full:false });
    const e=emitters.get(wall)!; e.sheet.visible=e.puddle.visible=false; e.puddle.frustumCulled=false; pool.set(wall,e);
  }
  emitters.clear();
  function spawn(p: Vector3, v: Vector3, splash = false, emitter?: Emitter) {
    drops[cursor++ % count] = { p: p.clone(), v: v.clone(), source: p.clone(), initialVelocity: v.clone(), born: simTime.value, life: splash ? .32 + rng() * .23 : 2.5, emitter, sheetSpeed: emitter?.landingSpeed, size: splash ? 2 + rng() * 2.8 : rng() < 0.08 ? 5 + rng() * 2 : 2 + rng() * 2, splash };
  }
  // Same compact cubic depression as water.ts, summed over every active breach.
  const depression = (x: number, z: number) => { let sum=0; for (const {value:b} of breachDrawdowns) sum+=b.w*Math.max(0,1-((x-b.x)**2+(z-b.y)**2)/Math.max(.001,b.z*.8)**2)**3; return sum; };
  function update(dt: number) {
    // Publish all depths before sampling any lip; opposite walls can overlap.
    for (const {opening:o} of emitters.values()) {
      const head=Math.max(0,waterHeight.value-o.bottom), lip=o.point.clone().addScaledVector(o.normal,-.052);
      breachDrawdowns[o.wall].value.set(lip.x,lip.z,o.width,head>.003?Math.min(head*.72,Math.sqrt(head)*.52):0);
    }
    for (const e of emitters.values()) {
      const o = e.opening, head = Math.max(0, waterHeight.value - o.bottom);
      if (head > 0.001) e.wet = true;
      if (head < 0.001 && e.stopped < 0) e.stopped = simTime.value;
      const drips = e.wet && e.stopped >= 0 ? Math.max(0, 1 - (simTime.value - e.stopped) / 2) : 0;
      e.strength = head > 0.001 ? Math.sqrt(head) : drips * 0.04;
      if (head > 0.01 && simTime.value > e.rippleAt + 0.8) {
        ripple(o.point, Math.min(0.2, head * 0.15)); e.rippleAt = simTime.value;
      }
      const speed = Math.sqrt(2 * 9.81 * head) * 0.55;
      const lip = o.point.clone().addScaledVector(o.normal, -.052);
      const depth = depression(lip.x,lip.z);
      const sourceY = waterHeight.value - depth - (lip.x * waterNormal.value.x + lip.z * waterNormal.value.z) / waterNormal.value.y;
      const flight = Math.sqrt(Math.max(0.01, sourceY - STAGE_Y - .04) * 2 / 9.81);
      at.copy(lip).setY(sourceY);
      tangent.set(o.normal.z, 0, -o.normal.x);
      const arcLengthAt = (t: number) => {
        const g = 9.81, v = Math.max(.0001, speed);
        return .5 * (t * Math.hypot(v, g*t) + v*v/g * Math.asinh(g*t/v));
      };
      e.arcLength = arcLengthAt(flight); e.landingSpeed = Math.hypot(speed, 9.81 * flight);
      e.scrollRate = e.landingSpeed / e.arcLength;
      const width = o.width * Math.min(1, Math.sqrt(head) * 2.2);
      e.carry += dt * (head > 0.001 ? (o.full ? 1700 : 420) * e.strength : drips * 12);
      const p = e.sheet.geometry.getAttribute('position');
      const times = e.sheet.geometry.getAttribute('flowTime'), uvs = e.sheet.geometry.getAttribute('uv');
      // Once the sheet is dry only the retained puddle and residual drops render.
      e.sheet.visible = head > .003;
      if (e.sheet.visible) for (let i = 0; i < p.count; i++) {
        const base=e.sheet.geometry.userData.base as Float32Array;
        const row=base[i*3+2]+.5, t=row*flight, side=base[i*3]*2, slab=base[i*3+1]/.04;
        const strand=1+.045*Math.cos(side*7+row*2-simTime.value*1.3);
        const wobble=Math.sin(row*8-side*4-simTime.value*4)*.0065*row;
        const point=sheetPoint.copy(at).addScaledVector(o.normal,speed*t).addScaledVector(tangent,side*width*.5*(1-row*.25)*strand+wobble);
        const cross = side*width*.5*(1-row*.25)*strand+wobble;
        const lipDepth = depression(lip.x+tangent.x*cross,lip.z+tangent.z*cross)+(tangent.x*waterNormal.value.x+tangent.z*waterNormal.value.z)*cross/waterNormal.value.y;
        point.y=sourceY+(depth-lipDepth)*(1-row)**2-4.905*t*t+slab*Math.min(.025,head*.06)*(1-row*.65)+Math.sin(row*19+side*6-simTime.value*9)*.0025*row;
        times.setX(i, t); uvs.setY(i, arcLengthAt(t) / e.arcLength);
        p.setXYZ(i,point.x,Math.max(STAGE_Y+.026,point.y),point.z);
      }
      e.front.value = arcLengthAt(Math.min(flight*1.025, Math.max(0, simTime.value - e.started))) / e.arcLength; e.flow.value = Math.min(1, e.strength * 4);
      if (e.sheet.visible) {
      times.needsUpdate = uvs.needsUpdate = true;
      p.needsUpdate = true; e.sheet.geometry.computeVertexNormals();
      // The advected noise phase is flowTime - simTime. Measure its actual world
      // speed from the final mesh segment, including slab deformation, not a UV constant.
      const [tipA, tipB] = e.sheet.geometry.userData.tip as number[];
      e.landingSpeed = Math.hypot(p.getX(tipA)-p.getX(tipB), p.getY(tipA)-p.getY(tipB), p.getZ(tipA)-p.getZ(tipB)) / Math.max(1e-6, Math.abs(times.getX(tipA)-times.getX(tipB)));
      e.scrollRate = e.landingSpeed / e.arcLength;
      }
      for (let n = Math.min(150, Math.floor(e.carry)); n > 0; n--) {
        e.carry--;
        const p = at.clone().addScaledVector(tangent, (rng() < .5 ? -1 : 1) * width * (.46 + rng() * .04));
        const v = o.normal.clone().multiplyScalar(speed); v.y = 0;
        spawn(p, v, false, e);
        if (rng() < 0.08) spawn(p, v.clone().multiplyScalar(0.65).addScaledVector(tangent, (rng() - 0.5) * 1.1).add(new Vector3(0, 0.6, 0)), true);
      }

      const landing = at.clone().addScaledVector(o.normal, speed * flight).setY(STAGE_Y + .055);
      const landed = e.front.value >= .99 && head > .003;
      if (landed) {
        e.impact.value.copy(landing);
        // Integrate the arriving thin sheet, not the much larger tank-level volume.
        // At the scene's 10 cm/unit scale, .025 units is a 2.5 mm deep wet pool.
        e.volume += width * Math.min(.025,head*.06) * speed * dt;
      }
      e.splashCarry += landed ? dt * Math.min(420, o.width * e.strength * e.landingSpeed * 70) : 0;
      if (!landed) e.splashCarry = 0;
      for (let n = Math.min(32, Math.floor(e.splashCarry)); n > 0; n--) {
        e.splashCarry--;
        const angle = rng() * Math.PI * 2, kick = Math.min(1.6, e.landingSpeed * .19);
        const p = landing.clone().addScaledVector(tangent, (rng()-.5)*width*.7);
        p.x += Math.cos(angle)*.12; p.z += Math.sin(angle)*.12;
        spawn(p, new Vector3(Math.cos(angle)*kick*(.45+rng()*.5), kick*(.45+rng()*.65), Math.sin(angle)*kick*(.45+rng()*.5)), true);
        if (rng() < .28) spawn(p, new Vector3(Math.cos(angle)*.3, .25+rng()*.3, Math.sin(angle)*.3), true);
      }
      if (!e.puddle.visible) e.puddle.position.set(landing.x, e.puddle.position.y, landing.z);
      else if (landed) { e.puddle.position.x += (landing.x - e.puddle.position.x) * dt * .15; e.puddle.position.z += (landing.z - e.puddle.position.z) * dt * .15; }
      const radius = Math.min(POND_LIMIT, Math.sqrt(.15**2 + e.volume / (POND_AREA * POND_DEPTH)));
      e.puddle.scale.set(radius, 1, radius * POND_ASPECT); e.puddle.visible = e.volume > 0;
      wetFootprints[o.wall].value.set(e.puddle.position.x,e.puddle.position.z,e.puddle.scale.x,e.puddle.scale.z);
    }
    for (let i = 0; i < count; i++) {
      const d = drops[i]; sizes[i] = alphas[i] = 0;
      if (!d) continue;
      const age = simTime.value - d.born;
      if (age > d.life) { drops[i] = undefined; continue; }
      d.v.copy(d.initialVelocity); d.v.y -= 9.81 * age;
      d.p.copy(d.source).addScaledVector(d.initialVelocity, age); d.p.y -= 4.905 * age * age;
      if (d.p.y < STAGE_Y + .045 && d.v.y < 0) {
        if (d.emitter && d.sheetSpeed && !d.splash) {
          const dropSpeed = d.v.length();
          d.emitter.measuredDrops.push({ drop: dropSpeed, streak: d.sheetSpeed, error: Math.abs(dropSpeed / d.sheetSpeed - 1) });
          if (d.emitter.measuredDrops.length > 256) d.emitter.measuredDrops.shift();
        }
        if (!d.splash && (d.emitter?.flow.value ?? 0) > .01) for (let n = 0; n < (d.size > 5 ? 6 : 2); n++) {
          const angle = rng() * Math.PI * 2;
          spawn(d.p.clone().setY(STAGE_Y + .055), new Vector3(Math.cos(angle) * 0.55, rng() * .8 + .55, Math.sin(angle) * 0.55), true);
        }
        drops[i] = undefined; continue;
      }
      d.p.toArray(positions, i * 3); d.v.toArray(velocities, i * 3); sizes[i] = d.size * Math.min(1, (d.life - age) * 5); alphas[i] = Math.min(1, (d.life - age) / (d.splash ? .18 : .12));
    }
    positionAttribute.needsUpdate = sizeAttribute.needsUpdate = alphaAttribute.needsUpdate = velocityAttribute.needsUpdate = true;
  }
  function capture() {
    return [...emitters].map(([wall, e]) => ({ wall, drawdown: breachDrawdowns[wall].value.toArray(), position: e.puddle.position.toArray(), scale: e.puddle.scale.toArray(), visible: e.puddle.visible, strength: e.strength, sheetVisible: e.sheet.visible, front: e.front.value, impact: e.impact.value.toArray(), flowTime: Float32Array.from(e.sheet.geometry.getAttribute('flowTime').array), sheetUV: Float32Array.from(e.sheet.geometry.getAttribute('uv').array), sheet: Float32Array.from(e.sheet.geometry.getAttribute('position').array) }));
  }
  type Snapshot = ReturnType<typeof capture>;
  return { add, update: timed('spill', update), capture,
    warmup(visible: boolean) { for (const e of pool.values()) e.sheet.visible=e.puddle.visible=visible; },
    get flowDiagnostics() { return [...emitters.values()].map(e => ({ wall: e.opening.wall, arcLength: e.arcLength, sheetLandingSpeed: e.landingSpeed, uvScrollRateAtLanding: e.scrollRate, measuredLandings: e.measuredDrops.length, meanDropletLandingSpeed: e.measuredDrops.reduce((s,d)=>s+d.drop,0)/Math.max(1,e.measuredDrops.length), meanStreakSpeedForThoseDrops: e.measuredDrops.reduce((s,d)=>s+d.streak,0)/Math.max(1,e.measuredDrops.length), meanRelativeError: e.measuredDrops.reduce((s,d)=>s+d.error,0)/Math.max(1,e.measuredDrops.length) })); },
    get puddles() { return [...emitters.values()].filter(e=>e.puddle.visible).map(e=>({position:e.puddle.position.toArray(),radius:[e.puddle.scale.x,e.puddle.scale.z],maxRadius:Math.max(e.puddle.scale.x,e.puddle.scale.z),sheetVolume:e.volume,poolDepth:POND_DEPTH,depthWrite:(e.puddle.material as MeshPhysicalNodeMaterial).depthWrite,order:e.puddle.renderOrder})); },
    clearParticles() { drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true; },
    restore(a: Snapshot, b: Snapshot, t: number) {
      for (const [wall, e] of emitters) {
        const ea = a.find(v => v.wall === wall), eb = b.find(v => v.wall === wall);
        e.puddle.visible = Boolean(ea?.visible || eb?.visible);
        const ap = ea ?? eb, bp = eb ?? ea;
        if (!ap || !bp) { e.sheet.visible = false; breachDrawdowns[wall].value.set(0,0,0,0); continue; }
        breachDrawdowns[wall].value.fromArray(ap.drawdown).lerp(new Vector4().fromArray(bp.drawdown), t);
        breachDrawdowns[wall].value.w = (ea?.drawdown[3] ?? 0) * (1-t) + (eb?.drawdown[3] ?? 0) * t;
        e.puddle.position.fromArray(ap.position).lerp(at.fromArray(bp.position), t);
        for (let i = 0; i < 3; i++) e.puddle.scale.setComponent(i, (ea?.scale[i] ?? 0) * (1 - t) + (eb?.scale[i] ?? 0) * t);
        e.strength = (ea?.strength ?? 0) * (1 - t) + (eb?.strength ?? 0) * t;
        e.sheet.visible = Boolean(ea?.sheetVisible || eb?.sheetVisible);
        const positions = e.sheet.geometry.getAttribute('position');
        for (let i = 0; i < positions.array.length; i++) positions.array[i] = ap.sheet[i] * (1 - t) + bp.sheet[i] * t;
        for (const [name, av, bv] of [['flowTime', ap.flowTime, bp.flowTime], ['uv', ap.sheetUV, bp.sheetUV]] as const) {
          const attribute = e.sheet.geometry.getAttribute(name);
          for (let i = 0; i < attribute.array.length; i++) attribute.array[i] = av[i] * (1-t) + bv[i] * t;
          attribute.needsUpdate = true;
        }
        positions.needsUpdate = true; e.sheet.geometry.computeVertexNormals();
        e.front.value = ap.front * (1 - t) + bp.front * t; e.flow.value = Math.min(1, e.strength * 4);
        e.impact.value.fromArray(ap.impact).lerp(at.fromArray(bp.impact), t);
      }
      for(const [wall,e] of emitters) wetFootprints[wall].value.set(e.puddle.position.x,e.puddle.position.z,e.puddle.visible?e.puddle.scale.x:0,e.puddle.visible?e.puddle.scale.z:0);
    },
    get strength() { return [...emitters.values()].reduce((s, e) => s + e.strength, 0); }, get active() { return [...emitters.values()].some(e => e.strength > 0); }, reset() {
    for (const [wall,e] of emitters) { e.sheet.visible=e.puddle.visible=false; pool.set(wall,e); }
    wetFootprints.forEach(v=>v.value.set(0,0,0,0)); breachDrawdowns.forEach(v=>v.value.set(0,0,0,0));
    emitters.clear(); drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true;
  } };
}
