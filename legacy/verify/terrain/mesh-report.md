# Flank artifact investigation

The terrain did not contain a hole. All nine seed meshes already had positive-area,
upward-wound faces and paired, oppositely directed interior edges.

The real cause was src/state.ts constructing inactive breachDrawdowns with new Vector4().
Three.js defaults Vector4.w to 1. Four zero-width, depth-1 breaches therefore all
acted at x=z=0. The water shader clamps the radius to .001 and subtracts all four
contributions at its center vertex, moving it from y=2.25 to approximately -1.75.
That water triangle cut through the island and looked like a blue diamond with a pale rim.
Diagnostic before/mesh/pink-original-position.png shows the offending water triangle
with a solid pink material; the terrain itself is solid brown behind it.

Fix: initialize breachDrawdowns with new Vector4(0,0,0,0). No water shader,
lighting, tank, spill, aquarium, or post source changes were necessary.
Separately, the requested generator invariant is enforced by clamping island-local
heights to .10 (world sand y=.28 minus mesh origin y=.18). Generic terrain is unchanged.

| Seed | Triangles before/after | Below-sand vertices before/after |
|---|---:|---:|
| 166 | 2988/2988 | 358/0 |
| 155 | 3098/3098 | 356/0 |
| 167 | 2950/2950 | 351/0 |
| 71 | 2926/2926 | 337/0 |
| 234 | 3006/3006 | 348/0 |
| 32 | 2990/2990 | 351/0 |
| 139 | 2946/2946 | 347/0 |
| 13 | 3074/3074 | 357/0 |
| 173 | 2976/2976 | 340/0 |

Degenerate faces (area <=1e-10), downward/zero-Y normals, interior boundary edges,
nonmanifold edges, and inconsistent shared-edge winding: zero before and after
for every seed. The smallest final triangle area is 0.000006949903237796207.
The outer boundary remains at the sand bed; this is a continuous heightfield, not an enclosed solid.

Commands passed:
- node verify/terrain/mesh-check.mjs --before
- node verify/terrain/mesh-check.mjs (also checks zero inactive drawdown depth)
- node verify/terrain/check.mjs (Lab geometry/normals/biomes identical at L1/2/3; placement/texture checks pass)
- npx tsc --noEmit && npx vite build --outDir dist-terrain
- VERIFY_URL=http://localhost:4177/ CAPTURES=main-front-low,secondary-flank,lab-terrain-L3 node verify/terrain/screenshots.mjs

Inspected all three regenerated captures. The secondary-flank blue diamond and
vertical water streak are gone; rock gullies/shadow facets remain. The low front
view shows intact unequal peaks. Lab L3 retains its generic snow-capped ridges.
Both main views measured median 60 FPS with no page errors. No DoubleSide or
seed-specific terrain workaround was used.
