import { random } from './random';
import type { PoissonOptions } from './poisson';
import type { Point2 } from './triangulate';

/**
 * Same Bridson variable-radius sampler as poissonDisk (the Lab's level-3 technique), on a typed grid so
 * it stays fast at tens of thousands of points. At most one sample per cell (cell diagonal = minRadius).
 */
export function poissonDiskFast({ bounds: [x0, y0, x1, y1], radius, minRadius, maxRadius, seed, attempts = 24 }: PoissonOptions): Point2[] {
  if (!(minRadius > 0 && maxRadius >= minRadius && x1 > x0 && y1 > y0)) throw new Error('Invalid Poisson bounds/radii');
  const rng = random(seed), cell = minRadius / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell) + 1, gh = Math.ceil((y1 - y0) / cell) + 1;
  const grid = new Int32Array(gw * gh).fill(-1), reach = Math.ceil(maxRadius / cell);
  const points: Point2[] = [], radii: number[] = [], active: number[] = [];
  const clampR = (x: number, y: number) => Math.max(minRadius, Math.min(maxRadius, radius(x, y)));
  const insert = (x: number, y: number, r: number) => {
    const id = points.length; points.push([x, y]); radii.push(r); active.push(id);
    grid[Math.floor((y - y0) / cell) * gw + Math.floor((x - x0) / cell)] = id;
  };
  const sx = x0 + rng() * (x1 - x0), sy = y0 + rng() * (y1 - y0); insert(sx, sy, clampR(sx, sy));
  while (active.length) {
    const index = Math.floor(rng() * active.length), id = active[index], p = points[id];
    let found = false;
    for (let k = 0; k < attempts && !found; k++) {
      const angle = rng() * Math.PI * 2, distance = radii[id] * Math.sqrt(1 + rng() * 3);
      const x = p[0] + Math.cos(angle) * distance, y = p[1] + Math.sin(angle) * distance;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const r = clampR(x, y), gx = Math.floor((x - x0) / cell), gy = Math.floor((y - y0) / cell);
      let valid = true;
      for (let b = Math.max(0, gy - reach); b <= Math.min(gh - 1, gy + reach) && valid; b++) {
        for (let a = Math.max(0, gx - reach); a <= Math.min(gw - 1, gx + reach); a++) {
          const o = grid[b * gw + a];
          if (o >= 0 && Math.hypot(x - points[o][0], y - points[o][1]) < Math.max(r, radii[o])) { valid = false; break; }
        }
      }
      if (valid) { insert(x, y, r); found = true; }
    }
    if (!found) { active[index] = active[active.length - 1]; active.pop(); }
  }
  return points;
}
