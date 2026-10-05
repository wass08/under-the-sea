import { BufferGeometry, Float32BufferAttribute, Texture, Uint32BufferAttribute } from 'three/webgpu';
import type { BufferAttribute, Mesh, MeshStandardMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * Runtime geometry prep for the Tripo fish:
 *  1. load the glb (body + fins textured, several eye layers, 5..9 morph targets, one `Swim` clip),
 *  2. keep the textured primitives + the ivory / pupil eye layers, tag every vertex with a material id
 *     (0 body texture, 1 fin texture, 2 ivory, 3 pupil) and merge everything into ONE vertex buffer,
 *  3. simplify each primitive with meshoptimizer (only the index buffer changes, so morph deltas stay valid;
 *     the simplifier also sees a few extreme morph poses so it keeps tails and fins that move a lot),
 *  4. compact unused vertices,
 *  5. bake the Swim clip into a vertex animation texture (VAT): F frames of positions + normals per vertex.
 */

export interface FishLod {
  geometry: BufferGeometry;
  vertexCount: number;
  /** VAT vertex at the nose: used to pin the animated mouth to the metal hook. */
  mouthVertex: number;
  triCount: number;
  /** F * V * 2 vec4: for frame f, vertex v: [(f*V+v)*2] = position.xyz, [(f*V+v)*2+1] = normal.xyz. */
  vat: Float32Array;
}

export interface FishAsset {
  lods: FishLod[];
  /** Detailed near LOD (only when requested). */
  full?: FishLod;
  textures: [Texture, Texture];
  /** Model length along +X in model units (used to normalise to 1). */
  length: number;
  /** Swim clip duration in seconds. */
  period: number;
  frames: number;
}

interface Mesh3 {
  pos: Float32Array; nor: Float32Array; uv: Float32Array; mat: Float32Array;
  deltas: Float32Array[]; index: Uint32Array;
}

export interface AssetOptions {
  frames: number;
  /** Triangle budget for the body / fin textured primitives and per eye layer. */
  body: number; fins: number; eye: number;
  /** Extra proxy LODs (total triangles), built from the merged mesh. */
  proxies: number[];
  /** Also build a detailed near-camera LOD with bounded body, fin and eye budgets. */
  full?: { body: number; fins: number; eye: number };
}

const loader = new GLTFLoader();

function attr(a: any, n: number): Float32Array {
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    out[i * n] = a.getX(i); if (n > 1) out[i * n + 1] = a.getY(i); if (n > 2) out[i * n + 2] = a.getZ(i);
  }
  return out;
}

function compact(m: Mesh3): Mesh3 {
  const V = m.pos.length / 3, remap = new Int32Array(V).fill(-1); let n = 0;
  for (const i of m.index) if (remap[i] < 0) remap[i] = n++;
  const pick = (src: Float32Array, k: number) => { const out = new Float32Array(n * k); for (let i = 0; i < V; i++) { const r = remap[i]; if (r >= 0) for (let c = 0; c < k; c++) out[r * k + c] = src[i * k + c]; } return out; };
  return {
    pos: pick(m.pos, 3), nor: pick(m.nor, 3), uv: pick(m.uv, 2), mat: pick(m.mat, 1),
    deltas: m.deltas.map(d => pick(d, 3)), index: m.index.map(i => remap[i]) as unknown as Uint32Array,
  };
}

function sampleWeights(times: ArrayLike<number>, values: ArrayLike<number>, targets: number, frames: number, period: number) {
  const out: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const t = (f / frames) * period; const w = new Float32Array(targets);
    // linear interpolation (the clip's interpolant), looped
    let k = 0; while (k < times.length - 2 && times[k + 1] < t) k++;
    const t0 = times[k], t1 = times[k + 1], a = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
    for (let i = 0; i < targets; i++) w[i] = values[k * targets + i] * (1 - a) + values[(k + 1) * targets + i] * a;
    out.push(w);
  }
  return out;
}

function pose(m: Mesh3, w: Float32Array, out: Float32Array) {
  out.set(m.pos);
  for (let t = 0; t < w.length; t++) { const d = m.deltas[t], wt = w[t]; if (wt === 0) continue; for (let i = 0; i < out.length; i++) out[i] += d[i] * wt; }
}

/** Simplify one primitive to about `tris` triangles, with UV and a few extreme morph poses as attributes. */
function simplifyMesh(m: Mesh3, tris: number, poses: Float32Array[], scale: number): Mesh3 {
  if (m.index.length / 3 <= tris) return compact(m);
  const V = m.pos.length / 3, stride = 2 + poses.length * 3, attrs = new Float32Array(V * stride);
  const tmp = new Float32Array(V * 3);
  poses.forEach((w, p) => {
    pose(m, w, tmp);
    for (let i = 0; i < V; i++) for (let c = 0; c < 3; c++) attrs[i * stride + 2 + p * 3 + c] = (tmp[i * 3 + c] - m.pos[i * 3 + c]) / scale;
  });
  for (let i = 0; i < V; i++) { attrs[i * stride] = m.uv[i * 2]; attrs[i * stride + 1] = m.uv[i * 2 + 1]; }
  const weights = [2.5, 2.5, ...poses.flatMap(() => [0.6, 0.6, 0.6])]; // strong UV weight: no stretched / stair-stepped textures
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(m.index, m.pos, 3, attrs, stride, weights, null, tris * 3, 0.5, ['Permissive', 'Regularize']);
  return compact({ ...m, index: idx });
}

function merge(parts: Mesh3[]): Mesh3 {
  const V = parts.reduce((s, p) => s + p.pos.length / 3, 0), I = parts.reduce((s, p) => s + p.index.length, 0), T = parts[0].deltas.length;
  const out: Mesh3 = { pos: new Float32Array(V * 3), nor: new Float32Array(V * 3), uv: new Float32Array(V * 2), mat: new Float32Array(V), deltas: Array.from({ length: T }, () => new Float32Array(V * 3)), index: new Uint32Array(I) };
  let v = 0, i = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    out.pos.set(p.pos, v * 3); out.nor.set(p.nor, v * 3); out.uv.set(p.uv, v * 2); out.mat.set(p.mat, v);
    p.deltas.forEach((d, t) => out.deltas[t].set(d, v * 3));
    for (let k = 0; k < p.index.length; k++) out.index[i + k] = p.index[k] + v;
    v += n; i += p.index.length;
  }
  return out;
}

/** Bake normals+positions for each frame. Normals are welded across UV seams (never across opposite-facing sheets). */
function bakeVat(m: Mesh3, weights: Float32Array[]): Float32Array {
  const V = m.pos.length / 3, F = weights.length, vat = new Float32Array(F * V * 8);
  // weld groups
  const groups = new Int32Array(V), reps: number[] = [], byKey = new Map<string, number[]>();
  for (let i = 0; i < V; i++) {
    const key = `${Math.round(m.pos[i * 3] * 2000)},${Math.round(m.pos[i * 3 + 1] * 2000)},${Math.round(m.pos[i * 3 + 2] * 2000)},${m.mat[i]}`;
    let list = byKey.get(key); if (!list) byKey.set(key, list = []);
    let g = -1;
    for (const r of list) {
      const d = m.nor[reps[r] * 3] * m.nor[i * 3] + m.nor[reps[r] * 3 + 1] * m.nor[i * 3 + 1] + m.nor[reps[r] * 3 + 2] * m.nor[i * 3 + 2];
      if (d > 0.3) { g = r; break; }
    }
    if (g < 0) { g = reps.length; reps.push(i); list.push(g); }
    groups[i] = g;
  }
  const acc = new Float32Array(reps.length * 3), p = new Float32Array(V * 3);
  for (let f = 0; f < F; f++) {
    pose(m, weights[f], p); acc.fill(0);
    for (let t = 0; t < m.index.length; t += 3) {
      const a = m.index[t], b = m.index[t + 1], c = m.index[t + 2];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
      for (const v of [a, b, c]) { const g = groups[v] * 3; acc[g] += nx; acc[g + 1] += ny; acc[g + 2] += nz; }
    }
    for (let v = 0; v < V; v++) {
      const g = groups[v] * 3; let nx = acc[g], ny = acc[g + 1], nz = acc[g + 2]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      // orientation guard: keep the sign of the authored normal
      if (nx * m.nor[v * 3] + ny * m.nor[v * 3 + 1] + nz * m.nor[v * 3 + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const o = (f * V + v) * 8;
      vat[o] = p[v * 3]; vat[o + 1] = p[v * 3 + 1]; vat[o + 2] = p[v * 3 + 2];
      vat[o + 4] = nx; vat[o + 5] = ny; vat[o + 6] = nz;
    }
  }
  return vat;
}

function makeLod(m: Mesh3, weights: Float32Array[]): FishLod {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(m.pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(m.uv, 2));
  geometry.setAttribute('matId', new Float32BufferAttribute(m.mat, 1));
  geometry.setIndex(new Uint32BufferAttribute(m.index, 1));
  let mouthVertex = 0, best = -Infinity;
  for (let i = 0; i < m.pos.length / 3; i++) {
    // The nose is the furthest +X body vertex. Eyes cannot win this selection.
    if (m.mat[i] === 0 && m.pos[i * 3] > best) { best = m.pos[i * 3]; mouthVertex = i; }
  }
  return { geometry, mouthVertex, vertexCount: m.pos.length / 3, triCount: m.index.length / 3, vat: bakeVat(m, weights) };
}

export async function loadFishAsset(url: string, o: AssetOptions): Promise<FishAsset> {
  await MeshoptSimplifier.ready;
  const gltf = await loader.loadAsync(url);
  const meshes: Mesh[] = []; gltf.scene.traverse(n => { if ((n as Mesh).isMesh) meshes.push(n as Mesh); });
  const clip = gltf.animations.find(a => a.name === 'Swim') ?? gltf.animations[0];
  const track = clip.tracks.find(t => t.name.endsWith("morphTargetInfluences"))!;
  const T = meshes[0].geometry.morphAttributes.position!.length;
  const weights = sampleWeights(track.times, track.values, T, o.frames, clip.duration);

  // Bounding box of the (rest pose) textured primitives → length
  let minX = Infinity, maxX = -Infinity, ext = 0;
  const textured: Texture[] = [];
  const raw: { mesh: Mesh3; kind: 'tex' | 'ivory' | 'pupil'; map?: Texture }[] = [];
  for (const mesh of meshes) {
    const mat = mesh.material as MeshStandardMaterial, name = (mat.name || '').toLowerCase();
    const g = mesh.geometry, position = g.attributes.position;
    const kind = mat.map ? 'tex' : name.includes('ivory') ? 'ivory' : name.includes('pupil') ? 'pupil' : null;
    if (!kind) continue;
    const m: Mesh3 = {
      pos: attr(position, 3), nor: attr(g.attributes.normal, 3), uv: g.attributes.uv ? attr(g.attributes.uv, 2) : new Float32Array(position.count * 2),
      mat: new Float32Array(position.count),
      deltas: g.morphAttributes.position!.map(a => attr(a, 3)),
      index: Uint32Array.from(g.index!.array as ArrayLike<number>),
    };
    if (kind === 'tex') {
      if (!textured.includes(mat.map!)) textured.push(mat.map!);
      m.mat.fill(textured.indexOf(mat.map!));
      for (let i = 0; i < position.count; i++) { minX = Math.min(minX, m.pos[i * 3]); maxX = Math.max(maxX, m.pos[i * 3]); ext = Math.max(ext, Math.abs(m.pos[i * 3 + 1]), Math.abs(m.pos[i * 3 + 2])); }
    } else m.mat.fill(kind === 'ivory' ? 2 : 3);
    raw.push({ mesh: m, kind, map: mat.map ?? undefined });
  }
  const length = maxX - minX;

  // extreme poses: sample 4 frames (spread) for the simplifier's motion-awareness
  const poses = [0, 0.25, 0.5, 0.75].map(f => weights[Math.floor(f * o.frames)]);
  const parts: Mesh3[] = []; let texIndex = 0;
  for (const r of raw) {
    const budget = r.kind === 'tex' ? (texIndex++ === 0 ? o.body : o.fins) : o.eye;
    parts.push(simplifyMesh(r.mesh, budget, poses, length));
  }
  const merged = merge(parts);
  const lods: FishLod[] = [makeLod(merged, weights)];
  for (const total of o.proxies) {
    const V = merged.pos.length / 3, stride = 2 + poses.length * 3, attrs = new Float32Array(V * stride), tmp = new Float32Array(V * 3);
    poses.forEach((w, p) => { pose(merged, w, tmp); for (let i = 0; i < V; i++) for (let c = 0; c < 3; c++) attrs[i * stride + 2 + p * 3 + c] = (tmp[i * 3 + c] - merged.pos[i * 3 + c]) / length; });
    const [idx] = MeshoptSimplifier.simplifyWithAttributes(merged.index, merged.pos, 3, attrs, stride, [0, 0, ...poses.flatMap(() => [0.6, 0.6, 0.6])], null, total * 3, 0.5, ['Permissive']);
    lods.push(makeLod(compact({ ...merged, index: idx }), weights));
  }
  let full: FishLod | undefined;
  if (o.full) {
    const fp: Mesh3[] = [];
    let tex = 0;
    for (const r of raw) {
      const budget = r.kind === 'tex' ? (tex++ === 0 ? o.full.body : o.full.fins) : o.full.eye;
      fp.push(simplifyMesh(r.mesh, budget, poses, length));
    }
    full = makeLod(merge(fp), weights);
  }
  return { lods, full, textures: [textured[0], textured[1] ?? textured[0]], length, period: clip.duration, frames: o.frames };
}
