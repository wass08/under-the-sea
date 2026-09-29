import { BoxGeometry, DataTexture, DoubleSide, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, Scene, Sphere, Vector3, Vector4 } from 'three/webgpu';
import { Fn, If, Discard, float, uniform, min, smoothstep, transformNormalToView, output, vec4, color, positionGeometry, positionWorld, cameraPosition, normalWorld, vec3, vec2, mix, mx_noise_float, mx_noise_vec3, reflector, screenUV, texture } from 'three/tsl';
import { gerstnerField, WATER_SCALE } from '../lib/waves';
import { waterOptics } from './water-optics';
import { signedWaterDistance } from './lighting';
import { lampOn, simTime, state, TANK, waterHeight, waterNormal, waterAgitation, waterChoppiness, sunDirection, breachDrawdowns } from '../state';

export function createWater(scene: Scene, terrain: DataTexture) {
  const surfaceMaterial = new MeshPhysicalNodeMaterial({ color: '#000000', roughness: .085, metalness: 0, ior: 1.333, side: DoubleSide, transparent: true, depthWrite: false, envMap: scene.environment, envMapIntensity: .12 });
  surfaceMaterial.fog = false;
  const agitation = waterAgitation;
  const ripples = Array.from({ length: 4 }, () => uniform(new Vector4(0, 0, -100, 0)));
  let rippleIndex = 0;
  const relief = waterHeight.sub(TANK.floor).div(.18).clamp();
  const xz = positionGeometry.xz;
  const g = gerstnerField(xz, simTime, agitation.mul(WATER_SCALE.agitationGain).add(1).mul(relief), waterChoppiness.mul(agitation.mul(WATER_SCALE.chopGain).add(1)));
  const rings = Fn(() => {
    const result = vec3(0).toVar();
    for (const ripple of ripples) {
      const age = simTime.sub(ripple.z).max(0), delta = xz.sub(ripple.xy), radius = delta.length().max(.0001);
      const ring = radius.sub(age.mul(1.35));
      const envelope = ring.mul(ring).mul(-7).exp().mul(age.mul(-1.3).exp()).mul(ripple.w).mul(simTime.greaterThanEqual(ripple.z).select(1,0)).mul(WATER_SCALE.rippleAmplitude).mul(relief);
      result.x.addAssign(ring.mul(22).sin().mul(envelope));
      const derivative = ring.mul(22).cos().mul(22).sub(ring.mul(22).sin().mul(ring).mul(14)).mul(envelope);
      result.yz.addAssign(delta.div(radius).mul(derivative));
    }
    // A travelling slosh along the spring's tilt direction.
    const direction = waterNormal.xz.div(waterNormal.xz.length().max(.0001));
    const phase = xz.dot(direction).mul(4).sub(simTime.mul(7));
    result.x.addAssign(phase.sin().mul(agitation).mul(WATER_SCALE.sloshAmplitude));
    result.yz.addAssign(direction.mul(phase.cos()).mul(agitation).mul(WATER_SCALE.sloshAmplitude*4));
    return result;
  })();
  const slope = waterNormal.xz.div(waterNormal.y.max(.2));
  // Pin horizontal displacement to zero at the glass, using the derivative of the
  // pinning function in both tangents. The boundary stays watertight as crests travel.
  const ax = float(TANK.width/2-.026).sub(xz.x.abs()).div(WATER_SCALE.edgeWidth).clamp();
  const az = float(TANK.depth/2-.026).sub(xz.y.abs()).div(WATER_SCALE.edgeWidth).clamp();
  const wx = ax.mul(ax).mul(float(3).sub(ax.mul(2))), wz = az.mul(az).mul(float(3).sub(az.mul(2)));
  const edge = wx.mul(wz);
  const ex = ax.mul(float(1).sub(ax)).mul(-6/WATER_SCALE.edgeWidth).mul(xz.x.sign()).mul(wz);
  const ez = az.mul(float(1).sub(az)).mul(-6/WATER_SCALE.edgeWidth).mul(xz.y.sign()).mul(wx);
  const displaced = xz.add(g.offset.xz.mul(edge));
  const drawdown = Fn(() => {
    const result = vec3(0).toVar();
    for (const breach of breachDrawdowns) {
      If(breach.w.greaterThan(0), () => {
        const delta = xz.sub(breach.xy), radius = breach.z.mul(.8).max(.001);
        const q = float(1).sub(delta.dot(delta).div(radius.mul(radius))).max(0);
        result.x.addAssign(q.pow(3).mul(breach.w));
        result.yz.addAssign(delta.mul(q.pow(2)).mul(breach.w).mul(-6).div(radius.mul(radius)));
      });
    }
    return result;
  })();
  // Only height changes at a breach: the pinned glass boundary cannot pull inward.
  surfaceMaterial.positionNode = vec3(displaced.x, waterHeight.sub(displaced.dot(slope)).add(g.offset.y).add(rings.x).sub(drawdown.x), displaced.y);
  const tx = g.tangent.xz.sub(vec2(1,0)).mul(edge).add(vec2(1,0)).add(g.offset.xz.mul(ex));
  const tz = g.binormal.xz.sub(vec2(0,1)).mul(edge).add(vec2(0,1)).add(g.offset.xz.mul(ez));
  const tangent = vec3(tx.x, g.tangent.y.add(rings.y).sub(tx.dot(slope)).sub(drawdown.y), tx.y);
  const binormal = vec3(tz.x, g.binormal.y.add(rings.z).sub(tz.dot(slope)).sub(drawdown.z), tz.y);
  const baseNormal = binormal.cross(tangent).normalize().toVarying();
  // Two decorrelated gradient-noise octaves supply capillary sparkle, not the base normal.
  const fineA = mx_noise_vec3(vec3(positionWorld.xz.mul(24).add(simTime.mul(.22)), simTime.mul(.13)));
  const fineB = mx_noise_vec3(vec3(positionWorld.xz.mul(53).sub(simTime.mul(.34)), 7.1));
  surfaceMaterial.normalNode = transformNormalToView(baseNormal.add(vec3(fineA.x,0,fineA.y).mul(.004)).add(vec3(fineB.x,0,fineB.y).mul(.0015)).normalize());
  const optics = waterOptics();
  // The planar image owns the reflection. Keep the much brighter HDR sky fill
  // restrained so its cloud lobes cannot paint white marble over the water.
  const reflection = reflector({ resolutionScale: .25, bounces: false, samples: 0 });
  reflection.target.rotation.x = -Math.PI/2; reflection.target.position.y = TANK.base; scene.add(reflection.target);
  const reflectedUV = screenUV.flipX().add(baseNormal.xz.mul(vec2(-.010,.010))).clamp(.002,.998);
  const shoreDepth = positionWorld.y.sub(texture(terrain, positionWorld.xz.div(vec2(TANK.width,TANK.depth)).add(.5)).r);
  const wallDistance = min(float(TANK.width/2-.026).sub(positionWorld.x.abs()), float(TANK.depth/2-.026).sub(positionWorld.z.abs()));
  const foamNoise = mx_noise_float(vec3(positionWorld.xz.mul(17).add(simTime.mul(.15)),simTime.mul(.25))).mul(.5).add(.5);
  const shoreline = smoothstep(.035,.006,shoreDepth).mul(smoothstep(-.008,.006,shoreDepth)).mul(.24);
  const wallFoam = smoothstep(.016,.003,wallDistance).mul(.08);
  const crest = smoothstep(.92,.85,g.jacobian.toVarying()).mul(smoothstep(.65,1,agitation)).mul(.14);
  const foam = shoreline.add(wallFoam).add(crest).mul(smoothstep(.30,.66,foamNoise)).mul(relief).min(.24);
  const meniscus = color('#b7e9ef').mul(float(1).sub(smoothstep(.002,.018,wallDistance))).mul(.14);
  const backlit = baseNormal.dot(sunDirection).max(0).mul(g.offset.y.toVarying().add(.015).max(0)).mul(3);
  const halfLight = sunDirection.negate().add(cameraPosition.sub(positionWorld).normalize()).normalize();
  const sunGlow = normalWorld.dot(halfLight).max(0).pow(70).mul(.028);
  const transport = optics.refracted.mul(float(1).sub(optics.fresnel));
  const reflected = reflection.sample(reflectedUV).rgb.mul(optics.fresnel).mul(.85);
  const profile = new URLSearchParams(location.search).get('waterProfile');
  surfaceMaterial.emissiveNode = Fn(() => {
    Discard(shoreDepth.lessThan(-.035));
    return mix(transport.add(profile === 'no-reflection' ? vec3(0) : reflected).add(color('#087b78').mul(backlit).mul(lampOn)), color('#d5eee8'), foam).add(meniscus).add(color('#ffe5b8').mul(sunGlow).mul(lampOn));
  })();
  surfaceMaterial.opacityNode = float(1);
  surfaceMaterial.outputNode = vec4(output.rgb.div(output.rgb.div(1.5).add(1)), output.a);
  const geometry = new PlaneGeometry(TANK.width-.052, TANK.depth-.052, 128, 80); geometry.rotateX(-Math.PI/2);
  geometry.boundingSphere = new Sphere(new Vector3(0,(TANK.floor+TANK.top)/2,0),Math.hypot(TANK.width/2,TANK.depth/2,(TANK.top-TANK.floor)/2));
  const surface = new Mesh(geometry,surfaceMaterial); surface.name = 'Gerstner water surface'; surface.castShadow=false; surface.receiveShadow=false; surface.renderOrder = 3; scene.add(surface);
  // The water side is optically clear: path extinction belongs to the ray through
  // the surface, not an additional milky tint stacked over the island.
  const volumeMaterial = new MeshPhysicalNodeMaterial({ color:'#010709', transmission:1, roughness:.025, ior:1.333, thickness:.035, side:DoubleSide, transparent:true, opacity:.035, depthWrite:false });
  volumeMaterial.colorNode = Fn(() => { Discard(signedWaterDistance.greaterThan(0)); return color('#010709'); })();
  volumeMaterial.emissiveNode = color('#b4e4de').mul(signedWaterDistance.div(.006).abs().pow(2).negate().exp()).mul(.22);
  const volume = new Mesh(new BoxGeometry(TANK.width-.10,TANK.top-TANK.floor-.02,TANK.depth-.10),volumeMaterial);
  volume.position.y=(TANK.top+TANK.floor)/2; volume.renderOrder=2; scene.add(volume);
  const reflectionNormal = new Vector3(0,0,1);
  const syncOptics = () => {
    reflection.target.position.y = waterHeight.value;
    reflection.target.quaternion.setFromUnitVectors(reflectionNormal,waterNormal.value);
    reflection.target.updateMatrixWorld();
    if (profile === 'off') surface.visible = volume.visible = false;
  };
  let height = TANK.base, drainHeight = TANK.base, draining = false, fast = false;
  const tilt = new Vector3(), tiltVelocity = new Vector3(), targetTilt = new Vector3(), tiltDelta = new Vector3();
  function ripple(point: Vector3, strength = 1) {
    ripples[rippleIndex++ % 4].value.set(point.x, point.z, simTime.value, Math.min(WATER_SCALE.maxRippleStrength, Math.max(0,strength)));
  }
  function slosh(point: Vector3) {
    state.lastSlosh = state.elapsed; agitation.value = Math.min(1, agitation.value + .65);
    targetTilt.set(-point.x, 0, -point.z).normalize().multiplyScalar(0.025);
  }
  function update(dt: number) {
    agitation.value += ((draining && height > drainHeight + .005 ? .45 : 0) - agitation.value) * (1 - Math.exp(-dt * 1.4));
    // Torricelli: integrate sqrt(head) analytically so the level stops exactly at the sill.
    if (draining && height > drainHeight) {
      const root = Math.max(0, Math.sqrt(height - drainHeight) - dt * (fast ? 1.25 : 0.12));
      height = drainHeight + root * root;
    }
    targetTilt.multiplyScalar(Math.exp(-dt * 2));
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      tiltVelocity.addScaledVector(tiltDelta.subVectors(targetTilt, tilt), 18 * h).multiplyScalar(Math.exp(-4.2 * h));
      tilt.addScaledVector(tiltVelocity, h);
    }
    const extent = Math.abs(tilt.x) * TANK.width / 2 + Math.abs(tilt.z) * TANK.depth / 2;
    if (extent > Math.min(height - TANK.floor, TANK.top - height) - 0.01) tilt.multiplyScalar(0.8);
    waterHeight.value = height; waterNormal.value.set(tilt.x, 1, tilt.z).normalize();
    surface.visible = volume.visible = height > TANK.floor + 0.015; syncOptics();
  }
  return { surface, get diagnostics() { return { waves: 6, resolution: [128,80], agitation: agitation.value, choppiness: waterChoppiness.value, reflection: 'planar-quarter', reflectionScale: .25 }; }, slosh, ripple, update,
    capture() { return { height, normal: waterNormal.value.toArray(), agitation: agitation.value, ripples: ripples.map(r=>r.value.toArray()) }; },
    restore(a: { height: number; normal: number[]; agitation: number; ripples: number[][] }, b: { height: number; normal: number[]; agitation: number; ripples: number[][] }, t: number) {
      ripples.forEach((r,i)=>r.value.fromArray((t<.5?a:b).ripples[i]));
      agitation.value = a.agitation * (1-t) + b.agitation * t;
      height = a.height * (1 - t) + b.height * t; waterHeight.value = height;
      waterNormal.value.fromArray(a.normal).lerp(new Vector3().fromArray(b.normal), t).normalize();
      surface.visible = volume.visible = height > TANK.floor + 0.015; syncOptics();
    },
    drain(bottom: number, full = false) {
    drainHeight = Math.max(TANK.floor, Math.min(drainHeight, bottom)); draining = true; fast = full; agitation.value = full ? 1 : .7;
  }, reset() {
    height = drainHeight = TANK.base; agitation.value = 0; draining = fast = false;
    tilt.set(0, 0, 0); tiltVelocity.set(0, 0, 0); targetTilt.set(0, 0, 0);
    waterHeight.value = TANK.base; waterNormal.value.set(0, 1, 0);
    ripples.forEach(r => r.value.w = 0); state.lastSlosh = -100;
  } };
}
