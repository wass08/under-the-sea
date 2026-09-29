import { perf } from '../verify/four-wall-metrics';
import { PerspectiveCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { pass, screenUV, smoothstep, vec3, vec4, mix } from 'three/tsl';
import { rewindProgress, state } from './state';
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
  const samples: Record<string,number>[] = []; let previous = performance.now();
  if (perf) {
    Object.assign(window, { fourWallPerf: { samples } });
    const render = renderer.render.bind(renderer);
    renderer.render = (object, view) => {
      const shadow = Boolean((object as Scene).overrideMaterial && ((object as Scene).overrideMaterial as unknown as {isShadowPassMaterial:boolean}).isShadowPassMaterial);
      const t = shadow ? performance.now() : 0, calls = renderer.info.render.drawCalls;
      render(object, view);
      if (shadow && perf) { perf.shadow += performance.now()-t; perf.shadowCalls += renderer.info.render.drawCalls-calls; }
    };
  }
  return { render() {
    if (!perf) { post.render(); return; }
    const now = performance.now(); post.render(); (window as unknown as {launchProbe?:{rendered(canvas:HTMLCanvasElement):void}}).launchProbe?.rendered(renderer.domElement); perf.render = performance.now()-now;
    const heap = (performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize ?? 0;
    samples.push({ ...perf, now, frame:now-previous, elapsed:state.elapsed, calls:renderer.info.render.drawCalls, heap }); previous=now;
    if (samples.length>6000) samples.splice(0,1000);
    perf.physics=perf.rapier=perf.collision=perf.solver=perf.ccd=perf.steps=perf.sync=perf.batch=perf.spill=perf.rewind=perf.render=perf.shadow=perf.shadowCalls=perf.uploads=0;
  } };

}
