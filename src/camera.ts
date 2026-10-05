import { PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu';
import type { FolderApi } from 'tweakpane';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD } from './config';
import { terrainHeight } from './scene/field';

/** Clearance kept between the camera (and the orbit target) and the seabed. */
const CLEARANCE = 0.6;
/** Highest seabed under a small footprint around (x, z), so the near plane never dips into a slope. */
const groundAt = (x: number, z: number) => {
  let h = terrainHeight(x, z);
  for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) h = Math.max(h, terrainHeight(x + dx, z + dz));
  return h;
};

export function createCamera(canvas: HTMLCanvasElement) {
  const camera = new PerspectiveCamera(44, innerWidth / innerHeight, 0.2, 900);
  // Low over the water: the horizon, the mountains and the fog sit in the upper third of the frame.
  camera.position.set(15.06, 12.915, 20.71);
  /** Framing limits and lens, tunable from Tuning → Camera. Angles are degrees from straight down (0) to straight up (180). */
  const framing = { minDistance: 1, maxDistance: 35, minAngle: 1, maxAngle: 112, fov: 44 };
  // Preserve a useful horizontal field of view on portrait screens.
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = Math.min(88, framing.fov * Math.max(1, 1.04 / camera.aspect));
    camera.updateProjectionMatrix();
  };
  resize();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, WORLD.surface - 2.4, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  // Keep the view inside the fogged world: no flying out to where the sea ends, no straight-down map view.
  const applyLimits = () => {
    controls.minDistance = framing.minDistance; controls.maxDistance = Math.max(framing.minDistance, framing.maxDistance);
    controls.minPolarAngle = framing.minAngle * Math.PI / 180; controls.maxPolarAngle = Math.max(framing.minAngle, framing.maxAngle) * Math.PI / 180;
  };
  applyLimits();
  controls.enablePan = true; controls.screenSpacePanning = true;
  controls.update();
  /**
   * Orbit, then keep the camera and its target above the seabed: if an orbit, zoom or pan would put the camera under
   * the ground it is lifted to the clearance height (OrbitControls re-derives its angles from the new position next
   * frame, so the orbit continues smoothly along the ground instead of clipping through it).
   */
  const update = () => {
    if (!controls.enabled) return;
    controls.update();
    const t = controls.target, tMin = groundAt(t.x, t.z) + CLEARANCE * 0.5;
    if (t.y < tMin) t.y = tMin;
    const p = camera.position, min = groundAt(p.x, p.z) + CLEARANCE;
    if (p.y < min) { p.y = min; camera.lookAt(t); camera.updateMatrixWorld(); }
  };
  /** Tuning → Camera: orbit limits, lens, a live readout of the current framing and a copy button. */
  const addControls = (folder: FolderApi) => {
    const now = { distance: 0, angle: 0 }, shown = { distance: 0, angle: 0 }, spherical = new Spherical(), offset = new Vector3();
    const read = () => {
      spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
      now.distance = shown.distance = spherical.radius; now.angle = shown.angle = spherical.phi * 180 / Math.PI;
    };
    const refit = () => { applyLimits(); resize(); controls.update(); };
    folder.addBinding(framing, 'minDistance', { label: 'min distance', min: 0.5, max: 60, step: 0.5 }).on('change', refit);
    folder.addBinding(framing, 'maxDistance', { label: 'max distance', min: 5, max: 200, step: 1 }).on('change', refit);
    folder.addBinding(framing, 'minAngle', { label: 'highest view°', min: 0, max: 90, step: 1 }).on('change', refit);
    folder.addBinding(framing, 'maxAngle', { label: 'lowest view°', min: 60, max: 180, step: 1 }).on('change', refit);
    folder.addBinding(framing, 'fov', { label: 'field of view°', min: 15, max: 80, step: 1 }).on('change', refit);
    const live = folder.addFolder({ title: 'Current framing', expanded: true });
    const move = () => {
      // The panel's periodic refresh also fires 'change' with the (up to 200 ms old) readout: applying that snapped the
      // camera back every refresh (and clamped the intro glide to maxDistance). Only act on a real edit, after the intro.
      if (!controls.enabled || (Math.abs(now.distance - shown.distance) < 0.05 && Math.abs(now.angle - shown.angle) < 0.05)) return;
      shown.distance = now.distance; shown.angle = now.angle;
      spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
      spherical.radius = now.distance; spherical.phi = now.angle * Math.PI / 180;
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical)); controls.update();
    };
    read();
    live.addBinding(now, 'distance', { min: 1, max: 60, step: 0.1 }).on('change', move);
    live.addBinding(now, 'angle', { label: 'angle°', min: 1, max: 112, step: 0.1 }).on('change', move);
    setInterval(read, 200); read();
    folder.addButton({ title: 'Copy framing' }).on('click', () => {
      const r = (v: Vector3) => v.toArray().map(x => +x.toFixed(2));
      void navigator.clipboard?.writeText(JSON.stringify({ position: r(camera.position), target: r(controls.target), ...framing }));
    });
  };
  return { camera, controls, resize, update, addControls };
}
