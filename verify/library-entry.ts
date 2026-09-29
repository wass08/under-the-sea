import { TANK } from '../src/state';
import { WATER_SPECTRUM, WATER_SCALE } from '../src/lib/waves';
import assert from 'node:assert/strict';
import { generateTerrain, generateIslandTerrain, setTerrainSmooth } from '../src/lib/terrain';
import { createNoise2D, terrainHeight } from '../src/lib/noise';
import { ISLAND_SEED } from '../src/scene/island';
import { generateShatterPattern, buildShardGeometry, groupAdjacentCells, insetCell } from '../src/lib/shatter';
import { polygonCentroid, lloydRelax, circumcircles, delaunayFrom } from '../src/lib/triangulate';
import { poissonDisk } from '../src/lib/poisson';
import { createPhysicsWorld, physicsDiagnostics } from '../src/lib/physics';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3, Quaternion } from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { createAudio } from '../src/audio';
const options = { size: 14, count: 1500, seed: 42, amplitude: 4.2 };
const terrainOptions = [
  { ...options, level: 1 as const, count: 30000 },
  { ...options, level: 2 as const },
  { ...options, level: 3 as const },
  { ...options, level: 3 as const, sampling: 'random' as const },
];
const terrain = terrainOptions.map(generateTerrain);
assert.notDeepEqual(terrain[0].seeds, terrain[1].seeds, 'Dense and coarse grids differ');
assert.notDeepEqual(terrain[2].seeds, terrain[3].seeds, 'Poisson and random sampling differ');
assert.equal(terrain[3].heights.length, options.count + 4 * Math.ceil(Math.sqrt(options.count)));
const interior = (t: typeof terrain[number]) => Array.from({ length: t.heights.length }, (_, i) => [t.delaunay.points[i * 2], t.delaunay.points[i * 2 + 1]]).filter(p => p.every(v => Math.abs(v) < options.size / 2));
const minimumDistance = (points: number[][]) => { let min = Infinity; for (let i = 0; i < points.length; i++) for (let j = 0; j < i; j++) min = Math.min(min, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1])); return min; };
const poissonMin = minimumDistance(interior(terrain[2]));
assert.ok(poissonMin >= options.size / Math.sqrt(options.count) * 1.05 / Math.sqrt(4.25) - 1e-6);
assert.ok(minimumDistance(interior(terrain[3])) < poissonMin * .5, 'Random sampling retains clumps');
const noise = createNoise2D(options.seed);
for (const [index, t] of terrain.entries()) {
  const repeat = generateTerrain({ ...terrainOptions[index], erosion: 8, carve: 420 });
  assert.deepEqual(t.seeds, repeat.seeds, 'Sampling is seeded');
  assert.deepEqual(t.heights, repeat.heights, 'Lab disables mesh-dependent erosion and carving');
  repeat.geometry.dispose();
  const expectedNeighbours = Array.from({ length: t.heights.length }, () => new Set<number>());
  for (let e = 0; e < t.delaunay.triangles.length; e += 3) {
    const ids = t.delaunay.triangles.slice(e, e + 3);
    for (const i of ids) for (const j of ids) if (i !== j) expectedNeighbours[i].add(j);
  }
  for (let i = 0; i < t.heights.length; i++) {
    const x = t.delaunay.points[i * 2], z = t.delaunay.points[i * 2 + 1];
    assert.equal(t.heights[i], Math.fround(terrainHeight(x, z, { noise, amplitude: options.amplitude, frequency: 1.5 / options.size })), 'Every level samples the same analytic field');
    assert.deepEqual(new Set(t.delaunay.neighbors(i)), expectedNeighbours[i], 'Reveal topology matches mesh neighbours');
  }
  assert.equal(t.diagnostics.thermalChange.changed, 0);
  assert.equal(t.diagnostics.carveChange.changed, 0);
  assert.equal(t.geometry.index, null);
  for (const value of t.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
  assert.ok(Array.from(t.geometry.getAttribute('normal').array).every((n, i) => i % 3 !== 1 || n >= 0));
}
for (const grid of terrain.slice(0, 2)) {
  const segments = Math.sqrt(grid.heights.length) - 1;
  assert.equal(grid.heights.length, (segments + 1) ** 2);
  assert.equal(grid.biome.length / 3, 2 * segments ** 2);
  const gridCircles = circumcircles(grid.delaunay);
  assert.equal(gridCircles.length, 2 * segments ** 2, 'Co-circular grid triangles retain their circles');
  for (let i = 0; i < gridCircles.length; i += 2) {
    assert.ok(Math.hypot(...gridCircles[i].center.map((v, j) => v - gridCircles[i + 1].center[j])) < 1e-10);
    assert.ok(Math.abs(gridCircles[i].radius - options.size / segments / Math.SQRT2) < 1e-10);
  }
}
for (const level of [1, 2] as const) for (const count of level === 1 ? [2000, 30000, 40000] : [200, 900, 4000]) {
  const sampled = generateTerrain({ ...options, level, count });
  assert.equal(sampled.heights.length, Math.round(Math.sqrt(count)) ** 2, 'Seed slider controls grid resolution');
  sampled.geometry.dispose();
}
// Averaging normals must preserve every position and biome attribute, and be reversible.
for (const t of terrain) {
  const positions = t.geometry.getAttribute('position').array.slice();
  const weights = t.geometry.getAttribute('biomeWeights').array.slice();
  setTerrainSmooth(t.geometry, false);
  const flat = t.geometry.getAttribute('normal').array.slice();
  for (let i = 0; i < flat.length; i += 9) for (let j = 0; j < 3; j++) {
    assert.equal(flat[i + j], flat[i + 3 + j]); assert.equal(flat[i + j], flat[i + 6 + j]);
  }
  setTerrainSmooth(t.geometry, true);
  const normals = t.geometry.getAttribute('normal').array, seen = new Map<string, number[]>();
  for (let i = 0; i < positions.length; i += 3) {
    const key = Array.from(positions.slice(i, i + 3)).join(','), n = Array.from(normals.slice(i, i + 3));
    if (seen.has(key)) assert.deepEqual(n, seen.get(key)); else seen.set(key, n);
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
  }
  assert.notDeepEqual(normals, flat);
  assert.deepEqual(t.geometry.getAttribute('position').array, positions);
  assert.deepEqual(t.geometry.getAttribute('biomeWeights').array, weights);
  setTerrainSmooth(t.geometry, false); assert.deepEqual(t.geometry.getAttribute('normal').array, flat);
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
console.log('PASS library: deterministic grid/random/Poisson sampling, shared analytic heights, Lab erosion/carving off, grid circumcircles/neighbours/resolution, upward normals, mask, variable-radius spacing, circumcircle, masked Lloyd, fracture coverage/density/rings/centroids, Rapier freeze/slow-motion/settling.');
console.log('Terrain samples:', terrain.map(t => t.heights.length).join(' / '));

// Shard-budget grouping must preserve every cell and connectivity, including corner impacts.
for (const impact of [[0, 0], [2.99, 1.74], [-2.99, -1.74]] as [number, number][]) {
  const cells = generateShatterPattern({ level: 3, width: 6, height: 3.5, impact, count: 220, seed: 93 }).cells;
  for (const minimumArea of [0, 0.1]) {
  const groups = groupAdjacentCells(cells, 52, minimumArea);
  assert.ok(groups.length <= 52); assert.equal(new Set(groups.flat()).size, cells.length);
  const adjacent = (a: typeof cells[number], b: typeof cells[number]) => a.polygon.filter(p => b.polygon.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)).length >= 2;
  for (const group of groups) {
    const reached = new Set([group[0]]);
    for (const cell of reached) for (const next of group) if (adjacent(cell, next)) reached.add(next);
    assert.equal(reached.size, group.length, 'Each rigid group must be edge-connected');
    assert.ok(group.reduce((sum, cell) => sum + area(cell.polygon), 0) >= minimumArea, 'Small connected slivers join a stable compound');
  }
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

// Reproduce both pending-resume and pending-decode reset races without depending on real audio hardware.
const originals = ['AudioContext', 'localStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
try {
  for (const stage of ['resume', 'decode', 'preloaded-resume']) {
    let release!: () => void, started = 0, stopped = 0, contexts = 0, frame = 1;
    const gate = new Promise<void>(resolve => { release = resolve; });
    class FakeAudioContext {
      currentTime = 0; destination = {}; state = 'suspended';
      async suspend() { this.state = 'suspended'; }
      createBuffer(channels: number, length: number, sampleRate: number) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] }; }
      constructor() { contexts++; }
      async resume() { if (stage.endsWith('resume')) await gate; this.state = 'running'; }
      async decodeAudioData() { if (stage === 'decode') await gate; const buffer = this.createBuffer(1, 48000, 48000); buffer.getChannelData(0).fill(0.1, 20000, 40000); return buffer; }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createBufferSource() { return { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() { started++; }, stop() { stopped++; } }; }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'on' } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) });
    const audio = createAudio(() => frame); assert.equal(contexts, 1, 'Preload into suspended AudioContext');
    if (stage === 'preloaded-resume') await audio.loading;
    const pending = audio.play(true);
    if (stage === 'preloaded-resume') { assert.equal(started, 1, 'Schedule immediately while device resume is pending'); assert.equal(audio.diagnostics.lastPlay?.frame, frame); }
    frame++;  await new Promise(resolve => setTimeout(resolve, 0)); audio.reset(); release(); await pending;
    assert.equal(started - stopped, 0, `Reset cancels pending ${stage}`);
    const previousStarts = started;
    await audio.play(true); assert.equal(started, previousStarts + 1, 'New playback still works after reset'); audio.reset();
  }
} finally {
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
}
console.log('PASS Run D regressions: connected shard groups, compound collision gap/mass, world disposal, pending audio cancellation.');

// A clipped corner's short edge disappears during inset: no miter spike may remain.
const clippedCorner = { polygon: [[-1,-1], [1,-1], [1,0.99], [0.99,1], [-1,1]] as [number, number][], seed: [0,0] as [number,number], ring: 0, distance: 0 };
const inset = insetCell(clippedCorner, 0.1);
assert.ok(area(inset.polygon) > 0);
for (const p of inset.polygon) for (let i = 0; i < clippedCorner.polygon.length; i++) {
  const a = clippedCorner.polygon[i], b = clippedCorner.polygon[(i+1)%clippedCorner.polygon.length];
  const distance = ((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])) / Math.hypot(b[0]-a[0],b[1]-a[1]);
  assert.ok(distance >= 0.1 - 1e-9, 'Every inset point stays behind every offset edge');
}
console.log('PASS Run I regression: inset removes short edges without collider spikes.');

// The base centre rounds upward in Rapier's f32 storage; it must still trigger contact drag.
const baseWorld = await createPhysicsWorld(undefined, true);
baseWorld.addStaticBox({ x: 0, y: 0.08, z: 0 }, { x: 4, y: 0.16, z: 4 });
const basePlate = buildShardGeometry({ polygon: [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]], seed: [0,0], ring: 0, distance: 0 }, 0.04).geometry;
const baseMesh = new Mesh(basePlate, new MeshBasicMaterial()); baseMesh.position.y = 0.6; baseMesh.rotation.x = Math.PI / 2;
const baseBody = baseWorld.addShard(baseMesh, basePlate, 125, true);
for (let i = 0; i < 120; i++) baseWorld.step(1 / 120);
assert.ok(baseBody.linearDamping() >= 3, 'Contact with the 0.08-centred base increases damping');
for (let i = 0; i < 480; i++) baseWorld.step(1 / 120);
assert.ok(baseBody.isSleeping(), 'Base-supported plate sleeps natively');
baseWorld.dispose(); basePlate.dispose(); baseMesh.material.dispose();
assert.deepEqual(physicsDiagnostics(), { worlds: 0, bodies: 0, colliders: 0 });
console.log('PASS Run I base contact: float rounding cannot bypass grounded damping; native sleep.');

// Run J: neighbourhood labels eliminate isolated biome holes; weights form a partition.
const coherent = generateIslandTerrain(ISLAND_SEED, { carve: 0 });
const weights = coherent.geometry.getAttribute('biomeWeights');
for(let i=0;i<weights.count;i++) {
  const channels=[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)];
  assert.ok(channels.every(v=>v>=0 && v<=1));assert.ok(Math.abs(channels.reduce((a,b)=>a+b,0)-1)<1e-5);
}
for(const face of coherent.faces) if(face.adjacent.length===3) assert.ok(face.adjacent.some(j=>coherent.faces[j].biome===face.biome),'No isolated biome face');
const uneroded=generateIslandTerrain(ISLAND_SEED, { erosion: 0, carve: 0 });
assert.deepEqual(coherent.seeds,uneroded.seeds);
assert.ok(coherent.heights.some((v,i)=>Math.abs(v-uneroded.heights[i])>.001),'Thermal erosion actually moves material');
// Compare mass before the island's final height normalization.
assert.ok(Math.abs(coherent.diagnostics.thermal.mean-uneroded.diagnostics.thermal.mean)*coherent.heights.length<.001,'Conservative erosion');
coherent.geometry.dispose();uneroded.geometry.dispose();
console.log('PASS Run J: coherent biome graph, normalized blend weights, deterministic erosion topology and conservation.');

// Run K: actual Rapier velocity at t=0 must survive a 10× density change, including spin.
import { releaseShards, createShardWorld } from '../src/lib/release';
import { random } from '../src/lib/random';
for (const level of [1, 2, 3] as const) {
  const cells = generateShatterPattern({ level, width: 3.2, height: 2, impact: [0,0], count: 100, seed: 912 }).cells;
  const launches: { velocity: number[]; spin: number[]; mass: number }[][] = [];
  for (const density of [250, 2500]) {
    const world = await createShardWorld(), material = new MeshBasicMaterial();
    const shards = releaseShards({ cells, world, material, origin: new Vector3(0,1.25,0), rotation: new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2),
      impact: new Vector3(0,1.25,0), width: 3.2, height: 2, level, budget: 400, minimumArea: .025, floorY: 0, random: random(117), density });
    launches.push(shards.map(({body}) => ({velocity: Object.values(body.linvel()),spin: Object.values(body.angvel()),mass:body.mass()})));
    assert.ok(shards.every(s=>s.body.linvel().x>0), 'Pane normal rotates the outward burst into world space');
    assert.ok(shards.every(s=>s.launch.angularSpeed<=14.001), 'Inertia-scaled angular kick stays bounded');
    if(level<3) assert.ok(Math.max(...shards.map(s=>s.launch.speed))-Math.min(...shards.map(s=>s.launch.speed))<1e-5,'Uniform levels have no distance falloff');
    else assert.ok(Math.max(...shards.map(s=>s.launch.speed))-Math.min(...shards.map(s=>s.launch.speed))>1,'Radial level has a real velocity gradient');
    for(const s of shards)s.mesh.geometry.dispose();material.dispose();world.dispose();
  }
  for(let i=0;i<launches[0].length;i++) {
    const a=launches[0][i],b=launches[1][i];
    assert.ok(Math.abs(b.mass/a.mass-10)<1e-4);
    for(let j=0;j<3;j++) {assert.ok(Math.abs(a.velocity[j]-b.velocity[j])<1e-4,'Mass-independent linear velocity');assert.ok(Math.abs(a.spin[j]-b.spin[j])<1e-4,'Inertia-independent angular velocity');}
  }
}
assert.deepEqual(physicsDiagnostics(), { worlds: 0, bodies: 0, colliders: 0 });
console.log('PASS Run K: shared release, 10× density invariance for linear/angular launch, bounded spin, rotated pane normals, level-dependent falloff, disposal.');

// At maximum agitation the sum of horizontal compressions bounds every eigenvalue:
// a positive lower bound prevents folded/inside-out Gerstner triangles in the interior.
const compressionBound = WATER_SPECTRUM.reduce((s,[,length,amplitude,q]) => s + 2*Math.PI/length*amplitude*q*(1+WATER_SCALE.agitationGain)*WATER_SCALE.choppiness*(1+WATER_SCALE.chopGain), 0);
assert.ok(compressionBound < 1, 'Full agitation preserves the Gerstner horizontal Jacobian');
assert.ok(Math.min(...WATER_SPECTRUM.map(w=>w[1])) / (6/128) > 5, 'At least five vertices per shortest wavelength');
console.log('Gerstner spectrum: compression bound', compressionBound, 'minimum Jacobian eigenvalue', 1-compressionBound);

// Run N: identical seeded releases must be independent of idle/render-frame phase.
async function replayRelease(frameChunks: number[], idle: number) {
  const world = await createShardWorld(), material = new MeshBasicMaterial();
  world.addStaticBox({x:0,y:-.1,z:0},{x:40,y:.2,z:40}); world.step(idle);
  const cells = generateShatterPattern({level:3,width:3.2,height:2,impact:[0,0],count:220,seed:912}).cells;
  const shards = releaseShards({cells,world,material,origin:new Vector3(0,1.25,0),rotation:new Quaternion(),impact:new Vector3(0,1.25,0),width:3.2,height:2,level:3,budget:400,minimumArea:.025,floorY:0,random:random(117)});
  assert.ok(shards.every(s => s.launch.radialFraction > .78), 'L3 launch has a strong in-plane radial component');
  const frames: number[][] = [];
  for (let i=0;i<150;i++) {
    for (const dt of frameChunks) world.step(dt);
    frames.push(shards.flatMap(s=>[...Object.values(s.body.translation()),...Object.values(s.body.rotation())]));
  }
  shards.forEach(s=>s.mesh.geometry.dispose()); material.dispose(); world.dispose(); return frames;
}
assert.deepEqual(await replayRelease([1/60,1/60],.007),await replayRelease([1/120,1/40],.011));
console.log('PASS Run N: seeded shard trajectories are bit-identical across render-frame chunking and pre-release accumulator phase.');

// Run O: compare real pass outputs before normalization, and protect the cliff/biome contract.
const island=generateIslandTerrain(ISLAND_SEED), islandRepeat=generateIslandTerrain(ISLAND_SEED);
assert.deepEqual(island.heights,islandRepeat.heights,'Seeded droplets are deterministic');
for(const key of ['warpChange','thermalChange','carveChange'] as const) {
  assert.ok(island.diagnostics[key].meanAbsolute>.001, key+' changes the field');
  assert.ok(island.diagnostics[key].changed>100,key+' reaches a meaningful part of the field');
}
assert.ok(island.diagnostics.gullyCount>0 && island.diagnostics.dropletPaths>200,'Connected downhill carving');
for(const face of island.faces) {
  if(face.slope>.48)assert.equal(face.biome,2,'Steep faces stay rock at every height');
  if(face.adjacent.length===3)assert.ok(face.adjacent.some(j=>island.faces[j].biome===face.biome),'No isolated island biome labels');
  if(face.biome===3)assert.ok(face.height/2.67>.80,'Snow remains in the upper cap');

}
const w=island.geometry.getAttribute('biomeWeights');
for(let i=0;i<w.count;i+=3)assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-5);
assert.ok(island.seeds.every((v,i)=>Math.abs(v)<=(i%2?TANK.depth:TANK.width)/2),'No wall clipping');
assert.equal(terrain[2].diagnostics.dropletPaths,0,'Lab L3 has no main-page carving');
island.geometry.dispose();islandRepeat.geometry.dispose();
console.log('PASS Run O: active warp/thermal/carve, deterministic channel networks, cliff override, upper snow, coherent biomes, wall clearance; Lab technique unchanged.');

// A stalled render must not queue unbounded solver work on following frames.
for (const glass of [false,true]) {
  const capped = await createPhysicsWorld(undefined,glass), tick = glass ? 1/60 : 1/120, limit=glass?3:2;
  capped.beginRelease(); capped.step(1); assert.equal(capped.elapsed,limit*tick,'Glass launch catches up at most three ticks; generic worlds at most two');
  capped.step(0); assert.equal(capped.elapsed,limit*tick,'Overdue ticks are dropped');
  capped.step(tick); assert.equal(capped.elapsed,(limit+1)*tick,'Next normal frame advances normally'); capped.dispose();
}
const crowdedCap = await createShardWorld();
for (let i=0;i<513;i++) crowdedCap.addStaticBox({x:i*2,y:0,z:0},{x:1,y:.1,z:1});
crowdedCap.step(1); assert.equal(crowdedCap.elapsed,1/60,'Crowded glass advances at most one tick');
crowdedCap.step(0); assert.equal(crowdedCap.elapsed,1/60,'Crowded backlog is discarded'); crowdedCap.dispose();
console.log('PASS physics cap: glass launch three ticks, generic two, crowded tail one; drop backlog and resume fixed stepping.');

const wakeWorld = await createPhysicsWorld({x:0,y:0,z:0},true), wakeGeometry = new BoxGeometry(.1,.1,.1), wakeMaterial = new MeshBasicMaterial(), wakeMesh = new Mesh(wakeGeometry,wakeMaterial);
const wakeBody = wakeWorld.addShard(wakeMesh,wakeGeometry,1,true);wakeBody.setLinvel({x:1,y:0,z:0},true);wakeWorld.step(1/60);wakeWorld.sync();
wakeBody.sleep();wakeWorld.sync();const sleepingPose=wakeMesh.position.toArray();wakeBody.wakeUp();wakeWorld.sync();
assert.deepEqual(wakeMesh.position.toArray(),sleepingPose,'Wake-up interpolation starts at the final sleeping pose');
wakeWorld.dispose();wakeGeometry.dispose();wakeMaterial.dispose();
console.log('PASS sleeping shard sync: wake-up retains the final cached pose.');

// Launch fidelity follows fixed ticks, including collision restoration and the 0.6–0.8 s ramp.
async function replayCrowdedLaunch(chunks:number[],separate=true) {
  const world=await createShardWorld(),material=new MeshBasicMaterial();world.separateLaunch=separate;
  const floor=world.addStaticBox({x:0,y:-.1,z:0},{x:40,y:.2,z:40});
  for(let i=0;i<513;i++)world.addStaticBox({x:100+i*2,y:0,z:0},{x:1,y:.1,z:1});
  const cells=generateShatterPattern({level:3,width:3.2,height:2,impact:[0,0],count:100,seed:912}).cells;
  const shards=releaseShards({cells,world,material,origin:new Vector3(0,1.25,0),rotation:new Quaternion(),impact:new Vector3(0,1.25,0),width:3.2,height:2,level:3,budget:400,minimumArea:.025,floorY:0,random:random(117)}),frames:number[][]=[];
  assert.equal(floor.collider(0).collisionGroups(),separate?0x1ffff:0xffffffff,'Lab fidelity does not change contact groups');
  for(let tick=0;tick<90;tick++) {
    for(const dt of chunks)world.step(dt);
    const extra=Math.round(44*Math.max(0,Math.min(1,(48-tick)/12)));
    assert.equal(shards[0].body.additionalSolverIterations(),extra,'Fresh contact islands retain 48 iterations, then ramp to 4');
    assert.equal(shards[0].body.collider(0).collisionGroups(),separate?(tick<24?0x20001:0x2ffff):0xffffffff,'Restore mutual collision after separation; retain floor/pane contacts throughout');
    assert.equal(world.world.numInternalPgsIterations,Math.round(1+11*Math.max(0,Math.min(1,(48-tick)/12))));
    frames.push(shards.flatMap(s=>[...Object.values(s.body.translation()),...Object.values(s.body.rotation())]));
  }
  world.beginRelease();world.step(1);assert.equal(world.lastSteps,3,'Launch catch-up is bounded at three ticks');world.step(0);assert.equal(world.lastSteps,0,'Launch backlog is discarded');
  shards.forEach(s=>s.mesh.geometry.dispose());material.dispose();world.dispose();return frames;
}
assert.deepEqual(await replayCrowdedLaunch([1/60]),await replayCrowdedLaunch([1/120,1/120]));
console.log('PASS launch phase: bit-identical crowded trajectories, 48-to-4 solver ramp, restored contacts, three-step cap and dropped backlog.');

// Aquarium cell identity is independent of the connected-compound option used by Lab.
const individualPattern=generateShatterPattern({level:3,width:7.6,height:2.84,impact:[.6,.23],count:220,seed:93}).cells;
const individualGroups=groupAdjacentCells(individualPattern,individualPattern.length,0);
assert.equal(individualGroups.length,220);assert.ok(individualGroups.every(g=>g.length===1));
assert.deepEqual(individualGroups.flat(),individualPattern,'No cell or polygon is discarded to meet the flight budget');
const individualWorld=await createShardWorld();individualWorld.separateLaunch=true;individualWorld.individualCells=true;
const individualMaterial=new MeshBasicMaterial(),individualShards=releaseShards({cells:individualPattern,world:individualWorld,material:individualMaterial,origin:new Vector3(0,1.58,0),rotation:new Quaternion(),impact:new Vector3(.6,1.81,0),width:7.6,height:2.84,level:3,budget:220,minimumArea:0,floorY:0,random:random(912)});
assert.equal(individualShards.length,220);assert.ok(individualShards.every(s=>s.body.numColliders()===1),'One actual convex collider per flying body');
individualShards.forEach(s=>s.mesh.geometry.dispose());individualMaterial.dispose();individualWorld.dispose();
console.log('PASS individual aquarium cells: 220 cells remain 220 independent bodies; connected-compound Run D behavior retained.');

assert.deepEqual(await replayCrowdedLaunch([1/60],false),await replayCrowdedLaunch([1/120,1/120],false));
console.log('PASS Lab launch fidelity: deterministic 48/12 release window and three-step catch-up without collision grace.');

import './impulse-library-entry';

import './budget-library-entry';
