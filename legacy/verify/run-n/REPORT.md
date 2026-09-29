# Run N — corrections and evidence

All six required commands pass: [TypeScript](tsc.txt), [build](build.txt), [runtime](runtime.txt), [edges](edges.txt), [Lab](lab.txt), [library](library.txt). The preview ran on port 4174. No unchanged failing verification was retried to obtain a lucky pass. The aquarium runtime passed its first final-implementation attempt. A Lab integration failure was fixed in source before its next run; details are below.

The final source is recorded in [source-hashes.json](source-hashes.json), with [changes.diff](changes.diff). The naive project was neither accessed, modified nor imported.

**1. Impact-centred glass release**

Cause: the old shared release mostly used `(spread, 0, 1)`, replaced vertical motion with a small constant, and merged small core cells into large compounds. The launch had little in-plane radial velocity. Frame-phase accumulation and unsnapped Lab impact coordinates also allowed small changes to the resulting contact pile.

Both callers still use `releaseShards()` in [release.ts](../../src/lib/release.ts). L3 now normalizes `0.85 × radialUnit + 0.55 × paneNormal`, with a small `0.09 × falloff` upward bias near the core. Its speed is `strength × (1.8 + 5.7 × exp(-3d))`: **7.500 m/s at d=0**, **1.885 m/s at d=1.4**, approaching 1.8 at the edges. Angular magnitude uses the same exponential falloff within **4–14 rad/s**, multiplied by strength and capped at 14. Axes are seeded and randomized in an outward-biased cone, keeping long plates clear of surviving pane edges. Angular impulses still use actual conditioned world inertia; linear impulses still use body mass.

L1 retains uniform **2.2 m/s** normal motion and no spin. L2 retains uniform **2.2 m/s**, with a mild radial component. Crack releases select only core cells at **strength 0.55**. The tested main-page crack releases **16 fragments**, with launch speeds **2.502 / 2.842 / 3.824 m/s**. Core grouping uses 0.01 area instead of the outer plates’ 0.1. Shared impact-distance attributes add bounded core highlights; main glass keeps its 0.55 HDR cap.

Actual t=0 Rapier velocities, **min / median / max m/s**, recorded before the first step:

| Page / level | Before | After | Mean radial fraction, before → after | Maximum angular speed, rad/s |
|---|---:|---:|---:|---:|
| Aquarium L3 | 2.891 / 4.574 / 6.359 | 1.800 / 2.064 / 6.953 | 10.221% → 83.934% | 4.914 → 11.105 |
| Lab L1 | 2.200 / 2.200 / 2.200 | 2.200 / 2.200 / 2.200 | 0.000% → 0.000% | 0.000 → 0.000 |
| Lab L2 | 2.200 / 2.200 / 2.200 | 2.200 / 2.200 / 2.200 | 0.000% → 17.715% | 6.962 → 8.232 |
| Lab L3 | 2.701 / 4.155 / 5.490 | 1.846 / 2.473 / 6.642 | 7.295% → 83.917% | 6.514 → 10.353 |

Radial fraction is `abs(dot(v, normalized(projectOntoPane(COM − actualImpact)))) / length(v)`, averaged over bodies. The [probe](probe.mjs) observes the actual constructors and actual Lab pointer handlers, including each pane’s impact/normal. The main probe uses the TANK-derived crack height; its dimensions therefore change from the old tank to the new one. Browser Space-from-pristine uses the slightly higher default impact and independently measured **1.800 / 2.048 / 6.641 m/s**, **83.934% radial**. Sampled maxima need not reach 7.5 because no body COM sits exactly at the mathematical impact.

Raw measurements: [before](before-physics.json), [after](after-physics.json). Reproduce with `node verify/run-n/probe.mjs before` or `after`; the baseline reads the preserved `before/src` snapshot.

Stability keeps Run K’s contact/inertia conditioning, CCD, gravity, fixed 60 Hz steps, interpolation and native Rapier sleep. Initial supported angular damping is reduced from 5 to 1 so plates finish toppling; the existing low-energy resting damping remains 8/20. Above 512 colliders, the shared solver increases from **12/4** to **24/8** iterations to converge multi-pane piles. No manual early sleep, contact velocity clamping, or timed freeze is retained.

| Fixed-step probe case | Bodies | Maximum displacement, 3–4 s | Maximum rotation, rad, 3–4 s | Awake at 5 s |
|---|---:|---:|---:|---:|
| Main pristine, one pane | 78 | 0.000324544 | 0.000828653 | 0 |
| Main simultaneous four panes | 288 | 0.000000000 | 0.000000067 | 0 |
| Main after settled crack | 78 | 0.000000000 | 0.000000060 | 0 |
| Lab L1 | 228 | 0.000052320 | 0.002175115 | 0 |
| Lab L2 | 41 | 0.000000000 | 0.000000060 | 0 |
| Lab L3 | 75 | 0.000000000 | 0.000000067 | 0 |

Every case also passes zero new spawn overlaps, zero skin overlaps, zero static intersections and zero fallback-fixed bodies. The rendered main test samples **61 poses** across 3–4 seconds: displacement **0**, rotation **5.96e−8 rad**, and **0 awake at 5 s**. Its 8–10-second poses are also invariant. Rendered Lab L3 has the same zero displacement / 5.96e−8 rotation / zero-awake result.

Determinism: each release resets the fixed-step accumulator to a solver boundary; the step loop tolerates floating-point residue; main random streams are seeded per wall/release, independent of reset history. Both pages quantize impact coordinates to 0.01 units. The library regression compares every pose over five seconds under `[1/60,1/60]` versus `[1/120,1/40]` frame chunks and different pre-release accumulator phases: **bit-identical trajectories**. It also preserves the 10× density-invariance check.

The initial Lab integration run exposed **0.0050599 units** of L3 motion because its subpixel ray hit was still unsnapped; [failed log](lab-pre-quantization.txt). Quantizing the actual impact fixed the geometry difference, and the corrected Lab run passed without changing settling tolerances or retrying unchanged code.

Reviewed: [pristine radial burst, ~0.25 s](../shatter-airborne.png), [crack](../crack.png), [shatter, ~1.5 s](../shatter.png), [settled](../shatter-settled.png), [Lab L3 burst](../lab/shatter-L3-broken.png). The pristine capture deliberately includes the core; the additional [after-crack airborne capture](../shatter-after-crack-airborne.png) records the later release after those core cells have already fallen.

**2. The aquarium teaches the Lab’s Worley technique**

Cause: Run L substituted Gerstner-curvature focusing for the Lab’s Worley algorithm. That focusing path is removed from aquarium lighting. Sand, gravel, island and reef use `causticLight`, directly built from `causticsField`; the floor directly calls the same function. Both use **level 3**, scales **2.3 / 3.7**, speed **0.32**, sharpness **18**, intensity **1.65**, and RGB offset **0.012**. The floor changes only the field’s light-aligned coordinate stretch (**0.38**, approximately 2.63:1 elongation) and presentation gain/tint.

Projection along the shared light direction, submerged/depth attenuation, lamp shadow visibility, finite floor footprint and drain fade remain. Sand stays warm. The source proof is saved in [caustics-proof.txt](caustics-proof.txt):

```text
src/scene/lighting.ts:23: causticLight = causticsField(causticCoordinates(), simTime, ... level: 3 ...)
src/scene/stage.ts:30: causticsField(causticCoordinates(.38), simTime, ... level: 3 ...)
```

Reviewed: [idle](../idle.png), [floor](../pass-floor.png), [Lab L3 caustics](../lab/caustics-L3.png). The floor shows crisp connected light lines elongated along the lamp’s propagation axis. Caustic intensity reaches **0** after full drainage.

**3. One fixed arc lamp**

Cause: the 60-second sun orbit continually moved shadows, projection and highlights. It is replaced by a matte dark arc/stem and a warm luminous disc aimed at the aquarium, with bloom around the diffuser and faint cool environment fill.

- Lamp base: **(-4.65, -0.37, -3.15)**.
- Head/light position: **(-2.65, 6.10, -2.30)**; target **(0, 1.25, 0)**.
- Vector toward the light: **(-0.442682, 0.810192, -0.384215)**.
- Elevation: **54.115°**. Light azimuth **−139.044°**; caustic propagation azimuth **40.956°**, the same unoriented axis.

The directional light, soft PCF shadow, shaft projection, Worley coordinates, water glint and plaque’s beveled material use that fixed source. `sunDirection` and `sunElevation` are initialized once from the head position. There is no lighting update/orbit in the animation loop. Only water effects animate their optical fields; the lamp’s transform, colour, intensity and direction stay fixed. Runtime asserts unchanged lamp position/direction between idle and spill; [source proof](static-light-proof.txt).

Reviewed: [default](../pass-default.png), [front](../pass-front.png), [plaque](../pass-plaque.png). The lamp stands behind the tank, opposite the front plaque, and its visible disc points along the lighting direction.

**4. Wider, lower aquarium**

Cause: tank dimensions and several derived coordinates were hard-coded in different modules. `TANK` is now **width 7.6, depth 4.4, top 3.0, water base 2.25**, with tank floor **0.16** and stage floor **−0.42** unchanged. The plinth/pedestal, pane origins, rim, plaque, water/clipping, sand and terrain-height raster, reef sites/vents, motes, shaft bounds/apertures, shadow camera, camera framing/orbit range, spill heights and projected click targets were propagated.

The island is **5.6 × 3.5**, with local peak amplitude **2.67** and world peak **2.85**, clearing the water by **0.60**. Verification volume conservation uses the new **33.44** tank footprint area. Main click targets and above-water targets derive from `TANK`; resets assert `tank.base` instead of 2.59.

Reviewed: [default](../pass-default.png), [front](../pass-front.png). All six required commands pass. The edge suite confirms a dry above-water crack, all four walls, exact sill drainage and reset during active spill.

**5. Saturated blue ground and background**

Cause: the field used desaturated grey/teal colours, and a distant floor could conceal the intended background gradient. The near/distant floor now uses **#0b4f78 / #062e48**, with **#8fe3ff** caustic tint and stronger contrast. Distant ground blends into the **#041b2c → #08324f** background gradient; the vignette darkens the frame edges. Sand remains warm.

Measured arithmetic mean sRGB pixel values from the final **2880 × 1620** [pass-default.png](../pass-default.png), excluding the tank, lamp and UI:

| Region | Pixel rectangle (left, top, right, bottom) | Mean colour |
|---|---|---|
| Floor, including light lines | (1250, 1400, 2350, 1530) | **#03547b** |
| Background | (1800, 220, 2450, 460) | **#002848** |

Both have blue above green and very low red, consistent with the requested saturated blue family. These are rendered, tone-mapped means rather than input material hex values. Reproduce with `python3 verify/run-n/metrics.py`; full values are in [metrics.json](metrics.json).

**6. Sheet and droplets share projectile flow**

Cause: the old streak phases scrolled at fixed **0.104 / 0.078 UV/s** irrespective of falling-water velocity. The sheet now stores normalized arc-length UVs plus projectile travel time at every vertex. Its noise phase is `flowTime − simTime`; consequently local streak speed is the projectile speed and local UV rate is **speed / arc length**. Droplets use the same launch speed/head and analytic gravity trajectory, originate at the sheet edges, and the volume ledger uses actual water-level loss times the new tank area.

The sheet is thinner at its source, has lower opacity/foam, and retains Beer–Lambert absorption/refraction. The endpoint avoids the old final-row floor clamp slowing the visible streak. Rewind now restores travel-time and UV attributes alongside mesh positions.

At the `spill.png` observation:

| Measurement | Result |
|---|---:|
| Arc length | **2.1448 units** |
| Current final-segment streak speed | **6.1451 m/s** |
| Current landing UV scroll rate | **2.8651 /s** |
| Measured droplet landings | **256** |
| Mean streak speed associated with those droplets | **6.1722 m/s** |
| Mean measured droplet landing speed | **6.3721 m/s** |
| Mean relative speed error | **3.24%**, below 15% |

Streak speed is measured from the deformed mesh’s final segment divided by its travel-time difference. Drop speed is measured from actual particle velocities when they land; their associated sheet measurement is saved at emission. This compares matching water parcels while the head falls. Runtime asserts the 15% limit. Reviewed: [spill](../spill.png).

**Verification and review record**

The six logs linked at the top record successful exits. Runtime and edges have zero console errors; Lab has **zero errors and zero warnings**. Main median idle/shattered FPS is **60 / 60**, and all eight runtime camera presets reached 60 FPS. The edge suite’s immediate four-wall sample reports 12 FPS; it is not a steady-state performance benchmark and no 60-FPS claim is made for that sample. The existing large-bundle build warning remains.

All eleven requested captures were visually reviewed: `pass-default`, `pass-front`, `pass-floor`, `idle`, `crack`, `spill`, `shatter-airborne`, `shatter`, `shatter-settled`, Lab `shatter-L3-broken`, and Lab `caustics-L3`. [manifest.json](manifest.json) records hashes for those captures and the final source/logs.
