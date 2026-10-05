/* eslint-disable @typescript-eslint/no-explicit-any */
import { InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import type { Scene } from 'three/webgpu';
import * as TSL from 'three/tsl';
const { cos, float, hash, instanceIndex, select, sin, smoothstep, uniform, vec3 } = TSL as any;
import { waterLevel } from '../state';
import { dropletColor, dropletStreak } from '../lib/droplets';
import { glowBlending } from '../lib/blending';
import { SPLASH_SLOTS } from './sim';

const DROPS = 48;
/** Same gravity as the line splash (src/fishing/fx.ts). */
const GRAVITY = 24;
/** Overall splash brightness (tweakable from the School panel). */
export const splashGain = uniform(2.5);

/**
 * Flying-fish splashes, entirely on the GPU: the sim's splash pass writes vec4(x, z, clock, strength) into a ring
 * buffer when a fish breaks the surface (strength < 0, small) or slices back in (strength > 0, bigger). Each slot
 * throws real-sized droplets on ballistic arcs (a crown off the crater rim and a steeper fine spray), drawn as
 * motion-blurred glints (src/lib/droplets.ts); the water's own ripples make the rings. Stale slots collapse to nothing.
 * Vertices are placed from the buffer in positionNode (three applies an InstancedMesh matrix before it).
 */
export function createSplashes(scene: Scene, splashes: any, clock: any) {
  const mat = glowBlending(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: 2 }));
  mat.fog = false;
  {
    const slot = instanceIndex.div(DROPS), d = instanceIndex.mod(DROPS).toFloat();
    const s = splashes.element(slot), str = s.w.abs(), entry = s.w.greaterThan(0);
    const r = (k: number) => hash(slot.toFloat().mul(31.7).add(d.mul(7.3)).add(k));
    // 60% crown (off the rim, 40–70°), 40% spray (steeper, faster, finer). Re-entries splash harder than breaches.
    const crown = d.lessThan(DROPS * 0.6);
    const a = r(1).mul(6.2832), elev = select(crown, r(2).mul(30).add(40), r(2).mul(30).add(58)).mul(Math.PI / 180);
    const speed = select(crown, r(3).mul(1.8).add(1.6), r(3).mul(3.2).add(1.8)).mul(str.sqrt()).mul(select(entry, float(1), float(0.75)));
    const rim = select(crown, r(5).mul(0.04).add(0.05), float(0.01));
    const radius0 = select(crown, r(4).pow(3).mul(0.005).add(0.0025), r(4).pow(3).mul(0.003).add(0.0015));
    const delay = r(6).mul(0.04), age = clock.sub(s.z).sub(delay);
    const vh = cos(elev).mul(speed), vy0 = sin(elev).mul(speed);
    // Still water level, not the exact wave height: evaluating the full ocean per droplet vertex (~9k per frame) cost
    // more than the whole splash is worth, and a few centimetres of launch height are invisible.
    const base = waterLevel;
    const p = vec3(s.x.add(cos(a).mul(rim.add(vh.mul(age)))), base.add(vy0.mul(age)).sub(age.mul(age).mul(GRAVITY / 2)), s.y.add(sin(a).mul(rim.add(vh.mul(age)))));
    const v = vec3(cos(a).mul(vh), vy0.sub(age.mul(GRAVITY)), sin(a).mul(vh));
    const life = age.greaterThan(0).and(age.lessThan(1.2)).and(p.y.greaterThan(base.sub(0.02)));
    const streak = dropletStreak(p, v, select(life, radius0, float(0)));
    mat.positionNode = streak.position;
    mat.colorNode = dropletColor(p, streak.coverage, instanceIndex.toFloat(), smoothstep(0, 0.02, age).mul(splashGain));
  }
  const drops = new InstancedMesh(new PlaneGeometry(1, 1), mat, SPLASH_SLOTS * DROPS);
  drops.name = 'Fish splash droplets'; drops.frustumCulled = false; drops.renderOrder = 7;
  scene.add(drops);
  return { meshes: [drops] };
}
