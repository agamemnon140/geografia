# geografia

A physically-constrained world-map simulator: planets from a few physical
parameters, with relief, hydrology and climate that follow from tectonics,
circulation, currents and ice. See [docs/DESIGN.md](docs/DESIGN.md) for the
agreed scope, the model, each milestone's mechanisms and the calibration
status against Earth.

## Run

```
npm install
npm run dev        # app at the printed localhost URL
npm test           # physics and invariant tests (vitest)
npm run check      # type check
npm run render -- out.png Earth 1 elevation   # PNG without a browser
npm run render -- jan.png Earth 1 temperature 1440 0   # seasonal layers take a month index 0-11 after the width
node scripts/diag-tectonics.ts Earth 1 200 20 # per-step tectonics and hydrology diagnostics for tuning
node scripts/diag-climate.ts Earth 1          # zonal precipitation, temperature, wind and current diagnostics
```

Layers: elevation, koppen, ice, rivers, temperature, wind, precipitation,
currents, sstAnomaly, plates, crustAge, thickness, cells.

## The app

- Pick a preset or edit the parameters (ten physical ones plus mantle heat,
  greenhouse, air pressure and eccentricity from phase 2); every edit
  rebuilds a coarse preview in under two seconds (toggle), Build planet runs
  the full grid.
- Layers with a month slider for the seasonal ones; click a cell for the
  explain drawer, which itemizes where its elevation, water, temperature and
  biome come from.
- Full builds join the gallery strip under the map; click a thumbnail to
  restore it. The URL hash holds the parameters, so a link rebuilds the same
  planet. Export the current layer as PNG or the parameters and statistics
  as JSON.
- After a full build its history streams in: drag the slider under the map
  or press Play to watch continents drift, mountains rise and erode, and
  climates shift, with every layer and the explain drawer available at each
  step. Export history writes the keyframes of the current layer as one PNG
  strip.
- Three views in the bar above the stage: Map, Globe (drag to turn, click to
  inspect; software-rendered, no WebGL) and Compare (A follows the history
  slider, B is any keyframe or any gallery planet, with the statistics in
  two columns). A legend sits under the layer selector.

## Layout

- `src/sim/` pure, deterministic simulation (no DOM): grid, rng, tectonics, hydrology, climate
- `src/worker/` runs the simulation off the main thread
- `src/render/` equirectangular painter and layers
- `src/ui/` parameter panel, map, explain drawer, gallery
- `tests/` per-link tests with the Earth preset
- `scripts/` command-line tools
