import { DataTexture, Matrix4, PerspectiveCamera, RenderPipeline, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, Loop, exp, float, fract, min, mix, mx_noise_float, pass, screenCoordinate, screenUV, sin, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { godRayStrength, toSun } from './lighting';

export const postParams = { bloom: 0.45, exposure: 1 };

/**
 * Bloom, vignette, a slight grade, and the underwater medium: when the camera is inside the water block a
 * depth-based pass adds absorption, a vertical blue gradient veil and raymarched god rays.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, heightTexture: DataTexture) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const exposure = uniform(postParams.exposure);
  const glow = bloom(beauty.min(6), postParams.bloom, 0.42, 1.05);

  // ---- Underwater medium ----------------------------------------------------------------------------------
  const underwater = uniform(0);
  const camPos = uniform(new Vector3()), invProj = uniform(new Matrix4()), camWorld = uniform(new Matrix4());
  const ndc = vec2(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y).mul(2).sub(1));
  const rayV4 = invProj.mul(vec4(ndc, 1, 1)), rayV = rayV4.xyz.div(rayV4.w);
  const viewDist = scenePass.getViewZNode().negate().mul(rayV.length()).div(rayV.z.negate());
  const dist = min(viewDist, 90);
  const rd = camWorld.mul(vec4(rayV, 0)).xyz.normalize();
  const R = WORLD.half;

  const godRays = Fn(([length]: [Node<'float'>]) => {
    const steps = 14, acc = float(0).toVar(), stepLen = length.div(steps);
    const jitter = fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)).fract().mul(52.9829189));
    Loop(steps, ({ i }) => {
      const p = camPos.add(rd.mul(float(i).add(jitter).mul(stepLen)));
      const under = waterLevel.sub(p.y);
      const ps = p.xz.add(toSun.xz.mul(under.div(toSun.y.max(0.15))));
      const shafts = mx_noise_float(vec3(ps.mul(0.2), simTime.mul(0.16))).mul(0.5).add(0.5).mul(0.7).add(sin(ps.x.mul(0.7).add(ps.y.mul(0.5)).add(simTime.mul(0.5))).mul(0.15).add(0.15));
      const beam = smoothstep(0.42, 0.75, shafts);
      const q = p.add(toSun.mul(4));
      const open = smoothstep(-0.05, 0.3, q.y.sub(texture(heightTexture, q.xz.div(R * 2).add(0.5)).level(float(0)).r));
      acc.addAssign(beam.mul(open).mul(smoothstep(-0.02, 0.4, under)).mul(under.mul(-0.05).exp()).mul(stepLen));
    });
    return acc;
  });

  const medium = Fn(() => {
    const out = beauty.rgb.toVar();
    If(underwater.greaterThan(0.01), () => {
    const sigma = vec3(0.11, 0.05, 0.016);
    const absorbed = beauty.rgb.mul(exp(sigma.mul(dist).negate()));
    const midDepth = waterLevel.sub(camPos.y.add(rd.y.mul(dist).mul(0.5))).max(0);
    const veilColor = mix(vec3(0.02, 0.28, 0.6), vec3(0.003, 0.05, 0.26), smoothstep(0.0, 11.0, midDepth));
    const veil = veilColor.mul(float(1).sub(exp(dist.mul(-0.04))));
    const phase = float(0.7).add(rd.dot(toSun).max(0).pow(3).mul(2.2));
    const rays = vec3(1.0, 0.94, 0.72).mul(godRays(min(dist, 55))).mul(phase).mul(godRayStrength).mul(0.22);
    out.assign(mix(beauty.rgb, absorbed.add(veil).add(rays), underwater));
    });
    return out;
  })();

  const luma = medium.dot(vec3(0.2126, 0.7152, 0.0722));
  const vivid = mix(vec3(luma), medium, 1.28).sub(0.16).mul(1.1).add(0.16).max(0);
  // Split-tone: cool shadows, warm highlights.
  const toned = vivid.mul(mix(vec3(0.96, 1.01, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.9, luma)));
  const vignette = smoothstep(0.32, 0.9, screenUV.sub(0.5).length()).mul(-0.28).add(1);
  pipeline.outputNode = vec4(toned.add(glow.rgb).mul(exposure).mul(vignette), 1);
  return {
    render() { pipeline.render(); },
    /** amount 0..1 (1 = camera fully inside the water block). Call every frame. */
    setUnderwater(amount: number) {
      underwater.value = amount;
      camPos.value.copy(camera.position); invProj.value.copy(camera.projectionMatrixInverse); camWorld.value.copy(camera.matrixWorld);
    },
    setBloom(v: number) { glow.strength.value = v; },
    setExposure(v: number) { exposure.value = v; },
  };
}
