import { MIN_LEVEL } from '../constants.ts';
import { Grid, cellAreasKm2 } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { circulationCells, computeWinds, type CirculationInfo } from './circulation.ts';
import { CLOUD_PRIOR, CLOUD_PRIOR_LONGWAVE_W, sunshineHours } from './clouds.ts';
import { classifyIce, surfaceAlbedo, type IceFields } from './ice.ts';
import { SAMPLES, declinations } from './insolation.ts';
import { meshGeometry } from './mesh.ts';
import { computeMoisture, type MoistureFields } from './moisture.ts';
import { prolongate } from './multilevel.ts';
import { computeOcean, type OceanFields } from './ocean.ts';
import { computeTemperature, type TemperatureFields } from './temperature.ts';

/** Rounds of energy balance and ice extent; each round feeds the ice albedo back (snowballs need several). The prior pass, whose only product is a first cloud field, gets fewer. */
export const ALBEDO_ITERATIONS = 5;
export const PRIOR_ALBEDO_ITERATIONS = 3;
/** Stop iterating when the area-weighted mean change of the albedo falls below this (a single cell's sea ice flipping a month is 1e-6; the edge of an ice sheet moving one ring is a few 1e-3). */
export const ALBEDO_TOLERANCE = 0.001;
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
  /** Sunshine hours per year: daylight not under cloud (clouds.ts). */
  sunshineHours: Float64Array;
  /** Albedo rounds the final pass took for the ice extent to settle. */
  albedoRounds: number;
}

/** The cloud state the energy balance needs: cover per sample, its annual mean and the longwave it traps. */
interface CloudState {
  samples: Float64Array;
  annual: Float64Array;
  longwave: Float64Array;
}

/**
 * Climate on the finished relief, in two passes (M20). The energy balance
 * needs the cloud cover (albedo and trapped longwave) and the cloud cover
 * comes out of the moisture solve, which needs the temperature, the winds
 * and the currents: the prior pass solves everything under Earth's mean
 * cloud cover on the next coarser grid (the subdivision keeps the coarse
 * ids, so the first cells of the fine fields are the coarse cells) and
 * yields a cloud field, prolongated to the planet's grid for the final
 * pass. `lake` is the lake map of the last in-loop hydrology pass: lakes
 * evaporate into the moisture model before the final rivers are known, a
 * one-step lag that is harmless.
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
  const decl = declinations(params.axialTiltDeg);
  const circulation = circulationCells(params);

  const pass = (g: Grid, elev: Float64Array, area: Float64Array, distance: Int32Array, lakes: Int32Array, clouds: CloudState, maxRounds: number) => {
    const balance = solveBalance(g, params, decl, elev, seaLevel, area, distance, clouds, maxRounds);
    const temperature = balance.temperature;
    const winds = computeWinds(g, params, circulation, decl, temperature);
    const ocean = computeOcean(g, params, meshGeometry(g), elev, seaLevel, area, winds.u, winds.v, temperature.annual);
    // Currents feed back into temperature: the same anomaly in every sample (DESIGN 3.5 step 2).
    for (let i = 0; i < g.n; i++) {
      const a = ocean.sstAnomaly[i];
      if (a === 0) continue;
      temperature.annual[i] += a;
      for (let s = 0; s < SAMPLES; s++) temperature.samples[s * g.n + i] += a;
    }
    // Warm and cold currents move the ice edge; frozen seas barely evaporate, so ice comes before moisture.
    const ice = classifyIce(g, temperature, elev, seaLevel, area);
    const moisture = computeMoisture(g, params.radiusKm, elev, seaLevel, lakes, winds.u, winds.v, temperature.samples, ocean.sstAnomaly);
    return { temperature, winds, ocean, ice, moisture, rounds: balance.rounds };
  };

  // The prior pass, one level coarser where there is one.
  const pg = Grid.get(Math.max(MIN_LEVEL, grid.level - 1));
  const pn = pg.n;
  const prior: CloudState = {
    samples: new Float64Array(SAMPLES * pn).fill(CLOUD_PRIOR),
    annual: new Float64Array(pn).fill(CLOUD_PRIOR),
    longwave: new Float64Array(pn).fill(CLOUD_PRIOR_LONGWAVE_W),
  };
  const first = pass(
    pg,
    pg === grid ? elevation : elevation.subarray(0, pn),
    pg === grid ? areaKm2 : cellAreasKm2(pg, params.radiusKm),
    pg === grid ? oceanDistance : oceanDistance.subarray(0, pn),
    pg === grid ? lake : lake.subarray(0, pn),
    prior,
    PRIOR_ALBEDO_ITERATIONS,
  );
  let clouds: CloudState = { samples: first.moisture.cloud, annual: first.moisture.cloudAnnual, longwave: first.moisture.cloudLongwave };
  if (pg !== grid) {
    const samples = new Float64Array(SAMPLES * n);
    for (let s = 0; s < SAMPLES; s++) prolongate(pg, grid, clouds.samples.subarray(s * pn, (s + 1) * pn), samples.subarray(s * n, (s + 1) * n));
    const annual = new Float64Array(n);
    const longwave = new Float64Array(n);
    prolongate(pg, grid, clouds.annual, annual);
    prolongate(pg, grid, clouds.longwave, longwave);
    clouds = { samples, annual, longwave };
  }

  const final = pass(grid, elevation, areaKm2, oceanDistance, lake, clouds, ALBEDO_ITERATIONS);
  return {
    circulation,
    globalMeanTemperature: final.temperature.globalMean,
    declinations: decl,
    temperature: final.temperature,
    windU: final.winds.u,
    windV: final.winds.v,
    ocean: final.ocean,
    ice: final.ice,
    moisture: final.moisture,
    sunshineHours: sunshineHours(grid, decl, final.moisture.cloud),
    albedoRounds: final.rounds,
  };
}

/**
 * Energy balance with the ice albedo iterated under a given cloud state,
 * from a cold start: the first round counts near-freezing cells as ice
 * (the bootstrap margin), the next rounds keep what sustains itself.
 */
function solveBalance(
  grid: Grid,
  params: PlanetParams,
  decl: Float64Array,
  elevation: Float64Array,
  seaLevel: number,
  areaKm2: Float64Array,
  oceanDistance: Int32Array,
  clouds: CloudState,
  maxRounds: number,
): { temperature: TemperatureFields; ice: IceFields; rounds: number } {
  const n = grid.n;
  const bare = new Float64Array(n);
  const albedo = new Float64Array(n);
  const nextAlbedo = new Float64Array(n);
  surfaceAlbedo(grid, elevation, seaLevel, null, bare);
  albedo.set(bare);
  const solve = (): TemperatureFields =>
    computeTemperature(grid, params, decl, elevation, seaLevel, oceanDistance, albedo, bare, clouds.samples, clouds.annual, clouds.longwave);
  let temperature = solve();
  let ice = classifyIce(grid, temperature, elevation, seaLevel, areaKm2, ICE_BOOTSTRAP_MARGIN_C);
  let totalArea = 0;
  for (let i = 0; i < n; i++) totalArea += grid.area[i];
  let rounds = 1;
  for (; rounds < maxRounds; rounds++) {
    surfaceAlbedo(grid, elevation, seaLevel, ice, nextAlbedo);
    let change = 0;
    for (let i = 0; i < n; i++) change += grid.area[i] * Math.abs(nextAlbedo[i] - albedo[i]);
    if (change / totalArea < ALBEDO_TOLERANCE) break;
    albedo.set(nextAlbedo);
    temperature = solve();
    ice = classifyIce(grid, temperature, elevation, seaLevel, areaKm2);
  }
  return { temperature, ice, rounds };
}
