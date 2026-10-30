import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { circulationCells, computeWinds, type CirculationInfo } from './circulation.ts';
import { declinations } from './insolation.ts';
import { computeTemperature, globalMeanTemperature, type TemperatureFields } from './temperature.ts';

/** Everything the climate stage produces (DESIGN 3.5 steps 1 to 3; currents, moisture and ice follow in M5 and M6). */
export interface Climate {
  circulation: CirculationInfo;
  /** Global mean surface temperature at sea level for this insolation, degrees C. */
  globalMeanTemperature: number;
  declinations: Float64Array;
  temperature: TemperatureFields;
  /** Eastward wind per sample, sample-major, m/s. */
  windU: Float64Array;
  /** Northward wind per sample, sample-major, m/s. */
  windV: Float64Array;
}

export function computeClimate(
  grid: Grid,
  params: PlanetParams,
  elevation: Float64Array,
  seaLevel: number,
  oceanDistance: Int32Array,
): Climate {
  const decl = declinations(params.axialTiltDeg);
  const temperature = computeTemperature(grid, params, decl, elevation, seaLevel, oceanDistance);
  const circulation = circulationCells(params);
  const winds = computeWinds(grid, params, circulation, decl, temperature);
  return {
    circulation,
    globalMeanTemperature: globalMeanTemperature(params.insolation),
    declinations: decl,
    temperature,
    windU: winds.u,
    windV: winds.v,
  };
}
