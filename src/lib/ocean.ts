import { Vector4 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, uniform, sin, cos, vec2 } from 'three/tsl';
import { simTime } from '../state';

/**
 * Diorama water surface. A sum of peaked sine waves plus ripple rings, defined once
 * and evaluated identically on the GPU (TSL, with analytic gradient for normals)
 * and on the CPU (heightAt/normalAt for the boat). There is no horizontal
 * displacement, so the CPU mirror is exact and the border of the cube stays watertight.
 * One world unit is about 25 cm.
 */
/** [direction angle, wavelength, amplitude, peak sharpness] */
export const OCEAN_WAVES: readonly (readonly [number, number, number, number])[] = [
  [0.35, 4.6, 0.055, 1.5], [1.10, 2.9, 0.038, 1.6], [-0.42, 2.0, 0.026, 1.7],
  [2.20, 1.35, 0.015, 1.8], [-1.30, 0.9, 0.009, 1.9], [0.80, 0.6, 0.0045, 2.0],
];
export const OCEAN_GRAVITY = 9;
export const oceanAmplitude = uniform(1);
export const oceanParams = { amplitude: 1 };

export const RIPPLE = { slots: 12, speed: 1.55, wavelength: 0.5, width: 5.5, decay: 0.62, amplitude: 0.08, spread: 2.0 } as const;
/** xy = position, z = start time (sim seconds), w = strength. */
export const rippleUniforms = Array.from({ length: RIPPLE.slots }, () => uniform(new Vector4(0, 0, -1000, 0)));
const rippleState = Array.from({ length: RIPPLE.slots }, () => ({ x: 0, z: 0, t: -1000, s: 0 }));
let rippleIndex = 0, ambientIndex = 0;
/** Slots 0..7 serve gameplay ripples (lure, boat); 8..11 are reserved for ambient ones (bubbles). */
export function emitRipple(x: number, z: number, strength: number, ambient = false) {
  const slot = ambient ? 8 + (ambientIndex++ % 4) : rippleIndex++ % 8, t = simTime.value;
  rippleState[slot] = { x, z, t, s: strength };
  rippleUniforms[slot].value.set(x, z, t, strength);
}

const mean = (p: number) => { let s = 0; const n = 512; for (let i = 0; i < n; i++) s += Math.pow(0.5 + 0.5 * Math.sin(i / n * Math.PI * 2), p); return s / n; };
const WAVE_DATA = OCEAN_WAVES.map(([angle, length, a, p]) => {
  const k = Math.PI * 2 / length;
  return { dx: Math.cos(angle), dz: Math.sin(angle), k, w: Math.sqrt(OCEAN_GRAVITY * k), a: a * 2, p, mean: mean(p) };
});

/** GPU field: height offset and its gradient at an undisplaced xz. */
export function oceanField(xz: Node<'vec2'>, t: Node<'float'>) {
  let h: Node<'float'> = float(0), gx: Node<'float'> = float(0), gz: Node<'float'> = float(0);
  for (const { dx, dz, k, w, a, p, mean: m } of WAVE_DATA) {
    const phase = xz.x.mul(dx * k).add(xz.y.mul(dz * k)).sub(t.mul(w));
    const s = sin(phase).mul(0.5).add(0.5).max(0), sp = s.pow(p - 1);
    const amp = oceanAmplitude.mul(a);
    h = h.add(sp.mul(s).sub(m).mul(amp));
    const slope = cos(phase).mul(0.5).mul(p).mul(sp).mul(amp).mul(k);
    gx = gx.add(slope.mul(dx)); gz = gz.add(slope.mul(dz));
  }
  for (const r of rippleUniforms) {
    const age = t.sub(r.z).max(0), d = xz.sub(r.xy), dist = d.dot(d).add(1e-5).sqrt();
    const ring = dist.sub(age.mul(RIPPLE.speed)), kr = Math.PI * 2 / RIPPLE.wavelength;
    const env = ring.mul(ring).mul(-RIPPLE.width).exp();
    const amp = r.w.mul(RIPPLE.amplitude).mul(age.mul(-RIPPLE.decay).exp()).mul(dist.mul(RIPPLE.spread).add(1).sqrt().reciprocal()).mul(oceanAmplitude.max(0.4));
    const arg = ring.mul(kr);
    h = h.add(sin(arg).mul(env).mul(amp));
    const dring = cos(arg).mul(kr).mul(env).sub(sin(arg).mul(env).mul(ring).mul(2 * RIPPLE.width)).mul(amp);
    const dr = dring.div(dist);
    gx = gx.add(d.x.mul(dr)); gz = gz.add(d.y.mul(dr));
  }
  return { h, gx, gz };
}

/** CPU mirror of oceanField. Returns height offset; writes gradient into out when given. */
export function oceanHeightCpu(x: number, z: number, t: number, out?: { gx: number; gz: number }) {
  let h = 0, gx = 0, gz = 0;
  const A = oceanParams.amplitude;
  for (const { dx, dz, k, w, a, p, mean: m } of WAVE_DATA) {
    const phase = x * dx * k + z * dz * k - t * w;
    const s = Math.max(0, 0.5 + 0.5 * Math.sin(phase)), sp = Math.pow(s, p - 1), amp = A * a;
    h += (sp * s - m) * amp;
    const slope = 0.5 * Math.cos(phase) * p * sp * amp * k;
    gx += slope * dx; gz += slope * dz;
  }
  const kr = Math.PI * 2 / RIPPLE.wavelength;
  for (const r of rippleState) {
    if (r.s <= 0) continue;
    const age = Math.max(0, t - r.t);
    if (age > 12) continue;
    const ddx = x - r.x, ddz = z - r.z, dist = Math.sqrt(ddx * ddx + ddz * ddz + 1e-5);
    const ring = dist - age * RIPPLE.speed, env = Math.exp(-ring * ring * RIPPLE.width);
    const amp = r.s * RIPPLE.amplitude * Math.exp(-age * RIPPLE.decay) / Math.sqrt(dist * RIPPLE.spread + 1) * Math.max(0.4, A);
    const arg = ring * kr;
    h += Math.sin(arg) * env * amp;
    const dring = (Math.cos(arg) * kr * env - Math.sin(arg) * env * ring * 2 * RIPPLE.width) * amp;
    gx += ddx * dring / dist; gz += ddz * dring / dist;
  }
  if (out) { out.gx = gx; out.gz = gz; }
  return h;
}

/** Oriented ellipse (boat hull) where the water surface is not drawn: xy = centre, z/w = half length / half beam. */
export const hullMask = uniform(new Vector4(0, 0, 0.0001, 0.0001));
export const hullAxis = uniform(new Vector4(1, 0, 0, 1));
/** yaw is the boat's rotation.y; the hull length runs along local +x (world direction (cos yaw, -sin yaw)). */
export function setHullMask(x: number, z: number, halfLength: number, halfBeam: number, yaw: number) {
  hullMask.value.set(x, z, halfLength, halfBeam);
  hullAxis.value.set(Math.cos(yaw), -Math.sin(yaw), Math.sin(yaw), Math.cos(yaw));
}
export const hullOutside = (xz: import('three/webgpu').Node<'vec2'>) => {
  const d = xz.sub(hullMask.xy), u = d.dot(vec2(hullAxis.x, hullAxis.y)), v = d.dot(vec2(hullAxis.z, hullAxis.w));
  return u.div(hullMask.z).pow(2).add(v.div(hullMask.w).pow(2)).greaterThan(1);
};
