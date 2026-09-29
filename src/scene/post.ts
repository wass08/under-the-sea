import { PerspectiveCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { exp, float, mix, pass, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export const postParams = { bloom: 0.45, exposure: 1 };

/** Bloom (tasteful), vignette, a slight warm/teal grade. Tone mapping is applied by the pipeline output. */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const exposure = uniform(postParams.exposure);
  const glow = bloom(beauty.min(6), postParams.bloom, 0.42, 1.05);
  // When the camera dives inside the water block: absorption + a teal veil that grows with distance.
  const underwater = uniform(0), camDepth = uniform(0);
  const dist = scenePass.getViewZNode().negate();
  const absorbed = beauty.rgb.mul(exp(vec3(0.16, 0.05, 0.03).mul(dist).negate()));
  const veil = vec3(0.012, 0.16, 0.21).mul(exp(camDepth.mul(-0.07)));
  const inWater = mix(absorbed, veil, float(1).sub(exp(dist.mul(-0.085))));
  const graded = mix(beauty.rgb, inWater, underwater);
  const luma = graded.dot(vec3(0.2126, 0.7152, 0.0722));
  const vivid = mix(vec3(luma), graded, 1.28).sub(0.16).mul(1.1).add(0.16).max(0);
  // Split-tone: cool shadows, warm highlights.
  const toned = vivid.mul(mix(vec3(0.96, 1.01, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.9, luma)));
  const vignette = smoothstep(0.32, 0.9, screenUV.sub(0.5).length()).mul(-0.28).add(1);
  pipeline.outputNode = vec4(toned.add(glow.rgb).mul(exposure).mul(vignette), 1);
  return {
    render() { pipeline.render(); },
    setUnderwater(amount: number, depth: number) { underwater.value = amount; camDepth.value = depth; },
    setBloom(v: number) { glow.strength.value = v; },
    setExposure(v: number) { exposure.value = v; },
  };
}
