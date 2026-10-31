/**
 * Fantasy diagnostics (M28): node scripts/diag-fantasy.ts [preset|Real] [seed]
 * Prints the share of the land (or sea) each people dominates, the lairs of
 * each monster (position, score, the two strongest terms), and for the real
 * Earth the suitability and dominant people at named places where the usual
 * fantasy would put each entity.
 */
import { readFileSync } from 'node:fs';
import { EARTH_DATA_PATH, buildEarth, parseEarthElevation } from '../src/sim/earth.ts';
import { DEG, fromLatLon } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { ENTITIES, ENTITY_TERMS, FANTASY_NONE, LAIR_CODES, MONSTERS, PEOPLES, PEOPLE_COUNT, suitabilityAt, termAt } from '../src/sim/fantasy/fantasy.ts';

const [, , presetName = 'Earth', seedArg = '2'] = process.argv;
const real = presetName.toLowerCase() === 'real';
const preset = real ? PRESETS[0] : PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}"`);
  process.exit(1);
}
const t0 = performance.now();
const w = real
  ? buildEarth(parseEarthElevation((() => { const f = readFileSync(`public/${EARTH_DATA_PATH}`); return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer; })()))
  : build({ ...preset.params, seed: Number(seedArg) >>> 0 });
console.log(`build ${((performance.now() - t0) / 1000).toFixed(2)} s`);
const grid = Grid.get(w.level);
const pos = (i: number): string => `${(grid.lat[i] / DEG).toFixed(1).padStart(6)}, ${(grid.lon[i] / DEG).toFixed(1).padStart(7)}`;
const pct = (v: number): string => `${(100 * v).toFixed(1)} %`;
console.log('peoples: ' + PEOPLES.map((name, k) => `${name} ${pct(w.stats.fantasyShares[k])}${name === 'merfolk' ? ' of the sea' : ''}`).join(', '));
for (let m = 0; m < MONSTERS.length; m++) {
  const name = MONSTERS[m];
  const lairs = w.lairs.filter((l) => l.monster === m);
  console.log(`${name}: ${lairs.length} lairs`);
  lairs.forEach((l, k) => {
    const terms = ENTITY_TERMS[name].map((t, j) => [t, termAt(w.fantasyTerms, l.cell, PEOPLE_COUNT + m, j)] as const).sort((a, b) => b[1] - a[1]).slice(0, 2);
    console.log(`  ${LAIR_CODES[m]}${k + 1}  ${pos(l.cell)}  ${l.score.toFixed(2)}  ${terms.map(([t, v]) => `${t} ${v.toFixed(2)}`).join(', ')}`);
  });
}
if (real) {
  const probes: [string, string, number, number][] = [
    ['dwarves', 'Himalaya', 33, 88], ['dwarves', 'Alps', 46.5, 10], ['dwarves', 'Andes', -16, -68], ['elves', 'Black Forest', 48, 8], ['elves', 'Amazon', -3, -60],
    ['halflings', 'Loire', 47.3, 0.7], ['halflings', 'Nile delta', 30.5, 31], ['halflings', 'Ganges', 25.5, 82], ['orcs', 'Mongolia', 46, 105], ['giants', 'Tibet', 33, 90],
    ['giants', 'Patagonia', -47, -71], ['merfolk', 'Bahamas', 24, -77], ['merfolk', 'Sunda shelf', -1, 108], ['merfolk', 'Persian Gulf', 26, 52], ['merfolk', 'Great Barrier Reef', -18, 148],
    ['dragons', 'Kamchatka', 55, 160], ['dragons', 'Karakoram', 35.5, 77], ['sea serpents', 'Marianas', 12, 145], ['sea serpents', 'Peru trench', -15, -76],
    ['trolls', 'Scandes', 63, 12], ['trolls', 'Yakutia', 62, 130], ['giant spiders', 'Congo', 0, 22], ['giant spiders', 'Borneo', 1, 114],
  ];
  console.log('place           entity         suitability  dominant people');
  for (const [name, place, lat, lon] of probes) {
    const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
    let best = 0;
    let bestDot = -2;
    for (let i = 0; i < w.n; i++) {
      const dot = x * grid.xyz[3 * i] + y * grid.xyz[3 * i + 1] + z * grid.xyz[3 * i + 2];
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    // A flooded basin (the model's lakes) is not where anything lives: step to a neighbor on dry land.
    if (w.lake[best] >= 0) for (const nb of grid.neighbors(best)) if (w.lake[nb] < 0 && w.elevation[nb] >= w.seaLevel) { best = nb; break; }
    const e = ENTITIES.indexOf(name as (typeof ENTITIES)[number]);
    const p = w.fantasyPeople[best];
    console.log(`${place.padEnd(16)}${name.padEnd(15)}${suitabilityAt(w.fantasy, best, e).toFixed(2).padStart(11)}  ${p === FANTASY_NONE ? 'none' : PEOPLES[p]}`);
  }
}
