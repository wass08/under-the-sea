import RAPIER from '@dimforge/rapier3d-compat';
import type { BufferGeometry, Mesh } from 'three/webgpu';
type Vec3 = { x: number; y: number; z: number };
/** Shared WASM initialization. Await once before creating any physics world. */
export const physicsReady = RAPIER.init();
const liveWorlds = new Set<RAPIER.World>();
/** Actual live WASM allocations, exposed read-only to runtime verification. */
export function physicsDiagnostics() {
  return { worlds: liveWorlds.size, bodies: [...liveWorlds].reduce((n, w) => n + w.bodies.len(), 0), colliders: [...liveWorlds].reduce((n, w) => n + w.colliders.len(), 0) };
}
/** Independent fixed-step Rapier world, owning its bodies, colliders and mesh bindings. */
export async function createPhysicsWorld(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {
  await physicsReady;
  const world = new RAPIER.World(gravity), bindings: { mesh: Mesh; body: RAPIER.RigidBody; settle: boolean; born: number; quiet: number; grounded: boolean }[] = [];
  liveWorlds.add(world);
  const fixedDt = 1 / 120; let accumulator = 0;
  const api = {
    world, timeScale: 1, frozen: false, elapsed: 0,
    /** Mesh must be in world space with unit scale; geometry coordinates are local. */
    addShard(mesh: Mesh, geometry: BufferGeometry | BufferGeometry[], mass: number, settle = false) {
      // Parts share the mesh's local coordinate frame; never hull across the gaps between cells.
      const parts = Array.isArray(geometry) ? geometry : [geometry];
      const total = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
      const colliders = parts.map(part => {
        const position = part.getAttribute('position'), vertices = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) vertices.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
        const collider = RAPIER.ColliderDesc.convexHull(vertices);
        if (!collider) throw new Error('Shard is not a valid convex hull');
        return collider.setMass(mass * position.count / total).setFriction(0.65).setRestitution(settle ? 0.03 : 0.12).setContactSkin(settle ? 0.0005 : 0);
      });
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation(mesh.quaternion).setCcdEnabled(true).setLinearDamping(0.18).setAngularDamping(0.25));
      for (const collider of colliders) world.createCollider(collider, body);
      bindings.push({ mesh, body, settle, born: api.elapsed, quiet: 0, grounded: false }); return body;
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
      while (accumulator >= fixedDt) {
        world.timestep = fixedDt; world.step(); accumulator -= fixedDt; api.elapsed += fixedDt;
        for (const binding of bindings) {
          const { body } = binding;
          if (!binding.settle || !body.isDynamic()) continue;
          const age = api.elapsed - binding.born;
          if (age > 1 && body.isCcdEnabled()) body.enableCcd(false);
          // Main aquarium only: give the pile a deterministic end pose, including sleepers that could reawaken.
          if (age >= 6) { body.setBodyType(RAPIER.RigidBodyType.Fixed, false); continue; }
          if (!binding.grounded) for (let i = 0; i < body.numColliders(); i++) {
            world.contactPairsWith(body.collider(i), other => {
              const parent = other.parent();
              if (parent?.isFixed() && parent.translation().y <= 0.08) binding.grounded = true;
            });
            if (binding.grounded) { body.setLinearDamping(2.5); body.setAngularDamping(5); break; }
          }
          const v = body.linvel(), w = body.angvel();
          binding.quiet = Math.hypot(v.x, v.y, v.z) < 0.03 && Math.hypot(w.x, w.y, w.z) < 0.2 ? binding.quiet + fixedDt : 0;
          if (binding.quiet >= 0.6) body.sleep();
        }
      }
    },
    sync() { for (const { mesh, body } of bindings) { mesh.position.copy(body.translation()); mesh.quaternion.copy(body.rotation()); } },
    dispose() { bindings.length = 0; world.free(); liveWorlds.delete(world); },
  };
  return api;
}
export type PhysicsWorld = Awaited<ReturnType<typeof createPhysicsWorld>>;
