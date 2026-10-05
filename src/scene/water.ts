import { AdditiveBlending, BackSide, BufferGeometry, ClampToEdgeWrapping, DataTexture, DoubleSide, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, PlaneGeometry, RedFormat, Scene, Sphere, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Fn, If, Loop, uniform, float, vec2, vec3, vec4, mix, smoothstep, exp, max, min, pow, refract, reflect, normalize,
  positionGeometry, positionWorld, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, cameraProjectionMatrixInverse,
  screenUV, screenCoordinate, viewportDepthTexture, viewportOpaqueMipTexture, getViewPosition, texture, mx_noise_float, attribute,
  reflector, dot, abs, fract, sin, fwidth,
} from 'three/tsl';
import { WORLD } from '../config';
import { lanternPosition, lanternPower, simTime, waterLevel } from '../state';
import { hullOutside, oceanField } from '../lib/ocean';
import { godRayStrength, toSun, waterClarity } from './lighting';
import { skyColor } from './atmosphere';
import { surfaceShaft, waterSun } from './rays';
import { fog } from './horizon';
import { contactFoam } from './foam';
import { seaDetail } from './sea-detail';
import { terrainRefractionRadiance } from './materials';
import { lanternColor, lanternGain, lanternLight } from './night';

const R = WORLD.half;
/** Surface look controls (Fog & volumetrics → Water surface): grazing reflection strength and the view cosine where it starts. */
export const surfaceLook = { reflect: uniform(0.8), grazingStart: uniform(0.14) };
const bottomY = 0;

/** Terrain height field as a texture (R = world y), for cheap sun-occlusion tests inside the water volume. */
export function createHeightTexture(heights: Float32Array, resolution: number) {
  const data = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) data[i] = toHalf(heights[i]);
  const tex = new DataTexture(data, resolution, resolution, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.wrapS = tex.wrapT = ClampToEdgeWrapping; tex.needsUpdate = true;
  return tex;
}
function toHalf(v: number) {
  const f = new Float32Array(1), i = new Uint32Array(f.buffer); f[0] = v;
  const x = i[0], sign = (x >> 16) & 0x8000; let e = ((x >> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) return sign; if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >> 13);
}

/** Absorption (per world unit) — red dies first, then green; at night the deep blue dies too, so depth reads as ink. */
const sigma = vec3(0.26, 0.13, 0.075);

export function createWater(scene: Scene, camera: PerspectiveCamera, heightTexture: DataTexture) {

  // ---- Volume optics shared by the top surface and the side faces -----------------------------------------
  /**
   * Single scattering inside the water volume, raymarched from the entry point: x = faint moon shafts, y = the
   * lantern's glow, split into rays that fan out from the boat by the same moving surface openings.
   */
  const scatterRays = Fn(([origin, dir, length]: [Node<'vec3'>, Node<'vec3'>, Node<'float'>]) => {
    const steps = 12;
    const acc = float(0).toVar(), lantern = float(0).toVar();
    const air = lanternPosition.y.sub(waterLevel).max(0.3);
    const stepLen = length.div(steps);
    const jitter = fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715)).fract().mul(52.9829189));
    Loop(steps, ({ i }) => {
      const t = float(i).add(jitter).mul(stepLen);
      const p = origin.add(dir.mul(t));
      const under = waterLevel.sub(p.y);
      // Inside the water the light travels along the refracted sun direction (steeper than in air).
      const towardSurface = under.div(waterSun.y.max(0.15));
      const ps = p.xz.add(waterSun.xz.mul(towardSurface));
      // Depth below the surface lets the shaft soften with distance travelled.
      const beam = surfaceShaft(ps, under);
      // Terrain (reef mounds) shades the beams: probes at fractions of the actual light path to the surface, so
      // they never overshoot into air above shallow points nor stop short below deep ones.
      const toSurface = towardSurface.max(0);
      const q1 = p.add(waterSun.mul(toSurface.mul(0.35))), q2 = p.add(waterSun.mul(toSurface.mul(0.75)));
      const h1 = texture(heightTexture, q1.xz.div(R * 2).add(0.5)).level(float(0)).r;
      const h2 = texture(heightTexture, q2.xz.div(R * 2).add(0.5)).level(float(0)).r;
      const open = smoothstep(-0.05, 0.25, q1.y.sub(h1)).mul(smoothstep(-0.05, 0.25, q2.y.sub(h2)));
      const inside = smoothstep(-0.02, 0.2, under);
      acc.addAssign(beam.mul(open).mul(inside).mul(under.mul(-0.065).exp()).mul(stepLen));
      // Lantern: softened inverse square from the lamp, absorbed along the slanted underwater path, broken into
      // shafts by tracing each sample back to the surface point its light came through.
      const toLamp = lanternPosition.sub(p), dl = toLamp.length();
      const sLamp = lanternPosition.xz.add(p.xz.sub(lanternPosition.xz).div(under.max(0).div(air.mul(1.333)).add(1)));
      const shafts = surfaceShaft(sLamp.mul(2.6), under).mul(3.2).add(0.25);
      const fall = float(1).div(dl.div(2.6).pow(2).add(1).pow(2));
      lantern.addAssign(fall.mul(shafts).mul(under.mul(dl).div(toLamp.y.max(0.5)).mul(-0.07).exp()).mul(inside).mul(stepLen));
    });
    return vec2(acc, lantern);
  });

  /** Everything that lies below a water fragment: refracted opaque scene, absorption, in-scatter, god rays. */
  function volume(entry: Node<'vec3'>, normal: Node<'vec3'>) {
    const tintScale = 0.35;
    const toEntry = entry.sub(cameraPosition);
    const d0 = toEntry.length(), rd = toEntry.div(d0);
    const opaque = getViewPosition(screenUV, viewportDepthTexture().r, cameraProjectionMatrixInverse).length();
    let path: Node<'float'>;
    let sampleColor: Node<'vec3'>;
    let opticalDir: Node<'vec3'> = rd;
    {
      // Snell's ray bends down into the sea, even at low camera angles. A straight screen ray
      // exits the cutaway before reaching sand, exposing its silhouette as a dark top-surface patch.
      const tr = refract(rd, normal, float(1 / 1.333));
      const tv = normalize(vec3(tr.x, tr.y.min(-0.08), tr.z));
      opticalDir = tv;
      const down = tv.y.negate().max(0.08);
      const heightAt = (xz: Node<'vec2'>) => texture(heightTexture, xz.div(R * 2).add(0.5)).level(float(0)).r;
      const l0 = entry.y.sub(heightAt(entry.xz)).max(0).div(down);
      const l1 = entry.y.sub(heightAt(entry.xz.add(tv.xz.mul(l0)))).max(0).div(down);
      const terrainPath = entry.y.sub(heightAt(entry.xz.add(tv.xz.mul(l0.add(l1).mul(0.5))))).max(0).div(down).min(50);
      // A fish or rock above the floor refracts over its own shorter water path. Projecting
      // every object at bed depth stretched the school into an undulating white carpet.
      const straightDepth = viewportDepthTexture().r;
      const objectBehind = straightDepth.lessThan(0.9999).and(opaque.greaterThan(d0.add(0.05)));
      const samplePath = objectBehind.select(min(terrainPath, opaque.sub(d0).max(0)), terrainPath);
      const endpoint = entry.add(tv.mul(samplePath));
      const floorEnd = entry.add(tv.mul(terrainPath));
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(endpoint, 1)));
      const uvProjected = clip.xy.div(clip.w.max(0.0001)).mul(vec2(0.5, -0.5)).add(0.5);
      // The opaque image is a single front layer, unlike Tidewater's separate underwater
      // capture. Keep refraction conservative so a ray cannot drag a distant fish/floor layer
      // over a foreground silhouette. The Snell ray still determines the optical water depth.
      const shift = uvProjected.sub(screenUV);
      // Fade the offset out at the screen border: a shifted lookup clamped to the last row smeared it into streaks.
      const border = smoothstep(0.0, 0.04, min(min(screenUV.x, float(1).sub(screenUV.x)), min(screenUV.y, float(1).sub(screenUV.y))));
      const uv = screenUV.add(shift.mul(min(float(1), float(0.018).div(shift.length().max(0.00001)))).mul(border));
      const margin = min(min(uv.x, float(1).sub(uv.x)), min(uv.y, float(1).sub(uv.y)));
      // The refraction offset already fades out near the screen border, so the lookup stays on screen; falling back to
      // the synthetic floor there drew a seam along the frame edges.
      const onScreen = float(1); void margin;
      const uvSafe = uv.clamp(0.002, 0.998);
      const shifted = vec4(viewportOpaqueMipTexture(uvSafe, float(0)) as Node<'vec4'>);
      const straight = vec4(viewportOpaqueMipTexture(screenUV, float(0)) as Node<'vec4'>);
      const shiftedDistance = getViewPosition(uvSafe, viewportDepthTexture(uvSafe).r, cameraProjectionMatrixInverse).length();
      const depthAgreement = float(1).sub(smoothstep(0.5, 2.5, shiftedDistance.sub(opaque).abs()));
      const confidence = mix(float(1), depthAgreement, straight.a);
      const src = mix(straight, shifted, confidence);
      const viewHit = mix(getViewPosition(screenUV, viewportDepthTexture().r, cameraProjectionMatrixInverse),
        getViewPosition(uvSafe, viewportDepthTexture(uvSafe).r, cameraProjectionMatrixInverse), confidence);
      const entryView = cameraViewMatrix.mul(vec4(entry, 1)).xyz;
      const behind = smoothstep(0.04, 0.25, entryView.z.sub(viewHit.z));
      // Fade the captured floor before its cropped silhouette; the optical floor continues
      // smoothly through the mathematical cut instead of announcing a second rectangular frame.
      // The continuation must shade the same conservative screen lookup as the capture.
      // Using the uncapped Snell endpoint here gave the two floor layers different warping.
      const sampleRayView = getViewPosition(uvSafe, float(0.5), cameraProjectionMatrixInverse).normalize();
      const sampleRay = normalize(cameraWorldMatrix.mul(vec4(sampleRayView, 0)).xyz);
      const sampleDown = sampleRay.y.negate().max(0.04);
      const captureL0 = cameraPosition.y.sub(heightAt(floorEnd.xz)).max(0).div(sampleDown).min(400);
      const captureP0 = cameraPosition.add(sampleRay.mul(captureL0));
      const captureL1 = cameraPosition.y.sub(heightAt(captureP0.xz)).max(0).div(sampleDown).min(400);
      const captureP1 = cameraPosition.add(sampleRay.mul(captureL1));
      const captureL2 = cameraPosition.y.sub(heightAt(captureP1.xz)).max(0).div(sampleDown).min(400);
      const capturePoint = cameraPosition.add(sampleRay.mul(captureL2));
      const captureFootprint = fwidth(capturePoint.xz).length().max(0.001);
      // The open-sea seabed continues the floor beyond the detailed square (scene/terrain.ts buildOuterSeabed), so the
      // captured floor is valid everywhere: no fallback band at ±R (it drew the square's edge across the water).
      const floorCoverage = float(1);
      const worldHit = cameraWorldMatrix.mul(vec4(viewHit, 1)).xyz;
      const aboveFloor = smoothstep(0.25, 0.8, worldHit.y.sub(heightAt(worldHit.xz)));
      const underwaterSource = smoothstep(entry.y.add(0.35), entry.y.sub(0.1), worldHit.y);
      const coverage = src.a.mul(onScreen).mul(behind).mul(mix(floorCoverage, float(1), aboveFloor)).mul(underwaterSource);
      // Continue the optically seen sand beyond the cropped geometry, rather than substituting
      // black, the sky or the page's cream. This affects missing refraction pixels only; cut faces
      // remain finite. Alpha-aware color prevents the capture's transparent edge from darkening.
      const floorPoint = vec3(capturePoint.x, heightAt(capturePoint.xz).min(waterLevel.sub(0.05)), capturePoint.z);
      const bedRadiance = Fn(() => {
        const radiance = vec3(0).toVar();
        If(coverage.lessThan(0.999), () => {
          const e = 0.14;
          const dx = heightAt(capturePoint.xz.add(vec2(e, 0))).sub(heightAt(capturePoint.xz.sub(vec2(e, 0)))).div(2 * e);
          const dz = heightAt(capturePoint.xz.add(vec2(0, e))).sub(heightAt(capturePoint.xz.sub(vec2(0, e)))).div(2 * e);
          radiance.assign(terrainRefractionRadiance(floorPoint, normalize(vec3(dx.negate(), 1, dz.negate())), captureFootprint));
        });
        return radiance;
      })();
      const litSample = src.rgb.div(src.a.max(0.001));
      sampleColor = mix(bedRadiance, litSample, coverage);
      const hitPath = viewHit.sub(entryView).length().min(terrainPath);
      path = mix(terrainPath, hitPath, coverage).max(0).toVar();
    }
    const absorbPath = path.mul(smoothstep(0, 6, path).mul(0.6).add(0.4));
    const transmittance = exp(sigma.mul(waterClarity).mul(absorbPath).negate());
    const deep = float(1).sub(exp(path.mul(-0.06).mul(waterClarity)));
    // Night water: a faint moonlit blue that deepens to near-black ink (lit fish and the lantern carry the brights).
    const inscatter = mix(vec3(0.0012, 0.0045, 0.012), vec3(0.0003, 0.0011, 0.0038), deep).mul(float(1).sub(exp(path.mul(-0.12).mul(waterClarity))).pow(1.8));
    const rays = scatterRays(entry, opticalDir, path);
    const phase = float(0.6).add(pow(dot(rd, waterSun).max(0), 3).mul(2.4));
    const rayColor = vec3(0.40, 0.62, 1.0).mul(rays.x).mul(phase).mul(godRayStrength).mul(0.018);
    // Lantern glow tinted by the water it crosses: amber near the boat, greener as it goes deep.
    const glowColor = lanternColor.mul(vec3(0.9, 1.0, 0.85)).mul(lanternPower).mul(lanternGain).mul(rays.y).mul(0.06).mul(fog.lanternBeam);
    const baseTint = vec3(0.0006, 0.003, 0.009).mul(tintScale);
    return { color: sampleColor.mul(transmittance).mul(vec3(0.94, 0.99, 1.0)).add(baseTint).add(inscatter).add(rayColor).add(glowColor), path, rd, d0, opaque };
  }

  // Exact unpolarized air/water Fresnel: the transition at oblique angles is gentler than
  // boosted Schlick, so readable transmission and sky reflection coexist across the orbit.
  const fresnel = (n: Node<'vec3'>, rd: Node<'vec3'>) => {
    const c = dot(n, rd.negate()).abs().clamp(0.0001, 1);
    const ct = float(1).sub(float(1).sub(c.mul(c)).div(1.333 * 1.333)).sqrt();
    const rs = c.sub(ct.mul(1.333)).div(c.add(ct.mul(1.333)));
    const rp = c.mul(1.333).sub(ct).div(c.mul(1.333).add(ct));
    return rs.mul(rs).add(rp.mul(rp)).mul(0.5);
  };

  // ---- Top surface ------------------------------------------------------------------------------------------
  // Open sea, no cutaway. Above water the grid is centred on the scene: a uniform ~0.3-unit spacing out to 45
  // units (the action and the default camera both sit inside), then the outer rows stretch radially (monotone,
  // so no folds) to ~200, where the fog has already swallowed them. Submerged, the roof re-centres on the camera.
  const submerged = smoothstep(0.05, 0.8, waterLevel.sub(cameraPosition.y));
  const grid = positionGeometry.xz, ring = max(grid.x.abs(), grid.y.abs()).div(R);
  const stretch = ring.sub(0.75).max(0).pow(2).mul(37).add(1).mul(45 / (0.75 * R));
  const oceanXZ = mix(grid.mul(stretch), cameraPosition.xz.add(grid.mul(ring.pow(4).mul(9).add(1))), submerged);
  const field = oceanField(oceanXZ, simTime);
  const surfacePosition = vec3(oceanXZ.x, waterLevel.add(field.h), oceanXZ.y);
  // Evaluate the analytic slope at each pixel, avoiding interpolated triangle facets in sun highlights.
  const pixelFootprint = fwidth(positionWorld.xz).length().max(0.001);
  const pixelField = oceanField(positionWorld.xz, simTime, pixelFootprint);
  const baseNormal = normalize(vec3(pixelField.gx.negate(), 1, pixelField.gz.negate()));

  const reflection = reflector({ resolutionScale: 0.35, bounces: false });
  reflection.target.rotation.x = -Math.PI / 2;
  // The mirror plane must sit on the water, not at y = 0: a plane at the origin mirrors the seabed and
  // beach into the reflection, smearing sand-coloured streaks across the surface.
  reflection.target.position.y = waterLevel.value;
  scene.add(reflection.target);
  (reflection as unknown as { reflector: { getVirtualCamera(c: PerspectiveCamera): PerspectiveCamera } }).reflector.getVirtualCamera(camera).layers.set(1);

  // With a picture-in-picture inset active, or the camera underwater, the planar reflector (a whole extra scene render)
  // is replaced by the analytic sky. Each combination is its own mesh + material, built and compiled once (see warm())
  // and switched by visibility: rebuilding the graph, toggling depthWrite or even swapping a mesh's material re-ran
  // three's per-object setup and stalled 150–350 ms at every crossing of the surface.
  const buildSurfaceColor = (planarEnabled: boolean, surfaceMaterial: MeshBasicNodeMaterial) => {
  // Capillary normal detail, shared by the above- and below-water branches.
  const fineA = mx_noise_float(vec3(positionWorld.xz.mul(3).add(simTime.mul(0.35)), simTime.mul(0.2)));
  const fineB = mx_noise_float(vec3(positionWorld.xz.mul(7).sub(simTime.mul(0.5)), 7.1));
  const aboveColor = Fn(() => {
    const dist = positionWorld.sub(cameraPosition).length();
    // Capillary detail fades with distance so far water never resolves into sub-pixel glitter.
    const footprint = pixelFootprint;
    const wind = seaDetail(positionWorld.xz, simTime, footprint);
    const detail = float(1).sub(smoothstep(0.08, 0.4, footprint));
    const fine = vec3(wind.slopes.x.negate(), 0, wind.slopes.y.negate());
    const N = normalize(baseNormal.add(fine)).toVar();
    // Refraction follows the broad swell so the seabed and fish bend coherently instead of shattering.
    const Nswell = normalize(baseNormal.add(fine.mul(0.18)));
    const body = volume(positionWorld, Nswell);
    const V = body.rd.negate();
    const Fphys = fresnel(N, body.rd);
    // Art-directed grazing reflection: exact Fresnel alone still lets bright fish show through at shallow angles. Toward
    // grazing (judged on the smooth swell normal, so it doesn't sparkle) the surface turns mirror-like and what little
    // is transmitted is extinguished along the long slanted path, so far water shows sky, moon, mountains and lanterns.
    const cosView = dot(Nswell, body.rd.negate()).abs();
    const grazing = smoothstep(surfaceLook.grazingStart, 0.04, cosView).mul(surfaceLook.reflect);
    const F = max(Fphys, grazing);
    const transmitKeep = float(1).sub(grazing.mul(0.85));
    const Rraw = reflect(body.rd, N);
    const slopeVariance = wind.variance.add(pixelField.variance);
    const unresolved = slopeVariance.sqrt();
    const R3 = normalize(vec3(Rraw.x, Rraw.y.max(0.01).add(unresolved.mul(1.3).mul(float(1).sub(Rraw.y.max(0)))), Rraw.z));
    const reflUV = screenUV.flipX().add(N.xz.mul(vec2(0.8, -0.8)).div(dist.max(1))).clamp(0.002, 0.998);
    // The sun is drawn by the specular lobe below; cap the sky's own sun disc so it is not counted twice.
    const analytic = skyColor(R3).min(1.6);
    // A transparent page backdrop must not turn empty portions of the reflection black.
    const planarSample = planarEnabled ? reflection.sample(reflUV) : null;
    const planar = planarSample ? mix(analytic, planarSample.rgb, planarSample.a) : analytic;
    const reflected = mix(analytic, planar, 0.85);
    // Sun specular: GGX lobes whose roughness grows with distance, giving soft coherent glints rather than
    // per-pixel sparkle. The sun is a near-white light; the warmth stays in the sky, not on the water.
    const H = normalize(toSun.add(V));
    const nh = dot(N, H).max(0), nl = dot(N, toSun).max(0), nv = dot(N, V).abs().max(0.08);
    const ggx = (a: Node<'float'>) => { const a2 = a.mul(a), d = nh.mul(nh).mul(a2.sub(1)).add(1); return a2.div(d.mul(d).mul(Math.PI)); };
    const Fh = float(0.02).add(float(0.98).mul(float(1).sub(dot(V, H).max(0)).pow(5)));
    const rough = float(0.032 ** 2).add(slopeVariance.mul(2)).add(footprint.mul(0.002).min(0.012)).sqrt();
    const lobe = ggx(rough.max(0.025)).add(ggx(float(0.18)).mul(0.03));
    const spec = lobe.mul(Fh).mul(nl).div(nv.mul(4)).mul(1.3).min(2.2);
    // Moonlight: a cool, dim source, so its glitter path stays a silver thread rather than a sheet.
    const sunLight = vec3(0.5, 0.62, 1.0).mul(0.22);
    // Lantern on the water: a warm glittering path broken up by the waves (a point light: its own half vector).
    const toLamp = lanternPosition.sub(positionWorld), lampDist = toLamp.length(), Ll = toLamp.div(lampDist);
    const Hl = normalize(Ll.add(V));
    const nhl = dot(N, Hl).max(0), nll = dot(N, Ll).max(0);
    const ggxL = (a: Node<'float'>) => { const a2 = a.mul(a), d = nhl.mul(nhl).mul(a2.sub(1)).add(1); return a2.div(d.mul(d).mul(Math.PI)); };
    const FhL = float(0.02).add(float(0.98).mul(float(1).sub(dot(V, Hl).max(0)).pow(5)));
    const lampSpec = ggxL(rough.max(0.05)).add(ggxL(float(0.22)).mul(0.25)).mul(FhL).mul(nll).div(nv.mul(4)).min(6)
      .mul(float(1).div(lampDist.div(4.5).pow(2).add(1)));
    const lampLight = lanternColor.mul(lanternPower).mul(lanternGain).mul(lampSpec).mul(0.55);
    // World-space depth makes the wash follow the beach from every camera angle.
    const terrainY = texture(heightTexture, positionWorld.xz.div(R * 2).add(0.5)).level(float(0)).r;
    const depthBelow = positionWorld.y.sub(terrainY);
    const swirl = mx_noise_float(vec3(positionWorld.xz.mul(2), simTime.mul(0.35))).mul(0.5).add(0.5);
    const lap = float(0.62).add(pixelField.h.mul(1.2)).add(sin(simTime.mul(0.73).add(swirl.mul(6))).mul(0.12));
    // Ridges of a drifting noise read as bubble filaments; the dense band breaks up into lace offshore.
    const laceNoise = mx_noise_float(vec3(positionWorld.xz.mul(vec2(3.4, 4.2)).add(swirl.mul(1.5)), simTime.mul(0.22)));
    const lace = smoothstep(0.6, 0.92, float(1).sub(laceNoise.abs()));
    const wash = smoothstep(lap, lap.mul(0.25), depthBelow);
    const shoreFoam = wash.mul(smoothstep(0.22, 0.65, swirl.add(laceNoise.mul(0.25)))).mul(0.88).max(wash.mul(lace).mul(0.7))
      .add(smoothstep(1.4, 0.0, depthBelow).mul(0.3).mul(lace).mul(swirl.add(0.3)));
    const foam = shoreFoam.max(contactFoam(positionWorld.xz)).mul(smoothstep(-0.2, 0.05, depthBelow));
    // Sunlit foam stays just under the bloom threshold so it reads as matte bubbles, not a glow.
    const foamColor = vec3(0.07, 0.1, 0.17).mul(nl.mul(0.4).add(0.8)).add(lanternLight(positionWorld, N, 0.6).mul(0.05));
    const base = body.color.mul(transmitKeep).mul(float(1).sub(F)).add(reflected.mul(F)).add(sunLight.mul(spec)).add(lampLight);
    // Whitecaps only where wave groups break (see oceanField). Two scales of breakup, both used raw rather
    // than as ridges: a blobby mid-scale mask (the shore noises) tears patches apart, and fine bubble cells
    // (the slow-drifting capillary noise, ~0.15 units, already computed) give their texture. Only the crest
    // core stays nearly solid; its rim is bubbles, and the trail is specks whose threshold rises with age.
    // Bubble cells relax to their mean coverage with distance so far foam never sparkles.
    const blob = swirl.mul(0.6).add(laceNoise.mul(0.2)).add(0.2);
    const bubbleN = mix(float(0.55), fineB.mul(0.5).add(0.5), detail);
    const core = smoothstep(0.55, 0.95, pixelField.crest);
    const fresh = pixelField.crest.mul(smoothstep(0.28, 0.5, blob)).mul(mix(smoothstep(0.38, 0.58, bubbleN), float(1), core.mul(0.8)));
    const age = float(1).sub(pixelField.trail);
    const specks = smoothstep(age.mul(0.4).add(0.44), age.mul(0.3).add(0.62), bubbleN);
    const whitecap = fresh.max(pixelField.trail.mul(smoothstep(0.4, 0.66, blob)).mul(specks).mul(0.75));
    // Calm deep water seldom breaks: most whitewater belongs to the shallow surf zone.
    const breaking = whitecap.mul(wind.gust.mul(0.65).add(0.35)).mul(mix(float(0.1), float(0.65), smoothstep(4, 0.4, depthBelow)));
    return mix(base, foamColor, max(foam.min(0.9), breaking).mul(float(1).sub(F.mul(0.3))));
  })();
  /** Deep-water colour for rays that never reach the surface (total internal reflection): brighter up, darker down. */
  const mediumColor = (y: Node<'float'>) => mix(vec3(0.0002, 0.0007, 0.0024), vec3(0.0012, 0.0048, 0.012), smoothstep(-0.75, 0.45, y));
  surfaceMaterial.colorNode = Fn(() => {
    const out = vec3(0).toVar();
    // Seen from below, the roof runs out to grazing distances where capillary noise and the shortest waves fall
    // under a pixel and glitter. Fine detail stays full overhead (~10 units) and is gone by ~45; far off, the
    // swell normal also relaxes partway toward flat, as a mip would, so the horizon stays calm.
    const roofDist = positionWorld.sub(cameraPosition).length();
    const fineBelow = vec3(fineA, 0, fineB).mul(float(1).sub(smoothstep(10, 45, roofDist)));
    const swellBelow = normalize(mix(baseNormal, vec3(0, 1, 0), smoothstep(30, 90, roofDist).mul(0.6)));
    const N = normalize(swellBelow.add(fineBelow.mul(0.075)));
    const Nsoft = normalize(swellBelow.mul(0.6).add(vec3(0, 0.4, 0)).add(fineBelow.mul(0.03)));
    const rdC = positionWorld.sub(cameraPosition).div(roofDist);
    If(dot(rdC, N).greaterThan(0), () => {
      // Seen from below: bright Snell's window with the sky above, total internal reflection outside it.
      const cosI = dot(rdC, N).clamp(0, 1), eta = 1.333;
      const k = float(1).sub(float(eta * eta).mul(float(1).sub(cosI.mul(cosI))));
      const windowMask = smoothstep(0.0, 0.12, k);
      const refr = refract(rdC, Nsoft.negate(), float(eta));
      const shimmer = mx_noise_float(vec3(positionWorld.xz.mul(1.6).add(simTime.mul(0.5)), simTime.mul(0.7))).mul(0.25).add(1.0);
      const Fw = float(0.02).add(float(0.98).mul(float(1).sub(cosI).pow(5))).mul(1.0);
      // Through Snell's window: the night sky and moon, and the lantern's warm disc smeared by the waves.
      const lampDir = normalize(lanternPosition.sub(positionWorld));
      // Kept to a soft warm glint: the paper lantern itself shows through the opaque-pass silhouette below, and a big hot
      // smear here would outshine it.
      const lampSeen = lanternColor.mul(lanternPower).mul(dot(refr, lampDir).max(0).pow(400).mul(2.5).add(dot(refr, lampDir).max(0).pow(12).mul(0.03)));
      const windowColor = mix(skyColor(refr).min(0.45), vec3(0.006, 0.011, 0.024), 0.3).mul(1.5).mul(vec3(0.65, 0.93, 1.0)).add(lampSeen).mul(shimmer).mul(float(1).sub(Fw));
      const medium = mediumColor(reflect(rdC, N.negate()).y);
      // The lantern lights the roof around the boat: a warm pool on the underside of the surface (an irradiance falloff
      // h / (d² + h²)^1.5 from the lamp, broken by the ripples), the bright ground the raft is silhouetted against.
      const lampH = lanternPosition.y.sub(waterLevel).max(0.3);
      const lampD = positionWorld.xz.sub(lanternPosition.xz);
      const irradiance = lampH.div(lampD.dot(lampD).add(lampH.mul(lampH)).pow(1.5));
      const ripple = fineA.mul(0.35).add(fineB.mul(0.25)).add(1).max(0.3);
      const pool = lanternColor.mul(lanternPower).mul(irradiance).mul(ripple).mul(0.55).mul(fog.lanternBeam.mul(0.74));
      const roof = mix(medium, windowColor.add(medium.mul(Fw)), windowMask).add(pool).toVar();
      // Whatever floats above the surface (raft, fisherman, rod, line, lantern) is in the opaque pass behind this roof
      // fragment: show it as a hard silhouette. Its underside is unlit, so it is darkened further; only emissive pixels
      // (the paper lantern) keep their light. No refraction offset: the raft sits on the surface, so it barely bends.
      const hitDepth = viewportDepthTexture(screenUV).r;
      const hitView = getViewPosition(screenUV, hitDepth, cameraProjectionMatrixInverse);
      const hitWorld = cameraWorldMatrix.mul(vec4(hitView, 1)).xyz;
      const behind = hitView.length().sub(roofDist);
      const floating = smoothstep(0.0, 0.03, behind).mul(float(1).sub(smoothstep(10, 14, behind)))
        .mul(smoothstep(waterLevel.sub(0.35), waterLevel.sub(0.1), hitWorld.y)).mul(hitDepth.lessThan(0.9999).select(float(1), float(0))).mul(submerged);
      const above = vec4(viewportOpaqueMipTexture(screenUV, float(0)) as Node<'vec4'>).rgb;
      const glowLuma = above.dot(vec3(0.2126, 0.7152, 0.0722));
      const silhouette = above.mul(mix(float(0.05), float(1), smoothstep(0.6, 2.0, glowLuma)));
      out.assign(mix(roof, silhouette, floating));
    }).Else(() => { out.assign(aboveColor); });
    return out;
  })();
  };
  const variants = new Map<string, MeshBasicNodeMaterial>();
  const variant = (planar: boolean, depthWrite: boolean) => {
    const key = `${planar}|${depthWrite}`;
    let m = variants.get(key);
    if (!m) {
      m = new MeshBasicNodeMaterial({ transparent: true, depthWrite, side: DoubleSide });
      m.fog = false; m.positionNode = surfacePosition; m.opacityNode = float(1);
      buildSurfaceColor(planar, m);
      variants.set(key, m);
    }
    return m;
  };
  /** The combinations in use: overview (planar), underwater (writes depth), inset above water, inset underwater. */
  const COMBOS: [boolean, boolean][] = [[true, false], [false, true], [false, false]];
  // The bamboo raft is solid and floats on the water, so nothing is cut out of the surface (hullOutside stays
  // available for a hollow hull).
  void hullOutside;
  const geometry = new PlaneGeometry(R * 2, R * 2, 384, 384); geometry.rotateX(-Math.PI / 2);
  geometry.boundingSphere = new Sphere(new Vector3(0, WORLD.surface, 0), R * 12);
  const meshes = new Map<MeshBasicNodeMaterial, Mesh>();
  for (const [p, d] of COMBOS) {
    const m = new Mesh(geometry, variant(p, d));
    m.name = 'Water surface'; m.renderOrder = 4; m.frustumCulled = false; m.visible = p;
    m.onBeforeRender = () => {
      if (reflection.target.position.y === waterLevel.value) return;
      reflection.target.position.y = waterLevel.value; reflection.target.updateMatrixWorld();
    };
    meshes.set(m.material as MeshBasicNodeMaterial, m); scene.add(m);
  }
  /** The overview surface (also the casting raycast target: every variant shares the geometry). */
  const surface = meshes.get(variant(true, false))!;

  let planar = true, inside = false;
  const DBG = new URLSearchParams(location.search).get('wvar');
  const apply = () => { const active = DBG === 'planar' ? variant(true, false) : DBG === 'nodepth' ? variant(planar && !inside, false) : DBG === 'planardepth' ? variant(!inside, false) : variant(planar && !inside, inside); for (const [m, mesh] of meshes) mesh.visible = m === active; };
  /** While the camera is inside the water the surface must write depth so post-processing fog sees it. */
  const setInside = (on: boolean) => { inside = on; apply(); };
  /** Planar reflection for an extra camera (the inset) must only draw layer 1, like the main one. */
  const setInsetActive = (on: boolean) => { planar = !on; apply(); };
  /**
   * Show variant `frame` of the warm-up (one per frame: the scene pass renders once per frame) so every variant is
   * built and compiled during the first frames. Returns false once all of them have been drawn.
   */
  const warm = (frame: number) => {
    if (frame >= COMBOS.length) { apply(); return false; }
    const active = variant(...COMBOS[frame]); for (const [m, mesh] of meshes) mesh.visible = m === active;
    return true;
  };
  return { surface, meshes: [...meshes.values()], reflection, setInside, setInsetActive, warm };
}
