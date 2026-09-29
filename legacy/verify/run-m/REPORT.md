# Run M — calm display-tank water

## Changes

- Retuned the six Gerstner waves to millimetre-scale heights, low horizontal choppiness, and wavelengths of 0.30, 0.40, 0.54, 0.72, 0.94 and 1.20 world units (3–12 cm). Agitation multiplies the spectrum by up to 3.2; the travelling slosh and bubble/impact deformations use the same smaller scale. The analytic tangents, tilt and wall pinning remain.
- Resting crest foam is zero; shoreline foam is restricted to a narrow band and glass foam/meniscus remains thin. Fine normal detail is reduced about sevenfold and planar-reflection UV distortion is reduced from 0.028 to 0.010.
- Fixed the environment control at the source: Three's `materialEnvIntensity` uses `scene.environmentIntensity` when `material.envMap` is absent. The surface now explicitly references the existing environment, so its 0.12 intensity is honored. This removes the broad white HDR-cloud layer while retaining the planar scene reflection. Quarter-resolution bilinear sampling remains; no additional blur pass or mip generation was retained.
- The pour has finer noise streaks, smaller geometric wobble and less foam. The puddle has tiny Gerstner ripples, less darkening, a wider feathered edge and a subdued blue rim. The wet-floor darkening is similarly softer. Existing brightness caps also apply during rewind.

Beer–Lambert absorption, dispersed refraction, planar reflection, GGX/glow, crest scattering, wave-derived caustics, shoreline foam, bubble pops, tilt, drainage and rewind remain. Lab and shard physics/release source files are byte-identical to the pre-M snapshot.

## Wave measurement

`node verify/run-m/wave-scale.mjs` evaluates 3,761,640 vertex/time samples per case, using the shared spectrum and tuning constants. These are CPU evaluations of the shader equations, not GPU vertex readbacks. Wave height excludes the mean-plane tilt.

| Case | Peak-to-trough envelope | Maximum simultaneous range |
| --- | ---: | ---: |
| Rest | 0.025673 units (2.57 mm) | 0.024930 |
| Maximum agitation | 0.082153 units (8.22 mm) | 0.079775 |
| Maximum + slosh + four simultaneous strength-2 impacts | 0.092343 units (9.23 mm) | 0.088766 |

Boundary displacement is numerically zero; all sampled vertices remain within the glass footprint. An analytical bound including maximum waves, four impacts and 0.025 tilt gives highest surface Y = 2.73604 versus rim Y = 3.66: at least 0.92396 units clearance. The horizontal compression bound is 0.08044, so the Gerstner mapping cannot fold. Mesh resolution remains 128 × 80.

## Performance and verification

Measured with WebGPU/Metal, 1920 × 1080 CSS pixels, pixel ratio 1.5. Median GPU timestamps in the normal full-reflection configuration:

| | Run L | Run M |
| --- | ---: | ---: |
| Water | 4.596 ms | 4.590 ms |
| Reflection | 0.489 ms | 0.491 ms |
| Combined | 5.085 ms | 5.081 ms |

This is effectively unchanged within measurement noise. The profiler isolates water using an extra attachment load/store and excludes standalone framebuffer-copy commands. Idle and shattered median FPS are both 60; draw calls are 101 and 51 respectively. All camera checks reached median 60 FPS. Puddle stability: maximum adjacent-frame channel difference 2/255 across ten frames.

All six required commands exited successfully on the final source:

- `npx tsc --noEmit` — [log](tsc.txt)
- `npm run build` — [log](build.txt)
- `node verify/runtime.mjs` — [log](runtime.txt)
- `node verify/edges.mjs` — [log](edges.txt)
- `node verify/lab.mjs` — [log](lab.txt)
- `node verify/library.mjs` — [log](library.txt)

**Existing intermittent verification issue:** two earlier runtime attempts failed the crack-then-shatter 3–4 s settling check (latest failed attempt: displacement 0.002059, rotation 0.018051 rad). The same failure already appears in `verify/run-l/runtime-first.txt` (0.002056 / 0.018870). The final unchanged runtime rerun passed with displacement 0, rotation 5.96e-8 rad, zero awake bodies at five seconds, and no deadline fallback. Physics and runtime assertions were not altered to obtain the pass. This remains a reproducibility limitation, not a physics fix in Run M. [Failed attempt](runtime-attempt2.txt).

## Reviewed captures

- [pass-surface](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/pass-surface.png) — Calm relief and a coherent, gently warped peak reflection.
- [pass-front](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/pass-front.png) — Clear body of water; the broad white surface layer is gone, with a thin visible waterline.
- [pass-default](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/pass-default.png) — Calm overall read; caustics, reef and shafts remain visible.
- [pass-shore](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/pass-shore.png) — Narrow shoreline band and restrained reflection detail.
- [pass-low](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/pass-low.png) — Clear underwater view with a subtle underside.
- [idle](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/idle.png) — Full composition with the quiet surface.
- [crack](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/crack.png) — Small disturbed waves and finer pouring-water detail.
- [spill](/Users/wawa/Documents/Projects/wawasensei/aquarium/verify/spill.png) — Lower water level and a shallow, softly feathered puddle.

Also reviewed `shatter-settled.png` and `rewind-mid.png`; the water brightness cap remains in effect.
