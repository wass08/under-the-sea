import { AdditiveBlending, BackSide, BoxGeometry, DataTexture, Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { Fn, If, Loop, cameraPosition, cameraProjectionMatrixInverse, color, float, getViewPosition, positionWorld, screenCoordinate, screenUV, smoothstep, texture, vec2, vec3, viewportDepthTexture } from 'three/tsl';
import { lightShaftMask, updateLightApertures } from './lighting';
import { sunDirection, sunElevation, TANK, waterHeight, waterNormal } from '../state';

export function createShafts(scene: Scene, terrain: DataTexture) {
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, side: BackSide });
  material.fog = false; material.colorNode = color('#bcf4d1');
  // Single-scattering raymarch through the water volume. The opaque depth copy
  // ends the view ray at the island/sand; no transparent surface writes that depth.
  const depth = viewportDepthTexture();
  material.opacityNode = Fn(() => {
    const ray = positionWorld.sub(cameraPosition).normalize().toVar();
    // TSL select takes a scalar condition; preserve each axis sign separately.
    // A vector condition chose the x sign for y/z and erased front-left rays.
    const safeAxis = (axis: typeof ray.x) => axis.greaterThanEqual(0).select(axis.max(0.00001), axis.min(-0.00001));
    const safeRay = vec3(safeAxis(ray.x), safeAxis(ray.y), safeAxis(ray.z));
    const a = vec3(-TANK.width/2+.06, TANK.floor + 0.12, -TANK.depth/2+.06).sub(cameraPosition).div(safeRay);
    const b = vec3(TANK.width/2-.06, TANK.top, TANK.depth/2-.06).sub(cameraPosition).div(safeRay);
    const near = a.min(b), far = a.max(b);
    const entry = near.x.max(near.y).max(near.z).max(0).toVar();
    const opaqueDistance = getViewPosition(screenUV, depth.r, cameraProjectionMatrixInverse).length();
    const exit = far.x.min(far.y).min(far.z).min(opaqueDistance).toVar();
    const signed = cameraPosition.sub(vec3(0, waterHeight, 0)).dot(waterNormal);
    const slope = ray.dot(waterNormal);
    If(slope.abs().greaterThan(0.00001), () => {
      const crossing = signed.negate().div(slope);
      If(slope.greaterThan(0), () => { exit.assign(exit.min(crossing)); }).Else(() => { entry.assign(entry.max(crossing)); });
    }).Else(() => { If(signed.greaterThan(0), () => { exit.assign(entry); }); });
    const step = exit.sub(entry).max(0).div(12).toVar();
    const jitter = screenCoordinate.xy.dot(vec2(0.06711056, 0.00583715)).fract().mul(52.9829189).fract();
    const light = float(0).toVar();
    Loop(12, ({ i }) => {
      const distance = entry.add(float(i).add(jitter).mul(step));
      const point = cameraPosition.add(ray.mul(distance));
      const belowSurface = vec3(0, waterHeight, 0).sub(point).dot(waterNormal).max(0);
      const visibility = float(1).toVar();
      // Two height tests toward the sun soften the island's shadow in the medium.
      for (const offset of [0.35, 0.9]) {
        const towardSun = point.sub(sunDirection.mul(offset));
        const height = texture(terrain, towardSun.xz.div(vec2(TANK.width, TANK.depth)).add(0.5)).level(float(0)).r;
        visibility.mulAssign(smoothstep(-0.03, 0.08, towardSun.y.sub(height)));
      }
      const mask = lightShaftMask(point);
      const density = belowSurface.mul(-0.45).exp().mul(visibility);
      light.addAssign(mask.mul(density).mul(step).mul(distance.sub(entry).mul(-0.12).exp()));
    });
    return light.mul(sunElevation).mul(0.20).min(0.10);
  })();
  const box = new Mesh(new BoxGeometry(TANK.width-.12, TANK.top - TANK.floor - 0.12, TANK.depth-.12), material);
  box.name = 'Water single scattering'; box.position.y = (TANK.top + TANK.floor + 0.12) / 2;
  box.renderOrder = 5; scene.add(box);
  return { update() { updateLightApertures(); box.visible = waterHeight.value > TANK.floor + 0.13; } };
}
