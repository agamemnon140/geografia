import type { Grid } from '../grid/grid.ts';
import { SAMPLES } from './insolation.ts';

/**
 * Koppen-Geiger classification (DESIGN 3.5 step 7) from the 12 temperature
 * and precipitation samples, following Peel, Finlayson and McMahon (2007):
 * E polar by the warmest sample, B arid by the precipitation threshold that
 * depends on temperature and on which half-year gets the rain, A tropical
 * by the coldest sample, C temperate and D continental by the coldest
 * sample, with the usual dryness and warmth letters. Ocean cells get
 * OCEAN (0).
 */

export const KOPPEN_OCEAN = 0;

/** Climate codes, index into KOPPEN_NAMES and the layer palette. */
export const KOPPEN_NAMES = [
  'ocean',
  'Af tropical rainforest', 'Am tropical monsoon', 'Aw tropical savanna',
  'BWh hot desert', 'BWk cold desert', 'BSh hot steppe', 'BSk cold steppe',
  'Csa hot-summer mediterranean', 'Csb warm-summer mediterranean', 'Csc cold-summer mediterranean',
  'Cwa monsoon humid subtropical', 'Cwb subtropical highland', 'Cwc cold subtropical highland',
  'Cfa humid subtropical', 'Cfb oceanic', 'Cfc subpolar oceanic',
  'Dsa', 'Dsb', 'Dsc', 'Dsd',
  'Dwa', 'Dwb', 'Dwc', 'Dwd',
  'Dfa hot-summer continental', 'Dfb warm-summer continental', 'Dfc subarctic', 'Dfd extremely cold subarctic',
  'ET tundra', 'EF ice cap',
];

const AF = 1, AM = 2, AW = 3, BWH = 4, BWK = 5, BSH = 6, BSK = 7;
const CS = 8, CW = 11, CF = 14, DS = 17, DW = 21, DF = 25, ET = 29, EF = 30;

/** Koppen group letter (A to E) of a code, or 'O' for the ocean. */
export function koppenGroup(code: number): string {
  if (code === KOPPEN_OCEAN) return 'O';
  if (code <= AW) return 'A';
  if (code <= BSK) return 'B';
  if (code < DS) return 'C';
  if (code < ET) return 'D';
  return 'E';
}

export function classifyKoppen(
  grid: Grid,
  elevation: Float64Array,
  seaLevel: number,
  temperature: Float64Array,
  precipitation: Float64Array,
): Uint8Array {
  const n = grid.n;
  const out = new Uint8Array(n);
  const t = new Float64Array(SAMPLES);
  const p = new Float64Array(SAMPLES);
  for (let i = 0; i < n; i++) {
    if (elevation[i] < seaLevel) continue;
    let tSum = 0;
    let pSum = 0;
    let warmest = -Infinity;
    let coldest = Infinity;
    let driest = Infinity;
    let warmMonths = 0;
    for (let s = 0; s < SAMPLES; s++) {
      t[s] = temperature[s * n + i];
      // Samples are mm per year rates; a month's total is a twelfth.
      p[s] = precipitation[s * n + i] / SAMPLES;
      tSum += t[s];
      pSum += p[s];
      if (t[s] > warmest) warmest = t[s];
      if (t[s] < coldest) coldest = t[s];
      if (p[s] < driest) driest = p[s];
      if (t[s] >= 10) warmMonths++;
    }
    const tAnnual = tSum / SAMPLES;
    // Summer half-year: April to September in the north, October to March in the south.
    const north = grid.lat[i] >= 0;
    let summerP = 0;
    let summerDriest = Infinity;
    let summerWettest = -Infinity;
    let winterDriest = Infinity;
    let winterWettest = -Infinity;
    for (let s = 0; s < SAMPLES; s++) {
      const summer = north ? s >= 3 && s <= 8 : s <= 2 || s >= 9;
      if (summer) {
        summerP += p[s];
        if (p[s] < summerDriest) summerDriest = p[s];
        if (p[s] > summerWettest) summerWettest = p[s];
      } else {
        if (p[s] < winterDriest) winterDriest = p[s];
        if (p[s] > winterWettest) winterWettest = p[s];
      }
    }
    const summerShare = pSum > 0 ? summerP / pSum : 0.5;
    const offset = summerShare >= 0.7 ? 280 : summerShare <= 0.3 ? 0 : 140;
    const threshold = 20 * tAnnual + offset;

    let code: number;
    if (warmest < 10) {
      code = warmest > 0 ? ET : EF;
    } else if (pSum < threshold) {
      const hot = tAnnual >= 18;
      code = pSum < 0.5 * threshold ? (hot ? BWH : BWK) : (hot ? BSH : BSK);
    } else if (coldest >= 18) {
      code = driest >= 60 ? AF : driest >= 100 - pSum / 25 ? AM : AW;
    } else {
      const summerDry = summerDriest < 30 && summerDriest < winterWettest / 3;
      const winterDry = winterDriest < summerWettest / 10;
      const seasonality = summerDry ? 0 : winterDry ? 1 : 2;
      const warmth = warmest >= 22 ? 0 : warmMonths >= 4 ? 1 : 2;
      if (coldest >= 0) {
        code = [CS, CW, CF][seasonality] + warmth;
      } else {
        const d = coldest < -38 ? 3 : warmth;
        code = [DS, DW, DF][seasonality] + d;
      }
    }
    out[i] = code;
  }
  return out;
}
