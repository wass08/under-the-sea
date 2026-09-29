/**
 * World dimensions for the floating water diorama. One world unit ≈ 25 cm.
 * The diorama is a 36 × 36 block: an earth slab (strata visible on the sides, flat
 * bottom) with 9 units of water on top and a sandy palm island in the back-left corner,
 * floating above an open ground plane.
 */
export const WORLD = {
  /** Half extent of the diorama footprint on x and z. */
  half: 18,
  /** Underside of the earth slab (the diorama floats: GROUND < bottom). */
  bottom: 0,
  /** Nominal seabed height (top of the earth slab, before terrain relief). */
  bed: 1.6,
  /** Resting water surface height. Waves displace around this. */
  surface: 10.6,
  /** Open ground plane below the floating diorama. */
  ground: -6,
} as const;

/** Box the fish must stay inside (a margin inside the water; terrain is avoided separately). */
export const SWIM_BOUNDS = {
  min: [-WORLD.half + 0.6, WORLD.bed + 0.3, -WORLD.half + 0.6] as const,
  max: [WORLD.half - 0.6, WORLD.surface - 0.35, WORLD.half - 0.6] as const,
};

/** Palm island centre (x, z): the back-left corner, away from the default camera (+x, +z). */
export const ISLAND = { x: -9.5, z: -9.5 } as const;

/** Open-water basin centre (x, z): where the school lives by default and mills. */
export const BASIN = { x: 4, z: 3.5 } as const;

/** Boat mooring point on the water (x, z), near the middle, slightly toward the camera. The fisherman casts from here. */
export const BOAT = { x: 2.5, z: 6.5, heading: -2.4 } as const;

/** URL switches, read once. */
const query = new URLSearchParams(location.search);
export const QUERY = {
  /** Number of school fish (buffers are fixed at boot). */
  fish: Math.max(256, Math.min(262144, Number(query.get('fish')) || 32768)),
  debug: query.has('debug'),
};
