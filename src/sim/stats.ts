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
}

export function computeStats(
  elevation: Float64Array,
  areaKm2: Float64Array,
  seaLevel: number,
  crustType: Uint8Array,
  thickness: Float64Array,
  activePlates: number,
): WorldStats {
  let total = 0;
  let ocean = 0;
  let continental = 0;
  let min = Infinity;
  let max = -Infinity;
  let landSum = 0;
  let oceanSum = 0;
  let maxThickness = 0;
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
    }
    if (crustType[i] === 1) continental += a;
    if (thickness[i] > maxThickness) maxThickness = thickness[i];
    const bin = Math.min(HYPSOMETRY_BINS - 1, Math.max(0, Math.floor((e - HYPSOMETRY_MIN_M) / HYPSOMETRY_BIN_M)));
    hyps[bin] += a;
  }
  const land = total - ocean;
  return {
    oceanFraction: ocean / total,
    landFraction: land / total,
    continentalFraction: continental / total,
    minElevation: min,
    maxElevation: max,
    meanLandElevation: land > 0 ? landSum / land : 0,
    meanOceanDepth: ocean > 0 ? oceanSum / ocean : 0,
    maxThickness,
    activePlates,
    totalAreaKm2: total,
    hypsometry: hyps.map((h) => h / total),
  };
}
