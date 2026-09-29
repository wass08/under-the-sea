import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state';

export function createCamera(canvas: HTMLCanvasElement) {
  const camera = new PerspectiveCamera(39, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(9.6, 7.1, 12.4);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.6, 0); controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 5; controls.maxDistance = 24; controls.maxPolarAngle = Math.PI / 2 - 0.025;
  controls.autoRotateSpeed = 0.24; controls.enablePan = false;
  controls.update();
  let inputAt = -10000, dragging = false, transition: 'none' | 'push' | 'reset' = 'none', progress = 0;
  const startPosition = new Vector3(), startTarget = new Vector3(), endPosition = new Vector3(), endTarget = new Vector3();
  const idlePosition = camera.position.clone(), idleTarget = controls.target.clone();
  controls.addEventListener('start', () => { dragging = true; inputAt = performance.now(); });
  controls.addEventListener('end', () => { dragging = false; inputAt = performance.now(); });
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
      if (progress === 1) { transition = 'none'; controls.enabled = true; inputAt = performance.now(); }
    }
    controls.autoRotate = transition === 'none' && state.mode === 'idle' && !dragging && performance.now() - inputAt > 4500;
    controls.update(dt);
  } };
}
