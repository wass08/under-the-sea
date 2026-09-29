import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state';

export function createCamera(canvas: HTMLCanvasElement) {
  const camera = new PerspectiveCamera(39, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(9.6, 7.1, 12.4);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.45, 0); controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 3; controls.maxDistance = 24; controls.maxPolarAngle = Math.PI / 2 - 0.025;
  controls.autoRotateSpeed = 0.24; controls.enablePan = false;
  const preset = new URLSearchParams(location.search).get('camera');
  const presets: Record<string, [number, number, number]> = { '34': [-7, 4.5, 8], front: [0, 2.2, 9.5], low: [-7, 1.25, 8], plaque: [0, 0.25, 4.5], floor: [7, 4.6, 8.5], surface: [4.4, 3.45, 5.2], shore: [2.4, 3.65, 3.8] };
  if (preset && presets[preset]) { camera.position.set(...presets[preset]); controls.maxPolarAngle = Math.PI * 0.58; }
  if (preset === 'shore') controls.target.set(.4,2.45,.35);
  if (preset === 'surface') controls.target.set(0,2.45,0);
  if (preset === 'plaque') controls.target.set(0, -0.20, 1.95);
  if (preset === 'floor') controls.target.set(2.7, -0.1, 1.5);
  controls.update();
  let inputAt = -10000, dragging = false, transition: 'none' | 'push' | 'reset' = 'none', progress = 0;
  const startPosition = new Vector3(), startTarget = new Vector3(), endPosition = new Vector3(), endTarget = new Vector3();
  const idlePosition = camera.position.clone(), idleTarget = controls.target.clone();
  controls.addEventListener('start', () => { dragging = true; inputAt = state.elapsed * 1000; });
  controls.addEventListener('end', () => { dragging = false; inputAt = state.elapsed * 1000; });
  function begin(kind: 'push' | 'reset') {
    transition = kind; progress = 0; controls.enabled = false; controls.autoRotate = false;
    startPosition.copy(camera.position); startTarget.copy(controls.target);
  }
  return { camera, controls, shatter(point: Vector3) {
    idlePosition.copy(camera.position); idleTarget.copy(controls.target);
    begin('push');
    endTarget.copy(point).lerp(new Vector3(0, 1.5, 0), 0.2);
    endPosition.copy(camera.position).lerp(point, 0.22); endPosition.y = Math.max(3.5, endPosition.y);
  }, reset() {
    begin('reset'); endTarget.copy(idleTarget); endPosition.copy(idlePosition);
  }, update(dt: number) {
    if (transition !== 'none') {
      progress = Math.min(1, progress + dt / 3.8);
      const ease = MathUtils.smootherstep(progress, 0, 1);
      camera.position.lerpVectors(startPosition, endPosition, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      if (progress === 1) { transition = 'none'; controls.enabled = true; inputAt = state.elapsed * 1000; }
    }
    controls.autoRotate = !preset && transition === 'none' && state.mode === 'idle' && !dragging && state.elapsed * 1000 - inputAt > 4500;
    controls.dampingFactor = 1 - Math.exp(-4.35 * dt);
    controls.update(dt);
  } };
}
