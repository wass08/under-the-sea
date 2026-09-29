# Run B verification

## Implementation

Main aquarium: seeded level-3 Poisson/Delaunay island; RGB Worley caustics projected along the sun; physical water with micro-ripples, four impact rings, wall meniscus and sun reflection; physical glass with exposed fracture edges; bloom and vignette; Wawa Sensei branding and optional Web Audio.

Clicking an intact wall generates 220 radial Voronoi cells. Core cells within 0.28 units are released as Rapier hulls. Remaining extrusions are merged into a pane with a real hole and fixed hull colliders. Crack lines fade toward 1.2 units from impact. Each submerged opening gets droplets, a parabola ribbon, and a puddle initialized at the landing point. Analytic square-root drainage stops at the lowest sill, then drips stop after two simulation seconds. Space releases the remaining cells on cracked walls and drains fully. Reset removes physics bodies and spill objects and restores the initial water level.

One physics world steps at 120 Hz. Loose glass is rendered in a single geometry batch. Multi-wall fractures group cells to stay below 400 dynamic bodies. All animation uses simulation time.

## Files

Added:

- `src/audio.ts`
- `src/scene/spill.ts`
- `public/sfx/glass-breaking.mp3`
- `public/sfx/bubbles.mp3`
- `verify/edges.mjs`

Changed:

- `README.md`, `index.html`
- `src/main.ts`, `src/aquarium.ts`, `src/state.ts`, `src/camera.ts`
- `src/ui.ts`, `src/style.css`, `src/post.ts`
- `src/scene/island.ts`, `lighting.ts`, `water.ts`, `tank.ts`, `dust.ts`, `shafts.ts`
- `src/lib/noise.ts`, `physics.ts`, `worley.ts`
- `src/lab/terrain.ts`, `src/lab/caustics.ts`
- `verify/runtime.mjs`

The Lab routes, controls, reveal tools, and `verify/lab.mjs` are retained. Terrain snow/ridge shaping and caustics L1/L2 are the requested visual polish.

## Commands and results

- `npx tsc --noEmit`: PASS, zero diagnostics (`tsc.txt`).
- `npm run build`: PASS, exit 0 (`build.txt`). Vite still reports its large-chunk advisory for the shared Three/Rapier bundle (3.85 MB before gzip, 1.37 MB gzip).
- `npm run preview -- --port 4174`: serves the production build.
- `node verify/runtime.mjs`: PASS; no console errors (`summary.txt`, `console.txt`).
- `node verify/edges.mjs`: PASS; above-water hole emits nothing; one crack per wall; four simultaneous cracks; full four-wall break stays capped; reset clears everything (`edges-summary.txt`).
- `node verify/library.mjs`: PASS; determinism, topology, mask/spacing/normals, circumcircles, Voronoi coverage/density, and Rapier freeze/slow-motion/settling.
- `node verify/lab.mjs`: PASS, all nine bench/level checks and page navigation, zero errors and zero warnings (`lab/summary.txt`).

## Measured main-page evidence

Headless Chromium WebGPU/Metal on the local arm64 Mac, 1920 × 1080 CSS viewport, pixel ratio 1.5:

| State | Draw calls | Median FPS |
| --- | ---: | ---: |
| Idle | 51 | 60 |
| Shattered, 220 bodies | 47 | 60 |

FPS samples cover 90 animation frames between screenshots. CDP screenshot readback and initial shader compilation can temporarily stall the browser; instantaneous counters in snapshots may include those stalls.

The final click produced a sill at **1.4538710324**; water settled at exactly that height with `spilling: false`. Slow motion measured **0.150852×** real time. Reset restored **2.59**, zero cracks and zero shard bodies. The additional four-wall test used **371 bodies**, **41 draw calls**, and **60 FPS** at its 1× test pixel ratio.

## Screenshots reviewed

Main captures: `idle.png`, `crack.png` (~0.6 s), `spill.png` (~3 s), `shatter-airborne.png` (~0.3 s), `shatter.png` (~1.5 s), `shatter-settled.png` (~5 s), `reset.png`, `responsive.png` (900 CSS px).

All nine Lab levels and their generated reveals/broken-pane captures were visually reviewed, including `lab/caustics-L2.png` and `lab/terrain-L3.png`. L1 caustics is plain blue-green; L2 has dim static broad cells; L3 has thin bright depth-masked lines. Terrain L3 retains connected ridges, plains, and readable snow facets.

## Limits

No functional task remains unfinished. Refraction is Three's screen-space physical transmission with alpha compositing for nested glass/water, rather than recursive ray tracing. Spill ribbons, particle jets and puddles are inexpensive visual approximations, not a fluid solver. Grouped fragments in large multi-wall breaks use one convex collision hull per group to honor the body cap. The build's bundle-size advisory remains.
