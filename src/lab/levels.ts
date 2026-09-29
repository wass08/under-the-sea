import type { BenchName, LevelText } from './types';
export const levels: Record<BenchName, LevelText[]> = {
  terrain: [
    { title: 'Dense grid, smooth shading', technique: 'PlaneGeometry with tens of thousands of segments, heights from the noise field, smooth vertex normals, colour banded per pixel by height and slope', sees: 'Melted, rubbery slopes, streaks and colour rings, and a wall of triangles that adds nothing' },
    { title: 'Low-poly grid, flat shading', technique: 'Same heights on a coarse grid, flat face normals, one biome per face', sees: 'Facets finally read as rock, but the grid shows through: staircase ridges, diagonal hatching, every triangle identical, flat sand as expensive as peaks' },
    { title: 'Poisson-disk + Delaunay', technique: 'Same heights, Poisson-disk sampling with density weighted by slope, Delaunay triangulation, flat shading', sees: 'Clean facets, detail on ridges, cheap plains. Switch sampling to random to see clumps and slivers' },
  ],
  caustics: [
    { title: 'Worley F1: cells', technique: 'One Worley layer: F1 is the distance to the nearest feature point. Animate the points, cube the distance into soft light', sees: 'Soft bright blobs between the cells. Bubbly, not caustic. This is what "use Worley noise" gets you' },
    { title: 'F2 − F1: Voronoi edges', technique: 'Same layer: F2 − F1 is the distance to the Voronoi edge, zero on the edge. Invert it and pow()-sharpen it into thin lines', sees: 'A bright net of thin lines: caustics are Voronoi edges. But one scale, one rigid sheet sliding' },
    { title: 'Two layers, F2 − F1, depth falloff', technique: 'Two animated Worley layers at different scales counter-scrolling, F2 − F1 for edges, inverted and pow()-sharpened, slight per-channel RGB offsets, brightness fading with water depth', sees: 'Thin irregular shimmering light lines, two scales interfering, colour fringes, fading as the sand rises out of the water' },
  ],
  shatter: [
    { title: 'Uniform grid', technique: 'Uniform grid of cells, every shard identical', sees: 'Glass falls apart like floor tiles. Obviously fake.' },
    { title: 'Random seeds, Voronoi cells', technique: 'Uniform random seeds, Voronoi cells, extruded, rigid bodies', sees: 'Irregular shards with uniform seed density; the impact drives a fast core and a slower outer fan.' },
    { title: 'Radial density + rings + Lloyd', technique: 'Seed density falling off radially from the click point, a few concentric ring layers, Lloyd relaxation on the outer seeds, extruded slabs with transmission material, impulse applied outward from the impact with falloff', sees: 'Dense fragments at the strike growing into long radial shards, ring cracks, shards blowing outward.' },
  ],
};
