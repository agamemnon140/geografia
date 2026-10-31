# geografia: a physically-constrained world-map simulator

Status: design agreed on 2026-10-30, before any code. This file is the source of truth for scope and model decisions. Update it when a decision changes.

## 1. Purpose

A playful exploration tool: generate planets from a small set of physical parameters and see relief, hydrology and climate that follow from geological and geographic constraints (plate tectonics, atmospheric and ocean circulation, ice, volcanism). Emphasis is on the simulator, not on visuals.

Two requirements shape everything:

- Every parameter must have a traceable causal path to the output. A parameter without one is noise and misleads.
- Same parameters, different seeds must yield different planets with comparable statistics. The build is fully deterministic given (parameters, seed).

The validation target is "Earth-like statistics for the Earth preset", never reproducing Earth's actual map.

## 2. Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Goal | Causal exploration with a playful bias | Physics must be explainable; results must be fun to compare |
| 2 | Spatial model | Geodesic sphere: subdivided icosahedron, hex cells, dual-grid neighbors | Equal-area cells, no polar singularity; "planet radius" only means something on a sphere |
| 3 | Time | Internal history, exposed snapshot; state is step-able and serializable for a future timeline | One-click build now; timeline later without a rewrite |
| 4 | Tectonics | Rigid plates with Euler poles, crust state per cell, fixed plate count | Cortial et al. 2019 / PlaTec style; proven feasible; gives relief a history |
| 5 | Climate | Physical latitude bands + advection; every link explainable | Cheap and causal; an energy-balance model can replace the temperature link in phase 2 |
| 6 | Parameters | Physical core (10) + named presets | Each has a causal path; presets make exploration playful |
| 7 | Stack | TypeScript + Vite, sim in a Web Worker, Canvas 2D, Vitest | One-click app; fast per-cell loops; shareable; numerics identical to numpy (float64) |
| 8 | Budget | Constant cell area (~110 km), level 6 for Earth (40,962 cells), cap at level 7; Earth build < 10 s, level-5 preview < 2 s | Radius changes how many plates and circulation cells fit |
| 9 | Output | Equirectangular map with toggleable layers + per-cell "explain" inspector | Causal exploration needs "why is this cell like this" |
| 10 | Comparison | "New variation" keeps params and changes the seed; gallery of thumbnails with per-world statistics | Separates parameter effects (stable stats) from seed luck |
| 11 | Validation | Automated tests per physical link with the Earth preset + invariants | Prevents regressions when tuning constants |
| 12 | Delivery | Milestones by link: grid, tectonics, hydrology, temperature/winds, moisture/currents, ice/biomes/UX | Each link validated before the next depends on it |
| 13 | Seasons | 12 solar-declination samples per year, thermal inertia (ocean slow, land fast) | Real Koppen classes, monsoons emerge, axial tilt visibly matters |
| 14 | Rivers | In v1: flow routing, lakes, fluvial erosion inside the tectonic loop | Drainage is a visible constraint and shapes valleys |
| 15 | Language | Code, docs, commits and UI all in English | Ecosystem convention |
| 16 | Repo | git in this folder, package name `geografia`, one commit per milestone | Compare model versions |
| 17 | Hydrology/climate coupling | Cheap precipitation proxy inside the loop every K steps; full climate once on the final state; final rivers use real precipitation | Loop stays fast; displayed rivers match displayed climate |

## 3. Model

### 3.1 Grid

- Icosahedron subdivided L times (class I geodesic). Cells are the vertices (dual hex/pentagon tiles): count = 10 * 4^L + 2. L=5: 10,242; L=6: 40,962; L=7: 163,842.
- L is chosen so cell area is about the Earth level-6 cell area (~12,450 km^2): L = round(log4(4 * pi * R^2 / (10 * A0))), clamped to [4, 7].
- Per cell: unit vector, lat/lon, area, 5 or 6 neighbor ids (sorted counter-clockwise), neighbor distances. Built once and cached per L.
- Rendering projects cells to equirectangular (later any projection) at draw time. The sim never sees pixels.

### 3.2 Randomness and determinism

- One seeded PRNG (xoshiro128**) derived from the seed. Sub-streams per module (plates, hotspots, noise) derived by hashing, so adding randomness to one module does not change another.
- `Float64Array` everywhere. No `Math.random`. Fixed iteration order. Same (params, seed) gives byte-identical arrays in the same engine.

### 3.3 Tectonics (loop of `age` steps)

State per cell: plateId, crustType (oceanic/continental), thickness, age, elevationBase, lastOrogenyStep, volcanic.
Per plate: Euler pole (axis + angular rate), slow random walk of the pole every N steps.

Per step:

1. Advect crust: each plate rotates; cells sample crust from the plate's inverse-rotated position (nearest cell).
2. Classify boundaries from relative velocity at plate edges: divergent, convergent, transform.
3. Divergent: fill the gap with new oceanic crust (age 0, thin). Ridges: young crust sits high by thermal subsidence.
4. Convergent: oceanic vs anything, the oceanic side subducts; trench on the subducting side, volcanic arc on the overriding side at a fixed distance. Continental vs continental: crust thickens on both sides (orogeny), elevation rises, lastOrogenyStep updated.
5. Transform: shear only, no vertical change.
6. Hotspots: fixed points in the mantle frame; cells passing over get volcanic thickening, producing island chains.
7. Isostasy: elevation = f(thickness, density by crustType); the isostatic height itself is independent of gravity (a density ratio), but the maximum crust thickness the lithosphere can hold scales with 1/g, so a heavier planet gets lower mountains. Oceanic crust subsides with age (depth proportional to sqrt(age)). Volcanic and sediment additions sit partly uncompensated and raise the surface more per km than compensated crust.
8. Erosion: thermal (slope diffusion) every step; fluvial every K steps (see 3.4), stronger on young and high relief.

Sea level is solved each step as the elevation where the cumulative area below equals the water volume.

Mechanisms added while calibrating M2 (all in `tectonics/crust.ts` with their justification):

- Crust is stored in plate frames as parcels; the world map is a view, so resampling never creates or destroys material. Overlaps that are not converging (transform sliding) are hidden, not consumed; a parcel stranded with no neighbor of its own plate is consumed whatever its velocity.
- Continental rifting: before sea-floor spreading, a gap next to continental crust takes half of the margin's thickness as thinned continental crust, so rifted margins are gradual. Initial passive margins start stretched (16 to 30 km over four cells) to give shelves and slopes.
- Continental collision thickens the suture cell and its neighbors, crust above 45 km flows toward thinner neighbors (plateau building), and a hard cap of 70 km / g pushes excess outward, accreting oceanic neighbors. Both colliding plates brake per event and slowly regain speed through the pole random walk (new subduction elsewhere).
- Thin continental slivers (< 20 km) behave as oceanic crust in collisions. Volcanic piles cap at 10 km and basins at 10 km of sediment. Volcanic rock erodes first, then crust (continental) or sediment (oceanic).
- (M2 to M11) About a third of the plates were seeded without continental crust and continents were biased toward plate interiors; the initial condition below replaced this.

Calibration status after M2 (Earth preset, three seeds): ocean 64 to 69%, continental crust 36 to 39%, highest point 8.9 to 10.8 km, mean ocean depth 3.8 to 4.1 km, continental volume conserved within 3%, build 1.5 s. Known deviations: mean land elevation 1.5 km (Earth 0.84 km) and 15 to 24% of the surface above 1.5 km (Earth about 6%), because only thermal erosion exists so far; fluvial erosion in M3 is the physical fix. Plate speeds decay to 0.05 to 0.2 cells per step by step 200 under the collision brake; revisit when rifting of plates arrives in phase 2.

The initial condition (revised in M12, then in M13; `tectonics/genesis.ts`). The noise-blob start of M2 gave every plate a round continent of similar size ("medium potatoes") with jagged boundaries and blotchy mountains. M12 replaced it with a triple junction of wide rifts between Voronoi wedges, which still started the planet as nine landmasses and ended it with six to ten of similar size, convex, separated by seaways that collisions never closed. The planet now starts as a Pangea and earns its shapes from its history:

- One connected supercontinent holds nearly all the continental crust: a gaussian ellipse (0.9 rad, aspect ratio 1.2 to 1.8) plus low-frequency lobes (amplitude 0.3 at frequency 0.8, three octaves), thresholded at the quantile that gives 40% continental crust, with connected fragments under 3% of that crust dropped and the threshold lowered to make up for them, so nothing starts as scattered islands. With probability 0.6 a far microcontinent (an India, a gaussian of 0.35 rad) travels alone.
- One rift has just split it along a line that is a great circle only at the largest scale (`tectonics/riftpath.ts`): bent by 500 km at a wavelength of about 3000 km and offset by transform faults every 1500 to 2500 km, like the equatorial Atlantic's stair-steps, so the two coasts are complementary without being straight and the continents they bound are not convex. The young ocean along it is V-shaped: closed at the hinge, 2 to 5 cells of half-width at the far end, sea floor aging from zero on the axis to 15 to 40 steps at the edge. With probability 0.7 a third arm has failed (an aulacogen, the Benue Trough under the Gulf of Guinea): a flooded trough of 19 to 30 km crust, 6 to 14 cells long, notching the coast.
- Margins facing the young ocean are passive and wide (16, 20, 24, 27 and 30 km over five cells); those facing the old ocean are active and narrow (22, 27, 31 km over three). The interior thickness varies by 4 km at the thousand-kilometer scale (shields and basins; the deepest basins flood into inland seas). The old ocean's floor averages 50 steps of age.
- Plates: the two sides of the rift; the traveler; a strip of one to three cells of sea floor along every coast rides with its continent, so the subduction zone sits offshore (Pangea's exterior was all active margin); the rest of the ocean is a warped weighted Voronoi of free seeds kept five cells from any coast. The two sides open about a pole 10 degrees beyond the hinge; oceanic plates point half their motion at the core (Panthalassa converging on Pangea); the traveler heads for the supercontinent half the time.
- Standard 35 km crust sits at +250 m in the frame where ridge crests are -2500 m and old sea floor near -5500 m, Earth's own; the sea is solved from the water volume and comes out between -50 and -300 m, so cratons stand 300 to 550 m above it.

Driving forces and events revised in M13 (`tectonics/simulation.ts`), so that the history resembles Earth's:

- Slab pull, the dominant plate-driving force: each step, a plate's Euler vector relaxes by 3% toward the rotation that carries its subducting oceanic cells into their trench (the rotation moving a point x along a tangent n is x cross n, summed over the trench), at 0.35 cells per step once the trench is 30 cells long. Buoyant continental crust being underthrust pulls nothing, which is why India slowed. The pole walk's kick was reduced from 0.25 to 0.15 to leave this in charge. Slab pull is what reassembles continents: the ocean between two of them subducts under one and the other is pulled across.
- Rifts: a supercontinent (continental area above 14% of the surface) rifts whether it is locked or not, because it insulates the mantle; the probability per check is 0.15. The rift line is a riftpath (bent, stair-stepped) parallel to a great circle through the continental centroid but shifted by up to 60% of the continent's half-extent, so splits are uneven, as Madagascar's, India's and Greenland's were, and one dominant landmass survives. Four rifts in ten are born to fail: they hinge inside the continent (30 to 60% of the way along it), open a V-shaped gulf beyond the hinge for 10 to 30 steps while squeezing the near side a little, then the child welds back onto the parent (event type `fail`), leaving a Red Sea, a Gulf of California or a North Sea.
- Collisions close seaways: when a continental parcel is consumed, its mass first restores the stretched margins on both sides of the suture to 35 km, thinnest first (basin inversion), and only the rest builds the belt; buoyant continental crust being underthrust gets a 600 m foreland basin instead of the 2500 m trench, so two welded continents are one landmass instead of two blocks with a channel between them.
- Arcs build land: 0.15 km of volcanic rock per subduction event on the overriding cells within one cell of the trench (about 20 km^3 per km of arc per Myr, the low end of Earth's 30 to 90); between two oceanic parcels the one carrying 1 km more volcanic rock overrides, so an arc keeps its polarity instead of flipping cell by cell with the age contrast (which was consuming the arcs as fast as they grew); a parcel with 8 km of arc volcanics becomes buoyant continental crust of the thickness that keeps its surface where it is, so island arcs accrete to whatever they meet (Japan, the Philippines, Central America) and add about 2% of the surface to the continents over 200 steps. Andean orogeny: the continental cells within two cells of a trench shorten by 0.5 km per subducted parcel, shared among them, whether the trench sits on the continent or on the strip of sea floor it carries; the Andes owe their 70 km crust to compression more than to magma.

Calibration status after M13 (Earth preset, seeds 1 to 4, 200 steps): landmasses above a million km^2 3 to 5 (Earth 4 to 7, counting Greenland) with the largest holding 41 to 89% of the land (Earth 57), ocean 66 to 69% (Earth 71), mean land elevation 0.33 to 0.85 km (Earth 0.84 with its ice, about 0.65 without), surface above 1.5 km 1 to 5% (Earth 6 with ice, about 3 without), highest point 7.6 to 9.3 km, mean ocean depth 3.9 to 4.0 km (Earth 3.7), mean temperature 10.7 to 14.8 degrees C, 3 to 5 plate events per run of which one or two are failed rifts, build 6 s. Known deviations: the ocean cover is three to six points low because a compact supercontinent floods only 5 to 6% of the surface as shelf where Earth's dissected continents flood 11% (lowering the continental fraction does not help: the sea falls with it, since the water volume is fixed); one seed in four comes out cold and arid (10.7 degrees C, 52% of the land arid, permanent sea ice on 26% of the ocean), the model's cold bias on polar oceans (3.5) amplified by a geography with little polar land; plate boundaries are still jagged at the cell scale.

Margin events (M14; `tectonics/simulation.ts`). The shapes of Europe and Central America come from small plates and marginal seas, which twelve large plates cannot make; two events now fabricate them:

- Back-arc opening by slab rollback. Old, dense sea floor (70 steps or more, along a trench of 12 cells or more) sinks steeply and its trench retreats. With probability 0.12 per check, the overriding plate's forearc and arc (its cells within three of the trench, cratons of 32 km or more excepted) become a new plate that moves toward the trench at 0.15 to 0.3 cells per step, and a marginal sea opens behind it: thinned margins first, then new sea floor (the Sea of Japan, the Tyrrhenian behind the Apennines, the Caribbean behind the Antilles). The arc keeps consuming the old floor; later it may close its basin and dock again as a terrane. A plate waits 80 steps between margin events, and the planet holds at most 22 plates.
- Sliver capture at sliding coasts. Where a continental coast slides past an oceanic plate (the relative motion within 53 degrees of the coast), with probability 0.15 per check a strip two cells wide along at least eight cells of that coast passes to the oceanic plate, resampled into its frame as in a merger, and travels with it (Baja California on the Pacific plate, the Gulf of California opening behind it). A sliver that meets a continent again docks as a terrane with a suture range.

Calibration status after M14 (Earth preset, seeds 1 to 4, 200 steps): 3 to 8 back-arc openings and 2 to 10 captures per run, 16 to 19 plates alive at the end from 12 at the start; landmasses above a million km^2 2 to 6 with the largest holding 47 to 74% of the land, ocean 64 to 72%, mean land elevation 0.59 to 1.05 km, surface above 1.5 km 2 to 8%, mean temperature 11 to 13.5 degrees C, build 6 to 10 s. The marginal seas, island chains, peninsulas and seaways these events leave are what the maps lacked. The cost is a wider spread between seeds: slivers and arcs that dock again build several plateaus on some planets (seed 4 has 8% of its surface above 1.5 km), and the mean temperature runs a degree or two below Earth's because the extra shelf and marginal sea sit at high latitude as often as not. A longer tectonic age does not converge to fewer pieces: the system cycles (rifts, failures, arcs, dockings), and 400 steps on seed 2 gave seven landmasses, more arcs and more plateaus.

Resolution independence (M18). Every tectonic constant written "in cells" or "per step" now means reference cells of about 112 km (the side of an Earth-level cell, `REFERENCE_CELL_KM` in constants.ts) and steps of one million years, and the simulation converts them to the grid it runs on: speeds in cells per step become angular rates through the reference cell's angle on the planet, not the grid cell's; hop radii (arc, Andean shortening, back-arc strip, sliver), counts (sutures, trench lengths, saturation cells) and areas are scaled by the number of grid cells per reference cell; the per-event arc magma is spread over the footprint so the flux per kilometer of trench stays the same; a hotspot feeds one reference cell's area; explicit diffusion and crustal flow scale with the inverse square of the cell size, within their stability limits; the margin tables are read at the distance in reference cells, interpolated. Level 7 (163,842 cells of 55 km) therefore builds the same planet in kilometers as level 6 to within chaos: for seed 2 at 200 steps, ocean 71% against 70%, mean land 0.55 km against 0.53, in 34 s against 6. The app offers it as a Fine grid option for full builds (preview stays coarse); the real Earth stays at level 6.

Two defects fixed in the same milestone. Plate mergers and sliver captures resample a plate into another frame, and two parcels often land on one target cell because the two lattices never line up; they used to stack, doubling the crust and leaving a field of isolated 5 km peaks after every merger (seed 4183608316 had 346 of them, 319 of them crust at exactly the cap); a parcel that finds its cell taken now moves to the nearest free cell within two rings and stacks only when there is none. And runoff is Budyko's: the share of rain that reaches rivers is (1 + phi^2)^(1/2) - phi with phi the ratio of potential evaporation to precipitation (Fu's form, w = 2 for the open-water potential the climate provides), so deserts send a few percent of their rain to rivers, the Amazon half, and the land mean about 0.35, instead of a flat 40% everywhere that drew rivers across dry interiors and filled their basins with lakes.

Dissected coasts (M17). With M14's small plates the maps had marginal seas and arcs but still nothing as cut up as Europe, whose look comes from three things the model still lacked, each with its own lever:

- A remnant sea between continents that stopped converging (the Mediterranean, the Black Sea). Slab break-off: a plate colliding on three or more continental cells in a step has lost its slab and feels no slab pull; the collision brake then stops it with the seas it had not yet closed still open. The pole walk's relaxation toward the typical speed drops from 10% to 3% per walk (`plates.ts`), so a braked plate stays slow for a hundred steps or more instead of being pushed back to speed.
- Peninsulas that are arcs swinging like doors (Italy and the Tyrrhenian, Japan and its sea). A back-arc opening now hinges at one end of the trench: the arc plate rotates about that end so its far end moves outward at the rollback speed, which leaves a peninsula attached at the hinge and a triangular marginal sea behind it, instead of a parallel strip.
- Low platforms barely above or below the sea (the Baltic, the North Sea, Hudson Bay, the coastal plains). The interior thickness varies by 5 km instead of 4 at the thousand-kilometer scale, and both margin tables gain a 33 km cell (a coastal plain at about sea level), so more of the surface lies within 200 m of the sea, where small differences decide land from water. The near-sea hypsometry moves toward Earth's: of the surface, Earth has 4.1% between -200 and 0 m and 7.7% between 0 and 200 m; seed 2 now has 5.7 and 15.1 (from 3.4 and 10.5), the user's seed 282101170 1.2 and 6.4 (from 1.4 and 4.0).
- Deposition fixed on the way: a delta now fills its water body up to the water surface and no higher, and what does not fit moves to the lowest flooded neighbor. Before, a full mouth cell spilled onto all six neighbors, and the deeper basins of this milestone grew rings of two-kilometer sediment hills around their lakes.

Calibration status after M17 (Earth preset, seeds 2, 3 and 282101170, 200 steps): landmasses above a million km^2 4 to 8 with the largest holding 42 to 84% of the land, ocean 67 to 74%, mean land elevation 0.3 to 0.9 km, surface above 1.5 km 1 to 7%; the maps now show inland seas with islands, boot-shaped peninsulas, remnant seas between continents and marginal seas behind hinged arcs.

Plate births and deaths (phase 2, built in M8; `tectonics/simulation.ts`):

- Every 10 steps the simulation checks each plate. A plate whose speed has stayed below 0.12 cells per step for 40 steps and that shares a continental convergent contact of at least 12 cells with a neighbor merges into that neighbor: its parcels are resampled into the neighbor's frame at their current world positions (two landing on one cell fuse, continental thickness adding up), and the plate is left empty and dead. The brake that locked the pair no longer acts, so the merged continent regains speed through the pole walk.
- A plate whose continental area exceeds 4% of the planet's surface and that has been locked for 20 steps rifts with probability 0.15 per check times the relative mantle heat (M13 revised the line, the hinge and the odds of failure, above): a great circle through its continental centroid with a random strike splits the plate; the parcels on one side become a new plate whose frame starts equal to the parent's (nothing moves at the instant of the split), and the two plates receive opposite halves of a relative Euler vector whose pole sits 10 degrees beyond one end of the continent, so the rift opens along its whole length, fastest at the far end. The existing rifting and sea-floor machinery fills the gap: thinned margins first, then new oceanic crust.
- The mantle heat parameter scales plate speeds by its square root, hotspot volcanism linearly and the rift probability linearly. Births and deaths are recorded as events with their step, so the timeline can show when a supercontinent broke or two continents welded.
- Two M2 rules changed to make this work. The collision brake is now applied per step in proportion to the suture length (3% per step once ten cells collide), instead of per colliding cell, and the pole walk relaxes speeds toward the typical value ten times faster (slab pull elsewhere; M17 cut this back to 3% per walk once slab pull itself was in the model), so only long sutures lock a plate; mean speeds stay at 0.1 to 0.3 cells per step through a 200-step run instead of decaying to the floor. Crust thickened by flow or thrust from a collision belt now carries the orogeny step, so plateaus stay explained after their suture has become plate interior.

Calibration status after M8 (Earth preset, three seeds, 200 steps): 4 to 7 plate events per run, of which 1 to 3 rifts; plates alive at the end 8 to 10 of 13 to 14 ever; ocean 64 to 70%, the hypsometry and conservation tests of M2 unchanged.

### 3.4 Hydrology (every K steps inside the loop, and once on the final state)

- Precipitation proxy inside the loop: latitude band profile times an ocean-proximity decay.
- Flow routing on the hex grid: steepest-descent neighbor; priority-flood fills closed depressions into lakes with an outlet.
- Flow accumulation (upstream area times precipitation) gives discharge.
- Fluvial erosion: stream-power law, elevation lowered proportional to discharge^m * slope^n; simple deposition in lakes and coasts.
- The final pass uses the real precipitation from 3.5 to produce the rivers, lakes and discharge layers.

Mechanisms as built in M3 (`hydrology/` and `tectonics/crust.ts`):

- Precipitation proxy: zonal profile of Earth's land climatology (wet equator, dry near 28 degrees, wet mid-latitudes, dry poles) times an ocean-proximity factor that decays over seven cells to a floor of 25%. Runoff is 40% of precipitation. The same proxy serves every planet until M5, so tilt and rotation do not yet touch the rivers.
- Routing: priority-flood from the ocean with FIFO ties, so each land cell drains to its lowest neighbor on the flooded surface and lake cells drain toward the spill point by the shortest path. Topological order by Kahn's algorithm, discharge by one upstream-first pass. Discharge is in km^3 per year.
- Lakes: each filled depression is a lake. Potential evaporation (2000 mm per year at the equator, falling with the cosine of latitude until M4 brings temperature) is compared with the inflow at the spill level; if evaporation wins, the lake is endorheic: its depression is re-routed by steepest descent into its pits, and the water body shrinks to the lowest cells whose evaporation balances the inflow. Upstream lakes can starve downstream ones, so the balance repeats until stable.
- Fluvial erosion every 5 steps: each land cell loses K * sqrt(discharge) * slope meters, slope measured to the water surface downstream (sea or lake level at a mouth), never more than half the drop. Volcanic rock erodes first, then sediment, then continental crust; eroding crust lowers the surface by only 150 m per km removed (isostatic rebound). The products settle at the river mouth: deltas on the shelf, fills in lakes and closed basins, the rest lost to the deep ocean.
- Every parcel records the surface it has lost to erosion, for the inspector.

Calibration status after M3 (Earth preset, three seeds): mean land elevation 0.99 to 1.08 km (Earth 0.84; was 1.5 after M2), surface above 1.5 km 4 to 7% (was 15 to 24%), ocean 63 to 67%, mean land precipitation 600 to 750 mm per year (Earth about 800), lakes 1 to 2% of the land area, longest river 4,300 to 5,300 km, largest discharge 900 to 2,000 km^3 per year (Congo 1,300, Amazon 6,600), build 2.0 s. Remaining height sits in plateaus of dry interiors, where the proxy gives small rivers; M5's real precipitation and M6's ice decide whether that is right.

### 3.5 Climate (once, on the final relief; 12 declination samples)

1. Insolation per cell per sample from latitude, axial tilt and the insolation factor.
2. Temperature: radiative baseline, minus lapse rate times elevation (lapse rate proportional to g), continentality (distance to ocean), ocean-current correction, thermal inertia across samples (ocean lags more). Produces 12 monthly fields.
3. Circulation: number of cells per hemisphere from radius and rotation (fast rotators get more bands, very slow rotators a single cell). Band edges define surface winds; Coriolis sets deflection sign and strength. A monsoon term comes from seasonal land-sea temperature contrast.
4. Ocean currents: basins found by flood-fill of the ocean; gyres driven by wind bands and bounded by continents; western boundary currents carry warm water poleward, eastern ones cold water equatorward; currents feed back into coastal temperature.
5. Moisture: evaporation over ocean proportional to temperature; advected along winds with decay; orographic lift adds rain and depletes moisture (rain shadow); convergence zones add rain. Produces 12 monthly precipitation fields.
6. Ice: sea ice where sea-surface temperature is below freezing; ice sheets where annual max land temperature is below zero (altitude included). The glacial-phase parameter lowers global temperature and sea level and extends ice. One iteration of albedo feedback.
7. Koppen classification from monthly temperature and precipitation.

Mechanisms as built in M4 (`climate/`):

- Insolation: the exact daily-mean top-of-atmosphere integral per latitude and declination, 12 declination samples on a circular orbit, sample 0 being mid-January-like.
- Temperature: the global mean follows the fourth root of insolation from Earth's 288 K; the annual mean of a cell is the global mean plus 0.17 degrees C per W/m^2 of annual insolation anomaly (meridional transport is implicit in that slope), minus a lapse rate of 6.5 K/km times relative gravity, minus up to 3 degrees of continental cooling. Seasons: the insolation cycle passes through a first-order thermal filter (time constant 1 sample on land, 2.5 on the ocean) and is scaled by a land or ocean response (0.10 or 0.03 degrees per W/m^2), blended by continentality (1 - exp(-distance to the ocean / 4 cells)). Ocean currents (M5) and ice albedo (M6) come later.
- Circulation: the Hadley cell edge is 30 degrees divided by rotation rate and radius relative to Earth (Held-Hou scaling), the number of cells per hemisphere is 90 over that edge, clamped to 1 to 9, and the bands are equal in width. Even cells blow equatorward (easterlies after Coriolis deflection), odd cells poleward (westerlies); the deflection angle is atan(2 * relative rotation * |sin latitude|), 45 degrees at 30 N on Earth and zero for a slow rotator; wind speed peaks at 7 m/s mid-cell and vanishes at the cell edges (convergence and divergence zones). The whole pattern shifts with 35% of the previous sample's declination (the ITCZ migration). A monsoon term adds 2.5 m/s per degree C per cell of the smoothed seasonal temperature anomaly gradient, from cold toward warm, turned by half the Coriolis deflection.

Calibration status after M4 (Earth preset): equator 27 degrees C, poles -13, global mean 12 (Earth 14 to 15; the deficit is the lapse rate on plateaus plus the absence of ocean heat transport to the coasts), seasonal range at 40 to 60 degrees of 23 degrees on land and 7.5 on the ocean (Earth about 25 to 30 and 8). The high-tilt preset makes the poles warmer than the mid-latitudes in the annual mean and doubles the seasonal ranges; the slow rotator gets one meridional cell per hemisphere.

Mechanisms as built in M5 (`climate/ocean.ts`, `climate/moisture.ts`, `climate/multilevel.ts`):

- Ocean currents are solved, not drawn: Stommel's steady linear vorticity balance on the sphere, beta * dPsi/dx + r * laplacian(Psi) = curl(wind stress) / rho, with the transport streamfunction Psi zero on every coast. The wind stress is rho_air * Cd * |w| * w of the annual-mean surface wind with an effective Cd of 2.5e-3; the friction r is set so the western boundary layer r / beta is 2.5 cells wide (and never below 20% of its Earth value, so a non-rotating ocean still has symmetric gyres). The beta term produces western intensification by itself: Gulf-Stream-like poleward currents on the west side of every basin, slow equatorward return flow in the interior, an eastward countercurrent on the equator. Surface velocity is the transport over 100 m, clamped at 2.5 m/s.
- The solve runs coarse to fine over the icosphere levels 4, 5, 6 (7): the subdivision keeps coarse vertex ids, so a coarse solution prolongates exactly and the fine grid only sweeps local detail. On the fine grid alone, basin-scale gyres needed thousands of sweeps.
- Currents carry heat: each ocean cell picks up minus (current dot gradient of annual temperature) over 1e6 s and keeps 80% of the anomaly arriving from upstream along the flow; the anomaly spreads four hops onto the coast at 80% per hop. It is added to every sample of the temperature, so western boundaries warm their coasts and eastern boundaries cool them.
- Moisture is a steady-state column of water vapor per sample: evaporation from open water of 1200 mm per year at 18 degrees C rising 6.5% per degree (Clausius-Clapeyron); first-order upwind transport along the sample's wind plus an eddy diffusivity of 1.5e6 m^2/s standing for the storm tracks; rainout at one over 9 days, faster in cold air, plus the fraction of the column condensed per meter of lift (scale height 2,500 m) where the wind climbs, plus 0.4 s times the wind convergence. Land re-evaporates 60% of its rain (Earth's recycling ratio), folded into the land sink so one linear solve is exact; the discrete fluxes are area-weighted so precipitation equals evaporation over the planet to the solver tolerance. The orographic and convergence shares are stored per cell for the explain mode. Same multilevel solve as the currents.
- The final rivers use this precipitation, and lake evaporation uses the same open-water formula at the cell's annual temperature.

Mechanisms as built in M9 (`climate/ebm.ts`; replaces the banded temperature link of M4 and the ice albedo pass of M6):

- The annual-mean sea-level temperature is the solution of the two-dimensional energy-balance model of North, Cahalan and Coakley (1981) on the sphere: absorbed sunlight Q (1 - albedo) equals the outgoing longwave A + B T plus the divergence of a diffusive transport D laplacian(T), with B = 2.09 W/m^2 per degree and Earth's A = 203.3 W/m^2 and D = 0.6. Solved coarse to fine like the other fields. The global mean is no longer prescribed: it is the area-weighted mean of the solution.
- Albedo: ocean 0.26, land 0.34, ice 0.62 (sea ice by its share of the year), clouds included. The climate iterates the balance with the ice extent it produces until no cell's albedo changes by more than 0.01 (up to five rounds), so a snowball or a hothouse is an outcome of insolation, tilt and the parameters below.
- A carries the forcings: greenhouse strength (20 W/m^2 per e-fold, the logarithmic law of carbon dioxide), pressure broadening (8 W/m^2 per e-fold of surface pressure) and the glacial phase (B times 6 degrees at phase 1). D carries pressure (linearly), rotation (inversely: faster rotation makes smaller eddies) and planet size (per unit angle, inversely with the square of the radius).
- Eccentricity scales each sample's flux by (1 + e cos M)^2 with perihelion at the January-like sample, so the hemispheres get unequal seasons; a thicker atmosphere also lengthens the land's thermal time constant by the square root of the pressure.
- Real precipitation inside the tectonic loop: every 25 steps the full climate runs on a grid two levels coarser (level 4 for Earth), and its annual precipitation and open-water evaporation, prolongated to the fine grid, drive the fluvial passes until the next update. The schedule depends only on the parameters, so a timeline keyframe at step t still equals a build of age t.

Calibration status after M9 (Earth preset): global mean 13 to 15 degrees C, equator 29, poles -14 to -19, ice sheets 6 to 11% of the land, permanent sea ice 7% of the ocean (Earth 3%). Sweeping insolation on a young Earth: 0.8 and 0.9 freeze over (mean -50 and -16, sea ice on 100% and 58% of the ocean), 1.0 is temperate, 1.1 is ice-free at 29 degrees, 1.3 bakes at 53. Greenhouse 3x warms by 14 degrees; air at 0.3 bar gives an 86-degree equator-to-pole contrast; eccentricity 0.2 with perihelion in southern summer expands the northern ice sheets (cool northern summers, the Milankovitch logic). Build 4.0 s.

Revisions in M11, driven by the real Earth (section 3.9):

- The energy balance is solved with Jacobi-preconditioned conjugate gradients (the operator is symmetric positive definite with the mean of the two cells' transport on each edge); the relaxation sweeps used before had left residuals of a hundred W/m^2 once the transport grew.
- Transport is boosted inside the Hadley cell (times 5 at the equator, fading to the cell's edge), standing for the overturning circulation, with the base transport lowered to 0.45. This flattens the tropics as on Earth; the fit to the zonal sea-level profile has a 2.6-degree root-mean-square error, the mid-latitudes staying about 3 degrees too cold (storm tracks and ocean basins, not in the model). A slow rotator's planet-wide Hadley cell makes it nearly isothermal.
- Land albedo 0.30 and ocean 0.27 (vegetated land is barely brighter than cloudy seas). The seasonal response scales with the absorbed share of sunlight relative to bare ground, so ice sheets and frozen seas swing far less than tundra, which is what keeps Antarctica's interior frozen in summer.
- The ice iteration starts cold: the first pass counts as ice anything within 3 degrees of freezing, then lets the feedback melt what cannot sustain itself. Starting bare never formed an ice sheet (hysteresis); Earth is on the icy branch.
- The lapse rate is measured from the atmosphere's reference height, the area-weighted mean surface (sea surface over the ocean), not from the sea level. On Earth the two differ by a few hundred meters; on a land-heavy planet (the ocean-cover parameter at 0.5 puts the sea almost 3 km below the plateaus) measuring from the sea had turned every continent into Tibet and the planet into a snowball. The sea surface of such a planet sits warm below the reference, as a deep basin should. The area-weighted mean surface temperature equals the balance's mean by construction, so Earth's calibration holds.
- Ice sheets, a thickness proxy, may lock at most half of the water inventory, so a glaciated land-heavy planet keeps a sea.

Calibration status after M11 on the real relief: surface mean 14.5 degrees C (Earth 14.5), equator 26.9, Amazon 24 degrees and 2,700 mm, New York 13.0 (12.9 observed), Yakutsk region -12 (-9), Antarctic plateau -44 (-50), land precipitation 990 mm (Earth 800 to 900), ice sheets 15% of the land (10%), permanent sea ice 9% of the ocean (3%), Koppen A 15 / B 26 / C 16 / D 17 / E 26% of the land (Earth 19 / 30 / 14 / 25 / 13). The boreal belt is the largest remaining error: 50 to 70 N land runs 5 to 9 degrees too cold (London 1 degree against 11), so tundra replaces taiga and E grows at D's expense; the subtropical deserts are also too cool (Sahara 14 against 26, clear skies and dry surfaces not being in the balance). Build 5 s standalone.

Mechanisms as built in M20 (`climate/clouds.ts`; the albedo decomposition in `ebm.ts`, the two passes in `climate.ts`):

- Cloud cover per cell and sample from the moisture solver's state. A relative-humidity proxy is the column of vapor over the saturated column, taken as 1.08 times the equilibrium column of a still open sea at the surface temperature (evaporation over the base rainout, which is faster in cold air; floor 1 mm). Humidity cloud grows linearly from 5% to 80% of saturation up to a cover of 0.8; lifted cloud is 0.65 (1 - exp(-lifting)), lifting being the orographic and convergent rainout relative to the base rainout; the two share the same air, so the larger counts. Sinking air (descent in the lee, divergence under the subtropical highs, relative to the base rainout) multiplies both by 1 - 0.6 (1 - exp(-sinking / 4)). Open water carries a boundary-layer deck of 0.35 and cold current anomalies a stratus of 0.2 per degree (at most 0.8), neither cleared by sinking; the layers overlap at random.
- Clouds in the energy balance. The surface albedos are clear-sky values (ocean 0.10, land 0.16, ice 0.56) and a cloud of albedo 0.30 sits over the covered share with the two-stream multiple reflection cloud + (1 - cloud)^2 surface / (1 - cloud surface), so clouds double the ocean's reflection and barely brighten an ice sheet; absorbed sunlight is summed sample by sample under each sample's cover. Clouds trap longwave, 38 W/m^2 per unit of low cloud and 45 under lifted (cold-topped) cloud, entered per cell on the absorbed side, so A becomes the clear-sky 237 W/m^2. The seasonal response scales with the absorbed share under the same clouds.
- Two passes. The cover needs the moisture solve, which needs temperature, winds and currents, which need the cover: a prior pass on the next coarser grid solves everything under a uniform cover of 0.62 trapping 27 W/m^2 (three ice-albedo rounds), its cloud field is prolongated to the planet's grid, and the final pass solves everything under it (up to five rounds). The ice iteration stops when the area-weighted mean albedo change falls below 0.001, instead of the per-cell 0.01 that single sea-ice cells never satisfied. Climate stage 3.1 s at level 6 (2.7 before).
- Sunshine hours per year: daylight hours (24 h0 / pi from the sunrise hour angle, in Earth hours whatever the rotation) times 1 - 0.8 cover, summed over the samples; the 0.8 stands for broken cloud letting direct sun through, which is why station sunshine exceeds daylight times the clear fraction.

Calibration status after M20 on the real relief: surface mean 14.6 degrees C, equator 27.4, land precipitation 1,010 mm, cloud cover 0.61 of the sky (observed 0.65 to 0.67), clouds reflect 45 W/m^2 and trap 24 (observed 47 and 27), Koppen A 17 / B 26 / C 15 / D 17 / E 26, ice sheets 16% of the land, permanent sea ice 10% of the ocean. Sunshine against station normals, hours per year: Sahara 4,270 (3,600), Yuma 3,600 (4,000), Cairo 3,640 (3,450), Singapore 1,910 (2,020), Manaus 1,920 (1,900), London 1,980 (1,600), Paris 2,040 (1,660), Reykjavik 1,410 (1,270), Yakutsk 2,070 (2,000), Lisbon 2,530 (2,800), New York 2,880 (2,530). Too sunny where the moisture model is too dry (Tokyo 3,400 against 1,880, Buenos Aires 4,000 against 2,525), too cloudy over the polar plateaus, whose precipitation is too high (Vostok 1,740 against 3,700), and the stratus decks reach only part of the way (Lima 2,500 against 1,280). The two biases named after M11 moved the right way: the Sahara is at 19 degrees (14 before, 26 observed), London at 4 (1 before, 11 observed), Yakutsk at -6 (-12 before, -9 observed). Earth-preset planets (seeds 1 to 3): mean 13.8 to 14.6 degrees C, cloud 0.58 to 0.61, permanent sea ice 14 to 20% of the ocean (more than before: the clear-sky ice contrast feeds back harder), Koppen B 34 to 43%. Build 9.3 s at level 6 (7.1 before). A faint pattern of the icosahedron's faces shows in the cloud cover over the oceans: the wind divergence that clears or lifts the air is taken on the mesh, whose geometry bends at the face edges; the precipitation layer carried the same pattern more faintly before M20.

Mechanisms as built in M6 (`climate/ice.ts`, `climate/koppen.ts`):

- Sea ice in every sample whose surface temperature is below -1.8 degrees C; an ice sheet where the warmest sample of a land cell stays below zero, altitude included. One albedo pass cools iced cells by up to 4 degrees and recomputes the extent. Ice sheets lock 2 km of water per cell; the final sea level is solved from the inventory minus that volume, so the water parameter is now ocean plus ice (Earth 1.364e9 km^3) and a cold planet gets a lower coastline by itself. The glacial-phase parameter cools the global mean by 6 degrees at 1, and everything else (ice, sea level, biomes) follows.
- Over the ocean the annual temperature responds to insolation at 0.14 degrees per W/m^2 instead of 0.17 on land, standing for the ocean's own poleward heat transport; without it the polar seas froze over far beyond Earth's.
- Koppen-Geiger from the 12 samples (Peel et al. 2007 thresholds), with the summer half-year by hemisphere. Statistics add landmass counts (continents at or above one million km^2), ice fractions and Koppen group shares.
- Explain mode stores the components the inspector itemizes: elevation as crust + volcanic + sediment + trench, temperature as global mean + insolation + altitude + continentality + currents + ice albedo, precipitation as advected + orographic + convergence.

Calibration status after M6 (Earth preset, seed 1): ice sheets on 11% of the land (Earth 10%), Koppen A 10 / B 26 / C 12 / D 21 / E 32% of the land (Earth 19 / 30 / 14 / 25 / 13; the surplus of E comes from large polar continents in this seed and the lapse rate on plateaus), seven continents and 24 islands. The glacial phase at 1 roughly triples the ice volume and drops the sea by about a hundred meters. A level-5 preview of Earth builds in 0.8 s, the full planet in about 3.5 s.

Calibration status after M5 (Earth preset, seed 1): global precipitation 1,100 mm per year (Earth about 1,000), land 740 (Earth 750 to 800), desert 17% of the land (Earth 20 to 25% below 250 mm); zonal land means of 2,600 at 0 to 10 degrees, 350 at 20 to 30, 610 at 40 to 50 and 250 at the poles (Earth about 2,000, 350, 650, 150). Gyre transport 8 Sv (Earth 30 to 50; the annual-mean wind stress is the weak link), boundary currents 0.2 m/s spread over 275 km, coastal anomalies of a few degrees. Climate stage 1.2 s, whole build 3.4 s.

### 3.6 Statistics per world

Ocean fraction, mean temperature, ice fraction, desert fraction, forest fraction, number of continents, max elevation, max depth, number of plates, longest river, lake count; since M20 the mean cloud cover, the land's sunshine hours and the global shortwave and longwave cloud forcing.

### 3.7 Explain mode (per-cell provenance)

Stored alongside outputs so the inspector can show the causal chain: plateId, crustType, crustAge, nearest boundary type and distance, orogeny step, hotspot flag, elevation components (crust, orogeny, volcanic, erosion), temperature components (insolation, altitude, continentality, current), precipitation components (advected, orographic, convergence, shadow), cloud cover per sample and sunshine hours (M20), discharge, biome code.

### 3.8 Timeline (phase 2, built in M7)

The tectonic loop is step-able and deterministic, so history is a matter of copying state. During a build, `keyframeSteps` picks evenly spaced steps (eight for an Earth-sized grid, four at level 7); at each one the simulation's per-cell state (elevation, sea level, plate, crust fields, boundaries, plates, hotspots) is copied into a `ReliefState`, about 3 MB at level 6. The final world is finalized and delivered first; the worker then runs `finalize` on every snapshot (hydrology, climate, ice, biomes, statistics, exactly the code path of the final world) and streams the results as keyframes compacted to Float32, roughly 17 MB each at level 6. A keyframe at step t is byte-for-byte the planet a build of tectonic age t would produce, which is the timeline's invariant test. Only the latest full build keeps its history in memory; gallery entries keep their final world.

### 3.9 The real Earth as a reference (built in M11; its past in M16)

The real Earth's past (M16; `sim/earth.ts`, `scripts/convert-paleodem.ts`). The PALEOMAP paleo-digital elevation models of Scotese and Wright (2018), reconstructions of the land surface and sea floor every five million years through the Phanerozoic at one degree, licensed CC BY 4.0, are converted to twenty cell-centered Int16 slices from 200 to 10 Ma (2.6 MB, `public/data/earth-history-1deg.i16`). The Real Earth build streams them as keyframes after the present, oldest first, each finalized exactly like a simulated snapshot (rivers, lakes, energy balance, winds, currents, moisture, ice, Koppen), with its step counting up from 200 Ma so the same slider that plays a simulated planet plays Pangea breaking up; the present stays the ETOPO5 relief. Limits worth knowing: the reconstructions infer coastlines and bathymetry and estimate mountain heights; one degree is close to the grid's own resolution, so shelves and small seas are coarse; and the greenhouse of the past (the Cretaceous had several times today's CO2) is not applied, so past climates come out cooler than they were, with ice where there was none.

The app ships the real relief so the simulator's later links can be judged on known ground: NOAA's ETOPO5 grid (NGDC, 1988, public domain), block-averaged from 5 arc-minutes to half a degree by `scripts/convert-etopo5.ts` and stored as 360 x 720 little-endian Int16 meters (518 KB). `sim/earth.ts` maps it onto the Earth grid (area-weighted mean of the samples nearest to each cell), reads crust type, thickness and sea-floor age back from the elevation with the model's own isostasy and subsidence rules, fixes the sea level at the datum (zero) and runs `finalize`: proxy hydrology, climate with the energy balance, ice, final rivers, Koppen and statistics, exactly the path a simulated planet takes after its tectonic loop. No tectonic provenance exists for it (one plate, no boundaries, no events), so the plate layers are blank and the explain drawer says so. In the app it is a button next to Build planet; it joins the gallery and the Compare view, and the command-line renderers take `Real` as a preset name.

### 3.10 Resources from the provenance (phase 4 input, built in M21)

Seven mineral resources, each a potential from 0 to 1 per cell read from what the tectonic loop recorded (`sim/resources/minerals.ts`), and a map of deposits drawn from the potentials.

- Shields are continental crust from the planet's start (crust age equal to the step: not an accreted arc), never thinned below 33 km by rifting (full at 38) and not in a collision for 60 steps. Iron (banded iron formations) and uranium (the granites of old cratons) are provinces within shields: potential 0.5 times the shield value, times 1 minus the sediment cover (full burial at 0.5 km). Uranium also sits in sandstone basins (sediment above 0.2 km) within two reference cells of a shield (roll-front deposits), at 0.6 times the sediment's fraction of 0.5 km.
- Copper: porphyries of volcanic arcs, the volcanic pile over continental crust (full at 3 km), within three reference cells of a subducting boundary (half the potential farther away, for arcs whose trench has moved), times an exposure term (erosion of 800 m over the crust's life, half weight).
- Gold and tin: collision belts, the thickness above 42 km (full at 55) of crust that has been in an orogeny, times the exposure term.
- Coal, oil and salt come from bookkeeping on the parcels inside the loop (`parcels.ts`, `simulation.ts`), carried by the plates and summed like sediment when parcels merge: in `deposit()`, sediment laid down in a lake or on a flood plain where the in-loop climate is warmer than 15 C with more than 1,000 mm of rain is a swamp and counts toward coal; sediment laid down in a sea shallower than 500 m over continental crust warmer than 18 C counts toward oil source rock, half of it toward coal too when the climate is a swamp's; at every fluvial pass, cells of closed-basin lakes whose evaporation outruns their inflow receive 10 m of evaporite per step times the deficit. Collisions keep both sides' coal and salt and cook out half of the oil; the accretionary prism of a subduction scrapes half of the sea floor's coal and oil onto the margin. Potentials: coal full at 0.3 km of swamp sediment; oil full at 0.5 km of shallow-sea sediment times the burial (sediment, full at 0.8 km); salt full at 0.5 km. Ores count on land only, oil on any continental crust (shelves included).
- Deposits: cell by cell, mineral by mineral, a hash of the seed and the cell is compared with 0.3 times the potential, so a field of fixed, sparse deposits comes out of the continuous potential and the geography never changes (`tests/minerals.test.ts` checks the ocean fraction, mean land elevation, mean temperature and sea level of seed 2 against the values recorded before the rules existed).
- The real Earth has no tectonic history here, so its potentials are zero and its deposits come from measured data when shipped: `scripts/convert-mrds.ts` turns the USGS Mineral Resources Data System (public domain; worldwide, most complete inside the United States; no oil and gas) into a one-degree mask of producing deposits (`public/data/earth-minerals-1deg.u8`, loaded by the app when present). The USGS server refused automated downloads in the session that built M21, so the file is not shipped yet and the real Earth says "not available"; the conversion is a one-line command once the CSV is downloaded by hand.

Calibration status after M21 (Earth preset, 200 steps, seeds 1, 2, 3 and 282101170): land share with potential above 0.3, iron 2 to 20%, copper 3 to 5%, gold and tin 3 to 7%, uranium 2 to 12%, coal 8 to 16%, oil 10 to 17% (shelves included), salt 1 to 2%; deposits per planet, iron 80 to 410, copper 90 to 140, gold 100 to 230, uranium 90 to 300, coal 270 to 590, oil 580 to 800, salt 70 to 120. Copper sits on the arcs along the trenches, coal on deltas and lake shores, salt in the closed basins of the interiors, gold in the collision belts, iron and uranium in the old interiors. Known deviations: no deposit types beyond the seven (no bauxite, no phosphate, no diamonds); shield ores are everywhere inside a shield rather than in a few provinces; the oil potential includes uplifted former shelves far inland; the real Earth shows no deposits until the data is converted.

### 3.11 Flora (phase 3, built in M22)

Three fields on the land (`sim/biosphere/flora.ts`), computed after the final rivers and climate, for every keyframe too.

- Net primary productivity: the Miami model (Lieth 1975), NPP = min(3000 / (1 + exp(1.315 - 0.119 T)), 3000 (1 - exp(-0.000664 P))) grams of dry matter per square meter per year from the annual mean temperature (C) and precipitation (mm), times 0.45 for carbon, times a sunshine factor (1 at 2,500 h/yr, a fifth less or more at 0 or 5,000) and a soil factor (0.6 + 0.8 fertility). Zero on water and ice sheets.
- Soil fertility, itemized and stored term by term: base 0.45; + 0.3 times the volcanic rock in the cell (full at 1 km); + 0.25 times the larger of the river term (zero at 40 km^3/yr, full at 400, logarithmic) and the basin sediment (full at 0.3 km); - 0.25 times the excess of rain over 1,500 mm (full at 3,000) where the annual mean is above 20 C (leaching); - 0.1 on ancient crust never in an orogeny (old shields; skipped on reliefs without a history); - 0.15 where the annual mean is below freezing. Clamped to 0.05 to 1.
- Vegetation, thirteen classes read from the samples: ice or bare rock under an ice sheet; tundra where the warmest sample is below 10 C; desert below 250 mm; with winters below -3 C, steppe below 500 mm, else boreal forest when the warmest sample stays under 18 C and temperate forest otherwise; with winters between -3 and 18 C, semi-arid scrub (annual mean above 12 C) or steppe below 500 mm, Mediterranean woodland when the summer half-year gets less than half the winter's rain and the annual mean is above 12 C, temperate rainforest above 1,500 mm, otherwise temperate forest when the productivity passes 300 g C/m2/yr and steppe below it; with winters above 18 C, scrub below 600 mm, savanna (below 1,500 mm) or tropical seasonal forest when a sample rains at less than 720 mm/yr (Koppen's 60 mm month), else tropical rainforest above 1,800 mm; wetland replaces a warm, wet class on the flood plain at the mouth of a river of 100 km^3/yr or beside a lake. The summer half-year is samples 3 to 8 in the north and the rest in the south.

Calibration status after M22: real Earth 52 Gt C/yr on land (measured about 56); Manaus 875 g C/m2/yr in tropical rainforest with a leached soil of 0.20, the Sahara 137 in desert, Yakutsk 130 in boreal forest, Taymyr 51 in tundra; land shares ice 15, tundra 10, boreal 6, temperate forest 11, temperate rainforest 5, steppe 8, Mediterranean 1, scrub 14, desert 8, savanna 4, seasonal forest 6, rainforest 5, wetland 2% (forests 33% of the land, measured about 30; grasslands 12, measured 20 to 25). Earth preset seed 2: 60 Gt C/yr. Known deviations follow the climate's: where the moisture model is too dry (Ohio, Kansas, Bangladesh) the classes are drier than the real ones; tropical highlands with cool nights fall into the temperate classes (the Serengeti comes out as temperate rainforest); the basins the hydrology floods as lakes (the Congo cuvette) carry no vegetation; no succession, no fire, no grazing.

### 3.12 Fauna (phase 3, built in M23)

Biogeographic realms as an outcome of the plate history (`sim/biosphere/fauna.ts`; the bookkeeping in `tectonics/parcels.ts` and `simulation.ts`, constants LINEAGE_* in `crust.ts`).

- Lineages on the parcels. Every crust parcel carries a vector over eight ancestral faunas. At the planet's start each continental parcel gets the lineage of its angular sector around the supercontinent's centroid (eight sectors of 45 degrees), so the later splits carry distinct faunas apart. At every fluvial pass (5 steps), within each connected landmass above the loop's sea level, a parcel's vector moves halfway toward its land neighbors' mean (diffusion along the land, about 700 km over 200 steps: a toy for dispersal that keeps a continent's regions distinct) and 1% toward the landmass mean (long-range exchange); deserts (in-loop rain below 250 mm) and ground above 2,500 m pass faunas at a third of the rate; nothing crosses the sea; crust that just became land (an accreted arc, a volcanic island) takes its landmass's mean. Merged parcels average their vectors by thickness. The lineages ride with the plates; glacial bridges and closed seaways act through the sea level of each step. Pure bookkeeping: `tests/fauna.test.ts` pins seed 2's geography.
- On the final relief, land that no lineage reached (an island risen from the sea floor) takes the fauna of the nearest cell that has one, by breadth-first search across the sea: waif dispersal, the way Hawaii was settled. Then, per land cell: the normalized lineage shares; the realm, the dominant lineage; endemism, the share of the cell's fauna found on no other landmass (each lineage weighted by the fraction of its land area that lies on this landmass); richness, the square root of the productivity over 1,000 g C/m2/yr (species-energy) times the logarithm of the landmass area between 10,000 and 10 million km2 (species-area); megafauna, large herbivores where the productivity passes 200 g C/m2/yr on a landmass above 200,000 km2 and large predators above a million km2 (Madagascar keeps the first and lost the second).
- A relief without a history (the real Earth, its reconstructions): the eight largest landmasses get one lineage each and every other cell the nearest large landmass's, by breadth-first search over the sea, so the realms are the present connectivity and the Americas share Afro-Eurasia's through the Bering cell.

Calibration status after M23 (Earth preset, 200 steps): seeds 2 and 282101170 keep all eight lineages dominant somewhere above a million km2 (land shares from 2 to 26% each) with a mean endemism of 0.63; the real Earth by connectivity has 5 realms and an endemism of 0.98. Known deviations: no speciation, so an island isolated for 150 steps keeps the continent's fauna rather than growing its own (its endemism rises only as the continent's share of that lineage shrinks); no dispersal across straits narrower than a cell except where the cells touch; the toy diffusion crosses a continent in hundreds of steps, slower than real interchanges; megafauna and richness are thresholds on productivity and area, not populations.

## 4. Parameters

| Parameter | Unit / range | Causal path |
|---|---|---|
| seed | integer | All randomness |
| radius | km (0.3 to 2.5 x Earth) | Cell count; circulation cell count; plate size |
| density | relative to Earth | Gravity: isostasy ceiling, lapse rate |
| water volume | relative to Earth | Sea level from hypsometry |
| ocean cover | 0 (off) or 0.05 to 0.95 | Sea level solved each step so the ocean covers this share; the water inventory then follows the relief, and ice still takes its part at the end |
| axial tilt | 0 to 90 degrees | Seasonal insolation amplitude, polar night |
| rotation period | hours | Coriolis, number of circulation cells, wind deflection |
| insolation | relative to Earth | Global temperature baseline |
| plate count | 4 to 30 | Initial plate seeds |
| tectonic age | steps (50 to 400) | Loop length: more orogenies, more erosion. One step is about a million years (cells of 110 km, plates at 0.1 to 0.5 cells per step, i.e. 1 to 5 cm per year); the default of 200 is the age of Earth's oldest sea floor, long enough to recycle the ocean floor once and to bring relief into balance between uplift and erosion. It is not the planet's age: the initial 40% of continental crust stands for the earlier billions of years |
| glacial phase | 0 to 1 | Temperature offset, sea-level drop, ice extent |
| mantle heat (phase 2) | relative to Earth (0.3 to 3) | Plate speed, hotspot volcanism, rifting rate |
| greenhouse (phase 2) | relative to Earth (0.2 to 5) | Longwave trapping: global temperature, ice extent |
| air pressure (phase 2) | bar (0.1 to 10) | Heat transport to the poles, pressure broadening, seasonal inertia |
| eccentricity (phase 2) | 0 to 0.3 | Unequal seasons between hemispheres |

Presets: Earth, Super-Earth, Slow rotator, High tilt, Waterworld, Dry world, Snowball, Young planet.

## 5. Architecture

```
src/
  sim/            pure TypeScript, no DOM, typed arrays, deterministic
    grid/         icosahedron builder, neighbors, geometry, cache
    rng/          xoshiro128**, hashing, noise
    tectonics/    plates, crust, boundaries, hotspots, isostasy, erosion
    hydrology/    routing, priority-flood, accumulation, fluvial erosion
    climate/      insolation, temperature, circulation, currents, moisture, ice, koppen
    params.ts     PlanetParams, presets, validation
    pipeline.ts   build(params) -> World; exposes step() for the future timeline
    stats.ts
  worker/         runs the pipeline off the main thread; progress messages
  render/         equirectangular canvas, layer painters, color scales
  ui/             parameter panel, build button, layer toggles, gallery, inspector
tests/            vitest; per-link physics tests with the Earth preset
docs/DESIGN.md    this file
```

Rules:

- `sim/` never imports from `render/`, `ui/` or `worker/`.
- The pipeline is `state -> state` per step; `World` is plain typed arrays so it can be posted to the main thread and later stored per step for the timeline.
- Physical constants live in one file with their source or justification.

## 6. Validation

Invariants (every milestone): determinism (same params + seed gives identical arrays), no NaN or Infinity, every cell has 5 or 6 neighbors, sum of cell areas equals 4 * pi * R^2 within 1e-6.

Per link, with the Earth preset, across several seeds:

| Link | Test |
|---|---|
| Grid | cell count = 10 * 4^L + 2; neighbor symmetry; exactly 12 pentagons |
| Tectonics | ocean fraction 60 to 75%; bimodal hypsometry (modes near -4 km and +0.5 km); continental crust volume (thickness times area) conserved within 10%, erosion to the ocean included; highest cells carry orogeny, volcanic history or sit within 3 cells of a convergent boundary; oceanic crust age grows away from ridges |
| Hydrology | every land cell reaches ocean or a lake; discharge non-decreasing downstream; no river flows uphill; delivered discharge equals land runoff; lake water above its bed at one level per open lake; a synthetic bowl fills to its spill when wet and shrinks to a closed lake when dry |
| Temperature | zonal annual mean within Earth bands (equator 25 +/- 5 C, poles -20 +/- 15 C); lapse rate visible on mountains; ocean seasonal amplitude smaller than land |
| Circulation | 3 cells per hemisphere for Earth; 1 for rotation of 50 days or more; trade winds easterly, mid-latitude westerly |
| Currents | each basin has one gyre per hemisphere; western boundary warmer than eastern at the same latitude |
| Moisture | precipitation max in 0 to 10 degrees; minima concentrated 20 to 35 degrees, strongest on western coasts; lee side of mountains drier than windward |
| Ice | ice at both poles; glacial phase 1 drops sea level and expands ice; zero tilt removes seasons |
| Biomes | all Koppen groups A, B, C, D, E present for Earth; B about 25 to 35% of land |
| Stats | per-world stats have low variance across seeds for the same params |

## 7. Milestones

- M0: repo, Vite + TS + Vitest scaffold, this document.
- M1: grid, PRNG, worker protocol, equirectangular render of one scalar layer (noise planet), invariant tests.
- M2: tectonics loop, sea level, elevation and plate/boundary layers, tectonics tests.
- M3: hydrology with the precipitation proxy inside the loop, rivers and lakes layers, hydrology tests.
- M4: insolation, 12-sample temperature with inertia, circulation cells, wind layer, tests.
- M5: ocean currents, moisture advection, precipitation, final rivers with real precipitation, tests.
- M6: ice and glacial phase, Koppen, presets, gallery with stats, explain inspector, end-to-end determinism test.

Phase 2 (section 9.1), in the same style:

- M7: timeline. Tectonic snapshots captured every few steps during the build; after the final world is delivered, the worker computes the hydrology, climate and biomes of every snapshot and streams them as Float32 keyframes; a history slider under the map shows any step with every layer, statistics and explain mode.
- M8: plate rifting and merging, so supercontinents assemble and break apart; plate count becomes an initial condition; mantle heat flux as a parameter.
- M9: two-dimensional energy-balance model with ice-albedo feedback replacing the banded temperature link; greenhouse, atmospheric pressure and eccentricity as parameters; real precipitation inside the tectonic loop at the keyframes.
- M10: views: 3D globe, A/B comparison of two worlds or two steps, export of the history as frames.

Follow-ups after phase 2, driven by looking at the planets next to the real one:

- M11: per-pixel rendering (interpolation, hillshade, river lines), the real Earth as a reference world, climate recalibration against it (3.5, 3.9, 8.5).
- M12: the initial condition as a rifted supercontinent instead of noise blobs; Koppen legend in plain words (3.3, 8.4).
- M13: continents with history: one supercontinent with a bent, stair-stepped first rift; slab pull; uneven rifts, some of which fail and leave gulfs; collisions that close seaways; island arcs that accrete and Andean margins that thicken (3.3).
- M14: margin events: back-arc basins opened by slab rollback (arcs become small plates, marginal seas open behind them) and coastal slivers captured at sliding margins (3.3).
- M15: the Equal Earth view (8.4) and an installable app: a web manifest with icons rendered from the default planet by `scripts/make-icons.ts`, so the page can be saved to a phone's home screen.
- M16: the real Earth's past on the timeline (3.9): PALEOMAP paleo-reliefs every 10 million years from 200 Ma, finalized with the simulator's climate and streamed as keyframes after the present.
- M17: dissected coasts (3.3): slab break-off leaves remnant seas between stalled continents, back-arc openings hinge at one end and leave peninsulas, lower platforms and coastal plains put more land near sea level; deltas fill basins to the water surface and no higher.
- M18: resolution independence and the fine grid (3.1, 3.3): tectonic constants in reference cells converted to the grid in use, so level 7 (55 km cells) builds the same planet in kilometers; a Fine grid option in the app; Budyko runoff (3.4); plate mergers and captures no longer stack aliased parcels into fields of peaks.
- M19: the Model view, a reader's guide to the physics and the rationale inside the app (`src/ui/model.ts`), and `CLAUDE.md`, a brief of the project's state, conventions and lessons for a new working session.

Phase 3 (section 9.2) and the first slice of phase 4 (9.3), after a climate link they both need:

- M20: clouds and sunshine (3.5): cloud cover from the moisture state (humidity, lifting, a marine deck, stratus over cold water, clearing by sinking air) feeding back into the energy balance (clear-sky albedos under a reflecting cloud, trapped longwave), solved in two passes; Sunshine and Cloud cover layers; recalibration on the real Earth.
- M21: resources and the UI beyond geography (3.10, 8.6): seven mineral potentials from the provenance (shields, arcs, collision belts, and swamp, shallow-sea and evaporite bookkeeping on the parcels inside the loop) with deposits drawn from them; a "Beyond geography" toggle with a second layer dropdown, so the app is unchanged for whoever wants geography only; a one-column layout and pinch zoom for phones; the converter for measured deposits on the real Earth.
- M22: flora (3.11): primary productivity by the Miami model scaled by sunshine and soil, soil fertility itemized from the provenance and the rivers, thirteen vegetation classes from the monthly climate; Primary productivity, Soil fertility and Vegetation layers in the Life group.
- M23: fauna (3.12): eight ancestral lineages carried on the crust parcels and diffused along the land at every fluvial pass, never across the sea; realms, endemism, richness and megafauna on the final relief; Faunal realms, Endemism, Species richness and Megafauna layers.

## 8. User interface

The UI exists to expose causality, not to decorate. Every number on screen has a path back to a parameter or a process, and every layer is a field the simulator actually computed.

### 8.1 Layout

- Left panel: preset, the ten parameters (disabled until the milestone that wires them, with the causal path as tooltip), Build and New variation buttons, progress and timing, layer selector, world statistics, cell inspector.
- Center: one equirectangular map at a fixed internal resolution (1440 x 720), scaled to the window. Click selects a cell; the inspector shows its values and, from M6, its causal chain.
- Bottom strip (from M6): gallery of recent variations as thumbnails with their statistics; clicking one restores it.
- Phase 2 adds a time scrubber under the map and an A/B split view.

### 8.2 UI by milestone

| Milestone | UI deliverable |
|---|---|
| M1 | Panel, presets, map, elevation and grid layers, inspector with position, elevation and area |
| M2 | Plates layer with boundary types, crust age, crust thickness; inspector shows plate, crust type, thickness, age, boundary, volcanic and sediment history |
| M3 | Rivers and lakes layer, discharge in the inspector |
| M4 | Temperature and wind layers with a month slider; circulation cell count in statistics |
| M5 | Precipitation and ocean current layers; the final rivers |
| M6 | Ice and Koppen layers, glacial phase, gallery with statistics, explain drawer with itemized components, parameters in the URL for sharing, PNG and JSON export, automatic coarse preview on parameter change |
| M7 | History slider under the map; keyframes stream in after the final world; every layer, the statistics and the explain drawer work at any step; exports carry the step |
| M8 | Mantle heat parameter and the Hot mantle preset; plate births and deaths listed under the statistics, counted per step on the timeline |
| M9 | Greenhouse, air pressure and eccentricity parameters with the Greenhouse, Thin air and Eccentric orbit presets; the explain drawer's temperature line itemizes the energy balance |
| M10 | View bar with Map, Globe and Compare; legends; history playback; Export history strip; Export PNG of the view on screen |
| M20 | Sunshine and Cloud cover layers (the cover with the month slider); a sunshine and cloud line in the explain drawer's climate section; a clouds row in the statistics; the Model view's climate chapter |
| M22 | Life group in the second dropdown: Primary productivity, Soil fertility, Vegetation (lakes and rivers kept in blue); a Flora section in the explain drawer with the growth and soil terms; a Primary production row in the statistics; the Model view's flora chapter |
| M23 | Faunal realms (eight named by their colors, paler where mixed), Endemism, Species richness and Megafauna layers; a Fauna section in the explain drawer with the lineage shares, the landmass area and what it supports; a Faunal realms row in the statistics; the Model view's fauna chapter |
| M21 | "Beyond geography" checkbox (off by default, remembered per browser and as `beyond=1` in the link) revealing a second layer dropdown with Resources (deposits of all minerals; one potential layer per mineral with its deposits as dots), a Resources section in the explain drawer and a Deposits row in the statistics; a one-column layout under 820 px with the map first, larger touch targets and two-finger pinch zoom on the map; the Model view's Resources chapter |

### 8.6 Beyond geography (M21)

Everything past the physical geography (resources, later life and civilization) lives behind one checkbox. Off, the app is exactly what it was: the geography dropdown, the geography sections of the explain drawer and the geography rows of the statistics. On, a second dropdown appears under the first with the layers beyond geography grouped as Resources, Life and Civilization; choosing one shows it instead of the geography layer, choosing a geography layer takes the screen back. The explain drawer and the statistics gain their sections and rows. The state is remembered in `localStorage` and travels in the link so a shared planet opens as it was seen. Layers declare their group (`Layer.group`), sections their group (`Section.group`); nothing else in the app knows about the toggle.

On a phone (820 px and narrower) the layout becomes one column with the map on top and the panel below, the view bar wraps, buttons and selects grow to 40 px, and two fingers zoom the map around their midpoint (`MapView` tracks its pointers; a pinch ends the drag and never counts as a click).

### 8.3 Rules

- The UI never computes physics; it reads `World` arrays. Anything the inspector shows must be stored by the simulator as provenance.
- Layers are pure functions from a cell to a color so the same painter serves the browser and the command-line PNG renderer.
- Interaction stays responsive: builds run in the worker, progress is per stage and per tectonic step, and a level-5 preview (M6) answers parameter changes in under two seconds.

### 8.4 Views (phase 2, built in M10)

The screen is one planet seen three ways, chosen in a view bar above the stage:

- Map: the equirectangular painter of v1, as a window on the cylinder: the wheel zooms around the cursor up to sixteen times (a sideways scroll pans along the parallels), dragging pans with the world wrapping around its antimeridian, a double click shows the whole world again. While a drag lasts the last rendering is translated; the window is re-rendered when it ends. In the Compare view both panes share one window.
- Equal Earth (M15): the same window machinery on the Equal Earth projection (Savric, Patterson and Jenny, 2018; `render/equalearth.ts`), an equal-area pseudocylindrical projection, so the sizes of continents and oceans compare truly and the whole world is on screen with no stretching at the poles. The raster lookup takes a projection id (`render/raster.ts`); pixels outside the outline carry no cell and paint the background. Dragging turns the central meridian, the wheel zooms around the cursor, a double click resets; the hillshade uses the equal-area property (every pixel covers the same ground).
- Globe: an orthographic globe rendered on a 2D canvas without any library. Every pixel of the disc is unprojected to the sphere, rotated into the planet's frame and resolved with the same nearest-cell walk as the map, so the lookup is cached per view direction and a layer change only repaints. Drag turns the globe, a click picks a cell, a cosine light from the upper left gives the relief its roundness. The same painter serves both views: a layer is still one color per cell.
- Compare: two maps side by side. A is the planet on the timeline; B is any keyframe of the same build or the final state of any gallery entry, so "this basin before and after the mountains rose" and "same parameters, other seed" are one dropdown away. The statistics table grows a second column and a click in either pane explains that pane's cell.

The Koppen layer colors by family (A deep forest greens, B reds and oranges, C yellow-greens and olives, D purples, E grays; lighter when drier or colder; blue is kept for water) over a muted slate sea, instead of the thirty saturated hues of the textbook palette, which blur into noise at 110 km per cell. The legend speaks plain language, one row per family with its row of shades ("Tropical, hot all year: rainforest, monsoon, savanna with a dry season"), and the inspector names the subtype with its code and a description.

Around the stage: a legend under the layer selector (gradient bar with ticks for ramps, swatches for categories, a sentence for direction hues); the history slider gains a play button; Export history writes every keyframe of the current layer into one PNG strip with step captions, and Export PNG writes whatever view is on screen.

### 8.5 Image quality (built in M11)

Cells are 110 km across and a flat color per cell showed as a honeycomb. The painter now works per pixel: every pixel of the map and of the globe knows the mesh triangle it falls in and its barycentric weights (gnomonic projection onto the triangle, `render/interp.ts`), so continuous fields are interpolated, the coastline is the zero crossing of the interpolated elevation, and lakes are the region where the interpolated water level stands above the interpolated bed. Relief layers get a hillshade from the interpolated elevation with a cartographic exaggeration of 15 (slopes are tiny at 30 km per pixel), lit from the west-northwest, gentler under the sea. Rivers are lines from each river cell to its downstream cell, anti-aliased, with a width that grows with the logarithm of discharge, so the drainage network reads as a network instead of a trail of blue cells. Categorical layers (Koppen, plates, ice sheets) keep the nearest cell's class but inherit the smooth coastline. The globe paints flat while it turns and smooth at rest. The raster lookups are cached per projection and size; a full map paints in about 150 ms and a globe in about 90 ms.

## 9. Vision beyond v1

Three further phases, each built on top of the previous one and governed by the same principles as v1: every output has a traceable causal path, the build is deterministic given (params, seed), and each link ships with tests against the Earth preset. Later phases encode hypotheses that are debated in the literature; the simulator treats them as toggleable rules in a sandbox, so the user can see which hypothesis leads to which outcome, not as claims of truth.

### 9.1 Phase 2: planet history and deeper physics

Goal: watch the planet become what it is, and let the physics produce transitions (snowball, greenhouse, supercontinent cycles) instead of only end states.

- Interactive timeline. A time slider scrubs through geological steps: continents drift, mountains rise and erode, sea level moves, ice advances and retreats. Because the pipeline is deterministic and step-able, any step can be recomputed from the seed; keyframes every K steps are cached so scrubbing is instant and memory stays bounded (one keyframe at level 6 is a few MB). Every v1 layer becomes viewable at any step.
- Climate history. The full climate pipeline runs at every keyframe, so a region has a climate time series ("this basin was a rainforest until the mountain range closed the moisture corridor"). This also replaces the precipitation proxy inside the loop with real precipitation.
- Plate rifting and merging. Plates are born from continental rifts and die by subduction, so supercontinents assemble and break apart; the plate count becomes an initial condition instead of a constant.
- Energy-balance model. A 2D diffusion model with ice-albedo feedback replaces the banded temperature link, so snowball and hothouse states emerge from insolation, tilt and greenhouse parameters rather than from the glacial-phase knob.
- Extra parameters with causal paths: atmospheric pressure and greenhouse strength (temperature baseline, lapse rate), orbital eccentricity (hemispheric asymmetry of seasons), mantle heat flux (plate speed, volcanism rate), moon and tides (tidal range, rotation braking over the timeline).
- Views: 3D globe, A/B comparison of two worlds or two steps of the same world, export of the history as a sequence of frames.

What this unlocks downstream: biogeography (phase 3) needs to know when landmasses connected and separated, and civilization (phase 4) needs land bridges at glacial maxima. Both are read directly from the timeline.

### 9.2 Phase 3: biosphere (flora and fauna)

Goal: a living planet whose life distribution follows from climate and from the planet's history.

- Flora. Net primary productivity per cell from temperature, precipitation, sunlight and seasonality, with a soil term from rock age, volcanic ash and river sediment (all available from v1 provenance). Vegetation types richer than Koppen (rainforest, seasonal forest, savanna, steppe, tundra, wetland) and simple succession over time after climate shifts.
- Fauna. A coarse ecological model rather than species-level simulation: trophic levels and body-size classes supported by productivity; dispersal across the grid limited by oceans, deserts, mountains and climate tolerance; isolation on islands and separated continents produces endemism. Biogeographic realms emerge from plate history: continents that split long ago carry distinct faunas, and narrow straits become faunal boundaries (a Wallace line is an output, not an input).
- Dynamics on the timeline. Land bridges exposed at glacial maxima let faunas exchange; climate that shifts faster than dispersal causes regional extinctions; megafauna persists where it co-evolved with predators and disappears where a new predator arrives suddenly (a toggleable hypothesis, relevant to domestication in phase 4).
- Outputs: productivity, vegetation type, faunal realm, species-richness index, endemism index, large-herbivore and large-predator presence. Explain mode shows why a cell has the fauna it has ("isolated since step 120, no large herbivores arrived").

### 9.3 Phase 4: civilization

Goal: answer questions such as where the best city sites are, where domestication would start, whether humans would reach every continent, and which regions would develop earliest, as consequences of the geography rather than as scripted outcomes. The first version is a set of explainable indices and diffusion processes, not an agent-based empire simulator; agents can come later on top of the indices.

- Origin and dispersal. The origin region is chosen by rule (default: a large tropical savanna on an old, continuous landmass) or picked by the user. Dispersal proceeds over land, along coasts and across straits, with crossing probability falling with open-water distance and rising when glacial sea-level drops expose bridges. Output: arrival time per cell and the list of continents reached. "Would humans populate every continent" is answered by strait widths, island chains and the glacial sea level of that particular planet.
- Habitability and carrying capacity. From productivity, fresh water, temperature comfort, flood and drought variability, and a disease-load term that rises with heat, humidity and later with domesticated-animal density.
- Domestication potential. Candidate crops come from flora: large-seeded annual grasses and pulses concentrate in seasonal-dry and Mediterranean climates. Candidate animals come from fauna: large social herbivores that survived to the human arrival. Each region gets a count of domesticable species; the Earth preset should produce few, concentrated centers rather than a uniform spread.
- Spread of the agricultural package. Crops and techniques diffuse faster along latitude bands (similar climate and day length) than across them, so the east-west extent of a continent matters; deserts, mountain belts and seas are barriers. This is the continental-axis hypothesis, toggleable so its effect can be isolated.
- Resources from geology. Ore and metal potential come from orogenic belts and volcanic arcs recorded in the tectonic provenance; fertile soils from volcanic ash and alluvium; building stone and salt from exposed crust types. Metallurgy and later technology packages need these inputs within reach.
- City-site score. Per cell, a weighted and fully itemized sum: river confluence or mouth, navigable water, natural harbor (coastline geometry and shelter), fresh water, agricultural hinterland within a radius, defensibility from relief, low hazard (distance to plate boundaries, volcanoes, flood plains), and centrality on land and sea routes. The inspector shows every component, so "why is this the best harbor on the continent" has a concrete answer.
- Trade and connectivity. Least-cost routes over land and sea between high-scoring sites; centrality on this network feeds back into the city score and into the diffusion speed of technologies and diseases.
- Outputs: dispersal time, habitability, domestication potential, agricultural origin centers, spread fronts over time, ore potential, city-site score with ranked sites, trade network, and a narrative explain per cell.

Tests for the Earth preset: agricultural origins arise in a handful of seasonal-dry regions near wild grasslands; the largest east-west landmass spreads its package fastest; small isolated continents receive few domesticates; humans reach every landmass whose straits at glacial maximum are narrower than the crossing threshold; top city sites sit on coasts and large rivers rather than inland deserts; all results deterministic per seed.

### 9.4 Sequencing and what v1 must preserve

Order: phase 2 (history) before phase 3 (biosphere) before phase 4 (civilization), because each consumes the previous one's time series. Each phase is itself delivered by links with tests, like v1.

To keep these phases possible without rewrites, v1 commits to:

- A pure, deterministic, step-able pipeline whose state is plain typed arrays (section 5), so any step can be recomputed and cached as a keyframe.
- Provenance kept per cell rather than discarded after rendering (section 3.7), including crust type and age, orogeny and volcanic history, sediment and discharge, since phases 3 and 4 read soil, ore and harbor information from them.
- Glacial phase as a first-class parameter with its sea-level mask, so land bridges are already computable.
- Explain mode as a general mechanism (named components that sum to a value), so later indices plug into the same inspector.
