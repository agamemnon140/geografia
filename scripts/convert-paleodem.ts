/**
 * Convert the PALEOMAP PaleoDEMs (Scotese and Wright, 2018; CC BY 4.0) into
 * the one-degree history grid shipped with the app for the real Earth's
 * timeline:
 *   node scripts/convert-paleodem.ts <dir with MapNN_AAAMa.csv> [public/data/earth-history-1deg.i16]
 * The source files list nodes at integer degrees (361 longitudes from -180 to
 * 180, 181 latitudes from 90 to -90) as "lon,lat,elev". Each shipped slice is
 * 180 rows x 360 columns of cell-centered little-endian Int16 meters (the
 * mean of the four corner nodes), row 0 at 89.5 N, column 0 at 179.5 W;
 * slices run from the oldest age to the youngest, every 10 million years
 * from 200 to 10 Ma. The present (0 Ma) is not included: the app uses the
 * ETOPO5 relief for it.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir = '.', output = 'public/data/earth-history-1deg.i16'] = process.argv;
const AGES: number[] = [];
for (let age = 200; age >= 10; age -= 10) AGES.push(age);
const ROWS = 180;
const COLS = 360;

const files = readdirSync(dir);
const out = Buffer.alloc(AGES.length * ROWS * COLS * 2);
AGES.forEach((age, k) => {
  const suffix = `_${String(age).padStart(3, '0')}Ma.csv`;
  const name = files.find((f) => f.endsWith(suffix));
  if (!name) throw new Error(`no file for ${age} Ma (looked for *${suffix})`);
  const nodes = new Float64Array(181 * 361).fill(NaN);
  // Some of the files end their lines with a bare carriage return.
  for (const line of readFileSync(join(dir, name), 'utf8').split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [lon, lat, elev] = line.split(',').map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(elev)) continue;
    const r = Math.round(90 - lat);
    const c = Math.round(lon + 180);
    if (r < 0 || r > 180 || c < 0 || c > 360) continue;
    nodes[r * 361 + c] = elev;
  }
  let land = 0;
  let missing = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = nodes[r * 361 + c];
      const b = nodes[r * 361 + c + 1];
      const d = nodes[(r + 1) * 361 + c];
      const e = nodes[(r + 1) * 361 + c + 1];
      const values = [a, b, d, e].filter((v) => Number.isFinite(v));
      if (values.length === 0) missing++;
      const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : -4000;
      const clamped = Math.max(-32000, Math.min(32000, Math.round(mean)));
      out.writeInt16LE(clamped, ((k * ROWS + r) * COLS + c) * 2);
      if (clamped >= 0) land++;
    }
  }
  console.log(`${String(age).padStart(3)} Ma  ${name.padEnd(18)} land ${((land / (ROWS * COLS)) * 100).toFixed(1)}% of cells${missing ? `, ${missing} empty` : ''}`);
});
writeFileSync(output, out);
console.log(`${output}: ${AGES.length} slices, ${out.length} bytes`);
