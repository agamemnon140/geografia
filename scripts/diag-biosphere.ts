/**
 * Biosphere diagnostics (M22): node scripts/diag-biosphere.ts [preset|Real] [seed]
 * Prints the land's primary production, the vegetation shares, and for the
 * real Earth the vegetation and productivity at named places.
 */
import { readFileSync } from 'node:fs';
import { EARTH_DATA_PATH, buildEarth, parseEarthElevation } from '../src/sim/earth.ts';
import { DEG, fromLatLon } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { nearestCell } from '../src/sim/grid/locate.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { VEGETATION_NAMES } from '../src/sim/biosphere/flora.ts';
import { LINEAGE_COUNT } from '../src/sim/tectonics/crust.ts';

const [, , presetName = 'Earth', seedArg = '2'] = process.argv;
const real = presetName.toLowerCase() === 'real';
const preset = real ? PRESETS[0] : PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}"`);
  process.exit(1);
}
const w = real
  ? buildEarth(parseEarthElevation((() => { const f = readFileSync(`public/${EARTH_DATA_PATH}`); return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer; })()))
  : build({ ...preset.params, seed: Number(seedArg) >>> 0 });
const grid = Grid.get(w.level);
const s = w.stats;
console.log(`land NPP ${s.landNppGtC.toFixed(1)} Gt C/yr (Earth about 56)`);
console.log(`faunal realms ${s.realmCount} on land above a million km2, mean endemism ${s.meanEndemism.toFixed(2)}`);
{
  const realmArea = new Float64Array(LINEAGE_COUNT);
  let landArea = 0;
  for (let i = 0; i < w.n; i++) {
    if (w.landmass[i] < 0) continue;
    landArea += grid.area[i];
    if (w.realm[i] < LINEAGE_COUNT) realmArea[w.realm[i]] += grid.area[i];
  }
  console.log('realm land shares: ' + Array.from(realmArea).map((a, k) => `${w.lineageNames[k]} ${(100 * a / landArea).toFixed(0)}%`).join(', '));
}
VEGETATION_NAMES.forEach((name, k) => {
  if (k === 0) return;
  console.log(`${name.padEnd(26)} ${(100 * s.vegetationShares[k]).toFixed(1).padStart(6)} % of land`);
});
if (real) {
  const places: [string, number, number, string][] = [
    ['Manaus', -3.1, -60.0, 'tropical rainforest'], ['Congo basin', 0, 22, 'tropical rainforest'], ['Sahara', 23, 10, 'desert'],
    ['Sahel', 14, 0, 'savanna'], ['Serengeti', -2.5, 35, 'savanna'], ['Yakutsk', 62, 129.7, 'boreal forest'], ['Kansas', 38.5, -98, 'steppe and prairie'],
    ['Kazakh steppe', 48, 68, 'steppe and prairie'], ['Lisbon', 38.7, -9.1, 'Mediterranean woodland'], ['Ohio', 40, -83, 'temperate forest'],
    ['Olympic Peninsula', 47.7, -123.8, 'temperate rainforest'], ['Taymyr', 74, 100, 'tundra'], ['Alice Springs', -23.7, 133.9, 'semi-arid scrub'],
    ['Nile delta', 31, 31, 'wetland'], ['Bangladesh', 23.5, 90, 'wetland'], ['Antarctica', -80, 90, 'ice or bare rock'],
  ];
  console.log('place               model                       expected                NPP  soil');
  for (const [name, lat, lon, expected] of places) {
    const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
    let i = nearestCell(grid, x, y, z);
    // A place the model floods as a lake is read at its nearest dry neighbor.
    if (w.lake[i] >= 0) for (const nb of grid.neighbors(i)) if (w.lake[nb] < 0 && w.elevation[nb] >= w.seaLevel) { i = nb; break; }
    console.log(`${name.padEnd(18)} ${VEGETATION_NAMES[w.vegetation[i]].padEnd(26)} ${expected.padEnd(24)} ${w.npp[i].toFixed(0).padStart(5)} ${w.soil[i].toFixed(2).padStart(5)}`);
  }
}
