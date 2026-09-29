import { Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { WORLD } from './config';

/** Mutable app state shared across modules. */
export const state = {
  timeScale: 1,
  elapsed: 0,
  fps: 0,
};

/** One simulation clock drives every shader (so slow motion slows everything). */
export const simTime = uniform(0);
/** Direction sunlight travels (from the sun toward the scene), normalized. */
export const sunDirection = uniform(new Vector3(-0.45, -0.82, -0.35).normalize());
/** Resting water surface height (world units). */
export const waterLevel = uniform(WORLD.surface);
