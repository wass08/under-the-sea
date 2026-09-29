import RAPIER from '@dimforge/rapier3d-compat';
import type { BufferGeometry, Mesh } from 'three/webgpu';
type Vec3 = { x: number; y: number; z: number };
/** Shared WASM initialization. Await once before creating any physics world. */
export const physicsReady = RAPIER.init();
/** Independent fixed-step Rapier world, owning its bodies, colliders and mesh bindings. */
export async function createPhysicsWorld(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {
  await physicsReady;
  const world = new RAPIER.World(gravity), bindings: { mesh: Mesh; body: RAPIER.RigidBody }[] = [];
  const fixedDt = 1 / 120; let accumulator = 0;
  const api = {
    world, timeScale: 1, frozen: false, elapsed: 0,
    /** Mesh must be in world space with unit scale; geometry coordinates are local. */
    addShard(mesh: Mesh, geometry: BufferGeometry, mass: number) {
      const position = geometry.getAttribute('position'), vertices = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) vertices.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
      const collider = RAPIER.ColliderDesc.convexHull(vertices);
      if (!collider) throw new Error('Shard is not a valid convex hull');
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation(mesh.quaternion).setCcdEnabled(true).setLinearDamping(0.18).setAngularDamping(0.25));
      world.createCollider(collider.setMass(mass).setFriction(0.65).setRestitution(0.12), body);
      bindings.push({ mesh, body }); return body;
    },
    /** Create a fixed box with full dimensions, centred at position. */
    addStaticBox(position: Vec3, size: Vec3) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
      world.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(0.7), body); return body;
    },
    removeBody(body: RAPIER.RigidBody) {
      const index = bindings.findIndex(b => b.body === body);
      if (index >= 0) bindings.splice(index, 1);
      world.removeRigidBody(body);
    },
    applyImpulse(body: RAPIER.RigidBody, impulse: Vec3, point?: Vec3) { if (point) body.applyImpulseAtPoint(impulse, point, true); else body.applyImpulse(impulse, true); },
    step(dt: number) {
      if (api.frozen) return;
      accumulator += Math.min(Math.max(dt, 0), 0.1) * api.timeScale;
      while (accumulator >= fixedDt) { world.timestep = fixedDt; world.step(); accumulator -= fixedDt; api.elapsed += fixedDt; }
    },
    sync() { for (const { mesh, body } of bindings) { mesh.position.copy(body.translation()); mesh.quaternion.copy(body.rotation()); } },
    dispose() { bindings.length = 0; world.free(); },
  };
  return api;
}
export type PhysicsWorld = Awaited<ReturnType<typeof createPhysicsWorld>>;
