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
npm run render -- out.png Earth 1 elevation   # PNG without a browser (layers: elevation, rivers, precipitation, plates, crustAge, thickness, cells)
node scripts/diag-tectonics.ts Earth 1 200 20 # per-step tectonics and hydrology diagnostics for tuning
```

## Layout

- `src/sim/` pure, deterministic simulation (no DOM)
- `src/worker/` runs the simulation off the main thread
- `src/render/` equirectangular painter and layers
- `src/ui/` parameter panel, map, inspector
- `tests/` per-link tests with the Earth preset
- `scripts/` command-line tools
