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
- About a third of the plates are seeded without continental crust, and continents are biased toward plate interiors, so most margins start passive.

Calibration status after M2 (Earth preset, three seeds): ocean 64 to 69%, continental crust 36 to 39%, highest point 8.9 to 10.8 km, mean ocean depth 3.8 to 4.1 km, continental volume conserved within 3%, build 1.5 s. Known deviations: mean land elevation 1.5 km (Earth 0.84 km) and 15 to 24% of the surface above 1.5 km (Earth about 6%), because only thermal erosion exists so far; fluvial erosion in M3 is the physical fix. Plate speeds decay to 0.05 to 0.2 cells per step by step 200 under the collision brake; revisit when rifting of plates arrives in phase 2.

### 3.4 Hydrology (every K steps inside the loop, and once on the final state)

- Precipitation proxy inside the loop: latitude band profile times an ocean-proximity decay.
- Flow routing on the hex grid: steepest-descent neighbor; priority-flood fills closed depressions into lakes with an outlet.
- Flow accumulation (upstream area times precipitation) gives discharge.
- Fluvial erosion: stream-power law, elevation lowered proportional to discharge^m * slope^n; simple deposition in lakes and coasts.
- The final pass uses the real precipitation from 3.5 to produce the rivers, lakes and discharge layers.

### 3.5 Climate (once, on the final relief; 12 declination samples)

1. Insolation per cell per sample from latitude, axial tilt and the insolation factor.
2. Temperature: radiative baseline, minus lapse rate times elevation (lapse rate proportional to g), continentality (distance to ocean), ocean-current correction, thermal inertia across samples (ocean lags more). Produces 12 monthly fields.
3. Circulation: number of cells per hemisphere from radius and rotation (fast rotators get more bands, very slow rotators a single cell). Band edges define surface winds; Coriolis sets deflection sign and strength. A monsoon term comes from seasonal land-sea temperature contrast.
4. Ocean currents: basins found by flood-fill of the ocean; gyres driven by wind bands and bounded by continents; western boundary currents carry warm water poleward, eastern ones cold water equatorward; currents feed back into coastal temperature.
5. Moisture: evaporation over ocean proportional to temperature; advected along winds with decay; orographic lift adds rain and depletes moisture (rain shadow); convergence zones add rain. Produces 12 monthly precipitation fields.
6. Ice: sea ice where sea-surface temperature is below freezing; ice sheets where annual max land temperature is below zero (altitude included). The glacial-phase parameter lowers global temperature and sea level and extends ice. One iteration of albedo feedback.
7. Koppen classification from monthly temperature and precipitation.

### 3.6 Statistics per world

Ocean fraction, mean temperature, ice fraction, desert fraction, forest fraction, number of continents, max elevation, max depth, number of plates, longest river, lake count.

### 3.7 Explain mode (per-cell provenance)

Stored alongside outputs so the inspector can show the causal chain: plateId, crustType, crustAge, nearest boundary type and distance, orogeny step, hotspot flag, elevation components (crust, orogeny, volcanic, erosion), temperature components (insolation, altitude, continentality, current), precipitation components (advected, orographic, convergence, shadow), discharge, biome code.

## 4. Parameters

| Parameter | Unit / range | Causal path |
|---|---|---|
| seed | integer | All randomness |
| radius | km (0.3 to 2.5 x Earth) | Cell count; circulation cell count; plate size |
| density | relative to Earth | Gravity: isostasy ceiling, lapse rate |
| water volume | relative to Earth | Sea level from hypsometry |
| axial tilt | 0 to 90 degrees | Seasonal insolation amplitude, polar night |
| rotation period | hours | Coriolis, number of circulation cells, wind deflection |
| insolation | relative to Earth | Global temperature baseline |
| plate count | 4 to 30 | Initial plate seeds |
| tectonic age | steps (50 to 400) | Loop length: more orogenies, more erosion |
| glacial phase | 0 to 1 | Temperature offset, sea-level drop, ice extent |

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
| Hydrology | every land cell reaches ocean or a lake; discharge non-decreasing downstream; no river flows uphill |
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
| M6 | Ice and Koppen layers, glacial phase, gallery with statistics, explain drawer with itemized components, parameters in the URL for sharing, PNG and JSON export |

### 8.3 Rules

- The UI never computes physics; it reads `World` arrays. Anything the inspector shows must be stored by the simulator as provenance.
- Layers are pure functions from a cell to a color so the same painter serves the browser and the command-line PNG renderer.
- Interaction stays responsive: builds run in the worker, progress is per stage and per tectonic step, and a level-5 preview (M6) answers parameter changes in under two seconds.

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
