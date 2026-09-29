import { type Node, AdditiveBlending, BoxGeometry, PlaneGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, MeshPhysicalNodeMaterial, PointsNodeMaterial, Scene, Sprite, Vector3 } from 'three/webgpu';
import { atan, bumpMap, mx_noise_float, normalWorld, cameraPosition, positionGeometry, transformNormalToView, cameraViewMatrix, color, float, instancedBufferAttribute, mix, output, positionWorld, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { random, STAGE_Y, simTime, TANK, waterHeight, wetFootprints } from '../state';
import { gerstnerField } from '../lib/waves';
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
  const count = 2600, rng = random(761), positions = new Float32Array(count * 3), sizes = new Float32Array(count), velocities = new Float32Array(count * 3);
  const positionAttribute = new InstancedBufferAttribute(positions, 3).setUsage(DynamicDrawUsage), sizeAttribute = new InstancedBufferAttribute(sizes, 1).setUsage(DynamicDrawUsage);
  const velocityAttribute = new InstancedBufferAttribute(velocities, 3).setUsage(DynamicDrawUsage);
  const material = new PointsNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
  material.positionNode = instancedBufferAttribute(positionAttribute, 'vec3'); material.sizeNode = instancedBufferAttribute(sizeAttribute, 'float');
  const viewVelocity = cameraViewMatrix.mul(vec4(vec3(instancedBufferAttribute(velocityAttribute, 'vec3') as Node<'vec3'>), 0)).xy;
  material.scaleNode = vec2(1, viewVelocity.length().mul(0.18).add(1).min(2.8));
  material.rotationNode = atan(viewVelocity.x.negate(), viewVelocity.y.add(0.00001));
  material.colorNode = color('#b9e4ff').mul(1.35); material.opacityNode = smoothstep(0.5, 0.12, uv().sub(0.5).length()).mul(0.65);
  const sprites = new Sprite(material); sprites.count = count; sprites.frustumCulled = false; scene.add(sprites);
  type Drop = { p: Vector3; v: Vector3; born: number; life: number; size: number; splash: boolean };
  const drops: (Drop | undefined)[] = Array(count); let cursor = 0;
  const sheetMaterial = new MeshPhysicalNodeMaterial({ color: '#000000', transmission: 0, ior: 1.33, roughness: .14, thickness: .04, side: DoubleSide, transparent: true, depthWrite: false, envMapIntensity:.55 });
  const crossWarp=mx_noise_float(vec3(uv().mul(3),simTime.mul(.3))).mul(.65);
  const streak=mx_noise_float(vec3(uv().x.mul(18).add(crossWarp),uv().y.mul(25).sub(simTime.mul(2.6)),simTime.mul(.35))).mul(.5).add(.5);
  const fine=mx_noise_float(vec3(uv().x.mul(47).add(4),uv().y.mul(51).sub(simTime.mul(4)),2.7)).mul(.5).add(.5);
  const fresnel=float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).clamp().pow(5).mul(.96).add(.04);
  sheetMaterial.normalNode=bumpMap(streak.add(fine.mul(.25)),float(.010));
  sheetMaterial.outputNode=vec4(output.rgb.div(output.rgb.div(.9).add(1)),output.a);
  const puddleMaterial = new MeshPhysicalNodeMaterial({ color: '#000000', transmission: 0, thickness: 0.025, ior: 1.33, metalness: 0, roughness: 0.17, specularIntensity: 0.25, clearcoat: 0.12, clearcoatRoughness: 0.25, transparent: true, opacity: 0.52, depthWrite: false });
  // Keep both water and clearcoat sun reflections below the 1.3 bloom threshold.
  // Rewind restores transforms only; this bounded material serves both directions.
  puddleMaterial.fog = false;
  puddleMaterial.outputNode = vec4(output.rgb.div(output.rgb.div(vec3(0.10, 0.18, 0.25)).add(1)), output.a);
  puddleMaterial.envMapIntensity = 0.85;
  const puddleOptics = waterOptics(float(.032));
  const radiusUV = uv().sub(0.5).length();
  const rim = radiusUV.sub(0.43).div(0.016).abs().pow(2).negate().exp();
  const puddleEmission = puddleOptics.refracted.mul(float(1).sub(puddleOptics.fresnel)).mul(.90).add(color('#155268').mul(.045)).add(color('#8eb4c7').mul(rim.mul(0.025))); puddleMaterial.emissiveNode = puddleEmission;
  puddleMaterial.opacityNode = smoothstep(0.5, 0.32, radiusUV).mul(0.42);
  type Emitter = { opening: Opening; sheet: Mesh<BoxGeometry, MeshPhysicalNodeMaterial>; puddle: Mesh; volume: number; carry: number; stopped: number; strength: number; wet: boolean; rippleAt: number; started: number; front: { value: number }; flow: { value: number }; impact: { value: Vector3 } };
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
    const uvs=geometry.getAttribute('uv');
    for(let i=0;i<uvs.count;i++)uvs.setXY(i,base[i*3]+.5,base[i*3+2]+.5);
    const sheet=new Mesh(geometry,sheetMaterial.clone());
    const fray = streak.sub(.5).mul(.035).mul(uv().y);
    const edge=smoothstep(fray,fray.add(.07),uv().x).mul(smoothstep(float(1).sub(fray),float(.93).sub(fray),uv().x));
    const reach=smoothstep(front.add(.045),front.sub(.045),uv().y);
    const tip=smoothstep(1,.86,uv().y);
    const foam=smoothstep(.66,.88,streak.mul(.7).add(fine.mul(.3)).add(uv().y.mul(.12))).mul(flow.mul(.8).add(.2));
    const thickness = flow.mul(.075).add(.006).mul(float(1).sub(uv().y.mul(.78)));
    const optics = waterOptics(thickness);
    const aerated = uv().y.sub(front).div(.065).pow(2).negate().exp().mul(flow).mul(.30);
    const froth = foam.mul(.25).add(aerated).min(.85);
    const body=streak.mul(.17).add(.32).add(froth.mul(.20));
    sheet.material.opacityNode=fresnel.add(body).add(.28).min(.96).mul(edge).mul(reach).mul(tip).mul(flow.min(1));
    sheet.material.emissiveNode=mix(optics.refracted.mul(float(1).sub(optics.fresnel)).add(color('#046579').mul(flow).mul(.20)),color('#d9f3fa'),froth);
    sheet.material.thicknessNode=thickness;
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
    const age = simTime.mul(1.3).fract();
    const rings = distance.sub(age.mul(0.85)).div(0.03).abs().pow(2).negate().exp().mul(float(1).sub(age)).mul(flow.min(1));
    
    const puddleWave=gerstnerField(positionGeometry.xz.mul(2),simTime.mul(.6),float(.12),float(.22));
    (puddle.material as MeshPhysicalNodeMaterial).positionNode=positionGeometry.add(puddleWave.offset.mul(smoothstep(.5,.40,radiusUV)));
    const ringSlope=distance.sub(age.mul(.85)).div(.03).mul(-2/.03).mul(rings).mul(.0008);
    const radial=positionWorld.xz.sub(impact.xz).div(distance.max(.0001));
    (puddle.material as MeshPhysicalNodeMaterial).normalNode=transformNormalToView(vec3(puddleWave.normal.x.div(puddleWave.normal.y.max(.1)).mul(2).sub(radial.x.mul(ringSlope)),1,puddleWave.normal.z.div(puddleWave.normal.y.max(.1)).mul(2).sub(radial.y.mul(ringSlope))).normalize());
    (puddle.material as MeshPhysicalNodeMaterial).emissiveNode=puddleEmission.add(color('#86bed7').mul(rings).mul(.025));
    scene.add(puddle);
    emitters.set(opening.wall, { opening, sheet, puddle, volume: 0, carry: 0, stopped: -1, strength: 0, wet: waterHeight.value > opening.bottom, rippleAt: simTime.value, started: simTime.value, front, flow, impact });
  }
  function spawn(p: Vector3, v: Vector3, splash = false) {
    drops[cursor++ % count] = { p: p.clone(), v: v.clone(), born: simTime.value, life: splash ? 0.22 + rng() * 0.15 : 2.5, size: splash ? 1.5 + rng() * 2 : rng() < 0.08 ? 5 + rng() * 2 : 2 + rng() * 2, splash };
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
      const sourceY = Math.min(o.point.y, Math.max(o.bottom + 0.015, waterHeight.value - 0.03));
      const flight = Math.sqrt(Math.max(0.01, sourceY - STAGE_Y) * 2 / 9.81);
      at.copy(o.point).setY(sourceY).addScaledVector(o.normal, 0.08);
      tangent.set(o.normal.z, 0, -o.normal.x);
      e.carry += dt * (head > 0.001 ? (o.full ? 1700 : 420) * e.strength : drips * 12);
      for (let n = Math.min(150, Math.floor(e.carry)); n > 0; n--) {
        e.carry--;
        const p = at.clone().addScaledVector(tangent, (rng() - 0.5) * o.width * (o.full ? 0.9 : 0.7));
        const v = o.normal.clone().multiplyScalar(speed * (0.8 + rng() * 0.4)); v.y = (rng() - 0.4) * 0.3; v.addScaledVector(tangent, (rng() - 0.5) * 0.22);
        spawn(p, v);
        if (rng() < 0.08) spawn(p, v.clone().multiplyScalar(0.65).addScaledVector(tangent, (rng() - 0.5) * 1.1).add(new Vector3(0, 0.6, 0)), true);
      }
      const p = e.sheet.geometry.getAttribute('position');
      const width = o.width * Math.min(1, Math.sqrt(head) * 2.2);
      for (let i = 0; i < p.count; i++) {
        const base=e.sheet.geometry.userData.base as Float32Array;
        const row=base[i*3+2]+.5, t=row*flight, side=base[i*3]*2, slab=base[i*3+1]/.04;
        const strand=1+.045*Math.cos(side*7+row*2-simTime.value*1.3);
        const wobble=Math.sin(row*8-side*4-simTime.value*4)*.0065*row;
        const point=at.clone().addScaledVector(o.normal,speed*t).addScaledVector(tangent,side*width*.5*(1-row*.25)*strand+wobble);
        point.y=sourceY-4.905*t*t+slab*Math.min(.10,head*.25)*(1-row*.8)+Math.sin(row*19+side*6-simTime.value*9)*.0025*row;
        p.setXYZ(i,point.x,Math.max(STAGE_Y+.04+slab*.012,point.y),point.z);
      }
      e.front.value = Math.min(1.05, (simTime.value - e.started) / flight); e.flow.value = Math.min(1, e.strength * 4);
      p.needsUpdate = true; e.sheet.geometry.computeVertexNormals(); e.sheet.visible = head > 0.003;
      const landing = at.clone().addScaledVector(o.normal, speed * flight + 0.3); e.impact.value.copy(landing);
      if (e.volume < 0.02) e.puddle.position.set(landing.x, e.puddle.position.y, landing.z);
      else { e.puddle.position.x += (landing.x - e.puddle.position.x) * dt * 0.15; e.puddle.position.z += (landing.z - e.puddle.position.z) * dt * 0.15; }
      const radius = Math.sqrt(e.volume) * 0.49;
      e.puddle.scale.set(radius * 1.3, 1, radius * 0.8); e.puddle.visible = e.volume > 0.001;
      wetFootprints[o.wall].value.set(e.puddle.position.x,e.puddle.position.z,e.puddle.scale.x,e.puddle.scale.z);
    }
    for (let i = 0; i < count; i++) {
      const d = drops[i]; sizes[i] = 0;
      if (!d) continue;
      const age = simTime.value - d.born;
      if (age > d.life) { drops[i] = undefined; continue; }
      d.v.y -= 9.81 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y < STAGE_Y + 0.018) {
        if (!d.splash) for (let n = 0; n < (d.size > 5 ? 6 : 2); n++) {
          const angle = n * Math.PI / 3 + rng() * 0.3;
          spawn(d.p.clone().setY(STAGE_Y + 0.022), new Vector3(Math.cos(angle) * 0.55, rng() * 0.7 + 0.25, Math.sin(angle) * 0.55), true);
        }
        drops[i] = undefined; continue;
      }
      positions.set(d.p.toArray(), i * 3); velocities.set(d.v.toArray(), i * 3); sizes[i] = d.size * Math.min(1, (d.life - age) * 5);
    }
    positionAttribute.needsUpdate = sizeAttribute.needsUpdate = velocityAttribute.needsUpdate = true;
  }
  function capture() {
    return [...emitters].map(([wall, e]) => ({ wall, position: e.puddle.position.toArray(), scale: e.puddle.scale.toArray(), visible: e.puddle.visible, strength: e.strength, sheetVisible: e.sheet.visible, front: e.front.value, impact: e.impact.value.toArray(), sheet: Float32Array.from(e.sheet.geometry.getAttribute('position').array) }));
  }
  type Snapshot = ReturnType<typeof capture>;
  return { add, update, capture,
    get puddles() { return [...emitters.values()].filter(e=>e.puddle.visible).map(e=>({position:e.puddle.position.toArray(),radius:[e.puddle.scale.x,e.puddle.scale.z],depthWrite:(e.puddle.material as MeshPhysicalNodeMaterial).depthWrite,order:e.puddle.renderOrder})); },
    clearParticles() { drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true; },
    restore(a: Snapshot, b: Snapshot, t: number) {
      for (const [wall, e] of emitters) {
        const ea = a.find(v => v.wall === wall), eb = b.find(v => v.wall === wall);
        e.puddle.visible = Boolean(ea?.visible || eb?.visible);
        const ap = ea ?? eb, bp = eb ?? ea;
        if (!ap || !bp) { e.sheet.visible = false; continue; }
        e.puddle.position.fromArray(ap.position).lerp(at.fromArray(bp.position), t);
        for (let i = 0; i < 3; i++) e.puddle.scale.setComponent(i, (ea?.scale[i] ?? 0) * (1 - t) + (eb?.scale[i] ?? 0) * t);
        e.strength = (ea?.strength ?? 0) * (1 - t) + (eb?.strength ?? 0) * t;
        e.sheet.visible = Boolean(ea?.sheetVisible || eb?.sheetVisible);
        const positions = e.sheet.geometry.getAttribute('position');
        for (let i = 0; i < positions.array.length; i++) positions.array[i] = ap.sheet[i] * (1 - t) + bp.sheet[i] * t;
        positions.needsUpdate = true; e.sheet.geometry.computeVertexNormals();
        e.front.value = ap.front * (1 - t) + bp.front * t; e.flow.value = Math.min(1, e.strength * 4);
        e.impact.value.fromArray(ap.impact).lerp(at.fromArray(bp.impact), t);
      }
      for(const [wall,e] of emitters) wetFootprints[wall].value.set(e.puddle.position.x,e.puddle.position.z,e.puddle.visible?e.puddle.scale.x:0,e.puddle.visible?e.puddle.scale.z:0);
      lastHeight = waterHeight.value;
    },
    get strength() { return [...emitters.values()].reduce((s, e) => s + e.strength, 0); }, get active() { return [...emitters.values()].some(e => e.strength > 0); }, reset() {
    for (const e of emitters.values()) { scene.remove(e.sheet, e.puddle); e.sheet.geometry.dispose(); e.sheet.material.dispose(); e.puddle.geometry.dispose(); (e.puddle.material as MeshPhysicalNodeMaterial).dispose(); }
    wetFootprints.forEach(v=>v.value.set(0,0,0,0));
    emitters.clear(); lastHeight = waterHeight.value; drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true;
  } };
}
