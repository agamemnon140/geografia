import type { Grid } from '../grid/grid.ts';
import { relativeGravity, type PlanetParams } from '../params.ts';
import { GLACIAL_COOLING_C } from './ice.ts';
import { SAMPLES, SOLAR_CONSTANT, dailyMeanInsolation } from './insolation.ts';

/**
 * Surface temperature (DESIGN 3.5 step 2): a linear energy balance around
 * the planet's global mean, with meridional heat transport implied by the
 * slope, a lapse rate proportional to gravity, continentality, and thermal
 * inertia that lags and damps the seasonal cycle more over the ocean than
 * over land. Ocean-current corrections arrive in M5, ice albedo in M6.
 */

/** Earth's global mean surface temperature, K. The planet's mean scales with the fourth root of insolation. */
export const EARTH_MEAN_TEMPERATURE_K = 288.15;
/** Degrees C per W/m^2 of annual-mean insolation anomaly from the global mean over land; fitted to Earth's zonal climatology (equator 27, poles -15). */
export const K_ANNUAL = 0.17;
/** The same over the ocean, smaller because the ocean carries more heat poleward (Arctic waters sit near -8 C in the annual mean, not -15). */
export const K_ANNUAL_OCEAN = 0.14;
/** Seasonal response of the land surface, degrees C per W/m^2 of lagged insolation anomaly (Siberia: 40 degrees of range at 60 N). */
export const K_SEASON_LAND = 0.1;
/** Seasonal response of the ocean mixed layer, much smaller because of its heat capacity. */
export const K_SEASON_OCEAN = 0.03;
/** Thermal time constant of the land surface, in samples (about one month of lag). */
export const TAU_LAND = 1;
/** Thermal time constant of the ocean mixed layer, in samples (two to three months of lag). */
export const TAU_OCEAN = 2.5;
/** Environmental lapse rate on Earth, K per km; scales with gravity (g over cp). */
export const LAPSE_RATE_EARTH = 6.5;
/** Hop distance to the ocean at which a cell is 63% continental. */
export const CONTINENTALITY_SCALE_CELLS = 4;
/** Annual-mean cooling of a fully continental interior, degrees C (long cold winters outweigh warm summers). */
export const CONTINENTAL_COOLING = 3;

export interface TemperatureFields {
  /** Annual-mean top-of-atmosphere insolation per cell, W/m^2. */
  insolationAnnual: Float64Array;
  /** 0 on the ocean, toward 1 deep inside continents. */
  continentality: Float64Array;
  /** Annual-mean surface temperature, degrees C. */
  annual: Float64Array;
  /** Surface temperature per sample, sample-major (sample * n + cell), degrees C. */
  samples: Float64Array;
  /** Provenance for the explain mode: the annual mean is the global mean plus these three terms (currents and ice add theirs later). */
  insolationTerm: Float64Array;
  lapseTerm: Float64Array;
  continentalTerm: Float64Array;
}

/** Global mean surface temperature for a stellar flux relative to Earth and a glacial phase, degrees C. */
export function globalMeanTemperature(insolation: number, glacialPhase = 0): number {
  return EARTH_MEAN_TEMPERATURE_K * insolation ** 0.25 - 273.15 - GLACIAL_COOLING_C * glacialPhase;
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
): TemperatureFields {
  const n = grid.n;
  const s0 = SOLAR_CONSTANT * params.insolation;
  const globalMean = globalMeanTemperature(params.insolation, params.glacialPhase);
  const meanInsolation = s0 / 4;
  const lapse = lapseRate(params);
  const insolationAnnual = new Float64Array(n);
  const continentality = new Float64Array(n);
  const annual = new Float64Array(n);
  const samples = new Float64Array(SAMPLES * n);
  const insolationTerm = new Float64Array(n);
  const lapseTerm = new Float64Array(n);
  const continentalTerm = new Float64Array(n);
  const q = new Float64Array(SAMPLES);
  for (let i = 0; i < n; i++) {
    const lat = grid.lat[i];
    let sum = 0;
    for (let s = 0; s < SAMPLES; s++) {
      q[s] = dailyMeanInsolation(lat, declinations[s], s0);
      sum += q[s];
    }
    const qAnnual = sum / SAMPLES;
    insolationAnnual[i] = qAnnual;
    const land = elevation[i] >= seaLevel;
    const c = land ? 1 - Math.exp(-oceanDistance[i] / CONTINENTALITY_SCALE_CELLS) : 0;
    continentality[i] = c;
    const height = land ? (elevation[i] - seaLevel) / 1000 : 0;
    insolationTerm[i] = (K_ANNUAL_OCEAN + (K_ANNUAL - K_ANNUAL_OCEAN) * c) * (qAnnual - meanInsolation);
    lapseTerm[i] = -lapse * height;
    continentalTerm[i] = -CONTINENTAL_COOLING * c;
    const base = globalMean + insolationTerm[i] + lapseTerm[i] + continentalTerm[i];
    annual[i] = base;
    // Thermal inertia: a first-order filter around the annual cycle, run three times around
    // so the periodic steady state is reached; the time constant blends land and ocean.
    const tau = TAU_OCEAN + (TAU_LAND - TAU_OCEAN) * c;
    const alpha = 1 - Math.exp(-1 / tau);
    const k = K_SEASON_OCEAN + (K_SEASON_LAND - K_SEASON_OCEAN) * c;
    let filtered = qAnnual;
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let s = 0; s < SAMPLES; s++) {
        filtered += alpha * (q[s] - filtered);
        if (cycle === 2) samples[s * n + i] = base + k * (filtered - qAnnual);
      }
    }
  }
  return { insolationAnnual, continentality, annual, samples, insolationTerm, lapseTerm, continentalTerm };
}
