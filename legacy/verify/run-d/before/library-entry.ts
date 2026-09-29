import assert from 'node:assert/strict';
import { generateTerrain } from '../src/lib/terrain';
import { generateShatterPattern, buildShardGeometry } from '../src/lib/shatter';
import { polygonCentroid, lloydRelax, circumcircles, delaunayFrom } from '../src/lib/triangulate';
import { poissonDisk } from '../src/lib/poisson';
import { createPhysicsWorld } from '../src/lib/physics';
import { Mesh, MeshBasicMaterial } from 'three/webgpu';
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
