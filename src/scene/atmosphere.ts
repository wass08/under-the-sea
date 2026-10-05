import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Scene } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, color, float, mix, positionWorld, smoothstep, vec2, vec3 } from 'three/tsl';
import { nightSky } from './night';
import { fog } from './horizon';
import { WORLD } from '../config';
import { toSun } from './lighting';
import { skyCloud } from './rays';

/** Reflection sky: the night dome with the moon (the page background behind the diorama is drawn by CSS). */
export const skyColor = Fn(([dir]: [Node<'vec3'>]) => {
  const clouds = skyCloud(dir);
  const m = dir.dot(toSun).max(0);
  // Thin moonlit cloud veils, silver toward the moon.
  const cloudColor = mix(color('#070c1a'), color('#25304c'), m.pow(8));
  // Same height fog as post.ts sees from the waterline: the reflected horizon melts into the fog colour.
  const T = fog.density.mul(fog.height).div(dir.y.max(0.01)).negate().exp();
  return mix(fog.color, mix(nightSky(dir), cloudColor, clouds.mul(0.18)), T);
});
