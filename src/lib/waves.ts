import type { Node } from 'three/webgpu';
import { vec2, vec3 } from 'three/tsl';

/** Display-tank spectrum (one world unit is about 10 cm): longer waves carry the energy; shorter waves are steeper.
 * Q*A*k stays below one even at maximum agitation (no overturned triangles). */
export const WATER_SPECTRUM = [
  [.22, 1.20, .0045, .65], [.72, .94, .0030, .74], [-.25, .72, .0023, .80],
  [.98, .54, .0015, .84], [-.58, .40, .0010, .88], [.40, .30, .0007, .90],
] as const;

// Shared tuning keeps the displacement, caustics and verification at the same scale.
export const WATER_SCALE = {
  agitationGain: 2.2, choppiness: .22, chopGain: .3,
  sloshAmplitude: .0025, rippleAmplitude: .002, maxRippleStrength: 2,
  edgeWidth: .18,
} as const;

/** Gerstner trochoids. Tangents are the exact derivatives of the same displaced
 * position, including horizontal compression; curvature drives refracted-ray focusing. */
export function gerstnerField(xz: Node<'vec2'>, clock: Node<'float'>, amplitude: Node<'float'>, choppiness: Node<'float'>) {
  let offset: Node<'vec3'> = vec3(0), tangent: Node<'vec3'> = vec3(1,0,0), binormal: Node<'vec3'> = vec3(0,0,1), curvature: Node<'vec3'> = vec3(0);
  for (const [angle, wavelength, a, q] of WATER_SPECTRUM) {
    const d = vec2(Math.cos(angle), Math.sin(angle)), k = 2 * Math.PI / wavelength;
    const phase = xz.dot(d).mul(k).sub(clock.mul(Math.sqrt(9.81 * k)));
    const h = phase.sin().mul(amplitude).mul(a), slope = phase.cos().mul(amplitude).mul(a * k);
    const qa = choppiness.mul(q), horizontal = phase.cos().mul(amplitude).mul(a).mul(qa);
    offset = offset.add(vec3(d.x.mul(horizontal), h, d.y.mul(horizontal)));
    const compression = h.mul(k).mul(qa);
    tangent = tangent.add(vec3(d.x.mul(d.x).mul(compression).negate(), d.x.mul(slope), d.x.mul(d.y).mul(compression).negate()));
    binormal = binormal.add(vec3(d.x.mul(d.y).mul(compression).negate(), d.y.mul(slope), d.y.mul(d.y).mul(compression).negate()));
    curvature = curvature.sub(vec3(d.x.mul(d.x), d.x.mul(d.y), d.y.mul(d.y)).mul(h).mul(k * k));
  }
  return { offset, tangent, binormal, normal: binormal.cross(tangent).normalize(),
    jacobian: tangent.x.mul(binormal.z).sub(tangent.z.mul(binormal.x)), curvature };
}
