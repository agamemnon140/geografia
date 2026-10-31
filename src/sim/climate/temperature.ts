import type { Grid } from '../grid/grid.ts';
import { relativeGravity, type PlanetParams } from '../params.ts';
import { planetaryAlbedo, solveEnergyBalance } from './ebm.ts';
import { SAMPLES, SOLAR_CONSTANT, dailyMeanInsolation, orbitalFactors } from './insolation.ts';

/**
 * Surface temperature (DESIGN 3.5 step 2, energy balance from M9): the
 * annual mean at sea level comes from the two-dimensional energy-balance
 * model with the clear-sky surface albedo the caller supplies (ice
 * included) under the cloud cover of each sample, plus the longwave the
 * clouds trap (M20); a lapse rate
 * proportional to gravity and a continentality term bring it to the
 * surface; the seasonal cycle is the insolation cycle through a thermal
 * filter that lags and damps it more over the ocean than over land. Ocean
 * currents add their anomaly afterwards.
 */

/** Seasonal response of the land surface, degrees C per W/m^2 of lagged insolation anomaly (Siberia: 40 degrees of range at 60 N). */
export const K_SEASON_LAND = 0.1;
/** Seasonal response of the ocean mixed layer, much smaller because of its heat capacity. */
export const K_SEASON_OCEAN = 0.03;
/** Thermal time constant of the land surface, in samples (about one month of lag); a thicker atmosphere adds inertia. */
export const TAU_LAND = 1;
/** Thermal time constant of the ocean mixed layer, in samples (two to three months of lag). */
export const TAU_OCEAN = 2.5;
/** Environmental lapse rate on Earth, K per km; scales with gravity (g over cp). */
export const LAPSE_RATE_EARTH = 6.5;
/** Hop distance to the ocean at which a cell is 63% continental. */
export const CONTINENTALITY_SCALE_CELLS = 4;
/** Annual-mean cooling of a fully continental interior, degrees C (long cold winters outweigh warm summers). */
export const CONTINENTAL_COOLING = 1.5;

export interface TemperatureFields {
  /** Annual-mean top-of-atmosphere insolation per cell, W/m^2. */
  insolationAnnual: Float64Array;
  /** 0 on the ocean, toward 1 deep inside continents. */
  continentality: Float64Array;
  /** Area-weighted global mean of the sea-level energy balance, degrees C. */
  globalMean: number;
  /** Annual-mean surface temperature, degrees C. */
  annual: Float64Array;
  /** Surface temperature per sample, sample-major (sample * n + cell), degrees C. */
  samples: Float64Array;
  /** Provenance for the explain mode: annual = global mean + balance (insolation, albedo, transport) + lapse + continental (+ currents later). */
  balanceTerm: Float64Array;
  lapseTerm: Float64Array;
  continentalTerm: Float64Array;
  /** Sunlight the clouds reflect, W/m^2 (negative: absorbed minus clear-sky absorbed), and the longwave they trap, for the statistics. */
  cloudShortwave: Float64Array;
  cloudLongwave: Float64Array;
}

/** Lapse rate for a planet, K per km. */
export function lapseRate(params: PlanetParams): number {
  return LAPSE_RATE_EARTH * relativeGravity(params);
}

export function computeTemperature(
  grid: Grid,
  params: PlanetParams,
  declinations: Float64Array,
  elevation: Float64Array,
  seaLevel: number,
  oceanDistance: Int32Array,
  surfaceAlbedo: Float64Array,
  bareAlbedo: Float64Array,
  cloud: Float64Array,
  cloudAnnual: Float64Array,
  cloudLongwave: Float64Array,
): TemperatureFields {
  const n = grid.n;
  const s0 = SOLAR_CONSTANT * params.insolation;
  const orbit = orbitalFactors(params.eccentricity);
  const lapse = lapseRate(params);
  const insolationAnnual = new Float64Array(n);
  const continentality = new Float64Array(n);
  const annual = new Float64Array(n);
  const samples = new Float64Array(SAMPLES * n);
  const balanceTerm = new Float64Array(n);
  const lapseTerm = new Float64Array(n);
  const continentalTerm = new Float64Array(n);
  const absorbed = new Float64Array(n);
  const cloudShortwave = new Float64Array(n);
  const q = new Float64Array(SAMPLES * n);
  for (let i = 0; i < n; i++) {
    const lat = grid.lat[i];
    let sum = 0;
    let taken = 0;
    // Absorbed sunlight sample by sample under that sample's cloud: a clear summer counts for more than a cloudy winter.
    for (let s = 0; s < SAMPLES; s++) {
      const v = dailyMeanInsolation(lat, declinations[s], s0 * orbit[s]);
      q[s * n + i] = v;
      sum += v;
      taken += v * (1 - planetaryAlbedo(surfaceAlbedo[i], cloud[s * n + i]));
    }
    insolationAnnual[i] = sum / SAMPLES;
    absorbed[i] = taken / SAMPLES;
    cloudShortwave[i] = absorbed[i] - insolationAnnual[i] * (1 - surfaceAlbedo[i]);
  }

  // Annual mean from the energy balance, valid at the atmosphere's reference height: the
  // area-weighted mean surface (sea surface over the ocean). On Earth that is a few hundred
  // meters above the sea; on a land-heavy planet whose sea lies kilometers below its plateaus
  // the lapse rate must not turn every continent into Tibet, and the sea surface sits warm
  // below the reference. The area-weighted mean surface temperature is the balance's mean.
  const balance = new Float64Array(n);
  solveEnergyBalance(grid, params, absorbed, balance, undefined, undefined, cloudLongwave);
  let meanSum = 0;
  let areaSum = 0;
  let surfaceSum = 0;
  for (let i = 0; i < n; i++) {
    meanSum += grid.area[i] * balance[i];
    surfaceSum += grid.area[i] * Math.max(elevation[i], seaLevel);
    areaSum += grid.area[i];
  }
  const globalMean = meanSum / areaSum;
  const referenceHeight = surfaceSum / areaSum;

  const tauLand = TAU_LAND * Math.sqrt(params.pressureBar);
  for (let i = 0; i < n; i++) {
    const land = elevation[i] >= seaLevel;
    const c = land ? 1 - Math.exp(-oceanDistance[i] / CONTINENTALITY_SCALE_CELLS) : 0;
    continentality[i] = c;
    const height = (Math.max(elevation[i], seaLevel) - referenceHeight) / 1000;
    balanceTerm[i] = balance[i] - globalMean;
    lapseTerm[i] = -lapse * height;
    continentalTerm[i] = -CONTINENTAL_COOLING * c;
    const base = balance[i] + lapseTerm[i] + continentalTerm[i];
    annual[i] = base;
    // Thermal inertia: a first-order filter around the annual cycle, run three times around
    // so the periodic steady state is reached; the time constant blends land and ocean.
    const tau = TAU_OCEAN + (tauLand - TAU_OCEAN) * c;
    const alpha = 1 - Math.exp(-1 / tau);
    // A bright surface reflects the summer sun: the seasonal response scales with what it absorbs,
    // relative to bare ground or open water under the same clouds. Ice sheets and frozen seas swing far less than tundra.
    const absorbedShare = (1 - planetaryAlbedo(surfaceAlbedo[i], cloudAnnual[i])) / (1 - planetaryAlbedo(bareAlbedo[i], cloudAnnual[i]));
    const k = (K_SEASON_OCEAN + (K_SEASON_LAND - K_SEASON_OCEAN) * c) * absorbedShare;
    const qAnnual = insolationAnnual[i];
    let filtered = qAnnual;
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let s = 0; s < SAMPLES; s++) {
        filtered += alpha * (q[s * n + i] - filtered);
        if (cycle === 2) samples[s * n + i] = base + k * (filtered - qAnnual);
      }
    }
  }
  return { insolationAnnual, continentality, globalMean, annual, samples, balanceTerm, lapseTerm, continentalTerm, cloudShortwave, cloudLongwave };
}
