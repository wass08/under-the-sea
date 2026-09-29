# Run L — Gerstner water and shared optics

## Implementation and reviewed evidence

| Item | Implementation | Reviewed captures |
|---|---|---|
| Wave shape | Six trochoidal waves, 2.6–0.27 m wavelengths; horizontal choppiness; exact displacement tangents/normals evaluated per vertex; two per-pixel noise octaves. Existing spring tilt, agitation and ripple rings remain in the displaced surface. Horizontal motion smoothly pins to the glass. | `pass-default.png`, `pass-front.png`, `pass-surface.png`, `pass-low.png` |
| Light transport | Beer–Lambert extinction from scene depth, limited to the actual tank ray segment; normal-offset scene refraction with slight RGB dispersion and foreground rejection. Physical GGX sun reflection, broad soft glint and backlit crest scattering. Removed the stacked tinted water-box veil. | `pass-surface.png`, `pass-low.png`, `idle.png` |
| Reflection | A mirrored camera renders the scene every frame above the tilted mean water plane, clipped using an oblique projection. Quarter size in each dimension (720 × 405 at the verification resolution), Fresnel weighted, wave-distorted lookup, HDR environment contribution/fallback. Retained planar reflection because the measured cost fits 60 FPS. | `pass-shore.png` clearly shows the inverted peak; `pass-surface.png` |
| Foam and caustics | Noisy shoreline band uses the existing terrain height texture; compression/Jacobian drives crest foam; thin glass meniscus remains. Main caustics use the six-wave curvature field and the Jacobian of linearized Snell refraction, including the sun-aligned oblique-incidence term. Interior and floor share time, spectrum and sun direction; both fade on drain. | `pass-shore.png`, `pass-front.png`, `pass-default.png`, `spill.png` |
| Pour and puddle | Existing deformed slab now uses flow-dependent optical thickness and the same absorption/refraction helper. Aerated leading edge, noisy broken edges, downstream foam, existing spray/splash/rings preserved. Puddles use a 48 × 48 mesh with tiny Gerstner displacement, shallow absorption, environment sheen and foam rim; existing output cap, depth offset and stable draw order remain. | `crack.png`, `spill.png`; also checked `rewind-mid.png` and `shatter-settled.png` |

All eight requested images were opened and visually reviewed at their saved resolution. The surface has visible relief and a reflected peak; shoreline foam follows the island; the submerged facets remain distinct. The pour has a bright aerated core and the puddle has a dark transparent body without a white bloom patch.

## Measurements

Apple M5 Max, Chromium WebGPU/Metal, 1920 × 1080 CSS pixels, pixel ratio **1.5** (2880 × 1620 drawing buffer).

| Measurement | Result |
|---|---:|
| Surface GPU render time, median | **4.60 ms/frame** |
| Mirrored-scene GPU render time, median | **0.49 ms/frame** |
| Combined measured render time | **5.09 ms/frame** |
| Idle median FPS / total draw calls | **60 / 101** |
| Shattered median FPS / total draw calls | **60 / 51** |
| Empty tank surface/reflection work | **0 / 0 ms** |
| Surface mesh | **128 × 80 segments; 10,449 vertices; 20,480 triangles** |
| Underwater adjacent-facet luminance | **0.05335 lit / 0.01445 dark = 3.69:1** |
| Puddle 10-frame maximum RGB-channel difference | **2/255**, mean **0.0533/255** |

`gpu.json` contains the measured values. `profile.mjs` enables the optional `waterProfile` diagnostic. The profiler timestamps the surface draws individually and every actual reflection render pass, including framebuffer-copy-induced splits and mipmap rendering. Surface timings conservatively include extra attachment load/store overhead from isolating the draws. These are GPU **render-pass** times, excluding CPU submission and standalone texture-copy commands; they are not CPU frame timings or an inferred FPS difference. The first aggregate Three timer experiment was rejected because reused timestamp pairs across split passes gave inconsistent totals. The diagnostic is inactive in normal playback.

## Verification

All required commands passed:

- `npx tsc --noEmit` — `tsc.txt` (empty means no diagnostics).
- `npm run build` — `build.txt` (existing bundle-size advisory only).
- `node verify/runtime.mjs` — `runtime.txt`.
- `node verify/edges.mjs` — `edges.txt`.
- `node verify/lab.mjs` — `lab.txt`, **0 console errors and 0 warnings**.
- `node verify/library.mjs` — `library.txt`.

Runtime retained every physics threshold: 61 pose samples at break+3–4 s, **zero displacement**, rotation **5.96e-8 rad**, **zero awake bodies at 5 s**, no fixed-body fallback, and zero displacement at 8–10 s. Rewind took **3.209 s**, restored height **2.59**, and removed all cracks/bodies. Slow motion, audio scheduling, bubbles, mote clipping, full drainage and route checks passed. The spectral bound is **0.95033 < 1**, preventing an overturned interior Gerstner mapping even at maximum agitation; the shortest wave has more than five mesh samples.

Verification now fixes the interaction camera at its default pose. Earlier auto-orbit runs changed the integer mouse-to-wall intersection and intermittently failed the existing early-settling limits (about 0.0021 units / 0.02–0.03 rad). No thresholds or physics code were changed to pass them. Default-page auto-orbit remains enabled; the fixed pose applies only to the interaction test URL.

## Approximations and scope

- Refraction uses the visible opaque scene buffer, not off-screen ray tracing. Absorption estimates the path with scene depth and the tank bounds.
- The planar reflection is exact for the tilted mean plane; wave normals perturb its lookup. The underside and puddle use HDR environment reflections rather than additional mirrored renders.
- Caustics linearize Snell's law using the dominant Gerstner spectrum's curvature, with bounded focusing. They omit capillary detail and individual bubble-pop rings; no photon splatting or multiple scattering is claimed. Shoreline depth comes from the existing 128² terrain height field.
- Foam and crest scattering are bounded shading approximations; the sheet's optical thickness is a flow-based estimate.
- Lab source, shared shatter/physics, island generation, reef, UI, audio, rewind controller and dependencies are unchanged. `changes.diff` and `source-hashes.json` record scope. No code or assets were imported from the naive project, and it was not modified.
