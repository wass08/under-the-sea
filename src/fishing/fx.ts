import { Color, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial, RingGeometry, Scene, SphereGeometry, Vector3 } from 'three/webgpu';
import type { World } from '../contracts';
import { rand } from './build';

const MAX = 240, GRAVITY = 11, RINGS = 5;

/** Splash droplets (one instanced mesh, CPU ballistic), foam rings on the surface and drips. */
export function createFx(scene: Scene, world: World, onDripHit: (p: Vector3) => void) {
  const mat = new MeshBasicNodeMaterial({ color: new Color(1.5, 1.75, 1.9), transparent: true, opacity: 0.85, depthWrite: false });
  const mesh = new InstancedMesh(new SphereGeometry(1, 6, 4), mat, MAX);
  mesh.frustumCulled = false; mesh.count = MAX; mesh.renderOrder = 3;
  scene.add(mesh);

  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX), size = new Float32Array(MAX), alive = new Uint8Array(MAX);
  const zero = new Matrix4().makeScale(0, 0, 0), m = new Matrix4();
  for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, zero);
  let cursor = 0, active = 0, hitCooldown = 0;
  const tmp = new Vector3();

  function spawn(x: number, y: number, z: number, ax: number, ay: number, az: number, s: number, l: number) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    if (!alive[i]) active++;
    alive[i] = 1; px[i] = x; py[i] = y; pz[i] = z; vx[i] = ax; vy[i] = ay; vz[i] = az; age[i] = 0; life[i] = l; size[i] = s;
  }

  // foam rings
  const ringGeo = new RingGeometry(0.72, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  interface Ring { mesh: Mesh; mat: MeshBasicNodeMaterial; t: number; dur: number; radius: number; peak: number; x: number; z: number }
  const rings: Ring[] = [];
  for (let i = 0; i < RINGS; i++) {
    const rm = new MeshBasicNodeMaterial({ color: new Color(1.6, 1.8, 1.9), transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });
    const rmesh = new Mesh(ringGeo, rm); rmesh.visible = false; rmesh.renderOrder = 2; scene.add(rmesh);
    rings.push({ mesh: rmesh, mat: rm, t: 1, dur: 1, radius: 1, peak: 0.6, x: 0, z: 0 });
  }
  let ringCursor = 0;

  return {
    /** Big lure landing splash. strength ~ 1 */
    splash(p: Vector3, strength = 1, rings = true) {
      const n = Math.floor(28 + 44 * strength);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = (0.25 + Math.random() * 1.1) * (0.6 + 0.6 * strength), up = (2.4 + Math.random() * 3.4) * (0.55 + 0.45 * strength);
        spawn(p.x + Math.cos(a) * 0.05, p.y + 0.02, p.z + Math.sin(a) * 0.05, Math.cos(a) * r, up, Math.sin(a) * r, rand(0.03, 0.07) * (0.7 + 0.4 * strength), rand(0.7, 1.15));
      }
      // crown: a ring of low, fast droplets
      const crown = Math.floor(12 + 8 * strength);
      for (let i = 0; i < crown; i++) {
        const a = (i / crown) * Math.PI * 2 + Math.random() * 0.2, r = (1.4 + Math.random() * 0.6) * (0.6 + 0.5 * strength);
        spawn(p.x + Math.cos(a) * 0.12, p.y + 0.03, p.z + Math.sin(a) * 0.12, Math.cos(a) * r, 1.6 + Math.random() * 1.4, Math.sin(a) * r, rand(0.025, 0.05), rand(0.5, 0.8));
      }
      if (rings) { this.ring(p, 0.9 + 0.7 * strength, 1.1, 0.75); this.ring(p, 0.5 + 0.4 * strength, 0.7, 0.9); }
    },
    /** Smaller splash (fish leaving / entering the water). */
    smallSplash(p: Vector3) { this.splash(p, 0.42); },
    /** A single falling drip. */
    drip(p: Vector3) { spawn(p.x + rand(-0.03, 0.03), p.y, p.z + rand(-0.03, 0.03), rand(-0.1, 0.1), rand(-0.3, 0.2), rand(-0.1, 0.1), rand(0.014, 0.026), 2); },
    ring(p: Vector3, radius: number, dur = 1, peak = 0.6) {
      const r = rings[ringCursor]; ringCursor = (ringCursor + 1) % RINGS;
      r.t = 0; r.dur = dur; r.radius = radius; r.peak = peak; r.x = p.x; r.z = p.z; r.mesh.visible = true;
    },
    update(dt: number) {
      hitCooldown -= dt;
      if (active > 0) {
        for (let i = 0; i < MAX; i++) {
          if (!alive[i]) continue;
          age[i] += dt; vy[i] -= GRAVITY * dt;
          px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
          const h = world.heightAt(px[i], pz[i]);
          const dead = age[i] >= life[i] || (vy[i] < 0 && py[i] < h);
          if (dead) {
            if (vy[i] < 0 && py[i] < h && hitCooldown <= 0 && size[i] > 0.012 && age[i] > 0.1) { hitCooldown = 0.09; onDripHit(tmp.set(px[i], h, pz[i])); }
            alive[i] = 0; active--; mesh.setMatrixAt(i, zero); continue;
          }
          const k = age[i] / life[i], s = size[i] * (1 - k * k * k);
          m.makeScale(s, s * (1 + Math.min(Math.abs(vy[i]) * 0.12, 1.2)), s).setPosition(px[i], py[i], pz[i]);
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      for (const r of rings) {
        if (r.t >= 1) continue;
        r.t += dt / r.dur;
        if (r.t >= 1) { r.mesh.visible = false; r.mat.opacity = 0; continue; }
        const e = 1 - Math.pow(1 - r.t, 2.2);
        const s = 0.12 + r.radius * e;
        r.mesh.scale.set(s, 1, s);
        r.mesh.position.set(r.x, world.heightAt(r.x, r.z) + 0.045, r.z);
        r.mat.opacity = r.peak * Math.pow(1 - r.t, 1.6) * Math.min(1, r.t * 12);
      }
    },
  };
}
export type Fx = ReturnType<typeof createFx>;
