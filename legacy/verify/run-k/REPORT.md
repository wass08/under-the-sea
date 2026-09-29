# Run K — shared shard release and stronger main-page burst

## Diagnosis

The main page's density-derived masses were larger, but **both callers already multiplied linear impulses by mass**. The proposed missing-rescaling bug was not present. Main launch speeds were lower because its release profile used a modest normal push and weak lateral spread. Lab L3 used a concentrated radial kick and unconditioned, mass-scaled torque: it reached 248.20 rad/s and still had 61 bodies awake after five seconds. Lab's body mass formula was `max(0.002, area * 0.15)`, not a per-vertex-count body mass.

The baseline was measured before editing production code, through the actual tank and Lab constructors. The probe intercepts body creation only to observe the real Rapier bodies; it invokes Lab fracture through its pointer handlers. Launch samples are taken before the first physics step. The preserved source is in [before/src](before/src); reproduce with `node verify/run-k/probe.mjs before`.

### Actual t=0 launch distributions

Linear values are **min / median / max, in m/s**. Angular values are the maximum vector magnitude, in rad/s. Main is an immediate one-wall full break from pristine; Lab uses its centre click.

| Scene | Linear before | Linear after | Max angular before → after |
|---|---:|---:|---:|
| Main | 2.087 / 3.298 / 4.409 | 2.891 / 4.574 / 6.359 | 4.914 → 4.914 |
| Lab L1 | 2.200 / 2.200 / 2.200 | 2.200 / 2.200 / 2.200 | 0 → 0 |
| Lab L2 | 2.200 / 2.200 / 2.200 | 2.200 / 2.200 / 2.200 | 0 → 6.962 |
| Lab L3 | 1.619 / 4.151 / 6.846 | 2.701 / 4.155 / 5.490 | 248.205 → 6.514 |

Main median launch speed rises **38.7%**, peak **44.3%**. Its one-wall masses remain **13.805–287.269**. Lab L3 now uses density-based masses **5.000–50.087**, versus **0.002–0.060** before. Raw results: [before](before-physics.json), [after](after-physics.json), [actual Lab browser measurements](lab-physics.json).

## Implementation

[release.ts](../../src/lib/release.ts) owns connected-cell grouping, visible extrusions, compound per-cell convex colliders, body creation and launch. Both [tank.ts](../../src/scene/tank.ts) and [Lab shatter.ts](../../src/lab/shatter.ts) call `releaseShards()` and create their worlds through `createShardWorld()`.

- Launch uses a target velocity and applies `body.mass() * velocity`. L3 adds an exponential impact-distance burst to a height-dependent pane-normal push, capped at 6.4 m/s before the small upward component. The lateral fan spreads outward from the impact. The height term keeps outer plates clear of the pedestal. L1/L2 retain their uniform 2.2 m/s normal push without distance falloff.
- Angular impulse is `I_world * targetAngularVelocity`, using the body's actual conditioned principal inertia and world orientation. L2/L3 turn toward broad-face landings, with a small randomized roll in L3; the target is capped at 12 rad/s. L1 keeps its original unspun tile release.
- Crack releases use 20% strength. Space from pristine gives the core the full launch strength while preserving its separate rewind visibility metadata. Material caps, sorted main-page glass batching, and rewind ownership remain intact.
- Shared density is 2,500; sliver mass floors scale with density. Visible thickness remains 0.038, collider thickness 0.040, adaptive contact skin at most 0.003, with inset polygons and pane-end clearance. Compounds retain separate per-cell hulls, so no collider bridges a gap.
- Lab's raised plinth is now explicitly a support surface. Support detection requires an upward solver contact; side scrapes and contacts against still-falling neighbours cannot trigger ground drag.
- Both pages use 60 Hz, 12 solver iterations, 4 internal PGS iterations, two CCD substeps, ERP 0, and actual contact error/prediction distances 0.0002 / 0.004. Native sleep uses scene scale `lengthUnit = 4`, with normalized contact tolerances compensated to preserve those distances. Inertia anisotropy is limited to 4:1. Flight damping remains 0.45 / 1.2; support damping is 3 / 5. After 0.1 s below 0.3 m/s and 1.5 rad/s, resting drag is 8 / 20. CCD expires after one simulation second. Rapier decides sleep; the 30-second stationary-only fallback never fires in these tests.

The library regression changes density by **10×** and checks real linear/angular velocities differ by less than 0.0001 on all three levels, including a rotated pane. It also checks bounded spin, uniform-versus-radial velocity profiles, and disposal.

## Stability, controls and resources

The browser tests sample **every rendered pose throughout break+3 to break+4**, with 61 samples per case. They assert displacement <0.002, rotation <0.01 rad, zero awake bodies at five seconds, and zero fixed-body fallbacks.

| Browser case | Max displacement | Max rotation | Awake at 5 s |
|---|---:|---:|---:|
| Main, after crack and drainage | 0 | 0.0000000596 | 0 |
| Lab L1 | 0 | 0.0000000596 | 0 |
| Lab L2 | 0 | 0.0000000421 | 0 |
| Lab L3 | 0 | 0.0000000596 | 0 |

The additional CPU probe covers immediate one-wall/four-wall breaks and a break after old crack fragments settle. Worst four-wall motion is **0.0000146044 units / 0.000381854 rad**; all cases sleep by five seconds. Exact t=0 queries find **zero new shard overlaps, zero skin overlaps, and zero intersections with static colliders**. Contacts solely between already-settled old fragments are excluded from the *new-spawn* test, but all fragments participate in the subsequent motion test.

The main also passes 8–10 second pose invariance, 0.15× motion interpolation, 3.2-second rewind, pristine restoration, and rewind skip. Lab freeze holds transforms exactly; measured slow motion, six resets across three route cycles, and GPU/WASM/listener allocation checks all pass. The edge suite covers dry cracks, four openings draining to the actual lowest sill, full break and reset mid-spill.

## Visual review and performance

Reviewed: [main airborne (~0.3 s)](../shatter-airborne.png), [main ~1.5 s](../shatter.png), [settled](../shatter-settled.png), [Lab L1](../lab/shatter-L1-broken.png), [Lab L2](../lab/shatter-L2-broken.png), [Lab L3](../lab/shatter-L3-broken.png). The main and L3 show a wider outward fan; settled glass retains visible edges and transparency. L1's uniform tile sheet and L2's evenly distributed irregular plates remain distinct from L3's concentrated burst. Existing glass brightness caps remain active.

Main median performance at pixel ratio **1.5**: **60 FPS / 61 draw calls idle**, **60 FPS / 51 calls shattered**. The four-wall edge test reports **60 FPS / 39 calls**. Main and Lab record zero console errors; Lab records zero warnings.

## Required validation

All pass on the final implementation:

- `npx tsc --noEmit` — [log](tsc.txt)
- `npm run build` — [log](build.txt); existing bundle-size warning remains
- `node verify/runtime.mjs` — [log](runtime.txt)
- `node verify/edges.mjs` — [log](edges.txt)
- `node verify/lab.mjs` — [log](lab.txt)
- `node verify/library.mjs` — [log](library.txt)
- Additional: `node verify/run-k/probe.mjs` — [log](after-probe.txt)

Production changes are confined to the new shared release module, shared physics, and the two shatter callers. Other scene modules and Lab benches match the preserved pre-change source. [Manifest](manifest.json) records final source, checks, measurements and capture hashes.

**The main page and Lab execute the same `releaseShards()` code path.**
