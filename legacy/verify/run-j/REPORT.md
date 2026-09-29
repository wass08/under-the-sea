# Run J — water, light and terrain

## Scope and reference

Read `aquarium-naive/src/scene/water.ts`, `src/scene/spill.ts`, `src/tsl.ts` and `src/scene/bubbles.ts` before implementation. That project was only read: no file was modified and nothing is imported from it. `naive-manifest.json` records SHA-256 hashes for its 23 project files (excluding dependencies and Git internals).

Run H/I physics, audio, rewind timing, branding, reef placement, bubbles and submerged motes remain. The only Lab source change is terrain biome colour blending; its techniques, controls and physics remain unchanged. Domain warping and erosion are enabled on the main island only.

## 1. Water surface

`src/lib/waves.ts` returns height and both analytic partial derivatives from five directional sine waves. `scene/water.ts` uses the same field to displace a 128 × 80 mesh and compute normals. The existing mean-plane tilt is added to that field. Agitation rises on slosh/crack/shatter, sustains during drainage, then decays; it also drives a travelling wave along the tilt direction. Wave amplitude fades with the last water depth.

Ripple impulses now deform the same height field. Their event parameters and agitation are recorded for rewind; future impulses are gated out when reversing time. A near-black transmitted surface, Fresnel opacity, teal body tint and stronger environment reflections make relief visible without replacing the interior with an opaque sheet. The meniscus and opaque-island depth occlusion remain.

Reviewed: [default](../pass-default.png), [front](../pass-front.png), [surface close view](../pass-surface.png), [low angle](../pass-low.png). The surface preset looks down about 23° and fills the frame with the water and its reflected relief.

## 2. Pouring water

Replaced the plane ribbon and periodic sine stripes with a subdivided slab deformed along the projectile arc. Its UVs run across and along the flow. Warped 3D noise travels downstream; foam grows along the fall and fades with discharge. Width-dependent wobble and thicker strands break up the curtain. Lower environment intensity and broader reflections prevent regular silver columns from dominating the teal/foam body.

The existing spray, velocity-stretched drops, impact crown and puddle rings remain. Slab positions, flow strength and leading front are restored from rewind snapshots. The material's smooth output cap applies in either playback direction.

Reviewed: [crack](../crack.png), [spill](../spill.png), [rewind](../rewind-mid.png).

## 3. Stable puddles

Each landing point retains one puddle mesh. Its height is `STAGE_Y + 0.026 + wall * 0.008`, with `depthWrite:false`, polygon offset and fixed render order 10–13. Thus neither the floor nor another puddle shares its depth. The shared sine-wave derivatives supply small-scale animated normals, combined with impact-ring slopes. Feathered opacity, a thin rim, reflected environment and a slightly larger wet footprint give it presence. The stage evaluates the wet footprints once, so overlapping wet regions do not stack darkening passes.

The existing smooth RGB ceiling `(0.10, 0.18, 0.25)` remains below the 1.3 bloom threshold. Ten consecutive rendered-frame readbacks sample a 64 × 64 patch inside the settled puddle; the raw pixels are preserved in [puddle-10-frames.png](puddle-10-frames.png). This measures live animation, not ten screenshots of a frozen simulation. Exact values are in [puddle-stability.json](puddle-stability.json).

Reviewed: [spill](../spill.png), [shatter](../shatter.png), [settled](../shatter-settled.png), [rewind](../rewind-mid.png). Soft reflections remain; no blown-out white bloom spot was observed.

## 4. One light direction

The stage has fine sand grain and subtle ripple-normal shading in a deep teal field. Detail fades with distance into the atmospheric gradient. Floor and interior caustics share one light-space coordinate system: the along-light coordinate is scaled by 0.43 and the cross-light coordinate by 1.25, giving roughly 2.9:1 elongation. Dominant scrolling follows horizontal light propagation. The existing raymarch travels along that same sun vector.

The opaque base, pedestal and terrain cast real directional shadows. Glass and water do not. The 2048² shadow camera snaps its projected origin to texels. A fixed 4 × 4 tent-PCF kernel softens the boundary without stochastic per-pixel rotation; shadow visibility attenuates the floor colour and caustic light together. The low-opacity shadow combines with the integrated contact darkening.

A VSM trial encountered WebGPU buffer-lifetime validation errors; the final implementation uses PCF and no VSM intermediate targets.

Reviewed: [floor](../pass-floor.png), [default](../pass-default.png), [plaque](../pass-plaque.png). Measured direction is reported below; caustic propagation is opposite the vector toward the sun, so their unoriented streak axes coincide.

## 5. Colour

Slate rock, sandy shore, natural greens, white snow and coral colours have stronger chroma. The island retains low underwater ambient fill for direct-light facet contrast. The post grade adds modest saturation/contrast; water and puddle material highlights remain capped before bloom.

Saturation uses HSV S averaged over the same fixed tank-interior crop `(650,350,1570,900)` in both 2880 × 1620 front captures. The saved Run I input is [before-pass-front.png](before-pass-front.png). The new landform changes topology, so the old Run I facet coordinates no longer identify the same rock. `verify/image-metrics.mjs` selects an adjacent visible rock pair using geometry, raycasts and light orientation, without inspecting screenshot brightness; runtime measures 5 × 5 patches at their projected centres.

Reviewed: [front](../pass-front.png), [three-quarter](../pass-34.png), [default](../pass-default.png).

## 6. Island and coherent biomes

The final generator performs shaping before classification. It smooths face height/slope over Delaunay neighbours, warps thresholds with low-frequency noise, applies label hysteresis to isolated faces and blends normalized four-channel colour weights across shared edges. The main page no longer overwrites this with a second isolated-face classification. The Lab's biome-region labels and reveal remain functional.

The main island uses 0.16 domain-warp strength, a meandering broad ridge, and eight conservative thermal-erosion steps. Each step transfers 12% of excess above a 0.8 talus slope toward the lowest graph neighbour; boundary points stay pinned. Library tests verify actual material movement, conservation, stable topology, normalized weights and absence of isolated labels.

`node verify/seed-search.mjs` generates all 200 production islands before ranking them for dominant peak, separated secondary ridge, shore area, biome balance, speckle and wall clearance. Seed **42** won under the new generator; it was retained because of that result. Full scores: [seed-scores.json](seed-scores.json).

Reviewed: [front](../pass-front.png), [default](../pass-default.png), [Lab terrain L3](../lab/terrain-L3.png).

## Final measurements and checks

All six required commands passed on the final source:

- `npx tsc --noEmit` — [log](tsc.txt)
- `npm run build` — [log](build.txt)
- `node verify/runtime.mjs` — [log](runtime.txt)
- `node verify/edges.mjs` — [log](edges.txt)
- `node verify/lab.mjs` — [log](lab.txt)
- `node verify/library.mjs` — [log](library.txt)

The GPU checks ran sequentially under `caffeinate -diu`, at the requested pixel ratio. No assertions were disabled or errors swallowed. The old facet-coordinate assertion was replaced because the terrain topology changed; the new selection and pixel measurement are described above. Runtime has no shader/uncaught errors; the Lab reports zero errors and zero warnings.

| Measurement | Result |
|---|---:|
| Puddle maximum per-channel frame change | **1/255** |
| Puddle mean per-channel frame change | **0.01942/255** |
| Frames / patch | **10 consecutive / 64 × 64**, at (1052, 1311) |
| Sun azimuth toward light | **144.831°** |
| Caustic propagation azimuth | **-35.169°** |
| Streak-axis difference modulo 180° | **0.000000°** |
| Mean tank saturation, Run I → J | **0.269544 → 0.405623**, +50.5% |
| Adjacent underwater lit / dark luminance | **0.0527775 / 0.0148270** |
| Underwater contrast | **3.560:1** |

Facet IDs: 1235 / 1220; pixels [1442, 862] / [1455, 868]. Luminance is linear-light Rec.709, averaged over 5 × 5 pixels.

| State, 1920 × 1080 at DPR 1.5 | Run I calls | Run J calls | Median FPS |
|---|---:|---:|---:|
| Idle | 56 | **61** | **60** |
| One-wall shattered | 46 | **51** | **60** |
| Four-wall shattered | 34 | **39** | **60** |

The existing 3–4 s shard acceptance still passes: zero displacement and 5.96e−8 rad maximum rotation; zero awake shards at five seconds and zero deadline fallbacks. The 8–10 s invariant and exact rewind reset pass too.

### Top five of 200 seeds

| Seed | Score | World peak | Secondary height | Shore % | Sand / grass / rock / snow % | Isolated faces | Clipping area |
|---|---:|---:|---:|---:|---|---:|---:|

| 42 | 77.533 | 3.280 | 2.501 | 3.56 | 45.2 / 10.2 / 42.8 / 1.8 | 0 | 0 |
| 177 | 76.919 | 3.280 | 2.345 | 3.31 | 46.6 / 8.3 / 43.2 / 2 | 0 | 0 |
| 169 | 73.134 | 3.280 | 2.265 | 3.31 | 39 / 9.8 / 49.3 / 1.9 | 0 | 0 |
| 159 | 71.991 | 3.280 | 2.323 | 2.06 | 49.7 / 17.2 / 31.3 / 1.7 | 0 | 0 |
| 12 | 71.299 | 3.280 | 2.177 | 2.57 | 46.5 / 10.7 / 40.4 / 2.4 | 0 | 0 |

The secondary height is tank-local; the world peak includes the 0.18 base offset. The winner's summit is 0.69 above initial water, with a separated secondary ridge and all four biome regions.

### Reviewed final captures

- [pass-default.png](../pass-default.png)
- [pass-34.png](../pass-34.png)
- [pass-front.png](../pass-front.png)
- [pass-low.png](../pass-low.png)
- [pass-surface.png](../pass-surface.png)
- [pass-floor.png](../pass-floor.png)
- [pass-plaque.png](../pass-plaque.png)
- [idle.png](../idle.png)
- [crack.png](../crack.png)
- [spill.png](../spill.png)
- [shatter.png](../shatter.png)
- [shatter-settled.png](../shatter-settled.png)
- [rewind-mid.png](../rewind-mid.png)
- [Lab terrain-L3.png](../lab/terrain-L3.png)
