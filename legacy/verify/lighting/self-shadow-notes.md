Self-shadow diagnosis and verification

Production changes are limited to src/scene/lighting.ts and src/scene/island.ts. stage.ts and all reserved files were left alone.

Root causes:
- Three r186 reverses FrontSide to BackSide for the ordinary shadow pass. This island is an open height field: the map stored far-facing receiver facets and omitted the lamp-facing ridge. Actual GPU depth24plus texels were read with textureLoad in a compute pass; a double-sided geometry ray independently identified the missing ridge.
- The old projected slope bias (-.00012 - .003*(1-|N.L|)) moved receivers by tenths of a world unit. normalBias was .02. The dry AO branch also returned 1 regardless of occlusion, flattening the remaining indirect light contrast.

Fix: the terrain casts both sides; the diagnostic replacement material preserves this. Normal offset is .008 world units. Scalar bias is -.00002 - .00003*(1-|N.L|). Each existing 4x4 PCF tap uses the receiver plane gradient for its comparison depth, plus a bounded one-texel bilinear residual. Kernel spacing stays 2.2 texels at 3072 square; near/far stay .2/35. Wet/dry AO is .55/.50 in umbra, .90/1 in light; lamp-off ambient is unchanged. Caustic emission remains shadow-masked.

GPU evidence (depth is perspective 0..1, NOT world distance):
face | old map | old biased receiver | new map | new biased receiver | old -> new axial world depth bias (plus separate normal offset)
41 | 0.966958940 | 0.965613676 | 0.954438806 | 0.967099952 | 0.214740 -> 0.016618
149 | 0.962988913 | 0.961463372 | 0.953801334 | 0.963210480 | 0.208179 -> 0.017841
819 | 0.973786891 | 0.972548785 | 0.969644308 | 0.973843323 | 0.267189 -> 0.015810
963 | 0.976835549 | 0.975370437 | 0.969839811 | 0.976886592 | 0.377160 -> 0.023449

The receiver now lies behind the ridge stored in the map. The depths above use the centre tap; other taps follow the measured receiver plane. World depth bias is converted with the actual perspective projection, and includes the bilinear residual for the new filter. Normal offset is separately .02 -> .008. The housing spans only -.05..+.05 in shadow-camera depth (near=.2); diffuser does not cast. Neither can cast the false peak shadow.

Facet luminance method: 30 real rendered frames, linear Rec.709, 3x3 pixels at visible facet centroids. All three triangle vertices have rock weight >=.9; heights .8..1.9. Lamp-facing N.L>.3 and ray-clear; far-facing N.L<-.1. Main/secondary split at x=0. Water/glass overlays are hidden for these measurements, while water height, submerged material shading, lights and the actual shadow map remain active. This is necessary because refraction moves apparent facet positions and surface reflections are not facet luminance. The requested wet/drained PNGs retain the full scene; separate -facets.png files show measurement views.

wet main: lamp-facing 0.109675 (12 facets), far-facing 0.051493 (131 facets), ratio 2.1299
wet secondary: lamp-facing 0.105715 (17 facets), far-facing 0.048895 (179 facets), ratio 2.1621
drained main: lamp-facing 0.168023 (9 facets), far-facing 0.072936 (132 facets), ratio 2.3037
drained secondary: lamp-facing 0.167251 (18 facets), far-facing 0.075514 (188 facets), ratio 2.2148

Sand (full scene, moving caustics/water intact): 0.132846/0.248314 = 0.534992; 46.50% darker, 61 shadow + 23 lit sites over 30 frames. Existing .35..70 intent retained.

self-shadow-wet.png uses the fixed default idle pose. self-shadow-drained.png is a high front-right pose [7.5,8.5,6.5] aimed at [-.2,1.2,0], portrait framing approximating the presenter, after Space and at least 6 seconds; water height=.16. No fake dry material or lighting override is used.

Striping method: the prior stored notes were visual and explicitly mentioned fine PCF banding; no prior numeric striping metric was found. This revision adds a repeatable intra-facet line test on actual isolated shadow output. Geometry rays exclude real occlusion boundaries. All sample pixels and their 3x3 filter footprint must lie within the same facet; non-casting glass rails are hidden for that metric only. A repeated dark/bright/dark (or inverse) excursion crossing .2/.65 is flagged. Full shadow-debug.png retains the rails; self-shadow-stripe-isolation.png is the measured image. See self-shadow-stripes.json for all lines and the final count.

Final stripe result: 0 repeated bands in 1037 lines across 501 facets (994 shadow, 43 lit lines). Runtime PASS, unchanged thresholds; rock contrast 2.850671 and all nine FPS samples 60.
