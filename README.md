# School — Wawa Sensei

*You can't prompt what you can't name*, episode 2: **Boids & GPGPU**.

A floating 36 × 36 block of ocean with a palm island in the middle and thousands of GPU-simulated schooling fish. They show three collective behaviours: **milling**, the **fountain effect** and **flash expansion**. A fisherman in a rowboat casts a line: the splash scatters the school, calm returns, curious fish inspect the lure, one of them bites, and you click to hook it.

Vite + vanilla TypeScript, three 0.186 WebGPU/TSL (compute shaders + instancing), Tweakpane.

## Run

```sh
npm install
npm run dev
```

Open current Chrome or Edge with WebGPU and hardware acceleration enabled.

## Controls

- **Click the water:** cast. The splash sends a panic wave through the school.
- **Click / Space while "Click to hook!" shows:** set the hook. The fish is reeled into the boat, and the counter goes up.
- **Click the water while the line is in:** reel in and recast.
- **Drag / scroll / right-drag:** orbit / zoom / pan.
- **Panel:**
  - **School:** milling, fountain (predator), flash expansion, plus flocking, milling, fountain, panic, lure and look tuning.
  - **Fishing:** auto-fish for hands-free recording, lure depth, bite timing, hook window.
  - **World:** sun, waves, caustics, god rays, murk, bloom.
  - **Global:** a time-scale slider for slow motion. Everything runs on the simulation clock.

### URL switches

| Param | Effect |
| --- | --- |
| `?fish=32768` | School size (256 … 262144, default 12288 in three sub-schools). Buffers are fixed at boot. |
| `?autofish` | Start in auto-fish mode. |
| `?milling=1` | Start milling. |
| `?fishDemo=milling\|fountain\|panic\|flash` | Force a behaviour (panic re-triggers every few seconds). |
| `?fishCam=close\|mid\|top\|x,y,z`, `?cam=side\|top\|close\|under\|island\|inside…`, `?fishingCam=boat\|cast` | Debug cameras. |
| `?sun=azimuth,elevation` | Override the sun. |

## Architecture

`src/main.ts` wires three modules through the interfaces in `src/contracts.ts`. The shared constants live in `src/config.ts`: a 12 × 12 block, earth slab up to y ≈ 1.2, water surface at y = 7.2, ground at y = −3.4. The shared uniforms live in `src/state.ts`: `simTime`, `sunDirection`, `waterLevel`.

### `src/fish` — the school (GPGPU + instancing)

- **Geometry** (`geometry.ts`)
  - The Tripo GLBs carry a morph-target `Swim` clip.
  - At load, the primitives are merged. Body and fins become one draw, with a per-vertex texture id.
  - The heavy multi-layer eyes become two tiny layers.
  - meshoptimizer simplifies each primitive to ≈430 triangles, checking extreme morph poses so the tail keeps its shape.
  - The clip is baked into a **vertex animation texture**: 32 frames of positions and normals.
- **Simulation** (`sim.ts`). All TSL compute, with no per-fish CPU work. Each frame:
  1. clear the uniform grid;
  2. insert each fish into fixed-capacity cells with `atomicAdd`;
  3. pick a strike candidate with `atomicMin` on a packed distance/index key;
  4. simulate by scanning the 27 neighbouring cells with a capped neighbour count;
  5. gather stats about every 100 ms, read back asynchronously.

  The simulate pass handles:
  - classic boids: separation, alignment and cohesion, with a turn-rate limit and a pitch limit;
  - soft walls, the water ceiling and terrain avoidance from the world's height field;
  - wandering sub-group attractors, plus these behaviours:
    - **Milling:** a tangential drive around a vertical axis, a radial spring to the ring radius and a vertical band. The result is a rotating torus with a hollow core.
    - **Fountain effect:** fish ahead of and beside the predator steer perpendicular to its heading and backwards. The school opens around it and closes behind it.
    - **Flash expansion:** an expanding spherical wavefront sets fear and a radial burst. Fear also jumps fish-to-fish through neighbours after a short random delay. A brief metallic flank glint at the front makes a visible ring of flashing fish. Fear decays and the school regroups.
    - **Curiosity & bite:** a small hashed subset of "bold" fish inspects the lure. `strike()` sends the nearest inspector at it, and the hooked fish stays pinned to the lure until `land()`.
- **Rendering** (`render.ts`)
  - One instanced draw. The vertex shader orients each fish from its velocity, with banking and per-fish size and tint variation.
  - The swim animation is interpolated from the VAT. Tail-beat rate follows speed and fear.
  - The fragment shader adds depth tint, caustics and the flash glint.
  - Shadows come from a 70-triangle proxy on layer 3, which only the sun's shadow camera renders.
- **Predator** (`predator.ts`): a fish_02 scaled into a predator, simulated on the CPU. It cruises, then charges through the school centroid.

### `src/scene` — the floating diorama

- **Terrain** (`field.ts`, `terrain.ts`, `island.ts`, `flora.ts`)
  - A single analytic height field drives the Poisson/Delaunay low-poly seabed and island, the earth-slab strata and the fish avoidance grid.
  - It also carries a craggy underbelly, instanced swaying seagrass, kelp and coral, and low-poly palms and pines.
- **Water** (`water.ts`, `src/lib/ocean.ts`)
  - The surface is a sum of peaked sine waves plus 12 ripple slots. A CPU mirror uses the same table, so the boat bobs exactly on the surface.
  - The top and the four standing side faces share a volume shader: screen-space refraction clamped at grazing angles and screen edges, and path-length Beer–Lambert absorption with in-scatter.
  - It adds god rays (a 14-step raymarch shadowed by the island), a planar reflection (layer 1 only), sparkle glints and shoreline foam.
  - An oriented hull mask keeps the water out of the boat.
- **Lighting and post** (`lighting.ts`, `atmosphere.ts`, `particles.ts`, `post.ts`)
  - Warm directional sun with a 4096 shadow map and an HDRI environment.
  - Worley caustics on the seabed, and a caustic light pool on the ground below the block.
  - A dusk gradient sky, plankton motes and bubble streams.
  - Bloom, grade and vignette.

### `src/fishing` — boat, fisherman, game

- **Boat and fisherman** (`boat.ts`, `fisherman.ts`, `build.ts`)
  - A procedural lapstrake rowboat that floats on the CPU wave mirror.
  - A low-poly fisherman with 2-bone arm IK. His poses: wind-up, whip, wait, lean on the bite, hook jerk, reel, cheer, shrug.
- **Rod and line** (`rig.ts`): a tapered rod that bends with tension. The line is a camera-facing ribbon: a ballistic arc in flight, a catenary sag once in the water. It also draws the bobber and the lure.
- **Splash effects** (`fx.ts`): motion-stretched droplets, a crown sheet, a foam disc and rings, drips.
- **Game loop** (`game.ts`): a pure state machine, `idle → casting → scared → calm → curious → approaching → bite → reeling → celebrate`, with `missed` and `retrieving` branches. All timers use simulation time.
- **HUD** (`hud.ts`): the caught counter, a status line, and the hook prompt placed at the bobber.
- `mock-school.ts` stands in for the GPU school when it's absent (`count === 0`).

## Tools

- `node tools/shot.mjs <url> <out.png> [waitMs]` renders the running dev server in headless WebGPU Chrome. It prints `window.school` (fps, draw calls, triangles, school stats) and any console errors.
- `node tools/fishing-seq.mjs <url> <prefix>` drives a full cast → bite → catch cycle and screenshots each stage.

## Legacy

The previous episode (glass aquarium, Voronoi & Delaunay, and its Lab) lives in `legacy/` for reference. The Lab for this episode will come later.

## HDRI attribution

[Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), **Poly Haven, CC0**.
