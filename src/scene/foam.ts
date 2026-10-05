import type { Node } from 'three/webgpu';
import { mx_noise_float, smoothstep, vec2, vec3 } from 'three/tsl';
import { hullAxis, hullMask } from '../lib/ocean';
import { simTime } from '../state';

/** Broken, pulsing foam hugging the bamboo boat's waterline, independent of the viewing angle. */
export function contactFoam(xz: Node<'vec2'>) {
  const noise = mx_noise_float(vec3(xz.mul(4.5).sub(vec2(simTime.mul(0.14), simTime.mul(0.09))), simTime.mul(0.18))).mul(0.5).add(0.5);
  const bubbles = smoothstep(0.25, 0.65, noise);
  const delta = xz.sub(hullMask.xy);
  const local = vec2(delta.dot(hullAxis.xy), delta.dot(hullAxis.zw));
  const hullDistance = local.div(hullMask.zw.add(vec2(0.04, 0.025))).length();
  const hullRim = smoothstep(0.97, 1.07, hullDistance).mul(smoothstep(1.55, 1.1, hullDistance));
  const boatFoam = hullRim.mul(bubbles.mul(0.6).add(0.18)).mul(0.72);
  return boatFoam;
}
