/** Open-sea night diorama (no island). One world unit ≈ 25 cm. */
export const WORLD = {
  /** Half extent of the diorama footprint on x and z. */
  half: 36,
  /** Underside of the earth slab (the diorama floats: GROUND < bottom). */
  bottom: 0,
  /** Nominal seabed height (top of the earth slab, before terrain relief). */
  bed: 1.6,
  /** Resting water surface height. Waves displace around this. */
  surface: 10.8,
  /** Open ground plane below the floating diorama. */
  ground: -6,
} as const;

/** Box the fish must stay inside (a margin inside the water; terrain is avoided separately). */
export const SWIM_BOUNDS = {
  min: [-WORLD.half + 0.6, WORLD.bed + 0.3, -WORLD.half + 0.6] as const,
  max: [WORLD.half - 0.6, WORLD.surface - 0.35, WORLD.half - 0.6] as const,
};

/** Legacy home for the school's route planning (there is no coast any more: the diorama is open sea). */
export const COAST = { x: 0, z: -10 } as const;

/** Open-water basin centre (x, z): where the school lives by default and mills. */
export const BASIN = { x: 0, z: 0 } as const;

/** Bamboo boat mooring point (x, z), just off the basin toward the camera. The fisherman casts from here; the lantern
 *  hangs over the water ahead of him. */
export const BOAT = { x: 0.5, z: 3.2, heading: -2.4 } as const;

/** Stable per-fish proportions, shared by the normal, close-up and shadow meshes. */
export const FISH_SIZE = { min: 0.7, max: 1.3, distribution: 1 } as const;

/** URL switches, read once. */
const query = new URLSearchParams(location.search);
export const QUERY = {
  /** Number of school fish (buffers are fixed at boot). */
  fish: Math.max(256, Math.min(262144, Math.floor(Number(query.get('fish'))) || 4096)),
  debug: query.has('debug'),
};
