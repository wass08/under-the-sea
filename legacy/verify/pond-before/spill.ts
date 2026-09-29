import { type Node, AdditiveBlending, Float32BufferAttribute, BoxGeometry, PlaneGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, MeshPhysicalNodeMaterial, PointsNodeMaterial, Scene, Sprite, Vector3, Vector4 } from 'three/webgpu';
import { attribute, atan, bumpMap, mx_noise_float, normalWorld, cameraPosition, positionGeometry, transformNormalToView, cameraViewMatrix, color, float, instancedBufferAttribute, mix, output, positionWorld, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { random, STAGE_Y, simTime, TANK, waterHeight, waterNormal, waterAgitation, waterChoppiness, wetFootprints, breachDrawdowns } from '../state';
import { gerstnerField, WATER_SCALE } from '../lib/waves';
import { waterOptics } from './water-optics';
import type { Opening } from './tank';

/** Split drained tank volume by width × sqrt(head), excluding dry sills in each height interval. */
export function distributeSpillVolume(from: number, to: number, openings: Pick<Opening, 'bottom' | 'width'>[]) {
  const volumes = openings.map(() => 0);
  if (to >= from) return volumes;
  const heights = [...new Set([from, to, ...openings.map(o => o.bottom).filter(h => h > to && h < from)])].sort((a, b) => b - a);
  for (let i = 1; i < heights.length; i++) {
    const middle = (heights[i - 1] + heights[i]) / 2;
    const rates = openings.map(o => Math.max(0, o.width) * Math.sqrt(Math.max(0, middle - o.bottom)));
    const total = rates.reduce((sum, rate) => sum + rate, 0);
    if (total === 0) continue;
    const volume = (heights[i - 1] - heights[i]) * TANK.width * TANK.depth;
    rates.forEach((rate, j) => { volumes[j] += volume * rate / total; });
  }
  return volumes;
}

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
  const puddleMaterial = new MeshPhysicalNodeMaterial({ color: '#02090d', transmission: 0, thickness: .025, ior: 1.33, metalness: 0, roughness: .12, specularIntensity: .5, clearcoat: .3, clearcoatRoughness: .15, transparent: true, depthWrite: false });
  // Bound the complete reflection, including the meniscus, below the 1.3 bloom threshold.
  puddleMaterial.fog = false; puddleMaterial.envMapIntensity = .32;
  puddleMaterial.outputNode = vec4(output.rgb.div(output.rgb.div(.85).add(1)), output.a);
  const puddleUV = uv().sub(.5), angle = atan(puddleUV.y, puddleUV.x);
  const outline = angle.mul(3).sin().mul(.055).add(angle.mul(5).add(.8).sin().mul(.035)).add(angle.mul(9).sin().mul(.018)).add(1);
  const radiusUV = puddleUV.length().div(outline);
  const rim = radiusUV.sub(.463).div(.008).pow(2).negate().exp();
  const puddleEmission = color('#0b2631').mul(.6).add(color('#a7d8e4').mul(rim).mul(.38));
  puddleMaterial.emissiveNode = puddleEmission;
  puddleMaterial.opacityNode = smoothstep(.482, .463, radiusUV).mul(.82);
  type Emitter = { opening: Opening; sheet: Mesh<BoxGeometry, MeshPhysicalNodeMaterial>; puddle: Mesh; volume: number; carry: number; splashCarry: number; stopped: number; strength: number; wet: boolean; rippleAt: number; started: number; front: { value: number }; flow: { value: number }; impact: { value: Vector3 }; arcLength: number; landingSpeed: number; scrollRate: number; measuredDrops: { drop: number; streak: number; error: number }[] };
  const emitters = new Map<number, Emitter>();
  let lastHeight = waterHeight.value;
  const at = new Vector3(), tangent = new Vector3();
  function add(opening: Opening) {
    const old = emitters.get(opening.wall);
    if (old) { old.opening = opening; old.started = simTime.value; old.stopped = -1; old.wet = waterHeight.value > opening.bottom; return; }
    const front = uniform(0), flow = uniform(0), impact = uniform(new Vector3());
    const geometry=new BoxGeometry(1,.04,1,16,1,32);
    const base=Float32Array.from(geometry.getAttribute('position').array);
    geometry.userData.base=base;
    geometry.setAttribute('flowTime', new Float32BufferAttribute(new Float32Array(base.length / 3), 1));
    geometry.userData.tip = Array.from({ length: base.length / 3 }, (_, i) => i).filter(i => Math.abs(base[i*3]) < 1e-5 && geometry.getAttribute('normal').getY(i) > .9).sort((a,b) => base[b*3+2] - base[a*3+2]).slice(0,2);
    const uvs=geometry.getAttribute('uv');
    for(let i=0;i<uvs.count;i++)uvs.setXY(i,base[i*3]+.5,base[i*3+2]+.5);
    const sheet=new Mesh(geometry,sheetMaterial.clone());
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
    sheet.material.opacityNode=fresnel.mul(.42).add(body).min(.78).mul(edge).mul(reach).mul(tip).mul(flow.min(1));
    sheet.material.emissiveNode=mix(optics.refracted.mul(float(1).sub(optics.fresnel)).add(color('#8ed8ef').mul(flow).mul(.40)),color('#d9f3fa'),froth);
    sheet.material.thicknessNode=thickness;
    const lipWave = gerstnerField(positionGeometry.xz, simTime, waterAgitation.mul(WATER_SCALE.agitationGain).add(1).mul(waterHeight.sub(TANK.floor).div(.18).clamp()), waterChoppiness);
    sheet.material.positionNode = positionGeometry.add(vec3(0, lipWave.offset.y.mul(smoothstep(.20,0,uv().y)), 0));
    sheet.frustumCulled=false;sheet.renderOrder=4;scene.add(sheet);
    const puddleGeometry=new PlaneGeometry(2,2,48,48);puddleGeometry.rotateX(-Math.PI/2);
    const puddle=new Mesh(puddleGeometry,puddleMaterial.clone());
    puddle.position.y=STAGE_Y+.026+opening.wall*.008;puddle.scale.setScalar(.001);
    puddle.renderOrder=10+opening.wall;
    puddle.material.polygonOffset=true;puddle.material.polygonOffsetFactor=-1;puddle.material.polygonOffsetUnits=-1;
    const head = Math.max(0, waterHeight.value - opening.bottom);
    const landingDistance = Math.sqrt(2 * 9.81 * head) * 0.55 * Math.sqrt(Math.max(0.01, Math.min(opening.point.y, waterHeight.value) - STAGE_Y) * 2 / 9.81) + 0.38;
    puddle.position.x = opening.point.x + opening.normal.x * landingDistance;
    puddle.position.z = opening.point.z + opening.normal.z * landingDistance;
    const distance = positionWorld.xz.sub(impact.xz).length();
    const phase = distance.mul(29).sub(simTime.mul(12));
    const ringEnvelope = distance.mul(-1.8).exp().mul(smoothstep(.04,.16,distance)).mul(flow.min(1)).mul(smoothstep(.94,1,front));
    const rings = phase.sin().max(0).pow(8).mul(ringEnvelope);
    const puddleWave=gerstnerField(positionGeometry.xz.mul(2),simTime.mul(.6),float(.08),float(.15));
    // Keep geometry above the floor; millimetric ripples change normals, never depth ordering.
    const ringSlope=phase.cos().mul(ringEnvelope).mul(.055);
    const radial=positionWorld.xz.sub(impact.xz).div(distance.max(.0001));
    puddle.material.normalNode=transformNormalToView(vec3(puddleWave.normal.x.sub(radial.x.mul(ringSlope)),1,puddleWave.normal.z.sub(radial.y.mul(ringSlope))).normalize());
    const crown=distance.sub(.16).div(.075).pow(2).negate().exp().mul(ringEnvelope);
    puddle.material.emissiveNode=puddleEmission.add(color('#86bed7').mul(rings).mul(.16)).add(color('#bce3ee').mul(crown).mul(.12));
    scene.add(puddle);
    emitters.set(opening.wall, { opening, sheet, puddle, volume: 0, carry: 0, splashCarry: 0, stopped: -1, strength: 0, wet: waterHeight.value > opening.bottom, rippleAt: simTime.value, started: simTime.value, front, flow, impact, arcLength: 0, landingSpeed: 0, scrollRate: 0, measuredDrops: [] });
  }
  function spawn(p: Vector3, v: Vector3, splash = false, emitter?: Emitter) {
    drops[cursor++ % count] = { p: p.clone(), v: v.clone(), source: p.clone(), initialVelocity: v.clone(), born: simTime.value, life: splash ? .32 + rng() * .23 : 2.5, emitter, sheetSpeed: emitter?.landingSpeed, size: splash ? 2 + rng() * 2.8 : rng() < 0.08 ? 5 + rng() * 2 : 2 + rng() * 2, splash };
  }
  function update(dt: number) {
    const active = [...emitters.values()], volumes = distributeSpillVolume(lastHeight, waterHeight.value, active.map(e => e.opening));
    active.forEach((e, i) => { e.volume += volumes[i]; }); lastHeight = waterHeight.value;
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
      const depth = head > .003 ? Math.min(head * .72, Math.sqrt(head) * .52) : 0;
      const lip = o.point.clone().addScaledVector(o.normal, -.052);
      breachDrawdowns[o.wall].value.set(lip.x, lip.z, o.width, depth);
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
      for (let i = 0; i < p.count; i++) {
        const base=e.sheet.geometry.userData.base as Float32Array;
        const row=base[i*3+2]+.5, t=row*flight, side=base[i*3]*2, slab=base[i*3+1]/.04;
        const strand=1+.045*Math.cos(side*7+row*2-simTime.value*1.3);
        const wobble=Math.sin(row*8-side*4-simTime.value*4)*.0065*row;
        const point=at.clone().addScaledVector(o.normal,speed*t).addScaledVector(tangent,side*width*.5*(1-row*.25)*strand+wobble);
        const cross = side * width * .5;
        const lipDepth = depth * Math.pow(Math.max(0, 1 - (cross / (o.width * .8)) ** 2), 3);
        point.y=sourceY+(depth-lipDepth)*(1-row)**2-4.905*t*t+slab*Math.min(.025,head*.06)*(1-row*.65)+Math.sin(row*19+side*6-simTime.value*9)*.0025*row;
        times.setX(i, t); uvs.setY(i, arcLengthAt(t) / e.arcLength);
        p.setXYZ(i,point.x,Math.max(STAGE_Y+.026,point.y),point.z);
      }
      e.front.value = arcLengthAt(Math.min(flight*1.025, Math.max(0, simTime.value - e.started))) / e.arcLength; e.flow.value = Math.min(1, e.strength * 4);
      times.needsUpdate = uvs.needsUpdate = true;
      p.needsUpdate = true; e.sheet.geometry.computeVertexNormals(); e.sheet.visible = head > 0.003;
      // The advected noise phase is flowTime - simTime. Measure its actual world
      // speed from the final mesh segment, including slab deformation, not a UV constant.
      const [tipA, tipB] = e.sheet.geometry.userData.tip as number[];
      e.landingSpeed = Math.hypot(p.getX(tipA)-p.getX(tipB), p.getY(tipA)-p.getY(tipB), p.getZ(tipA)-p.getZ(tipB)) / Math.max(1e-6, Math.abs(times.getX(tipA)-times.getX(tipB)));
      e.scrollRate = e.landingSpeed / e.arcLength;
      for (let n = Math.min(150, Math.floor(e.carry)); n > 0; n--) {
        e.carry--;
        const p = at.clone().addScaledVector(tangent, (rng() < .5 ? -1 : 1) * width * (.46 + rng() * .04));
        const v = o.normal.clone().multiplyScalar(speed); v.y = 0;
        spawn(p, v, false, e);
        if (rng() < 0.08) spawn(p, v.clone().multiplyScalar(0.65).addScaledVector(tangent, (rng() - 0.5) * 1.1).add(new Vector3(0, 0.6, 0)), true);
      }

      const landing = at.clone().addScaledVector(o.normal, speed * flight).setY(STAGE_Y + .055); e.impact.value.copy(landing);
      const landed = e.front.value >= .99 && head > .003;
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
      if (!e.puddle.visible || e.volume < .02) e.puddle.position.set(landing.x, e.puddle.position.y, landing.z);
      else if (landed) { e.puddle.position.x += (landing.x - e.puddle.position.x) * dt * .15; e.puddle.position.z += (landing.z - e.puddle.position.z) * dt * .15; }
      const radius = Math.sqrt(e.volume) * .65;
      e.puddle.scale.set(radius * 1.2, 1, radius * .85); e.puddle.visible = e.volume > .001 && e.front.value >= .99;
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
      positions.set(d.p.toArray(), i * 3); velocities.set(d.v.toArray(), i * 3); sizes[i] = d.size * Math.min(1, (d.life - age) * 5); alphas[i] = Math.min(1, (d.life - age) / (d.splash ? .18 : .12));
    }
    positionAttribute.needsUpdate = sizeAttribute.needsUpdate = alphaAttribute.needsUpdate = velocityAttribute.needsUpdate = true;
  }
  function capture() {
    return [...emitters].map(([wall, e]) => ({ wall, drawdown: breachDrawdowns[wall].value.toArray(), position: e.puddle.position.toArray(), scale: e.puddle.scale.toArray(), visible: e.puddle.visible, strength: e.strength, sheetVisible: e.sheet.visible, front: e.front.value, impact: e.impact.value.toArray(), flowTime: Float32Array.from(e.sheet.geometry.getAttribute('flowTime').array), sheetUV: Float32Array.from(e.sheet.geometry.getAttribute('uv').array), sheet: Float32Array.from(e.sheet.geometry.getAttribute('position').array) }));
  }
  type Snapshot = ReturnType<typeof capture>;
  return { add, update, capture,
    get flowDiagnostics() { return [...emitters.values()].map(e => ({ wall: e.opening.wall, arcLength: e.arcLength, sheetLandingSpeed: e.landingSpeed, uvScrollRateAtLanding: e.scrollRate, measuredLandings: e.measuredDrops.length, meanDropletLandingSpeed: e.measuredDrops.reduce((s,d)=>s+d.drop,0)/Math.max(1,e.measuredDrops.length), meanStreakSpeedForThoseDrops: e.measuredDrops.reduce((s,d)=>s+d.streak,0)/Math.max(1,e.measuredDrops.length), meanRelativeError: e.measuredDrops.reduce((s,d)=>s+d.error,0)/Math.max(1,e.measuredDrops.length) })); },
    get puddles() { return [...emitters.values()].filter(e=>e.puddle.visible).map(e=>({position:e.puddle.position.toArray(),radius:[e.puddle.scale.x,e.puddle.scale.z],depthWrite:(e.puddle.material as MeshPhysicalNodeMaterial).depthWrite,order:e.puddle.renderOrder})); },
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
      lastHeight = waterHeight.value;
    },
    get strength() { return [...emitters.values()].reduce((s, e) => s + e.strength, 0); }, get active() { return [...emitters.values()].some(e => e.strength > 0); }, reset() {
    for (const e of emitters.values()) { scene.remove(e.sheet, e.puddle); e.sheet.geometry.dispose(); e.sheet.material.dispose(); e.puddle.geometry.dispose(); (e.puddle.material as MeshPhysicalNodeMaterial).dispose(); }
    wetFootprints.forEach(v=>v.value.set(0,0,0,0)); breachDrawdowns.forEach(v=>v.value.set(0,0,0,0));
    emitters.clear(); lastHeight = waterHeight.value; drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true;
  } };
}
