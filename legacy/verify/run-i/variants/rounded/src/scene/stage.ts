import { BoxGeometry, CanvasTexture, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, Scene, SRGBColorSpace } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Fn, If, color, float, mix, output, positionWorld, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { causticLight } from './lighting';
import { STAGE_Y, TANK, waterHeight } from '../state';

export const atmosphere = mix(color('#0f2430'), color('#2c4757'), float(1).sub(screenUV.y));
/** One floor fragment owns both the contact shadow and refracted light pool. */
export function createStage(scene: Scene) {
  const material = new MeshBasicNodeMaterial(); material.fog = false;
  const amount = uniform(1);
  const distance = positionWorld.xz.abs().sub(vec2(3.2, 1.95)).max(0).length();
  const pool = smoothstep(3.8, 0, distance).mul(positionWorld.xz.length().mul(-0.055).exp());
  const base = mix(atmosphere, color('#34464a'), positionWorld.xz.length().mul(-0.035).exp().mul(0.8))
    .add(color('#6f8180').mul(positionWorld.xz.length().mul(-0.12).exp()).mul(0.035));
  const shadowed = mix(base, color('#08171d'), smoothstep(0.85, 0, distance).mul(0.55));
  material.colorNode = Fn(() => {
    const light = vec3(0).toVar();
    // Skip the Worley evaluations outside the finite pool; no screen derivatives here.
    If(pool.mul(amount).greaterThan(0.001), () => { light.assign(causticLight.mul(vec3(0.55, 0.88, 1)).mul(pool).mul(amount).mul(0.30).min(0.42)); });
    return shadowed.add(light);
  })();
  const floor = new Mesh(new PlaneGeometry(10000, 10000), material);
  floor.name = 'Floor with integrated contact shadow and refracted caustics'; floor.rotation.x = -Math.PI / 2; floor.position.y = STAGE_Y; scene.add(floor);
  const pedestal = new Mesh(new RoundedBoxGeometry(6.4, -STAGE_Y, 3.9, 2, 0.055), new MeshStandardNodeMaterial({ color: '#142326', roughness: 0.86, metalness: 0.12 }));
  pedestal.position.y = STAGE_Y / 2; pedestal.receiveShadow = true; scene.add(pedestal);
  const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#bd975b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Fine brushed grain is deterministic; letters are engraved dark into the gold.
  for (let y = 0; y < canvas.height; y++) { ctx.fillStyle = `rgba(45,30,12,${0.02 + (y * 17 % 13) / 200})`; ctx.fillRect(0, y, canvas.width, 1); }
  function label(text: string, size: number, spacing: number, y: number) {
    ctx.font = `500 ${size}px Georgia, serif`; ctx.textBaseline = 'middle';
    const width = [...text].reduce((n, c) => n + ctx.measureText(c).width + spacing, -spacing); let x = (canvas.width - width) / 2;
    for (const c of text) { ctx.fillStyle = '#e4c88e'; ctx.fillText(c, x, y + 2); ctx.fillStyle = '#30291d'; ctx.fillText(c, x, y); x += ctx.measureText(c).width + spacing; }
  }
  label('AQUARIUM', 95, 21, 112); label('WAWA SENSEI', 51, 16, 231);
  const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; map.anisotropy = 8;
  const gold = new MeshStandardNodeMaterial({ map, metalness: 0.9, roughness: 0.3 });
  gold.outputNode = vec4(output.rgb.div(output.rgb.div(0.8).add(1)), output.a);
  const plaque = new Mesh(new BoxGeometry(1.52, 0.30, 0.018), gold); plaque.position.set(0, STAGE_Y / 2, 1.958); scene.add(plaque);
  return { update() { amount.value = Math.max(0, Math.min(1, (waterHeight.value - TANK.floor) / (TANK.base - TANK.floor))); }, get intensity() { return amount.value; } };
}
