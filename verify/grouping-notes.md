# Compound-shard diagnosis and fix

The presenter's close-up shows actual multi-cell rigid bodies. This is not a sleeping-pose cache artifact. `groupAdjacentCells` in `src/lib/shatter.ts` (Run D) merges edge-connected Voronoi cells until both its body-budget and minimum-area conditions pass. `releaseShards` in `src/lib/release.ts` makes one mesh and one Rapier body per returned group, with one convex collider per constituent cell. In the saved baseline, `tank.ts` requests minimum area 0.01 for the impact hole and 0.1 for the rest of the pane. Those thresholds merge tiny cells even when there is unused body budget.

The saved pre-performance source is `verify/perf-before/tank.ts.txt` / `physics.ts.txt`. The code at the start of this follow-up is preserved in `verify/grouping-before/{tank,physics,shatter}.ts.txt`. `?physics=legacy` reproduces the former grouping; `?physics=launch&grouping=previous` reproduces the latter grouping and physics. Default launch now releases individual cells. All profiles share the current rendering code, so lighting does not confound the grouping comparison. No earlier source proving the presenter's remembered all-individual behavior was available; the actual saved baseline already contains compounds.

The grouping probe reconstructs groups with the exact parameters passed to `releaseShards`, then checks every group's cell count against the actual body's `numColliders()`. Areas are sums of original Voronoi polygons, in scene units squared, before render/collider inset. Each cell is counted once. Histograms count bodies, not cells. The entire four-wall release records (budgets, thresholds, per-group cell counts and areas) compare exactly equal between pre-performance and previous code. The histogram is not inferred from proximity or velocities.

Parameter census (pre-performance → previous follow-up → this fix):

| Parameter | Pre-performance | Previous follow-up | Fixed |
|---|---|---|---|
| Fracture topology | L3, 220 cells/wall, seed 93+wall, centimetre-rounded impact | unchanged | unchanged |
| Hole/core radius | 0.28 | unchanged | unchanged |
| Hole minimum group area | 0.01 | 0 for pristine Space only; clicks 0.01 | 0 for every release |
| Remaining-pane minimum group area | 0.1 | 0.1 | 0 |
| Hole body budget | min(70, 400-existing) | same | number of hole cells |
| Remaining body budget | floor((400-existing)/cracked walls) | same formula | number of remaining cells |
| Observed single-wall budgets (hole/rest) | 70/384 | 70/330 | 70/150 |
| Observed four-wall budgets (hole/rest) | 70 each / 85 each | identical | hole 89,76,84,99 / rest 131,144,136,121 |
| Total released-body ceiling | 400 | 400 | 880: at most the existing four panes ×220 cells |
| Generic / glass fixed step | 120 / 60 Hz | unchanged | unchanged |
| Crowded solver (>512 colliders) | 48 solver /12 PGS | fresh islands 4+44/12 through 0.6s; ramp to4/1 by0.8s | unchanged |
| Small glass solver | 12/4 | unchanged | unchanged |
| Steps per render frame | all accumulated, input clamped at0.1s (aquarium dt also≤0.05) | max3 during launch, then crowded1/small2; drop overdue whole ticks | unchanged |
| Shard mutual collisions | always enabled | grace0.2s small /0.4s crowded, fixed floor/panes always enabled | unchanged |
| Sleeping pose sync | interpolates every binding | final pose cached once; native wake resumes sync | unchanged |
| Ground-contact angular damping | 1 | 1 | 5 for individual aquarium cells only |
| Ground-contact linear damping | 3 | 3 | 6 for individual aquarium cells only |
| Quiet supported angular damping | 20 | 20 | unchanged |

Unchanged parameters include: release strength 1.35 (full) /0.55 (click); max launch speed9; spin strength capped at0.75; density2500; minimum mass formula; inertia anisotropy limit4; restitution0 and contact friction1.2 for glass; airborne linear/angular damping0.45/1.2; quiet linear/angular damping8/20; quiet speed/angular thresholds0.3/1.5 held0.1s; native sleep scene length units4/6, actual contact error0.0002/0.0003, prediction0.004/0.006, skin≤0.003, ERP0; CCD max substeps2 and cutoff after1s; visible/collider thickness0.038/0.040; inset/corner clearance; impulse and angular-kick sequence; glass material, shader and render batching. Changing group membership changes derived body masses and centres, not those formulas. No forced-sleep deadline was added.

The original 400-body cap was not binding in the measured pre-performance releases: the minimum-area rule had already reduced them well below it. Removing the thresholds exposes the full880-cell population, which does require the larger flight allowance.

The fixed aquarium path bypasses grouping by giving each existing cell a body. `groupAdjacentCells` has an identity fast path when no merging is requested; its connected-compound behavior remains available and is still exercised by Run D and Lab. Lab never enables the new individual-cell damping flag. After the burst, native sleeping retires simulation work independently. Sleeping bodies retain their identities and poses for rewind; they are not welded together later. Total allocated bodies remain bounded at880, while awake work drops to zero by5s. This intentionally changes the old 400 historical-body ceiling; `state.brokenCount` is an event-time count, not a separate physics limiter. `tank.bodyCount` and the diagnostics report the real body count without clamping or hiding it. Edges now checks the880 cell ceiling, exact single-cell collider structure, and native sleep by5s. The runtime single-wall400 assertion remains unchanged.

The first ungrouped candidate met the FPS and native-five-second-sleep requirements but failed the 3–4s rest window (0.1792 units displacement /0.4543 rad rotation). Ground-contact angular damping5 reduced that to0.000957 /0.043845; raising quiet angular damping to40 and restricting it by plate tilt did not pass. Those trials were reverted. The retained supported linear/angular damping6/5 measured0.000201 units /0.001506 rad, with zero awake at5s; quiet damping remains8/20. These changes apply after support contact and leave the airborne impulse and damping untouched. Raw experiments are retained under grouping-rest*.

Reproduction: build `npx tsc --noEmit && npx vite build --outDir dist-perf`; preview `npx vite preview --outDir dist-perf --port 4175`. Run `VERIFY_URL=http://localhost:4175/ node verify/grouping-perf.mjs` for all three profiles (optional PROFILES / CASE). Results under grouping-{before,current,after}/launch-{single,four}.json contain exact release records and per-frame timings. FPS uses performance.now intervals over wall-time0.1–1.5s airborne /8–10s settled, 1920×1080 DPR1.5. The four-wall click/orbit/drain/Space flow matches edges.mjs. The probe adds diagnostic overhead; it runs only with query flags.

`grouping-floor.mjs` captures the previous and fixed single-wall Space release at scene time2s, matching runtime's scene clock. It freezes physics at the capture point and overrides only the diagnostic camera, with the original scene, glass and floor rendering. Both images use the same portrait camera position and target; exact capture ages are saved beside the PNG. The required image is `verify/perf-after/shards-floor.png`. The previous-code comparison is `verify/grouping-current/shards-floor.png`.

Lab validation: the unreset L3 fixture failed its0.01-radian rest limit twice (0.01809 /0.01877), while the L3 grouping and physics branch were unchanged. Three focused releases after resetting the frozen native world all measured zero displacement, rotation below6e-8 and zero awake at5s. `verify/lab.mjs` now explicitly resets while frozen before each measured release; motion tolerances and the native5s assertion are unchanged. No `src/lab/*` file was edited. The original fixture remains timing-sensitive; failure logs and focused results are retained as grouping-lab-first/second.txt and grouping-lab-rest.txt.

Final validation: TypeScript and the dist-perf build passed. Edges, library, Lab and runtime all exited0; runtime ran once, last. Runtime measured 3–4s displacement0.001726 /rotation0.005073, zero awake at5s, no displacement at8–10s, and rewind3.205s. The final instrumented FPS medians were59.88/59.88 single and48.31/59.88 four-wall (airborne/settled). The complete verbatim evidence is `grouping-evidence.txt`; suite logs are `grouping-{edges,library,lab,runtime}.txt`.
