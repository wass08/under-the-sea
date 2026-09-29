import type { Node } from 'three/webgpu';
import { cameraProjectionMatrixInverse, cameraPosition, cameraViewMatrix, float, min, max, getViewPosition, mix, normalWorld, positionWorld, screenUV, vec2, vec3, vec4, viewportDepthTexture, viewportOpaqueMipTexture } from 'three/tsl';

import { TANK, waterHeight, waterNormal } from '../state';

/** Beer–Lambert extinction in linear light (metres), shared by surface, pour and puddle. */
export const absorbWater = (radiance: Node<'vec3'>, distance: Node<'float'>) => radiance.mul(vec3(.32, .075, .038).mul(distance.max(0)).negate().exp());
export function waterOptics(thickness?: Node<'float'>) {
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(view).abs().clamp();
  const fresnel = float(.0204).add(float(1).sub(facing).pow(5).mul(.9796));
  const normalView = cameraViewMatrix.mul(vec4(normalWorld,0)).xyz;
  const behind = getViewPosition(screenUV, viewportDepthTexture().r, cameraProjectionMatrixInverse);
  const surfaceView = cameraViewMatrix.mul(vec4(positionWorld,1)).xyz;
  // Limit scene-depth path length to the tank, including a camera looking upward
  // through a side pane: air beyond the surface must never count as water.
  const ray = positionWorld.sub(cameraPosition).normalize();
  const safe = (v: Node<'float'>) => v.abs().lessThan(.00001).select(v.lessThan(0).select(-.00001,.00001),v);
  const direction = vec3(safe(ray.x),safe(ray.y),safe(ray.z));
  const t0 = vec3(-TANK.width/2,TANK.floor,-TANK.depth/2).sub(cameraPosition).div(direction);
  const t1 = vec3(TANK.width/2,TANK.top,TANK.depth/2).sub(cameraPosition).div(direction);
  const near = min(t0,t1), far = max(t0,t1);
  const entry = max(max(near.x,near.y),near.z).max(0), exit = min(min(far.x,far.y),far.z);
  const toSurface = positionWorld.sub(cameraPosition).length();
  const below = cameraPosition.sub(vec3(0,waterHeight,0)).dot(waterNormal).lessThan(0);
  const tankPath = below.select(toSurface.sub(entry).max(0), behind.sub(surfaceView).length().min(exit.sub(toSurface).max(0)));
  const path = thickness ? thickness.div(facing.max(.16)) : tankPath.min(6);
  const offset = normalView.xy.mul(vec2(1, -1)).mul(path.min(2)).mul(.018);
  const displacedUV = screenUV.add(offset).clamp(.002, .998);
  // Reject refraction offsets onto opaque foreground silhouettes.
  const shiftedDepth = getViewPosition(displacedUV, viewportDepthTexture(displacedUV).r, cameraProjectionMatrixInverse);
  const validUV = mix(screenUV, displacedUV, shiftedDepth.z.lessThan(surfaceView.z.sub(.015)).select(1, 0));
  const dispersion = offset.mul(float(1).sub(facing).pow(3)).mul(.045);
  const refracted = vec3(vec4(viewportOpaqueMipTexture(validUV.add(dispersion), float(0)) as Node<'vec4'>).r,
    vec4(viewportOpaqueMipTexture(validUV, float(0)) as Node<'vec4'>).g, vec4(viewportOpaqueMipTexture(validUV.sub(dispersion), float(0)) as Node<'vec4'>).b);
  return { fresnel, path, refracted: absorbWater(refracted, path) };
}
