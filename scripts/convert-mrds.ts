/**
 * Convert the USGS Mineral Resources Data System (public domain, worldwide
 * but most complete inside the United States) into the one-degree deposit
 * mask the app ships for the real Earth (M21):
 *   node scripts/convert-mrds.ts <mrds.csv> [public/data/earth-minerals-1deg.u8]
 * Download the zipped CSV by hand from https://mrdata.usgs.gov/mrds/ (the
 * server refuses automated clients) and unzip it. The CSV has a header; the
 * columns used are latitude, longitude, commod1..commod3 (commodity names)
 * and, when present, dev_stat (developments: only producers and past
 * producers count, so prospects and occurrences do not litter the map).
 * Output: 180 rows x 360 columns of bytes, row 0 at 89.5 N, column 0 at
 * 179.5 W, bit m set where mineral m of resources/minerals.ts MINERALS has
 * a producing deposit in that cell. Oil and gas are not in MRDS and stay
 * unset.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MINERALS } from '../src/sim/resources/minerals.ts';

const [, , input, output = 'public/data/earth-minerals-1deg.u8'] = process.argv;
if (!input) {
  console.error('usage: node scripts/convert-mrds.ts <mrds.csv> [output]');
  process.exit(1);
}

/** Commodity names (upper case, as MRDS writes them) per mineral. */
const COMMODITIES: Record<(typeof MINERALS)[number], string[]> = {
  iron: ['IRON'],
  copper: ['COPPER'],
  gold: ['GOLD', 'TIN'],
  uranium: ['URANIUM'],
  coal: ['COAL', 'COAL-BITUMINOUS', 'COAL-ANTHRACITE', 'COAL-LIGNITE', 'COAL-SUBBITUMINOUS'],
  oil: [],
  salt: ['SALT', 'HALITE', 'POTASSIUM', 'POTASH', 'SODIUM', 'GYPSUM-ANHYDRITE'],
};

/** Split one CSV line, honoring double quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

const text = readFileSync(input, 'utf8');
const lines = text.split(/\r?\n/);
const header = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
const col = (name: string): number => header.indexOf(name);
const latCol = col('latitude');
const lonCol = col('longitude');
const commodityCols = ['commod1', 'commod2', 'commod3'].map(col).filter((c) => c >= 0);
const statusCol = col('dev_stat');
if (latCol < 0 || lonCol < 0 || commodityCols.length === 0) {
  console.error(`header lacks latitude, longitude or commod1: ${header.slice(0, 20).join(', ')}`);
  process.exit(1);
}

const ROWS = 180;
const COLS = 360;
const mask = new Uint8Array(ROWS * COLS);
let used = 0;
const perMineral = new Array<number>(MINERALS.length).fill(0);
for (let k = 1; k < lines.length; k++) {
  if (!lines[k]) continue;
  const fields = splitCsv(lines[k]);
  const lat = Number(fields[latCol]);
  const lon = Number(fields[lonCol]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
  if (statusCol >= 0) {
    const status = (fields[statusCol] ?? '').toLowerCase();
    if (!status.includes('producer')) continue;
  }
  const names = commodityCols.map((c) => (fields[c] ?? '').trim().toUpperCase()).filter((s) => s.length > 0);
  let bits = 0;
  MINERALS.forEach((m, i) => {
    if (COMMODITIES[m].some((name) => names.includes(name))) bits |= 1 << i;
  });
  if (!bits) continue;
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor(90 - lat)));
  const c = Math.min(COLS - 1, Math.max(0, Math.floor(lon + 180)));
  mask[r * COLS + c] |= bits;
  used++;
  MINERALS.forEach((_, i) => {
    if ((bits >> i) & 1) perMineral[i]++;
  });
}
writeFileSync(output, mask);
console.log(`${used} producing deposits from ${lines.length - 1} records -> ${output}`);
MINERALS.forEach((m, i) => console.log(`${m.padEnd(10)} ${perMineral[i]}`));
