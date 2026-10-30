import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { circulationCells, computeWinds, type CirculationInfo } from './circulation.ts';
import { computeIce, type IceFields } from './ice.ts';
import { SAMPLES, declinations } from './insolation.ts';
import { meshGeometry } from './mesh.ts';
import { computeMoisture, type MoistureFields } from './moisture.ts';
import { computeOcean, type OceanFields } from './ocean.ts';
import { computeTemperature, globalMeanTemperature, type TemperatureFields } from './temperature.ts';

/** Everything the climate stage produces (DESIGN 3.5 steps 1 to 6; Koppen is classified by the pipeline once the rivers are final). */
export interface Climate {
  circulation: CirculationInfo;
  /** Global mean surface temperature at sea level for this insolation and glacial phase, degrees C. */
  globalMeanTemperature: number;
  declinations: Float64Array;
  /** Temperature with the ocean-current and ice-albedo corrections applied. */
  temperature: TemperatureFields;
  /** Eastward wind per sample, sample-major, m/s. */
  windU: Float64Array;
  /** Northward wind per sample, sample-major, m/s. */
  windV: Float64Array;
  ocean: OceanFields;
  ice: IceFields;
  moisture: MoistureFields;
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
  const mesh = meshGeometry(grid);
  const decl = declinations(params.axialTiltDeg);
  const temperature = computeTemperature(grid, params, decl, elevation, seaLevel, oceanDistance);
  const circulation = circulationCells(params);
  const winds = computeWinds(grid, params, circulation, decl, temperature);
  const ocean = computeOcean(grid, params, mesh, elevation, seaLevel, areaKm2, winds.u, winds.v, temperature.annual);
  // Currents feed back into temperature: the same anomaly in every sample (DESIGN 3.5 step 2).
  const n = grid.n;
  for (let i = 0; i < n; i++) {
    const a = ocean.sstAnomaly[i];
    if (a === 0) continue;
    temperature.annual[i] += a;
    for (let s = 0; s < SAMPLES; s++) temperature.samples[s * n + i] += a;
  }
  // Ice and its albedo cooling come before moisture: frozen seas barely evaporate.
  const ice = computeIce(grid, temperature, elevation, seaLevel, areaKm2);
  const moisture = computeMoisture(grid, params.radiusKm, elevation, seaLevel, lake, winds.u, winds.v, temperature.samples);
  return {
    circulation,
    globalMeanTemperature: globalMeanTemperature(params.insolation, params.glacialPhase),
    declinations: decl,
    temperature,
    windU: winds.u,
    windV: winds.v,
    ocean,
    ice,
    moisture,
  };
}
