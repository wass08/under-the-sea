import { Vector4 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, float, uniform, sin, cos, smoothstep, vec2, vec3 } from 'three/tsl';
import { simTime } from '../state';

/**
 * Diorama water surface. A sum of peaked sine waves (partly gathered into travelling groups by a slow
 * envelope) plus ripple rings, defined once
 * and evaluated identically on the GPU (TSL, with analytic gradient for normals)
 * and on the CPU (heightAt/normalAt for the boat). There is no horizontal
 * displacement, so the CPU mirror is exact and the border of the cube stays watertight.
 * One world unit is about 25 cm.
 */
/** Mean travel direction of the breeze-driven sea: onshore (the beach lies toward -z), slightly oblique. */
const WIND = -1.25;
/**
 * [direction angle, wavelength, semi-amplitude, peak sharpness]. A calm sea (steepness ka <= 0.06).
 * Waves 1-2 and 3-4 are near-twins in length and heading: their beating forms travelling wave groups
 * whose envelope comes straight from the sum of sines, so CPU and GPU stay exact.
 */
export const OCEAN_WAVES: readonly (readonly [number, number, number, number])[] = [
  [WIND - 0.45, 13.3, 0.11, 1.3],
  [WIND - 0.10, 7.9, 0.075, 1.45], [WIND + 0.14, 7.1, 0.068, 1.45],
  [WIND + 0.80, 4.7, 0.040, 1.5], [WIND + 0.62, 4.15, 0.034, 1.5],
  [WIND - 0.65, 2.6, 0.018, 1.4], [WIND + 0.85, 1.73, 0.010, 1.3], [WIND - 0.30, 1.21, 0.0055, 1.2],
];
/** Waves (by index) shaped by the group envelope, and their weight in the whitecap test. */
const GROUPED: Record<number, number> = { 1: 0.28, 2: 0.28, 3: 0.22, 4: 0.22 };
/**
 * Slow 2D envelope that gathers the grouped waves into irregular patches: [angle, length, weight, morph rad/s].
 * Lengths are incommensurate and below the box size so no repeat is visible; the pattern drifts with the
 * group velocity and morphs slowly.
 */
const ENVELOPE: readonly (readonly [number, number, number, number])[] = [
  [WIND + 0.5, 17, 1.0, 0.04], [WIND - 1.1, 23.5, 0.8, -0.035], [WIND + 2.0, 31, 0.6, 0.05],
];
const GROUP_SPEED = 1.6, ENVELOPE_MEAN = 0.62, ENVELOPE_SWING = 0.38;
/** Past times (s) at which the crest test is re-evaluated: foam left behind a breaking crest lingers and fades. */
const FOAM_HISTORY = [[0.25, 0.8], [0.5, 0.55], [0.8, 0.3]] as const;
export const OCEAN_GRAVITY = 9;
/** ?off=ripples (profiling): drop splash ripples from the GPU field. */
const RIPPLES_OFF = new URLSearchParams(location.search).get('off')?.split(',').includes('ripples') ?? false;
export const oceanAmplitude = uniform(1);
export const oceanParams = { amplitude: 1 };

/** Surface tension puts the phase-speed minimum at wavelength 0.35 world units. */
export const RIPPLE = {
  slots: 16, lifetime: 4.5, fadeStart: 3.5, amplitude: 0.11, spread: 0.8,
  tension: OCEAN_GRAVITY * (0.35 / (2 * Math.PI)) ** 2,
  decay: 0.35, viscosity: 0.00015, rise: 0.045,
  cavityWidth: 0.32, cavityDecay: 0.16, cavityAmplitude: 0.45,
  vertexCutoff: 0.3,
} as const;
// [wavelength, relative amplitude, initial width, spreading units/second, phase, onset seconds].
// Long gravity packets travel fastest, down to the group-speed minimum at 0.85;
// capillaries then accelerate ahead as a fine fringe. Staggering avoids a coherent raised donut.
const RIPPLE_COMPONENTS = [
  [2.2, 0.22, 0.50, 0.48, 1.0, 0.45],
  [1.4, 0.30, 0.44, 0.48, -1.6, 0.35],
  [0.85, 0.24, 0.32, 0.36, 0.3, 0.25],
  [0.22, 0.085, 0.16, 0.28, -0.8, 0.12],
  [0.1, 0.035, 0.11, 0.40, 0.6, 0.10],
].map(([length, amplitude, width, spreading, phase, onset]) => {
  const k = 2 * Math.PI / length, omega = Math.sqrt(OCEAN_GRAVITY * k + RIPPLE.tension * k ** 3);
  return { length, amplitude, width, spreading, k, omega,
    cg: (OCEAN_GRAVITY + 3 * RIPPLE.tension * k * k) / (2 * omega),
    decay: RIPPLE.decay + RIPPLE.viscosity * k * k, phase, onset };
});
// Conservative support: all packet centres plus three Gaussian widths (tail < 0.00013).
const RIPPLE_REACH_SPEED = Math.max(...RIPPLE_COMPONENTS.map(c => c.cg + 3 * c.spreading));
const RIPPLE_REACH_BASE = 3 * Math.max(RIPPLE.cavityWidth, ...RIPPLE_COMPONENTS.map(c => c.width));
export type RippleKind = 'game' | 'ambient' | 'fish';
/** xy = position, z = start time (sim seconds), w = strength. */
export const rippleUniforms = Array.from({ length: RIPPLE.slots }, () => uniform(new Vector4(0, 0, -1000, 0)));
const rippleState = Array.from({ length: RIPPLE.slots }, () => ({ x: 0, z: 0, t: -1000, s: 0 }));
let rippleIndex = 0, ambientIndex = 0;
/** Gameplay 0..5, ambient 6..7, fish 8..15. Boolean ambient callers remain supported. */
export function emitRipple(x: number, z: number, strength: number, kind: RippleKind | boolean = 'game', startTime = simTime.value) {
  const slot = kind === 'fish' ? rippleState.reduce((oldest, r, i) =>
    i >= 8 && r.t < rippleState[oldest].t ? i : oldest, 8)
    : kind === 'ambient' || kind === true ? 6 + (ambientIndex++ % 2) : rippleIndex++ % 6;
  const state = rippleState[slot];
  state.x = x; state.z = z; state.t = startTime; state.s = strength;
  rippleUniforms[slot].value.set(x, z, startTime, strength);
}

const mean = (p: number) => { let s = 0; const n = 512; for (let i = 0; i < n; i++) s += Math.pow(0.5 + 0.5 * Math.sin(i / n * Math.PI * 2), p); return s / n; };
const WAVE_DATA = OCEAN_WAVES.map(([angle, length, a, p], i) => {
  const k = Math.PI * 2 / length;
  return { dx: Math.cos(angle), dz: Math.sin(angle), k, w: Math.sqrt(OCEAN_GRAVITY * k), a: a * 2, p, mean: mean(p), offset: i * 1.731, grouped: i in GROUPED, crestWeight: GROUPED[i] ?? 0 };
});
const ENVELOPE_TOTAL = ENVELOPE.reduce((s, e) => s + e[2], 0);
const ENVELOPE_DATA = ENVELOPE.map(([angle, length, weight, morph], i) => {
  const k = Math.PI * 2 / length, dx = Math.cos(angle), dz = Math.sin(angle);
  // The pattern translates with the group velocity along the wind: phase rate = k . v.
  const along = dx * Math.cos(WIND) + dz * Math.sin(WIND);
  return { kx: dx * k, kz: dz * k, w: k * along * GROUP_SPEED + morph, c: weight / ENVELOPE_TOTAL * ENVELOPE_SWING, offset: i * 2.417 + 0.6 };
});

/**
 * GPU field: height offset and its gradient at an undisplaced xz, plus whitecap coverage.
 * crest = fresh breaking foam, trail = foam left behind by crests that passed in the last second.
 */
export function oceanField(xz: Node<'vec2'>, t: Node<'float'>, footprint?: Node<'float'>) {
  let h: Node<'float'> = float(0), gx: Node<'float'> = float(0), gz: Node<'float'> = float(0);
  let compression: Node<'float'> = float(0), variance: Node<'float'> = float(0);
  let env: Node<'float'> = float(ENVELOPE_MEAN), ex: Node<'float'> = float(0), ez: Node<'float'> = float(0);
  for (const { kx, kz, w, c, offset } of ENVELOPE_DATA) {
    const g = xz.x.mul(kx).add(xz.y.mul(kz)).sub(t.mul(w)).add(offset), cg = cos(g).mul(c);
    env = env.add(sin(g).mul(c)); ex = ex.add(cg.mul(kx)); ez = ez.add(cg.mul(kz));
  }
  // Grouped waves are summed first, then scaled by the envelope (product rule for the gradient).
  let hg: Node<'float'> = float(0), ggx: Node<'float'> = float(0), ggz: Node<'float'> = float(0);
  const crestTerms: { sn: Node<'float'>; cs: Node<'float'>; w: number; weight: number }[] = [];
  for (const { dx, dz, k, w, a, p, mean: m, offset, grouped, crestWeight } of WAVE_DATA) {
    const phase = xz.x.mul(dx * k).add(xz.y.mul(dz * k)).sub(t.mul(w)).add(offset);
    const sn = sin(phase), cs = cos(phase);
    const s = sn.mul(0.5).add(0.5).max(0), sp = s.pow(p - 1), amp = oceanAmplitude.mul(a);
    const elevation = sp.mul(s).sub(m).mul(amp);
    const resolved = footprint ? float(1).sub(smoothstep(Math.PI * 2 / k * 0.12, Math.PI * 2 / k * 0.45, footprint)) : float(1);
    const slope = cs.mul(0.5 * p * k).mul(sp).mul(amp).mul(resolved);
    variance = variance.add(float(1).sub(resolved.mul(resolved)).mul(amp.mul(amp)).mul(k * k * 0.125));
    // Compression proxy for horizontal orbital convergence. Calm troughs and arbitrary noise
    // no longer create whitewater; only a coincident steep crest can seed a whitecap.
    compression = compression.add(sn.mul(amp).mul(k * 0.65).mul(grouped ? env : float(1)));
    if (grouped) { hg = hg.add(elevation); ggx = ggx.add(slope.mul(dx)); ggz = ggz.add(slope.mul(dz)); }
    else { h = h.add(elevation); gx = gx.add(slope.mul(dx)); gz = gz.add(slope.mul(dz)); }
    if (crestWeight) crestTerms.push({ sn, cs, w, weight: crestWeight });
  }
  h = h.add(hg.mul(env)); gx = gx.add(ggx.mul(env)).add(hg.mul(ex)); gz = gz.add(ggz.mul(env)).add(hg.mul(ez));
  // Whitecaps: the combined grouped field only peaks where both twin pairs and the envelope line up, so
  // crests break in short, scattered segments instead of full-width lines. Its value a moment ago is
  // just a phase shift of the sines already computed (sin(phi + w tau)), so the foam history costs no trig.
  const combined = (tau: number) => {
    let d: Node<'float'> = float(0);
    for (const { sn, cs, w, weight } of crestTerms) d = d.add(sn.mul(weight * Math.cos(w * tau)).add(cs.mul(weight * Math.sin(w * tau))));
    return d.mul(env);
  };
  const crest = smoothstep(0.46, 0.68, combined(0)).mul(smoothstep(0.075, 0.18, compression));
  // Older crests: lower thresholds widen each band so consecutive samples overlap (no ghost copies); a soft
  // union keeps the trail continuous while it fades.
  let clear: Node<'float'> = float(1);
  FOAM_HISTORY.forEach(([tau, fade], j) => {
    clear = clear.mul(float(1).sub(smoothstep(0.42 - 0.03 * j, 0.64 - 0.04 * j, combined(tau)).mul(fade)));
  });
  const calm = oceanAmplitude.clamp(0, 1);
  // A function owns the control-flow stack even when oceanField is built outside a TSL Fn.
  const ripples = Fn(() => {
    const rh = float(0).toVar(), rx = float(0).toVar(), rz = float(0).toVar();
    for (const r of RIPPLES_OFF ? [] : rippleUniforms) {
      const age = t.sub(r.z).toVar(), d = xz.sub(r.xy).toVar(), dist = d.dot(d).add(1e-5).sqrt().toVar();
      If(age.greaterThanEqual(0).and(age.lessThan(RIPPLE.lifetime)).and(r.w.greaterThan(0))
        .and(dist.lessThan(age.mul(RIPPLE_REACH_SPEED).add(RIPPLE_REACH_BASE))), () => {
        const fade = float(1).sub(smoothstep(RIPPLE.fadeStart, RIPPLE.lifetime, age));
        const amp = r.w.mul(RIPPLE.amplitude).mul(oceanAmplitude.max(0.4)).mul(fade).toVar();
        // Shared terms become explicit variables: TSL would otherwise emit them inside the first per-packet branch
        // that uses them, and sibling branches then read an out-of-scope value (black rings on the water).
        const falloff = dist.mul(RIPPLE.spread).add(1).toVar();
        const packetAmp = amp.mul(float(1).sub(age.div(-RIPPLE.rise).exp())).div(falloff.sqrt()).toVar();
        const radial = float(0).toVar();
        const cavity = dist.mul(dist).div(-(RIPPLE.cavityWidth ** 2)).sub(age.div(RIPPLE.cavityDecay)).exp()
          .mul(amp).mul(-RIPPLE.cavityAmplitude);
        rh.addAssign(cavity);
        radial.addAssign(cavity.mul(dist).mul(-2 / RIPPLE.cavityWidth ** 2));
        for (const c of RIPPLE_COMPONENTS) {
          // Height-only callers (no footprint: the vertex grid, bubbles, splashes) skip components the grid can't
          // resolve and all slope work; per pixel, a component is only evaluated inside its own packet.
          if (!footprint && c.length < RIPPLE.vertexCutoff) continue;
          const width = age.mul(c.spreading).add(c.width).toVar(), width2 = width.mul(width).toVar();
          const ring = dist.sub(age.mul(c.cg)).toVar();
          const resolved = (footprint ? float(1).sub(smoothstep(c.length * 0.12, c.length * 0.45, footprint)) : float(1)).toVar();
          If(ring.abs().lessThan(width.mul(3)).and(resolved.greaterThan(0.001)), () => {
            // Conserve packet energy as its Gaussian spreads; this time-only factor also scales the slope.
            const envelope = ring.mul(ring).div(width2).negate().sub(age.mul(c.decay)).exp()
              .mul(float(c.width).div(width).sqrt()).mul(smoothstep(0, c.onset, age));
            const phase = dist.mul(c.k).sub(age.mul(c.omega)).add(c.phase);
            const a = packetAmp.mul(c.amplitude).mul(envelope).mul(resolved);
            const sn = sin(phase);
            rh.addAssign(sn.mul(a));
            if (footprint) radial.addAssign(cos(phase).mul(c.k).sub(sn.mul(ring.mul(2).div(width2)
              .add(float(0.5 * RIPPLE.spread).div(falloff)))).mul(a));
          });
        }
        if (footprint) { rx.addAssign(d.x.mul(radial).div(dist)); rz.addAssign(d.y.mul(radial).div(dist)); }
      });
    }
    return vec3(rh, rx, rz);
  })();
  h = h.add(ripples.x); gx = gx.add(ripples.y); gz = gz.add(ripples.z);
  return { h, gx, gz, crest: crest.mul(calm), trail: float(1).sub(clear).mul(calm).mul(smoothstep(0.035, 0.15, compression)), variance };
}

/** CPU mirror of oceanField. Returns height offset; writes gradient into out when given. */
export function oceanHeightCpu(x: number, z: number, t: number, out?: { gx: number; gz: number }) {
  let h = 0, gx = 0, gz = 0, env = ENVELOPE_MEAN, ex = 0, ez = 0, hg = 0, ggx = 0, ggz = 0;
  const A = oceanParams.amplitude;
  for (const { kx, kz, w, c, offset } of ENVELOPE_DATA) {
    const g = x * kx + z * kz - t * w + offset, cg = Math.cos(g) * c;
    env += Math.sin(g) * c; ex += cg * kx; ez += cg * kz;
  }
  for (const { dx, dz, k, w, a, p, mean: m, offset, grouped } of WAVE_DATA) {
    const phase = x * dx * k + z * dz * k - t * w + offset;
    const s = Math.max(0, 0.5 + 0.5 * Math.sin(phase)), sp = Math.pow(s, p - 1), amp = A * a;
    const elevation = (sp * s - m) * amp;
    const slope = Math.cos(phase) * 0.5 * p * k * sp * amp;
    if (grouped) { hg += elevation; ggx += slope * dx; ggz += slope * dz; }
    else { h += elevation; gx += slope * dx; gz += slope * dz; }
  }
  h += hg * env; gx += ggx * env + hg * ex; gz += ggz * env + hg * ez;
  // Full, unfiltered field; capillary heights are millimetric at gameplay strengths.
  for (const r of rippleState) {
    const age = t - r.t;
    if (r.s <= 0 || age < 0 || age >= RIPPLE.lifetime) continue;
    const ddx = x - r.x, ddz = z - r.z, dist = Math.sqrt(ddx * ddx + ddz * ddz + 1e-5);
    if (dist >= RIPPLE_REACH_BASE + age * RIPPLE_REACH_SPEED) continue;
    const f = Math.max(0, Math.min(1, (age - RIPPLE.fadeStart) / (RIPPLE.lifetime - RIPPLE.fadeStart)));
    const amp = r.s * RIPPLE.amplitude * Math.max(0.4, A) * (1 - f * f * (3 - 2 * f));
    const falloff = 1 + dist * RIPPLE.spread;
    const packetAmp = amp * (1 - Math.exp(-age / RIPPLE.rise)) / Math.sqrt(falloff);
    const cavity = -RIPPLE.cavityAmplitude * amp * Math.exp(-dist * dist / RIPPLE.cavityWidth ** 2 - age / RIPPLE.cavityDecay);
    h += cavity;
    let radial = cavity * dist * (-2 / RIPPLE.cavityWidth ** 2);
    for (const c of RIPPLE_COMPONENTS) {
      const width = c.width + c.spreading * age, width2 = width * width, ring = dist - c.cg * age;
      const onset = Math.max(0, Math.min(1, age / c.onset));
      const envelope = Math.exp(-ring * ring / width2 - age * c.decay) * Math.sqrt(c.width / width)
        * onset * onset * (3 - 2 * onset);
      const phase = c.k * dist - c.omega * age + c.phase, sn = Math.sin(phase);
      const a = packetAmp * c.amplitude * envelope;
      h += sn * a;
      radial += (Math.cos(phase) * c.k - sn * (2 * ring / width2 + 0.5 * RIPPLE.spread / falloff)) * a;
    }
    gx += ddx * radial / dist; gz += ddz * radial / dist;
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
