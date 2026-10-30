import { computeClimate } from './climate/climate.ts';
import type { CirculationInfo } from './climate/circulation.ts';
import { classifyKoppen } from './climate/koppen.ts';
import { evaporationRate } from './climate/moisture.ts';
import type { BasinInfo } from './climate/ocean.ts';
import { MAX_LEVEL, MIN_LEVEL } from './constants.ts';
import { Grid, cellAreasKm2, levelForRadius } from './grid/grid.ts';
import { Hydrology, type LakeInfo } from './hydrology/routing.ts';
import { solveSeaLevel } from './hypsometry.ts';
import { validateParams, waterVolumeKm3, type PlanetParams } from './params.ts';
import { Rng } from './rng/xoshiro.ts';
import { computeStats, type WorldStats } from './stats.ts';
import { SEDIMENT_M_PER_KM, TRENCH_M, crustElevation, volcanicFactor } from './tectonics/crust.ts';
import { BOUNDARY_SUBDUCTING, TectonicsSim, type TectonicEvent } from './tectonics/simulation.ts';

import type { FloatArray } from './types.ts';

export type { FloatArray } from './types.ts';

export interface PlateInfo {
  axis: [number, number, number];
  rate: number;
}

export interface BuildOptions {
  /** Subdivision levels below the planet's own level, for quick previews (DESIGN 8.3). */
  coarser?: number;
  /** Number of timeline keyframes to capture during the tectonic loop (DESIGN 9.1); 0 for none. */
  keyframes?: number;
}

/**
 * A built planet. Plain data and typed arrays only, so it can be posted from
 * the worker and stored per step for the timeline. Elevations are absolute
 * meters in the model frame; subtract `seaLevel` for height above the sea.
 * Per-cell crust, water and climate fields are the provenance the inspector
 * shows. Seasonal fields hold 12 samples, sample-major (sample * n + cell).
 */
export interface World {
  params: PlanetParams;
  level: number;
  /** True when built below the planet's own level. */
  preview: boolean;
  n: number;
  radiusKm: number;
  /** Tectonic step this world shows; equals the tectonic age for a finished planet. */
  steps: number;
  /** Final sea level, with the water locked in ice sheets removed. */
  seaLevel: number;
  /** Sea level the tectonic loop ran with (all water liquid). */
  loopSeaLevel: number;
  elevation: FloatArray;
  /** Elevation components: crust (isostasy and age), volcanic piles, sediment, trench; they sum to `elevation`. */
  elevationCrust: FloatArray;
  elevationVolcanic: FloatArray;
  elevationSediment: FloatArray;
  elevationTrench: FloatArray;
  plate: Int32Array;
  /** 0 oceanic, 1 continental. */
  crustType: Uint8Array;
  /** Crust thickness in km. */
  thickness: FloatArray;
  /** Steps since the crust formed (oceanic) or since the start (continental). */
  crustAge: FloatArray;
  /** Volcanic additions in km (arcs and hotspots). */
  volcanic: FloatArray;
  /** Sediment in km deposited by erosion. */
  sediment: FloatArray;
  /** Surface lowered by erosion over the crust's life, meters. */
  eroded: FloatArray;
  /** Last step in which the cell was in a continental collision, -1 if never. */
  orogenyStep: Int32Array;
  /** Boundary type, see BOUNDARY_* in tectonics/simulation.ts. */
  boundary: Uint8Array;
  /** Annual precipitation from the moisture model, mm per year. */
  precipitation: FloatArray;
  /** Precipitation per sample, mm per year. */
  precipitationSamples: FloatArray;
  /** Annual evaporation (open water, and the recycled share on land), mm per year. */
  evaporation: FloatArray;
  /** Part of the annual precipitation due to orographic lift, mm per year. */
  precipitationOrographic: FloatArray;
  /** Part due to wind convergence, mm per year. */
  precipitationConvergence: FloatArray;
  /** Water passing through the cell, km^3 per year. */
  discharge: FloatArray;
  /** Cell the water flows to; -1 on the ocean and in terminal pits. */
  downstream: Int32Array;
  /** Water surface: lake level on lake cells, the elevation elsewhere (model frame). */
  waterLevel: FloatArray;
  /** Lake id under lake water, else -1. */
  lake: Int32Array;
  /** First ocean or lake cell downstream; where the cell's sediment ends up. */
  mouth: Int32Array;
  /** Longest flow path ending in the cell, km. */
  riverLength: FloatArray;
  lakes: LakeInfo[];
  /** Annual-mean top-of-atmosphere insolation, W/m^2. */
  insolationAnnual: FloatArray;
  /** 0 on the ocean, toward 1 deep inside continents. */
  continentality: FloatArray;
  /** Annual-mean surface temperature, degrees C (currents and ice included). */
  temperatureAnnual: FloatArray;
  /** Surface temperature per sample, degrees C. */
  temperature: FloatArray;
  /** Temperature components: the annual mean is the global mean plus these, plus the current anomaly, plus the ice cooling. */
  temperatureInsolation: FloatArray;
  temperatureLapse: FloatArray;
  temperatureContinental: FloatArray;
  /** Eastward surface wind per sample, m/s. */
  windU: FloatArray;
  /** Northward surface wind per sample, m/s. */
  windV: FloatArray;
  /** Ocean basin id, -1 on land. */
  basin: Int32Array;
  basins: BasinInfo[];
  /** Transport streamfunction of the wind-driven gyres, m^3/s. */
  streamfunction: FloatArray;
  /** Surface current, eastward and northward, m/s. */
  currentU: FloatArray;
  currentV: FloatArray;
  /** Temperature anomaly carried by the currents (and felt on the coast), degrees C. */
  sstAnomaly: FloatArray;
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
  /** Plate births and deaths up to this step, oldest first. */
  events: TectonicEvent[];
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

/** A world with every float field in Float32: half the memory, for timeline keyframes. */
export function compactWorld(world: World): World {
  const out = { ...world };
  for (const key of Object.keys(world) as (keyof World)[]) {
    const value = world[key];
    if (value instanceof Float64Array) (out as unknown as Record<string, unknown>)[key] = Float32Array.from(value);
  }
  return out;
}

/** The tectonic state of one step, copied out of the simulation so the climate can be computed on it later. */
export interface ReliefState {
  step: number;
  seaLevel: number;
  elevation: Float64Array;
  plate: Int32Array;
  crustType: Uint8Array;
  thickness: Float64Array;
  crustAge: Float64Array;
  volcanic: Float64Array;
  sediment: Float64Array;
  eroded: Float64Array;
  orogenyStep: Int32Array;
  boundary: Uint8Array;
  plates: PlateInfo[];
  hotspots: number[];
  events: TectonicEvent[];
}

/** Copy the simulation's current state (the final one shares no buffers with the simulation either). */
export function snapshotSim(sim: TectonicsSim): ReliefState {
  const n = sim.grid.n;
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
  return {
    step: sim.step,
    seaLevel: sim.seaLevel,
    elevation: Float64Array.from(sim.elevation),
    plate: Int32Array.from(sim.wPlate),
    crustType,
    thickness,
    crustAge,
    volcanic,
    sediment,
    eroded,
    orogenyStep,
    boundary: Uint8Array.from(sim.boundary),
    plates: sim.plates.map((p) => ({ axis: [p.axis[0], p.axis[1], p.axis[2]], rate: p.rate })),
    hotspots: Array.from(sim.hotspots),
    events: sim.events.map((e) => ({ ...e })),
  };
}

/** Everything a build needs besides the relief: shared by the final world and every keyframe. */
export interface BuildContext {
  params: PlanetParams;
  grid: Grid;
  level: number;
  preview: boolean;
  areaKm2: Float64Array;
  hydro: Hydrology;
}

/** Hydrology, climate, ice, biomes and statistics on a relief state (everything after the tectonic loop). */
export function finalize(ctx: BuildContext, state: ReliefState, onProgress: Progress = () => {}): World {
  const { params, grid, areaKm2, hydro } = ctx;
  const n = grid.n;

  // Proxy hydrology on the relief: ocean distances and a lake map for the climate.
  onProgress('hydrology', 0.66);
  hydro.applyProxyPrecipitation(state.elevation, state.seaLevel);
  hydro.run(state.elevation, state.seaLevel);

  onProgress('climate', 0.7);
  const climate = computeClimate(grid, params, state.elevation, state.seaLevel, areaKm2, hydro.oceanDistance, hydro.lake);

  // Ice sheets lock water away: the final sea level is solved from what stays liquid (DESIGN 3.5 step 6).
  onProgress('rivers', 0.9);
  const seaLevel = solveSeaLevel(state.elevation, areaKm2, Math.max(0, waterVolumeKm3(params) - climate.ice.iceVolumeKm3));

  // Final rivers and lakes from the climate's precipitation and evaporation (DESIGN 3.4).
  hydro.precipitation.set(climate.moisture.annual);
  const evaporation = new Float64Array(n);
  for (let i = 0; i < n; i++) evaporation[i] = evaporationRate(climate.temperature.annual[i]);
  hydro.evaporation = evaporation;
  hydro.run(state.elevation, seaLevel);

  onProgress('biomes', 0.94);
  const koppen = classifyKoppen(grid, state.elevation, seaLevel, climate.temperature.samples, climate.moisture.samples);

  onProgress('stats', 0.96);
  const elevationCrust = new Float64Array(n);
  const elevationVolcanic = new Float64Array(n);
  const elevationSediment = new Float64Array(n);
  const elevationTrench = new Float64Array(n);
  const seen = new Uint8Array(state.plates.length);
  let activePlates = 0;
  for (let j = 0; j < n; j++) {
    elevationCrust[j] = crustElevation(state.crustType[j], state.thickness[j], state.crustAge[j], 0, 0);
    elevationVolcanic[j] = state.volcanic[j] * volcanicFactor(state.crustType[j]);
    elevationSediment[j] = state.sediment[j] * SEDIMENT_M_PER_KM;
    elevationTrench[j] = state.boundary[j] === BOUNDARY_SUBDUCTING ? -TRENCH_M : 0;
    const p = state.plate[j];
    if (!seen[p]) {
      seen[p] = 1;
      activePlates++;
    }
  }
  const stats = computeStats(
    grid,
    { elevation: state.elevation, areaKm2, seaLevel, crustType: state.crustType, thickness: state.thickness, activePlates },
    {
      precipitation: Float64Array.from(hydro.precipitation), discharge: hydro.discharge, lake: hydro.lake,
      mouth: hydro.mouth, riverLength: hydro.riverLength, lakes: hydro.lakes,
    },
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

  // The hydrology object is reused for the next keyframe, so its arrays are copied out.
  return {
    params,
    level: ctx.level,
    preview: ctx.preview,
    n,
    radiusKm: params.radiusKm,
    steps: state.step,
    seaLevel,
    loopSeaLevel: state.seaLevel,
    elevation: state.elevation,
    elevationCrust,
    elevationVolcanic,
    elevationSediment,
    elevationTrench,
    plate: state.plate,
    crustType: state.crustType,
    thickness: state.thickness,
    crustAge: state.crustAge,
    volcanic: state.volcanic,
    sediment: state.sediment,
    eroded: state.eroded,
    orogenyStep: state.orogenyStep,
    boundary: state.boundary,
    precipitation: Float64Array.from(hydro.precipitation),
    precipitationSamples: climate.moisture.samples,
    evaporation: climate.moisture.evaporation,
    precipitationOrographic: climate.moisture.orographic,
    precipitationConvergence: climate.moisture.convergence,
    discharge: Float64Array.from(hydro.discharge),
    downstream: Int32Array.from(hydro.downstream),
    waterLevel: Float64Array.from(hydro.waterLevel),
    lake: Int32Array.from(hydro.lake),
    mouth: Int32Array.from(hydro.mouth),
    riverLength: Float64Array.from(hydro.riverLength),
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
    plates: state.plates,
    hotspots: state.hotspots,
    events: state.events,
    stats,
  };
}

/** Steps at which keyframes are captured for a tectonic age and a keyframe count: evenly spaced, the age itself excluded. */
export function keyframeSteps(tectonicAge: number, keyframes: number): number[] {
  if (keyframes <= 0) return [];
  const out: number[] = [];
  for (let k = 1; k <= keyframes; k++) {
    const step = Math.round((k * tectonicAge) / (keyframes + 1));
    if (step > 0 && step < tectonicAge && !out.includes(step)) out.push(step);
  }
  return out;
}

export interface History {
  world: World;
  /** Tectonic states captured along the way, oldest first; turn them into worlds with `finalize`. */
  snapshots: ReliefState[];
  context: BuildContext;
}

/**
 * Build a planet and keep the tectonic snapshots requested in the options.
 * Deterministic: same params, seed and options, same arrays. The snapshots
 * are cheap copies; their climates are computed on demand by `finalize`, so
 * the final world arrives first and the history can follow in the background.
 */
export function buildHistory(input: PlanetParams, onProgress: Progress = () => {}, options: BuildOptions = {}): History {
  const params = validateParams(input);
  onProgress('grid', 0);
  const ownLevel = levelForRadius(params.radiusKm);
  const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, ownLevel - (options.coarser ?? 0)));
  const grid = Grid.get(level);
  const rng = new Rng(params.seed);
  const areaKm2 = cellAreasKm2(grid, params.radiusKm);

  onProgress('tectonics', 0.05);
  const sim = new TectonicsSim(grid, params, rng.fork('tectonics'));
  const wanted = keyframeSteps(params.tectonicAge, options.keyframes ?? 0);
  const snapshots: ReliefState[] = [];
  sim.run(
    params.tectonicAge,
    (f) => onProgress('tectonics', 0.05 + 0.6 * f),
    (step) => {
      if (wanted.includes(step)) snapshots.push(snapshotSim(sim));
    },
  );
  const context: BuildContext = { params, grid, level, preview: level < ownLevel, areaKm2, hydro: sim.hydrology };
  const world = finalize(context, snapshotSim(sim), onProgress);
  onProgress('done', 1);
  return { world, snapshots, context };
}

/** Build a planet from parameters (no history). */
export function build(input: PlanetParams, onProgress: Progress = () => {}, options: BuildOptions = {}): World {
  return buildHistory(input, onProgress, { ...options, keyframes: 0 }).world;
}
