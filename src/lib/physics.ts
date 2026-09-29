import { createBurstProbe } from '../../verify/burst-metrics';
import { perf, timed } from '../../verify/four-wall-metrics';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type BufferGeometry, type Mesh } from 'three/webgpu';
export type PhysicsProfile = 'legacy' | 'economy' | 'launch';
const burstMode = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('burst');
const requestedProfile = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('physics');
export const physicsProfile: PhysicsProfile = requestedProfile === 'legacy' ? 'legacy' : requestedProfile === 'economy' ? 'economy' : 'launch';
type Vec3 = { x: number; y: number; z: number };
/** Shared WASM initialization. Await once before creating any physics world. */
export const physicsReady = RAPIER.init();
const liveWorlds = new Set<RAPIER.World>();
/** Actual live WASM allocations, exposed read-only to runtime verification. */
export function physicsDiagnostics() {
  return { worlds: liveWorlds.size, bodies: [...liveWorlds].reduce((n, w) => n + w.bodies.len(), 0), colliders: [...liveWorlds].reduce((n, w) => n + w.colliders.len(), 0) };
}
/** Independent fixed-step Rapier world, owning its bodies, colliders and mesh bindings. */
export async function createPhysicsWorld(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }, glassSettling = false) {
  await physicsReady;
  const world = new RAPIER.World(gravity), bindings: { mesh: Mesh; body: RAPIER.RigidBody; settle: boolean; born: number; quiet: number; still: number; grounded: boolean; restingDrag: boolean; quietDamping?: [number, number] | null; syncedStill: boolean; separated: boolean; extraIterations: number; previousPosition?: Vector3; previousRotation?: Quaternion }[] = [];
  // Conditioned contact solver shared by aquarium and Lab shard releases.
  if (glassSettling) {
    world.numSolverIterations = 12; world.numInternalPgsIterations = 4; world.maxCcdSubsteps = 2;
    // Use a scene-scale native sleep tolerance for the large panes.
    // Compensate normalized contact tolerances so actual gaps remain 0.0002 / 0.004.
    world.integrationParameters.lengthUnit = 4;
    world.integrationParameters.normalizedAllowedLinearError = 0.00005;
    world.integrationParameters.normalizedPredictionDistance = 0.001;
    // Zero selects rigid contacts (ERP/CFM = 0): no compliant spring creep in thin piles.
    // CCD, separated spawn hulls and the contact skin prevent penetration at impact.
    world.integrationParameters.contact_natural_frequency = 0;
  }
  const supported = new Set<number>(), supportSurfaces = new Set<number>();
  liveWorlds.add(world); if (perf) world.profilerEnabled = true;
  // Conditioned glass runs at 60 Hz; generic library worlds retain 120 Hz.
  const currentPosition = new Vector3(), currentRotation = new Quaternion();
  const fixedDt = glassSettling ? 1 / 60 : 1 / 120; let accumulator = 0, ticks = 0;
  const burstProbe = createBurstProbe(world);
  const api = {
    supportDamping: null as [number, number] | null,
    quietDamping: null as [number, number] | null,
    // Fidelity belongs to every release; collision grace remains a separate opt-in.
    burstProbe, world, profile: physicsProfile, separateLaunch: false, fullLaunch: !burstMode?.startsWith('before'), individualCells: false, timeScale: 1, frozen: false, elapsed: 0, frame: 0, lastSteps: 0, totalSteps: 0, releaseTick: -Infinity, impulses: [] as number[],
    /** Mesh must be in world space with unit scale; geometry coordinates are local. */
    addShard(mesh: Mesh, geometry: BufferGeometry | BufferGeometry[], mass: number, settle = false) {
      // Parts share the mesh's local coordinate frame; never hull across the gaps between cells.
      const parts = Array.isArray(geometry) ? geometry : [geometry];
      const weights = parts.map(g => {
        const p = g.getAttribute('position'); if (!glassSettling) return p.count;
        let volume = 0;
        for (let i = 0; i < p.count; i += 3) { const a = i, b = i + 1, c = i + 2; volume += p.getX(a) * (p.getY(b)*p.getZ(c)-p.getZ(b)*p.getY(c)) + p.getY(a)*(p.getZ(b)*p.getX(c)-p.getX(b)*p.getZ(c)) + p.getZ(a)*(p.getX(b)*p.getY(c)-p.getY(b)*p.getX(c)); }
        return Math.max(1e-10, Math.abs(volume) / 6);
      });
      const total = weights.reduce((a, b) => a + b, 0);
      const colliders = parts.map((part, partIndex) => {
        const position = part.getAttribute('position'), vertices = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) vertices.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
        const margin = settle && glassSettling ? Number(part.userData.contactSkin ?? 0.003) : 0;
        // High contact friction prevents supported thin compounds from creeping against each other.
        const collider = RAPIER.ColliderDesc.convexHull(vertices);
        if (!collider) throw new Error('Shard is not a valid convex hull');
        // During separation, shards still hit the floor and surviving panes.
        // Restore mutual contacts after 0.2 s (small) / 0.4 s (crowded),
        // before plates overlap on the floor; keeping the grace until 0.6 s left jitter.
        if (api.separateLaunch && api.profile === 'launch') collider.setCollisionGroups(((settle ? 2 : 1) << 16) | (settle ? 1 : 0xffff));
        return collider.setMass(mass * weights[partIndex] / total).setFriction(glassSettling ? 1.2 : 0.65).setRestitution(settle && glassSettling ? 0 : settle ? 0.03 : 0.12).setContactSkin(settle ? (glassSettling ? margin : 0.0005) : 0);
      });
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation(mesh.quaternion).setCcdEnabled(true).setCanSleep(true).setLinearDamping(settle && glassSettling ? 0.45 : 0.18).setAngularDamping(settle && glassSettling ? 1.2 : 0.25));
      for (const collider of colliders) world.createCollider(collider, body);
      if (glassSettling) {
        body.recomputeMassPropertiesFromColliders();
        if (settle) {
          // Condition slivers' axial inertia to at most 4:1 anisotropy; retain density-derived mass.
          const inertia = body.principalInertia(), floor = Math.max(mass * 0.0025, Math.max(inertia.x, inertia.y, inertia.z) / 4);
          const extra = { x: Math.max(0, floor - inertia.x), y: Math.max(0, floor - inertia.y), z: Math.max(0, floor - inertia.z) };
          body.setAdditionalMassProperties(0, body.localCom(), extra, body.principalInertiaLocalFrame(), false);
          body.recomputeMassPropertiesFromColliders();
        }
      }
      bindings.push({ mesh, body, settle, born: ticks, quiet: 0, still: 0, grounded: false, restingDrag: false, syncedStill: false, separated: api.separateLaunch && api.profile === 'launch' && settle, extraIterations: 0, previousPosition: glassSettling && settle ? mesh.position.clone() : undefined, previousRotation: glassSettling && settle ? mesh.quaternion.clone() : undefined }); return body;
    },
    /** Create a fixed box with full dimensions, centred at position. */
    addStaticBox(position: Vec3, size: Vec3, support = position.y <= 0.08) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
      // Callers can mark raised plinths explicitly; the default is evaluated before f32 rounding.
      if (support) supportSurfaces.add(body.handle);
      world.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(glassSettling ? 1.2 : 0.7).setCollisionGroups(api.separateLaunch && api.profile === 'launch' ? 0x1ffff : 0xffffffff), body); return body;
    },
    removeBody(body: RAPIER.RigidBody) {
      const index = bindings.findIndex(b => b.body === body);
      if (index >= 0) bindings.splice(index, 1);
      supported.delete(body.handle); supportSurfaces.delete(body.handle); world.removeRigidBody(body);
    },
    applyImpulse(body: RAPIER.RigidBody, impulse: Vec3, point?: Vec3) { if (perf) api.impulses.push(api.frame); if (point) body.applyImpulseAtPoint(impulse, point, true); else body.applyImpulse(impulse, true); },
    // Release starts on a solver boundary, independent of render-frame/idle phase.
    beginRelease() { accumulator = 0; api.releaseTick = ticks; },
    step(dt: number) {
      api.frame++; api.lastSteps = 0;
      if (api.frozen) return;
      accumulator += Math.min(Math.max(dt, 0), 0.1) * api.timeScale;
      // Give a fresh burst 0.8 simulated seconds of bounded three-tick catch-up.
      // Then cap crowded piles at one tick; discard overdue ticks, never defer debt.
      const crowded = glassSettling && world.colliders.len() > 512, launching = glassSettling && (api.separateLaunch || api.fullLaunch) && api.profile === 'launch' && ticks - api.releaseTick < 48;
      const maxSteps = api.profile === 'legacy' ? Infinity : launching ? 3 : crowded ? 1 : 2;
      let steps = 0;
      while (accumulator + 1e-10 >= fixedDt && steps++ < maxSteps && (!burstProbe || api.elapsed-burstProbe.start<burstProbe.stopAt-1e-8)) {
        if (glassSettling) {
          // Select on integer solver ticks, never render frames: chunking stays deterministic.
          const fidelity = api.profile === 'legacy' ? 1 : (api.separateLaunch || api.fullLaunch) && api.profile === 'launch' ? Math.max(0, Math.min(1, (48 - (ticks-api.releaseTick)) / 12)) : 0;
          world.numSolverIterations = crowded ? (api.profile === 'legacy' ? 48 : 4) : 12;
          world.numInternalPgsIterations = crowded ? Math.round(1 + 11*fidelity) : 4;
          world.integrationParameters.lengthUnit = crowded ? 6 : 4;
        }
        for (const binding of bindings) {
          const age = ticks - binding.born;
          if (binding.separated && age >= (crowded ? 24 : 12)) { for (let i=0;i<binding.body.numColliders();i++) binding.body.collider(i).setCollisionGroups(0x2ffff); binding.separated=false; }
          // Rapier propagates these extra iterations through the body's contact island.
          // Old settled piles keep the economical budget while fresh glass gets 48.
          const extra = api.releaseTick > -Infinity && crowded && (api.separateLaunch || api.fullLaunch) && api.profile === 'launch' && binding.settle ? Math.round(44*Math.max(0,Math.min(1,(48-age)/12))) : 0;
          if (extra !== binding.extraIterations) { binding.body.setAdditionalSolverIterations(extra); binding.extraIterations=extra; }
          binding.previousPosition?.copy(binding.body.translation()); binding.previousRotation?.copy(binding.body.rotation());
        }
        burstProbe?.before(api.elapsed, bindings);
        api.lastSteps++; api.totalSteps++; world.timestep = fixedDt; const start = perf ? performance.now() : 0; world.step(); if (perf) { perf.rapier += performance.now() - start; perf.steps++; perf.collision += world.timingCollisionDetection(); perf.solver += world.timingSolver(); perf.ccd += world.timingCcd(); } accumulator = Math.max(0, accumulator - fixedDt); api.elapsed = ++ticks * fixedDt;
        burstProbe?.after(api.elapsed);
        for (const binding of bindings) {
          const { body } = binding;
          if (!binding.settle || !body.isDynamic()) continue;
          const age = (ticks - binding.born) * fixedDt;
          if (age > 1 && body.isCcdEnabled()) body.enableCcd(false);
          // Preserve the legacy optional settling mode for callers outside the aquarium.
          if (!glassSettling && age >= 6) { body.setBodyType(RAPIER.RigidBodyType.Fixed, false); continue; }
          if (!binding.grounded) for (let i = 0; i < body.numColliders(); i++) {
            world.contactPairsWith(body.collider(i), other => {
              const parent = other.parent();
              if (!parent) return;
              let support = parent.isFixed() ? (glassSettling ? supportSurfaces.has(parent.handle) : parent.translation().y <= 0.08) : false;
              if (!support && glassSettling && supported.has(parent.handle)) {
                const v = parent.linvel(), w = parent.angvel();
                support = Math.hypot(v.x, v.y, v.z) < 0.15 && Math.hypot(w.x, w.y, w.z) < 0.3;
              }
              // A side scrape and a still-falling neighbour are not support contacts.
              if (support) world.contactPair(body.collider(i), other, (manifold, flipped) => {
                if (manifold.numSolverContacts() && manifold.normal().y * (flipped ? 1 : -1) > 0.5) binding.grounded = true;
              });
            });
            if (binding.grounded) {
              supported.add(body.handle);
              // Independent cells damp supported slide/tumble; airborne drag stays unchanged.
              body.setLinearDamping(api.supportDamping?.[0] ?? (glassSettling ? (api.individualCells ? 6 : 3) : 2.5)); body.setAngularDamping(api.supportDamping?.[1] ?? (glassSettling ? (api.individualCells ? 5 : 1) : 5)); break;
            }
          }
          const v = body.linvel(), w = body.angvel();
          binding.quiet = Math.hypot(v.x, v.y, v.z) < (glassSettling ? 0.3 : 0.03) && Math.hypot(w.x, w.y, w.z) < (glassSettling ? 1.5 : 0.2) ? binding.quiet + fixedDt : 0;
          // Static contact friction dissipates the last low-energy rocking motion.
          // Increase drag only after a supported body is already slow; leave sleep to Rapier.
          if (glassSettling && binding.grounded && binding.quiet > 0.1 && (!binding.restingDrag || binding.quietDamping !== api.quietDamping)) {
            body.setLinearDamping(api.quietDamping?.[0] ?? 8); body.setAngularDamping(api.quietDamping?.[1] ?? 20); binding.restingDrag = true; binding.quietDamping = api.quietDamping;
          }
          if (!glassSettling && binding.quiet >= 0.6) body.sleep();
          binding.still = Math.hypot(v.x, v.y, v.z) < 0.0001 && Math.hypot(w.x, w.y, w.z) < 0.0001 ? binding.still + fixedDt : 0;
          // Last resort only: never arrest a body that is genuinely still moving.
          if (glassSettling && !body.isSleeping() && age > 30 && binding.still > 2) body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
        }
      }
      burstProbe?.frame(api.elapsed, api.lastSteps);
      if (burstProbe && api.elapsed-burstProbe.start>=burstProbe.stopAt-1e-8) api.frozen=true;
      if (api.profile !== 'legacy' && accumulator + 1e-10 >= fixedDt) accumulator = Math.max(0, accumulator % fixedDt);
    },
    sync() {
      // A diagnostic still uses the exact requested solver pose, without frame-phase interpolation.
      const alpha = burstProbe && api.frozen && Number.isFinite(burstProbe.stopAt) ? 1 : accumulator / fixedDt;
      for (const binding of bindings) {
        const { mesh, body, previousPosition, previousRotation } = binding;
        const still = api.profile !== 'legacy' && (!body.isDynamic() || body.isSleeping());
        if (still && binding.syncedStill) continue;
        binding.syncedStill = still;
        if (still) { mesh.position.copy(body.translation()); mesh.quaternion.copy(body.rotation()); previousPosition?.copy(mesh.position); previousRotation?.copy(mesh.quaternion); continue; }
        // Interpolate presentation, not the solver, including the sparse steps at 0.15×.
        if (previousPosition && previousRotation) {
          mesh.position.lerpVectors(previousPosition, currentPosition.copy(body.translation()), alpha);
          mesh.quaternion.slerpQuaternions(previousRotation, currentRotation.copy(body.rotation()), alpha);
        } else { mesh.position.copy(body.translation()); mesh.quaternion.copy(body.rotation()); }
      }
    },
    dispose() { bindings.length = 0; supported.clear(); supportSurfaces.clear(); world.free(); liveWorlds.delete(world); },
  };
  api.step = timed('physics', api.step); api.sync = timed('sync', api.sync);
  return api;
}
export type PhysicsWorld = Awaited<ReturnType<typeof createPhysicsWorld>>;
