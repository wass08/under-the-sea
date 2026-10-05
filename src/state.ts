import { Vector3, Vector4 } from 'three/webgpu';
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

/** Night lights shared across modules. The boat's lantern (world position, updated by the fishing rig every frame). */
export const lanternPosition = uniform(new Vector3(0, WORLD.surface + 2.5, 0));
/** Lantern output (flicker included). 0 switches it off. */
export const lanternPower = uniform(1);

/** Predator esca: world position + pulsing power (zero when hidden). */
export const predatorLure = uniform(new Vector4(0, -40, 0, 0));
