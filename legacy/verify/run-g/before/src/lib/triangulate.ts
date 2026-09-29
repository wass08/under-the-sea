import { Delaunay } from 'd3-delaunay';
export type Point2 = [number, number];
export type Bounds = [number, number, number, number];
/** Triangulate local 2D points; topology retains the caller's point indices. */
export function delaunayFrom(points: Point2[]) { return Delaunay.from(points); }
/** Clipped, unclosed cell polygons, in seed order (empty for duplicate seeds). */
export function voronoiCells(points: Point2[], bounds: Bounds): Point2[][] {
  const v = delaunayFrom(points).voronoi(bounds);
  return points.map((_, i) => (v.cellPolygon(i)?.slice(0, -1) ?? []) as Point2[]);
}
/** Area-weighted polygon centroid, with a degenerate-polygon fallback. */
export function polygonCentroid(polygon: Point2[]): Point2 {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], cross = a[0] * b[1] - b[0] * a[1];
    area += cross; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross;
  }
  return Math.abs(area) > 1e-12 ? [x / (3 * area), y / (3 * area)] : (polygon[0] ?? [0, 0]);
}
/** Lloyd relaxation; a false mask entry preserves that seed exactly on every iteration. */
export function lloydRelax(points: Point2[], bounds: Bounds, iterations: number, mask?: (point: Point2, index: number) => boolean) {
  const movable = points.map((p, i) => mask?.(p, i) ?? true);
  let result = points.map(p => [...p] as Point2);
  for (let n = 0; n < iterations; n++) {
    const cells = voronoiCells(result, bounds);
    result = result.map((p, i) => movable[i] && cells[i].length ? polygonCentroid(cells[i]) : p);
  }
  return result;
}
/** Circumcentres and radii in triangle order, skipping degenerate triangles. */
export function circumcircles(delaunay: Delaunay<Point2>) {
  const { points: p, triangles: t } = delaunay;
  const circles: { center: Point2; radius: number; triangle: number }[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const ax = p[t[i] * 2], ay = p[t[i] * 2 + 1];
    const bx = p[t[i + 1] * 2] - ax, by = p[t[i + 1] * 2 + 1] - ay;
    const cx = p[t[i + 2] * 2] - ax, cy = p[t[i + 2] * 2 + 1] - ay;
    const d = 2 * (bx * cy - by * cx); if (Math.abs(d) < 1e-12) continue;
    const b = bx * bx + by * by, c = cx * cx + cy * cy;
    const x = (cy * b - by * c) / d, y = (bx * c - cx * b) / d;
    circles.push({ center: [ax + x, ay + y], radius: Math.hypot(x, y), triangle: i / 3 });
  }
  return circles;
}
