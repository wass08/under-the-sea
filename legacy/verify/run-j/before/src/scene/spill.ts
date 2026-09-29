import { type Node, AdditiveBlending, CircleGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, PointsNodeMaterial, Scene, Sprite, Vector3 } from 'three/webgpu';
import { atan, bumpMap, cameraViewMatrix, color, float, instancedBufferAttribute, mix, output, positionWorld, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { random, STAGE_Y, simTime, TANK, waterHeight } from '../state';
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

/** Ballistic water: one sprite batch, a parabola ribbon per opening, and a growing puddle. */
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
  const sheetMaterial = new MeshPhysicalNodeMaterial({ color: '#8dbddd', transmission: 0.62, ior: 1.33, roughness: 0.12, thickness: 0.035, side: DoubleSide, transparent: true, opacity: 0.64, depthWrite: false });
  const striation = uv().x.mul(126).add(uv().y.mul(13).add(simTime.mul(7)).sin().mul(0.8)).sin().mul(0.5).add(0.5).max(0).pow(7);
  const traveling = uv().y.mul(33).add(simTime.mul(12)).sin().mul(0.5).add(0.5);
  const sheetEmission = color('#b6e2ff').mul(striation.mul(traveling.mul(0.5).add(0.5)).mul(0.30).add(0.08));
  sheetMaterial.emissiveNode = sheetEmission;
  sheetMaterial.normalNode = bumpMap(striation, float(0.013));
  sheetMaterial.outputNode = vec4(output.rgb.div(output.rgb.div(0.8).add(1)), output.a);
  const puddleMaterial = new MeshPhysicalNodeMaterial({ color: '#254d65', transmission: 0.18, thickness: 0.025, ior: 1.33, metalness: 0, roughness: 0.30, specularIntensity: 0.18, clearcoat: 0.12, clearcoatRoughness: 0.25, transparent: true, opacity: 0.52, depthWrite: false });
  // Keep both water and clearcoat sun reflections below the 1.3 bloom threshold.
  // Rewind restores transforms only; this bounded material serves both directions.
  puddleMaterial.fog = false;
  puddleMaterial.outputNode = vec4(output.rgb.div(output.rgb.div(vec3(0.10, 0.18, 0.25)).add(1)), output.a);
  // A shallow traveling normal catches the sky without hiding the floor below.
  puddleMaterial.normalNode = bumpMap(positionWorld.x.mul(9).add(positionWorld.z.mul(7)).sub(simTime.mul(1.8)).sin(), float(0.006));
  puddleMaterial.envMapIntensity = 0.85;
  const radiusUV = uv().sub(0.5).length();
  const rim = radiusUV.sub(0.46).div(0.008).abs().pow(2).negate().exp();
  const puddleEmission = color('#8eb4c7').mul(rim.mul(0.12)); puddleMaterial.emissiveNode = puddleEmission;
  puddleMaterial.opacityNode = smoothstep(0.5, 0.43, radiusUV).mul(0.64);
  type Emitter = { opening: Opening; sheet: Mesh<PlaneGeometry, MeshPhysicalNodeMaterial>; puddle: Mesh; volume: number; carry: number; stopped: number; strength: number; wet: boolean; rippleAt: number; started: number; front: { value: number }; flow: { value: number }; impact: { value: Vector3 } };
  const emitters = new Map<number, Emitter>();
  let lastHeight = waterHeight.value;
  const at = new Vector3(), tangent = new Vector3();
  function add(opening: Opening) {
    const old = emitters.get(opening.wall);
    if (old) { old.opening = opening; old.started = simTime.value; old.stopped = -1; old.wet = waterHeight.value > opening.bottom; return; }
    const front = uniform(0), flow = uniform(0), impact = uniform(new Vector3());
    const sheet = new Mesh(new PlaneGeometry(1, 1, 12, 28), sheetMaterial.clone());
    const edge = smoothstep(0, 0.10, uv().x).mul(smoothstep(1, 0.9, uv().x));
    const reach = smoothstep(front.add(0.035), front.sub(0.035), float(1).sub(uv().y));
    sheet.material.opacityNode = edge.mul(reach).mul(flow.min(1)).mul(0.64);
    sheet.material.emissiveNode = sheetEmission.add(color('#caeaff').mul(float(1).sub(uv().y).sub(front).div(0.035).abs().pow(2).negate().exp()).mul(0.15)); sheet.frustumCulled = false; scene.add(sheet);
    const puddle = new Mesh(new CircleGeometry(1, 64), puddleMaterial.clone()); puddle.rotation.x = -Math.PI / 2; puddle.position.y = STAGE_Y + 0.008 + opening.wall * 0.001; puddle.scale.setScalar(0.001);
    const head = Math.max(0, waterHeight.value - opening.bottom);
    const landingDistance = Math.sqrt(2 * 9.81 * head) * 0.55 * Math.sqrt(Math.max(0.01, Math.min(opening.point.y, waterHeight.value) - STAGE_Y) * 2 / 9.81) + 0.38;
    puddle.position.x = opening.point.x + opening.normal.x * landingDistance;
    puddle.position.z = opening.point.z + opening.normal.z * landingDistance;
    const distance = positionWorld.xz.sub(impact.xz).length();
    const age = simTime.mul(1.3).fract();
    const rings = distance.sub(age.mul(0.85)).div(0.03).abs().pow(2).negate().exp().mul(float(1).sub(age)).mul(flow.min(1));
    (puddle.material as MeshPhysicalNodeMaterial).normalNode = bumpMap(distance.mul(20).sub(simTime.mul(3)).sin().mul(0.2).add(rings), float(0.013));
    (puddle.material as MeshPhysicalNodeMaterial).emissiveNode = puddleEmission.add(color('#86bed7').mul(rings).mul(0.075));
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
        const row = Math.floor(i / 13) / 28, t = row * flight, side = (i % 13) / 6 - 1;
        const point = at.clone().addScaledVector(o.normal, speed * t).addScaledVector(tangent, side * width * 0.5 * (1 - row * 0.35));
        point.y = sourceY - 4.905 * t * t + Math.sin(row * 30 - simTime.value * 9) * 0.008 * row;
        p.setXYZ(i, point.x, Math.max(STAGE_Y + 0.014, point.y), point.z);
      }
      e.front.value = Math.min(1.05, (simTime.value - e.started) / flight); e.flow.value = Math.min(1, e.strength * 4);
      p.needsUpdate = true; e.sheet.geometry.computeVertexNormals(); e.sheet.visible = head > 0.003;
      const landing = at.clone().addScaledVector(o.normal, speed * flight + 0.3); e.impact.value.copy(landing);
      if (e.volume < 0.02) e.puddle.position.set(landing.x, e.puddle.position.y, landing.z);
      else { e.puddle.position.x += (landing.x - e.puddle.position.x) * dt * 0.15; e.puddle.position.z += (landing.z - e.puddle.position.z) * dt * 0.15; }
      const radius = Math.sqrt(e.volume) * 0.49;
      e.puddle.scale.set(radius * 1.3, radius * 0.8, 1); e.puddle.visible = e.volume > 0.001;
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
      lastHeight = waterHeight.value;
    },
    get strength() { return [...emitters.values()].reduce((s, e) => s + e.strength, 0); }, get active() { return [...emitters.values()].some(e => e.strength > 0); }, reset() {
    for (const e of emitters.values()) { scene.remove(e.sheet, e.puddle); e.sheet.geometry.dispose(); e.sheet.material.dispose(); e.puddle.geometry.dispose(); (e.puddle.material as MeshPhysicalNodeMaterial).dispose(); }
    emitters.clear(); lastHeight = waterHeight.value; drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true;
  } };
}
