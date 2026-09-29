import { createPondProbe } from '../../verify/pond-metrics';
import { createGroupingProbe } from '../../verify/grouping-metrics';
import { createLaunchProbe } from '../../verify/launch-metrics';
import { perf } from '../../verify/four-wall-metrics';
import { type Camera, AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Uint32BufferAttribute, LineBasicNodeMaterial, LineSegments, Mesh, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, Quaternion, Scene, Vector3 } from 'three/webgpu';
import { attribute, cameraPosition, color, float, normalWorld, output, positionWorld, smoothstep, vec4 } from 'three/tsl';
import { underwaterColor } from './lighting';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShardGeometry, generateAquariumPattern, AQUARIUM_WALL_FRACTIONS, AQUARIUM_CELL_COUNT, IMPACT_CORE_RADIUS, type ShatterCell } from '../lib/shatter';
import { polygonCentroid } from '../lib/triangulate';
import { createShardWorld, releaseShards, launchDiagnostics, type ReleasedShard } from '../lib/release';
import { random, rewindProgress, STAGE_Y, TANK, state } from '../state';

export type Opening = { wall: number; point: Vector3; normal: Vector3; bottom: number; width: number; full: boolean };
/** Physical glass, with the same material on intact faces and exposed shard edges. */
// The visible core reaches roughly 9 m/s; outer plates also gain travel and tumble.
const SHATTER_STRENGTH = 1.35;
const GLASS_SEED = 93;
export async function createTank(scene: Scene, camera?: Camera) {
  const physics = await createShardWorld(), height = TANK.top - TANK.floor; physics.separateLaunch = true; const groupingProbe = createGroupingProbe(Boolean(camera));
  if (camera) groupingProbe?.view(physics, scene, camera);
  const independent = physics.profile === 'launch' && new URLSearchParams(location.search).get('grouping') !== 'previous', shardBodyLimit = independent ? 880 : 400;
  physics.individualCells = independent;
  const fullBudget = new URLSearchParams(location.search).get('wallBudget') === 'full';
  const wallBudgets: { wall: number; ordinal: number; cells: number; fraction: number; requestedFraction: number; coreCells: number }[] = [];
  let maxCellsPerBody = 0;
  const glass = new MeshPhysicalNodeMaterial({ color: '#f6fffc', transmission: 1, thickness: 0.05, ior: 1.52, roughness: 0.04, attenuationColor: new Color('#cfe8e4'), attenuationDistance: 1.5, dispersion: 0.015, clearcoat: 0, side: DoubleSide, transparent: true, opacity: 0.28, depthWrite: false });
  const grazing = float(1).sub(normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs()).clamp().pow(5);
  glass.fog = false; // The opaque interior already contains distance fog.
  glass.opacityNode = grazing.mul(0.24).add(0.16);
  glass.colorNode = underwaterColor(color('#f6fffc').rgb);
  glass.emissiveNode = color('#9ebbbd').mul(grazing).mul(0.045);
  const widths = [TANK.width, TANK.width, TANK.depth, TANK.depth];
  const origins = [new Vector3(0, (TANK.top + TANK.floor) / 2, TANK.depth / 2), new Vector3(0, (TANK.top + TANK.floor) / 2, -TANK.depth / 2), new Vector3(TANK.width / 2, (TANK.top + TANK.floor) / 2, 0), new Vector3(-TANK.width / 2, (TANK.top + TANK.floor) / 2, 0)];
  const rotations = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map(a => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a));
  const panels: Mesh<BufferGeometry, MeshPhysicalNodeMaterial>[] = widths.map((width, wall) => {
    const panel = new Mesh(new BoxGeometry(width, height, 0.05), glass);
    panel.position.copy(origins[wall]); panel.quaternion.copy(rotations[wall]); panel.userData.wall = wall; scene.add(panel); return panel;
  });
  const staticPane = (wall: number) => physics.addStaticBox(origins[wall], wall < 2 ? { x: widths[wall], y: height, z: 0.05 } : { x: 0.05, y: height, z: widths[wall] });
  const colliders = widths.map((_, wall) => [staticPane(wall)]);
  physics.addStaticBox({ x: 0, y: STAGE_Y - 0.12, z: 0 }, { x: 40, y: 0.24, z: 40 });
  physics.addStaticBox({ x: 0, y: STAGE_Y / 2, z: 0 }, { x: TANK.width + .4, y: -STAGE_Y, z: TANK.depth + .4 });
  physics.addStaticBox({ x: 0, y: 0.08, z: 0 }, { x: TANK.width + .18, y: TANK.floor, z: TANK.depth + .18 });
  const plinth = new Mesh(new BoxGeometry(TANK.width + .18, TANK.floor, TANK.depth + .18), new MeshStandardNodeMaterial({ color: '#273536', metalness: 0.12, roughness: 0.68 }));
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
  const lineMaterial = new LineBasicNodeMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, opacity: .72, depthWrite: false });
  const radius = float(1.4).mul(float(1).sub(smoothstep(.78, 1, rewindProgress)));
  lineMaterial.opacityNode = smoothstep(radius.add(.06), radius, attribute('crackDistance', 'float')).mul(.72);
  const crackLines = origins.map((origin, wall) => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0,0,0, .01,0,0],3)).setAttribute('color', new Float32BufferAttribute([0,0,0, 0,0,0],3)).setAttribute('crackDistance', new Float32BufferAttribute([0,0],1));
    const lines = new LineSegments(geometry, lineMaterial);
    // The surface replaces color with opaque-scene refraction at order 3. Composite
    // cracks afterward, still testing the opaque depth so foreground rocks hide them.
    lines.renderOrder = 4; lines.position.copy(origin); lines.quaternion.copy(rotations[wall]); lines.frustumCulled = false; lines.visible = false; scene.add(lines); return lines;
  });
  const shards: (ReleasedShard & { wall: number; full: boolean; homePosition: Vector3; homeRotation: Quaternion; radial: Vector3 })[] = [];
  // Render independent loose cells in one draw; each cell keeps its own rigid body.
  const looseGlass = glass.clone(); looseGlass.opacity = 0.55; looseGlass.opacityNode = grazing.mul(0.30).add(0.55); looseGlass.colorNode = null; looseGlass.depthWrite = false;
  // Broaden shard glints and bound their HDR output below the bloom threshold.
  looseGlass.roughness = 0.18; looseGlass.side = FrontSide;
  // Smoothly compress glints, rather than clipping a whole sun lobe to white.
  // The same batch/material is used for physics and rewind playback.
  looseGlass.emissiveNode = color('#cbefff').mul(attribute('shardEdge', 'float').mul(.35).add(grazing.max(0).sqrt().mul(.15)).add(attribute('impactGlow', 'float').mul(.65)));
  looseGlass.outputNode = vec4(output.rgb.div(output.rgb.div(0.55).add(1)), output.a);
  // Released glass is outside the pane; composite after the pouring slab (order 4).
  // Its batch origin otherwise sorts behind the water and hides the dense burst.
  const warmGeometry = new BufferGeometry();
  for (const [name, size] of [['position',3], ['normal',3], ['shardEdge',1], ['impactGlow',1]] as const) warmGeometry.setAttribute(name, new Float32BufferAttribute(new Float32Array(3*size), size));
  warmGeometry.setIndex(new Uint32BufferAttribute([0,1,2],1));
  const loose = new Mesh(warmGeometry, looseGlass); loose.renderOrder = 5; loose.frustumCulled = false; loose.visible = false; scene.add(loose);
  let offsets: number[] = [], triangleOrder: number[] = []; let depths = new Float32Array(), batchPoses = new Float64Array(); const viewDepth = [NaN,NaN,NaN];
  function rebuildBatch() {
    offsets = []; batchPoses = new Float64Array(shards.length * 8).fill(NaN); viewDepth.fill(NaN); let total = 0;
    for (const { mesh } of shards) { offsets.push(total); total += mesh.geometry.getAttribute('position').count; }
    loose.geometry.dispose(); loose.geometry = new BufferGeometry();
    loose.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(total * 3), 3));
    loose.geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(total * 3), 3));
    // The extrusion's thin side faces catch light even when a face lies flat.
    // This static channel survives every transform, including reverse playback.
    const edge = new Float32Array(total), glow = new Float32Array(total);
    shards.forEach(({ mesh }, j) => {
      const normals = mesh.geometry.getAttribute('normal');
      glow.set(mesh.geometry.getAttribute('impactGlow').array, offsets[j]);
      for (let i = 0; i < normals.count; i++) edge[offsets[j] + i] = Math.abs(normals.getZ(i)) < 0.5 ? 1 : 0;
    });
    loose.geometry.setAttribute('shardEdge', new Float32BufferAttribute(edge, 1));
    loose.geometry.setAttribute('impactGlow', new Float32BufferAttribute(glow, 1));
    triangleOrder = Array.from({ length: total / 3 }, (_, i) => i); depths = new Float32Array(total / 3);
    loose.geometry.setIndex(new Uint32BufferAttribute(Uint32Array.from({ length: total }, (_, i) => i), 1));
    loose.visible = total > 0;
  }
  function clearColliders(wall: number) { for (const body of colliders[wall]) physics.removeBody(body); colliders[wall] = []; }
  function release(cells: ShatterCell[], wall: number, impact: Vector3, budget: number, full = false, strength = full ? SHATTER_STRENGTH : 0.55) {
    // One collider/body per existing cell; native sleep removes flight work after landing.
    if (independent) budget = cells.length;
    const minimumArea = independent ? 0 : full ? 0.1 : physics.profile === 'launch' && strength > 1 ? 0 : 0.01;
    const released = releaseShards({ cells, world: physics, material: glass, origin: origins[wall], rotation: rotations[wall], impact,
      // Translation carries the stronger burst. Bound spin independently so long plates
      // topple onto their broad face instead of landing edge-on and rocking late.
      // Preserve every cell across the whole pane, including the annulus outside the core.
      width: widths[wall], height, level: 3, budget, minimumArea, floorY: STAGE_Y, random: random(912 + wall * 17 + (full ? 1 : 0)), strength, maxSpeed: 9, spinStrength: Math.min(strength, .75) });
    maxCellsPerBody = Math.max(maxCellsPerBody,...released.map(s=>s.body.numColliders()));
    groupingProbe?.record(cells, budget, minimumArea, released, wall, full);
    for (const { mesh, body, launch } of released) shards.push({ mesh, body, launch, wall, full, homePosition: mesh.position.clone(), homeRotation: mesh.quaternion.clone(), radial: new Vector3().copy(body.worldCom()).sub(impact).projectOnPlane(new Vector3(0,0,1).applyQuaternion(rotations[wall])).normalize() });
  }

  function crack(impact: Vector3, wall: number, fullLaunch = false) {
    if (cracks.has(wall) || !panels[wall].visible) return;
    const local = panels[wall].worldToLocal(impact.clone());
    // Subpixel click/orbit timing must not change the fracture topology between takes.
    local.x = Math.round(local.x * 100) / 100; local.y = Math.round(local.y * 100) / 100;
    impact = local.clone().applyQuaternion(rotations[wall]).add(origins[wall]);
    const fraction = fullBudget ? 1 : AQUARIUM_WALL_FRACTIONS[Math.min(wallBudgets.length,3)];
    const pattern = generateAquariumPattern({ level: 3, width: widths[wall], height, impact: [Math.max(-widths[wall] / 2, Math.min(widths[wall] / 2, local.x)), Math.max(-height / 2, Math.min(height / 2, local.y))], count: AQUARIUM_CELL_COUNT, seed: GLASS_SEED + wall }, fraction);
    const { cells } = pattern;
    const core = cells.filter(c => { const p = polygonCentroid(c.polygon); return c.impactCore ?? Math.hypot(p[0] - local.x, p[1] - local.y) < IMPACT_CORE_RADIUS; });
    wallBudgets.push({ wall, ordinal: wallBudgets.length+1, cells: cells.length, fraction: pattern.fraction, requestedFraction: fraction, coreCells: core.length });
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
    const lines = crackLines[wall]; lines.geometry.dispose(); lines.geometry = lineGeometry; lines.visible = true;
    cracks.set(wall, { cells: remaining, impact: impact.clone(), opening, lines });
    release(core, wall, impact, Math.max(1, Math.min(independent ? core.length : 70, shardBodyLimit - shards.length)), false, fullLaunch ? SHATTER_STRENGTH : 0.55); rebuildBatch(); return opening;
  }
  const probe = createLaunchProbe(physics, () => shards, Boolean(camera));
  function shatter(impact: Vector3, wall: number) {
    probe?.before();
    // Grounded, already-slow plates dissipate residual rocking; Rapier still owns sleep.
    if (!fullBudget && wallBudgets.length > 1) physics.quietDamping = [32, 120];
    // Removing the cracked pane changes supports: rebuild the native contact
    // islands with its existing fragments awake before adding the outer plates.
    for (const shard of shards) shard.body.wakeUp();
    if (!cracks.size) crack(impact, wall, true);
    const openings: Opening[] = [], budget = Math.floor((shardBodyLimit - shards.length) / cracks.size);
    for (const [id, c] of cracks) {
      clearColliders(id); release(c.cells, id, c.impact, budget, true); c.cells = []; c.lines.visible = false; panels[id].visible = false; rims[id].forEach(r => r.visible = false);
      openings.push({ ...c.opening, bottom: TANK.floor, width: widths[id], full: true, point: origins[id].clone().setY(TANK.floor + .34) });
    }
    rebuildBatch(); probe?.begin(); return openings;
  }
  // Browser fixture can stage four simultaneous strikes without raycast occlusion/orbit delays.
  if (camera && new URLSearchParams(location.search).has('wallBudgetProbe')) Object.assign(window, { wallBudgetProbe: {
    prime(walls: number[]) { for (const id of walls) crack(new Vector3(0, -.17, 0).applyQuaternion(rotations[id]).add(origins[id]), id); return wallBudgets.map(b=>({...b,released:shards.filter(s=>s.wall===b.wall).length})); },
    bodies() { return shards.map(s=>({wall:s.wall,handle:s.body.handle,mass:s.body.mass(),vertices:s.mesh.geometry.getAttribute('position').count})); },
    awake() { return shards.filter(s=>!s.body.isSleeping()).map(s=>({wall:s.wall,p:s.body.translation(),v:s.body.linvel(),w:s.body.angvel(),linear:s.body.linearDamping(),angular:s.body.angularDamping(),extra:s.body.additionalSolverIterations()})); },
  } });
  const v = new Vector3(), qa = new Quaternion(), qb = new Quaternion();
  let rewinding = false;
  const pondProbe = createPondProbe(scene, camera, physics, loose, () => shards);
  function update(dt: number) {
    if (!rewinding) { physics.step(dt); physics.sync(); probe?.sample(); groupingProbe?.update(); }
    pondProbe?.update();
    const start = perf ? performance.now() : 0;
    const position = loose.geometry.getAttribute('position'), normal = loose.geometry.getAttribute('normal');
    let changed = false, uploaded = 0;
    for (let j = 0; j < shards.length; j++) {
      const { mesh } = shards[j], pose = j * 8, q = mesh.quaternion, at = mesh.position;
      if (batchPoses[pose]===at.x && batchPoses[pose+1]===at.y && batchPoses[pose+2]===at.z && batchPoses[pose+3]===q.x && batchPoses[pose+4]===q.y && batchPoses[pose+5]===q.z && batchPoses[pose+6]===q.w && batchPoses[pose+7]===Number(mesh.visible)) continue;
      at.toArray(batchPoses,pose); q.toArray(batchPoses,pose+3); batchPoses[pose+7]=Number(mesh.visible); changed = true;
      const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyQuaternion(mesh.quaternion).add(mesh.position); if (!mesh.visible) v.set(0, -100, 0); position.setXYZ(offsets[j] + i, v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyQuaternion(mesh.quaternion); normal.setXYZ(offsets[j] + i, v.x, v.y, v.z);
      }
    }
    if (position) {
      if (changed) { position.needsUpdate = true; normal.needsUpdate = true; uploaded += position.array.byteLength + normal.array.byteLength; }
      // Transparent triangles need camera-depth ordering even inside a single draw.
      // Front faces only avoid a second, coplanar-looking rear-face transmission layer.
      const m = camera?.matrixWorldInverse.elements;
      if (m && (changed || m[2]!==viewDepth[0] || m[6]!==viewDepth[1] || m[10]!==viewDepth[2])) {
        viewDepth[0]=m[2]; viewDepth[1]=m[6]; viewDepth[2]=m[10];
        for (let t = 0; t < triangleOrder.length; t++) { let depth = 0; for (let j = 0; j < 3; j++) { const i = t * 3 + j; depth += m[2] * position.getX(i) + m[6] * position.getY(i) + m[10] * position.getZ(i); } depths[t] = depth; }
        triangleOrder.sort((a, b) => depths[a] - depths[b] || a - b);
        const index = loose.geometry.index!; triangleOrder.forEach((t, i) => { index.setX(i * 3, t * 3); index.setX(i * 3 + 1, t * 3 + 1); index.setX(i * 3 + 2, t * 3 + 2); }); index.needsUpdate = true; uploaded += index.array.byteLength;
      }
    }
    if (perf) { perf.batch += performance.now() - start; perf.bodies = shards.length; perf.awake = shards.reduce((n,s)=>n+Number(s.body.isDynamic()&&!s.body.isSleeping()),0); perf.uploads = uploaded; }
  }
  function capture() {
    const poses = new Float32Array(shards.length * 7);
    for (let i=0;i<shards.length;i++) { shards[i].mesh.position.toArray(poses,i*7); shards[i].mesh.quaternion.toArray(poses,i*7+3); }
    return { poses, panels: panels.map(p => p.visible), cracks: [...cracks].map(([wall, c]) => ({ wall, visible: c.lines.visible, opacity: c.lines.visible ? (c.lines.material as LineBasicNodeMaterial).opacity : 0 })) };
  }
  type Snapshot = ReturnType<typeof capture>;
  return { panels, shards, crack, shatter, update, capture,
    warmup(visible: boolean) { loose.visible = visible; crackLines.forEach(lines => lines.visible = visible); },
    dispose() {
      physics.dispose(); shards.forEach(s=>s.mesh.geometry.dispose());
      const objects=[...panels,...rims.flat(),plinth,loose,...crackLines];
      objects.forEach(o=>{scene.remove(o);o.geometry.dispose();});
      new Set(objects.flatMap(o=>Array.isArray(o.material)?o.material:[o.material])).forEach(material=>material.dispose());
    },
    get diagnostics() { const p = physics.world.integrationParameters; return { profile: physics.profile, shardBodyLimit, targetBodyBudget: fullBudget ? 880 : AQUARIUM_WALL_FRACTIONS.reduce((n,f)=>n+Math.round(AQUARIUM_CELL_COUNT*f),0), wallBudgets: wallBudgets.map(b=>({...b,released:shards.filter(s=>s.wall===b.wall).length,awake:shards.filter(s=>s.wall===b.wall&&!s.body.isSleeping()).length})), releasePhysicsAge:(physics.totalSteps-physics.releaseTick)/60, lastReleaseTime: state.shatterTime, maxCellsPerBody, individualCells: independent, launch: launchDiagnostics(shards), fixedHz: 60, solverIterations: p.numSolverIterations, internalPgs: p.numInternalPgsIterations, lengthUnit: p.lengthUnit, quietDamping: physics.quietDamping, allowedError: p.normalizedAllowedLinearError * p.lengthUnit, prediction: p.normalizedPredictionDistance * p.lengthUnit, erp: p.contact_erp, contactSkinMax: 0.003, inertiaRatioLimit: 4, massRange: shards.length ? [Math.min(...shards.map(s => s.body.mass())), Math.max(...shards.map(s => s.body.mass()))] : null, fixedFallbacks: shards.filter(s => !s.body.isDynamic()).length }; },
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
    rewinding = false; physics.frozen = false; physics.quietDamping = null;
    for (const c of cracks.values()) c.lines.visible = false;
    cracks.clear(); wallBudgets.length = 0;
    for (const s of shards) { physics.removeBody(s.body); s.mesh.geometry.dispose(); } shards.length = 0; maxCellsPerBody = 0; rebuildBatch();
    panels.forEach((panel, wall) => { clearColliders(wall); colliders[wall] = [staticPane(wall)]; panel.geometry.dispose(); panel.geometry = new BoxGeometry(widths[wall], height, 0.05); panel.visible = true; rims[wall].forEach(r => r.visible = true); });
  } };
}
