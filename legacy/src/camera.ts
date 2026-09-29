import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, TANK } from './state';

export function createCamera(canvas: HTMLCanvasElement) {
  // The floor fades into the background by 65 units, so pulling far in from 2000 costs nothing
  // visible and buys ~17x the depth precision the millimetric pond film needs against the floor.
  // Near stays at 0.1: minDistance 3 puts the camera inside a 7.6-wide tank at full zoom.
  const camera = new PerspectiveCamera(39, innerWidth / innerHeight, 0.1, 120);
  camera.position.set(10.8, 7.7, 14.8);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.85, 0); controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 3; controls.maxDistance = TANK.width * 4; controls.maxPolarAngle = Math.PI / 2 - 0.025;
  controls.autoRotateSpeed = 0.24; controls.enablePan = false;
  const preset = new URLSearchParams(location.search).get('camera');
  const presets: Record<string, [number, number, number]> = { 'lighting-idle': [10.8,7.7,14.8], 'floor-wide': [14,10,19], 'lamp-side': [12,7,-8], 'lamp-side-floor': [-12,8,-13], 'lamp-base': [-8,2.6,-7], 'shadows-closeup': [7,4.5,8], 'shafts-closeup': [6.5,3.8,8.8], 'shafts-side': [-8.5,2.7,1.9], 'rock-underwater': [-.4,2.45,5.1], 'tip-closeup': [-.6,3.3,5.2], top: [0, 17, .001], '34': [-9, 5.5, 11], front: [0, 2.6, 12.5], low: [-9, 1.25, 11], plaque: [0, 0.25, TANK.depth/2+2.75], floor: [7, 4.6, 8.5], surface: [5.1, 3.1, 6.2], shore: [2.7, 3.3, 4.3] };
  if (preset && presets[preset]) { camera.position.set(...presets[preset]); controls.maxPolarAngle = Math.PI * 0.58; }
  if (preset === 'lighting-idle') controls.target.set(-.30,1.45,.15);
  if (preset === 'floor-wide') controls.target.set(0,.8,0);
  if (preset === 'lamp-side-floor') controls.target.set(-.8,1,0);
  if (preset === 'lamp-base') controls.target.set(-5.5,-.1,-3.4);
  if (preset === 'shadows-closeup') controls.target.set(.6,.7,.25);
  if (preset === 'lamp-side') controls.target.set(-.7,1.4,0);
  if (preset === 'shafts-closeup') controls.target.set(0,1.3,0);
  if (preset === 'shafts-side') controls.target.set(0,1.35,.35);
  if (preset === 'rock-underwater') controls.target.set(-1.35,1.6,-.05);
  if (preset === 'tip-closeup') controls.target.set(-1.35,2.35,-.4);
  if (preset === 'shore') controls.target.set(.4,TANK.base-.14,.35);
  if (preset === 'surface') controls.target.set(0,TANK.base-.14,0);
  if (preset === 'plaque') controls.target.set(0, -0.20, TANK.depth/2+.2);
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
  return { camera, controls, savePose() { idlePosition.copy(camera.position); idleTarget.copy(controls.target); }, shatter(point: Vector3) {
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
