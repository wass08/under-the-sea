import { type Camera, AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Uint32BufferAttribute, LineBasicNodeMaterial, LineSegments, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, Quaternion, Scene, Vector3 } from 'three/webgpu';
import { attribute, cameraPosition, color, float, normalWorld, output, positionWorld, smoothstep, vec4 } from 'three/tsl';
import { underwaterColor } from './lighting';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShardGeometry, generateShatterPattern, groupAdjacentCells, insetCell, type ShatterCell } from '../lib/shatter';
import { polygonCentroid } from '../lib/triangulate';
import { createPhysicsWorld } from '../lib/physics';
import { random, rewindProgress, STAGE_Y, TANK } from '../state';

export type Opening = { wall: number; point: Vector3; normal: Vector3; bottom: number; width: number; full: boolean };
/** Physical glass, with the same material on intact faces and exposed shard edges. */
export async function createTank(scene: Scene, camera?: Camera) {
  const physics = await createPhysicsWorld(undefined, true), rng = random(912), height = TANK.top - TANK.floor;
  const glass = new MeshPhysicalNodeMaterial({ color: '#f6fffc', transmission: 1, thickness: 0.05, ior: 1.52, roughness: 0.04, attenuationColor: new Color('#cfe8e4'), attenuationDistance: 1.5, dispersion: 0.015, clearcoat: 0, side: DoubleSide, transparent: true, opacity: 0.28, depthWrite: false });
  const grazing = float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).clamp().pow(5);
  glass.fog = false; // The opaque interior already contains distance fog.
  glass.opacityNode = grazing.mul(0.24).add(0.16);
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
  physics.addStaticBox({ x: 0, y: STAGE_Y - 0.12, z: 0 }, { x: 40, y: 0.24, z: 40 });
  physics.addStaticBox({ x: 0, y: STAGE_Y / 2, z: 0 }, { x: 6.4, y: -STAGE_Y, z: 3.9 });
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
  const shards: { mesh: Mesh; body: ReturnType<typeof physics.addShard>; wall: number; full: boolean; homePosition: Vector3; homeRotation: Quaternion }[] = [];
  // Render loose glass in one draw; edge-adjacent cells share mass, never a hull across gaps.
  const looseGlass = glass.clone(); looseGlass.opacity = 0.55; looseGlass.opacityNode = grazing.mul(0.30).add(0.55); looseGlass.colorNode = null; looseGlass.depthWrite = false;
  // Broaden shard glints and bound their HDR output below the bloom threshold.
  looseGlass.roughness = 0.18; looseGlass.side = FrontSide;
  // Smoothly compress glints, rather than clipping a whole sun lobe to white.
  // The same batch/material is used for physics and rewind playback.
  looseGlass.emissiveNode = color('#b9dedb').mul(attribute('shardEdge', 'float').mul(0.12).add(grazing.max(0).sqrt().mul(0.10)));
  looseGlass.outputNode = vec4(output.rgb.div(output.rgb.div(0.55).add(1)), output.a);
  const loose = new Mesh(new BufferGeometry(), looseGlass); loose.frustumCulled = false; loose.visible = false; scene.add(loose);
  let offsets: number[] = [], triangleOrder: number[] = []; let depths = new Float32Array();
  function rebuildBatch() {
    offsets = []; let total = 0;
    for (const { mesh } of shards) { offsets.push(total); total += mesh.geometry.getAttribute('position').count; }
    loose.geometry.dispose(); loose.geometry = new BufferGeometry();
    loose.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(total * 3), 3));
    loose.geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(total * 3), 3));
    // The extrusion's thin side faces catch light even when a face lies flat.
    // This static channel survives every transform, including reverse playback.
    const edge = new Float32Array(total);
    shards.forEach(({ mesh }, j) => {
      const normals = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++) edge[offsets[j] + i] = Math.abs(normals.getZ(i)) < 0.5 ? 1 : 0;
    });
    loose.geometry.setAttribute('shardEdge', new Float32BufferAttribute(edge, 1));
    triangleOrder = Array.from({ length: total / 3 }, (_, i) => i); depths = new Float32Array(total / 3);
    loose.geometry.setIndex(new Uint32BufferAttribute(Uint32Array.from({ length: total }, (_, i) => i), 1));
    loose.visible = total > 0;
  }
  function clearColliders(wall: number) { for (const body of colliders[wall]) physics.removeBody(body); colliders[wall] = []; }
  function release(cells: ShatterCell[], wall: number, impact: Vector3, budget: number, full = false) {
    // Keep the fine fracture pattern, but attach edge-connected slivers into stable plates.
    const groups = groupAdjacentCells(cells, budget, 0.1);
    const areas = groups.map(group => group.reduce((sum, cell) => sum + Math.abs(cell.polygon.reduce((a, p, i) => { const q = cell.polygon[(i + 1) % cell.polygon.length]; return a + p[0] * q[1] - p[1] * q[0]; }, 0)) / 2, 0));
    const minimumMass = Math.max(5, Math.max(...areas) * 0.05 * 2500 / 64);
    for (const [groupIndex, group] of groups.entries()) {
      const center = polygonCentroid(group[0].polygon);
      const parts = group.map(cell => { const { geometry, centroid } = buildShardGeometry(insetCell(cell, 0.001), 0.038); geometry.translate(centroid[0], centroid[1], 0); geometry.scale((widths[wall] - 0.062) / widths[wall], 1, 1); return geometry.translate(-center[0], -center[1], 0); });
      const geometry = mergeGeometries(parts, false)!;
      const mesh = new Mesh(geometry, glass); mesh.position.set(center[0], center[1], 0).applyQuaternion(rotations[wall]).add(origins[wall]); mesh.quaternion.copy(rotations[wall]);
      const collisionParts = group.map(cell => {
        const c = polygonCentroid(cell.polygon);
        const inradius = Math.min(...cell.polygon.map((p, i) => { const q = cell.polygon[(i + 1) % cell.polygon.length]; return Math.abs((q[0] - p[0]) * (p[1] - c[1]) - (p[0] - c[0]) * (q[1] - p[1])) / Math.hypot(q[0] - p[0], q[1] - p[1]); }));
        const inset = Math.min(0.004, inradius * 0.15) + 0.003;
        const { geometry, centroid } = buildShardGeometry(insetCell(cell, inset), 0.040);
        geometry.userData.contactSkin = Math.min(0.003, inradius * 0.08);
        geometry.translate(centroid[0], centroid[1], 0);
        // Leave 0.031 units at pane ends so perpendicular walls never overlap at corners.
        geometry.scale((widths[wall] - 0.062) / widths[wall], 1, 1);
        return geometry.translate(-center[0], -center[1], 0);
      });
      // Glass density (2500 kg/m³); clamp slivers to 5 units and at most 64:1 mass contrast per release.
      const area = areas[groupIndex];
      const mass = Math.max(minimumMass, area * 0.05 * 2500), body = physics.addShard(mesh, collisionParts, mass, true);
      collisionParts.forEach(g => g.dispose());
      parts.forEach(g => g.dispose());
      const centerOfMass = new Vector3().copy(body.worldCom());
      const radial = centerOfMass.clone().sub(impact), falloff = Math.exp(-radial.length() * 1.3);
      const impulse = new Vector3(0, 0, 2 + (centerOfMass.y - TANK.floor) * 0.7).applyQuaternion(rotations[wall]).addScaledVector(radial, 0.5);
      impulse.y = 0.15 + (full ? 0.2 : 0.5) * falloff; impulse.multiplyScalar(mass);
      physics.applyImpulse(body, impulse);
      // Torque proportional to mass ignores plate inertia and spins slivers violently.
      // A broad-face landing dissipates the blast instead of balancing plates on an edge.
      // Solve the damped ballistic flight, then choose a quarter turn over that flight.
      const linearDrag = 0.45, angularDrag = 1.2, vy = impulse.y / mass;
      let lo = 0, hi = 2;
      for (let i = 0; i < 16; i++) { const t = (lo + hi) / 2; const y = centerOfMass.y + (vy + 9.81 / linearDrag) * (1 - Math.exp(-linearDrag * t)) / linearDrag - 9.81 * t / linearDrag; if (y > STAGE_Y + 0.025) lo = t; else hi = t; }
      const spin = Math.PI * 0.5 * angularDrag / (1 - Math.exp(-angularDrag * (lo + hi) / 2));
      body.setAngvel(new Vector3(spin, 0, (rng() - 0.5) * 0.04).applyQuaternion(rotations[wall]), true);
      shards.push({ mesh, body, wall, full, homePosition: mesh.position.clone(), homeRotation: mesh.quaternion.clone() });
    }
  }
  function crack(impact: Vector3, wall: number) {
    if (cracks.has(wall) || !panels[wall].visible) return;
    const local = panels[wall].worldToLocal(impact.clone());
    // Subpixel click/orbit timing must not change the fracture topology between takes.
    local.x = Math.round(local.x * 100) / 100; local.y = Math.round(local.y * 100) / 100;
    impact = local.clone().applyQuaternion(rotations[wall]).add(origins[wall]);
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
    const vertices: number[] = [], colors: number[] = [], distances: number[] = [];
    for (const cell of remaining) for (let i = 0; i < cell.polygon.length; i++) {
      for (const p of [cell.polygon[i], cell.polygon[(i + 1) % cell.polygon.length]]) {
        vertices.push(p[0], p[1], 0.027); distances.push(Math.hypot(p[0] - local.x, p[1] - local.y));
        const fade = Math.max(0, 1 - Math.hypot(p[0] - local.x, p[1] - local.y) / 1.2) ** 1.5;
        colors.push(fade * 1.5, fade * 2.1, fade * 2.2);
      }
    }
    const lineGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3)).setAttribute('color', new Float32BufferAttribute(colors, 3)).setAttribute('crackDistance', new Float32BufferAttribute(distances, 1));
    const lines = new LineSegments(lineGeometry, new LineBasicNodeMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, opacity: 0.72, depthWrite: false }));
    const radius = float(1.4).mul(float(1).sub(smoothstep(0.78, 1, rewindProgress)));
    (lines.material as LineBasicNodeMaterial).opacityNode = smoothstep(radius.add(0.06), radius, attribute('crackDistance', 'float')).mul(0.72);
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
  const v = new Vector3(), qa = new Quaternion(), qb = new Quaternion();
  let rewinding = false;
  function update(dt: number) {
    if (!rewinding) { physics.step(dt); physics.sync(); }
    const position = loose.geometry.getAttribute('position'), normal = loose.geometry.getAttribute('normal');
    for (let j = 0; j < shards.length; j++) {
      const { mesh } = shards[j], p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyQuaternion(mesh.quaternion).add(mesh.position); if (!mesh.visible) v.set(0, -100, 0); position.setXYZ(offsets[j] + i, v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyQuaternion(mesh.quaternion); normal.setXYZ(offsets[j] + i, v.x, v.y, v.z);
      }
    }
    if (position) {
      position.needsUpdate = true; normal.needsUpdate = true;
      // Transparent triangles need camera-depth ordering even inside a single draw.
      // Front faces only avoid a second, coplanar-looking rear-face transmission layer.
      if (camera) {
        const m = camera.matrixWorldInverse.elements;
        for (let t = 0; t < triangleOrder.length; t++) { let depth = 0; for (let j = 0; j < 3; j++) { const i = t * 3 + j; depth += m[2] * position.getX(i) + m[6] * position.getY(i) + m[10] * position.getZ(i); } depths[t] = depth; }
        triangleOrder.sort((a, b) => depths[a] - depths[b] || a - b);
        const index = loose.geometry.index!; triangleOrder.forEach((t, i) => { index.setX(i * 3, t * 3); index.setX(i * 3 + 1, t * 3 + 1); index.setX(i * 3 + 2, t * 3 + 2); }); index.needsUpdate = true;
      }
    }
  }
  function capture() {
    return { poses: Float32Array.from(shards.flatMap(s => [...s.mesh.position.toArray(), ...s.mesh.quaternion.toArray()])), panels: panels.map(p => p.visible), cracks: [...cracks].map(([wall, c]) => ({ wall, visible: c.lines.visible, opacity: c.lines.visible ? (c.lines.material as LineBasicNodeMaterial).opacity : 0 })) };
  }
  type Snapshot = ReturnType<typeof capture>;
  return { panels, shards, crack, shatter, update, capture,
    get diagnostics() { const p = physics.world.integrationParameters; return { fixedHz: 60, solverIterations: p.numSolverIterations, internalPgs: p.numInternalPgsIterations, allowedError: p.normalizedAllowedLinearError, prediction: p.normalizedPredictionDistance, erp: p.contact_erp, contactSkinMax: 0.003, inertiaRatioLimit: 16, massRange: shards.length ? [Math.min(...shards.map(s => s.body.mass())), Math.max(...shards.map(s => s.body.mass()))] : null, fixedFallbacks: shards.filter(s => !s.body.isDynamic()).length }; },
    get bodyCount() { return shards.length; },
    get awakeCount() { return shards.filter(s => s.body.isDynamic() && !s.body.isSleeping()).length; },
    beginRewind() { rewinding = true; physics.frozen = true; },
    restore(a: Snapshot, b: Snapshot, t: number) {
      shards.forEach((s, i) => {
        const j = i * 7, selected = t < 0.5 ? a : b, present = j < selected.poses.length, pane = selected.panels[s.wall];
        // The retained pane geometry has a core hole. Fill it with home fragments
        // before their birth; never layer the full shards over that same pane.
        s.mesh.visible = present ? !(pane && s.full) : pane && !s.full;
        if (!s.mesh.visible) return;
        if (!present) { s.mesh.position.copy(s.homePosition); s.mesh.quaternion.copy(s.homeRotation); return; }
        const ap = j < a.poses.length ? a.poses : b.poses, bp = j < b.poses.length ? b.poses : a.poses;
        s.mesh.position.fromArray(ap, j); v.fromArray(bp, j); s.mesh.position.lerp(v, t);
        qa.fromArray(ap, j + 3); qb.fromArray(bp, j + 3); s.mesh.quaternion.copy(qa).slerp(qb, t);
      });
      panels.forEach((p, i) => { p.visible = (t < 0.5 ? a : b).panels[i]; rims[i].forEach(r => r.visible = p.visible); });
      for (const [id, c] of cracks) {
        const ca = a.cracks.find(c => c.wall === id), cb = b.cracks.find(c => c.wall === id);
        c.lines.visible = Boolean(ca?.visible || cb?.visible);
        (c.lines.material as LineBasicNodeMaterial).opacity = (ca?.opacity ?? 0) * (1 - t) + (cb?.opacity ?? 0) * t;
      }
      update(0);
    },
    get cracks() { return cracks.size; }, get openings() { return [...cracks.values()].map(c => c.opening); }, reset() {
    rewinding = false; physics.frozen = false;
    for (const c of cracks.values()) { scene.remove(c.lines); c.lines.geometry.dispose(); (c.lines.material as LineBasicNodeMaterial).dispose(); }
    cracks.clear();
    for (const s of shards) { physics.removeBody(s.body); s.mesh.geometry.dispose(); } shards.length = 0; rebuildBatch();
    panels.forEach((panel, wall) => { clearColliders(wall); colliders[wall] = [staticPane(wall)]; panel.geometry.dispose(); panel.geometry = new BoxGeometry(widths[wall], height, 0.05); panel.visible = true; rims[wall].forEach(r => r.visible = true); });
  } };
}
