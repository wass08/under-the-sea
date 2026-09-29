import { type Camera, RenderPipeline, Scene, type ViewportTextureNode, WebGPURenderer } from 'three/webgpu';
import { pass, viewportOpaqueMipTexture } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
/** Bloom-only final pass. dispose() also frees the owned scene pass and bloom targets. */
export function createLabPost(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const pipeline = new RenderPipeline(renderer), scenePass = pass(scene, camera), beauty = scenePass.getTextureNode();
  const glow = bloom(beauty, 0.25, 0.4, 0.9);
  pipeline.outputNode = beauty.add(glow);
  const dispose = pipeline.dispose.bind(pipeline);
  pipeline.dispose = () => {
    // r186 caches the glass transmission copy per render target, but target disposal does not free it.
    (viewportOpaqueMipTexture() as ViewportTextureNode).getTextureForReference(scenePass.renderTarget).dispose();
    glow.dispose(); scenePass.dispose(); dispose();
  };
  return pipeline;
}
