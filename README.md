# Aquarium — Wawa Sensei

**Watch the video: [Three problems. One word.](https://youtu.be/ywYOIk3rgHw)** — *You can't prompt what you can't name*, episode 1: Voronoi & Delaunay.

[![Three problems. One word. — Wawa Sensei](https://img.youtube.com/vi/ywYOIk3rgHw/maxresdefault.jpg)](https://youtu.be/ywYOIk3rgHw)

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
- **R / Reset:** rewind shards, water, ribbons and puddles over 3.2 seconds, then restore the pristine tank and ease the camera home. Press again to skip. Slow motion also slows rewind; speed and sound preferences persist.
- **M / Sound:** glass and looping bubbles, on by default unless localStorage stores `aquarium-sound=off`. Files preload into a suspended context; the first gesture resumes it. Playback trims detected leading silence and tolerates unavailable devices.
- **Drag / scroll:** orbit / zoom. **Enter the Lab** opens `#/lab/terrain`.

## Main-page pipeline

`scene/island.ts` selects the island with one presenter-facing `ISLAND_SEED` constant (currently **38**). Its 5.6 × 3.5 Poisson/Delaunay landform combines an asymmetric peak/ridge/saddle/beach height-field prior with domain-warped ridged noise, eight thermal-erosion passes and 420 seeded downhill graph droplets. Cliff faces remain rock at every height; neighbouring biome weights keep meadows and the ragged upper snow cap coherent. The summit stays 0.60 units above the initial waterline. A cool hemisphere and weak sand bounce preserve underwater facets.

Run `node verify/island-sheet.mjs` to search 240 seeds and render the eight highest-scoring eligible choices alongside the actual Run N seed-42 baseline. The 1920 × 1200 contact sheet is `verify/island-sheet.png`; change only `ISLAND_SEED` to select another tile. The Lab keeps its original Poisson + ridged-noise + Delaunay pipeline without the main-only shaping/erosion passes.

`scene/lighting.ts` projects the Lab's level-3 `causticsField` (two counter-scrolling, sharpened RGB Worley layers) along a fixed arc lamp direction. The head is at **(-2.65, 6.1, -2.3)**, aimed toward **(0, 1.25, 0)**: light direction **(-0.442682, 0.810192, -0.384215)**. Its warm directional light, shadows, water glint, shafts and caustic coordinates share that direction; it never orbits. A faint cool hemisphere/environment fills the shadows. Sand, island and reef use the depth- and shadow-masked field; the blue stage uses the same function with a 0.38 along-light scale. Water drainage fades both paths.

`scene/water.ts` displaces a bounded 128 × 80 plane with six small Gerstner waves and matching analytic derivatives, a damped tilt spring, an agitation-driven travelling wave and four decaying ripple impulses. Physical transmission/IOR, Fresnel opacity, teal body colour and a wall meniscus make the water readable from both sides. Ripple events and agitation are included in rewind snapshots. Glass and water use alpha compositing alongside transmission: Three's screen-space transmission buffer cannot recursively refract nested transparent objects.

`state.ts` defines the **7.6 × 4.4** tank, rim **3.0**, waterline **2.25**, and unchanged floor **0.16**. Geometry, clipping, terrain height texture, reef, vents, motes, shafts, camera presets and verification targets follow these dimensions.

`scene/tank.ts` leaves a real hole and fixed convex cells after a crack. Both pages call `lib/release.ts`: level 3 combines 0.85 in-plane radial direction with 0.55 pane normal, a small core up-bias, and speed `strength × (1.8 + 5.7 × exp(-3 × distance))`. This is 7.5 m/s at impact and 1.885 m/s at 1.4 units. Outward-biased, seeded random axes tumble at 4–14 rad/s with the same distance falloff. Main full releases use strength 1.35, capped at 9 m/s, with spin strength bounded at 0.75 so the larger plates finish toppling. The Lab keeps the original spin profile. Crack core cells use strength 0.55; a lower core grouping threshold preserves small fragments. L1 remains unspun tiles with a uniform 2.2 m/s normal push; L2 adds a mild radial component.

Both pages use 60 Hz fixed-step Rapier, density-scaled impulses, conditioned real inertia, CCD, separate convex hulls per cell, inset/corner clearance, and up to 0.003 contact skin. Releases start on a solver boundary and seed their random stream independently of render timing/reset history. The solver uses 12/4 iterations, rising to 48/12 above 512 colliders for coupled multi-pane piles, with a stage-sized native contact/sleep scale. Removing a cracked pane wakes its existing fragments so Rapier rebuilds the support islands. Contact friction is 1.2; initial angular contact damping is 1 so plates finish toppling, followed by 8/20 linear/angular damping after supported motion becomes slow. Rapier owns sleep; no early manual sleep or timed freeze is used. The unchanged 30-second fallback only fixes an already stationary body. Main glass is depth-sorted in one batch, capped below 0.55, with highlighted core fragments. At most 400 dynamic bodies are used.

`scene/spill.ts` gives each hole a ballistic particle emitter, a thin absorption-shaded slab with projectile travel-time streaks, foam and a fading run-out, impact spray, and a growing blue puddle with ripple rings and a feathered rim. A per-channel output cap keeps the puddle blue and below bloom in both forward and reverse playback. The level integrates Torricelli's square-root head rate analytically to stop exactly at the lowest hole sill. Dry holes emit nothing; wet holes finish with two seconds of drips. Full break widens the streams and drains quickly. Particles (2,600 slots), physics, camera motion, caustics and ripples use simulation time; the lamp stays fixed. Sheet UVs follow arc length and the noise phase follows projectile travel time, so local UV speed is flow speed divided by arc length. Droplets start at the sheet edges and follow analytic ballistic paths. Diagnostics compare actual landing velocities against the final mesh segment’s streak speed.

`scene/shafts.ts` performs a 16-step, jittered single-scattering raymarch through the water volume. The ray intersects the tank and tilted water plane, stops at opaque scene depth, fades near the glass, and samples a height field of the actual island toward the sun. `scene/stage.ts` integrates sandy ripple shading, wet footprints and soft contact darkening in one floor material. A texel-snapped directional shadow with fixed tent-PCF filtering darkens both the floor and its caustics. Glass and water do not cast hard shadows. Puddles use explicit floor clearance, distinct heights, polygon offset and stable draw order.

`rewind.ts` starts with 30 Hz snapshots and adaptively compacts the full history to about 600 samples, retaining the original break and release events. A 3.2-second quintic ease traverses the history backwards, compressing stationary holds, interpolating positions, quaternions, water, sheets and puddles. Particles clear at the start; crack lines retract toward the impact during the final portion. A subtle cool desaturation and pitched reverse glass audio accompany the return. The visual clock continues smoothly after rewind while the physics clock pauses during playback.

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

The main runtime script requires real WebGPU rendering at 1920×1080, pixel ratio 1.5. It captures idle, crack (~0.6 s), spill (~3 s), shatter (~1.5 s), settled shatter (10 s), reset, plus early airborne shards, 20/50/85-percent rewind, six camera presets, and responsive layouts. It checks the exact settled sill, no spilling afterward, full break, body cap, measured 0.15× time, exact pristine reset, 3–4-second shard pose stability, native sleep by five seconds without the fallback, 8–10-second pose invariance, same-frame audio scheduling and onset offsets, touch/keyboard spoiler reveal, sound toggle, drag discrimination, branding, and the missing-WebGPU guard. `edges.mjs` also checks dry cracks, a four-wall break, and slow-motion rewind/reset during an active spill. Logs and captures are in `verify/`.

## The Lab: Voronoi / Delaunay

Open `#/lab` (redirects to terrain), or use **Enter the Lab** in the aquarium. Direct routes are `#/lab/terrain?level=3`, `#/lab/caustics?level=3`, and `#/lab/shatter?level=3`. The default is level 3. Use the slider, **1 / 2 / 3**, or **← / →** to compare techniques. Each bench retains its parameters when changing levels or benches during the Lab session.

| Bench | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| Terrain | Dense grid, smooth shading: per-pixel height/slope colour bands | Low-poly grid, flat shading: per-face biomes | Poisson-disk + Delaunay: slope-weighted sampling, flat facets; random sampling comparison |
| Caustics | Worley F1: animated cells, cubed into soft blobs | F2 − F1: the same animated layer, inverted and sharpened into Voronoi edges | Two counter-scrolling F2 − F1 layers, sharpened RGB light lines, water-depth fade |
| Shatter | Identical rectangular tiles | Uniform random Voronoi shards | Dense impact core, radial rings, outer-only Lloyd relaxation, outward impulses |

Terrain reveals: wireframe, seeds, biome regions, sea level, and **smooth shading** at every level (on by default only at L1). L3 adds **sampling: poisson / random**, also available as `window.lab.setReveal({ sampling: 'random' })`. All levels sample the same analytic height field. L1 defaults to 29,929 vertices (173×173, count control 2,000–40,000); its seed reveal subsamples to at most 2,000 dots, while wireframe shows every triangle. L2 defaults to 1,521 vertices (39×39). L1's dense count persists separately from the shared L2/L3 count (200–4,000); smooth shading persists separately per level. Other terrain settings and the camera continue across level changes. Poisson counts are approximate; boundary samples are additional. Terrain auto-orbits until you drag.

Caustics reveals: L1 raw F1, cell seeds, freeze; L2 raw F2 − F1, cell seeds, freeze; L3 raw F1, cell seeds, layer isolation, freeze. L1 exposes scale A, speed, intensity and water level; L2 adds sharpness; L3 adds scale B and RGB offset. L1/L2 keep a flat teal base with no depth fade. All shader motion uses an explicit simulation clock. Shatter reveals work on the intact pane. Click to fracture, use freeze or 0.15× slow motion to inspect, and **R / Reset pane** to restore. Shards use Rapier convex hulls and remain on the floor after settling.

### Shared library and ownership

`src/lib/` has no Lab UI dependency:

- `random.ts`: deterministic PRNG, also re-exported from `state.ts` without changing the aquarium's sequence.
- `noise.ts`: seeded simplex, normalized fBm, ridged octaves, and terrain height shaping.
- `poisson.ts`: Bridson sampling with symmetric variable-radius exclusion and explicit minimum/maximum radii.
- `triangulate.ts`: Delaunay, clipped Voronoi polygons, polygon centroids, masked Lloyd relaxation, circumcircles.
- `terrain.ts`: non-indexed geometry, seed x/z pairs, heights, Delaunay topology, per-vertex biome labels, blended biome weights and slope attributes. Optional domain warping, thermal erosion and island shaping precede neighbourhood classification. The optional mask multiplies heights. `generateTerrain` keeps `level: 1 | 2 | 3`; `sampling: 'poisson' | 'random'` selects L3 sampling, and `smooth` overrides the level's normal default without changing geometry or per-face attributes.
- `worley.ts`: GPU TSL F1/F2/seed masks and three-level caustic composition. Create uniforms with `createCausticsUniforms()`, pass a caller-owned time uniform, and call `params.advance(time, simulationDt)` to honor freeze. Layer values are 0=both, 1=A, 2=B. The field returns an additive RGB light contribution; raw/seeds are diagnostic overrides.
- `shatter.ts`: pane-local x/y fracture cells, centroid-centred extrusions, outlines, seed geometries. Caller owns/disposes returned geometries.
- `physics.ts`: exported `physicsReady` promise, independent async `createPhysicsWorld()`, fixed steps (120 Hz by default, 60 Hz for the shared shard worlds), time scale, freeze, transform sync, disposal. `addShard` expects a unit-scale mesh whose position/quaternion are world-space; static box sizes are full extents.
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

## Run N evidence

[Run N report](verify/run-n/REPORT.md) records the six checks, measured launch distributions/radial fractions, settling and determinism evidence, fixed lamp vector, screenshot colour samples, and measured sheet/drop speed agreement.

## Run O evidence

[Run O report](verify/run-o/REPORT.md) contains the reviewed island contact sheet, the seed table, per-pass height statistics, submerged-facet luminance, visible projectile-synchronized spill and stronger-burst launch/stability measurements.
