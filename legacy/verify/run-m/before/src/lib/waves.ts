import type { Node } from 'three/webgpu';
import { vec2, vec3 } from 'three/tsl';

/** Finite deep-water spectrum: longer waves carry the energy; shorter waves are steeper.
 * Q*A*k stays below one even at maximum agitation (no overturned triangles). */
export const WATER_SPECTRUM = [
  [.22, 2.6, .035, .65], [.72, 1.65, .025, .74], [-.25, 1.05, .018, .80],
  [.98, .66, .011, .84], [-.58, .42, .0065, .88], [.40, .27, .0034, .90],
] as const;

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
