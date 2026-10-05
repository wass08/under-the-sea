import { BufferGeometry, DataTexture, Float32BufferAttribute, RGBAFormat, SphereGeometry, Uint32BufferAttribute, UnsignedByteType, Vector3 } from 'three/webgpu';
import type { FishAsset, FishLod } from './geometry';

/**
 * Cá chuồn (flying fish, Exocoetidae), four-winged: a long rounded torpedo with a blunt head and big eyes, huge
 * pectoral "wings" rooted high behind the gills, a smaller pelvic pair under the belly, low dorsal/anal fins set far
 * back and a deeply forked tail whose lower lobe is the longer one (it sculls the water at take-off).
 *
 * The wings are modelled SPREAD (flat, horizontal, as in a glide). The vertex shader folds them back against the
 * flanks while the fish swims (render.ts, `WING`), driven by the per-fish airborne spread from the sim.
 * matId: 0 body, 1 fins (tail, dorsal, anal), 2 eye white, 3 pupil, 4 pectoral wing, 5 pelvic wing.
 * Wing uv: x = along the ray (0 root → 1 edge), y = across the fan (0 leading edge → 1 trailing edge).
 * Body uv: x = (x + 0.53) / 1.035 (0 tail tip → 1 nose), y = 0.5 + 5·height.
 */

/** Wing hinges (model space, z for the +z side; mirrored for −z) and fan geometry, shared with the shader. */
export const WING = {
  pectoral: { hinge: [0.27, 0.018, 0.058] as const, root: [[0.31, 0.022, 0.056], [0.21, 0.012, 0.06]] as const, sweep: [1.75, 2.88] as const, lengths: [0.37, 0.46, 0.4, 0.27, 0.14], id: 4 },
  pelvic: { hinge: [-0.04, -0.045, 0.034] as const, root: [[-0.02, -0.044, 0.032], [-0.09, -0.04, 0.03]] as const, sweep: [1.9, 2.95] as const, lengths: [0.2, 0.24, 0.19, 0.12, 0.07], id: 5 },
};

export function createFlyingFishAsset(): FishAsset {
  const frames = 32;
  const make = (rings: number, sides: number, rays: number, segs: number, eyes: boolean): FishLod => {
    const positions: number[] = [], ids: number[] = [], uvs: number[] = [], indices: number[] = [];
    const vertex = (x: number, y: number, z: number, id = 0, u = (x + .53) / 1.035, v = y * 5 + .5) => {
      const i = ids.length; positions.push(x, y, z); ids.push(id); uvs.push(u, v); return i;
    };
    // Body, nose (+x) to caudal peduncle: blunt round head, long even cylinder, slim tail stock, flattish belly.
    for (let r = 0; r <= rings; r++) {
      const t = r / rings, x = .49 - t * .86;
      const head = Math.pow(Math.min(1, t / .16), .5), tail = 1 - Math.pow(Math.max(0, (t - .55) / .45), 1.6) * .78;
      const envelope = head * tail;
      const snout = Math.exp(-t * 30);
      const ry = .008 + envelope * .07 + snout * .018, rz = .007 + envelope * .062 + snout * .014;
      for (let s = 0; s < sides; s++) {
        const angle = s / sides * Math.PI * 2, c = Math.cos(angle), belly = c < 0 ? 0.86 : 1;
        vertex(x, c * ry * belly, Math.sin(angle) * rz);
        if (r < rings) {
          const a = r * sides + s, b = r * sides + (s + 1) % sides;
          indices.push(a, a + sides, b, b, a + sides, b + sides);
        }
      }
    }
    const nose = vertex(.505, -.004, 0), tailTip = vertex(-.385, 0, 0);
    for (let s = 0; s < sides; s++) {
      indices.push(nose, s, (s + 1) % sides);
      indices.push(tailTip, rings * sides + (s + 1) % sides, rings * sides + s);
    }
    const fin = (points: [number, number, number][]) => {
      const first = ids.length; points.forEach(p => vertex(...p, 1));
      for (let i = 1; i < points.length - 1; i++) indices.push(first, first + i, first + i + 1);
    };
    // Deeply forked caudal fin: the lower lobe is longer.
    fin([[-.37, .012, 0], [-.56, .12, 0], [-.5, .03, 0], [-.45, 0, 0]]);
    fin([[-.37, -.012, 0], [-.45, 0, 0], [-.52, -.04, 0], [-.63, -.165, 0]]);
    // Low dorsal and anal fins far back.
    fin([[-.1, .06, 0], [-.17, .105, 0], [-.27, .09, 0], [-.31, .035, 0]]);
    fin([[-.13, -.052, 0], [-.21, -.095, 0], [-.3, -.075, 0], [-.32, -.03, 0]]);
    // Wings: a fan of rays from the root line to the outline, `rays` × `segs` cells, both sides.
    const wing = (w: typeof WING.pectoral) => {
      for (const side of [-1, 1]) {
        const first = ids.length;
        for (let r = 0; r <= rays; r++) {
          const a = r / rays, theta = w.sweep[0] + (w.sweep[1] - w.sweep[0]) * a;
          const k = a * (w.lengths.length - 1), k0 = Math.floor(Math.min(k, w.lengths.length - 2)), length = w.lengths[k0] + (w.lengths[k0 + 1] - w.lengths[k0]) * (k - k0);
          const rx = w.root[0][0] + (w.root[1][0] - w.root[0][0]) * a, ry = w.root[0][1] + (w.root[1][1] - w.root[0][1]) * a, rz = w.root[0][2] + (w.root[1][2] - w.root[0][2]) * a;
          for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            // Slight camber and a drooping edge, like a gliding wing under load.
            vertex(rx + Math.cos(theta) * length * t, ry + Math.sin(Math.PI * t) * .012 - t * t * .02, side * (rz + Math.sin(theta) * length * t), w.id, t, a);
            if (r < rays && s < segs) {
              const p = first + r * (segs + 1) + s, q = p + segs + 1;
              if (side > 0) indices.push(p, q, p + 1, p + 1, q, q + 1); else indices.push(p, p + 1, q, p + 1, q + 1, q);
            }
          }
        }
      }
    };
    wing(WING.pectoral);
    wing({ ...WING.pelvic, lengths: WING.pelvic.lengths } as unknown as typeof WING.pectoral);
    if (eyes) {
      // Big eyes: night feeders.
      const eye = new SphereGeometry(1, 12, 8), p = eye.getAttribute('position');
      for (const side of [-1, 1]) {
        for (const [id, scale, offset] of [[2, 1, 0], [3, .86, .004]] as const) {
          const start = ids.length;
          for (let i = 0; i < p.count; i++) vertex(.4 + p.getX(i) * .026 * scale, .016 + p.getY(i) * .025 * scale, side * (.052 + offset + p.getZ(i) * .006), id);
          for (const i of eye.index!.array) indices.push(start + i);
        }
      }
      eye.dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('matId', new Float32BufferAttribute(ids, 1));
    geometry.setIndex(new Uint32BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    // Vertex animation texture: a travelling body wave, strongest at the tail (wings ride along with the flank).
    const count = ids.length, vat = new Float32Array(frames * count * 8);
    const posed = new Float32Array(positions.length), p = new Vector3();
    for (let f = 0; f < frames; f++) {
      const phase = f / frames * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        p.fromArray(positions, i * 3);
        const flex = Math.max(0, (.32 - p.x) / .9);
        p.z += Math.sin(phase - flex * 3.4) * flex * flex * .075;
        p.toArray(posed, i * 3);
      }
      geometry.setAttribute('position', new Float32BufferAttribute(posed.slice(), 3));
      geometry.computeVertexNormals();
      const normals = geometry.getAttribute('normal');
      for (let i = 0; i < count; i++) {
        const offset = (f * count + i) * 8;
        vat.set([posed[i * 3], posed[i * 3 + 1], posed[i * 3 + 2], 0, normals.getX(i), normals.getY(i), normals.getZ(i), 0], offset);
      }
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return { geometry, vertexCount: count, mouthVertex: nose, triCount: indices.length / 3, vat };
  };
  const neutral = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  neutral.needsUpdate = true;
  // The normal LOD only draws distant fish (a few pixels): 152 triangles, within the school’s 160-triangle budget.
  return { lods: [make(9, 6, 3, 1, false), make(5, 4, 2, 1, false)], full: make(22, 16, 12, 6, true), textures: [neutral, neutral], length: 1.035, period: 1, frames };
}
