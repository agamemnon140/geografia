import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { circulationCells, computeWinds, type CirculationInfo } from './circulation.ts';
import { classifyIce, surfaceAlbedo, type IceFields } from './ice.ts';
import { SAMPLES, declinations } from './insolation.ts';
import { meshGeometry } from './mesh.ts';
import { computeMoisture, type MoistureFields } from './moisture.ts';
import { computeOcean, type OceanFields } from './ocean.ts';
import { computeTemperature, type TemperatureFields } from './temperature.ts';

/** Rounds of energy balance and ice extent; each round feeds the ice albedo back (snowballs need several). */
export const ALBEDO_ITERATIONS = 5;
/** Stop iterating when no cell's albedo changes by more than this. */
export const ALBEDO_TOLERANCE = 0.01;
/**
 * Cold start: the first pass, computed over bare ground, counts as ice
 * anything within this many degrees of freezing. Ice reflects its own
 * summer sun, so the next passes keep it where it can sustain itself and
 * melt it where it cannot; starting bare would never let an ice sheet form
 * (hysteresis), and Earth sits on the icy branch.
 */
export const ICE_BOOTSTRAP_MARGIN_C = 3;

/** Everything the climate stage produces (DESIGN 3.5 steps 1 to 6; Koppen is classified by the pipeline once the rivers are final). */
export interface Climate {
  circulation: CirculationInfo;
  /** Global mean sea-level temperature from the energy balance, degrees C. */
  globalMeanTemperature: number;
  declinations: Float64Array;
  /** Temperature with the ice albedo iterated and the ocean-current correction applied. */
  temperature: TemperatureFields;
  /** Eastward wind per sample, sample-major, m/s. */
  windU: Float64Array;
  /** Northward wind per sample, sample-major, m/s. */
  windV: Float64Array;
  ocean: OceanFields;
  ice: IceFields;
  moisture: MoistureFields;
  /** Albedo rounds it took for the ice extent to settle. */
  albedoRounds: number;
}

/**
 * Climate on the finished relief. `lake` is the lake map of the last in-loop
 * hydrology pass: lakes evaporate into the moisture model before the final
 * rivers are known, a one-step lag that is harmless.
 */
export function computeClimate(
  grid: Grid,
  params: PlanetParams,
  elevation: Float64Array,
  seaLevel: number,
  areaKm2: Float64Array,
  oceanDistance: Int32Array,
  lake: Int32Array,
): Climate {
  const n = grid.n;
  const mesh = meshGeometry(grid);
  const decl = declinations(params.axialTiltDeg);

  // Energy balance and ice albedo, iterated until the ice extent settles.
  const albedo = new Float64Array(n);
  const nextAlbedo = new Float64Array(n);
  surfaceAlbedo(grid, elevation, seaLevel, null, albedo);
  let temperature = computeTemperature(grid, params, decl, elevation, seaLevel, oceanDistance, albedo);
  let ice = classifyIce(grid, temperature, elevation, seaLevel, areaKm2, ICE_BOOTSTRAP_MARGIN_C);
  let rounds = 1;
  for (; rounds < ALBEDO_ITERATIONS; rounds++) {
    surfaceAlbedo(grid, elevation, seaLevel, ice, nextAlbedo);
    let change = 0;
    for (let i = 0; i < n; i++) change = Math.max(change, Math.abs(nextAlbedo[i] - albedo[i]));
    if (change < ALBEDO_TOLERANCE) break;
    albedo.set(nextAlbedo);
    temperature = computeTemperature(grid, params, decl, elevation, seaLevel, oceanDistance, albedo);
    ice = classifyIce(grid, temperature, elevation, seaLevel, areaKm2);
  }

  const circulation = circulationCells(params);
  const winds = computeWinds(grid, params, circulation, decl, temperature);
  const ocean = computeOcean(grid, params, mesh, elevation, seaLevel, areaKm2, winds.u, winds.v, temperature.annual);
  // Currents feed back into temperature: the same anomaly in every sample (DESIGN 3.5 step 2).
  for (let i = 0; i < n; i++) {
    const a = ocean.sstAnomaly[i];
    if (a === 0) continue;
    temperature.annual[i] += a;
    for (let s = 0; s < SAMPLES; s++) temperature.samples[s * n + i] += a;
  }
  // Warm and cold currents move the ice edge; frozen seas barely evaporate, so ice comes before moisture.
  ice = classifyIce(grid, temperature, elevation, seaLevel, areaKm2);
  const moisture = computeMoisture(grid, params.radiusKm, elevation, seaLevel, lake, winds.u, winds.v, temperature.samples);
  return {
    circulation,
    globalMeanTemperature: temperature.globalMean,
    declinations: decl,
    temperature,
    windU: winds.u,
    windV: winds.v,
    ocean,
    ice,
    moisture,
    albedoRounds: rounds,
  };
}
