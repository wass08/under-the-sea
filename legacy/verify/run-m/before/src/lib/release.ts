import { Mesh, Quaternion, Vector3, type Material } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShardGeometry, groupAdjacentCells, insetCell, type ShatterCell } from './shatter';
import { polygonCentroid } from './triangulate';
import { createPhysicsWorld, type PhysicsWorld } from './physics';

/** Both aquarium and Lab use the same conditioned thin-glass solver and native sleep. */
export const createShardWorld = () => createPhysicsWorld(undefined, true);
export type ReleasedShard = { mesh: Mesh; body: ReturnType<PhysicsWorld['addShard']>; launch: { speed: number; angularSpeed: number } };
export type ReleaseOptions = {
  cells: ShatterCell[]; world: PhysicsWorld; material: Material;
  origin: Vector3; rotation: Quaternion; impact: Vector3;
  width: number; height: number; level: 1 | 2 | 3;
  budget: number; minimumArea: number; floorY: number; random: () => number;
  strength?: number; density?: number; cornerClearance?: number;
};
const areaOf = (cell: ShatterCell) => Math.abs(cell.polygon.reduce((a, p, i) => {
  const q = cell.polygon[(i + 1) % cell.polygon.length]; return a + p[0] * q[1] - p[1] * q[0];
}, 0)) / 2;

/** An angular velocity is independent of mass and plate shape; convert it through I_world. */
function angularImpulse(body: ReleasedShard['body'], velocity: Vector3) {
  const frame = new Quaternion().copy(body.rotation()).multiply(new Quaternion().copy(body.principalInertiaLocalFrame()));
  const impulse = velocity.clone().applyQuaternion(frame.clone().invert()).multiply(new Vector3().copy(body.principalInertia())).applyQuaternion(frame);
  body.applyTorqueImpulse(impulse, true);
}

/** Build connected compound plates and launch them with one mass-independent velocity profile. */
export function releaseShards(options: ReleaseOptions): ReleasedShard[] {
  const { cells, world, material, origin, rotation, impact, width, level, budget, minimumArea, floorY, random } = options;
  const density = options.density ?? 2500, strength = options.strength ?? 1;
  const groups = groupAdjacentCells(cells, budget, minimumArea), areas = groups.map(g => g.reduce((s, c) => s + areaOf(c), 0));
  if (!groups.length) return [];
  const minimumMass = Math.max(0.002 * density, Math.max(...areas) * 0.05 * density / 64);
  const xScale = (width - (options.cornerClearance ?? 0.062)) / width;
  return groups.map((group, index) => {
    const center = polygonCentroid(group[0].polygon);
    const parts = group.map(cell => {
      const { geometry, centroid } = buildShardGeometry(insetCell(cell, 0.001), 0.038);
      return geometry.translate(centroid[0], centroid[1], 0).scale(xScale, 1, 1).translate(-center[0], -center[1], 0);
    });
    const geometry = mergeGeometries(parts, false)!; parts.forEach(g => g.dispose());
    const mesh = new Mesh(geometry, material);
    mesh.position.set(center[0], center[1], 0).applyQuaternion(rotation).add(origin); mesh.quaternion.copy(rotation);
    const hulls = group.map(cell => {
      const c = polygonCentroid(cell.polygon);
      const inradius = Math.min(...cell.polygon.map((p, i) => {
        const q = cell.polygon[(i + 1) % cell.polygon.length];
        return Math.abs((q[0] - p[0]) * (p[1] - c[1]) - (p[0] - c[0]) * (q[1] - p[1])) / Math.hypot(q[0] - p[0], q[1] - p[1]);
      }));
      const { geometry, centroid } = buildShardGeometry(insetCell(cell, Math.min(0.004, inradius * 0.15) + 0.003), 0.040);
      geometry.userData.contactSkin = Math.min(0.003, inradius * 0.08);
      return geometry.translate(centroid[0], centroid[1], 0).scale(xScale, 1, 1).translate(-center[0], -center[1], 0);
    });
    const body = world.addShard(mesh, hulls, Math.max(minimumMass, areas[index] * 0.05 * density), true);
    hulls.forEach(g => g.dispose());
    const com = new Vector3().copy(body.worldCom()), radial = com.clone().sub(impact).applyQuaternion(rotation.clone().invert());
    radial.z = 0;
    const distance = radial.length();
    const falloff = level === 3 ? Math.exp(-distance * 1.3) : 1;
    const speed = (level === 3 ? Math.min(6.4, 2 + (com.y - floorY) * 0.7 + 3 * falloff) : 2.2) * strength;
    // Keep the cone shallow vertically so even the highest fragments land promptly.
    const spread = level === 3 ? radial.x * 0.5 / Math.max(speed, 0.001) : 0;
    const velocity = new Vector3(spread, 0, 1).normalize().multiplyScalar(speed).applyQuaternion(rotation);
    velocity.y = (level === 3 ? 0.15 + 0.2 * falloff : 0) * strength;
    world.applyImpulse(body, velocity.clone().multiplyScalar(body.mass()));

    // A quarter turn during the damped ballistic flight presents a broad face at landing.
    // A small randomized roll varies the tumble without edge balancing.
    const drag = 0.45, angularDrag = 1.2;
    let lo = 0, hi = 3;
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2;
      const y = com.y + (velocity.y + 9.81 / drag) * (1 - Math.exp(-drag * t)) / drag - 9.81 * t / drag;
      if (y > floorY + 0.025) lo = t; else hi = t;
    }
    const spin = level === 1 ? 0 : Math.min(12, Math.PI * 0.5 * angularDrag / (1 - Math.exp(-angularDrag * (lo + hi) / 2)));
    const omega = new Vector3(spin, 0, level === 3 ? (random() - 0.5) * 0.04 : 0).applyQuaternion(rotation).clampLength(0, 12);
    angularImpulse(body, omega);
    const v = body.linvel(), w = body.angvel();
    return { mesh, body, launch: { speed: Math.hypot(v.x, v.y, v.z), angularSpeed: Math.hypot(w.x, w.y, w.z) } };
  });
}

/** Recorded at creation, before the first simulation step; never inferred from impulse constants. */
export function launchDiagnostics(shards: ReleasedShard[]) {
  if (!shards.length) return null;
  const speeds = shards.map(s => s.launch.speed).sort((a, b) => a - b);
  return { count: speeds.length, min: speeds[0], median: speeds[Math.floor(speeds.length / 2)], max: speeds[speeds.length - 1], maxAngular: Math.max(...shards.map(s => s.launch.angularSpeed)) };
}
