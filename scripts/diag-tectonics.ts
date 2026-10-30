/**
 * Step-by-step diagnostics of the tectonic simulation, for tuning:
 *   node scripts/diag-tectonics.ts [preset] [seed] [steps] [every]
 */
import { Grid, cellAreasKm2, levelForRadius } from '../src/sim/grid/grid.ts';
import { PRESETS, validateParams } from '../src/sim/params.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { CONTINENTAL } from '../src/sim/tectonics/crust.ts';
import { TectonicsSim } from '../src/sim/tectonics/simulation.ts';

const [, , presetName = 'Earth', seedArg = '1', stepsArg, everyArg = '20'] = process.argv;
const preset = PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}"`);
  process.exit(1);
}
const params = validateParams({ ...preset.params, seed: Number(seedArg) >>> 0 });
const steps = stepsArg ? Number(stepsArg) : params.tectonicAge;
const every = Number(everyArg);
const grid = Grid.get(levelForRadius(params.radiusKm));
const area = cellAreasKm2(grid, params.radiusKm);
const sim = new TectonicsSim(grid, params, new Rng(params.seed).fork('tectonics'));
const v0 = sim.continentalVolume();

function report(): void {
  const pool = sim.pool;
  let maxT = 0;
  let maxTOceanic = 0;
  let maxV = 0;
  let maxS = 0;
  let alive = 0;
  for (let i = 0; i < pool.count; i++) {
    if (!pool.alive[i]) continue;
    alive++;
    if (pool.crustType[i] === CONTINENTAL) maxT = Math.max(maxT, pool.thickness[i]);
    else maxTOceanic = Math.max(maxTOceanic, pool.thickness[i]);
    maxV = Math.max(maxV, pool.volcanic[i]);
    maxS = Math.max(maxS, pool.sediment[i]);
  }
  let total = 0;
  let cont = 0;
  let land = 0;
  let landSum = 0;
  let maxE = -Infinity;
  for (let j = 0; j < grid.n; j++) {
    total += area[j];
    if (pool.crustType[sim.wParcel[j]] === CONTINENTAL) cont += area[j];
    const rel = sim.elevation[j] - sim.seaLevel;
    if (rel >= 0) {
      land += area[j];
      landSum += area[j] * rel;
    }
    maxE = Math.max(maxE, rel);
  }
  const v = (sim.continentalVolume() + sim.erodedContinental) / v0;
  const rates = sim.plates.map((p) => (p.rate / sim.cellAngle).toFixed(2)).join(' ');
  const lakes = sim.hydrology.lakes;
  const endorheic = lakes.filter((l) => l.endorheic).length;
  console.log(
    `step ${String(sim.step).padStart(3)} | alive ${alive} | cont ${(cont / total * 100).toFixed(1)}% land ${(land / total * 100).toFixed(1)}% ` +
    `| maxT ${maxT.toFixed(0)} km (oce ${maxTOceanic.toFixed(0)}) maxV ${maxV.toFixed(1)} maxS ${maxS.toFixed(1)} | maxE ${maxE.toFixed(0)} m meanLand ${(land > 0 ? landSum / land : 0).toFixed(0)} m sea ${sim.seaLevel.toFixed(0)} ` +
    `| vol ${v.toFixed(3)} | lakes ${lakes.length} (${endorheic} closed) | plates ${sim.activePlates()}/${sim.plates.length} events ${sim.events.length} | rates ${rates}`,
  );
}

report();
const t0 = performance.now();
for (let s = 1; s <= steps; s++) {
  sim.stepOnce();
  if (s % every === 0 || s === steps) report();
}
console.log(`elapsed ${((performance.now() - t0) / 1000).toFixed(2)} s for ${steps} steps`);
for (const e of sim.events) {
  console.log(e.type === 'rift' ? `step ${e.step}: plate ${e.plate} rifted from plate ${e.other}` : `step ${e.step}: plate ${e.plate} merged into plate ${e.other}`);
}
