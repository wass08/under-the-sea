/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from 'three/tsl';
import { lanternLight } from '../scene/night';
import { lanternPosition, simTime } from '../state';
const { cameraPosition, cameraProjectionMatrix, cross, exp, float, floor, hash, max, min, normalize, positionGeometry, screenSize, select, smoothstep, uv, vec3 } = TSL as any;

/** Exposure time of the virtual camera: a drop is drawn as the streak it traces during one frame. */
const SHUTTER = 1 / 90;

/**
 * Physically sized splash droplets (radius ~0.4–2.5 mm, i.e. 0.0015–0.01 world units), drawn as motion-blurred streaks.
 * Geometry: a unit quad (PlaneGeometry(1, 1), x across, y along). `center` is the drop's current position, `vel` its
 * velocity, `radius` its true radius (0 hides it). Width never falls below ~1 pixel, but brightness is scaled by the
 * fraction of that pixel footprint (and of the streak length) the drop really covers, so far or tiny drops stay
 * faint points instead of becoming chunky blobs.
 */
export function dropletStreak(center: any, vel: any, radius: any) {
  const toCam = cameraPosition.sub(center), dist = toCam.length().max(1e-3), view = toCam.div(dist);
  const speed = vel.length(), along0 = vel.div(speed.max(1e-4));
  const s0 = cross(along0, view), side = normalize(select(s0.length().greaterThan(1e-3), s0, cross(vec3(1, 0, 0), view)));
  const along = normalize(cross(view, side));
  const pixel = dist.mul(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));
  const d = radius.mul(2), width = max(d, pixel.mul(1.8)), length = max(d.add(speed.mul(SHUTTER)), width);
  const g = positionGeometry;
  // The streak trails behind the drop: it covers where the drop was during the last frame.
  const position = center.sub(along.mul(length.sub(d).mul(0.5))).add(side.mul(g.x.mul(width))).add(along.mul(g.y.mul(length)));
  const coverage = min(float(1), d.div(width)).mul(min(float(1), d.div(length)));
  // Hidden drops (radius 0) collapse to a point instead of drawing a pixel-wide quad.
  return { position: select(radius.greaterThan(0), position, center), coverage };
}

/**
 * Droplet radiance: a water drop is a tiny ball lens. At night most drops are faint, cool and translucent; a few catch
 * a pinpoint glint of the lantern (warm) or the moon (cool). Soft capsule profile across and along the streak.
 * Returns the colour already scaled by coverage and `alpha` (fade in/out).
 */
export function dropletColor(center: any, coverage: any, seed: any, alpha: any) {
  // Only drops whose ball-lens highlight happens to line up with the lantern and the eye flash brightly; most read as
  // dim, cool, translucent water (a steep per-drop distribution, re-rolled slowly as the drop wobbles).
  const lamp = lanternLight(center, normalize(lanternPosition.sub(center)), 1.0);
  const roll = hash(seed.add(floor(simTime.mul(hash(seed.add(5)).mul(6).add(4)))));
  const sparkle = roll.pow(6).mul(2.4);
  const body = vec3(0.32, 0.4, 0.55).mul(0.55);
  const glint = lamp.mul(0.9).mul(sparkle).add(vec3(0.55, 0.65, 0.95).mul(sparkle.mul(0.35))).add(body);
  const x = uv().x.sub(0.5).mul(2), y = uv().y.sub(0.5).mul(2);
  // Round across; along the streak the drop's head (uv.y = 1) is bright and the trail fades out behind it.
  const profile = exp(x.mul(x).mul(-4.5)).mul(smoothstep(-1.0, 0.7, y)).mul(smoothstep(1.0, 0.8, y));
  return glint.mul(profile).mul(coverage).mul(alpha).mul(2);
}
