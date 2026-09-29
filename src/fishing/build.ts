import { BufferGeometry, Color, DoubleSide, Euler, Float32BufferAttribute, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Tiny deterministic RNG so the low-poly colour jitter is stable between reloads. */
let seed = 1337;
export function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

const tmpColor = new Color();

/** Non-indexed, uv-less geometry with a per-vertex colour (per-triangle brightness jitter for a hand-painted low-poly look). */
export function paint(source: BufferGeometry, color: string | number, jitter = 0.06): BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone();
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const count = g.getAttribute('position').count, colors = new Float32Array(count * 3);
  tmpColor.set(color);
  for (let i = 0; i < count; i += 3) {
    const k = 1 + (rnd() - 0.5) * 2 * jitter;
    for (let j = 0; j < 3; j++) { colors[(i + j) * 3] = tmpColor.r * k; colors[(i + j) * 3 + 1] = tmpColor.g * k; colors[(i + j) * 3 + 2] = tmpColor.b * k; }
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

type V3 = [number, number, number];
const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), pos = new Vector3(), scl = new Vector3();
/** A primitive placed with position / euler rotation / scale, painted, ready to merge. */
export function mk(g: BufferGeometry, color: string | number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1], jitter = 0.06): BufferGeometry {
  const out = paint(g, color, jitter);
  q.setFromEuler(e.set(r[0], r[1], r[2]));
  m4.compose(pos.set(p[0], p[1], p[2]), q, scl.set(s[0], s[1], s[2]));
  out.applyMatrix4(m4);
  return out;
}

export function merge(list: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(list, false);
  if (!g) throw new Error('fishing: geometry merge failed');
  return g;
}

/** Flat-shaded vertex-coloured standard material shared by the boat / fisherman. */
export function flatMaterial(roughness = 0.82, metalness = 0) {
  return new MeshStandardNodeMaterial({ vertexColors: true, flatShading: true, roughness, metalness, side: DoubleSide });
}

export const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Uniform scale of boat + fisherman + rod rig (world units). */
export const RIG_SCALE = 1.35;
