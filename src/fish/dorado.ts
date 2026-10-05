import { BufferGeometry, DataTexture, Float32BufferAttribute, RGBAFormat, SphereGeometry, Sprite, SpriteNodeMaterial, Uint32BufferAttribute, UnsignedByteType, Vector3 } from 'three/webgpu';
import { exp, float, length, smoothstep, uv, vec3 } from 'three/tsl';
import { glowBlending } from '../lib/blending';
import { predatorLure } from '../state';
import type { FishAsset, FishLod } from './geometry';

const LURE_FRAMES = 48;
const ESCA = new Vector3(.686, .102, 0);
/** Root stays planted; the flexible tip trails the body beat. Shared by VAT and CPU light. */
function lureSway(phase: number, t: number, out: Vector3) {
  const lag = phase - t * 1.15, weight = t * t;
  return out.set(Math.sin(lag) * .006 * weight, Math.cos(lag) * .011 * weight, Math.sin(lag) * .024 * weight);
}

/** Matches buildVertex's basis and frame interpolation, including bank and fade-out scale. */
export function createDoradoLure(modelScale: number) {
  const material = glowBlending(new SpriteNodeMaterial({ transparent: true, depthWrite: false }));
  const radius = length(uv().sub(.5)).mul(2);
  const halo = exp(radius.mul(radius).mul(-6)).mul(float(1).sub(smoothstep(.65, 1, radius)));
  material.colorNode = vec3(.16, .8, .92).mul(halo).mul(predatorLure.w).mul(1.05);
  material.opacityNode = float(1); // RGB is already weighted; custom blending preserves scene alpha.
  const sprite = new Sprite(material);
  sprite.name = 'Predator lure halo'; sprite.renderOrder = 3; sprite.visible = false;
  const f = new Vector3(), s = new Vector3(), u = new Vector3(), tip = new Vector3(), next = new Vector3();
  const up = new Vector3(0, 1, 0);
  return {
    sprite,
    update(pos: Vector3, vel: Vector3, bank: number, size: number, phase: number, time: number) {
      const frame = ((phase % 1 + 1) % 1) * LURE_FRAMES, first = Math.floor(frame), blend = frame - first;
      lureSway(first / LURE_FRAMES * Math.PI * 2, 1, tip);
      lureSway((first + 1) % LURE_FRAMES / LURE_FRAMES * Math.PI * 2, 1, next);
      tip.lerp(next, blend).add(ESCA).multiplyScalar(modelScale * size);
      f.copy(vel); const speed = f.length();
      if (speed > .001) f.divideScalar(speed); else f.set(1, 0, 0);
      const fy = Math.max(-.8, Math.min(.8, f.y)), k = Math.sqrt(1 - fy * fy) / Math.max(Math.hypot(f.x, f.z), 1e-4);
      f.set(f.x * k, fy, f.z * k);
      s.crossVectors(f, up).normalize(); u.crossVectors(s, f);
      const cb = Math.cos(bank), sb = Math.sin(bank);
      sprite.position.copy(pos).addScaledVector(f, tip.x)
        .addScaledVector(u, tip.y * cb - tip.z * sb).addScaledVector(s, tip.y * sb + tip.z * cb);
      sprite.visible = size > .01;
      sprite.scale.setScalar(1.05 * size);
      predatorLure.value.set(sprite.position.x, sprite.position.y, sprite.position.z,
        sprite.visible ? size * (.9 + .1 * Math.sin(time * 2.1)) : 0);
    },
  };
}

/** Bull dorado (Coryphaena hippurus), +X forward. matId: body 0, fins 1, iris 2, pupil 3.
 * Body UV: longitudinal x, y = .5 + 2.8 * height. Fin UV: root→edge x, ray/fan position y.
 * A single detailed LOD; the broad forehead, compressed flanks and continuous dorsal are silhouette geometry.
 */
export function createDoradoAsset(): FishAsset {
  const positions: number[] = [], ids: number[] = [], uvs: number[] = [], indices: number[] = [];
  const lureParts: number[] = [], lureWeights: number[] = [];
  const frames = LURE_FRAMES, modelLength = 1.12;
  const vertex = (x: number, y: number, z: number, id = 0, u = (x + .62) / modelLength, v = .5 + y * 2.8, part = 0, weight = 0) => {
    const i = ids.length; positions.push(x, y, z); ids.push(id); uvs.push(u, v);
    lureParts.push(part); lureWeights.push(weight); return i;
  };
  // x, dorsal contour, ventral contour, half-width. The forehead rises steeply above the mouth.
  const sections = [
    [.5, .015, -.035, .012], [.485, .105, -.065, .028], [.455, .165, -.082, .043],
    [.40, .175, -.095, .051], [.29, .156, -.103, .058], [.12, .118, -.091, .054],
    [-.08, .075, -.066, .041], [-.25, .037, -.034, .024], [-.395, .012, -.012, .010],
  ];
  const profile = (x: number) => {
    let k = 0;
    while (k < sections.length - 2 && x < sections[k + 1][0]) k++;
    const a = sections[k], b = sections[k + 1], t = Math.max(0, Math.min(1, (a[0] - x) / (a[0] - b[0])));
    // Monotone cubic contours keep the crown rounded without overshooting the narrow tail stock.
    return [1, 2, 3].map(c => {
      const slope = (j: number) => (sections[j + 1][c] - sections[j][c]) / (sections[j + 1][0] - sections[j][0]);
      const tangent = (j: number) => {
        if (j === 0) return slope(0);
        if (j === sections.length - 1) return slope(j - 1);
        const before = slope(j - 1), after = slope(j);
        return before * after <= 0 ? 0 : 2 * before * after / (before + after);
      };
      const h = b[0] - a[0], t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * a[c] + (t3 - 2 * t2 + t) * h * tangent(k)
        + (-2 * t3 + 3 * t2) * b[c] + (t3 - t2) * h * tangent(k + 1);
    });
  };
  // Nonuniform stations put more geometry into the steep forehead than into the narrow tail stock.
  const stations: number[] = [];
  for (let k = 0; k < sections.length - 1; k++) {
    const steps = k < 3 ? 3 : 5;
    for (let j = 0; j < steps; j++) stations.push(sections[k][0] + (sections[k + 1][0] - sections[k][0]) * j / steps);
  }
  stations.push(sections[sections.length - 1][0]);
  const sides = 22;
  for (let r = 0; r < stations.length; r++) {
    const x = stations[r], [top, bottom, width] = profile(x), center = (top + bottom) / 2, radius = (top - bottom) / 2;
    for (let s = 0; s < sides; s++) {
      const angle = s / sides * Math.PI * 2;
      vertex(x, center + Math.cos(angle) * radius, Math.sin(angle) * width);
      if (r < stations.length - 1) {
        const a = r * sides + s, b = r * sides + (s + 1) % sides;
        indices.push(a, a + sides, b, b, a + sides, b + sides);
      }
    }
  }
  const mouthVertex = vertex(.5, -.012, 0), tail = vertex(-.40, 0, 0);
  for (let s = 0; s < sides; s++) {
    indices.push(mouthVertex, s, (s + 1) % sides);
    indices.push(tail, (stations.length - 1) * sides + (s + 1) % sides, (stations.length - 1) * sides + s);
  }
  type Point = [number, number, number];
  const interpolate = (outline: Point[], t: number): Point => {
    const f = t * (outline.length - 1), k = Math.min(outline.length - 2, Math.floor(f)), a = f - k;
    return outline[k].map((v, i) => v + (outline[k + 1][i] - v) * a) as Point;
  };
  const fin = (root: (a: number) => Point, outline: Point[], rays: number, segments: number, reverse = false) => {
    const first = ids.length;
    for (let r = 0; r <= rays; r++) {
      const a = r / rays, base = root(a), edge = interpolate(outline, a);
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        // Shallow camber catches highlights without making the membrane look inflated.
        vertex(base[0] + (edge[0] - base[0]) * t, base[1] + (edge[1] - base[1]) * t,
          base[2] + (edge[2] - base[2]) * t + Math.sin(Math.PI * t) * .002, 1, t, a);
        if (r < rays && s < segments) {
          const p = first + r * (segments + 1) + s, q = p + segments + 1;
          if (reverse) indices.push(p, p + 1, q, p + 1, q + 1, q);
          else indices.push(p, q, p + 1, p + 1, q, q + 1);
        }
      }
    }
  };
  // A single long dorsal sail, tallest just behind the crown, ending at the caudal peduncle.
  fin(a => { const x = .445 - a * .835; return [x, profile(x)[0] - .003, 0]; },
    [[.435, .204, 0], [.32, .248, 0], [.12, .199, 0], [-.08, .144, 0], [-.27, .084, 0], [-.394, .02, 0]], 40, 3);
  fin(a => { const x = .055 - a * .44; return [x, profile(x)[1] + .002, 0]; },
    [[.045, -.096, 0], [-.045, -.133, 0], [-.19, -.108, 0], [-.32, -.062, 0], [-.39, -.018, 0]], 24, 2, true);
  // Two swept sickle lobes leave a deep open fork. No triangle spans the notch.
  for (const side of [-1, 1]) {
    fin(a => [-.392 - a * .059, side * (.010 - a * .008), 0],
      [[-.62, side * .171, 0], [-.586, side * .095, 0], [-.516, side * .027, 0], [-.451, side * .002, 0]], 10, 3, side < 0);
    // Small swept pectoral and pelvic fins: these are a hunter's control surfaces, not wings.
    fin(a => [.298 - a * .038, -.008 - a * .025, side * .055],
      [[.28, -.01, side * .064], [.105, -.068, side * .119], [.177, -.074, side * .065]], 8, 2, side < 0);
    fin(a => [.19 - a * .035, -.096, side * .019],
      [[.19, -.097, side * .021], [.075, -.135, side * .053], [.117, -.106, side * .02]], 4, 2, side > 0);
  }
  const eye = new SphereGeometry(1, 10, 6), eyePositions = eye.getAttribute('position');
  for (const side of [-1, 1]) {
    for (const [id, radius, offset] of [[2, .018, 0], [3, .013, .004]] as const) {
      const first = ids.length;
      for (let i = 0; i < eyePositions.count; i++) {
        vertex(.413 + eyePositions.getX(i) * radius, .036 + eyePositions.getY(i) * radius,
          side * (.051 + offset + eyePositions.getZ(i) * .006), id);
      }
      const ix = eye.index!.array;
      for (let i = 0; i < ix.length; i += 3) {
        indices.push(first + ix[i], first + ix[i + (side > 0 ? 1 : 2)], first + ix[i + (side > 0 ? 2 : 1)]);
      }
    }
  }
  eye.dispose();
  // An arched illicium grows out of the crown and curls down in front of the jaw.
  // Separate lurePart avoids the flying-fish wing IDs used by the shared vertex shader.
  const root = new Vector3(.395, .169, 0), controlA = new Vector3(.38, .46, 0);
  const controlB = new Vector3(.77, .42, 0), center = new Vector3(), tangent = new Vector3();
  const rodStart = ids.length, rings = 28, radial = 8;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, a = 1 - t;
    center.copy(root).multiplyScalar(a ** 3).addScaledVector(controlA, 3 * a * a * t)
      .addScaledVector(controlB, 3 * a * t * t).addScaledVector(ESCA, t ** 3);
    tangent.copy(controlA).sub(root).multiplyScalar(3 * a * a)
      .addScaledVector(controlB.clone().sub(controlA), 6 * a * t).addScaledVector(ESCA.clone().sub(controlB), 3 * t * t).normalize();
    const radius = .005 * (1 - .5 * t);
    for (let j = 0; j < radial; j++) {
      const angle = j / radial * Math.PI * 2, c = Math.cos(angle) * radius;
      vertex(center.x - tangent.y * c, center.y + tangent.x * c, Math.sin(angle) * radius, 1, t, j / radial, 1, t);
      if (r < rings) {
        const p = rodStart + r * radial + j, q = rodStart + r * radial + (j + 1) % radial;
        indices.push(p, q, p + radial, q, q + radial, p + radial);
      }
    }
  }
  const bulb = new SphereGeometry(1, 16, 12), bp = bulb.getAttribute('position'), bulbStart = ids.length;
  for (let i = 0; i < bp.count; i++) {
    vertex(ESCA.x + bp.getX(i) * .024, ESCA.y + bp.getY(i) * .031, bp.getZ(i) * .024, 2, 0, 0, 2, 1);
  }
  for (const i of bulb.index!.array) indices.push(bulbStart + i);
  bulb.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('matId', new Float32BufferAttribute(ids, 1));
  geometry.setAttribute('lurePart', new Float32BufferAttribute(lureParts, 1));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  const vertexCount = ids.length, vat = new Float32Array(frames * vertexCount * 8);
  const posed = new Float32Array(positions.length);
  const sway = new Vector3();
  for (let f = 0; f < frames; f++) {
    const phase = f / frames * Math.PI * 2;
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const flex = Math.max(0, (.32 - x) / .94), amplitude = .105 * flex * flex;
      const theta = phase - flex * 2.9;
      // Rotate each cross-section along the wave's tangent as well as displacing it.
      const slope = (-.21 * flex * Math.sin(theta) + amplitude * 2.9 * Math.cos(theta)) / .94;
      const angle = Math.atan(slope);
      posed[i * 3] = x - z * Math.sin(angle);
      posed[i * 3 + 1] = y;
      posed[i * 3 + 2] = z * Math.cos(angle) + Math.sin(theta) * amplitude;
      if (lureParts[i]) {
        lureSway(phase, lureWeights[i], sway);
        posed[i * 3] = x + sway.x; posed[i * 3 + 1] = y + sway.y; posed[i * 3 + 2] = z + sway.z;
      }
    }
    geometry.setAttribute('position', new Float32BufferAttribute(posed.slice(), 3));
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < vertexCount; i++) {
      vat.set([posed[i * 3], posed[i * 3 + 1], posed[i * 3 + 2], 0,
        normals.getX(i), normals.getY(i), normals.getZ(i), 0], (f * vertexCount + i) * 8);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const lod: FishLod = { geometry, vertexCount, mouthVertex, triCount: indices.length / 3, vat };
  const neutral = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  neutral.needsUpdate = true;
  return { lods: [lod], textures: [neutral, neutral], length: modelLength, period: 1.25, frames };
}
