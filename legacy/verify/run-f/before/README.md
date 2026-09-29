# Aquarium — Wawa Sensei

A small world held in glass. Vite + vanilla TypeScript, Three 0.186.0 WebGPU/TSL, and Rapier. The main page uses the same level-3 terrain, Worley caustics, and radial Voronoi fracture generators as the Lab.

## Run

```sh
npm install
npm run dev
```

Open current Chrome or Edge with WebGPU and hardware acceleration on localhost or HTTPS. The page gives an explanation when WebGPU is unavailable.

## Controls

- **Click a side wall:** crack it once. Dense core fragments pop out, leaving a real hole, exposed glass edges, and fading radial crack lines. Up to four walls can be cracked.
- **Space / Shatter:** release the remaining cells on every cracked wall; without a crack, use the default front impact. Water drains fully and the camera pushes in.
- **T / Slow motion:** switch between 1× and 0.15× simulation time.
- **R / Reset:** restore panes, refill immediately, clear shards/streams/puddles, and ease the camera home. Keep speed and sound preferences.
- **M / Sound:** optional glass and looping bubbles. Muted by default, with the choice saved in localStorage. Audio starts only after a gesture and tolerates unavailable devices.
- **Drag / scroll:** orbit / zoom. **Enter the Lab** opens `#/lab/terrain`.

## Main-page pipeline

`scene/island.ts` builds a seeded, masked Poisson/Delaunay landform with a 4.9 × 3.05 footprint and a summit 0.69 units above the initial waterline. Biome facets, wet shoreline shading, sand, and instanced gravel share depth-aware underwater lighting.

`scene/lighting.ts` projects the level-3 RGB Worley field along the animated sun direction. Its light fades in over 0.15 units beneath the shared water plane and attenuates with depth. Water drains below the sand, so caustics disappear after full shatter.

`scene/water.ts` deforms one bounded plane using a damped tilt spring. Physical transmission/IOR, scrolling micro-normal noise, four decaying ripple uniforms, a wall meniscus, and sun specular make the water readable from both sides. Glass and water use alpha compositing alongside transmission: Three's screen-space transmission buffer cannot recursively refract nested transparent objects.

`scene/tank.ts` merges the remaining extruded fracture cells into one pane with a real hole. Remaining cells get fixed convex colliders. Core shards and later full shards use one Rapier world, fixed 1/120-second substeps, CCD, gravity, floor/base/pane collisions, and sleeping. All loose glass is transformed into one render batch. Released shards use 0.12 roughness and an HDR output cap of 1.1 to keep sun glints below the bloom threshold. At most 400 dynamic bodies are used; larger multi-wall breaks combine edge-adjacent cells into compound fragments with a separate convex collider per cell.

`scene/spill.ts` gives each hole a ballistic particle emitter, a refractive parabola ribbon, and a growing reflective puddle. The level integrates Torricelli's square-root head rate analytically to stop exactly at the lowest hole sill. Dry holes emit nothing; wet holes finish with two seconds of drips. Full break widens the streams and drains quickly. Particles (2,600 slots), physics, camera motion, caustics, ripples, and sunlight all use simulation time.

`post.ts` uses bloom (0.24 strength, 0.4 radius, 1.3 threshold) and a subtle vignette. No depth of field. Pixel ratio is capped at 1.5. `window.aquarium` exposes read-only mode, cracks, sill heights, spilling, elapsed time, body count, FPS, draw calls, and projected verification targets.

## HDRI attribution

[Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), **Poly Haven, CC0**. The included `public/hdri/sky.hdr` supplies reflections; the background matches the fog. RoomEnvironment is a fallback if loading fails.

## Verification

```sh
npx tsc --noEmit
npm run build
npm run preview -- --port 4174
# In another terminal:
node verify/runtime.mjs
node verify/edges.mjs
node verify/lab.mjs
node verify/library.mjs
```

The main runtime script requires real WebGPU rendering at 1920×1080, pixel ratio 1.5. It captures idle, crack (~0.6 s), spill (~3 s), shatter (~1.5 s), settled shatter (~5 s), reset, plus early airborne shards and a 900px layout. It checks the exact settled sill, no spilling afterward, full break, body cap, measured 0.15× time, reset, sound toggle, drag discrimination, branding, and the missing-WebGPU guard. `edges.mjs` also checks dry cracks and a four-wall break. Logs and captures are in `verify/`.

## The Lab: Voronoi / Delaunay

Open `#/lab` (redirects to terrain), or use **Enter the Lab** in the aquarium. Direct routes are `#/lab/terrain?level=3`, `#/lab/caustics?level=3`, and `#/lab/shatter?level=3`. The default is level 3. Use the slider, **1 / 2 / 3**, or **← / →** to compare techniques. Each bench retains its parameters when changing levels or benches during the Lab session.

| Bench | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| Terrain | Random positions and heights | Same positions, simplex fBm heights | Slope-weighted Bridson Poisson-disk sampling, ridged fBm, valley power curve, Delaunay facets |
| Caustics | Flat floor colour | Static, broad Worley F1 field | Two counter-scrolling F2 − F1 layers, sharpened RGB light lines, water-depth fade |
| Shatter | Identical rectangular tiles | Uniform random Voronoi shards | Dense impact core, radial rings, outer-only Lloyd relaxation, outward impulses |

Terrain reveals: wireframe, seeds, circumcircles (first 1,500 triangles; very large boundary circles omitted), biome boundaries, sea level. The seed-count control is approximate for saturated variable-radius Poisson sampling; boundary samples are additional. Terrain auto-orbits until you drag.

Caustics reveals: raw F1, feature points, layer isolation, freeze; all shader motion uses an explicit simulation clock. Shatter reveals work on the intact pane. Click to fracture, use freeze or 0.15× slow motion to inspect, and **R / Reset pane** to restore. Shards use Rapier convex hulls and remain on the floor after settling.

### Shared library and ownership

`src/lib/` has no Lab UI dependency:

- `random.ts`: deterministic PRNG, also re-exported from `state.ts` without changing the aquarium's sequence.
- `noise.ts`: seeded simplex, normalized fBm, ridged octaves, and terrain height shaping.
- `poisson.ts`: Bridson sampling with symmetric variable-radius exclusion and explicit minimum/maximum radii.
- `triangulate.ts`: Delaunay, clipped Voronoi polygons, polygon centroids, masked Lloyd relaxation, circumcircles.
- `terrain.ts`: non-indexed geometry, seed x/z pairs, heights, Delaunay topology, per-vertex biome and slope attributes. The optional mask multiplies heights.
- `worley.ts`: GPU TSL F1/F2/seed masks and three-level caustic composition. Create uniforms with `createCausticsUniforms()`, pass a caller-owned time uniform, and call `params.advance(time, simulationDt)` to honor freeze. Layer values are 0=both, 1=A, 2=B. The field returns an additive RGB light contribution; raw/seeds are diagnostic overrides.
- `shatter.ts`: pane-local x/y fracture cells, centroid-centred extrusions, outlines, seed geometries. Caller owns/disposes returned geometries.
- `physics.ts`: exported `physicsReady` promise, independent async `createPhysicsWorld()`, fixed 120 Hz steps, time scale, freeze, transform sync, disposal. `addShard` expects a unit-scale mesh whose position/quaternion are world-space; static box sizes are full extents.
- `post.ts`: bloom-only `RenderPipeline`; its `dispose()` also releases scene/bloom render targets.

The Lab owns one WebGPU renderer. Bench changes dispose the previous scene group, geometry, materials, pane, post-processing targets, and physics world. Lab-to-aquarium navigation reloads the document after Lab teardown; aquarium-to-Lab reloads to release the aquarium's existing listeners and renderer. `src/aquarium.ts` orchestrates the main page and exposes `window.aquarium` diagnostics.

Algorithms/API references: [D3 Delaunay/Voronoi](https://d3js.org/d3-delaunay), [Rapier colliders](https://rapier.rs/docs/user_guides/javascript/colliders/), [Rapier impulses](https://rapier.rs/docs/user_guides/javascript/rigid_body_forces_and_impulses/), and the locally saved r186 HTML examples in `verify/reference/`.

### Lab verification

```sh
npx tsc --noEmit
npm run build
npm run preview -- --port 4174
# Another terminal:
node verify/lab.mjs
node verify/library.mjs
VERIFY_URL=http://localhost:4174 node verify/runtime.mjs
```

`verify/lab.mjs` exercises all nine bench/level combinations, same-seed terrain transitions (including regeneration), reveal hooks, pane clicks, simulation freeze/reset, keyboard navigation, and both page links. It captures 1600×1000 images to `verify/lab/`, including main-page, raw-field, wireframe/seeds, intact fracture-pattern, and broken-pane images. Logs: `verify/lab/console.txt`, `summary.txt`. Test hooks are `window.lab.ready`, `window.lab.state`, and `window.lab.setReveal({...})`.

`verify/library.mjs` bundles the TypeScript test entry with Vite's installed Rolldown, then checks determinism, upward normals, masks, radius exclusion, circumcircle geometry, preserved Lloyd seeds, exact pane coverage (including corner impacts), radial density, centroid placement, and Rapier freeze/slow-motion/settling. Verification artifacts are gitignored like the existing `verify/` captures.
