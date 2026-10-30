# geografia

A physically-constrained world-map simulator: planets from a few physical
parameters, with relief, hydrology and climate that follow from tectonics,
circulation and ice. See [docs/DESIGN.md](docs/DESIGN.md) for the agreed scope,
model and milestones.

## Run

```
npm install
npm run dev        # app at the printed localhost URL
npm test           # physics and invariant tests (vitest)
npm run check      # type check
npm run render -- out.png Earth 1 elevation   # PNG without a browser (layers: elevation, rivers, temperature, wind, precipitation, currents, sstAnomaly, plates, crustAge, thickness, cells)
npm run render -- jan.png Earth 1 temperature 1440 0   # seasonal layers take a month index 0-11 after the width
node scripts/diag-tectonics.ts Earth 1 200 20 # per-step tectonics and hydrology diagnostics for tuning
node scripts/diag-climate.ts Earth 1          # zonal precipitation, temperature, wind and current diagnostics
```

## Layout

- `src/sim/` pure, deterministic simulation (no DOM)
- `src/worker/` runs the simulation off the main thread
- `src/render/` equirectangular painter and layers
- `src/ui/` parameter panel, map, inspector
- `tests/` per-link tests with the Earth preset
- `scripts/` command-line tools
