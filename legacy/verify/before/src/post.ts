import { type Node, PerspectiveCamera, PostProcessing, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { pass, uniform, nodeObject } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { state } from './state';

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, islandFocus: Vector3) {
  // r186 retains this requested API as a compatibility wrapper for RenderPipeline.
  const post = new PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const focusDistance = uniform(14), focalRange = uniform(5.5), bokeh = uniform(0.9);
  // @types/three omits TSL extensions for this addon; nodeObject supplies them at runtime.
  const depthOfField = nodeObject(dof(beauty, scenePass.getViewZNode(), focusDistance, focalRange, bokeh)) as unknown as Node<'vec4'>;
  post.outputNode = depthOfField.add(bloom(depthOfField, 0.29, 0.45, 0.9));
  const viewPoint = new Vector3();
  return { render() { post.render(); }, update(dt: number) {
    const shattered = state.mode === 'shattered';
    camera.updateMatrixWorld();
    viewPoint.copy(shattered ? state.impact : islandFocus).applyMatrix4(camera.matrixWorldInverse);
    const blend = 1 - Math.exp(-dt * 2.5);
    focusDistance.value += (Math.max(0.1, -viewPoint.z) - focusDistance.value) * blend;
    // This DOF node exposes focus range and bokeh scale, not a physical aperture.
    focalRange.value += ((shattered ? 2.8 : 5.5) - focalRange.value) * blend;
    bokeh.value += ((shattered ? 2.5 : 0.9) - bokeh.value) * blend;
  } };
}
