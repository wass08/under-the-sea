import { PerspectiveCamera } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD } from './config';

export function createCamera(canvas: HTMLCanvasElement) {
  const camera = new PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(19, 13.5, 24);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, (WORLD.bed + WORLD.surface) / 2 - 0.4, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 4; controls.maxDistance = 70; controls.maxPolarAngle = Math.PI * 0.62;
  controls.enablePan = true; controls.screenSpacePanning = true;
  controls.update();
  return { camera, controls, update() { controls.update(); } };
}
