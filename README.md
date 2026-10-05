# Under the sea — Wawa Sensei

*You can't prompt what you can't name*, episode 2: **Boids & GPGPU**.

An open sea at night that runs off into fog: no diorama box and no horizon line. Height fog hides every edge; three rings of mountain silhouettes fade into it at increasing distances, a low moon hangs over the far ridges, and a few distant boats show as warm lantern points with soft halos. Under the water, 9.2 units deep, a sandy floor with reef mounds and fluorescent coral, glowing algae and 4,096 cá chuồn (flying fish) simulated on the GPU. A fisherman sits on a Li River–style bamboo raft under a paper lantern hung from an arching bamboo pole; the lantern lights the boat, glitters on the water and pools warm light on the sand below, while a global network of moon caustics shimmers across the seabed. A procedural night HDRI with the moon supplies the cool blue fill and the moon's highlights on the water, the raft and the fish. Fish range from small juveniles to larger adults, with roughly three times the length between the smallest and largest. They start spread through navigable water and show three collective behaviours: **milling**, the **fountain effect** and **flash expansion**. The fisherman casts a line: the splash scatters the school, calm returns, curious fish inspect the lure, one of them bites, and you click to hook it.

Vite + vanilla TypeScript, three 0.186 WebGPU/TSL (compute shaders + instancing), Tweakpane.

## Loading and reveal

The 3D stays hidden behind a small swimming-fish loader while shaders compile (`renderer.compileAsync`, then hidden warm-up frames until a few consecutive frames run at a normal pace). The canvas then fades in as the camera glides from far out in the fog to the opening shot (3.4 s), and the masthead, top panel, dock, caption and Tuning panel fade in one after another. `data-status=ready` is set when the intro ends. `?nointro` (and the debug-camera switches) skip the glide. Critical styles (icon sizes, loader, reveal states) are inline in `index.html`, so nothing renders unstyled before the stylesheet loads.

The top panel uses the dock's style: catch count, total weight (each fish's weight comes from its real per-fish size and a flying-fish length–weight relation, ~9–260 g) and the status line; a catch card shows the weight of each fish that lands in the creel.

## Final look pass

- **The school gathers at the light** (School → Roaming → *Gather at light*, default 0.55): the schools' loop tightens and its centre slides under the lantern, so the school reads as a shape under the boat. Far fish lose their reflections and fade into the water.
- **Surface reflection at grazing angles** (Fog & volumetrics → Water surface): beyond exact Fresnel, the surface turns mirror-like toward the horizon and transmission fades along the long slanted path. Near the boat you see down into the school; far out you see sky, moon, lanterns and the mountains, which now also appear in the planar reflection.
- **Light hierarchy:** corals and rocks are dark, natural reef tones; the glow plants keep a few barely-there colours (Fog & volumetrics → *Plant glow*); the lantern, fish and rays are the bright things.
- **Warm glints:** silver flanks reflect the lantern as gold and the moon/environment as cool silver.
- **Depth fade:** fish fade into the water medium with distance from the camera (underwater) and with their water path (above water). Fish inside the lantern's lit pool have most of that fade lifted so the lit school reads from afar (School → Look: *Depth fog*, *Fog-free distance*, *Lantern lifts fog*, *Lantern pool radius*).
- **Settled start:** before the reveal the school is simulated 25 s ahead on the GPU (`?prewarm=seconds`, `0` to watch it form), so the first frame already shows formed schools around the light.
- **Underwater hero angle:** the lure cam frames underwater shots from below, looking up at the raft and the lantern's glow through the school. `?cam=hero&lookAt=1.4,11,2.1` gives the same view for the main camera.
- **Calmer turning** (School → Roaming → *Path turn °/s* 25, *Bait-ball / split cycle*; School → Flocking → *Turn rate °/s (calm)* 40): school headings and individual fish turn gradually, so schools sweep round instead of wheeling on themselves.

## Contrast, lit fish and a 3D school

- **Lit fish** (School → Look): the lantern shades the school from above, with warm light on the backs (*Lantern on backs*), a broad warm sheen (*Lantern sheen*) and tight glints as fish turn and bank (*Lantern glints*), all falling off with distance from the lamp. Fish are ~65% of their former length (*Fish size*), vary ±60% (*Size variation*) and wobble slightly in pitch and roll (*Pitch/roll wobble*).
- **Contrast:** deep water, the underwater medium and the air fog are near-black ink blue (the AgX tone mapping lifts anything above ~0.01 linear to grey, so base colours sit 3–5× lower); the moon shafts are fainter and the lantern is the brightest thing.
- **The boat from below:** with the camera underwater, the surface shows the raft, fisherman, rod and line as a dark silhouette against a warm pool of lantern light; the fishing line is a solid thin line that reads from below.
- **3D school** (School → Flocking: *Cohesion Y*, *Pitch limit °*, *Depth spread ±*, *Speed variation ±* 0.3, *Undulation*; School → Roaming: *Depth wander*, *Wander period s*): weaker vertical cohesion, a per-fish preferred depth, a ±20° calm pitch limit, a vertical wave travelling along each school, and a slow out-of-phase rise and dip of each school through the lantern cone. Milling is unchanged.
- **Separate schools on long curves** (School → Roaming): the schools share one wide, gently wobbling loop around the lantern (*Roam radius* 9, shrinking a little with *Gather at light*; *Loop wobble* 0.15) and sit a third of a lap apart, so three distinct schools pass through the lantern's pool in turn. The loop's centre wanders slowly around the lantern (*Centre drift* 4.5, two incommensurate rates) and the oval slowly turns, so no lap repeats and a school now and then passes right under the light. The tightest bend is longer than a school. The route speed is a ground speed that scales with the fishes' *Speed* (Route speed 0.95 is the pace at Speed 0.5), and the route phase is integrated, so changing Speed or the radius never makes the schools jump. When a big loop would reach the swim-area clamp, the centre drift shrinks instead (a clamped route has corners). Defaults: *Roam radius* 12, *Speed* 0.8, *Individual wander* 0.12.
- **Bait-ball / split cycle** (on by default): every ~2 minutes each school pulls into a short, round, tight knot and the loop tightens towards the lantern for ~16 s, then stretches back out; later the schools drift apart sideways for a while.
- **School shape:** each fish holds a slot in its school (slots drift slowly along it and are packed towards the middle, the tail runs longer than the head). A stiff, tapered tube around each school's centre line keeps it flat and slim while separation spreads it lengthwise, so a school is a long, flat, crescent-shaped body (≈ 7 × 3.5 × 1.5 u, tapering to a sparser head and tail) bent into the arc of the route (curvature passed in `attractDirs.y`; fish head along the arc). Part of the slot pull has a fixed strength, so the shape holds even with a low *Stick to group*, which still sets how loosely the school follows its route. Schools breathe ±14% in size. *School half width* still widens or narrows them.
- **Per-fish randomness fixed:** the per-fish random numbers (`rA`, `rB`, `rC`, `trait` in `src/fish/sim.ts`) are explicit shader variables. As plain nodes they were emitted inside the first branch that used them (spawn / airborne), so every free-swimming fish read 0 for `rA` and `rC`: all fish shared one slot along the school, one depth slot, one wander and speed-wave phase, which is what collapsed every school into a synchronised ball whatever the sliders said.
- **Diver bubble** (School → Flocking → *Diver bubble*, 3 u): underwater, fish within the radius calmly steer around the camera (no fear, no flash), so zooming into the school parts it instead of filling the lens. Fish the camera still overtakes shrink away under 1 u. Inactive when the camera is above the surface.

## Run

```sh
npm install
npm run dev
```

Open current Chrome or Edge with WebGPU and hardware acceleration enabled.

## Controls

- **Click the water:** cast. The splash sends a panic wave through the school.
- **Click the gold “FISH ON!” button / water, or press Space during a bite:** set the hook. You have 3.25 seconds to react, with a countdown, a bobber locator and an audible bite cue. The fish is reeled into the boat, and the counter goes up.
- **Click the water while the line is in:** reel in and recast.
- **Sound** (dock, `S`): mute / unmute. Layered foley effects start after your first click or keypress; there are no audio downloads.
- **Camera:** drag / scroll / right-drag to orbit / zoom / pan. Casting keeps your framing in place. The camera and its orbit target never go below the seabed: an orbit, zoom or pan that would dig in rides along the ground instead (0.6 units of clearance).
- **Frame** `H`: hide / restore controls for a clean recording or thumbnail.
- **Behaviour dock** (bottom):
  - **Milling** `M`, with a direction flip `D`.
  - **Fountain** `F`: sends the predator through the school.
  - **Flash** `X`: flash expansion at the school centre.
  - **Slow-mo** `T`.
  - **Auto-fish** `A`: hands-free casting and hooking, for recording.
- **Lure cam:** a picture-in-picture view while fishing, in the lower left on desktop and beneath the header on mobile.
  - It chases the cast in flight, goes underwater for the scatter and the curious fish, and zooms in tight on the bite and the reel-in.
  - While it is visible the water reflection falls back to the sky, which keeps the second view cheap.
- **Fountain from the line:** reeling in or recasting drags the lure fast underwater. The school splits around it, like it does for the predator.
  - **Camera** (top of the panel): min / max orbit distance (defaults 1 / 35), highest and lowest view angle (degrees from straight down; defaults 1 / 112), field of view, a live readout of the current distance and angle, and **Copy framing** (position, target and limits as JSON).
  - **School → Roaming** (top right): fish count (reloads with `?fish=N`), **schools** (number of sub-schools, 1–6, live; `?schools=`; fish *i* belongs to school *i* mod N and the schools are spaced evenly around the loop), roam radius of the loop (default 9, `?roam=`), *Loop wobble*, *Route speed u/s*, centre drift, group spread, school size, how strongly fish stick to their group, and **swim area** (half-size of the square the fish may use, live, default 20.4; `?area=`). Fish start as three formed schools where their roaming paths begin, already swimming along them.
  - **Tuning** (top right, collapsed): flocking, milling, fountain, panic, lure, look, fishing and world settings. It stays in sync with the dock.

### URL switches

| Param | Effect |
| --- | --- |
| `?fish=32768` | School size (256 … 262144, default 4,096 flying fish). Buffers are fixed at boot. |
| `?autofish` | Start in auto-fish mode. |
| `?flyDemo` | Many more flying-fish take-offs (ambient rate 0.14 instead of 0.018), for watching and screenshots. |
| `?clean` | Hide the overlays; press H to bring them back. |
| `?milling=1` | Start milling. |
| `?fishDemo=milling\|fountain\|panic\|flash` | Force a behaviour (panic re-triggers every few seconds). |
| `?fishCam=close\|mid\|top\|x,y,z`, `?cam=side\|top\|close\|under\|island\|inside…`, `?fishingCam=boat\|cast` | Debug cameras. |
| `?sun=azimuth,elevation` | Override the moon (the directional light keeps its historical name). |
| `?off=horizon,plankton,flora,bubbles,reflect,water,terrain,caustics,ripples,splash` | Switch features off for profiling. |
| `?roam=11` / `?lod0=2.8` | Start with a wider roam radius / a different LOD0 distance. |
| `?props` | Bring back the floating driftwood from the daytime version. |

## Architecture

`src/main.ts` wires the world, school and fishing modules through the interfaces in `src/contracts.ts`. `src/ui.ts` provides the behaviour dock, tuning panel and keyboard-only clean framing. The shared constants live in `src/config.ts`: a 72 × 72 area (the detailed seabed, plants and the fish's outer bounds; the sea itself continues into the fog), nominal seabed at y = 1.6, water surface at y = 10.8. The shared uniforms live in `src/state.ts`: `simTime`, `sunDirection`, `waterLevel`.

### `src/fish` — the school (GPGPU + instancing)

- **Geometry** (`flyingfish.ts`, `geometry.ts`)
  - The school is **cá chuồn** (four-winged flying fish): a long rounded torpedo with a blunt head and big eyes, huge pectoral wings rooted high behind the gills, a smaller pelvic pair under the belly, low dorsal/anal fins set far back and a deeply forked tail with the longer lower lobe.
  - The wings are modelled spread. In the vertex stage each fan closes like a real fin (its rays swing back to lie along the flank, following the body wave) according to the per-fish `airSpread` from the sim: folded while swimming, opening into a glide in the air, with a faint tremble.
  - Three matching meshes contain 184 triangles at normal distance, 880 for close-ups and 56 for shadows.
  - A travelling body bend is baked into 32 frames of positions and normals in a **vertex animation texture**. There is no per-fish CPU animation.
  - The predator is a procedural mahi-mahi / dorado (`dorado.ts`), the classic flying-fish hunter, with an anglerfish-style lure: a swaying rod from the head ending in a pulsing cyan bulb with a refracted halo that also lights nearby fish (`state.predatorLure`). Body: steep forehead, a dorsal fin running the length of the back, deeply forked tail, gold flanks with dark spots under a blue-green back, ~2,500 triangles and a slower, more powerful 48-frame swim.
- **Simulation** (`sim.ts`). All TSL compute, with no per-fish CPU work. Each frame:
  1. clear the uniform grid;
  2. insert each fish into fixed-capacity cells with `atomicAdd`;
  3. pick a strike candidate with `atomicMin` on a packed distance/index key;
  4. simulate by scanning the 27 neighbouring cells with a capped neighbour count;
  5. gather stats about every 100 ms, read back asynchronously.

  The simulate pass handles:
  - classic boids: separation, alignment and cohesion, with persistent filtered acceleration, a real angular turn limit and a pitch limit;
  - soft walls, the water ceiling and terrain avoidance from the world's height field;
  - wandering sub-group attractors, plus these behaviours:
    - **Milling:** a tangential drive around a vertical axis, a radial spring to the ring radius and a vertical band. The result is a rotating torus with a hollow core.
    - **Fountain effect:** fish ahead of and beside the predator steer perpendicular to its heading and backwards. The school opens around it and closes behind it.
    - **Flash expansion:** an expanding spherical wavefront sets fear and a radial burst. Fear also jumps fish-to-fish through neighbours after a short random delay. A brief metallic flank glint at the front makes a visible ring of flashing fish. Fear decays and the school regroups.
    - **Curiosity & bite:** a small hashed subset of "bold" fish inspects the lure. `strike()` sends the nearest inspector at it, and the hooked fish’s animated mouth stays pinned to the rig’s metal hook tip until `land()`.
    - **Airborne (flying fish):** a negative `aux.w` (−1 − seconds since launch, minus a further 500 once it has broken the surface) marks a fish in flight; it stays out of the neighbour grid and can't be picked for a bite. Only the "flyers" (30% of fish, by hash) in the top 3.5 units take off.
      - **Ambient launches** are rare. 3 × 3-unit surface columns switch on now and then, on staggered 7-second windows (`airRate`, School → Flying fish → *Ambient flights*, default 0.076); their entry splashes are scaled by School → Flying fish → *Splash* (default 2.5), and only about 12% of the flyers in an active column join in. The result is single fish or small bursts.
      - **Frightened launches:** frightened flyers also take off (`airPanic`).
      - **Flight:** a steep underwater run-up with fast tail beats, then an exit at 15–30° and ~5 u/s. The arc follows gravity 3.4 plus a lift ∝ horizontal speed² while the wings are spread, light drag and a slow heading drift. Flights last about 1–3 seconds, reach up to about 2 units above the water and travel 6–12 units. Fish re-enter by diving in and rejoining the school.
      - **Continuous transitions:** nothing is snapped. The run-up turns the current velocity toward the surface over ~0.4 s, the breach only blends it toward the exit angle, and re-entry keeps position and heading (20% speed lost on impact, then the swim steering slows and levels the fish). The wings open over ~0.3 s once clear of the water and fold as it touches down. Measured over 25 flights: no position jumps, median direction change 0.6°/frame, worst 6.6°.
      - **Wings:** `airSpread()` (sim.ts) gives the vertex stage the wing spread, eased open above the water and folded as the fish touches down.
      - **Splashes:** a small pass after the simulation compares each fish's state snapshot with the new state. On a breach or a re-entry it writes `(x, z, clock, ±strength)` into a 48-slot GPU ring buffer. `splash.ts` throws 48 real-sized droplets per slot (a crown off the crater rim and a steeper fine spray) on ballistic arcs from the still water level; the water's own ripples make the rings.
      - **Tuning:** the controls are under **Tuning → School → Flying fish**.
- **Rendering** (`render.ts`, `lod.ts`)
  - GPU frustum culling and two compacted index lists feed indirect instanced draws. The detailed mesh is used within 15 units of either camera (School → LOD0 distance; close views can put ~11k fish on it, and adaptive resolution then trades pixels to hold frame rate); other fish use the 152-triangle mesh (wings as 3-ray fans). The vertex shader orients each fish from its velocity, with banking and per-fish size and tint variation.
  - Stable size scales span 0.6–1.85, weighted toward small and medium fish. Normal, close-up and shadow meshes share each fish's scale, including its hooked mouth position.
  - Fish have a base length of 0.60 world units (54% larger than the previous 0.39), with juvenile/adult size variation, broad dark backs, silver flanks and restrained ambient sheen so the body remains readable between alarm flashes. Milling uses a tighter ring; the default camera is closer and aims at the water's centre.
  - The swim animation is interpolated from the VAT. Tail-beat rate follows speed and fear.
  - Night look, no emissive neon: real shine. A deep cobalt back over reflective silver flanks and a white belly, metallic specular highlights from the moon and lantern, a faint thin-film iridescence at grazing angles, and a subtle procedural scale pattern that breaks up the reflection. Wings and fins are dark blue-grey membranes with fine paler rays, faintly translucent when backlit by the lantern. Big glossy dark eyes with a silver ring and a wet catchlight. The alarm flash reads as a silver flash.
  - Airborne fish get a rim light from the lantern and the moon against the fog, and their thin wings glow through when backlit by the lantern; out of the water the lantern's unabsorbed light is scaled back to the underwater exposure.
  - The fragment shader adds depth tint, the lantern's light (with water absorption), soft moon glints and the alarm flash.
  - Shadows come from a 56-triangle proxy on layer 3, which only the moon's shadow camera renders.
- **Predator** (`predator.ts`, `dorado.ts`): a 2.3-unit dorado, simulated on the CPU. Each charge homes in on the centre (the milling ring's, or the school's), locks its heading once on course and runs straight on until it is well past the far side: while milling it pierces the near wall, crosses the hollow and bursts out through the far wall. It cruises, then charges through the school centroid.

### `src/scene` — the open sea

- **Terrain** (`field.ts`, `terrain.ts`, `flora.ts`)
  - A single analytic height field drives the Poisson/Delaunay seabed under the action and the fish avoidance grid. There is no island: a gentle bowl under the basin, a raised rim and five lumpy reef mounds (`REEFS`). `buildOuterSeabed` continues the same field on a grid whose cells widen out to 150 units, so the floor never ends where you can see it (inner vertices tuck under the detailed mesh).
  - **Glow algae:** eleven clusters (cyan, green and blue, with pink and purple ones) of luminous fronds whose light runs up in slow waves, carpets of twinkling grape-algae beads, and a soft additive light pool on the sand under each cluster. Soft camera-facing halos around every frond tip and bead, pulsing with their source, act as a local bloom, so the algae glow without raising the global bloom. All of it is drawn before the water, so it is refracted like the rest.
  - Additive glow drawn before the water uses `glowBlending` (`src/lib/blending.ts`): it adds light but leaves the scene's alpha untouched. Plain additive blending pushed alpha above 1 and the water's `rgb / a` un-premultiply then showed glows from above with dark discs and rims.
  - Night flora: dark seagrass and kelp whose tips carry a slow bioluminescent pulse travelling up the frond; fluorescent coral gardens (magenta, violet, orange, teal, yellow) on every reef mound, with breathing polyp dots; dark boulders. Seagrass is capped at 15% of local depth and kelp at 25%.
- **Horizon** (`horizon.ts`): three closed rings of flat ridged-noise mountain silhouettes at 105, 165 and 245 units, with a hairline of moonlight on crests facing the moon; six distant boats (dark hull, mast, warm lantern) bobbing on the CPU wave mirror. Their lanterns reflect in the water (layer 1) and feed the fog's halos.
- **Water** (`water.ts`, `src/lib/ocean.ts`)
  - Eight calm, mostly onshore swells form moving beat groups under a two-dimensional envelope, plus 16 splash-ripple slots (6 gameplay, 2 ambient, 8 flying-fish). Eighteen dispersed short-wave modes supply height-derived slopes, modulated by drifting gusts and calmer slicks. Pixel-footprint filtering removes unresolved modes and transfers their variance to reflection roughness. A CPU mirror includes the envelope gradients, so the boats bob exactly on the surface.
  - Top-surface absorption follows a Snell-refracted ray to the heightfield with two refinements; nearer fish and rocks shorten the path. Screen-space refraction stays conservative and rejects mismatched depth layers. Missing floor pixels blend into a continuation sharing the terrain’s sand, submerged tint and caustic shading, so the cropped seabed does not draw a dark or flat-colored shape on the surface. Exact dielectric Fresnel and filtered GGX reflection give a continuous sheen through an orbit.
  - God rays use a shared, animated surface aperture integrated through the volume (12 steps in the overview, 32 when immersed). Two independently drifting, warped opening masks replace the fixed underwater cone meshes. Thresholding before mip generation preserves dark gaps as light softens with depth. Snell refraction bends sunlight downward; terrain and the boat occlude it, and forward scattering emphasizes views toward the light. Only a faint animated haze remains above water. The planar reflection (layer 1 only) is suspended when submerged.
  - **Splash ripples** (`src/lib/ocean.ts`): each splash is a dispersive gravity–capillary wave train, ω² = g·k + T·k³ with T placing the minimum phase speed near λ ≈ 0.35. Five components (λ 2.2, 1.4, 0.85, 0.22, 0.1) travel as Gaussian packets at their own group velocity: long gravity rings lead the slow middle band, and fine capillaries run ahead as a fringe. Packets spread with energy conserved and have staggered onsets, viscous damping grows with k, and an impact cavity collapses in ~0.16 s. Gradients are analytic, unresolved components fade with the pixel footprint, and only components ≥ 0.3 units displace the vertex grid. Each component is evaluated only inside its own packet, so pixels away from a splash pay just a distance test; shared terms are explicit shader variables, because sibling branches otherwise read out-of-scope values (black rings). The CPU mirror matches for the boats. Fish breaches and re-entries are read back from the GPU sim about every 100 ms and emitted phase-corrected for the readback latency, reusing the oldest fish slot. `?off=ripples` disables them for profiling.
  - Open sea: the surface grid is centred on the scene with ~0.3-unit spacing out to 45 units, then stretches radially to ~200 where the fog has swallowed it; underwater it re-centres on the camera. There are no cut faces any more.
  - The raft floats on the surface, so nothing is cut out of the water; the hull ellipse still drives the contact foam and the shaft shadow.
  - The lantern adds a warm glitter path (its own GGX half vector on the wave normals), a disc seen through Snell's window from below, and a volumetric glow under the boat, broken into rays by tracing each sample back through the moving surface openings.
  - Coincident compressed crests generate restrained whitecaps; recent crest history leaves fading bubbly trails. `foam.ts` adds moving contact foam around the raft. The planar reflector follows the waterline (it mirrors the raft, the fisherman and the lantern), and its transparent portions fall back to the night sky: a deep blue dome, the moon with its halo, sparse stars and thin cloud veils. Footprint-filtered detail and soft GGX moon highlights keep the surface coherent.
  - The refraction, spectral filtering and gust/slick separation were informed by [Tidewater’s water renderer](https://github.com/dgreenheck/tidewater/tree/main/src/ocean), implemented here in TSL. This retains the analytic CPU/GPU swell mirror rather than importing its four-cascade FFT engine.
- **Lighting and post** (`lighting.ts`, `night.ts`, `atmosphere.ts`, `particles.ts`, `post.ts`)
  - Cool, dim moonlight (directional, 252° azimuth / 7.5° elevation, low over the ridges in the default view, so its path glitters on the water) with a 2048 shadow map, a blue hemisphere fill, and a procedural equirectangular night HDRI (`createNightEnvironment`: the same dome, moon disc, halo and stars as the reflection sky) as `scene.environment`.
  - The lantern is two things: a real `PointLight` for the raft and the fisherman, and `lanternLight()` for everything underwater (terrain, flora, fish, plankton). Underwater materials use a moon-only `lightsNode` so the lantern is not counted twice; `lanternLight()` adds a softened inverse square, a slanted path through the water with mild absorption, and a steep-entry cone so the light pools under the lamp. The lantern makes no caustics (they rode along with the boat). Instead `moonCaustic()` is global and faked like the shafts: each seabed point is traced back along the refracted moonlight to the surface, the shared Worley caustic network is evaluated there, and the same moving surface openings that carve the moon shafts brighten or starve it, so caustic patches sit where the rays land; a base layer of the network shows everywhere (40%) and the shaft openings brighten it (`moonCausticGain` 0.9, World → Night lights → *moon caustic gain*).
  - 2,200 plankton motes: dim specks, a third of which flare cyan-green now and then, warm near the lantern. Two bubble streams reflect the night sky.
  - Screen-space refraction fades its offset to zero within 4% of the screen border (a lookup clamped to the last row used to smear into vertical streaks along the bottom edge).
  - **Surface crossings are stall-free.** The water surface has one mesh per variant (planar reflection above water; analytic sky + depth writes underwater; analytic sky for the lure cam), all compiled during the first frames and switched by visibility. Rebuilding the graph, toggling `depthWrite` or swapping materials each re-ran three's per-object setup. The lights are also on the reflection camera's layer 1: otherwise its pass saw an empty light set, the scene's light cache key flipped whenever the reflection started or stopped, and every material using the scene lights (water, bubbles, splashes, plankton) was rebuilt. A crossing used to stall ~360 ms; it is now an ordinary ~18 ms frame.
  - **Fog** (`post.ts`, parameters in `horizon.ts`): for the part of every ray that travels through air (it stops at the water plane; the water shader owns everything below), an exponential height fog sitting on the water is integrated analytically, plus a thin distance haze that separates the mountain rings. Empty pixels get the night sky (moon disc, halo, stars) above the water plane and fog below it. Light scattered by the fog around the boat lantern and every distant lantern uses the closed-form integral of a point light along the ray, softened over a few units, so the glows read as volumetric. The reflection sky fades into the same fog colour at the horizon.
  - The output is opaque (the page backdrop only shows while loading). Bloom defaults to 0.2. Underwater, an ink-blue medium, faint moon shafts and the lantern's glow fan replace the daylight veil.
  - Lantern strength is in **Tuning → World → Night lights**. **Tuning → Fog & volumetrics** has an on/off switch and, above the water, density, height falloff, distance haze, colour, moon glow, the boat lantern's halo and the distant lanterns' halos; under the water, the lantern's light beam, the moon shafts and the murk.
  - Resolution scales down after sustained low frame rates, then recovers gradually; fish counts and behaviour stay intact.

### `src/fishing` — boat, fisherman, game

- **Boat and fisherman** (`boat.ts`, `fisherman.ts`, `build.ts`)
  - A procedural Li River–style bamboo raft that floats on the CPU wave mirror: nine lashed poles sweeping up at the bow, cross poles with rope lashings, a punting pole, a stool, a woven fish creel (where catches land) and a bamboo pole arching over the starboard bow.
  - The paper lantern (ribbed, glowing paper between lacquered caps, with a red tassel) hangs from the pole as a damped pendulum driven by the raft's rocking and kicks, and flickers like a candle. Its world position and flicker drive `state.lanternPosition` / `lanternPower` every frame.
  - A low-poly fisherman with 2-bone arm IK, an indigo jacket and a conical straw hat, seated on the stool. His poses: wind-up, whip, wait, lean on the bite, hook jerk, reel, cheer, shrug.
- **Rod and line** (`rig.ts`): a tapered rod that bends with tension. The line is a camera-facing ribbon: a ballistic arc in flight, a catenary sag once in the water. It also draws the bobber and the lure.
- **Splash effects** (`fx.ts`, `src/lib/droplets.ts`): no flat foam rings, discs or crown sheets; the rings come from the water's dispersive ripples. A splash is up to ~350 real-sized droplets (radius ≈ 0.4–2.5 mm; steep power-law sizes, mostly tiny) on CPU ballistics with size-dependent air drag. It has three parts: a crown torn off the crater rim at 40–70°, a steep fine spray, and for strong impacts a late jet of heavier drops shot up as the crater collapses. Bigger drops that fall back make their own small ripples; the lure drips while it is lifted.
  - Droplets are drawn as 1/90 s motion-blurred streaks (bright head, fading tail) at least ~2 px wide, with brightness scaled by the fraction of that footprint the drop really covers, so far drops stay faint points. They are mostly dim, cool and translucent, and only a few catch a lantern or moon glint at any moment. `?off=splash` hides all splash droplets for profiling.
- **Game loop** (`game.ts`): a pure state machine, `idle → casting → scared → calm → curious → approaching → bite → reeling → celebrate`, with `missed` and `retrieving` branches. All timers use simulation time.
- **HUD** (`hud.ts`): caught counter, status, fixed clickable hook countdown and a separate bobber locator.
- **Audio** (`audio.ts`): Offline-generated water, wood, line-tension and metal foley, four takes per cue, subtle playback variation, stereo positioning, soft early reflections, and a master mute. Going underwater no longer changes the sound.
- `mock-school.ts` stands in for the GPU school when it's absent (`count === 0`).

## Fish inspector

`/fish.html` shows a single cá chuồn with the real school shader, meshes and night lighting: pick the sheen variant, the mesh (near, normal, shadow proxy, with live triangle counts), wing spread, airborne (above the water), size, tail beat or a paused pose, bank, alarm flash, depth and lantern. **Parts view** colours body, belly band, neon stripe, fins and eyes (with optional wireframe). View presets (side, top, below, nose, tail, 3/4) and **Copy view + settings** give a precise reference for notes. URL switches: `?variant=violet&mesh=normal&wings=1&airborne&parts&wireframe&pause&view=top`.

## Tools

- `node tools/shot.mjs <url> <out.png> [waitMs]` renders the running dev server in headless WebGPU Chrome. It prints `window.school` (fps, draw calls, triangles, school stats) and any console errors.
- `node tools/fishing-seq.mjs <url> <prefix>` drives a full cast → bite → catch cycle and screenshots each stage.

### Performance notes

The simulation runs on the GPU and fish use instancing, GPU frustum culling and two compacted indirect draw lists. Instancing still multiplies vertex work; the procedural tetras keep the normal school at about 3.01 million triangles for all 16,384 fish, with the 880-triangle mesh reserved for fish within 2.8 units of either camera. The population is twice the previous 8,192-fish school; adaptive resolution can reduce pixel work while retaining the full population.

The school begins spread across navigable water, with random swimming headings and terrain-safe depths. Gentle attractors guide broad travelling groups with changing density. Milling activates only through its button, keyboard shortcut or explicit URL switch; it has no automatic schedule. Distributed swimming lanes follow terrain clearance. Grid estimates preserve the true cell population even when the index list fills. Persistent acceleration filtering and a heading limit smooth normal swimming while preserving faster escape turns. The animated mouth is pinned to the metal hook tip; unhooked fish clear the lure during a bite so the catch stays readable.
Grid clear, insertion and simulation dispatches share a compute submission; LOD reset/culling and statistics are also batched. Water geometry is reduced from 247,808 to 73,728 surface triangles, and the cutaway volume raymarch uses twelve samples. The shadow map uses a quarter of the previous pixels.

Use `?debug` for asynchronous GPU render/compute timings in `window.school`. `window.fishDebug.lodStats` reports visible near/far counts and the actual school triangle count for one view. Three's generic `window.school.triangles` counter uses maximum instance capacity for indirect draws and can substantially overstate the triangles actually drawn; it also includes other scene passes. FPS and timings depend on hardware, resolution and camera placement; the integration verifier reports frame timing for the current scene after warm-up.

`node tools/verify-experience.mjs http://127.0.0.1:5188` checks the real WebGPU school, metal hook attachment, late keyboard hooks, touch/button hooks, catch/miss/retry, synthesized audio output, mute, school controls, mobile prompt bounds, adaptive resolution, and browser errors. Its audio output is silent while it analyses the real mix. It writes review screenshots under `/tmp/aquarium-verified-*.png`.

## Legacy

The previous episode (glass aquarium, Voronoi & Delaunay, and its Lab) lives in `legacy/` for reference. The Lab for this episode will come later.

## Environment

The night environment is generated procedurally at boot (`src/scene/night.ts`); no HDRI is downloaded. `public/hdri/sky.hdr` ([Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), Poly Haven, CC0) is from the daytime version and is no longer loaded.
