/** Deterministic LCG; each call returns a number in [0, 1). */
export function random(seed = 1) {
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}
