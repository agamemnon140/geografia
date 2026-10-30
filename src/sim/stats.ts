import type { CirculationInfo } from './climate/circulation.ts';
import { SAMPLES } from './climate/insolation.ts';
import { koppenGroup } from './climate/koppen.ts';
import type { BasinInfo } from './climate/ocean.ts';
import { DEG } from './grid/geometry.ts';
import type { Grid } from './grid/grid.ts';
import type { LakeInfo } from './hydrology/routing.ts';

/** Per-world summary statistics (DESIGN 3.6). */

export const HYPSOMETRY_MIN_M = -8000;
export const HYPSOMETRY_BIN_M = 500;
export const HYPSOMETRY_BINS = 32;
/** Land drier than this is desert for the statistics, mm per year. */
export const DESERT_MM = 250;
/** A landmass at least this big counts as a continent, km^2 (Australia is 7.7 million). */
export const CONTINENT_MIN_KM2 = 1e6;

export interface WorldStats {
  oceanFraction: number;
  landFraction: number;
  /** Fraction of the surface underlain by continental crust (shelves included). */
  continentalFraction: number;
  minElevation: number;
  maxElevation: number;
  meanLandElevation: number;
  meanOceanDepth: number;
  maxThickness: number;
  activePlates: number;
  totalAreaKm2: number;
  /** Area fraction per 500 m elevation bin from -8000 m, relative to sea level. */
  hypsometry: number[];
  /** Landmasses at least CONTINENT_MIN_KM2; smaller ones are islands. */
  continents: number;
  islands: number;
  largestLandmassKm2: number;
  /** Area-weighted precipitation over land, mm per year. */
  meanLandPrecipitation: number;
  lakeCount: number;
  endorheicLakeCount: number;
  /** Lake water area as a fraction of the land area. */
  lakeFraction: number;
  /** Land area whose rivers end in a closed basin, as a fraction of the land area. */
  endorheicLandFraction: number;
  longestRiverKm: number;
  /** Largest discharge anywhere, km^3 per year (found at a river mouth). */
  largestRiverKm3: number;
  /** Area-weighted annual-mean surface temperature, degrees C. */
  meanTemperature: number;
  /** Annual mean within 5 degrees of the equator. */
  equatorTemperature: number;
  /** Annual mean poleward of 80 degrees, both poles. */
  poleTemperature: number;
  /** Mean seasonal range (warmest minus coldest sample) over land between 40 and 60 degrees. */
  landSeasonalRange: number;
  /** The same over the ocean. */
  oceanSeasonalRange: number;
  circulationCells: number;
  hadleyEdgeDeg: number;
  /** Area-weighted precipitation over the whole surface, mm per year. */
  meanPrecipitation: number;
  /** Area-weighted evaporation over the whole surface, mm per year; equals precipitation at steady state. */
  meanEvaporation: number;
  /** Land with less than DESERT_MM per year, as a fraction of the land area. */
  desertFraction: number;
  wettestMm: number;
  oceanBasins: number;
  /** Fastest surface current, m/s. */
  strongestCurrent: number;
  /** Largest warm and cold anomalies carried by currents, degrees C. */
  warmestCurrentAnomaly: number;
  coldestCurrentAnomaly: number;
  /** Ice sheets as a fraction of the land area. */
  iceSheetFraction: number;
  /** Ocean under sea ice all year, as a fraction of the ocean area. */
  permanentSeaIceFraction: number;
  /** Ocean with sea ice in at least one sample, as a fraction of the ocean area. */
  seasonalSeaIceFraction: number;
  /** Land fraction per Koppen group: tropical, arid, temperate, continental, polar. */
  koppen: { A: number; B: number; C: number; D: number; E: number };
}

export interface ReliefFields {
  elevation: Float64Array;
  areaKm2: Float64Array;
  seaLevel: number;
  crustType: Uint8Array;
  thickness: Float64Array;
  activePlates: number;
}

export interface HydrologyFields {
  precipitation: Float64Array;
  discharge: Float64Array;
  lake: Int32Array;
  mouth: Int32Array;
  riverLength: Float64Array;
  lakes: LakeInfo[];
}

export interface ClimateFields {
  temperatureAnnual: Float64Array;
  temperature: Float64Array;
  circulation: CirculationInfo;
  evaporation: Float64Array;
  basins: BasinInfo[];
  currentU: Float64Array;
  currentV: Float64Array;
  sstAnomaly: Float64Array;
}

export interface BiomeFields {
  seaIceMonths: Uint8Array;
  iceSheet: Uint8Array;
  koppen: Uint8Array;
}

export function computeStats(grid: Grid, relief: ReliefFields, hydro: HydrologyFields, climate: ClimateFields, biome: BiomeFields): WorldStats {
  const { elevation, areaKm2, seaLevel, crustType, thickness } = relief;
  const n = elevation.length;
  let total = 0;
  let ocean = 0;
  let continental = 0;
  let min = Infinity;
  let max = -Infinity;
  let landSum = 0;
  let oceanSum = 0;
  let maxThickness = 0;
  let precipSum = 0;
  let lakeArea = 0;
  let endorheicArea = 0;
  let longest = 0;
  let largest = 0;
  let tempSum = 0;
  let equatorSum = 0;
  let equatorArea = 0;
  let poleSum = 0;
  let poleArea = 0;
  let landRangeSum = 0;
  let landRangeArea = 0;
  let oceanRangeSum = 0;
  let oceanRangeArea = 0;
  let precipAll = 0;
  let evapAll = 0;
  let desert = 0;
  let wettest = 0;
  let strongest = 0;
  let warmest = 0;
  let coldest = 0;
  let iceSheet = 0;
  let permanentIce = 0;
  let seasonalIce = 0;
  const koppen = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const hyps = new Array<number>(HYPSOMETRY_BINS).fill(0);
  for (let i = 0; i < n; i++) {
    const e = elevation[i] - seaLevel;
    const a = areaKm2[i];
    total += a;
    if (e < min) min = e;
    if (e > max) max = e;
    const p = hydro.precipitation[i];
    precipAll += a * p;
    evapAll += a * climate.evaporation[i];
    if (p > wettest) wettest = p;
    const speed = Math.hypot(climate.currentU[i], climate.currentV[i]);
    if (speed > strongest) strongest = speed;
    if (climate.sstAnomaly[i] > warmest) warmest = climate.sstAnomaly[i];
    if (climate.sstAnomaly[i] < coldest) coldest = climate.sstAnomaly[i];
    if (e < 0) {
      ocean += a;
      oceanSum += a * -e;
      if (biome.seaIceMonths[i] >= SAMPLES) permanentIce += a;
      if (biome.seaIceMonths[i] > 0) seasonalIce += a;
    } else {
      landSum += a * e;
      precipSum += a * p;
      if (p < DESERT_MM) desert += a;
      if (hydro.lake[i] >= 0) lakeArea += a;
      const m = hydro.mouth[i];
      const lakeAtMouth = hydro.lake[m];
      if (lakeAtMouth >= 0 && hydro.lakes[lakeAtMouth].endorheic) endorheicArea += a;
      if (biome.iceSheet[i]) iceSheet += a;
      const group = koppenGroup(biome.koppen[i]) as keyof typeof koppen;
      if (group in koppen) koppen[group] += a;
    }
    if (crustType[i] === 1) continental += a;
    if (thickness[i] > maxThickness) maxThickness = thickness[i];
    if (hydro.riverLength[i] > longest) longest = hydro.riverLength[i];
    if (hydro.discharge[i] > largest) largest = hydro.discharge[i];
    const t = climate.temperatureAnnual[i];
    tempSum += a * t;
    const absLat = Math.abs(grid.lat[i]) / DEG;
    if (absLat < 5) {
      equatorSum += a * t;
      equatorArea += a;
    } else if (absLat > 80) {
      poleSum += a * t;
      poleArea += a;
    }
    if (absLat >= 40 && absLat <= 60) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let s = 0; s < SAMPLES; s++) {
        const v = climate.temperature[s * n + i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (e < 0) {
        oceanRangeSum += a * (hi - lo);
        oceanRangeArea += a;
      } else {
        landRangeSum += a * (hi - lo);
        landRangeArea += a;
      }
    }
    const bin = Math.min(HYPSOMETRY_BINS - 1, Math.max(0, Math.floor((e - HYPSOMETRY_MIN_M) / HYPSOMETRY_BIN_M)));
    hyps[bin] += a;
  }
  const land = total - ocean;
  let endorheicLakes = 0;
  for (const l of hydro.lakes) if (l.endorheic) endorheicLakes++;
  const masses = landmasses(grid, elevation, seaLevel, areaKm2);
  let continents = 0;
  let islands = 0;
  let largestMass = 0;
  for (const m of masses) {
    if (m >= CONTINENT_MIN_KM2) continents++;
    else islands++;
    if (m > largestMass) largestMass = m;
  }
  return {
    oceanFraction: ocean / total,
    landFraction: land / total,
    continentalFraction: continental / total,
    minElevation: min,
    maxElevation: max,
    meanLandElevation: land > 0 ? landSum / land : 0,
    meanOceanDepth: ocean > 0 ? oceanSum / ocean : 0,
    maxThickness,
    activePlates: relief.activePlates,
    totalAreaKm2: total,
    hypsometry: hyps.map((h) => h / total),
    continents,
    islands,
    largestLandmassKm2: largestMass,
    meanLandPrecipitation: land > 0 ? precipSum / land : 0,
    lakeCount: hydro.lakes.length,
    endorheicLakeCount: endorheicLakes,
    lakeFraction: land > 0 ? lakeArea / land : 0,
    endorheicLandFraction: land > 0 ? endorheicArea / land : 0,
    longestRiverKm: longest,
    largestRiverKm3: largest,
    meanTemperature: tempSum / total,
    equatorTemperature: equatorArea > 0 ? equatorSum / equatorArea : NaN,
    poleTemperature: poleArea > 0 ? poleSum / poleArea : NaN,
    landSeasonalRange: landRangeArea > 0 ? landRangeSum / landRangeArea : 0,
    oceanSeasonalRange: oceanRangeArea > 0 ? oceanRangeSum / oceanRangeArea : 0,
    circulationCells: climate.circulation.cells,
    hadleyEdgeDeg: climate.circulation.hadleyEdgeDeg,
    meanPrecipitation: precipAll / total,
    meanEvaporation: evapAll / total,
    desertFraction: land > 0 ? desert / land : 0,
    wettestMm: wettest,
    oceanBasins: climate.basins.length,
    strongestCurrent: strongest,
    warmestCurrentAnomaly: warmest,
    coldestCurrentAnomaly: coldest,
    iceSheetFraction: land > 0 ? iceSheet / land : 0,
    permanentSeaIceFraction: ocean > 0 ? permanentIce / ocean : 0,
    seasonalSeaIceFraction: ocean > 0 ? seasonalIce / ocean : 0,
    koppen: {
      A: land > 0 ? koppen.A / land : 0,
      B: land > 0 ? koppen.B / land : 0,
      C: land > 0 ? koppen.C / land : 0,
      D: land > 0 ? koppen.D / land : 0,
      E: land > 0 ? koppen.E / land : 0,
    },
  };
}

/** Areas of the connected land components, km^2. */
export function landmasses(grid: Grid, elevation: Float64Array, seaLevel: number, areaKm2: Float64Array): number[] {
  const n = grid.n;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const out: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || elevation[s] < seaLevel) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    seen[s] = 1;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      area += areaKm2[i];
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const j = grid.nb[t];
        if (!seen[j] && elevation[j] >= seaLevel) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    out.push(area);
  }
  return out;
}
