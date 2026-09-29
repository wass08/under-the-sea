import { AdditiveBlending, BackSide, BoxGeometry, DataTexture, Mesh, MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { Fn, If, Loop, cameraPosition, cameraProjectionMatrixInverse, color, float, getViewPosition, positionWorld, screenCoordinate, screenUV, smoothstep, texture, vec2, vec3, viewportDepthTexture } from 'three/tsl';
import { simTime, sunDirection, sunElevation, TANK, waterHeight, waterNormal } from '../state';

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
    const a = vec3(-2.94, TANK.floor + 0.12, -1.69).sub(cameraPosition).div(safeRay);
    const b = vec3(2.94, TANK.top, 1.69).sub(cameraPosition).div(safeRay);
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
    const step = exit.sub(entry).max(0).div(16).toVar();
    const jitter = screenCoordinate.xy.dot(vec2(0.06711056, 0.00583715)).fract().mul(52.9829189).fract();
    const light = float(0).toVar();
    Loop(16, ({ i }) => {
      const distance = entry.add(float(i).add(jitter).mul(step));
      const point = cameraPosition.add(ray.mul(distance));
      const belowSurface = vec3(0, waterHeight, 0).sub(point).dot(waterNormal).max(0);
      const wallDistance = float(2.94).sub(point.x.abs()).min(float(1.69).sub(point.z.abs()));
      const edge = smoothstep(0, 0.08, wallDistance);
      const visibility = float(1).toVar();
      // Two height tests toward the sun soften the island's shadow in the medium.
      for (const offset of [0.35, 0.9]) {
        const towardSun = point.add(sunDirection.mul(offset));
        const height = texture(terrain, towardSun.xz.div(vec2(6, 3.5)).add(0.5)).level(float(0)).r;
        visibility.mulAssign(smoothstep(-0.03, 0.08, towardSun.y.sub(height)));
      }
      // Five localized light-space apertures; a 1D stripe mask integrates into
      // a veil along oblique view rays. Gaps between these beams have zero light.
      const surfacePoint = point.xz.add(sunDirection.xz.mul(waterHeight.sub(point.y).div(sunDirection.y.max(0.2))));
      const mask = float(0).toVar();
      for (const [x, z] of [[-2.65, -0.7], [-2.5, 1.35], [-0.8, 1.4], [1.3, 1.3], [2.4, -0.45]]) {
        const delta = surfacePoint.sub(vec2(x, z).add(vec2(simTime.mul(0.12).sin().mul(0.06), 0)));
        mask.addAssign(smoothstep(0.34, 0.08, delta.length()));
      }
      const density = belowSurface.mul(-0.85).exp().mul(edge).mul(visibility);
      light.addAssign(mask.mul(density).mul(step).mul(distance.sub(entry).mul(-0.12).exp()));
    });
    return light.mul(sunElevation).mul(0.32).min(0.20);
  })();
  const box = new Mesh(new BoxGeometry(5.88, TANK.top - TANK.floor - 0.12, 3.38), material);
  box.name = 'Water single scattering'; box.position.y = (TANK.top + TANK.floor + 0.12) / 2;
  box.renderOrder = 5; scene.add(box);
  return { update() { box.visible = waterHeight.value > TANK.floor + 0.13; } };
}
