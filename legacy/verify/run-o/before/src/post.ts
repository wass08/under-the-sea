import { PerspectiveCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { pass, screenUV, smoothstep, vec3, vec4, mix } from 'three/tsl';
import { rewindProgress } from './state';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
/** Bloom preserves crisp glass; a quiet vignette holds attention on the tank. */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const post = new RenderPipeline(renderer), scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const vignette = smoothstep(0.25, 0.76, screenUV.sub(0.5).length()).mul(-0.22).add(1);
  // Bound the bloom source so a sun reflection on one shard stays a small glint.
  const shadow = smoothstep(0.10, 0, beauty.rgb.max(0).dot(vec3(0.2126, 0.7152, 0.0722)));
  const reverseCue = rewindProgress.mul(Math.PI).sin().mul(0.14);
  const neutral = beauty.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
  const vivid = mix(vec3(neutral), beauty.rgb, 1.14).max(0).mul(1.04);
  const grade = mix(vivid, vec3(neutral).mul(vec3(0.94, 1.01, 1.06)), reverseCue).add(vec3(0.0002, 0.0005, 0.0012).mul(shadow));
  post.outputNode = vec4(grade.add(bloom(beauty.min(3), 0.24, 0.4, 1.3).rgb).mul(vignette).mul(vec3(vignette, 1, 1)), beauty.a);
  return { render() { post.render(); } };
}
