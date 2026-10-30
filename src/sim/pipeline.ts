import { computeClimate } from './climate/climate.ts';
import type { CirculationInfo } from './climate/circulation.ts';
import { classifyKoppen } from './climate/koppen.ts';
import { evaporationRate } from './climate/moisture.ts';
import type { BasinInfo } from './climate/ocean.ts';
import { MAX_LEVEL, MIN_LEVEL } from './constants.ts';
import { Grid, cellAreasKm2, levelForRadius } from './grid/grid.ts';
import type { LakeInfo } from './hydrology/routing.ts';
import { solveSeaLevel } from './hypsometry.ts';
import { validateParams, waterVolumeKm3, type PlanetParams } from './params.ts';
import { Rng } from './rng/xoshiro.ts';
import { computeStats, type WorldStats } from './stats.ts';
import { SEDIMENT_M_PER_KM, TRENCH_M, crustElevation, volcanicFactor } from './tectonics/crust.ts';
import { BOUNDARY_SUBDUCTING, TectonicsSim } from './tectonics/simulation.ts';

export interface PlateInfo {
  axis: [number, number, number];
  rate: number;
}

export interface BuildOptions {
  /** Subdivision levels below the planet's own level, for quick previews (DESIGN 8.3). */
  coarser?: number;
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
  /** True when built below the planet's own level. */
  preview: boolean;
  n: number;
  radiusKm: number;
  steps: number;
  /** Final sea level, with the water locked in ice sheets removed. */
  seaLevel: number;
  /** Sea level the tectonic loop ran with (all water liquid). */
  loopSeaLevel: number;
  elevation: Float64Array;
  /** Elevation components: crust (isostasy and age), volcanic piles, sediment, trench; they sum to `elevation`. */
  elevationCrust: Float64Array;
  elevationVolcanic: Float64Array;
  elevationSediment: Float64Array;
  elevationTrench: Float64Array;
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
  /** Annual evaporation (open water, and the recycled share on land), mm per year. */
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
  /** Annual-mean surface temperature, degrees C (currents and ice included). */
  temperatureAnnual: Float64Array;
  /** Surface temperature per sample, degrees C. */
  temperature: Float64Array;
  /** Temperature components: the annual mean is the global mean plus these, plus the current anomaly, plus the ice cooling. */
  temperatureInsolation: Float64Array;
  temperatureLapse: Float64Array;
  temperatureContinental: Float64Array;
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
  /** Samples per year with sea ice, 0 to 12. */
  seaIceMonths: Uint8Array;
  /** 1 under an ice sheet. */
  iceSheet: Uint8Array;
  /** Water locked in ice sheets, km^3. */
  iceVolumeKm3: number;
  /** Koppen code, see climate/koppen.ts. */
  koppen: Uint8Array;
  circulation: CirculationInfo;
  /** Global mean sea-level temperature for this insolation and glacial phase, degrees C. */
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
    world.elevation, world.elevationCrust, world.elevationVolcanic, world.elevationSediment, world.elevationTrench,
    world.plate, world.crustType, world.thickness, world.crustAge,
    world.volcanic, world.sediment, world.eroded, world.orogenyStep, world.boundary,
    world.precipitation, world.precipitationSamples, world.evaporation,
    world.precipitationOrographic, world.precipitationConvergence,
    world.discharge, world.downstream, world.waterLevel, world.lake, world.mouth, world.riverLength,
    world.insolationAnnual, world.continentality, world.temperatureAnnual, world.temperature,
    world.temperatureInsolation, world.temperatureLapse, world.temperatureContinental,
    world.windU, world.windV,
    world.basin, world.streamfunction, world.currentU, world.currentV, world.sstAnomaly,
    world.seaIceMonths, world.iceSheet, world.koppen,
  ];
  return arrays.map((a) => a.buffer as ArrayBuffer);
}

/** Build a planet from parameters. Deterministic: same params, seed and options, same arrays. */
export function build(input: PlanetParams, onProgress: Progress = () => {}, options: BuildOptions = {}): World {
  const params = validateParams(input);
  onProgress('grid', 0);
  const ownLevel = levelForRadius(params.radiusKm);
  const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, ownLevel - (options.coarser ?? 0)));
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

  // Ice sheets lock water away: the final sea level is solved from what stays liquid (DESIGN 3.5 step 6).
  onProgress('rivers', 0.9);
  const n = grid.n;
  const loopSeaLevel = sim.seaLevel;
  const seaLevel = solveSeaLevel(sim.elevation, areaKm2, Math.max(0, waterVolumeKm3(params) - climate.ice.iceVolumeKm3));

  // Final rivers and lakes from the climate's precipitation and evaporation (DESIGN 3.4).
  hydro.precipitation.set(climate.moisture.annual);
  const evaporation = new Float64Array(n);
  for (let i = 0; i < n; i++) evaporation[i] = evaporationRate(climate.temperature.annual[i]);
  hydro.evaporation = evaporation;
  hydro.run(sim.elevation, seaLevel);

  onProgress('biomes', 0.94);
  const koppen = classifyKoppen(grid, sim.elevation, seaLevel, climate.temperature.samples, climate.moisture.samples);

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
  const elevationCrust = new Float64Array(n);
  const elevationVolcanic = new Float64Array(n);
  const elevationSediment = new Float64Array(n);
  const elevationTrench = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const i = claim[j];
    crustType[j] = pool.crustType[i];
    thickness[j] = pool.thickness[i];
    crustAge[j] = pool.age[i];
    volcanic[j] = pool.volcanic[i];
    sediment[j] = pool.sediment[i];
    eroded[j] = pool.eroded[i];
    orogenyStep[j] = pool.orogenyStep[i];
    elevationCrust[j] = crustElevation(pool.crustType[i], pool.thickness[i], pool.age[i], 0, 0);
    elevationVolcanic[j] = pool.volcanic[i] * volcanicFactor(pool.crustType[i]);
    elevationSediment[j] = pool.sediment[i] * SEDIMENT_M_PER_KM;
    elevationTrench[j] = sim.boundary[j] === BOUNDARY_SUBDUCTING ? -TRENCH_M : 0;
  }
  const stats = computeStats(
    grid,
    { elevation: sim.elevation, areaKm2, seaLevel, crustType, thickness, activePlates: sim.activePlates() },
    { precipitation: hydro.precipitation, discharge: hydro.discharge, lake: hydro.lake, mouth: hydro.mouth, riverLength: hydro.riverLength, lakes: hydro.lakes },
    {
      temperatureAnnual: climate.temperature.annual,
      temperature: climate.temperature.samples,
      circulation: climate.circulation,
      evaporation: climate.moisture.evaporation,
      basins: climate.ocean.basins,
      currentU: climate.ocean.currentU,
      currentV: climate.ocean.currentV,
      sstAnomaly: climate.ocean.sstAnomaly,
    },
    { seaIceMonths: climate.ice.seaIceMonths, iceSheet: climate.ice.iceSheet, koppen },
  );

  onProgress('done', 1);
  return {
    params,
    level,
    preview: level < ownLevel,
    n,
    radiusKm: params.radiusKm,
    steps: sim.step,
    seaLevel,
    loopSeaLevel,
    elevation: sim.elevation,
    elevationCrust,
    elevationVolcanic,
    elevationSediment,
    elevationTrench,
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
    temperatureInsolation: climate.temperature.insolationTerm,
    temperatureLapse: climate.temperature.lapseTerm,
    temperatureContinental: climate.temperature.continentalTerm,
    windU: climate.windU,
    windV: climate.windV,
    basin: climate.ocean.basin,
    basins: climate.ocean.basins,
    streamfunction: climate.ocean.streamfunction,
    currentU: climate.ocean.currentU,
    currentV: climate.ocean.currentV,
    sstAnomaly: climate.ocean.sstAnomaly,
    seaIceMonths: climate.ice.seaIceMonths,
    iceSheet: climate.ice.iceSheet,
    iceVolumeKm3: climate.ice.iceVolumeKm3,
    koppen,
    circulation: climate.circulation,
    globalMeanTemperature: climate.globalMeanTemperature,
    plates: sim.plates.map((p) => ({ axis: [p.axis[0], p.axis[1], p.axis[2]], rate: p.rate })),
    hotspots: Array.from(sim.hotspots),
    stats,
  };
}
