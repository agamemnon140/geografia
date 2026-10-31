/**
 * Composition diagnostics (M26): node scripts/diag-composition.ts [seed] [coarser]
 * Builds Earth, Oxygen-rich, Low oxygen, Iron world and Greenhouse (one level
 * coarser by default) and prints, for each, the land productivity, the
 * vegetation shares the fire regime moves, the megafauna, the habitable land
 * and the dispersal reach, and the deposits per mineral: the numbers for a
 * recap of what each composition parameter does.
 */
import { MEGAFAUNA_GIANT_ARTHROPODS, MEGAFAUNA_HERBIVORES } from '../src/sim/biosphere/fauna.ts';
import { VEG_SAVANNA, VEG_SEASONAL, VEG_STEPPE, VEG_TEMPERATE } from '../src/sim/biosphere/flora.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { MINERALS } from '../src/sim/resources/minerals.ts';

const [, , seedArg = '2', coarserArg = '1'] = process.argv;
const seed = Number(seedArg) >>> 0;
const coarser = Number(coarserArg);
const pct = (v: number): string => `${(100 * v).toFixed(1)} %`;

for (const name of ['Earth', 'Oxygen-rich', 'Low oxygen', 'Iron world', 'Greenhouse']) {
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) continue;
  const t0 = performance.now();
  const w = build({ ...preset.params, seed }, () => {}, { coarser });
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  let land = 0;
  let habitable = 0;
  let herbivores = 0;
  let giants = 0;
  for (let i = 0; i < w.n; i++) {
    if (w.elevation[i] < w.seaLevel || w.lake[i] >= 0) continue;
    land++;
    if (w.habitability[i] > 0.1) habitable++;
    if (w.megafauna[i] & MEGAFAUNA_HERBIVORES) herbivores++;
    if (w.megafauna[i] & MEGAFAUNA_GIANT_ARTHROPODS) giants++;
  }
  const deposits = MINERALS.map((m, k) => `${m} ${w.stats.depositCounts[k]}`).join(', ');
  const v = w.stats.vegetationShares;
  console.log(`${name.padEnd(12)} ${seconds} s  oxygen ${pct(w.params.oxygen)}, greenhouse x${w.params.greenhouse}, iron x${w.params.crustIron}`);
  console.log(`  growth ${w.stats.landNppGtC.toFixed(0)} Gt C/yr on land; savanna ${pct(v[VEG_SAVANNA])}, seasonal forest ${pct(v[VEG_SEASONAL])}, temperate forest ${pct(v[VEG_TEMPERATE])}, steppe ${pct(v[VEG_STEPPE])}`);
  console.log(`  large herbivores on ${pct(herbivores / land)} of the land, giant arthropods on ${pct(giants / land)}; habitable (above 0.1) ${pct(habitable / land)}; people reach ${w.stats.landmassesReached} of ${w.stats.landmassesTotal} landmasses`);
  console.log(`  deposits: ${deposits}`);
}
