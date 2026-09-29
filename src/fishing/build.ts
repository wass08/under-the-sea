import { BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Euler, Float32BufferAttribute, Matrix4, MeshStandardNodeMaterial, Quaternion, TubeGeometry, Vector3 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Uniform scale of boat + fisherman + rod rig (boat local length 2.0 -> ~3.7 world units). */
export const RIG_SCALE = 1.85;

/** Tiny deterministic RNG so colour jitter is stable between reloads. */
let seed = 1337;
export function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

const tmpColor = new Color();
type V3 = [number, number, number];

/** Non-indexed geometry (position / normal / uv / colour), normals preserved (smooth when the source was smooth). */
export function paint(source: BufferGeometry, color: string | number, jitter = 0, uvScale: [number, number] = [1, 1]): BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  const uv = g.getAttribute('uv');
  if (uvScale[0] !== 1 || uvScale[1] !== 1) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
  const count = g.getAttribute('position').count, colors = new Float32Array(count * 3);
  tmpColor.set(color);
  const k = 1 + (rnd() - 0.5) * 2 * jitter;
  for (let i = 0; i < count; i++) { colors[i * 3] = tmpColor.r * k; colors[i * 3 + 1] = tmpColor.g * k; colors[i * 3 + 2] = tmpColor.b * k; }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  return g;
}

const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), pos = new Vector3(), scl = new Vector3();
/** A primitive placed with position / euler rotation / scale, painted, ready to merge. */
export function mk(g: BufferGeometry, color: string | number, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1], uvScale: [number, number] = [1, 1], jitter = 0): BufferGeometry {
  const out = paint(g, color, jitter, uvScale);
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

/** Smooth-shaded, vertex-tinted standard material with optional maps. */
export function smoothMaterial(o: { roughness?: number; metalness?: number; map?: Texture; roughnessMap?: Texture } = {}) {
  return new MeshStandardNodeMaterial({ vertexColors: true, roughness: o.roughness ?? 0.7, metalness: o.metalness ?? 0, map: o.map ?? null, roughnessMap: o.roughnessMap ?? null, side: DoubleSide });
}

/** Tube along a smooth path. */
export function tube(points: V3[], radius: number, color: string | number, radial = 8, uvScale: [number, number] = [1, 1]): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map(p => new Vector3(p[0], p[1], p[2])));
  return paint(new TubeGeometry(curve, Math.max(8, points.length * 4), radius, radial, false), color, 0, uvScale);
}

/** Smooth indexed grid patch -> non-indexed geometry with smooth normals. */
export function grid(nx: number, ny: number, at: (i: number, j: number) => V3, uv: (i: number, j: number) => [number, number], color: string | number, tint = 0): BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], index: number[] = [];
  tmpColor.set(color);
  const k = 1 + (rnd() - 0.5) * 2 * tint;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const p = at(i, j), t = uv(i, j);
    positions.push(p[0], p[1], p[2]); uvs.push(t[0], t[1]); colors.push(tmpColor.r * k, tmpColor.g * k, tmpColor.b * k);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    index.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
