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
7. Isostasy: elevation = f(thickness, density by crustType) scaled by 1/g. Oceanic crust subsides with age (depth proportional to sqrt(age)).
8. Erosion: thermal (slope diffusion) every step; fluvial every K steps (see 3.4), stronger on young and high relief.

Sea level is solved each step as the elevation where the cumulative area below equals the water volume.

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
| Tectonics | ocean fraction 60 to 75%; bimodal hypsometry (modes near -4 km and +0.5 km); continental crust area conserved within 5%; highest cells within 3 cells of a convergent boundary; oceanic crust age grows away from ridges |
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

## 8. Phase 2 backlog

Interactive timeline; plate rifting and merging; 2D energy-balance model with ice-albedo feedback; full climate every K steps inside the loop; 3D globe; A/B compare; extra parameters (atmospheric pressure, greenhouse, orbital eccentricity, mantle heat flux, moon and tides).
