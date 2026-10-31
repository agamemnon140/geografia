/**
 * Civilization diagnostics (M24): node scripts/diag-civilization.ts [preset|Real] [seed]
 * Prints the candidate cities (position, score, the two strongest terms),
 * the dispersal summary, and for the real Earth the distance from known
 * cradles to the nearest candidate.
 */
import { readFileSync } from 'node:fs';
import { EARTH_DATA_PATH, buildEarth, parseEarthElevation } from '../src/sim/earth.ts';
import { DEG, fromLatLon } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { CITY_TERMS } from '../src/sim/civilization/civilization.ts';

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
const s = w.stats;
const pos = (i: number): string => `${(grid.lat[i] / DEG).toFixed(1).padStart(6)}, ${(grid.lon[i] / DEG).toFixed(1).padStart(7)}`;
console.log(`origin at ${pos(w.origin)}; ${s.landmassesReached} of ${s.landmassesTotal} landmasses above 100,000 km2 reached; farthest ${s.dispersalMaxKa.toFixed(0)} ka`);
console.log('rank   lat      lon    score  strongest terms');
w.cities.slice(0, 15).forEach((c, k) => {
  const terms = CITY_TERMS.map((name, t) => [name, w.cityTerms[c.cell * CITY_TERMS.length + t]] as const).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`${String(k + 1).padStart(3)}  ${pos(c.cell)}  ${c.score.toFixed(2)}  ${terms.map(([name, v]) => `${name} ${v.toFixed(2)}`).join(', ')}`);
});
if (real) {
  const cradles: [string, number, number][] = [
    ['Nile delta', 30.5, 31.2], ['Mesopotamia', 32.5, 44.5], ['Indus', 27.5, 68.5], ['Yellow River', 35, 113], ['Rome', 41.9, 12.5],
    ['Athens', 38, 23.7], ['Mexico valley', 19.4, -99.1], ['Andes (Cusco)', -13.5, -72], ['Ganges', 25.5, 82], ['Yangtze delta', 31, 120],
  ];
  const radius = w.radiusKm;
  console.log('cradle            nearest candidate  km   rank');
  for (const [name, lat, lon] of cradles) {
    const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
    let best = -1;
    let bestKm = Infinity;
    w.cities.forEach((c, k) => {
      const dot = x * grid.xyz[3 * c.cell] + y * grid.xyz[3 * c.cell + 1] + z * grid.xyz[3 * c.cell + 2];
      const km = Math.acos(Math.max(-1, Math.min(1, dot))) * radius;
      if (km < bestKm) {
        bestKm = km;
        best = k;
      }
    });
    console.log(`${name.padEnd(17)} ${pos(w.cities[best].cell)}  ${bestKm.toFixed(0).padStart(5)}  #${best + 1}`);
  }
  const probe = (name: string, lat: number, lon: number): void => {
    const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
    let i = 0;
    let bestDot = -2;
    for (let c = 0; c < w.n; c++) {
      const dot = x * grid.xyz[3 * c] + y * grid.xyz[3 * c + 1] + z * grid.xyz[3 * c + 2];
      if (dot > bestDot) { bestDot = dot; i = c; }
    }
    console.log(`${name.padEnd(17)} arrival ${w.arrivalKa[i] < 0 ? 'never' : `${w.arrivalKa[i].toFixed(0)} ka`}`);
  };
  probe('East Africa', 0, 37);
  probe('Europe', 48, 10);
  probe('Siberia', 60, 100);
  probe('Australia', -25, 135);
  probe('Alaska', 64, -150);
  probe('Patagonia', -45, -70);
  probe('Madagascar', -19, 47);
  probe('Antarctica', -80, 90);
}
