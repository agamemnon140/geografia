/**
 * Resource diagnostics (M21), for tuning the mineral rules:
 *   node scripts/diag-resources.ts [preset] [seed]
 * Prints, per mineral, the land share with potential above 0.3, the deposit
 * count and the extremes of the loop's accumulators, then a few statistics at
 * full precision (the geography must not move when the rules change).
 */
import { Grid } from '../src/sim/grid/grid.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { MINERALS, MINERAL_COUNT } from '../src/sim/resources/minerals.ts';

const [, , presetName = 'Earth', seedArg = '2'] = process.argv;
const preset = PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}"`);
  process.exit(1);
}
const t0 = performance.now();
const w = build({ ...preset.params, seed: Number(seedArg) >>> 0 });
console.log(`build ${((performance.now() - t0) / 1000).toFixed(2)} s`);
const grid = Grid.get(w.level);
let landArea = 0;
const area = new Float64Array(MINERAL_COUNT);
const count = new Int32Array(MINERAL_COUNT);
let coalMax = 0;
let oilMax = 0;
let saltMax = 0;
let coalCells = 0;
let oilCells = 0;
let saltCells = 0;
for (let i = 0; i < w.n; i++) {
  const land = w.elevation[i] >= w.seaLevel;
  if (land) landArea += grid.area[i];
  for (let m = 0; m < MINERAL_COUNT; m++) {
    if (land && w.mineralPotential[m * w.n + i] > 0.3) area[m] += grid.area[i];
    if ((w.deposits[i] >> m) & 1) count[m]++;
  }
  if (w.coal[i] > coalMax) coalMax = w.coal[i];
  if (w.oil[i] > oilMax) oilMax = w.oil[i];
  if (w.salt[i] > saltMax) saltMax = w.salt[i];
  if (w.coal[i] > 0.01) coalCells++;
  if (w.oil[i] > 0.01) oilCells++;
  if (w.salt[i] > 0.001) saltCells++;
}
console.log('mineral     land share > 0.3   deposits');
MINERALS.forEach((name, m) => console.log(`${name.padEnd(12)} ${(100 * area[m] / landArea).toFixed(1).padStart(8)} %   ${String(count[m]).padStart(6)}`));
console.log(`accumulators: coal max ${coalMax.toFixed(2)} km on ${coalCells} cells, oil max ${oilMax.toFixed(2)} km on ${oilCells} cells, salt max ${saltMax.toFixed(3)} km on ${saltCells} cells`);
const s = w.stats;
console.log(`identity: ocean ${s.oceanFraction} meanLandElevation ${s.meanLandElevation} meanTemperature ${s.meanTemperature} seaLevel ${w.seaLevel}`);
