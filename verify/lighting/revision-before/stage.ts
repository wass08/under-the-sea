import { type Node, SpotLight, BoxGeometry, CanvasTexture, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, Scene, SRGBColorSpace } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Fn, If, mx_noise_float, shadow, color, float, mix, output, positionWorld, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { causticCoordinates, causticParams, causticDrain, spotlightCone, lampAttenuation, towardLamp } from './lighting';
import { causticsField } from '../lib/worley';
import { simTime, STAGE_Y, TANK, waterHeight, wetFootprints } from '../state';

export const atmosphere = mix(color('#041b2c'), color('#08324f'), smoothstep(0, .6, screenUV.y));
/** One floor fragment owns both the contact shadow and refracted light pool. */
export function createStage(scene: Scene, sun: SpotLight) {
  const material = new MeshBasicNodeMaterial(); material.fog = false;
  const amount = uniform(1);
  const distance = positionWorld.xz.abs().sub(vec2(TANK.width / 2 + .2, TANK.depth / 2 + .2)).max(0).length();
  const pool = smoothstep(3.8, 0, distance).mul(positionWorld.xz.length().mul(-0.055).exp());
  const floorColour = color('#041a2a').rgb.add(color('#0b4f78').mul(spotlightCone).mul(lampAttenuation));
  const base = mix(floorColour, atmosphere, smoothstep(18, 65, positionWorld.xz.length()));
  const sandRipple = positionWorld.x.mul(8).add(positionWorld.z.mul(2)).add(mx_noise_float(positionWorld.mul(.7)).mul(2)).sin();
  // Analytic sand-slope lighting stays subtle and vanishes into the distant field.
  const rippleNormal = vec3(sandRipple.mul(-.055),1,sandRipple.mul(-.014)).normalize();
  const visibility = vec3(shadow(sun) as unknown as Node<'vec3'>).r;
  let wet: Node<'float'> = float(0);
  for (const footprint of wetFootprints) {
    const r=positionWorld.xz.sub(footprint.xy).div(footprint.zw.max(.0001)).length();
    wet=wet.max(smoothstep(1.2,.72,r).mul(footprint.z.greaterThan(.001).select(1,0)));
  }
  const shadowed = mix(base, color('#041c33'), smoothstep(0.85, 0, distance).mul(0.12));
  material.colorNode = Fn(() => {
    const light = vec3(0).toVar();
    // Same Worley technique as the Lab; only its along-light footprint is stretched.
    If(pool.mul(amount).greaterThan(0.001), () => { light.assign(causticsField(causticCoordinates(.38), simTime, { ...causticParams, level: 3, depth: float(1) }).mul(color('#8fe3ff')).mul(pool).mul(amount).mul(causticDrain).mul(.72).mul(spotlightCone)); });
    const rippleShade = rippleNormal.dot(towardLamp).sub(towardLamp.y).mul(.9).add(mx_noise_float(positionWorld.mul(45)).mul(.025)).mul(positionWorld.xz.length().mul(-.08).exp()).add(1);
    return shadowed.mul(float(1).sub(wet.mul(.12))).mul(rippleShade).mul(visibility).add(light.mul(visibility)).min(vec3(1.20));
  })();
  const floor = new Mesh(new PlaneGeometry(10000, 10000), material);
  floor.receiveShadow = true; floor.name = 'Floor with integrated contact shadow and refracted caustics'; floor.rotation.x = -Math.PI / 2; floor.position.y = STAGE_Y; scene.add(floor);
  const pedestal = new Mesh(new RoundedBoxGeometry(TANK.width + .4, -STAGE_Y, TANK.depth + .4, 2, 0.055), new MeshStandardNodeMaterial({ color: '#142326', roughness: 0.86, metalness: 0.12 }));
  pedestal.position.y = STAGE_Y / 2; pedestal.castShadow = true; pedestal.receiveShadow = true; scene.add(pedestal);
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
  const plaque = new Mesh(new RoundedBoxGeometry(1.52, 0.30, 0.024, 3, 0.01), gold); plaque.position.set(0, STAGE_Y / 2, TANK.depth / 2 + .208); scene.add(plaque);
  return { update() { amount.value = Math.max(0, Math.min(1, (waterHeight.value - TANK.floor) / (TANK.base - TANK.floor))); }, get intensity() { return amount.value; } };
}
