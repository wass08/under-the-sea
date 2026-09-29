Terrain verification, 2026-09-16

Changed production files: src/lib/terrain.ts, src/scene/island.ts, src/scene/reef.ts,
src/aquarium.ts (consume island.focus), src/camera.ts (top verification preset).
The generic Lab terrain and src/lab/levels.ts remain unchanged; the copy describes
that generic mountain, and geometry/biome/normal comparisons pass at L1/L2/L3.
The four reserved concurrent files were not edited by this task.

Commands:
  npx tsc --noEmit && npx vite build --outDir dist-terrain
  npx vite preview --outDir dist-terrain --port 4176 --host 127.0.0.1 --strictPort
  node verify/island-sheet.mjs
  node verify/terrain/check.mjs
  node verify/terrain/screenshots.mjs

Use the explicit IPv4 URL: another preview was listening on IPv6 localhost:4176.
The screenshot script uses a dedicated agent-browser session with WebGPU.
No new dependency was installed. Production build passes with the existing large-chunk warning.

Seed 166 is the highest scorer among 240 seeds (95.329); 84 meet every eligibility
constraint. The best nine form ../island-sheet.png, using the unchanged sheet HTML,
camera, lamp, and createIslandMaterial. The sheet deliberately has no water plane.

Generator measurements (world water y=2.25, mesh origin y=.18, sand y=.28):
main summit y=2.779999905, +.529999905 above water;
secondary y=2.217552357, -.032447643 below water;
saddle y=1.571706347, .678293653 below water;
secondary/main local height ratio=.783674012;
footprint=.411381057 of the 7.6*4.4 floor, integrating clipped triangles with
local height>.15 (world terrain>.05 above sand);
4 connected gully components, 420 droplet paths, 541 incised vertices;
20.3846% of the main summit's local height is dry; 3.4983% of footprint area is dry.
Snow weights are zero. 18/107 dry faces retain >5% green before edge blending.

Inspected images:
main-idle.png: two unequal peaks; a small exposed main tip, second at the surface,
submerged saddle, sandy foreground, and coral colonies clear of the mountain.
main-top.png: whole tank; back-left peaks and longer front sand skirt; open water
and flat sand on the right/front-right, with coral colonies around the margins.
main-front-low.png: best emergence evidence; main upper fifth above the water,
secondary just below, and a distinct water-filled channel above the saddle.
lab-terrain-L1.png: deliberately chaotic sharp spikes and mostly rock labels, 59 FPS.
lab-terrain-L3.png: unchanged generic ridged mountains, snow caps, and broad valleys, 60 FPS.
../island-sheet.png: all nine have unequal paired summits, a saddle, sand fans,
rocky flanks and visible incision; seed 166 has a particularly legible main flank.

All main views measured median 60 FPS at 1920x1080; runtime.json has no page errors.
checks.json records zero terrain penetrations at sampled gravel/coral vertices,
all original instance counts retained, and height-texture/triangle maximum sampled
error of 1.17e-7. These are geometric samples, not continuous collision proofs.

Visual limitations: the unchanged lamp makes the dry slate pale; its small green
blend is clearest from above. The shore/beach ring is thin because most waterline
faces are steep rock. Waves can intermittently reveal the almost-submerged second
tip. Gully count is the existing connected-incision diagnostic, not a count of
every visible branch. Rendering performance is hardware-dependent.
