import { AdditiveBlending, CircleGeometry, Color, CylinderGeometry, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial, Quaternion, RingGeometry, Scene, SphereGeometry, Vector3 } from 'three/webgpu';
import type { BufferGeometry } from 'three/webgpu';
import type { World } from '../contracts';
import { RIG_SCALE, rand } from './build';

/** FX scale relative to the original 1.35 rig. */
const K = RIG_SCALE / 1.35;

const MAX = 700, GRAVITY = 11, RINGS = 5, DISCS = 4, CROWNS = 3;
const UP = new Vector3(0, 1, 0);

/**
 * Water FX: motion-stretched additive droplets (one instanced mesh, CPU ballistic), an expanding crown sheet,
 * a short-lived foam disc, foam rings and drips that make mini ripples when they land.
 */
export function createFx(scene: Scene, world: World, onDripHit: (p: Vector3) => void) {
  const mat = new MeshBasicNodeMaterial({ color: new Color(1.1, 1.35, 1.5), transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending });
  const mesh = new InstancedMesh(new SphereGeometry(1, 6, 4), mat, MAX);
  mesh.frustumCulled = false; mesh.count = MAX; mesh.renderOrder = 3;
  scene.add(mesh);

  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX), size = new Float32Array(MAX), alive = new Uint8Array(MAX);
  const zero = new Matrix4().makeScale(0, 0, 0), m = new Matrix4(), q = new Quaternion(), dir = new Vector3(), sc = new Vector3(), pos = new Vector3();
  for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, zero);
  let cursor = 0, active = 0, hitCooldown = 0;
  const tmp = new Vector3();

  function spawn(x: number, y: number, z: number, ax: number, ay: number, az: number, s: number, l: number) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    if (!alive[i]) active++;
    alive[i] = 1; px[i] = x; py[i] = y; pz[i] = z; vx[i] = ax * K; vy[i] = ay * Math.sqrt(K); vz[i] = az * K; age[i] = 0; life[i] = l * Math.sqrt(K); size[i] = s * K;
  }

  const glowMat = () => new MeshBasicNodeMaterial({ color: new Color(1.2, 1.5, 1.65), transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
  interface Fade { mesh: Mesh; mat: MeshBasicNodeMaterial; t: number; dur: number; radius: number; peak: number; x: number; y: number; z: number }
  const mkPool = (n: number, geo: BufferGeometry, order: number): Fade[] => Array.from({ length: n }, () => {
    const mm = glowMat(), mesh2 = new Mesh(geo, mm); mesh2.visible = false; mesh2.renderOrder = order; mesh2.frustumCulled = false; scene.add(mesh2);
    return { mesh: mesh2, mat: mm, t: 1, dur: 1, radius: 1, peak: 0.6, x: 0, y: 0, z: 0 };
  });
  const ringGeo = new RingGeometry(0.72, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  const rings = mkPool(RINGS, ringGeo, 2);
  const discGeo = new CircleGeometry(1, 32); discGeo.rotateX(-Math.PI / 2);
  const discs = mkPool(DISCS, discGeo, 2);
  const crownGeo = new CylinderGeometry(1, 0.55, 1, 28, 1, true); crownGeo.translate(0, 0.5, 0);
  const crowns = mkPool(CROWNS, crownGeo, 3);
  const cursors = { ring: 0, disc: 0, crown: 0 };
  const start = (pool: Fade[], key: 'ring' | 'disc' | 'crown', p: Vector3, radius: number, dur: number, peak: number) => {
    const r = pool[cursors[key]]; cursors[key] = (cursors[key] + 1) % pool.length;
    r.t = 0; r.dur = dur; r.radius = radius * K; r.peak = peak; r.x = p.x; r.z = p.z; r.y = p.y; r.mesh.visible = true;
  };

  return {
    /** Lure landing splash: crown sheet + stretched spray + foam disc + slow secondary drops. strength ~ 1 */
    splash(p: Vector3, strength = 1, foam = true) {
      const s = 0.6 + 0.5 * strength;
      const n = Math.floor(50 + 90 * strength);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = (0.3 + Math.random() * 1.6) * s, up = (2.6 + Math.random() * 4.2) * (0.5 + 0.5 * strength);
        spawn(p.x + Math.cos(a) * 0.06, p.y + 0.02, p.z + Math.sin(a) * 0.06, Math.cos(a) * r, up, Math.sin(a) * r, rand(0.011, 0.03) * (0.7 + 0.5 * strength), rand(0.5, 1.0));
      }
      const crown = Math.floor(22 + 14 * strength);
      for (let i = 0; i < crown; i++) {
        const a = (i / crown) * Math.PI * 2 + Math.random() * 0.15, r = (1.5 + Math.random() * 0.7) * s;
        spawn(p.x + Math.cos(a) * 0.1, p.y + 0.03, p.z + Math.sin(a) * 0.1, Math.cos(a) * r, 2.2 + Math.random() * 1.6, Math.sin(a) * r, rand(0.012, 0.024), rand(0.45, 0.75));
      }
      const drips = Math.floor(8 + 10 * strength);
      for (let i = 0; i < drips; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.7 * s;
        spawn(p.x, p.y + 0.05, p.z, Math.cos(a) * r, 3.5 + Math.random() * 3, Math.sin(a) * r, rand(0.016, 0.028), rand(1.0, 1.6));
      }
      if (foam) {
        start(crowns, 'crown', p, 0.55 * s, 0.55, 0.28);
        start(discs, 'disc', p, 0.9 * s, 0.7, 0.5);
        start(rings, 'ring', p, 1.5 * s, 1.1, 0.6);
        start(rings, 'ring', p, 0.8 * s, 0.75, 0.7);
      }
    },
    /** Smaller splash (fish leaving / entering the water). */
    smallSplash(p: Vector3) { this.splash(p, 0.4); },
    /** A single falling drip. */
    drip(p: Vector3) { spawn(p.x + rand(-0.03, 0.03), p.y, p.z + rand(-0.03, 0.03), rand(-0.1, 0.1), rand(-0.3, 0.2), rand(-0.1, 0.1), rand(0.014, 0.026), 2); },
    ring(p: Vector3, radius: number, dur = 1, peak = 0.6) { start(rings, 'ring', p, radius, dur, peak); },
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
            if (vy[i] < 0 && py[i] < h && hitCooldown <= 0 && size[i] > 0.014 && age[i] > 0.15) { hitCooldown = 0.07; onDripHit(tmp.set(px[i], h, pz[i])); }
            alive[i] = 0; active--; mesh.setMatrixAt(i, zero); continue;
          }
          const k = age[i] / life[i], sz = size[i] * (1 - k * k * k);
          dir.set(vx[i], vy[i], vz[i]);
          const speed = dir.length();
          if (speed > 1e-4) q.setFromUnitVectors(UP, dir.multiplyScalar(1 / speed)); else q.identity();
          sc.set(sz, sz * (1 + Math.min(speed * 0.9, 6)), sz);
          m.compose(pos.set(px[i], py[i], pz[i]), q, sc);
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      const fade = (r: Fade, apply: (e: number, o: number) => void) => {
        if (r.t >= 1) return;
        r.t += dt / r.dur;
        if (r.t >= 1) { r.mesh.visible = false; r.mat.opacity = 0; return; }
        apply(1 - Math.pow(1 - r.t, 2.2), Math.pow(1 - r.t, 1.6));
      };
      for (const r of rings) fade(r, (e, o) => { const s = 0.12 + r.radius * e; r.mesh.scale.set(s, 1, s); r.mesh.position.set(r.x, world.heightAt(r.x, r.z) + 0.045, r.z); r.mat.opacity = r.peak * o * Math.min(1, r.t * 12); });
      for (const r of discs) fade(r, (e, o) => { const s = 0.1 + r.radius * e; r.mesh.scale.set(s, 1, s); r.mesh.position.set(r.x, world.heightAt(r.x, r.z) + 0.04, r.z); r.mat.opacity = r.peak * o * o * Math.min(1, r.t * 20); });
      for (const r of crowns) fade(r, (e, o) => {
        const s = 0.15 + r.radius * e, hgt = r.radius * 1.3 * Math.sin(Math.min(1, r.t * 1.6) * Math.PI * 0.8) * (1 - r.t * 0.4);
        r.mesh.scale.set(s, Math.max(hgt, 0.001), s); r.mesh.position.set(r.x, world.heightAt(r.x, r.z), r.z); r.mat.opacity = r.peak * o * Math.min(1, r.t * 10);
      });
    },
  };
}
export type Fx = ReturnType<typeof createFx>;
