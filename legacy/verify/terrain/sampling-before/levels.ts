import type { BenchName, LevelText } from './types';
export const levels: Record<BenchName, LevelText[]> = {
  terrain: [
    { title: 'Random points, random heights', technique: 'Uniform random points, a random height per point', sees: 'Spiky chaotic mess, no landform.' },
    { title: 'Same points, noise heights', technique: 'Heights sampled from fBm noise (a few octaves of simplex)', sees: 'Rolling hills appear, but triangles are clumpy and uneven: some huge, some slivers.' },
    { title: 'Poisson-disk + ridged noise + Delaunay', technique: 'Poisson-disk sampling with density weighted by slope, ridged noise (1 − |n|) over fBm, a power curve to flatten valleys, Delaunay triangulation, flat shading', sees: 'Clean even facets, sharp ridges, detail where it matters, cheap flat plains.' },
  ],
  caustics: [
    { title: 'Sine interference', technique: 'Two skewed sine waves, slowly scrolling, summed and sharpened', sees: 'Rigid plaid slides but never varies. No cell structure.' },
    { title: 'One Worley layer', technique: 'Single Worley F1: no animation, no second layer, low contrast', sees: 'Right cell structure, wrong parameters: dim, thick and lifeless.' },
    { title: 'Two layers, F2 − F1, depth falloff', technique: 'Two animated Worley layers at different scales counter-scrolling, F2 − F1 for edges, inverted and pow()-sharpened, slight per-channel RGB offsets, brightness fading with water depth', sees: 'Thin irregular shimmering light lines that fade as the sand rises out of the water.' },
  ],
  shatter: [
    { title: 'Uniform grid', technique: 'Uniform grid of cells, every shard identical', sees: 'Glass falls apart like floor tiles. Obviously fake.' },
    { title: 'Random seeds, Voronoi cells', technique: 'Uniform random seeds, Voronoi cells, extruded, rigid bodies', sees: 'Irregular shards, but evenly sized everywhere and no sense of an impact point.' },
    { title: 'Radial density + rings + Lloyd', technique: 'Seed density falling off radially from the click point, a few concentric ring layers, Lloyd relaxation on the outer seeds, extruded slabs with transmission material, impulse applied outward from the impact with falloff', sees: 'Dense fragments at the strike growing into long radial shards, ring cracks, shards blowing outward.' },
  ],
};
