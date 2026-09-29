# Run O — composed island and presenter choices

Default: **seed 38**, score **86.709**. Choose another of the eight ranked tiles by changing only `ISLAND_SEED` in [src/scene/island.ts](../../src/scene/island.ts). The first tile is the preserved **Run N seed-42 geometry**, not seed 42 regenerated with the new algorithm.

[Reviewed 1920 × 1200 contact sheet](../island-sheet.png) · [default view](../pass-default.png) · [front view](../pass-front.png) · [Lab terrain L3](../lab/terrain-L3.png).

## Island: cause and implementation

Warping and thermal erosion were already active. They were not no-ops: the old seed-42 ablation changes mean height from **0.640578** without either pass to **0.589283** with warping, then **0.601901** with thermal erosion. RMS changes **0.926286 → 0.877445 → 0.883921**. Normalizing every result to the same 2.67-unit summit concealed changes in peak height; the old seed search also did not reward a composed ridge/saddle/beach. [Old measurements](before-height-stats.json), [baseline snapshot](before/src/lib/terrain.ts).

The main island now starts with an asymmetric, offset summit, a lower diagonal secondary ridge, a saddle and a broad front/right terrace. Seeded proportions vary this macro shape. Domain-warped ridged noise adds detail to that scalar field **before slope-weighted Poisson sampling and Delaunay triangulation**. Eight conservative thermal passes move material down graph edges. Then 420 seeded droplets follow steepest downhill neighbour edges, incising repeated drainage paths and widening their banks. This is hydraulic-style graph carving, not a fluid simulation. Incision is capped at 0.24 units and smoothed over one neighbour ring to avoid needle pits.

Cliffs steeper than **58.7°** become rock regardless of height. Neighbouring classification/weight blending keeps green regions contiguous; the sand terrace follows flatter shelf faces. Snow begins near the upper **15%** of normalized relief, with a low-frequency noise-warped boundary; cliff faces interrupt it naturally. Geometry remains non-indexed and flat shaded. The main footprint remains **5.6 × 3.5** inside the wider Run N tank. The world summit is **2.85**, **0.60** above initial water.

For seed 38, paired measurements on the same production sample positions, **before final height normalization**, are:

| Stage | Minimum | Maximum | Mean | RMS |
|---|---:|---:|---:|---:|
| Unwarped field | 0 | 2.788853 | 0.797031 | 1.087881 |
| Warped field | 0 | 2.861950 | 0.790816 | 1.085198 |
| After thermal | 0 | 2.710275 | 0.790816 | 1.072736 |
| After carving | 0 | 2.677981 | 0.749258 | 1.025888 |

| Pass | Mean absolute height change | Maximum change | Changed vertices |
|---|---:|---:|---:|
| Warp | 0.041034 | 0.205965 | 1,470 |
| Thermal | 0.028841 | 0.187359 | 1,182 |
| Carve | 0.041559 | 0.225115 | 1,245 |

Thermal erosion conserves the field mean. Carving produces **403 paths of at least four vertices**, **465 incised vertices**, and **8 connected gully networks**. A counted network has at least eight vertices incised by more than 0.055 units and spans over 0.25 height units. [Full pass statistics and disabled-pass ablations](height-stats.json).

## Seed selection and visual review

`node verify/island-sheet.mjs` scores **240 seeds**, selects the eight highest-scoring eligible candidates, renders each using the production island material and fixed lamp/environment, and composes nine **640 × 400** tiles. Water and tank geometry are absent. Every tile has the same camera, exposure and lighting; only terrain changes. [Scorer](../island-score.mjs), [render script](../island-sheet.mjs), [all candidates](seed-scores.json).

The score includes dominant summit clearance (15 points), secondary ridge (18), the actual maximum-bottleneck graph saddle (14), beach area (17), biome balance (14), ridge-line height variance (12), and connected gullies (10). Isolated biome faces and wall clipping incur penalties and disqualify candidates. It measures geometric composition; the contact sheet lets the presenter judge appearance.

| Tile | Seed | Score | Secondary peak, world Y | Saddle, world Y | Beach shelf area | Gullies | Ridge-height variance |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 42, old generator | 54.928 | 1.664 | 1.236 | 0.00% | 0 | 0.5829 |
| Default | **38** | **86.709** | 2.342 | 2.072 | 5.99% | 8 | 0.7551 |
| Choice | 219 | 85.701 | 2.553 | 2.178 | 7.39% | 9 | 0.7638 |
| Choice | 225 | 85.542 | 2.213 | 2.098 | 7.48% | 4 | 0.7168 |
| Choice | 13 | 85.096 | 2.242 | 1.839 | 4.17% | 10 | 0.6568 |
| Choice | 21 | 84.492 | 2.509 | 2.103 | 7.51% | 6 | 0.8337 |
| Choice | 72 | 84.042 | 2.442 | 2.073 | 6.11% | 6 | 0.7324 |
| Choice | 240 | 83.964 | 2.394 | 2.131 | 5.97% | 6 | 0.6880 |
| Choice | 76 | 83.959 | 2.417 | 2.137 | 3.67% | 4 | 0.7467 |

Every chosen seed has **zero isolated biome labels and zero wall clipping**. Seed 38's projected biome areas are **20.94% sand / 17.38% meadow / 60.72% rock / 0.97% snow**; the narrow snow cap and cliff override intentionally keep snow coverage small. These percentages exclude faces below local height 0.20; beach shelf coverage is a separate subset of sand.

I reviewed the sheet: seed 38 has a clear off-centre spire, lower right ridge, broad sandy shelf and visible incised cliff faces. The old silhouette is taller and narrower through its middle; the new shelf and connected shoulders are visibly different. Seed 219 offers a stronger second summit; seed 13 has a deeper saddle. The main default/front captures preserve the broad terrace, cool submerged facets and small bright summit.

## Lab consistency

Main-only shaping, warp, erosion and carving are enabled by `generateIslandTerrain`; Lab L3 still uses **Poisson-disk + ridged noise + Delaunay + flat shading**, with no erosion/carving. Its existing technique text remains accurate. Neighbour-based biome smoothing remains shared. The reviewed [terrain-L3.png](../lab/terrain-L3.png) shows connected snow, rock and lower zones. Library assertions check that Lab carving stays disabled and main terrain remains deterministic, with active passes, coherent labels, cliff overrides, upper snow and tank clearance.

## Review fixes

**Visible spill.** Run N's low body opacity and optical thickness made the sheet disappear against the blue floor, leaving additive edge droplets dominant. Optical thickness is now `0.008 + 0.050 × flow`, tapering along the arc; base body opacity is **0.44** with small streak/foam variation, capped with Fresnel at **0.78**. A restrained cyan body contribution makes the continuous sheet readable; droplet opacity falls from 0.65 to **0.48**. The source stays thin and droplets still originate at its edges. The projectile travel-time phase, arc-length UVs and water-volume integration are unchanged. [Reviewed spill](../spill.png).

**Submerged fill.** The strongly attenuated environment/ambient contribution crushed the camera-facing rock. The fixed lamp is unchanged. A cool **#a6c8ff** hemisphere with warm **#857352** ground bounce at **0.65** intensity, island ambient factor **0.20**, and weak submerged bounce reveal those facets. The fixed front-view adjacent rock pair has linear Rec.709 luminance **0.081720 lit / 0.042381 shadow**: the shadow retains **51.86%** of the lit face, above 35%, while lit/shadow contrast remains **1.928:1**. The five-by-five-pixel samples are selected from production face normals, at **(1160,909)** and **(1159,925)** in the 2880 × 1620 image. This is the measured face pair, not a claim that every occluded facet has identical lighting. [Sampling code](../image-metrics.mjs).

**Stronger burst.** Main translation strength is **1.35**, capped at **9 m/s**, with the same impact-centred radial/normal direction and exponential distance falloff. Main spin strength is separately bounded at **0.75**: measured initial spin is about **3.00–8.33 rad/s**, so long plates topple instead of landing edge-on and rocking late. Crack strength stays **0.55**; Lab launch/spin is unchanged. Glass now composites after the spill sheet, because the batch origin previously sorted the burst behind the water.

The four-pane pile uses **48/12** solver iterations and a stage-sized native length scale of **6** (0.3 mm allowed contact error, 6 mm prediction); smaller worlds retain **12/4**, scale **4**. Removing a cracked pane explicitly wakes its existing fragments so Rapier rebuilds support/contact islands. CCD, conditioned real inertia, fixed 60 Hz accumulation, seeded impulses, friction and native sleep remain. No early manual sleeping, timed freeze, or contact-velocity clamp was added.

Actual launch velocities, recorded from Rapier before its first step (min / median / max):

| Case | Speed, m/s | Mean radial fraction | Spin, rad/s |
|---|---:|---:|---:|
| main-1-wall | 2.430 / 2.786 / 9.000 | 83.934% | 3.000 / 3.275 / 8.329 |
| lab-L1 | 2.200 / 2.200 / 2.200 | 0.000% | 0.000 / 0.000 / 0.000 |
| lab-L2 | 2.200 / 2.200 / 2.200 | 17.715% | 4.149 / 5.060 / 8.232 |
| lab-L3 | 1.846 / 2.473 / 6.642 | 83.917% | 4.065 / 5.019 / 10.353 |

The Run N main probe was **1.800 / 2.064 / 6.953 m/s**. The outer minimum is now **35% faster**. The crack-only core remains **2.502 / 2.842 / 3.824 m/s**. Sampled core maxima differ by impact/COM placement; the 9 m/s ceiling prevents an exact-centre fragment exceeding the requested peak. A later crack-then-shatter release cannot re-launch core cells already lying on the floor.

Fixed-step settling, using actual caller geometry and impulses:

| Case | Bodies | Maximum displacement, 3–4 s | Maximum rotation, rad, 3–4 s | Awake at 5 s |
|---|---:|---:|---:|---:|
| main-1-wall | 78 | 0.000000000 | 0.000000060 | 0 |
| main-4-wall | 288 | 0.000010076 | 0.000063597 | 0 |
| main-settled-crack-wall | 78 | 0.000000000 | 0.000000060 | 0 |
| main-rendered-crack-wall | 78 | 0.000000000 | 0.000000060 | 0 |
| lab-L1 | 228 | 0.000052320 | 0.002175115 | 0 |
| lab-L2 | 41 | 0.000000000 | 0.000000060 | 0 |
| lab-L3 | 75 | 0.000000000 | 0.000000067 | 0 |

The held-crack case waits **22 seconds** before the burst; the rendered-history probe waits two seconds before cracking, then **10.833 seconds** before the burst. All cases have zero new hull/skin/static spawn intersections and zero fallback-fixed bodies. Existing resting contacts are recorded before the full release wakes them and are excluded from the new-spawn overlap test. [Probe](probe.mjs), [raw measurements](after-physics.json), [probe log](physics.txt).

Rendered pristine Space release: **2.430 / 2.765 / 8.966 m/s**, **83.934% radial**, maximum angular speed **8.981 rad/s**. The fixed crack-target CPU probe reaches **9.000 m/s**. The final rendered 3–4-second window has **61 samples**, **0 displacement**, **5.96e−8 rad rotation**, and **0 awake / 0 fallback-fixed bodies at five seconds**.

At the final spill capture, the measured sheet/drop agreement is:

| Measurement | Value |
|---|---:|
| Arc length | 2.1481 |
| Current landing streak speed, m/s | 6.1562 |
| Landing UV scroll rate, /s | 2.8660 |
| Measured droplet landings | 256 |
| Mean droplet landing speed, m/s | 6.3650 |
| Mean matching streak speed, m/s | 6.1763 |
| Mean relative speed error | **3.06%**, below 15% |

## Verification and capture record

All six commands pass on the final implementation, using `npm run preview -- --port 4174`:

| Command | Result / log |
|---|---|
| `npx tsc --noEmit` | [PASS](tsc.txt) |
| `npm run build` | [PASS](build.txt) |
| `node verify/runtime.mjs` | [PASS](runtime.txt) |
| `node verify/edges.mjs` | [PASS](edges.txt) |
| `node verify/lab.mjs` | [PASS](lab.txt) |
| `node verify/library.mjs` | [PASS](library.txt) |

The final commands completed without retrying an unchanged failure. During development, stronger launch variants did fail the unchanged 3–4-second stability limits; [one preserved failure](experiments/runtime-pre-contact-fix.txt) and calibration logs remain in `experiments/`. The spin/contact/support changes described above fixed those failures before final verification. The verification still requires **<0.002 units displacement**, **<0.01 rad rotation**, **zero awake bodies at 5 seconds**, and invariant poses at **8–10 seconds**. The library's frame-chunk/accumulator regression remains bit-identical. No stability threshold was loosened.

Runtime median idle/shattered FPS is **60 / 60**, and all eight camera presets pass the performance assertion. The edge suite's immediate four-wall sample is **285 bodies / 53 draw calls / 11 FPS**; it is not a 60-FPS multi-pane performance claim. Runtime/edges have zero console errors; Lab has **zero errors and zero warnings**. The build retains its existing large-chunk advisory; runtime image sampling emits a harmless Canvas2D readback advisory.

The fixed lamp, shared Worley caustics and larger/lower tank from [Run N](../run-n/REPORT.md) remain. [Source proof](caustics-proof.txt) shows both lighting paths still call `causticsField`. The lamp head stays **(-2.65, 6.10, -2.30)** and light direction **(-0.442682, 0.810192, -0.384215)**. Final default-image mean colours remain **floor #03547b / background #002848**, using the same Run N rectangles, with warm sand inside the tank. [Metrics](metrics.json), reproduced with `python3 verify/run-o/metrics.py`.

Reviewed captures: [contact sheet](../island-sheet.png), [default](../pass-default.png), [front](../pass-front.png), [floor](../pass-floor.png), [idle](../idle.png), [crack](../crack.png), [spill](../spill.png), [pristine burst at ~0.25 s](../shatter-airborne.png), [shatter](../shatter.png), [settled](../shatter-settled.png), [Lab terrain L3](../lab/terrain-L3.png), [Lab shatter L3](../lab/shatter-L3-broken.png), and [Lab caustics L3](../lab/caustics-L3.png). The burst has a visible central cluster plus long outward plates; the spill is one continuous translucent body with edge droplets; the new island's shelf and offset summit remain readable above the blue submerged facets.

[Source diff](changes.diff), [source hashes](source-hashes.json), and [capture/log manifest](manifest.json) identify the final result. The protected naive project was neither accessed, modified nor imported.
