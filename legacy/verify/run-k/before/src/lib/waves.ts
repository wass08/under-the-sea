import type { Node } from 'three/webgpu';
import { Fn, float, vec2, vec3 } from 'three/tsl';
/** Directional sine superposition returning (height, dh/dx, dh/dz).
 * The exact same field drives displacement and its analytic normal. */
export const waveField = Fn(([xz, clock, amplitude]: [Node<'vec2'>, Node<'float'>, Node<'float'>]) => {
  const h=float(0).toVar(), dx=float(0).toVar(), dz=float(0).toVar();
  for(const [x,z,k,a,s] of [[1,.35,5,.016,1.5],[-.45,1,7.5,.010,2],[.7,-.7,12,.005,2.9],[-.9,-.35,18,.003,3.8],[.15,1,3.1,.008,1.1]]) {
    const d=vec2(x/Math.hypot(x,z),z/Math.hypot(x,z));
    const phase=xz.dot(d).mul(k).sub(clock.mul(s)), strength=amplitude.mul(a);
    h.addAssign(phase.sin().mul(strength));
    const derivative=phase.cos().mul(strength).mul(k);
    dx.addAssign(derivative.mul(d.x));dz.addAssign(derivative.mul(d.y));
  }
  return vec3(h,dx,dz);
});
