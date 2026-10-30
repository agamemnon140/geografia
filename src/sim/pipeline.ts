import { computeClimate } from './climate/climate.ts';
import type { CirculationInfo } from './climate/circulation.ts';
import { evaporationRate } from './climate/moisture.ts';
import type { BasinInfo } from './climate/ocean.ts';
import { Grid, cellAreasKm2, levelForRadius } from './grid/grid.ts';
import type { LakeInfo } from './hydrology/routing.ts';
import { validateParams, type PlanetParams } from './params.ts';
import { Rng } from './rng/xoshiro.ts';
import { computeStats, type WorldStats } from './stats.ts';
import { TectonicsSim } from './tectonics/simulation.ts';

export interface PlateInfo {
  axis: [number, number, number];
  rate: number;
}

/**
 * A built planet. Plain data and typed arrays only, so it can be posted from
 * the worker and later stored per step for the timeline. Elevations are
 * absolute meters in the model frame; subtract `seaLevel` for height above
 * the sea. Per-cell crust, water and climate fields are the provenance the
 * inspector shows. Seasonal fields hold 12 samples, sample-major
 * (sample * n + cell).
 */
export interface World {
  params: PlanetParams;
  level: number;
  n: number;
  radiusKm: number;
  steps: number;
  seaLevel: number;
  elevation: Float64Array;
  plate: Int32Array;
  /** 0 oceanic, 1 continental. */
  crustType: Uint8Array;
  /** Crust thickness in km. */
  thickness: Float64Array;
  /** Steps since the crust formed (oceanic) or since the start (continental). */
  crustAge: Float64Array;
  /** Volcanic additions in km (arcs and hotspots). */
  volcanic: Float64Array;
  /** Sediment in km deposited by erosion. */
  sediment: Float64Array;
  /** Surface lowered by erosion over the crust's life, meters. */
  eroded: Float64Array;
  /** Last step in which the cell was in a continental collision, -1 if never. */
  orogenyStep: Int32Array;
  /** Boundary type, see BOUNDARY_* in tectonics/simulation.ts. */
  boundary: Uint8Array;
  /** Annual precipitation from the moisture model, mm per year. */
  precipitation: Float64Array;
  /** Precipitation per sample, mm per year. */
  precipitationSamples: Float64Array;
  /** Annual evaporation (open water, and land recycling), mm per year. */
  evaporation: Float64Array;
  /** Part of the annual precipitation due to orographic lift, mm per year. */
  precipitationOrographic: Float64Array;
  /** Part due to wind convergence, mm per year. */
  precipitationConvergence: Float64Array;
  /** Water passing through the cell, km^3 per year. */
  discharge: Float64Array;
  /** Cell the water flows to; -1 on the ocean and in terminal pits. */
  downstream: Int32Array;
  /** Water surface: lake level on lake cells, the elevation elsewhere (model frame). */
  waterLevel: Float64Array;
  /** Lake id under lake water, else -1. */
  lake: Int32Array;
  /** First ocean or lake cell downstream; where the cell's sediment ends up. */
  mouth: Int32Array;
  /** Longest flow path ending in the cell, km. */
  riverLength: Float64Array;
  lakes: LakeInfo[];
  /** Annual-mean top-of-atmosphere insolation, W/m^2. */
  insolationAnnual: Float64Array;
  /** 0 on the ocean, toward 1 deep inside continents. */
  continentality: Float64Array;
  /** Annual-mean surface temperature, degrees C (currents included). */
  temperatureAnnual: Float64Array;
  /** Surface temperature per sample, degrees C. */
  temperature: Float64Array;
  /** Eastward surface wind per sample, m/s. */
  windU: Float64Array;
  /** Northward surface wind per sample, m/s. */
  windV: Float64Array;
  /** Ocean basin id, -1 on land. */
  basin: Int32Array;
  basins: BasinInfo[];
  /** Transport streamfunction of the wind-driven gyres, m^3/s. */
  streamfunction: Float64Array;
  /** Surface current, eastward and northward, m/s. */
  currentU: Float64Array;
  currentV: Float64Array;
  /** Temperature anomaly carried by the currents (and felt on the coast), degrees C. */
  sstAnomaly: Float64Array;
  circulation: CirculationInfo;
  /** Global mean sea-level temperature for this insolation, degrees C. */
  globalMeanTemperature: number;
  plates: PlateInfo[];
  /** World cells of the mantle hotspots. */
  hotspots: number[];
  stats: WorldStats;
}

export type Progress = (stage: string, fraction: number) => void;

/** Transferable buffers of a world, for zero-copy posting between threads. */
export function worldBuffers(world: World): ArrayBuffer[] {
  const arrays = [
    world.elevation, world.plate, world.crustType, world.thickness, world.crustAge,
    world.volcanic, world.sediment, world.eroded, world.orogenyStep, world.boundary,
    world.precipitation, world.precipitationSamples, world.evaporation,
    world.precipitationOrographic, world.precipitationConvergence,
    world.discharge, world.downstream, world.waterLevel, world.lake, world.mouth, world.riverLength,
    world.insolationAnnual, world.continentality, world.temperatureAnnual, world.temperature,
    world.windU, world.windV,
    world.basin, world.streamfunction, world.currentU, world.currentV, world.sstAnomaly,
  ];
  return arrays.map((a) => a.buffer as ArrayBuffer);
}

/** Build a planet from parameters. Deterministic: same params and seed, same arrays. */
export function build(input: PlanetParams, onProgress: Progress = () => {}): World {
  const params = validateParams(input);
  onProgress('grid', 0);
  const level = levelForRadius(params.radiusKm);
  const grid = Grid.get(level);
  const rng = new Rng(params.seed);
  const areaKm2 = cellAreasKm2(grid, params.radiusKm);

  onProgress('tectonics', 0.05);
  const sim = new TectonicsSim(grid, params, rng.fork('tectonics'));
  sim.run(params.tectonicAge, (f) => onProgress('tectonics', 0.05 + 0.6 * f));

  // Proxy hydrology on the finished relief: ocean distances and a lake map for the climate.
  onProgress('hydrology', 0.66);
  const hydro = sim.hydrology;
  hydro.applyProxyPrecipitation(sim.elevation, sim.seaLevel);
  hydro.run(sim.elevation, sim.seaLevel);

  onProgress('climate', 0.7);
  const climate = computeClimate(grid, params, sim.elevation, sim.seaLevel, areaKm2, hydro.oceanDistance, hydro.lake);

  // Final rivers and lakes from the climate's precipitation and evaporation (DESIGN 3.4).
  onProgress('rivers', 0.9);
  const n = grid.n;
  hydro.precipitation.set(climate.moisture.annual);
  const evaporation = new Float64Array(n);
  for (let i = 0; i < n; i++) evaporation[i] = evaporationRate(climate.temperature.annual[i]);
  hydro.evaporation = evaporation;
  hydro.run(sim.elevation, sim.seaLevel);

  onProgress('stats', 0.96);
  const pool = sim.pool;
  const claim = sim.wParcel;
  const crustType = new Uint8Array(n);
  const thickness = new Float64Array(n);
  const crustAge = new Float64Array(n);
  const volcanic = new Float64Array(n);
  const sediment = new Float64Array(n);
  const eroded = new Float64Array(n);
  const orogenyStep = new Int32Array(n);
  for (let j = 0; j < n; j++) {
    const i = claim[j];
    crustType[j] = pool.crustType[i];
    thickness[j] = pool.thickness[i];
    crustAge[j] = pool.age[i];
    volcanic[j] = pool.volcanic[i];
    sediment[j] = pool.sediment[i];
    eroded[j] = pool.eroded[i];
    orogenyStep[j] = pool.orogenyStep[i];
  }
  const stats = computeStats(
    { elevation: sim.elevation, areaKm2, seaLevel: sim.seaLevel, crustType, thickness, activePlates: sim.activePlates() },
    { precipitation: hydro.precipitation, discharge: hydro.discharge, lake: hydro.lake, mouth: hydro.mouth, riverLength: hydro.riverLength, lakes: hydro.lakes },
    {
      lat: grid.lat,
      temperatureAnnual: climate.temperature.annual,
      temperature: climate.temperature.samples,
      circulation: climate.circulation,
      evaporation: climate.moisture.evaporation,
      basins: climate.ocean.basins,
      currentU: climate.ocean.currentU,
      currentV: climate.ocean.currentV,
      sstAnomaly: climate.ocean.sstAnomaly,
    },
  );

  onProgress('done', 1);
  return {
    params,
    level,
    n,
    radiusKm: params.radiusKm,
    steps: sim.step,
    seaLevel: sim.seaLevel,
    elevation: sim.elevation,
    plate: sim.wPlate,
    crustType,
    thickness,
    crustAge,
    volcanic,
    sediment,
    eroded,
    orogenyStep,
    boundary: sim.boundary,
    precipitation: hydro.precipitation,
    precipitationSamples: climate.moisture.samples,
    evaporation: climate.moisture.evaporation,
    precipitationOrographic: climate.moisture.orographic,
    precipitationConvergence: climate.moisture.convergence,
    discharge: hydro.discharge,
    downstream: hydro.downstream,
    waterLevel: hydro.waterLevel,
    lake: hydro.lake,
    mouth: hydro.mouth,
    riverLength: hydro.riverLength,
    lakes: hydro.lakes,
    insolationAnnual: climate.temperature.insolationAnnual,
    continentality: climate.temperature.continentality,
    temperatureAnnual: climate.temperature.annual,
    temperature: climate.temperature.samples,
    windU: climate.windU,
    windV: climate.windV,
    basin: climate.ocean.basin,
    basins: climate.ocean.basins,
    streamfunction: climate.ocean.streamfunction,
    currentU: climate.ocean.currentU,
    currentV: climate.ocean.currentV,
    sstAnomaly: climate.ocean.sstAnomaly,
    circulation: climate.circulation,
    globalMeanTemperature: climate.globalMeanTemperature,
    plates: sim.plates.map((p) => ({ axis: [p.axis[0], p.axis[1], p.axis[2]], rate: p.rate })),
    hotspots: Array.from(sim.hotspots),
    stats,
  };
}
