# Run G — visual corrections

Five production files changed behavior, all under `src/scene/`: `island.ts`, `water.ts`, `shafts.ts`, `tank.ts`, `spill.ts`. A stale mask-sharing comment in `lighting.ts` was corrected. No physics, rewind timing/state, audio, UI, Lab, or verification-script behavior changed.

## 1. Underwater contrast

The baseline isolation captures in `before/` remove each transparent layer individually, then all of them. For the chosen adjacent rock facets, contrast remains 1.04–1.05 even with all transparent layers hidden. The main cause was the island material's broad indirect/environment lighting: it remained strong while underwater tint reduced the direct diffuse color. `underwaterColor` already multiplies/darkens color; it does not add white, and it was left unchanged.

The island now attenuates indirect illumination below the water plane using the material's ambient-occlusion input (smoothly from 1 above water to .045 below), preserving direct sun lighting. Glass and water no longer fog the already-fogged opaque interior again.

`contrast.py` measures linear sRGB relative luminance with Rec.709 weights, averaged over 5×5 patches at fixed adjacent facet centroids in the 2880×1620 `pass-front.png`. These are faces 1916 (lit, pixel 1924,979) and 2096 (away from sun, pixel 1937,991), both the rock biome. They share an edge, and centroid rays were checked against the full triangle mesh to confirm visibility.

- Before: lit .20667, dark .19749, ratio **1.046**.
- After: approximately lit .02958, dark .01502, ratio **1.969** (see `contrast.json` for exact current values).
- The measurement asserts the requested ratio ≥1.6. It uses the same faces and pixel patches before and after.

## 2. Visible, separated shafts

The old contribution was too weak, and a vector condition passed to TSL’s scalar `select()` incorrectly used the X-axis sign for the entire ray. Front-left rays consequently missed the water bounds. Scalar selection now preserves each axis sign independently. Debugging with constant-density marching and removing depth clipping isolated the bounds error; even without depth clipping, front-left rays disappeared before this fix. Simply amplifying the one-dimensional stripe mask spread light across oblique view rays, producing another veil. The raymarch now samples five localized soft apertures projected into light space at the water surface, with exactly zero mask outside their radii and no constant additive term. Their intensity is raised; scene-depth termination, island-height occlusion, wall feathering, exponential depth falloff, 16 jittered samples and simulation-clock animation remain. The default and front-left captures show separated diagonal shafts.

## 3. Readable settled glass

Released glass had fixed .42 opacity and depended almost entirely on specular alignment, so flat settled faces disappeared against the floor. Opacity now ranges from .55 to .85 with Fresnel angle, and the extrusion's thin side faces have a static edge-light attribute in the existing render batch. This makes outlines visible without making broad faces opaque. Roughness .18 broadens glints, and bounded highlight compression prevents white clipping. The edge attribute survives physics and rewind transforms.

## 4. Rewind highlights

Normal and rewind already shared materials: the cap was not being bypassed. Reversing the visual clock revisited stronger sun/reflection alignments, and the old hard 1.1 HDR ceiling still allowed broad pale lobes. Both directions now use the same smooth bounded response, `rgb / (1 + rgb / ceiling)`, with ceilings .55 for shards and .22 for puddles. Puddles also use roughness .22, clearcoat .35 / roughness .25, and environment intensity 1.1.

`highlights.json` measures the fixed floor/pile rectangle x=864..1849, y=1296..1586, excluding the sand and controls. Settled edges become brighter while rewind peaks become dimmer; neither phase contains white pixels (all channels ≥230) in that region. The final `shatter-settled.png` and `rewind-mid.png` were visually inspected.

## Evidence

Required commands: `npx tsc --noEmit`, `npm run build`, `node verify/runtime.mjs`, `node verify/lab.mjs`. Logs are in this directory. Runtime retains its 60 FPS target assertion with 55 FPS scheduling tolerance; all four views measured 60 FPS median at pixel ratio 1.5.

Reviewed images: `../pass-default.png`, `../pass-34.png`, `../pass-front.png`, `../shatter-settled.png`, `../rewind-mid.png`. The original Run F screenshots and source are preserved in `before/`.
