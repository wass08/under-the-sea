import { AdditiveBlending, CircleGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, PointsNodeMaterial, Scene, Sprite, Vector3 } from 'three/webgpu';
import { bumpMap, color, float, instancedBufferAttribute, output, positionWorld, smoothstep, uv, vec4 } from 'three/tsl';
import { random, simTime, TANK, waterHeight } from '../state';
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
  const count = 2600, rng = random(761), positions = new Float32Array(count * 3), sizes = new Float32Array(count);
  const positionAttribute = new InstancedBufferAttribute(positions, 3).setUsage(DynamicDrawUsage), sizeAttribute = new InstancedBufferAttribute(sizes, 1).setUsage(DynamicDrawUsage);
  const material = new PointsNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
  material.positionNode = instancedBufferAttribute(positionAttribute, 'vec3'); material.sizeNode = instancedBufferAttribute(sizeAttribute, 'float');
  material.colorNode = color('#c6eee9').mul(1.7); material.opacityNode = smoothstep(0.5, 0.12, uv().sub(0.5).length()).mul(0.65);
  const sprites = new Sprite(material); sprites.count = count; sprites.frustumCulled = false; scene.add(sprites);
  type Drop = { p: Vector3; v: Vector3; born: number; life: number; size: number; splash: boolean };
  const drops: (Drop | undefined)[] = Array(count); let cursor = 0;
  const sheetMaterial = new MeshPhysicalNodeMaterial({ color: '#bbebe2', transmission: 0.9, ior: 1.33, roughness: 0.04, thickness: 0.035, side: DoubleSide, transparent: true, opacity: 0.44, depthWrite: false });
  const puddleMaterial = new MeshPhysicalNodeMaterial({ color: '#35585d', transmission: 0.35, thickness: 0.025, ior: 1.33, metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.52, depthWrite: false });
  // Keep both water and clearcoat sun reflections below the 1.3 bloom threshold.
  puddleMaterial.outputNode = vec4(output.rgb.min(1.1), output.a);
  // A shallow traveling normal catches the sky without hiding the floor below.
  puddleMaterial.normalNode = bumpMap(positionWorld.x.mul(9).add(positionWorld.z.mul(7)).sub(simTime.mul(1.8)).sin(), float(0.006));
  puddleMaterial.envMapIntensity = 1.8;
  puddleMaterial.opacityNode = smoothstep(0.5, 0.39, uv().sub(0.5).length()).mul(0.32);
  type Emitter = { opening: Opening; sheet: Mesh<PlaneGeometry, MeshPhysicalNodeMaterial>; puddle: Mesh; volume: number; carry: number; stopped: number; strength: number; wet: boolean; rippleAt: number };
  const emitters = new Map<number, Emitter>();
  let lastHeight = waterHeight.value;
  const at = new Vector3(), tangent = new Vector3();
  function add(opening: Opening) {
    const old = emitters.get(opening.wall);
    if (old) { old.opening = opening; old.stopped = -1; old.wet = waterHeight.value > opening.bottom; return; }
    const sheet = new Mesh(new PlaneGeometry(1, 1, 1, 28), sheetMaterial.clone()); sheet.frustumCulled = false; scene.add(sheet);
    const puddle = new Mesh(new CircleGeometry(1, 64), puddleMaterial); puddle.rotation.x = -Math.PI / 2; puddle.position.y = 0.008 + opening.wall * 0.001; puddle.scale.setScalar(0.001);
    const head = Math.max(0, waterHeight.value - opening.bottom);
    const landingDistance = Math.sqrt(2 * 9.81 * head) * 0.55 * Math.sqrt(Math.max(0.01, Math.min(opening.point.y, waterHeight.value)) * 2 / 9.81) + 0.38;
    puddle.position.x = opening.point.x + opening.normal.x * landingDistance;
    puddle.position.z = opening.point.z + opening.normal.z * landingDistance;
    scene.add(puddle);
    emitters.set(opening.wall, { opening, sheet, puddle, volume: 0, carry: 0, stopped: -1, strength: 0, wet: waterHeight.value > opening.bottom, rippleAt: simTime.value });
  }
  function spawn(p: Vector3, v: Vector3, splash = false) {
    drops[cursor++ % count] = { p: p.clone(), v: v.clone(), born: simTime.value, life: splash ? 0.22 + rng() * 0.15 : 2.5, size: splash ? 1.5 + rng() * 2 : 2 + rng() * 3, splash };
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
      const flight = Math.sqrt(Math.max(0.01, sourceY) * 2 / 9.81);
      at.copy(o.point).setY(sourceY).addScaledVector(o.normal, 0.08);
      tangent.set(o.normal.z, 0, -o.normal.x);
      e.carry += dt * (head > 0.001 ? (o.full ? 1700 : 420) * e.strength : drips * 12);
      for (let n = Math.min(150, Math.floor(e.carry)); n > 0; n--) {
        e.carry--;
        const p = at.clone().addScaledVector(tangent, (rng() - 0.5) * o.width * (o.full ? 0.9 : 0.7));
        const v = o.normal.clone().multiplyScalar(speed * (0.8 + rng() * 0.4)); v.y = (rng() - 0.4) * 0.3; v.addScaledVector(tangent, (rng() - 0.5) * 0.22);
        spawn(p, v);
      }
      const p = e.sheet.geometry.getAttribute('position');
      const width = o.width * Math.min(1, Math.sqrt(head) * 2.2);
      for (let i = 0; i < p.count; i++) {
        const row = Math.floor(i / 2) / 28, t = row * flight, side = i % 2 ? 1 : -1;
        const point = at.clone().addScaledVector(o.normal, speed * t).addScaledVector(tangent, side * width * 0.5 * (1 - row * 0.35));
        point.y = sourceY - 4.905 * t * t + Math.sin(row * 30 - simTime.value * 9) * 0.008 * row;
        p.setXYZ(i, point.x, Math.max(0.014, point.y), point.z);
      }
      p.needsUpdate = true; e.sheet.geometry.computeVertexNormals(); e.sheet.visible = head > 0.003;
      const landing = at.clone().addScaledVector(o.normal, speed * flight + 0.3);
      if (e.volume < 0.02) e.puddle.position.set(landing.x, e.puddle.position.y, landing.z);
      else { e.puddle.position.x += (landing.x - e.puddle.position.x) * dt * 0.15; e.puddle.position.z += (landing.z - e.puddle.position.z) * dt * 0.15; }
      const radius = Math.sqrt(e.volume) * 0.43;
      e.puddle.scale.set(radius * 1.3, radius * 0.8, 1); e.puddle.visible = e.volume > 0.001;
    }
    for (let i = 0; i < count; i++) {
      const d = drops[i]; sizes[i] = 0;
      if (!d) continue;
      const age = simTime.value - d.born;
      if (age > d.life) { drops[i] = undefined; continue; }
      d.v.y -= 9.81 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y < 0.018) {
        if (!d.splash) for (let n = 0; n < 2; n++) spawn(d.p.clone().setY(0.022), new Vector3((rng() - 0.5) * 0.8, rng() * 0.8 + 0.15, (rng() - 0.5) * 0.8), true);
        drops[i] = undefined; continue;
      }
      positions.set(d.p.toArray(), i * 3); sizes[i] = d.size * Math.min(1, (d.life - age) * 5);
    }
    positionAttribute.needsUpdate = sizeAttribute.needsUpdate = true;
  }
  function capture() {
    return [...emitters].map(([wall, e]) => ({ wall, position: e.puddle.position.toArray(), scale: e.puddle.scale.toArray(), visible: e.puddle.visible, strength: e.strength, sheetVisible: e.sheet.visible, sheet: Float32Array.from(e.sheet.geometry.getAttribute('position').array) }));
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
        e.sheet.material.opacity = 0.44 * ((ea?.sheetVisible ? 1 : 0) * (1 - t) + (eb?.sheetVisible ? 1 : 0) * t);
      }
      lastHeight = waterHeight.value;
    },
    get strength() { return [...emitters.values()].reduce((s, e) => s + e.strength, 0); }, get active() { return [...emitters.values()].some(e => e.strength > 0); }, reset() {
    for (const e of emitters.values()) { scene.remove(e.sheet, e.puddle); e.sheet.geometry.dispose(); e.sheet.material.dispose(); e.puddle.geometry.dispose(); }
    emitters.clear(); lastHeight = waterHeight.value; drops.fill(undefined); sizes.fill(0); sizeAttribute.needsUpdate = true;
  } };
}
