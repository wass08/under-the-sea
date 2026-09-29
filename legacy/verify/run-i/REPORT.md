# Run I — implementation and evidence

The main aquarium retains Run H's stage caustics, atmosphere, reef, bubbles, plaque and water-only particles. No Lab scene or UI files changed; its physics stays at 120 Hz. All required captures were inspected at the end of the run.

## 1. Shard physics and rendering

The original mass-by-vertex-count plus mass-scaled torque produced **1,547.86 rad/s** maximum initial spin in the one-wall probe (**4,375.06 rad/s** with four walls). Another defect bypassed base-contact damping: Rapier rounds the base centre from `0.08` to approximately `0.0800000018`, which fails the old `<= 0.08` test. Fixed support surfaces now use body handles. The library regression drops a plate onto that exact base and verifies contact damping and native sleep.

- Fine cells remain visible, but edge-connected slivers join compounds of at least 0.1 square units. Each cell retains its own convex collider; no hull bridges gaps. The reference cases use 61/233 bodies for one/four walls.
- Mass uses polygon area × 0.05 thickness × 2,500 density, distributed by collider volume. Minimum mass is 5, also bounded against a 64:1 release mass ratio. Measured final masses are **13.805–287.269** for one wall and **12.764–287.269** for four, versus **0.0216–0.0972** and **0.0216–0.3780** before. Sliver inertia is conditioned to at most 16:1 anisotropy, with a small axial floor. Launch rotation depends on damped fall time so plates land broad-face first.
- Flat hull thickness is 0.040, with adaptive contact skin up to 0.003. Half-plane clipping fixes short-edge inset spikes; pane ends have 0.031 clearance. At release, expanded AABBs generate **251/1,124 candidate pairs**; exact checks find **zero shard overlaps, zero skin overlaps, and zero intersections with the floor, base or other panes**. Immediate shatter also passes (303/1,124 candidates, zero actual overlaps). AABB candidates are not physical intersections.
- A separate **0.004 rounded-hull trial** introduced two 0.000402-deep overlaps and recorded 0.03298 rad rotation in the one-wall 3–4 s window. Inset flat hulls with adaptive skin were the better fit here.
- Solver: **12 iterations, 4 internal PGS iterations**, normalized allowed error **0.0002**, prediction distance **0.004**, natural frequency **0** (reported ERP **0**), two CCD substeps. Rigid contacts avoid spring correction creep. Contact friction **1.2** prevents the remaining sliding/rocking between supported plates; lower-friction and alternative-inertia profiles did not consistently meet the early window across one-wall, simultaneous and staggered four-wall breaks. The stabilized main-page simulation runs at **60 fixed steps/s**, meeting the four-wall performance target; Lab defaults remain unchanged.
- Flight damping is 0.45 linear / 1.2 angular; support contact changes it to 3 / 5. After a supported body stays below 0.10 linear and 0.5 angular speed for 0.1 s, resting drag becomes 8 / 20. Rapier decides when to sleep. CCD ends after one second. The fallback moved from 6 to **30 s** and requires another two seconds below 0.0001 linear/angular speed; no fallback fired in verification.
- Rendering previously used 0.050-thick visible glass against approximately 0.046-thick contact proxies, with unsorted double-sided transmission in one batch. Released glass is now 0.038 thick, front-facing triangles are sorted back-to-front, and the existing smooth brightness cap serves both simulation and rewind. This removes the extra rear-face layer and reduces visible intersections without adding draw calls.

### Continuous 3–4 second pose measurements

| Case | Before: max displacement / rotation | After: max displacement / rotation | Awake at 5 s, before → after |
|---|---:|---:|---:|
| Deterministic one wall | 1.057085 / 1.232605 rad | 0 / 0.0000000596 rad | 64 → 0 |
| Deterministic four walls | 1.185266 / 0.884141 rad | 0.000217374 / 0.00728325 rad | 79 → 0 |
| Main browser sequence | — | 0 / 0.0000000596 rad | 0 |

The browser samples every rendered pose throughout the interval, rather than comparing only endpoints. Main-page rendering interpolates positions/quaternions between fixed physics steps: at 0.15×, shards moved in **60/60** sampled rendered frames, avoiding nine-pose-per-second stepping. It also passes the original 8–10 s invariance check. The separate four-wall browser test covers a dry first opening, orbiting, all four cracks, and the complete break. Two consecutive runs passed: the larger measured displacement was 0.000004600 and rotation was 0.00002092 rad; both had zero awake bodies at five seconds.

Additional contact-friction/rounding/inertia comparisons: [parameter measurements](contact-comparison.json).

Data: [before](before-physics.json), [after](after-physics.json), [immediate break](instant-physics.json), [rounded trial](rounded-physics.json), [four-wall browser](four-wall.json). Reproduce the current deterministic assertions with `node verify/run-i/probe.mjs` (starts and closes its own Vite server); `before` and `rounded` arguments report the preserved experiments. `node verify/run-i/four-wall.mjs` uses the preview on port 4174.

## 2. Rewind

Playback lasts **3.2 s** (measured **3.209 s**) and uses quintic smootherstep: `6p⁵ − 15p⁴ + 10p³`. Adaptive history compaction retains the original break and all release events. Movement-weighted traversal compresses stationary holds while visiting the whole retained sequence. Poses use lerp/slerp; water, sheets, puddles and the visual clock interpolate backwards. Pane visibility avoids drawing full shards over a restored pane; core pieces fill their slots before their recorded birth.

Crack lines retract toward the impact during the last 22%. A restrained cool desaturation peaks mid-rewind. Reversed glass audio is pitched to 3.2 s and follows time-scale changes. Spray clears at rewind start; the sheet and puddle reverse from snapshots. Reset again skips to pristine. At the end, water is exactly 2.59, cracks and shard bodies are zero, and the water normal is `[0,1,0]`.

Reviewed stages: [20% lift-off](../rewind-early.png), [50% airborne return](../rewind-mid.png), [85% closure](../rewind-late.png). Water heights at those captures: **0.160 → 0.411 → 2.449**.

## 3. Spill and puddle

The falling sheet now has a translucent blue-white body, downward-moving internal striations, a soft leading edge and head-dependent taper. The existing 2,600-particle batch includes small bright droplets, occasional larger velocity-stretched drops, outlet spray and radial impact splashes. Impact-centred ripple rings animate the puddle.

The puddle grows with discharged volume and has a blue body, feathered rim, thin edge highlight, ripple normals and restrained environment sheen. Its smooth per-channel HDR cap is below `(0.10, 0.18, 0.25)`, beneath the 1.3 bloom threshold, in both playback directions. The captures show a visible wide puddle and soft reflection, with no blown-out white hot spot. All animation uses simulation time.

Reviewed: [crack](../crack.png), [spill](../spill.png), [shatter](../shatter.png), [settled glass and puddle](../shatter-settled.png), and the rewind stages above.

## 4. Underwater material identity

The shared deep-green absorption multiplied away rock and shore albedo. The island now has a lighter, more neutral depth absorption, a slate correction limited to submerged rock, and an 18% submerged albedo lift. Grass is restricted to gentler submerged faces. Strong directional contrast, the wet waterline transition and the dry peak are preserved.

In [pass-front.png](../pass-front.png), the same adjacent 5×5-pixel facet patches at `(1924,943)` and `(1936,955)` in the 2880×1620 output measure:

| Linear luminance | Run H | Run I |
|---|---:|---:|
| Lit facet | 0.0260905 | 0.0424938 |
| Dark facet | 0.0140336 | 0.0224674 |
| Lit/dark ratio | 1.859 | **1.891** |

The lit midtone is **62.9% brighter**. Slate rock, sandy shore and green gentle slopes are distinguishable. [pass-default.png](../pass-default.png) retains the Run H composition, shafts, reef, plaque and floor caustics.

## 5. Small polish

Coral saturation is reduced 20%, with wider per-instance hue variation; placement and draw count are preserved. The water has a clearer thin emissive meniscus on its surface and just below the tilted waterline. The default and front captures above show both changes.

## Validation and performance

All passed on the final source:

- `npx tsc --noEmit`
- `npm run build`
- `node verify/runtime.mjs`
- `node verify/edges.mjs`
- `node verify/lab.mjs`
- `node verify/library.mjs`

The final GPU verification batch used `caffeinate -diu` around the same Node commands to inhibit display sleep during GPU capture. Earlier headless attempts had a frame-wait timeout and a screenshot timeout; unchanged reruns passed. No assertions were relaxed or errors suppressed. New tests cover the early settling interval, native sleep without fallback, three rewind stages, brighter underwater facets, connected minimum-area compounds, safe polygon insets and the base-height rounding regression.

At **1920×1080, pixel ratio 1.5**:

| State | Run H draw calls | Run I draw calls | Run I median FPS |
|---|---:|---:|---:|
| Idle | 56 | **56** | **60** |
| One-wall shattered | 47 | **46** | **60** |
| Four-wall shattered | — | **34** | **60** in every measured second from break to +5 s |

Logs: [runtime](runtime.txt), [edges](edges.txt), [Lab](lab.txt), [library](library.txt), [build](build.txt). The Lab reports zero console errors/warnings and stable GPU/WASM allocations and listener counts across repeated reset/route cycles.
