# Run E — puddle highlight and glass readability

Only the puddle and released-shard materials changed; [source diff](run-e/fixes.diff).

- **Puddle:** roughness and clearcoat roughness are 0.12. Its RGB output is capped at 1.1 before bloom (threshold 1.3), preserving alpha and eliminating the saturated sun hot spot at its source.
- **Released shards:** full transmission remains enabled. Opacity is reduced from 0.72 to 0.42 and depth writes are disabled, making overlapping faces translucent while preserving their geometry and visible edges. The existing shard brightness cap remains in place.

## Verification

| Command | Result | Log |
| --- | --- | --- |
| `npm run build` | PASS, exit 0 | [Build](run-e/build.txt) |
| `node verify/runtime.mjs` | PASS, exit 0 | [Runtime](run-e/runtime.txt) |
| `node verify/lab.mjs` | PASS, exit 0 | [Lab](run-e/lab.txt), [full summary](run-e/lab-summary.txt) |

Both browser suites completed without console or shader errors. Runtime recorded 60 median FPS after shatter.

## Images reviewed

- [shatter-settled.png](shatter-settled.png): the round white floor hot spot is gone. A soft, broader glint remains within the puddle. The large front-right shard faces show translucent overlaps and readable edges.
- [spill.png](spill.png): the stream and puddle remain visible with no blown-out floor reflection.
- [shatter.png](shatter.png): glass overlaps remain translucent and the puddle reflection stays bounded.

In the same floor region of the before/after settled images, pixels with all RGB channels at least 240 dropped from **1,582 to zero**; the maximum channel value dropped from 255 to 167. [Pixel measurements](run-e/hotspot-pixels.json). Original images and the two original source files are archived in [run-e/before](run-e/before/).
