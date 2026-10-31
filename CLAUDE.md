# geografia: project brief for a new conversation

A physically constrained world-map simulator (TypeScript, Vite, Vitest; a Web
Worker runs the simulation; Canvas 2D renders; no runtime dependencies).
Live at https://agamemnon140.github.io/geografia/ (GitHub Pages, deployed on
every push to `main` of https://github.com/agamemnon140/geografia). Local:
`npm run dev` (http://localhost:5173/), `npm test`, `npm run check`.

## How the owner wants to work

- Henrique writes in Portuguese; reply in Portuguese. Code, comments, docs,
  UI text and commit messages are in English.
- One commit per milestone (M-numbers), with tests passing, the production
  build checked, `docs/DESIGN.md` updated (it is the source of truth), and a
  Portuguese recap that gives numbers against the real Earth and lists the
  known deviations honestly. Pushing to GitHub was explicitly authorized
  ("autorizo"); push after each milestone and confirm the Pages deploy and
  the CI tests run (`gh run list`, `gh run watch`).
- The simulator matters more than visuals, but aesthetics and legibility are
  judged closely. Feedback so far, in order: continents looked like "medium
  potatoes" (M12, M13); "nothing like Europe or Central America" (M14);
  "still not as dissected as Europe", with seed 282101170 as the reference
  (M17); "dozens of small peaks" on seed 4183608316 and too many rivers and
  lakes in dry regions (M18). Requests also came mid-task; address them in
  order and keep each milestone whole.
- Several requests arrive at once; finish each in full, say what was left
  out and why.

## What has been built (M0 to M19)

- M0-M6 (v1): geodesic grid (icosahedron level 6, 40,962 cells), PRNG,
  worker protocol, tectonics loop with sea level, hydrology (priority flood,
  lakes with evaporation balance, stream-power erosion inside the loop),
  insolation, energy-balance climate, circulation, Stommel ocean gyres,
  moisture advection, ice, Koppen, presets, gallery, explain drawer.
- M7-M10 (phase 2): timeline with streamed keyframes; plate rifting and
  merging with mantle heat; 2D energy-balance model (North) with ice-albedo
  feedback, greenhouse, pressure and eccentricity; views (globe, compare).
- M11: per-pixel interpolation, hillshade, river lines; the real Earth from
  ETOPO5 (`public/data/earth-elevation-05deg.i16`) through the same links;
  climate recalibrated against it.
- M12: planets start as a rifted supercontinent (replaced in M13); Koppen
  legend in plain words, palette by family, blue only for water.
- M13: one lobed supercontinent with a bent, stair-stepped first rift
  (`src/sim/tectonics/genesis.ts`, `riftpath.ts`); slab pull; uneven rifts,
  40% failing into gulfs; collisions restore margins so seaways close
  (foreland instead of trench under buoyant crust); arcs keep polarity and
  accrete at 8 km of volcanics; Andean shortening; datum +250 m.
- M14: back-arc basins by slab rollback (arcs become small plates), sliver
  capture at sliding coasts; up to 22 plates.
- M15: Equal Earth view (`src/render/equalearth.ts`, projection id in
  `raster.ts`); web manifest and icons (`scripts/make-icons.ts`).
- M16: the real Earth's past: PALEOMAP PaleoDEMs (Scotese and Wright 2018,
  CC BY 4.0), 20 slices 200-10 Ma in `public/data/earth-history-1deg.i16`,
  streamed as keyframes after the present (`scripts/convert-paleodem.ts`).
- M17: dissected coasts: slab break-off (no pull during collision) so
  remnant seas survive; rollback hinged at one trench end (peninsulas);
  basins of 5 km and a 33 km coastal-plain margin cell; deltas fill only to
  the water surface (the old spill made rings of hills around lakes).
- M18: resolution independence: constants in reference cells of ~112 km
  (`REFERENCE_CELL_KM`) converted per grid (`unitAngle`, `cellsPerUnit` in
  `TectonicsSim`); Fine grid option (level 7, ~34 s); Budyko runoff
  (`runoffFraction`); merge/capture aliasing fixed (`placeInFrame` moves a
  parcel to a free cell instead of stacking crust into 5 km peaks).
- M19: the Model view in the app (`src/ui/model.ts`) and this brief.

## Where things are

- `docs/DESIGN.md`: the specification, mechanism by mechanism, with
  calibration status after each milestone and known deviations. Read 3.3
  (tectonics), 3.4 (hydrology), 3.5 (climate), 3.9 (real Earth), 7
  (milestones), 8 (UI).
- `src/sim/tectonics/`: `simulation.ts` (the loop: advect, resolve
  conflicts, fill gaps, classify boundaries, elevation, erosion, events),
  `genesis.ts` (initial condition), `riftpath.ts`, `crust.ts` (constants
  with their justification), `plates.ts`, `parcels.ts`.
- `src/sim/hydrology/`, `src/sim/climate/` (ebm, temperature, circulation,
  ocean, moisture, ice, koppen), `src/sim/pipeline.ts` (build, finalize,
  history, World type), `src/sim/earth.ts` (real Earth, past).
- `src/render/` (layers, paint, raster, globe, map, equalearth, legend),
  `src/ui/app.ts` (the app), `src/ui/model.ts` (Model view text),
  `src/worker/` (protocol, worker, client).
- `scripts/`: `render-png.ts out.png [preset|Real] [seed] [layer] [width]`,
  `render-globe.ts`, `diag-tectonics.ts`, `diag-climate.ts [Real]`,
  `convert-etopo5.ts`, `convert-paleodem.ts`, `make-icons.ts`.
- `tests/`: 19 files, 113 tests; CI budget for the full build is 60 s.

## Calibration state (Earth preset, 200 steps, several seeds)

Ocean 66-74% (Earth 71); landmasses above a million km2 4-9 (Earth 4-7);
largest landmass 35-85% of the land (57); mean land elevation 0.3-1.0 km
(0.84 with ice); surface above 1.5 km 1-7% (6 with ice); mean ocean depth
3.5-4.0 km (3.7); mean temperature 11-14 C (14.5); 13-19 plates alive.
Real Earth through the climate links: 14.5 C mean, Koppen A15/B26/C16/D17/E26
(Earth 19/30/14/25/13), land precipitation about 1,000 mm.

Known biases: boreal belt 5-9 C too cold; subtropical deserts too cool;
permanent sea ice overestimated; compact-continent planets colder and more
arid; plate boundaries jagged at the cell scale; a few dozen one-cell suture
spikes after collisions; past greenhouse not applied to the Earth timeline.

## Lessons that are not obvious from the code

- The ocean fraction barely responds to the continental fraction: the sea
  level moves with it. What sets it is how much continental crust is flooded
  (shelves, basins). Arc accretion raises the sea by about 200 m per run.
- Any per-cell cap combined with "spill to all neighbors" makes rings; any
  resampling between two lattices aliases parcels onto one cell. Bound
  deposition by the water surface; place displaced parcels in free cells.
- Longer tectonic ages do not converge to fewer continents: the system
  cycles (rifts, failures, arcs, dockings). The default 200 steps is Earth's
  time since Pangea's breakup.
- Every model change changes every seed's history (chaos); judge by the
  ranges over several seeds, not by one map.
- Useful diagnostics: isolated-peak counts attributed to crust, volcanic or
  sediment; near-sea-level hypsometry bands against the real Earth (Earth:
  4.1% of the surface in -200..0 m, 7.7% in 0..200 m); per-seed event
  summaries; thickness, plates, rivers and precipitation renders.

## Candidates for what comes next

- Phase 3 of the vision (biosphere: flora and fauna on the timeline), then
  phase 4 (civilization), as `docs/DESIGN.md` section 9 lays out.
- Aesthetics still open: smoothing plate boundaries at the cell scale;
  spreading collision thickening over two rings to remove suture spikes;
  glacial carving and post-glacial flooding for fjords and archipelagos.
- Earth timeline: apply a past greenhouse so the Cretaceous is warm.
- Climate biases above (boreal cold, cool deserts, sea ice).
