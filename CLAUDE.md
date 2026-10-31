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
- M20: clouds and sunshine (`src/sim/climate/clouds.ts`): cloud cover per
  sample from the moisture state (humidity proxy, lifted cloud, a marine
  deck, stratus over cold currents, clearing by sinking air) feeds back into
  the energy balance (clear-sky albedos under a reflecting cloud by the
  two-stream rule, trapped longwave per cell); the climate runs in two
  passes (a prior pass one level coarser, then the final one); Sunshine
  (annual) and Cloud cover (seasonal) layers; A of the OLR is now the
  clear-sky 237 W/m2.
- M21: resources and the UI beyond geography: seven mineral potentials
  from the provenance (`src/sim/resources/minerals.ts`; shields, arcs,
  collision belts; coal, oil and salt as parcel accumulators recorded
  inside the loop in `deposit()` and at each fluvial pass) with deposits
  drawn by a hash of the seed; the "Beyond geography" checkbox and a
  second layer dropdown (Resources / Life / Civilization groups, `Layer.group`,
  `Section.group`), so the app is unchanged when it is off; one-column
  mobile layout under 820 px and pinch zoom on the map; the real Earth
  takes measured deposits from `public/data/earth-minerals-1deg.u8` when
  the file exists (`scripts/convert-mrds.ts`; the USGS server refused
  automated downloads, so it is not shipped yet).
- M22: flora (`src/sim/biosphere/flora.ts`): net primary productivity by
  the Miami model (Lieth 1975) scaled by sunshine and soil; soil fertility
  itemized (base, volcanic ash, alluvium, leaching, old shield, cold);
  thirteen vegetation classes from the monthly climate, the rivers and the
  productivity; no succession. Layers Primary productivity, Soil fertility,
  Vegetation (Life group); Flora section in Explain; production row in
  Statistics; `scripts/diag-biosphere.ts [Real]`.
- M23: fauna (`src/sim/biosphere/fauna.ts`; lineage bookkeeping in
  `parcels.ts` / `simulation.ts` `seedLineages`, `mixLineages`,
  `mergeLineages`, constants `LINEAGE_*` in `crust.ts`): eight ancestral
  lineages per crust parcel, seeded by sector around the supercontinent,
  diffused along the land at each fluvial pass (never across the sea),
  averaged on merges; on the final relief realm (dominant lineage),
  endemism, richness (species-energy x species-area), megafauna bits; the
  real Earth gets one lineage per large landmass (no history). Layers
  Faunal realms, Endemism, Species richness, Megafauna; Fauna section in
  Explain; realms row in Statistics.
- M24: civilization, first slice (`src/sim/civilization/civilization.ts`):
  habitability (food, water, comfort), agricultural potential, an eight-term
  city-site score with thirty candidate cities 500 km apart (numbered on
  the map and the globe: `Layer.labels`), human dispersal by shortest path
  from a rule-chosen origin (terrain costs, open water at 6 per cell,
  glacial bridges within 120 m, horizon 100 ka). Layers Habitability,
  Agricultural potential, City sites, Human dispersal; Civilization section
  in Explain; two rows in Statistics; `scripts/diag-civilization.ts [Real]`.
- M25: the age since Pangea: `tectonicAge` read as million years since the
  supercontinent began to rift, 0 to 400 (0 is the genesis itself, 3 s; 400
  steps take 14 s at level 6), presets Pangea and Old planet; timeline
  keyframes every 25 million years (`keyframeStepsEvery`,
  `BuildOptions.keyframeInterval`), the interval widening to keep at most
  eight (every 50 at 400); every label in the app speaks in million years.

## Where things are

- `docs/DESIGN.md`: the specification, mechanism by mechanism, with
  calibration status after each milestone and known deviations. Read 3.3
  (tectonics), 3.4 (hydrology), 3.5 (climate), 3.9 (real Earth), 7
  (milestones), 8 (UI).
- `src/sim/tectonics/`: `simulation.ts` (the loop: advect, resolve
  conflicts, fill gaps, classify boundaries, elevation, erosion, events),
  `genesis.ts` (initial condition), `riftpath.ts`, `crust.ts` (constants
  with their justification), `plates.ts`, `parcels.ts`.
- `src/sim/resources/minerals.ts` (M21), `src/sim/biosphere/flora.ts`
  (M22), `src/sim/biosphere/fauna.ts` (M23); worlds without a tectonic history (the real Earth) carry
  `BuildContext.noHistory`, which silences the rules that read the
  provenance.
- `src/sim/hydrology/`, `src/sim/climate/` (ebm, temperature, circulation,
  ocean, moisture, clouds, ice, koppen), `src/sim/pipeline.ts` (build, finalize,
  history, World type), `src/sim/earth.ts` (real Earth, past).
- `src/render/` (layers, paint, raster, globe, map, equalearth, legend),
  `src/ui/app.ts` (the app), `src/ui/model.ts` (Model view text),
  `src/worker/` (protocol, worker, client).
- `scripts/`: `render-png.ts out.png [preset|Real] [seed] [layer] [width]`,
  `render-globe.ts`, `diag-tectonics.ts`, `diag-climate.ts [Real]`,
  `diag-resources.ts [preset] [seed]`, `convert-etopo5.ts`,
  `convert-paleodem.ts`, `convert-mrds.ts <mrds.csv>`, `make-icons.ts`.
- `tests/`: 24 files, 134 tests; CI budget for the full build is 60 s.
  `tests/minerals.test.ts` pins seed 2's ocean fraction, mean land
  elevation, mean temperature and sea level to the M20 values: anything
  that changes the geography fails it on purpose.

## Calibration state (Earth preset, 200 steps, several seeds)

Ocean 66-74% (Earth 71); landmasses above a million km2 4-9 (Earth 4-7);
largest landmass 35-85% of the land (57); mean land elevation 0.3-1.0 km
(0.84 with ice); surface above 1.5 km 1-7% (6 with ice); mean ocean depth
3.5-4.0 km (3.7); mean temperature 13.8-14.8 C (14.5); 13-19 plates alive;
cloud cover 0.58-0.61. Real Earth through the climate links: 14.6 C mean,
equator 27.4, Koppen A17/B26/C15/D17/E26 (Earth 19/30/14/25/13), land
precipitation about 1,000 mm, clouds 0.61 of the sky reflecting 45 W/m2 and
trapping 24 (Earth 0.66, 47, 27); sunshine Sahara 4,270 h/yr (3,600),
Manaus 1,920 (1,900), London 1,980 (1,600).

Known biases: boreal belt 3-7 C too cold (London 4 C against 11; it was 1
before M20); subtropical deserts 5-7 C too cool (Sahara 19 against 26; it
was 14); permanent sea ice overestimated (10% of the ocean on the real
Earth, 12-20% on simulated planets, Earth 3%); polar plateaus too wet and
therefore too cloudy; regions the moisture model leaves too dry (Japan, the
Pampas) come out too sunny; compact-continent planets colder and more
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
  summaries; thickness, plates, rivers and precipitation renders;
  `diag-climate.ts Real` prints cloud and sunshine per band and at twenty
  named places against station normals.
- The energy balance responds about one degree per W/m2 (ice feedback), so
  every cloud constant moves the global mean: retune `OLR_A` last, after
  the cloud pattern. The humidity proxy is a column ratio (what the winds
  bring over what the surface holds), low wherever the winds export
  moisture, hence the marine deck and the low ramp start.
- `scripts/render-png.ts` prints the whole stats JSON; pipe it through
  `tail -3` in a session.
- The Bash tool here fails to parse very long commands with several
  heredocs; keep each heredoc under about 50 lines and large files go
  through the Write tool. Constants used inside the `LAYERS` literal must
  be declared above it (temporal dead zone at module load).
- USGS data servers (mrdata.usgs.gov, sciencebase.gov) sit behind a
  Cloudflare challenge: no automated download works; ask the owner to
  download by hand.

## Candidates for what comes next

- The rest of phase 4 (`docs/DESIGN.md` 9.3): domestication potential from
  flora and fauna, the spread of the agricultural package along latitude
  bands, trade routes and centrality, a user-picked dispersal origin.
- Speciation in the fauna (isolated landmasses growing their own
  lineages) and succession in the flora.
- Measured deposits for the real Earth once the USGS MRDS CSV is
  downloaded by hand (`scripts/convert-mrds.ts`).
- Aesthetics still open: smoothing plate boundaries at the cell scale;
  spreading collision thickening over two rings to remove suture spikes;
  glacial carving and post-glacial flooding for fjords and archipelagos.
- Earth timeline: apply a past greenhouse so the Cretaceous is warm.
- Climate biases above (boreal cold, cool deserts, sea ice).
- Asked by the owner on 2026-10-31, for after M24: (1) choosing the
  planet's age since its Pangea before building, 0 to 400 million years
  (done in M25); (2) composition
  parameters that reach minerals, flora and fauna (atmospheric oxygen,
  crustal iron and other abundances, with causal paths like the other
  parameters); (3) an optional fantasy layer, off by default, estimating
  where typical fantasy peoples (dwarves, elves) and monsters would live
  from the same geography, flora and fauna, as an explicit sandbox rule set.
