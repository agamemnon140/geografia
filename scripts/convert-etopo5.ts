/**
 * Convert NOAA's ETOPO5 grid (2160 x 4320 big-endian Int16, 5 arc-minutes,
 * first row at 90 N, first column at 0 E) into the half-degree block-mean
 * grid shipped with the app for the real-Earth reference:
 *   node scripts/convert-etopo5.ts ETOPO5.DAT public/data/earth-elevation-05deg.i16
 * Output: 360 rows x 720 columns of little-endian Int16 meters, row 0 at
 * 89.75 N, column 0 at 179.75 W. Source: NOAA NGDC ETOPO5 (1988), public domain.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input = 'ETOPO5.DAT', output = 'public/data/earth-elevation-05deg.i16'] = process.argv;
const SRC_ROWS = 2160;
const SRC_COLS = 4320;
const BLOCK = 6;
const ROWS = SRC_ROWS / BLOCK;
const COLS = SRC_COLS / BLOCK;

const bytes = readFileSync(input);
if (bytes.length !== SRC_ROWS * SRC_COLS * 2) throw new Error(`unexpected size ${bytes.length}`);
const src = (r: number, c: number): number => bytes.readInt16BE((r * SRC_COLS + c) * 2);

const out = Buffer.alloc(ROWS * COLS * 2);
let min = Infinity;
let max = -Infinity;
let landCells = 0;
for (let R = 0; R < ROWS; R++) {
  for (let C = 0; C < COLS; C++) {
    // Output column C is centered at -179.75 + 0.5 C degrees; the source starts at the prime meridian.
    const lon = -180 + 0.5 * C;
    const c0 = Math.round((((lon + 360) % 360) / 360) * SRC_COLS);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) {
      for (let j = 0; j < BLOCK; j++) sum += src(R * BLOCK + i, (c0 + j) % SRC_COLS);
    }
    const mean = Math.round(sum / (BLOCK * BLOCK));
    out.writeInt16LE(mean, (R * COLS + C) * 2);
    if (mean < min) min = mean;
    if (mean > max) max = mean;
    if (mean >= 0) landCells++;
  }
}
writeFileSync(output, out);

const at = (latDeg: number, lonDeg: number): number => {
  const R = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - latDeg) / 0.5)));
  const C = Math.min(COLS - 1, Math.max(0, Math.floor((lonDeg + 180) / 0.5)));
  return out.readInt16LE((R * COLS + C) * 2);
};
console.log(JSON.stringify({
  output,
  rows: ROWS,
  cols: COLS,
  bytes: out.length,
  minM: min,
  maxM: max,
  landFraction: (landCells / (ROWS * COLS)).toFixed(3),
  checks: {
    everestRegion: at(28, 87),
    tibet: at(33, 88),
    marianaTrench: at(11.3, 142.2),
    amazonMouth: at(0, -50),
    sahara: at(23, 10),
    northAtlantic: at(40, -30),
    antarctica: at(-80, 90),
  },
}, null, 2));
