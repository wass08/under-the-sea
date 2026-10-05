import { AddEquation, CustomBlending, OneFactor, ZeroFactor } from 'three/webgpu';
import type { Material } from 'three/webgpu';

/**
 * Additive light that leaves the destination ALPHA untouched. Plain AdditiveBlending also adds alpha, which goes
 * above 1 in the half-float scene target; the water surface un-premultiplies what it refracts (rgb / a), so glowing
 * things drawn before the water (algae glow) came out darkened, with dark discs and rims, seen from above.
 */
export function glowBlending<T extends Material>(material: T): T {
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor; material.blendDst = OneFactor;
  material.blendSrcAlpha = ZeroFactor; material.blendDstAlpha = OneFactor;
  return material;
}
