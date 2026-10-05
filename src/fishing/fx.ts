import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry, Scene, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, instanceIndex, instancedBufferAttribute } from 'three/tsl';
import type { World } from '../contracts';
import { rand } from './build';
import { WORLD } from '../config';
import { dropletColor, dropletStreak } from '../lib/droplets';
import { glowBlending } from '../lib/blending';

const MAX = 2400;
/** World units: 1 unit ≈ 25 cm. Gravity is a little gentler than real (39 u/s²), matching the stylised swell. */
const GRAVITY = 24;

/**
 * Splash spray for the line and lure: real-sized droplets on CPU ballistics with size-dependent air drag, drawn as
 * motion-blurred glints (src/lib/droplets.ts). The water's own dispersive ripples (src/lib/ocean.ts) provide the rings;
 * there are no flat ring / disc / crown-sheet sprites any more. A splash has three parts:
 *  - crown: drops torn off the rim of the crater, thrown outward at 40–70°;
 *  - spray: fine mist from the impact, steep and fast;
 *  - jet: for strong impacts, a few heavier drops shot straight up as the crater collapses (~0.15 s later).
 */
export function createFx(scene: Scene, world: World, onDripHit: (p: Vector3) => void) {
  const P = new Float32Array(MAX * 4), V = new Float32Array(MAX * 4);
  const pAttr = new InstancedBufferAttribute(P, 4), vAttr = new InstancedBufferAttribute(V, 4);
  pAttr.setUsage(DynamicDrawUsage); vAttr.setUsage(DynamicDrawUsage);
  const aP = instancedBufferAttribute(pAttr, 'vec4') as unknown as Node<'vec4'>, aV = instancedBufferAttribute(vAttr, 'vec4') as unknown as Node<'vec4'>;
  const mat = glowBlending(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: 2 }));
  mat.fog = false;
  const streak = dropletStreak(aP.xyz, aV.xyz, aP.w);
  mat.positionNode = streak.position;
  mat.colorNode = dropletColor(aP.xyz, streak.coverage, float(instanceIndex), aV.w);
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, MAX);
  mesh.name = 'Splash droplets'; mesh.frustumCulled = false; mesh.renderOrder = 7;
  scene.add(mesh);
  if (new URLSearchParams(location.search).get('off')?.split(',').includes('splash')) mesh.visible = false;

  const age = new Float32Array(MAX), radius = new Float32Array(MAX), alive = new Uint8Array(MAX);
  let cursor = 0, active = 0, hitCooldown = 0;
  const tmp = new Vector3();

  /** delay: seconds before the drop appears (the jet rises after the crater collapses). */
  function spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, delay = 0) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    if (!alive[i]) active++;
    alive[i] = 1; age[i] = -delay; radius[i] = r;
    P.set([x, y, z, 0], i * 4); V.set([vx, vy, vz, 0], i * 4);
  }
  /** Mostly tiny drops, a few big ones (a steep power law, as in real splash spectra). */
  const dropRadius = (min: number, max: number) => min + Math.pow(Math.random(), 3) * (max - min);

  return {
    /** Impact splash (lure landing, fish breaking the surface). strength ~ 1 for a cast; `foam` is kept for callers. */
    splash(p: Vector3, strength = 1, _foam = true) {
      const s = Math.sqrt(strength);
      const crown = Math.floor(40 + 110 * strength);
      for (let i = 0; i < crown; i++) {
        const a = (i / crown) * Math.PI * 2 + Math.random() * 0.3, rim = (0.06 + Math.random() * 0.06) * (0.6 + 0.4 * s);
        const elev = (40 + Math.random() * 30) * Math.PI / 180, speed = (2.0 + Math.random() * 2.4) * s;
        spawn(p.x + Math.cos(a) * rim, p.y + 0.01, p.z + Math.sin(a) * rim,
          Math.cos(a) * Math.cos(elev) * speed, Math.sin(elev) * speed, Math.sin(a) * Math.cos(elev) * speed, dropRadius(0.0025, 0.007), Math.random() * 0.04);
      }
      const spray = Math.floor(30 + 170 * strength);
      for (let i = 0; i < spray; i++) {
        const a = Math.random() * Math.PI * 2, elev = (55 + Math.random() * 33) * Math.PI / 180, speed = (2.0 + Math.random() * 5.0) * s;
        spawn(p.x + (Math.random() - 0.5) * 0.06, p.y + 0.01, p.z + (Math.random() - 0.5) * 0.06,
          Math.cos(a) * Math.cos(elev) * speed, Math.sin(elev) * speed, Math.sin(a) * Math.cos(elev) * speed, dropRadius(0.0015, 0.005), Math.random() * 0.05);
      }
      if (strength > 0.6) {
        const jet = 5 + Math.floor(Math.random() * 5);
        for (let i = 0; i < jet; i++) {
          spawn(p.x + (Math.random() - 0.5) * 0.02, p.y, p.z + (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.4, (3.2 + i * 0.35 + Math.random() * 0.4) * s,
            (Math.random() - 0.5) * 0.4, dropRadius(0.005, 0.01), 0.13 + i * 0.012);
        }
      }
    },
    /** Smaller splash (fish leaving / entering the water). */
    smallSplash(p: Vector3) { this.splash(p, 0.4); },
    /** A single falling drip (from the lure while it is lifted / reeled). */
    drip(p: Vector3) { spawn(p.x + rand(-0.02, 0.02), p.y, p.z + rand(-0.02, 0.02), rand(-0.08, 0.08), rand(-0.2, 0.1), rand(-0.08, 0.08), dropRadius(0.003, 0.006)); },
    update(dt: number) {
      hitCooldown -= dt;
      if (active <= 0) return;
      for (let i = 0; i < MAX; i++) {
        if (!alive[i]) continue;
        const o = i * 4;
        age[i] += dt;
        if (age[i] < 0) { P[o + 3] = 0; continue; }
        // Air drag grows as drops shrink (Stokes-like): mist slows and drifts, heavy drops fly ballistic.
        const drag = Math.exp(-dt * 0.012 / radius[i]);
        V[o] *= drag; V[o + 2] *= drag; V[o + 1] = V[o + 1] * drag - GRAVITY * dt;
        P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
        // The exact wave height (CPU mirror, swell + ripples) is only needed close to the water.
        const h = V[o + 1] < 0 && P[o + 1] < WORLD.surface + 0.6 ? world.heightAt(P[o], P[o + 2]) : -Infinity;
        if ((V[o + 1] < 0 && P[o + 1] < h) || age[i] > 3) {
          if (age[i] < 3 && radius[i] > 0.004 && hitCooldown <= 0) { hitCooldown = 0.07; onDripHit(tmp.set(P[o], h, P[o + 2])); }
          alive[i] = 0; active--; P[o + 3] = 0; continue;
        }
        P[o + 3] = radius[i];
        V[o + 3] = Math.min(1, age[i] * 40); // pop in over the first frames
      }
      pAttr.needsUpdate = true; vAttr.needsUpdate = true;
    },
  };
}
export type Fx = ReturnType<typeof createFx>;
