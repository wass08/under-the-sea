import { AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, LineBasicNodeMaterial, LineSegments, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, Quaternion, Scene, Vector3 } from 'three/webgpu';
import { cameraPosition, color, float, normalWorld, output, positionWorld, vec4 } from 'three/tsl';
import { underwaterColor } from './lighting';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShardGeometry, generateShatterPattern, groupAdjacentCells, type ShatterCell } from '../lib/shatter';
import { polygonCentroid } from '../lib/triangulate';
import { createPhysicsWorld } from '../lib/physics';
import { random, TANK } from '../state';

export type Opening = { wall: number; point: Vector3; normal: Vector3; bottom: number; width: number; full: boolean };
/** Physical glass, with the same material on intact faces and exposed shard edges. */
export async function createTank(scene: Scene) {
  const physics = await createPhysicsWorld(), rng = random(912), height = TANK.top - TANK.floor;
  const glass = new MeshPhysicalNodeMaterial({ color: '#f6fffc', transmission: 1, thickness: 0.05, ior: 1.52, roughness: 0.04, attenuationColor: new Color('#cfe8e4'), attenuationDistance: 1.5, dispersion: 0.015, clearcoat: 0, side: DoubleSide, transparent: true, opacity: 0.28, depthWrite: false });
  const grazing = float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).pow(5);
  glass.opacityNode = grazing.mul(0.30).add(0.28);
  glass.colorNode = underwaterColor(color('#f6fffc').rgb);
  glass.emissiveNode = color('#9ebbbd').mul(grazing).mul(0.045);
  const widths = [TANK.width, TANK.width, TANK.depth, TANK.depth];
  const origins = [new Vector3(0, 1.91, 1.75), new Vector3(0, 1.91, -1.75), new Vector3(3, 1.91, 0), new Vector3(-3, 1.91, 0)];
  const rotations = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map(a => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
  const panels: Mesh<BufferGeometry, MeshPhysicalNodeMaterial>[] = widths.map((width, wall) => {
    const panel = new Mesh(new BoxGeometry(width, height, 0.05), glass);
    panel.position.copy(origins[wall]); panel.quaternion.copy(rotations[wall]); panel.userData.wall = wall; scene.add(panel); return panel;
  });
  const staticPane = (wall: number) => physics.addStaticBox(origins[wall], wall < 2 ? { x: widths[wall], y: height, z: 0.05 } : { x: 0.05, y: height, z: widths[wall] });
  const colliders = widths.map((_, wall) => [staticPane(wall)]);
  physics.addStaticBox({ x: 0, y: -0.12, z: 0 }, { x: 40, y: 0.24, z: 40 });
  physics.addStaticBox({ x: 0, y: 0.08, z: 0 }, { x: 6.18, y: 0.16, z: 3.68 });
  const plinth = new Mesh(new BoxGeometry(6.18, 0.16, 3.68), new MeshStandardNodeMaterial({ color: '#273536', metalness: 0.12, roughness: 0.68 }));
  plinth.position.y = 0.08; plinth.castShadow = true; plinth.receiveShadow = true; scene.add(plinth);
  const rimMaterial = new MeshPhysicalNodeMaterial({ color: '#b5d6d0', metalness: 0.15, roughness: 0.2, transmission: 0.6, thickness: 0.035 });
  rimMaterial.emissiveNode = color('#9ebbbd').mul(0.055);
  const rims: Mesh[][] = widths.map((width, wall) => {
    const rim = new Mesh(new BoxGeometry(width, 0.012, 0.028), rimMaterial);
    rim.position.copy(origins[wall]).setY(TANK.top); rim.quaternion.copy(rotations[wall]); scene.add(rim);
    const edges = [-1, 1].map(side => {
      const edge = new Mesh(new BoxGeometry(0.010, height, 0.025), rimMaterial);
      edge.position.set(side * (width / 2 - 0.012), 0, 0).applyQuaternion(rotations[wall]).add(origins[wall]);
      edge.quaternion.copy(rotations[wall]); scene.add(edge); return edge;
    });
    return [rim, ...edges];
  });
  type Crack = { cells: ShatterCell[]; impact: Vector3; opening: Opening; lines: LineSegments };
  const cracks = new Map<number, Crack>();
  const shards: { mesh: Mesh; body: ReturnType<typeof physics.addShard> }[] = [];
  // Render all loose glass in one draw. Each cell keeps its own convex collider.
  const looseGlass = glass.clone(); looseGlass.opacity = 0.72; looseGlass.opacityNode = null; looseGlass.colorNode = null; looseGlass.depthWrite = true;
  // Broaden shard glints and bound their HDR output below the bloom threshold.
  looseGlass.roughness = 0.12; looseGlass.outputNode = vec4(output.rgb.min(1.1), output.a);
  const loose = new Mesh(new BufferGeometry(), looseGlass); loose.frustumCulled = false; loose.visible = false; scene.add(loose);
  let offsets: number[] = [];
  function rebuildBatch() {
    offsets = []; let total = 0;
    for (const { mesh } of shards) { offsets.push(total); total += mesh.geometry.getAttribute('position').count; }
    loose.geometry.dispose(); loose.geometry = new BufferGeometry();
    loose.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(total * 3), 3));
    loose.geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(total * 3), 3));
    loose.visible = total > 0;
  }
  function clearColliders(wall: number) { for (const body of colliders[wall]) physics.removeBody(body); colliders[wall] = []; }
  function release(cells: ShatterCell[], wall: number, impact: Vector3, budget: number, full = false) {
    for (const group of groupAdjacentCells(cells, budget)) {
      const center = polygonCentroid(group[0].polygon);
      const parts = group.map(cell => { const { geometry, centroid } = buildShardGeometry(cell, 0.05); return geometry.translate(centroid[0] - center[0], centroid[1] - center[1], 0); });
      const geometry = mergeGeometries(parts, false)!;
      const mesh = new Mesh(geometry, glass); mesh.position.set(center[0], center[1], 0).applyQuaternion(rotations[wall]).add(origins[wall]); mesh.quaternion.copy(rotations[wall]);
      const mass = Math.max(0.008, geometry.getAttribute('position').count * 0.0009), body = physics.addShard(mesh, parts, mass);
      parts.forEach(g => g.dispose());
      const radial = mesh.position.clone().sub(impact), falloff = Math.exp(-radial.length() * 1.3);
      const impulse = new Vector3(0, 0, 0.35 + 4.5 * falloff).applyQuaternion(rotations[wall]).addScaledVector(radial.normalize(), 0.6 * falloff);
      impulse.y += 0.25 + (full ? 6.5 : 1.1) * falloff; impulse.multiplyScalar(mass);
      physics.applyImpulse(body, impulse); body.applyTorqueImpulse({ x: (rng() - 0.5) * mass * 0.4, y: (rng() - 0.5) * mass * 0.4, z: (rng() - 0.5) * mass * 0.4 }, true);
      shards.push({ mesh, body });
    }
  }
  function crack(impact: Vector3, wall: number) {
    if (cracks.has(wall) || !panels[wall].visible) return;
    const local = panels[wall].worldToLocal(impact.clone());
    const { cells } = generateShatterPattern({ level: 3, width: widths[wall], height, impact: [Math.max(-widths[wall] / 2, Math.min(widths[wall] / 2, local.x)), Math.max(-height / 2, Math.min(height / 2, local.y))], count: 220, seed: 93 + wall });
    const core = cells.filter(c => { const p = polygonCentroid(c.polygon); return Math.hypot(p[0] - local.x, p[1] - local.y) < 0.28; });
    const remaining = cells.filter(c => !core.includes(c));
    const bottom = Math.min(...core.flatMap(c => c.polygon.map(p => p[1] + origins[wall].y)));
    const xs = core.flatMap(c => c.polygon.map(p => p[0]));
    const opening: Opening = { wall, point: impact.clone(), normal: new Vector3(0, 0, 1).applyQuaternion(rotations[wall]), bottom, width: Math.max(...xs) - Math.min(...xs), full: false };
    clearColliders(wall);
    const parts = remaining.map(cell => {
      const { geometry, centroid } = buildShardGeometry(cell, 0.05); geometry.translate(centroid[0], centroid[1], 0);
      // Static convex cells leave the same physical hole as the visible pane.
      const mesh = new Mesh(geometry); mesh.position.copy(origins[wall]); mesh.quaternion.copy(rotations[wall]);
      const body = physics.addShard(mesh, geometry, 1); body.setBodyType(1, false); colliders[wall].push(body);
      return geometry;
    });
    panels[wall].geometry.dispose(); panels[wall].geometry = mergeGeometries(parts, false)!; parts.forEach(g => g.dispose());
    const vertices: number[] = [], colors: number[] = [];
    for (const cell of remaining) for (let i = 0; i < cell.polygon.length; i++) {
      for (const p of [cell.polygon[i], cell.polygon[(i + 1) % cell.polygon.length]]) {
        vertices.push(p[0], p[1], 0.027);
        const fade = Math.max(0, 1 - Math.hypot(p[0] - local.x, p[1] - local.y) / 1.2) ** 1.5;
        colors.push(fade * 1.5, fade * 2.1, fade * 2.2);
      }
    }
    const lineGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3)).setAttribute('color', new Float32BufferAttribute(colors, 3));
    const lines = new LineSegments(lineGeometry, new LineBasicNodeMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, opacity: 0.72, depthWrite: false }));
    lines.position.copy(origins[wall]); lines.quaternion.copy(rotations[wall]); scene.add(lines);
    cracks.set(wall, { cells: remaining, impact: impact.clone(), opening, lines });
    release(core, wall, impact, Math.max(1, Math.min(70, 400 - shards.length))); rebuildBatch(); return opening;
  }
  function shatter(impact: Vector3, wall: number) {
    if (!cracks.size) crack(impact, wall);
    const openings: Opening[] = [], budget = Math.floor((400 - shards.length) / cracks.size);
    for (const [id, c] of cracks) {
      clearColliders(id); release(c.cells, id, c.impact, budget, true); c.cells = []; c.lines.visible = false; panels[id].visible = false; rims[id].forEach(r => r.visible = false);
      openings.push({ ...c.opening, bottom: TANK.floor, width: widths[id], full: true, point: origins[id].clone().setY(0.5) });
    }
    rebuildBatch(); return openings;
  }
  const v = new Vector3();
  function update(dt: number) {
    physics.step(dt); physics.sync();
    const position = loose.geometry.getAttribute('position'), normal = loose.geometry.getAttribute('normal');
    for (let j = 0; j < shards.length; j++) {
      const { mesh } = shards[j], p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyQuaternion(mesh.quaternion).add(mesh.position); position.setXYZ(offsets[j] + i, v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyQuaternion(mesh.quaternion); normal.setXYZ(offsets[j] + i, v.x, v.y, v.z);
      }
    }
    if (position) { position.needsUpdate = true; normal.needsUpdate = true; }
  }
  return { panels, shards, crack, shatter, update, get cracks() { return cracks.size; }, get openings() { return [...cracks.values()].map(c => c.opening); }, reset() {
    for (const c of cracks.values()) { scene.remove(c.lines); c.lines.geometry.dispose(); (c.lines.material as LineBasicNodeMaterial).dispose(); }
    cracks.clear();
    for (const s of shards) { physics.removeBody(s.body); s.mesh.geometry.dispose(); } shards.length = 0; rebuildBatch();
    panels.forEach((panel, wall) => { clearColliders(wall); colliders[wall] = [staticPane(wall)]; panel.geometry.dispose(); panel.geometry = new BoxGeometry(widths[wall], height, 0.05); panel.visible = true; rims[wall].forEach(r => r.visible = true); });
  } };
}
