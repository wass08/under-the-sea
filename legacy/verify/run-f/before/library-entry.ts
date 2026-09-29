import assert from 'node:assert/strict';
import { generateTerrain } from '../src/lib/terrain';
import { generateShatterPattern, buildShardGeometry, groupAdjacentCells } from '../src/lib/shatter';
import { polygonCentroid, lloydRelax, circumcircles, delaunayFrom } from '../src/lib/triangulate';
import { poissonDisk } from '../src/lib/poisson';
import { createPhysicsWorld, physicsDiagnostics } from '../src/lib/physics';
import { Mesh, MeshBasicMaterial } from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { distributeSpillVolume } from '../src/scene/spill';
import { createAudio } from '../src/audio';
const options = { size: 14, count: 1500, seed: 42, amplitude: 4.2 };
const terrain = [1, 2, 3].map(level => generateTerrain({ ...options, level: level as 1 | 2 | 3 }));
assert.deepEqual(terrain[0].seeds, terrain[1].seeds);
assert.deepEqual(terrain[2].seeds, generateTerrain({ ...options, level: 3 }).seeds);
for (const t of terrain) {
  assert.equal(t.geometry.index, null);
  for (const value of t.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
  assert.ok(Math.min(...Array.from(t.geometry.getAttribute('normal').array).filter((_, i) => i % 3 === 1)) >= 0);
}
const masked = generateTerrain({ ...options, level: 3, mask: () => 0 }); assert.ok(masked.heights.every(h => h === 0));
const poisson = poissonDisk({ bounds: [-2, -2, 2, 2], seed: 9, minRadius: 0.12, maxRadius: 0.3, radius: x => 0.12 + (x + 2) / 4 * 0.18 });
for (let i = 0; i < poisson.length; i++) for (let j = i + 1; j < poisson.length; j++) {
  const a = poisson[i], b = poisson[j]; assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) + 1e-9 >= Math.max(0.12 + (a[0] + 2) / 4 * 0.18, 0.12 + (b[0] + 2) / 4 * 0.18));
}
const relaxed = lloydRelax([[0, 0], [1, 0], [0, 1]], [-2, -2, 2, 2], 3, (_, i) => i !== 0); assert.deepEqual(relaxed[0], [0, 0]);
const circle = circumcircles(delaunayFrom([[0, 0], [2, 0], [0, 2]]))[0]; assert.deepEqual(circle.center, [1, 1]); assert.ok(Math.abs(circle.radius - Math.SQRT2) < 1e-9);
const area = (p: [number, number][]) => Math.abs(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0)) / 2;
for (const level of [1, 2, 3] as const) for (const impact of [[0, 0], [1.59, 0.99], [-1.59, -0.99]] as [number, number][]) {
  const options = { level, width: 3.2, height: 2, impact, count: 220, seed: 912 };
  const pattern = generateShatterPattern(options); assert.deepEqual(pattern, generateShatterPattern(options));
  assert.ok(Math.abs(pattern.cells.reduce((sum, c) => sum + area(c.polygon), 0) - 6.4) < 1e-6, 'Cells tile pane exactly');
  if (level === 1) assert.ok(pattern.cells.every(c => Math.abs(area(c.polygon) - area(pattern.cells[0].polygon)) < 1e-8));
  if (level === 3 && impact[0] === 0) {
    const core = pattern.cells.filter(c => c.distance < 0.3), outer = pattern.cells.filter(c => c.distance > 0.9);
    assert.ok(core.reduce((s, c) => s + area(c.polygon), 0) / core.length < outer.reduce((s, c) => s + area(c.polygon), 0) / outer.length / 5);
    assert.ok(new Set(pattern.cells.map(c => c.ring)).size >= 4);
  }
  for (const cell of pattern.cells) {
    const { geometry, centroid } = buildShardGeometry(cell, 0.05); assert.deepEqual(centroid, polygonCentroid(cell.polygon)); geometry.dispose();
  }
}
const world = await createPhysicsWorld();
world.addStaticBox({ x: 0, y: -0.1, z: 0 }, { x: 20, y: 0.2, z: 20 });
const cell = generateShatterPattern({ level: 1, width: 3.2, height: 2, impact: [0, 0], count: 60, seed: 1 }).cells[0];
const { geometry } = buildShardGeometry(cell, 0.05), mesh = new Mesh(geometry, new MeshBasicMaterial()); mesh.position.y = 2;
const body = world.addShard(mesh, geometry, 0.1); world.frozen = true; world.step(0.1); assert.equal(body.translation().y, 2);
world.frozen = false; world.timeScale = 0.15; for (let i = 0; i < 60; i++) world.step(1 / 60); assert.ok(Math.abs(world.elapsed - 0.15) < 0.01);
world.timeScale = 1; for (let i = 0; i < 900; i++) world.step(1 / 60); world.sync(); assert.ok(body.isSleeping(), 'Shard settles and sleeps'); assert.ok(mesh.position.y >= 0.02);
world.dispose(); geometry.dispose(); terrain.forEach(t => t.geometry.dispose()); masked.geometry.dispose();
console.log('PASS library: deterministic seeds, shared L1/L2 topology, upward normals, mask, variable-radius spacing, circumcircle, masked Lloyd, fracture coverage/density/rings/centroids, Rapier freeze/slow-motion/settling.');
console.log('Terrain samples:', terrain.map(t => t.heights.length).join(' / '));

// Shard-budget grouping must preserve every cell and connectivity, including corner impacts.
for (const impact of [[0, 0], [2.99, 1.74], [-2.99, -1.74]] as [number, number][]) {
  const cells = generateShatterPattern({ level: 3, width: 6, height: 3.5, impact, count: 220, seed: 93 }).cells;
  const groups = groupAdjacentCells(cells, 52);
  assert.ok(groups.length <= 52); assert.equal(new Set(groups.flat()).size, cells.length);
  const adjacent = (a: typeof cells[number], b: typeof cells[number]) => a.polygon.filter(p => b.polygon.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)).length >= 2;
  for (const group of groups) {
    const reached = new Set([group[0]]);
    for (const cell of reached) for (const next of group) if (adjacent(cell, next)) reached.add(next);
    assert.equal(reached.size, group.length, 'Each rigid group must be edge-connected');
  }
}
// An L-shaped compound must leave its missing quadrant empty; one outer hull would fill it.
const compound = await createPhysicsWorld({ x: 0, y: 0, z: 0 });
const squares = [[[0, 0], [1, 0], [1, 1], [0, 1]], [[1, 0], [2, 0], [2, 1], [1, 1]], [[0, 1], [1, 1], [1, 2], [0, 2]]] as [number, number][][];
const parts = squares.map(polygon => {
  const { geometry, centroid } = buildShardGeometry({ polygon, seed: polygon[0], ring: 0, distance: 0 }, 0.05);
  return geometry.translate(centroid[0], centroid[1], 0);
});
const compoundMesh = new Mesh(parts[0], new MeshBasicMaterial()), compoundBody = compound.addShard(compoundMesh, parts, 0.3);
compound.step(1 / 120);
assert.equal(compoundBody.numColliders(), 3); assert.ok(Math.abs(compoundBody.mass() - 0.3) < 1e-6);
assert.equal(compound.world.castRay(new RAPIER.Ray({ x: 1.5, y: 1.5, z: 1 }, { x: 0, y: 0, z: -1 }), 2, true), null, 'No collider bridges the missing quadrant');
assert.ok(compound.world.castRay(new RAPIER.Ray({ x: 0.5, y: 1.5, z: 1 }, { x: 0, y: 0, z: -1 }), 2, true), 'Visible cell has a collider');
compound.dispose(); parts.forEach(g => g.dispose()); compoundMesh.material.dispose();
assert.deepEqual(physicsDiagnostics(), { worlds: 0, bodies: 0, colliders: 0 });

const wet = { bottom: 1, width: 1 }, dry = { bottom: 3, width: 1 };
const alone = distributeSpillVolume(2.59, 2, [wet])[0];
assert.deepEqual(distributeSpillVolume(2.59, 2, [wet, dry]), [alone, 0], 'Dry holes cannot steal volume');
assert.deepEqual(distributeSpillVolume(2.59, 2, [wet, { bottom: 2.59, width: 1 }]), [alone, 0], 'Exhausted holes cannot steal volume');
const weighted = distributeSpillVolume(2.59, 2, [wet, { ...wet, width: 2 }]);
assert.ok(Math.abs(weighted[1] / weighted[0] - 2) < 1e-9); assert.ok(Math.abs(weighted[0] + weighted[1] - alone) < 1e-9);
const crossing = distributeSpillVolume(2, 1, [wet, { bottom: 1.5, width: 1 }]);
assert.ok(crossing[1] > 0 && crossing[1] < 10.5); assert.ok(Math.abs(crossing[0] + crossing[1] - 21) < 1e-9, 'Conserve volume when a frame crosses a sill');
assert.deepEqual(distributeSpillVolume(1, 2.59, [wet]), [0], 'Refilling produces no spill');

// Reproduce both pending-resume and pending-decode reset races without depending on real audio hardware.
const originals = ['AudioContext', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
try {
  for (const stage of ['resume', 'decode']) {
    let release!: () => void, started = 0, contexts = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    class FakeAudioContext {
      currentTime = 0; destination = {};
      constructor() { contexts++; }
      async resume() { if (stage === 'resume') await gate; }
      async decodeAudioData() { if (stage === 'decode') await gate; return { duration: 1 }; }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createBufferSource() { return { connect() {}, disconnect() {}, start() { started++; }, stop() {} }; }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'on' } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) });
    const audio = createAudio(); assert.equal(contexts, 0, 'No AudioContext before gesture');
    const pending = audio.play(true); await new Promise(resolve => setTimeout(resolve, 0)); audio.reset(); release(); await pending;
    assert.equal(started, 0, `Reset cancels pending ${stage}`);
    await audio.play(true); assert.equal(started, 1, 'New playback still works after reset'); audio.reset();
  }
} finally {
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
}
console.log('PASS Run D regressions: connected shard groups, compound collision gap/mass, world disposal, discharge-weighted volume, dry/exhausted sills, pending audio cancellation.');
