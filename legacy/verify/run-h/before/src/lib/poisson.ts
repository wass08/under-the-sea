import { random } from './random';
import type { Bounds, Point2 } from './triangulate';
export type PoissonOptions = { bounds: Bounds; radius: (x: number, y: number) => number; minRadius: number; maxRadius: number; seed: number; attempts?: number };
/** Bridson Poisson-disk sampling with symmetric variable-radius exclusion. Saturates the rectangle. */
export function poissonDisk({ bounds: [x0, y0, x1, y1], radius, minRadius, maxRadius, seed, attempts = 24 }: PoissonOptions): Point2[] {
  if (!(minRadius > 0 && maxRadius >= minRadius && x1 > x0 && y1 > y0)) throw new Error('Invalid Poisson bounds/radii');
  const rng = random(seed), cellSize = minRadius / Math.SQRT2;
  const grid = new Map<string, number[]>(), points: Point2[] = [], radii: number[] = [], active: number[] = [];
  const coords = (x: number, y: number) => [Math.floor((x - x0) / cellSize), Math.floor((y - y0) / cellSize)];
  const localRadius = (x: number, y: number) => Math.max(minRadius, Math.min(maxRadius, radius(x, y)));
  function insert(x: number, y: number, r: number) {
    const id = points.length, key = coords(x, y).join(',');
    points.push([x, y]); radii.push(r); active.push(id);
    const bucket = grid.get(key) ?? []; bucket.push(id); grid.set(key, bucket);
  }
  const sx = x0 + rng() * (x1 - x0), sy = y0 + rng() * (y1 - y0); insert(sx, sy, localRadius(sx, sy));
  while (active.length) {
    const index = Math.floor(rng() * active.length), id = active[index], p = points[id];
    let found = false;
    for (let k = 0; k < attempts; k++) {
      const angle = rng() * Math.PI * 2, distance = radii[id] * Math.sqrt(1 + rng() * 3);
      const x = p[0] + Math.cos(angle) * distance, y = p[1] + Math.sin(angle) * distance;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      const r = localRadius(x, y), [gx, gy] = coords(x, y), reach = Math.ceil(maxRadius / cellSize);
      let valid = true;
      for (let a = gx - reach; a <= gx + reach && valid; a++) for (let b = gy - reach; b <= gy + reach && valid; b++) {
        for (const other of grid.get(`${a},${b}`) ?? []) {
          if (Math.hypot(x - points[other][0], y - points[other][1]) < Math.max(r, radii[other])) { valid = false; break; }
        }
      }
      if (valid) { insert(x, y, r); found = true; break; }
    }
    if (!found) { active[index] = active[active.length - 1]; active.pop(); }
  }
  return points;
}
