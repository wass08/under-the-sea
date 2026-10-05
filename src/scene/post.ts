import { DataTexture, Matrix4, PerspectiveCamera, RenderPipeline, Scene, Vector3, Vector4, WebGPURenderer } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, Loop, atan, exp, float, fract, min, mix, pass, perspectiveDepthToViewZ, screenCoordinate, screenUV, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { WORLD } from '../config';
import { surfaceShaft, waterSun } from './rays';
import { lanternPosition, lanternPower, waterLevel } from '../state';
import { lanternColor, lanternGain, nightSky, waterMedium } from './night';
import { FAR_LANTERNS, farLanterns, fog } from './horizon';
import { godRayStrength, toSun } from './lighting';

export const postParams = { bloom: 0.2, exposure: 1.05 };
export type InsetRectPx = { x: number; y: number; width: number; height: number };

/** Uniforms describing one view (the main camera or the inset camera) for the underwater medium. */
function makeView() {
  return { underwater: uniform(0), camPos: uniform(new Vector3()), invProj: uniform(new Matrix4()), camWorld: uniform(new Matrix4()), near: uniform(0.2), far: uniform(900) };
}
type View = ReturnType<typeof makeView>;
const feed = (view: View, camera: PerspectiveCamera, amount: number) => {
  // OrbitControls moves the camera but three only refreshes matrixWorld while rendering: without this the fog (and its
  // lantern halos) used last frame's view, so halos trailed their lanterns while the camera moved.
  camera.updateMatrixWorld();
  view.underwater.value = amount; view.camPos.value.copy(camera.position);
  view.invProj.value.copy(camera.projectionMatrixInverse); view.camWorld.value.copy(camera.matrixWorld);
  view.near.value = camera.near; view.far.value = camera.far;
};

/**
 * Height fog with lantern halos, bloom, vignette, a slight grade, and the underwater medium: when a camera is in the water a
 * depth-based pass adds absorption, a vertical blue gradient veil and raymarched god rays. A second camera
 * (picture-in-picture inset) is rendered by its own scene pass at inset resolution and composited into a rect.
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, heightTexture: DataTexture) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const beauty = scenePass.getTextureNode();
  const exposure = uniform(postParams.exposure);
  // A low threshold so the lantern, algae and neon fish bloom; kept light (the fog does the glow).
  const glow = bloom(beauty.min(8), postParams.bloom, 0.5, 0.62);
  void WORLD;
  const mainView = makeView(), insetView = makeView();

  /** Absorption + veil + god rays for one view. uvN = screen position in that view's image; returns linear colour. */
  const underwaterLook = (view: View, color: Node<'vec3'>, viewZ: Node<'float'>, uvN: Node<'vec2'>) => {
    const ndc = vec2(uvN.x.mul(2).sub(1), float(1).sub(uvN.y).mul(2).sub(1));
    const rayV4 = view.invProj.mul(vec4(ndc, 1, 1)), rayV = rayV4.xyz.div(rayV4.w);
    const rd = view.camWorld.mul(vec4(rayV, 0)).xyz.normalize();
    // Transparent surface depth is not present in every scene-pass depth texture. Stop the
    // medium at the actual water surface, so we never absorb the sky or march shafts through air.
    const waterDistance = rd.y.greaterThan(0.001).select(waterLevel.sub(view.camPos.y).div(rd.y.max(0.001)), float(55)).max(0);
    const dist = min(viewZ.negate().mul(rayV.length()).div(rayV.z.negate()), waterDistance).min(55);

    const godRays = Fn(([length]: [Node<'float'>]) => {
      const steps = 32, acc = float(0).toVar(), lamp = float(0).toVar(), stepLen = length.div(steps);
      const air = lanternPosition.y.sub(waterLevel).max(0.3);
      const jitter = fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)).fract().mul(52.9829189));
      Loop(steps, ({ i }) => {
        const p = view.camPos.add(rd.mul(float(i).add(jitter).mul(stepLen)));
        const under = waterLevel.sub(p.y);
        const ps = p.xz.add(waterSun.xz.mul(under.div(waterSun.y.max(0.15))));
        // Integrate animated openings with depth-softened edges for volume and parallax.
        const beam = surfaceShaft(ps, under);
        const sunDistance = under.max(0).div(waterSun.y.max(0.15));
        const q = p.add(waterSun.mul(sunDistance.mul(0.38))), q2 = p.add(waterSun.mul(sunDistance.mul(0.82)));
        const open = smoothstep(-0.05, 0.3, q.y.sub(texture(heightTexture, q.xz.div(WORLD.half * 2).add(0.5)).level(float(0)).r))
          .mul(smoothstep(-0.05, 0.3, q2.y.sub(texture(heightTexture, q2.xz.div(WORLD.half * 2).add(0.5)).level(float(0)).r)));
        const footprint = float(1);
        const travel = float(i).add(jitter).mul(stepLen);
        const attenuation = under.mul(-0.07).sub(travel.mul(0.055)).exp();
        acc.addAssign(beam.mul(open).mul(footprint).mul(smoothstep(0.05, 0.6, under)).mul(attenuation).mul(stepLen));
        // The lantern's glow fanning down from the boat (same construction as the water volume's).
        const toLamp = lanternPosition.sub(p), dl = toLamp.length();
        const sLamp = lanternPosition.xz.add(p.xz.sub(lanternPosition.xz).div(under.max(0).div(air.mul(1.333)).add(1)));
        // Tighter than before: the glow gathers in a cone under the lamp and leaves the far water dark, so the raft
        // and the lit fish read against black rather than an amber haze.
        const shafts = surfaceShaft(sLamp.mul(2.6), under).mul(3.2).add(0.12);
        const fall = float(1).div(dl.div(2.0).pow(2).add(1).pow(2));
        lamp.addAssign(fall.mul(shafts).mul(under.mul(dl).div(toLamp.y.max(0.5)).mul(-0.07).sub(travel.mul(0.05)).exp()).mul(footprint).mul(smoothstep(0.05, 0.6, under)).mul(stepLen));
      });
      return vec2(acc, lamp);
    });

    return Fn(() => {
    const out = color.toVar();
    If(view.underwater.greaterThan(0.01), () => {
      const sigma = waterMedium.sigma;
      const absorbed = color.mul(exp(sigma.mul(dist).negate()));
      const midDepth = waterLevel.sub(view.camPos.y.add(rd.y.mul(dist).mul(0.5))).max(0);
      // Saturated cyan near the surface fading to deep blue below; brighter still when looking up toward the light.
      // Night medium: ink blue, a little lighter toward the moonlit surface.
      const veilColor = mix(waterMedium.near, waterMedium.deep, smoothstep(0.0, 16.0, midDepth));
      const bright = mix(veilColor, vec3(0.0016, 0.0075, 0.019), smoothstep(0.0, 0.85, rd.y).mul(0.4));
      const veil = bright.mul(float(1).sub(exp(dist.mul(-0.075))));
      const sunCos = rd.dot(waterSun).clamp(-1, 1);
      // Forward scattering makes light fans strongest when looking toward the sun.
      const phase = float(0.6975).div(float(1.3025).sub(sunCos.mul(1.1)).pow(1.5)).min(5);
      const scatter = godRays(min(dist, 55));
      const rays = vec3(0.45, 0.65, 1.0).mul(scatter.x).mul(phase.mul(0.7).add(0.22)).mul(godRayStrength).mul(0.095);
      const lamp = lanternColor.mul(vec3(0.9, 1.0, 0.85)).mul(lanternPower).mul(lanternGain).mul(scatter.y).mul(0.03).mul(fog.lanternBeam);
      out.assign(mix(color, absorbed.add(veil).add(rays).add(lamp), view.underwater));
    });
    return out;
    })();
  };

  /**
   * Height fog for the part of each ray that travels through air (it stops at the water plane; the water shader
   * owns everything below). Analytic optical depth of an exponential density layer sitting on the water, the night
   * sky behind empty pixels, a moon-side brightening, and light scattered by the fog around every lantern: the
   * closed-form integral of a point light's inverse square along the ray, (atan((L−t₀)/h) + atan(t₀/h)) / h.
   */
  const airFog = (view: View, color: Node<'vec3'>, viewZ: Node<'float'>, uvN: Node<'vec2'>) => {
    const ndc = vec2(uvN.x.mul(2).sub(1), float(1).sub(uvN.y).mul(2).sub(1));
    const rayV4 = view.invProj.mul(vec4(ndc, 1, 1)), rayV = rayV4.xyz.div(rayV4.w);
    const rd = view.camWorld.mul(vec4(rayV, 0)).xyz.normalize(), o = view.camPos;
    const background = viewZ.lessThan(view.far.mul(-0.995));
    const sceneDist = background.select(float(4000), viewZ.negate().mul(rayV.length()).div(rayV.z.negate()));
    const toWater = rd.y.lessThan(-0.0005).select(waterLevel.sub(o.y).div(rd.y.min(-0.0005)), float(4000));
    const L = min(sceneDist, toWater).max(0);
    const H = fog.height, k = rd.y.div(H);
    const base = fog.density.mul(o.y.sub(waterLevel).div(H).negate().exp());
    const integral = k.abs().greaterThan(1e-4).select(float(1).sub(k.mul(L).negate().min(60).exp()).div(k), L);
    const T = base.mul(integral).add(fog.haze.mul(L.min(600))).max(0).negate().exp();
    const moon = rd.dot(toSun).max(0);
    // A subtle silver brightening toward the moon (kept small against the ink fog: the lantern stays the brightest thing).
    const fogColor = fog.color.add(vec3(0.026, 0.034, 0.06).mul(moon.pow(10).mul(0.6).add(moon.pow(3).mul(0.1))).mul(fog.moonGlow));
    // Empty pixels: the sky (above the water plane) or the sea running on into the fog (below it).
    const behind = background.select(rd.y.greaterThan(0).select(nightSky(rd), fog.color), color);
    const glowAt = (P: Node<'vec3'>, power: Node<'float'>, tint: Node<'vec3'>, radius: number) => {
      const rel = P.sub(o), t0 = rel.dot(rd), h = rel.sub(rd.mul(t0)).length().max(0.04);
      // The fog also absorbs on the way: halos fade over a few units instead of tinting the whole sky.
      const along = atan(L.sub(t0).div(h)).add(atan(t0.div(h))).div(h).mul(h.div(radius).negate().exp());
      const sigma = fog.density.mul(P.y.sub(waterLevel).max(0).div(H).negate().exp());
      return tint.mul(power.mul(sigma).mul(along));
    };
    let far: Node<'vec3'> = vec3(0);
    for (let i = 0; i < FAR_LANTERNS; i++) far = far.add(glowAt(farLanterns[i].xyz, farLanterns[i].w, vec3(1.0, 0.5, 0.18), 3.5));
    const lights = glowAt(lanternPosition, lanternPower.mul(lanternGain).mul(0.5), lanternColor, 5).mul(fog.glow).add(far.mul(fog.farGlow));
    return behind.mul(T).add(fogColor.mul(float(1).sub(T))).add(lights);
  };

  const grade = (c: Node<'vec3'>, underwater: Node<'float'>) => {
    const luma = c.dot(vec3(0.2126, 0.7152, 0.0722));
    // Preserve above-water greens and sand hues; the underwater medium supplies its own blue tint.
    return mix(vec3(luma), c, mix(float(1.12), float(1.08), underwater)).sub(0.08).mul(1.03).add(0.08).max(0);
  };
  const vignette = smoothstep(0.25, 0.85, screenUV.sub(0.5).length()).mul(-0.3).add(1);

  const mainViewZ = scenePass.getViewZNode();
  const mainFogged = mix(airFog(mainView, beauty.rgb, mainViewZ, screenUV), beauty.rgb, mainView.underwater);
  const mainMedium = underwaterLook(mainView, mainFogged, mainViewZ, screenUV);
  const mainOut = grade(mainMedium, mainView.underwater).add(glow.rgb.mul(float(1).sub(mainView.underwater.mul(0.65)))).mul(exposure).mul(vignette);
  // Opaque now: the fog and sky fill every pixel.
  const mainAlpha = float(1);
  pipeline.outputNode = vec4(mainOut, mainAlpha);

  // ---- Picture-in-picture ---------------------------------------------------------------------------------
  const rectUniform = uniform(new Vector4(0, 0, 1, 1));
  let insetPass: ReturnType<typeof pass> | null = null, insetCamera: PerspectiveCamera | null = null, insetRect: InsetRectPx | null = null;
  const buildInset = (cam: PerspectiveCamera) => {
    insetPass = pass(scene, cam);
    insetCamera = cam;
    const local = screenUV.sub(rectUniform.xy).div(rectUniform.zw);
    const inside = local.x.greaterThanEqual(0).and(local.x.lessThanEqual(1)).and(local.y.greaterThanEqual(0)).and(local.y.lessThanEqual(1));
    const insetBeauty = insetPass.getTextureNode('output').sample(local).level(float(0));
    const color = insetBeauty.rgb;
    const depth = insetPass.getTextureNode('depth').sample(local).level(float(0));
    const viewZ = perspectiveDepthToViewZ(depth, insetView.near, insetView.far);
    const result = Fn(() => {
      const o = mainOut.toVar();
      If(inside, () => {
        const fogged = mix(airFog(insetView, color, viewZ, local), color, insetView.underwater);
        const medium = underwaterLook(insetView, fogged, viewZ, local);
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
        if (insetPass) { insetPass = null; insetCamera = null; pipeline.outputNode = vec4(mainOut, mainAlpha); pipeline.needsUpdate = true; }
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
