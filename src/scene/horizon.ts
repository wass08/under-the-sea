import { BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3, Vector4 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { color, dot, float, mix, normalize, positionWorld, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { WORLD } from '../config';
import { simTime } from '../state';
import { createNoise2D, ridged } from '../lib/noise';
import { oceanHeightCpu } from '../lib/ocean';
import { random } from '../lib/random';
import { toSun } from './lighting';

/**
 * The world beyond the action, all left to the fog (post.ts): three rings of flat mountain silhouettes at
 * increasing distances (the fog hazes each one more: atmospheric perspective for free) and a few distant boats whose
 * lanterns are small warm points that the fog turns into soft volumetric halos.
 */

/** Height fog over the water: density at the waterline, exponential falloff height, and its colour (linear). */
export const fog = {
  density: uniform(0.012),
  height: uniform(3.5),
  /** Deep ink blue, the same family as the night water (water.ts inscatter), so sea, fog and sky read as one dark medium. */
  color: uniform(new Vector3(0.0034, 0.0062, 0.0145)),
  /** Thin haze at every height (per unit distance): it separates the mountain layers by distance. */
  haze: uniform(0.0045),
  /** Strength of light scattered by the fog around the boat's lantern (off by default: its bloom already reads). */
  glow: uniform(0),
  /** Strength of the halos around the distant boats' lanterns. */
  farGlow: uniform(0.55),
  /** Brightening of the fog toward the moon. */
  moonGlow: uniform(1),
  /** Underwater volumetrics: the lantern's glow cone below the boat, and the moon shafts (see godRayStrength). */
  lanternBeam: uniform(1.35),
};

/** Distant boat lanterns: xyz = world position, w = power (flicker included). */
export const FAR_LANTERNS = 6;
export const farLanterns = Array.from({ length: FAR_LANTERNS }, () => uniform(new Vector4(0, -100, 0, 0)));

const level = WORLD.surface;

/** One closed ring of ridgelines at `radius`, from below the waterline to a noisy crest; v = 0 bottom, 1 crest. */
function mountainRing(radius: number, base: number, amplitude: number, seed: number, frequency: number) {
  const noise = createNoise2D(seed), rng = random(seed + 1);
  const peaks = Array.from({ length: 5 }, () => ({ a: rng() * Math.PI * 2, w: 0.08 + rng() * 0.16, h: 0.4 + rng() * 0.8 }));
  const N = 720, positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
    const ridge = ridged(cx * frequency + seed, sz * frequency - seed, { noise, octaves: 4, gain: 0.48 });
    let bump = 0;
    for (const p of peaks) { const d = Math.atan2(Math.sin(a - p.a), Math.cos(a - p.a)) / p.w; bump += p.h * Math.exp(-d * d); }
    const crest = level + base + amplitude * (Math.pow(ridge, 2.2) * 0.75 + bump * 0.45);
    positions.push(cx * radius, level - 8, sz * radius, cx * radius, crest, sz * radius);
    uvs.push(i / N, 0, i / N, 1);
    if (i < N) { const k = i * 2; index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export function createHorizon(scene: import('three/webgpu').Scene) {
  const group = new Group(); group.name = 'Horizon'; scene.add(group);

  // ---- Mountains: near, middle, far ----------------------------------------------------------------------------
  const layers = [
    { radius: 105, base: 3, amplitude: 15, seed: 11, frequency: 1.7, tone: '#0a0e18' },
    { radius: 165, base: 7, amplitude: 25, seed: 23, frequency: 1.25, tone: '#0b1020' },
    { radius: 245, base: 12, amplitude: 36, seed: 37, frequency: 0.95, tone: '#0d1326' },
  ];
  for (const l of layers) {
    const m = new MeshBasicNodeMaterial({ side: DoubleSide });
    m.fog = false;
    // Flat silhouette; only a hairline of moonlight on crests that face the moon.
    const facing = dot(normalize(positionWorld.xz), toSun.xz.normalize()).max(0);
    const rim = smoothstep(0.985, 1.0, uv().y).mul(facing).mul(0.05);
    m.colorNode = (color(l.tone) as unknown as Node<'vec3'>).mul(mix(float(0.6), float(1), uv().y)).add(vec3(0.35, 0.45, 0.7).mul(rim));
    const mesh = new Mesh(mountainRing(l.radius, l.base, l.amplitude, l.seed, l.frequency), m);
    mesh.name = 'Mountains'; mesh.frustumCulled = false;
    mesh.layers.enable(1); // the planar water reflection: the ridges mirror in the far water
    group.add(mesh);
  }

  // ---- Distant boats: dark hull, a short mast, a warm lantern ------------------------------------------------------
  const spots: [number, number][] = [[202, 46], [230, 78], [252, 36], [176, 96], [292, 60], [142, 72]];
  const hullGeo = new BoxGeometry(2.6, 0.28, 0.9), mastGeo = new CylinderGeometry(0.035, 0.045, 1.5, 6), lampGeo = new SphereGeometry(0.2, 12, 8);
  const hullMat = new MeshBasicNodeMaterial({ color: '#05070b' });
  const rng = random(808);
  const boats = spots.map(([deg, dist], i) => {
    const a = (deg * Math.PI) / 180, boat = new Group();
    boat.position.set(Math.cos(a) * dist, level, Math.sin(a) * dist);
    boat.rotation.y = rng() * Math.PI * 2;
    const hull = new Mesh(hullGeo, hullMat), mast = new Mesh(mastGeo, hullMat);
    mast.position.set(0.7, 0.85, 0);
    const glow = uniform(1), lampMat = new MeshBasicNodeMaterial();
    lampMat.colorNode = vec3(3.2, 1.45, 0.5).mul(glow);
    const lamp = new Mesh(lampGeo, lampMat); lamp.position.set(0.95, 1.45, 0);
    boat.add(hull, mast, lamp);
    // Planar water reflection (layer 1): the lanterns draw long warm streaks across the swell.
    boat.traverse(o => o.layers.enable(1));
    boat.name = 'Distant boat'; group.add(boat);
    return { boat, lamp, glow, phase: rng() * 10, power: 2.2 + rng() * 1.6, index: i };
  });

  const p = new Vector3();
  return {
    group,
    update() {
      const t = simTime.value;
      for (const b of boats) {
        const { x, z } = b.boat.position;
        b.boat.position.y = level + oceanHeightCpu(x, z, t) + 0.05;
        b.boat.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.05; b.boat.rotation.x = Math.sin(t * 0.7 + b.phase * 1.3) * 0.04;
        const flicker = 1 + Math.sin(t * 6.7 + b.phase) * 0.06 + Math.sin(t * 15.1 + b.phase * 2) * 0.04;
        b.glow.value = flicker;
        b.boat.updateMatrixWorld(true);
        b.lamp.getWorldPosition(p);
        farLanterns[b.index].value.set(p.x, p.y, p.z, b.power * flicker);
      }
    },
  };
}
