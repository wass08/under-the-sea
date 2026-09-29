# Run H — aquarium atmosphere and reef pass

The main aquarium now sits on a 0.42-unit museum pedestal over a neutral matte floor. The tank's water, wall, terrain and rewind coordinates are retained. Floor rendering, ground collision, spill ribbons, droplets and puddles all use the same lowered floor height. Lab and shared-library source files are byte-for-byte unchanged from `before/src/`.

## Changes and visual evidence

1. **Floor light:** the existing level-3 Worley `causticLight` projects in sun space onto the stage, including water-normal tilt. A rounded footprint mask fades by 3.8 units; the far floor skips Worley evaluation. A water-fill uniform fades the field to zero at empty. Cool light contribution is capped at 0.42 linear; the floor retains its integrated soft contact shadow and adds a broad low-contrast ambient pool. See [floor detail](../pass-floor.png), [default](../pass-default.png), and the clean floor after [shatter](../shatter-settled.png).

2. **Atmosphere:** screen-space blue-teal/slate gradient, cool fog, warmer drifting sunlight, multiplicative teal underwater attenuation, subtle blue shadow lift and cool vignette. A background-intensity mismatch found during the visual pass was corrected so no horizon band remains. The same adjacent rock faces used in Run G remain distinguishable: linear luminance **0.02609 / 0.01403 = 1.859**, exceeding 1.8. `runtime.mjs` samples 5×5 patches from the actual front PNG at (1924,943) and (1936,955), reprojected for the new camera target. See [front](../pass-front.png), [front-left](../pass-34.png), and [low angle](../pass-low.png).

3. **Ripples and bubbles:** three counter-scrolling normal octaves and the existing moving wave term strengthen surface shimmer without geometry waves. One instanced sphere batch supplies up to 66 thin, transmissive rim-lit bubbles from tube colonies and lower slope vents. Size controls speed; simulation time controls wobble and rise. Pops call `water.ripple` at low strength. Analytic trajectories can play backwards during rewind. Runtime records **64 live bubbles** at idle, confirms pops after reset, and asserts **zero after full drain**. See [idle](../idle.png), [front](../pass-front.png), and [spill](../spill.png).

4. **Reef:** four instance batches provide 25 branching fans, 23 hollow tube clusters, 20 lobed brain-like corals and 135 seagrass tufts, with deterministic color/scale variation. Placement raycasts the actual terrain, rejects steep faces and high ground, and clusters near the low shore. Caustics and underwater tint apply per fragment. Grass sways with simulation time and water tilt, then droops as roots emerge; dry coral stays anchored and loses its wet tint. Reset restores the wet state. See [front-left](../pass-34.png), [plaque close-up / reef detail](../pass-plaque.png), and [dry reef](../shatter.png).

5. **Pedestal and plaque:** softly bevelled matte plinth, matching collision box/contact shadow, and a capped metallic gold plaque with a 1536×320 brushed/engraved canvas texture. Camera target and minimum distance now accommodate the base; dedicated plaque/floor presets support repeatable captures. See [legible plaque](../pass-plaque.png) and [low view](../pass-low.png).

6. **Motes:** the existing single batch now contracts with the local tilted water height. Size-zero culling and a fragment fade prevent particles above the surface; no motes remain after emptying. The diagnostic counts the actual nonzero-size uploaded positions above the plane; runtime monitors it every frame across crack, slosh and drain and asserts **zero**. See [crack](../crack.png), [spill](../spill.png), and [settled](../shatter-settled.png).

## Performance and verification

1920×1080 viewport, pixel ratio 1.5 (2880×1620 PNG), WebGPU on the local machine:

| Scene | Run G draw calls | Run H draw calls | Run H median FPS |
|---|---:|---:|---:|
| Idle | 48 | 56 | 60 |
| Settled shatter | 41 | 47 | 60 |

All four main views and the two detail presets measured 60 FPS median. The independent four-wall edge case used 397 bodies, 35 draw calls and 60 FPS. The existing rest assertion measured zero displacement and 5.96e-8 radians rotation change from break+8 to break+10 seconds.

Command logs: [tsc](tsc.txt), [build](build.txt), [runtime](runtime.txt), [edges](edges.txt), [Lab](lab.txt), [library](library.txt). Exit codes are recorded in [checks.json](checks.json). Runtime keeps all previous interaction, audio, rewind and physics assertions, and adds underwater contrast, bubble/pop/reset, mote clipping and floor-caustic drainage assertions.

All eleven requested images linked above were regenerated and visually reviewed. [changes.diff](changes.diff) contains the production source changes; original source and screenshots are preserved in `before/`.
