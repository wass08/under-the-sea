import type { Node } from 'three/webgpu';
import { Fn, float, vec2, vec3, uniform, sin, fract, dot, floor, length, min, max, smoothstep, mix } from 'three/tsl';
const hash2 = Fn(([p]: [Node<'vec2'>]) => fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453)));
// One function call emits a compact reusable WGSL function, including all nine neighbours.
const distances = Fn(([uv, time]: [Node<'vec2'>, Node<'float'>]) => {
  const cell = floor(uv), local = fract(uv), first = float(10).toVar(), second = float(10).toVar();
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const offset = vec2(x, y), phase = hash2(cell.add(offset)).mul(Math.PI * 2);
    const feature = sin(phase.add(time)).mul(0.36).add(0.5);
    const d = length(offset.add(feature).sub(local));
    second.assign(min(second, max(first, d))); first.assign(min(first, d));
  }
  return vec3(first, second, float(1).sub(smoothstep(0.025, 0.065, first)));
});
/** Animated hash-cell Worley F1/F2 distances and feature-point mask, using a 3×3 neighbourhood. */
export function worley(uv: Node<'vec2'>, time: Node<'float'> = float(0)) {
  const result = distances(uv, time);
  return { f1: result.x, f2: result.y, seedMask: result.z };
}
/** Caller-owned uniforms; freeze gates the caller's simulation clock through advance(). */
export function createCausticsUniforms() {
  const params = {
    scaleA: uniform(2.3), scaleB: uniform(3.7), speed: uniform(0.32), sharpness: uniform(18),
    intensity: uniform(1.65), rgbOffset: uniform(0.012), rawField: uniform(0), showSeeds: uniform(0),
    layer: uniform(0), freeze: uniform(0),
    advance(clock: { value: number }, dt: number) { if (params.freeze.value < 0.5) clock.value += dt; },
  };
  return params;
}
export type CausticsParams = ReturnType<typeof createCausticsUniforms> & { level: 1 | 2 | 3; depth: Node<'float'> };
/** Three comparison levels; RGB light contribution is zero above water at level 3. layer: 0 both, 1 A, 2 B. */
export function causticsField(uv: Node<'vec2'>, time: Node<'float'>, p: CausticsParams) {
  if (p.level === 1) {
    const t = time.mul(p.speed);
    const w = worley(uv.mul(p.scaleA).add(vec2(t.mul(0.33), t.mul(0.12))), t);
    const field = mix(w.f1.clamp().pow(3).mul(p.intensity), w.f1, p.rawField);
    return mix(vec3(field), vec3(1, 0.3, 0.08), w.seedMask.mul(p.showSeeds));
  }
  const sample = (at: Node<'vec2'>) => {
    const t = time.mul(p.speed);
    const a = worley(at.mul(p.scaleA).add(vec2(t.mul(0.33), t.mul(0.12))), t);
    const b = worley(at.mul(p.scaleB).sub(vec2(t.mul(0.20), t.mul(0.29))).add(7.3), t.mul(0.83));
    // F2 − F1 approaches zero on a Voronoi edge. Invert, then pow-sharpen into light lines.
    const edgeA = float(1).sub(a.f2.sub(a.f1).clamp()).pow(p.sharpness);
    const edgeB = float(1).sub(b.f2.sub(b.f1).clamp()).pow(p.sharpness);
    const both = edgeA.mul(edgeB).sqrt();
    const field = p.layer.greaterThan(1.5).select(edgeB, p.layer.greaterThan(0.5).select(edgeA, both));
    return { field, raw: p.layer.greaterThan(1.5).select(b.f1, a.f1), seeds: p.layer.greaterThan(1.5).select(b.seedMask, p.layer.greaterThan(0.5).select(a.seedMask, max(a.seedMask, b.seedMask))) };
  };
  if (p.level === 2) {
    const t = time.mul(p.speed);
    const w = worley(uv.mul(p.scaleA).add(vec2(t.mul(0.33), t.mul(0.12))), t);
    const raw = w.f2.sub(w.f1);
    const field = mix(float(1).sub(raw.clamp()).pow(p.sharpness).mul(p.intensity), raw, p.rawField);
    return mix(vec3(field), vec3(1, 0.3, 0.08), w.seedMask.mul(p.showSeeds));
  }
  const g = sample(uv), r = sample(uv.add(vec2(p.rgbOffset, 0))), b = sample(uv.sub(vec2(p.rgbOffset, 0)));
  const light = vec3(r.field, g.field, b.field).mul(p.intensity).mul(smoothstep(0, 0.15, p.depth));
  return mix(mix(light, vec3(g.raw), p.rawField), vec3(1, 0.22, 0.04), g.seeds.mul(p.showSeeds));
}
