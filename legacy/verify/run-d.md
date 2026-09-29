# Run D — final fix pass

## Verification

All six required commands completed with exit code 0.

| Command | Evidence |
| --- | --- |
| `npx tsc --noEmit` | [Compiler output](run-d/tsc.txt) — no diagnostics |
| `npm run build` | [Build log](run-d/build.txt) |
| `node verify/runtime.mjs` | [Runtime log](run-d/runtime.txt) |
| `node verify/edges.mjs` | [Four-wall log](run-d/edges.txt) |
| `node verify/lab.mjs` | [Browser log](run-d/lab.txt), [full assertion summary](run-d/lab-summary.txt) |
| `node verify/library.mjs` | [Library and regression log](run-d/library.txt) |

The production build retains its existing large-chunk warning. Browser verification reported no console or shader errors. The main runtime measured approximately 0.1498× simulation speed in slow motion and 60 median FPS after shatter. Four-wall shatter used 397 dynamic bodies. The edge check observed the water actually drain from 1.8347 to the lowest sill at 1.1783, then stop spilling.

## Changes

- Released aquarium shards use 0.12 roughness and an HDR output cap of 1.1, below the aquarium bloom threshold of 1.3.
- Body-budget grouping merges edge-adjacent fracture cells. Compound rigid bodies keep one convex collider per cell. Regression checks verify connected groups and raycast through the empty quadrant of an L-shaped compound.
- Reset invalidates audio requests awaiting context resume or decoding. Regression checks exercise both races and confirm new playback still works afterward.
- Spill volume is distributed by opening width times square-root head, split at sill crossings. Tests cover dry and exhausted openings, unequal widths, volume conservation, and refill.
- Level-2 raw Worley reveal selects unscaled F1. Island dimensions, summit height, bloom settings, and compound-collider documentation match the implementation.
- Lab verification checks actual shard movement, frozen transforms, measured time rate, body/collider counts, and exact resource/listener counts through six resets and three bench cycles.
- Those stronger checks exposed two cleanup defects, now fixed: reset owns/disposes the shard material to release per-shard uniform buffers, and post disposal releases Three r186's separate transmission framebuffer texture.

The repeated Lab cycles returned to exactly one world, two fixed bodies/colliders, eight GPU geometries, 14 attributes, six index attributes, 18 textures, 14 render targets, 21 programs, and 24 uniform buffers. Window/document/canvas listener counts stayed at 18/1/7. Leaving shatter returned the physics allocation counts to zero.

## Visual review

[New shatter-settled.png](shatter-settled.png) was inspected against the [archived image](run-d/before/shatter-settled.png). Settled shard faces retain soft grey-white glints and readable edges; the large saturated patches on the shard cluster are gone. The separate round highlight farther forward is the existing puddle reflection.

[Level-2 raw Worley](run-d/caustics-L2-raw.png) was also inspected in the browser: it shows the full grayscale distance field. The [shaded comparison](run-d/caustics-L2-shaded.png) retains the normal floor appearance.

[Full patch](run-d/fixes.diff) and [command results / changed-file list](run-d/results.json) are saved alongside the logs. No dependencies, branding, route controls, or unrelated scene parameters were changed.
