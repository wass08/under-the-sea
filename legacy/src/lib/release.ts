import { Float32BufferAttribute, Mesh, Quaternion, Vector3, type Material } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShardGeometry, groupAdjacentCells, insetCell, type ShatterCell } from './shatter';
import { polygonCentroid } from './triangulate';
import { createPhysicsWorld, type PhysicsWorld } from './physics';

/** Both aquarium and Lab use the same conditioned thin-glass solver and native sleep. */
export const createShardWorld = () => createPhysicsWorld(undefined, true);
// L2/L3 share a travelling velocity front: fast core, slower outer plates.
export const LAB_RELEASE_DEFAULTS = { impulse: 1.35, falloff: 4.8, forward: .9, spin: 1.35 };
export function migrateLabReleaseSettings(settings: Record<string, boolean | number | string>) {
  if (settings.burstVersion !== 2) Object.assign(settings, LAB_RELEASE_DEFAULTS, { burstVersion: 2 });
}
export type LabReleaseProfile = typeof LAB_RELEASE_DEFAULTS & { kind: 'lab' };
export type ReleasedShard = { mesh: Mesh; body: ReturnType<PhysicsWorld['addShard']>; launch: { speed: number; angularSpeed: number; radialFraction: number } };
export type ReleaseOptions = {
  cells: ShatterCell[]; world: PhysicsWorld; material: Material;
  origin: Vector3; rotation: Quaternion; impact: Vector3;
  width: number; height: number; level: 1 | 2 | 3;
  budget: number; minimumArea: number; floorY: number; random: () => number;
  strength?: number; maxSpeed?: number; spinStrength?: number; density?: number; cornerClearance?: number;
  profile?: 'aquarium' | LabReleaseProfile;
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

/** Independent cells; a restrictive budget or positive minimumArea opts into connected plates. */
export function releaseShards(options: ReleaseOptions): ReleasedShard[] {
  const { cells, world, material, origin, rotation, impact, width, level, budget, minimumArea, random } = options;
  const density = options.density ?? 2500, strength = options.strength ?? 1;
  const lab = typeof options.profile === 'object' && level > 1 ? options.profile : null;
  // Let the core separate before mutual contacts; support drag starts only at landing.
  // Radial L3 slivers need stronger supported slide damping than the larger L2 plates.
  if (lab) { world.separateLaunch = true; world.supportDamping = [level === 3 ? 12 : 8, 5]; }
  world.beginRelease();
  const groups = groupAdjacentCells(cells, budget, minimumArea), areas = groups.map(g => g.reduce((s, c) => s + areaOf(c), 0));
  if (!groups.length) return [];
  const minimumMass = Math.max(0.002 * density, Math.max(...areas) * 0.05 * density / 64);
  const xScale = (width - (options.cornerClearance ?? 0.062)) / width;
  const released = groups.map((group, index) => {
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
    const falloff = Math.exp(-distance * (lab?.falloff ?? 3));
    geometry.setAttribute('impactGlow', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(level === 3 ? falloff : 0), 1));
    const speed = lab ? Math.min(14, (2.2 + 6.8 * falloff) * lab.impulse) : Math.min(options.maxSpeed ?? Infinity, (level === 3 ? 1.8 + 5.7 * falloff : 2.2) * strength);
    const radialDirection = radial.clone().normalize();
    const velocity = radialDirection.clone().multiplyScalar(lab ? Math.sqrt(1 - lab.forward ** 2) : level === 3 ? 0.85 : level === 2 ? 0.18 : 0);
    velocity.z = lab ? lab.forward : level === 3 ? 0.55 : 1;
    if (!lab && level === 3) velocity.y += 0.09 * falloff;
    velocity.normalize().multiplyScalar(speed).applyQuaternion(rotation);
    world.applyImpulse(body, velocity.clone().multiplyScalar(body.mass()));

    // Random-axis tumble biased outward to clear surviving pane edges.
    // Convert the requested angular velocity through the real conditioned inertia.
    const axis = new Vector3(1, (random() - .5) * 1.0, (random() - .5) * 1.0).normalize();
    const spin = lab ? Math.min(14, lab.spin * (3 + 9 * falloff + 2 * Math.min(1, .03 / areas[index]))) : level === 1 ? 0 : level === 2 ? 4 : Math.min(14, (4 + 10 * falloff * (.7 + .3 * random())) * (options.spinStrength ?? strength));
    const omega = axis.multiplyScalar(spin).applyQuaternion(rotation);
    if (!lab && level === 2) {
      // Mild impact fan with a broad-face landing; L3 keeps the random tumble above.
      const flight = Math.sqrt(Math.max(.02, com.y - options.floorY) * 2 / 9.81);
      omega.set(Math.min(14, Math.PI * .6 * 1.2 / (1 - Math.exp(-1.2 * flight))), 0, 0).applyQuaternion(rotation);
    }
    angularImpulse(body, omega);
    const v = body.linvel(), w = body.angvel();
    return { mesh, body, launch: { speed: Math.hypot(v.x, v.y, v.z), angularSpeed: Math.hypot(w.x, w.y, w.z), radialFraction: Math.abs(new Vector3().copy(v).dot(radialDirection.applyQuaternion(rotation))) / Math.max(1e-8, speed) } };
  });
  world.burstProbe?.release(released, impact, world.elapsed);
  return released;
}

/** Recorded at creation, before the first simulation step; never inferred from impulse constants. */
export function launchDiagnostics(shards: ReleasedShard[]) {
  if (!shards.length) return null;
  const speeds = shards.map(s => s.launch.speed).sort((a, b) => a - b);
  return { radialFraction: shards.reduce((sum, s) => sum + s.launch.radialFraction, 0) / shards.length, count: speeds.length, min: speeds[0], median: speeds[Math.floor(speeds.length / 2)], max: speeds[speeds.length - 1], maxAngular: Math.max(...shards.map(s => s.launch.angularSpeed)) };
}
