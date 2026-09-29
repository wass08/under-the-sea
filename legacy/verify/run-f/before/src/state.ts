import { Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';

export const TANK = { width: 6, depth: 3.5, floor: 0.16, top: 3.66, base: 2.59 };
export const state = {
  timeScale: 1, elapsed: 0, mode: 'idle' as 'idle' | 'cracked' | 'shattered',
  impact: new Vector3(0.6, 2.15, TANK.depth / 2), wall: 0, hasImpact: false,
  cracks: 0, spilling: false, muted: true, fps: 0, lastSlosh: -100, shatterTime: 0, brokenCount: 0,
};
// One simulation clock drives every shader; built-in real-time nodes would ignore slow motion.
export const simTime = uniform(0);
export const waterHeight = uniform(TANK.base);
export const waterNormal = uniform(new Vector3(0, 1, 0));
export const sunDirection = uniform(new Vector3(-0.45, 0.8, 0.35).normalize());
export const sunElevation = uniform(0.8);
export { random } from './lib/random';
