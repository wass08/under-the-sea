import type { Node } from 'three/webgpu';
import { float, vec2, vec3, cos, mx_noise_float, smoothstep, mix } from 'three/tsl';

/** Short wind waves complement the resolved swell. Normals are height derivatives, rather than
 * unrelated noise vectors. Unresolved modes disappear into roughness instead of shimmering.
 * Tidewater's SeaDetail / WaterSurface illustrate the gust, slick and pixel-footprint split. */
export function seaDetail(xz: Node<'vec2'>, time: Node<'float'>, footprint: Node<'float'>) {
  const drift = xz.sub(vec2(0.23, -0.69).mul(time));
  const gustNoise = mx_noise_float(vec3(drift.mul(0.105), time.mul(0.025))).mul(0.5).add(0.5);
  const gust = smoothstep(0.28, 0.73, gustNoise);
  const along = drift.dot(vec2(0.315, -0.949));
  const across = drift.dot(vec2(0.949, 0.315)).add(gustNoise.mul(2.5));
  const slickNoise = mx_noise_float(vec3(along.mul(0.07), across.mul(0.42), 12.7)).mul(0.5).add(0.5);
  const slick = smoothstep(0.58, 0.8, slickNoise).mul(float(1).sub(gust.mul(0.7)));
  const spread = mix(float(0.48), float(1.35), gust).mul(float(1).sub(slick.mul(0.8)));
  let gx: Node<'float'> = float(0), gz: Node<'float'> = float(0), variance: Node<'float'> = float(0);
  // Log-spaced wavelengths, irrational phase offsets and dispersed headings have no short repeat.
  for (let i = 0; i < 18; i++) {
    const wavelength = 0.24 * Math.pow(10.5, i / 17);
    const angle = -1.25 + Math.sin(i * 2.399963) * 0.72;
    const k = Math.PI * 2 / wavelength, dx = Math.cos(angle), dz = Math.sin(angle);
    const slope = 0.012 + 0.006 * Math.sin(i * 1.731 + 0.7) ** 2;
    const visible = float(1).sub(smoothstep(wavelength * 0.12, wavelength * 0.45, footprint));
    const phase = xz.x.mul(k * dx).add(xz.y.mul(k * dz)).sub(time.mul(Math.sqrt(9 * k))).add(i * 2.713);
    const s = cos(phase).mul(slope).mul(visible).mul(spread);
    gx = gx.add(s.mul(dx)); gz = gz.add(s.mul(dz));
    variance = variance.add(float(1).sub(visible.mul(visible)).mul(slope * slope * 0.5));
  }
  return { slopes: vec2(gx, gz), variance: variance.mul(spread.mul(spread)), gust, slick, spread };
}
