# Run C — main-page visual restoration

## Changes and visual evidence

1. **Water** (`src/scene/water.ts`, `lighting.ts`, `shafts.ts`, `dust.ts`): restored the depth-absorbing teal volume and submerged material tint, including panes and motes. The physical surface now has its own teal tint, stronger animated ripple normals and Schlick Fresnel opacity; the sun highlight remains. Restored six visible light sheets and 440 motes. Evidence: `idle.png`, `reset.png`.
2. **Caustics** (`src/scene/lighting.ts`, `island.ts`): main-page sharpness 24 → 36. Rock contribution 0.45 → 0.24, additionally weighted by the flat geometric normal facing the sun and an upward-facing slope mask. Sand retains its brighter contribution. Shared Worley and Lab files were not changed. Evidence: `idle.png`, `reset.png`.
3. **Island** (`src/scene/island.ts`): deterministic level-3 terrain, seed 42, broader 4.9 × 3.05 footprint, softer mask, connected ridge and tapered slopes. Highest world elevation 3.28 (0.69 above water). Warmer slate, green slopes, sandy altitude band at the initial shoreline, wet band above the live water plane, small non-emissive #e6ecf0 cap. Evidence: `idle.png`, `spill.png`, `shatter.png`.
4. **Stage and bloom** (new `src/scene/stage.ts`, `src/aquarium.ts`, `src/post.ts`, `lighting.ts`, `tank.ts`): neutral slate floor gradient and localized feathered contact-shadow approximation replace the long directional floor shadows. Cooler sun/hemisphere colors. Base metalness 0.55 → 0.12 and roughness 0.25 → 0.68. Bloom strength 0.24, threshold 1.3, source capped at 3 to prevent enormous sun-reflection halos. Evidence: `idle.png`, `shatter-settled.png`.
5. **Glass** (`src/scene/tank.ts`): grazing-angle opacity/reflection rim, subtle emissive edge contribution, thin vertical edge and top-rim meshes. Rims follow existing break/reset visibility. Evidence: `idle.png`, `crack.png`.
6. **Spill** (`src/scene/spill.ts`): additive luminous droplets, ribbon opacity 0.68 → 0.44, partly transparent physical puddle with feathered edge, environment reflection and traveling micro-normal. Evidence: `crack.png`, `spill.png`, `shatter-settled.png`.
7. **Cracks**: retained the existing dense-core/radial edge geometry, line colors, distance fade, additive blending and opacity without edits. Evidence: `crack.png`.

The Run B pipeline remains: click → level-3 core shards and real hole → Torricelli drain and per-hole spill; Space → remaining Rapier shards and full drain. Sound, branding, camera, clock, controls and Lab behavior remain functional.

## Verification

All commands exited 0 against the production preview on port 4174:

- `npx tsc --noEmit` — no diagnostics.
- `npm run build` — successful. Existing Vite advisory for the shared Three/Rapier bundle exceeding 2000 kB remains; see `build.txt`.
- `node verify/runtime.mjs` — every assertion passed, no console errors. See `summary.txt` and `console.txt`.
- `node verify/lab.mjs` — all nine bench/level combinations, interactions and navigation passed; zero errors and warnings. See `lab/summary.txt`.

Final runtime: height settled exactly at hole bottom 1.453869280971047, spilling false; 220 bodies after full shatter; slow-motion rate 0.1497154; reset height 2.59, zero cracks/bodies. At 1920 × 1080 and pixel ratio 1.5, median idle and shattered FPS were both 60; draw calls were 60 idle and 54 shattered (66 while spilling).

One preceding run measured 40 FPS in the shattered sample. It is retained in `performance-variation.txt`; repeating the same build measured 60. These are browser measurements, not a guarantee of a locked frame rate under every system load.

Inspected all final runtime captures: `idle.png`, `crack.png`, `spill.png`, `shatter-airborne.png`, `shatter.png`, `shatter-settled.png`, `reset.png`, `responsive.png`. Also rechecked Lab `terrain-L3.png` and `caustics-L2.png`. Compared the original `idle-before.png`; that reference is preserved. Initial Run B captures are retained in `run-b-reference/`.

No requested functional work remains unfinished. The stage contact shadow is an intentional analytic approximation; transmissive materials use the existing Three screen-space transmission buffer and alpha compositing.
