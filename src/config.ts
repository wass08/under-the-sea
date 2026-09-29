/**
 * World dimensions for the floating water diorama. One world unit ≈ 25 cm.
 * The diorama is a 12 × 12 block: an earth slab (strata visible on the sides)
 * with a cube of water on top, floating above an open ground plane.
 */
export const WORLD = {
  /** Half extent of the diorama footprint on x and z. */
  half: 6,
  /** Underside of the earth slab (the diorama floats: GROUND < bottom). */
  bottom: 0,
  /** Nominal seabed height (top of the earth slab, before terrain relief). */
  bed: 1.2,
  /** Resting water surface height. Waves displace around this. */
  surface: 7.2,
  /** Open ground plane below the floating diorama. */
  ground: -3.4,
} as const;

/** Box the fish must stay inside (a margin inside the water; terrain is avoided separately). */
export const SWIM_BOUNDS = {
  min: [-WORLD.half + 0.35, WORLD.bed + 0.25, -WORLD.half + 0.35] as const,
  max: [WORLD.half - 0.35, WORLD.surface - 0.3, WORLD.half - 0.35] as const,
};

/** Boat mooring point on the water (x, z). The fisherman casts from here. */
export const BOAT = { x: 2.6, z: 3.1, heading: -2.4 } as const;

/** URL switches, read once. */
const query = new URLSearchParams(location.search);
export const QUERY = {
  /** Number of school fish (buffers are fixed at boot). */
  fish: Math.max(256, Math.min(262144, Number(query.get('fish')) || 32768)),
  debug: query.has('debug'),
};
