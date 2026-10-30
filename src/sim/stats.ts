import type { CirculationInfo } from './climate/circulation.ts';
import { SAMPLES } from './climate/insolation.ts';
import { DEG } from './grid/geometry.ts';
import type { LakeInfo } from './hydrology/routing.ts';

/** Per-world summary statistics (DESIGN 3.6). Grows with each milestone. */

export const HYPSOMETRY_MIN_M = -8000;
export const HYPSOMETRY_BIN_M = 500;
export const HYPSOMETRY_BINS = 32;

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
}

export interface ClimateFields {
  lat: Float64Array;
  temperatureAnnual: Float64Array;
  temperature: Float64Array;
  circulation: CirculationInfo;
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

export function computeStats(relief: ReliefFields, hydro: HydrologyFields, climate: ClimateFields): WorldStats {
  const { elevation, areaKm2, seaLevel, crustType, thickness } = relief;
  const n = elevation.length;
  let total = 0;
  let tempSum = 0;
  let equatorSum = 0;
  let equatorArea = 0;
  let poleSum = 0;
  let poleArea = 0;
  let landRangeSum = 0;
  let landRangeArea = 0;
  let oceanRangeSum = 0;
  let oceanRangeArea = 0;
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
  const hyps = new Array<number>(HYPSOMETRY_BINS).fill(0);
  for (let i = 0; i < elevation.length; i++) {
    const e = elevation[i] - seaLevel;
    const a = areaKm2[i];
    total += a;
    if (e < min) min = e;
    if (e > max) max = e;
    if (e < 0) {
      ocean += a;
      oceanSum += a * -e;
    } else {
      landSum += a * e;
      precipSum += a * hydro.precipitation[i];
      if (hydro.lake[i] >= 0) lakeArea += a;
      const m = hydro.mouth[i];
      const lakeAtMouth = hydro.lake[m];
      if (lakeAtMouth >= 0 && hydro.lakes[lakeAtMouth].endorheic) endorheicArea += a;
    }
    if (crustType[i] === 1) continental += a;
    if (thickness[i] > maxThickness) maxThickness = thickness[i];
    const t = climate.temperatureAnnual[i];
    tempSum += a * t;
    const absLat = Math.abs(climate.lat[i]) / DEG;
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
    if (hydro.riverLength[i] > longest) longest = hydro.riverLength[i];
    if (hydro.discharge[i] > largest) largest = hydro.discharge[i];
    const bin = Math.min(HYPSOMETRY_BINS - 1, Math.max(0, Math.floor((e - HYPSOMETRY_MIN_M) / HYPSOMETRY_BIN_M)));
    hyps[bin] += a;
  }
  const land = total - ocean;
  let endorheicLakes = 0;
  for (const l of hydro.lakes) if (l.endorheic) endorheicLakes++;
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
  };
}
