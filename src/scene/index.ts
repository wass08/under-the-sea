import { BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Color } from 'three/webgpu';
import type { Ctx, World } from '../contracts';
import { WORLD } from '../config';

/** STUB — replaced by the world implementation. */
export async function createWorld({ renderer, scene, camera }: Ctx): Promise<World> {
  scene.background = new Color('#0b2236');
  const sun = new DirectionalLight('#fff4e0', 3); sun.position.set(8, 16, 6); scene.add(sun, new HemisphereLight('#bfe3ff', '#40362a', 1));
  const slab = new Mesh(new BoxGeometry(WORLD.half * 2, WORLD.bed - WORLD.bottom, WORLD.half * 2), new MeshStandardNodeMaterial({ color: '#6b5a44' }));
  slab.position.y = (WORLD.bed + WORLD.bottom) / 2; scene.add(slab);
  const surfaceGeometry = new PlaneGeometry(WORLD.half * 2, WORLD.half * 2); surfaceGeometry.rotateX(-Math.PI / 2);
  const surface = new Mesh(surfaceGeometry, new MeshStandardNodeMaterial({ color: '#2a8fb0', transparent: true, opacity: .5 }));
  surface.position.y = WORLD.surface; scene.add(surface);
  return {
    sun, surface, terrain: [slab],
    seabed: { heights: new Float32Array(64 * 64).fill(WORLD.bed), resolution: 64 },
    heightAt: () => WORLD.surface,
    normalAt: (_x, _z, t) => t.set(0, 1, 0),
    ripple() {}, update() {}, resize() {}, addControls() {},
    render() { renderer.render(scene, camera); },
  };
}
