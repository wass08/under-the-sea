import { PerspectiveCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { pass, screenUV, smoothstep } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
/** Bloom preserves crisp glass; a quiet vignette holds attention on the tank. */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const post = new RenderPipeline(renderer), scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const vignette = smoothstep(0.25, 0.76, screenUV.sub(0.5).length()).mul(-0.075).add(1);
  // Bound the bloom source so a sun reflection on one shard stays a small glint.
  post.outputNode = beauty.add(bloom(beauty.min(3), 0.24, 0.4, 1.3)).mul(vignette);
  return { render() { post.render(); } };
}
