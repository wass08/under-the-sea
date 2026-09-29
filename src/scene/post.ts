import { DataTexture, Matrix4, PerspectiveCamera, RenderPipeline, Scene, Vector3, Vector4, WebGPURenderer } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, Loop, exp, float, fract, min, mix, mx_noise_float, pass, perspectiveDepthToViewZ, screenCoordinate, screenUV, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { WORLD } from '../config';
import { simTime, waterLevel } from '../state';
import { godRayStrength, toSun } from './lighting';

export const postParams = { bloom: 0.45, exposure: 1 };
export type InsetRectPx = { x: number; y: number; width: number; height: number };

/** Uniforms describing one view (the main camera or the inset camera) for the underwater medium. */
function makeView() {
  return { underwater: uniform(0), camPos: uniform(new Vector3()), invProj: uniform(new Matrix4()), camWorld: uniform(new Matrix4()), near: uniform(0.2), far: uniform(900) };
}
type View = ReturnType<typeof makeView>;
const feed = (view: View, camera: PerspectiveCamera, amount: number) => {
  view.underwater.value = amount; view.camPos.value.copy(camera.position);
  view.invProj.value.copy(camera.projectionMatrixInverse); view.camWorld.value.copy(camera.matrixWorld);
  view.near.value = camera.near; view.far.value = camera.far;
};

/**
 * Bloom, vignette, a slight grade, and the underwater medium: when a camera is inside the water block a
 * depth-based pass adds absorption, a vertical blue gradient veil and raymarched god rays. A second camera
 * (picture-in-picture inset) is rendered by its own scene pass at inset resolution and composited into a rect.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, heightTexture: DataTexture) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const exposure = uniform(postParams.exposure);
  const glow = bloom(beauty.min(6), postParams.bloom, 0.42, 1.05);
  const R = WORLD.half;
  const mainView = makeView(), insetView = makeView();

  /** Absorption + veil + god rays for one view. uvN = screen position in that view's image; returns linear colour. */
  const underwaterLook = (view: View, color: Node<'vec3'>, viewZ: Node<'float'>, uvN: Node<'vec2'>) => {
    const ndc = vec2(uvN.x.mul(2).sub(1), float(1).sub(uvN.y).mul(2).sub(1));
    const rayV4 = view.invProj.mul(vec4(ndc, 1, 1)), rayV = rayV4.xyz.div(rayV4.w);
    const dist = min(viewZ.negate().mul(rayV.length()).div(rayV.z.negate()), 90);
    const rd = view.camWorld.mul(vec4(rayV, 0)).xyz.normalize();

    const godRays = Fn(([length]: [Node<'float'>]) => {
      const steps = 14, acc = float(0).toVar(), stepLen = length.div(steps);
      const jitter = fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)).fract().mul(52.9829189));
      Loop(steps, ({ i }) => {
        const p = view.camPos.add(rd.mul(float(i).add(jitter).mul(stepLen)));
        const under = waterLevel.sub(p.y);
        const ps = p.xz.add(toSun.xz.mul(under.div(toSun.y.max(0.15))));
        // Several crisp shafts: a coarse fan pattern multiplied by a finer one, both drifting slowly.
        const coarse = mx_noise_float(vec3(ps.mul(0.13), simTime.mul(0.11))).mul(0.5).add(0.5);
        const fine = mx_noise_float(vec3(ps.mul(0.42).add(5.1), simTime.mul(0.2))).mul(0.5).add(0.5);
        const beam = smoothstep(0.5, 0.58, coarse).mul(smoothstep(0.3, 0.7, fine).mul(0.7).add(0.3));
        const q = p.add(toSun.mul(4));
        const open = smoothstep(-0.05, 0.3, q.y.sub(texture(heightTexture, q.xz.div(R * 2).add(0.5)).level(float(0)).r));
        acc.addAssign(beam.mul(open).mul(smoothstep(-0.02, 0.4, under)).mul(under.mul(-0.05).exp()).mul(stepLen));
      });
      return acc;
    });

    return Fn(() => {
    const out = color.toVar();
    If(view.underwater.greaterThan(0.01), () => {
      const sigma = vec3(0.12, 0.045, 0.012);
      const absorbed = color.mul(exp(sigma.mul(dist).negate()));
      const midDepth = waterLevel.sub(view.camPos.y.add(rd.y.mul(dist).mul(0.5))).max(0);
      // Saturated cyan near the surface fading to deep blue below; brighter still when looking up toward the light.
      const veilColor = mix(vec3(0.0, 0.34, 0.66), vec3(0.0, 0.05, 0.3), smoothstep(0.0, 10.0, midDepth));
      const bright = mix(veilColor, vec3(0.04, 0.55, 0.85), smoothstep(0.0, 0.85, rd.y).mul(0.75));
      const veil = bright.mul(float(1).sub(exp(dist.mul(-0.05))));
      const phase = float(0.7).add(rd.dot(toSun).max(0).pow(3).mul(2.2));
      const rays = vec3(0.55, 0.92, 1.0).mul(godRays(min(dist, 55))).mul(phase).mul(godRayStrength).mul(0.11);
      out.assign(mix(color, absorbed.add(veil).add(rays), view.underwater));
    });
    return out;
    })();
  };

  const grade = (c: Node<'vec3'>, underwater: Node<'float'>) => {
    const luma = c.dot(vec3(0.2126, 0.7152, 0.0722));
    const vivid = mix(vec3(luma), c, mix(float(1.28), float(1.6), underwater)).sub(0.16).mul(1.1).add(0.16).max(0);
    // Split-tone: cool shadows, warm highlights (skipped under water).
    return vivid.mul(mix(mix(vec3(0.96, 1.01, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.9, luma)), vec3(1), underwater));
  };
  const vignette = smoothstep(0.32, 0.9, screenUV.sub(0.5).length()).mul(-0.28).add(1);

  const mainMedium = underwaterLook(mainView, beauty.rgb, scenePass.getViewZNode(), screenUV);
  const mainOut = grade(mainMedium, mainView.underwater).add(glow.rgb.mul(float(1).sub(mainView.underwater.mul(0.65)))).mul(exposure).mul(vignette);
  pipeline.outputNode = vec4(mainOut, 1);

  // ---- Picture-in-picture ---------------------------------------------------------------------------------
  const rectUniform = uniform(new Vector4(0, 0, 1, 1));
  let insetPass: ReturnType<typeof pass> | null = null, insetCamera: PerspectiveCamera | null = null, insetRect: InsetRectPx | null = null;
  const buildInset = (cam: PerspectiveCamera) => {
    insetPass = pass(scene, cam);
    insetCamera = cam;
    const local = screenUV.sub(rectUniform.xy).div(rectUniform.zw);
    const inside = local.x.greaterThanEqual(0).and(local.x.lessThanEqual(1)).and(local.y.greaterThanEqual(0)).and(local.y.lessThanEqual(1));
    const color = insetPass.getTextureNode('output').sample(local).level(float(0)).rgb;
    const depth = insetPass.getTextureNode('depth').sample(local).level(float(0));
    const viewZ = perspectiveDepthToViewZ(depth, insetView.near, insetView.far);
    const result = Fn(() => {
      const o = mainOut.toVar();
      If(inside, () => {
        const medium = underwaterLook(insetView, color, viewZ, local);
        const edge = smoothstep(0.0, 0.35, local.sub(0.5).length().mul(1.0));
        o.assign(grade(medium, insetView.underwater).mul(exposure).mul(edge.mul(-0.22).add(1)));
      });
      return o;
    })();
    pipeline.outputNode = vec4(result, 1);
    pipeline.needsUpdate = true;
  };

  return {
    render() { pipeline.render(); },
    /** Main camera: amount 0..1 (1 = fully inside the water block). Call every frame. */
    setUnderwater(amount: number) { feed(mainView, camera, amount); },
    /** Inset camera state; call every frame while the inset is active. */
    setInsetUnderwater(amount: number) { if (insetCamera) feed(insetView, insetCamera, amount); },
    /** Enable (camera + rect in CSS px) or disable (null) the picture-in-picture. Returns true if the pass was rebuilt. */
    setInset(cam: PerspectiveCamera | null, rect: InsetRectPx | null, cssWidth: number, cssHeight: number) {
      insetRect = rect;
      if (!cam || !rect) {
        if (insetPass) { insetPass = null; insetCamera = null; pipeline.outputNode = vec4(mainOut, 1); pipeline.needsUpdate = true; }
        return false;
      }
      cam.aspect = rect.width / rect.height; cam.updateProjectionMatrix();
      rectUniform.value.set(rect.x / cssWidth, rect.y / cssHeight, rect.width / cssWidth, rect.height / cssHeight);
      let rebuilt = false;
      if (insetCamera !== cam) { buildInset(cam); rebuilt = true; }
      insetPass!.setResolutionScale(Number(new URLSearchParams(location.search).get('iscale')) || Math.min(1, rect.width / cssWidth));
      return rebuilt;
    },
    get insetActive() { return insetPass !== null; },
    get insetRect() { return insetRect; },
    setBloom(v: number) { glow.strength.value = v; },
    setExposure(v: number) { exposure.value = v; },
  };
}
