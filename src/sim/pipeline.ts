import { computeFauna } from './biosphere/fauna.ts';
import { computeCivilization, type CityInfo } from './civilization/civilization.ts';
import { computeFlora } from './biosphere/flora.ts';
import { computeClimate } from './climate/climate.ts';
import type { CirculationInfo } from './climate/circulation.ts';
import { classifyKoppen } from './climate/koppen.ts';
import { evaporationRate } from './climate/moisture.ts';
import { prolongate } from './climate/multilevel.ts';
import type { BasinInfo } from './climate/ocean.ts';
import { MAX_LEVEL, MIN_LEVEL } from './constants.ts';
import { Grid, cellAreasKm2, levelForRadius } from './grid/grid.ts';
import { Hydrology, type LakeInfo } from './hydrology/routing.ts';
import { solveSeaLevel, waterVolumeBelow } from './hypsometry.ts';
import { validateParams, waterVolumeKm3, type PlanetParams } from './params.ts';
import { MINERAL_COUNT, computeMinerals } from './resources/minerals.ts';
import { Rng } from './rng/xoshiro.ts';
import { computeStats, type WorldStats } from './stats.ts';
import { LINEAGE_COUNT, SEDIMENT_M_PER_KM, convergentDepression, crustElevation, volcanicFactor } from './tectonics/crust.ts';
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
  /** Number of timeline keyframes to capture during the tectonic loop (DESIGN 9.1); 0 for none. With `keyframeInterval` it is the most keyframes allowed instead. */
  keyframes?: number;
  /** Capture a keyframe every this many steps (million years) instead of spacing `keyframes` evenly; the interval doubles, triples, ... until the count fits `keyframes` (M25). */
  keyframeInterval?: number;
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
  /** Name of the measured relief this world was built on (the real Earth), or null for a simulated planet. */
  reference: string | null;
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
  /** Resource bookkeeping carried by the parcels (M21), km of sediment: swamp (coal), warm shallow-sea (oil source rock), evaporite (salt). */
  coal: FloatArray;
  oil: FloatArray;
  salt: FloatArray;
  /** Mineral potential per mineral and cell, mineral-major in resources/minerals.ts MINERALS order, 0 to 1. */
  mineralPotential: FloatArray;
  /** Bit m set where mineral m has a deposit (drawn from the potential, or measured on the real Earth). */
  deposits: Uint8Array;
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
  /** Temperature components: the annual mean is the global mean plus these, plus the current anomaly. The balance term holds insolation, albedo and heat transport. */
  temperatureBalance: FloatArray;
  temperatureLapse: FloatArray;
  temperatureContinental: FloatArray;
  /** Eastward surface wind per sample, m/s. */
  windU: FloatArray;
  /** Northward surface wind per sample, m/s. */
  windV: FloatArray;
  /** Cloud cover per sample, sample-major, 0 to 1 (climate/clouds.ts). */
  cloud: FloatArray;
  /** Annual-mean cloud cover. */
  cloudAnnual: FloatArray;
  /** Sunshine hours per year: the daylight hours not under cloud. */
  sunshineHours: FloatArray;
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
  /** Flora (M22, biosphere/flora.ts): net primary productivity in g C/m^2/yr, soil fertility 0 to 1 with its terms, vegetation class. */
  npp: FloatArray;
  soil: FloatArray;
  soilAsh: FloatArray;
  soilAlluvium: FloatArray;
  soilLoss: FloatArray;
  vegetation: Uint8Array;
  /** Fauna (M23, biosphere/fauna.ts): lineage shares per cell (cell-major, LINEAGE_COUNT per cell), dominant lineage (REALM_NONE on water), endemism and richness 0 to 1, megafauna bits, landmass id (-1 on water) and the landmasses' areas, km^2. */
  lineage: FloatArray;
  realm: Uint8Array;
  endemism: FloatArray;
  richness: FloatArray;
  megafauna: Uint8Array;
  landmass: Int32Array;
  landmassAreas: number[];
  /** Civilization (M24, civilization/civilization.ts): habitability with its three terms (cell-major), agricultural potential, the city-site score with its eight terms (cell-major, CITY_TERMS order), the candidate cities ranked best first, the arrival of people in thousands of years (UNREACHED where none), the origin cell. */
  habitability: FloatArray;
  habitabilityTerms: FloatArray;
  agriculture: FloatArray;
  citySite: FloatArray;
  cityTerms: FloatArray;
  cities: CityInfo[];
  arrivalKa: FloatArray;
  origin: number;
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
    world.coal, world.oil, world.salt, world.mineralPotential, world.deposits,
    world.precipitation, world.precipitationSamples, world.evaporation,
    world.precipitationOrographic, world.precipitationConvergence,
    world.discharge, world.downstream, world.waterLevel, world.lake, world.mouth, world.riverLength,
    world.insolationAnnual, world.continentality, world.temperatureAnnual, world.temperature,
    world.temperatureBalance, world.temperatureLapse, world.temperatureContinental,
    world.windU, world.windV, world.cloud, world.cloudAnnual, world.sunshineHours,
    world.basin, world.streamfunction, world.currentU, world.currentV, world.sstAnomaly,
    world.seaIceMonths, world.iceSheet, world.koppen,
    world.npp, world.soil, world.soilAsh, world.soilAlluvium, world.soilLoss, world.vegetation,
    world.lineage, world.realm, world.endemism, world.richness, world.megafauna, world.landmass,
    world.habitability, world.habitabilityTerms, world.agriculture, world.citySite, world.cityTerms, world.arrivalKa,
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
  /** Resource bookkeeping carried by the parcels (M21), km of sediment: swamp (coal), warm shallow-sea (oil source rock), evaporite (salt). */
  coal: Float64Array;
  oil: Float64Array;
  salt: Float64Array;
  /** Fauna lineages carried by the parcels (M23), cell-major (cell * LINEAGE_COUNT + k), unnormalized; zero where the crust has never been land. */
  lineage: Float64Array;
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
  const coal = new Float64Array(n);
  const oil = new Float64Array(n);
  const salt = new Float64Array(n);
  const lineage = new Float64Array(LINEAGE_COUNT * n);
  for (let j = 0; j < n; j++) {
    const i = claim[j];
    for (let k = 0; k < LINEAGE_COUNT; k++) lineage[j * LINEAGE_COUNT + k] = pool.lineage[i * LINEAGE_COUNT + k];
    crustType[j] = pool.crustType[i];
    thickness[j] = pool.thickness[i];
    crustAge[j] = pool.age[i];
    volcanic[j] = pool.volcanic[i];
    sediment[j] = pool.sediment[i];
    eroded[j] = pool.eroded[i];
    orogenyStep[j] = pool.orogenyStep[i];
    coal[j] = pool.coal[i];
    oil[j] = pool.oil[i];
    salt[j] = pool.salt[i];
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
    coal,
    oil,
    salt,
    lineage,
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
  /** Use this sea level instead of solving it from the water inventory (the real Earth's datum is zero). */
  seaLevelOverride?: number;
  /** True for a relief without a tectonic history (the real Earth and its reconstructions): the rules that read the provenance stay quiet. */
  noHistory?: boolean;
  /** Measured deposits per cell (bit per mineral) for a world without a tectonic history; potentials stay zero. */
  measuredDeposits?: Uint8Array;
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
  // The liquid inventory: the water parameter, or, with a target ocean cover, the volume the loop's sea level holds.
  const inventory = params.oceanFraction > 0 ? waterVolumeBelow(state.elevation, areaKm2, state.seaLevel) : waterVolumeKm3(params);
  // Ice sheets are a thickness proxy; they cannot lock more than a share of the water that exists.
  const locked = Math.min(climate.ice.iceVolumeKm3, MAX_ICE_SHARE * inventory);
  const seaLevel = ctx.seaLevelOverride ?? solveSeaLevel(state.elevation, areaKm2, Math.max(0, inventory - locked));

  // Final rivers and lakes from the climate's precipitation and evaporation (DESIGN 3.4).
  hydro.precipitation.set(climate.moisture.annual);
  const evaporation = new Float64Array(n);
  for (let i = 0; i < n; i++) evaporation[i] = evaporationRate(climate.temperature.annual[i]);
  hydro.evaporation = evaporation;
  hydro.run(state.elevation, seaLevel);

  onProgress('biomes', 0.94);
  const koppen = classifyKoppen(grid, state.elevation, seaLevel, climate.temperature.samples, climate.moisture.samples);

  // Flora (M22) on the final rivers and climate.
  const flora = computeFlora(grid, state, seaLevel, {
    temperatureAnnual: climate.temperature.annual,
    temperature: climate.temperature.samples,
    precipitation: hydro.precipitation,
    precipitationSamples: climate.moisture.samples,
    sunshineHours: climate.sunshineHours,
    iceSheet: climate.ice.iceSheet,
    discharge: hydro.discharge,
    downstream: hydro.downstream,
    lake: hydro.lake,
    history: !ctx.noHistory,
  });

  // Fauna (M23) from the lineages the loop carried, on the flora's productivity.
  const fauna = computeFauna(grid, state, seaLevel, areaKm2, flora.npp, climate.ice.iceSheet, !ctx.noHistory);

  // Resources from the provenance (M21); measured ones, or none, for a world without a history.
  const minerals = ctx.noHistory
    ? { potential: new Float64Array(MINERAL_COUNT * n), deposits: ctx.measuredDeposits ?? new Uint8Array(n) }
    : computeMinerals(grid, state, seaLevel, params.seed, params.radiusKm);

  // Civilization (M24) on everything above: the flora, the fauna's landmasses, the deposits.
  const civilization = computeCivilization(grid, state, seaLevel, {
    areaKm2,
    radiusKm: params.radiusKm,
    temperatureAnnual: climate.temperature.annual,
    temperature: climate.temperature.samples,
    precipitation: hydro.precipitation,
    discharge: hydro.discharge,
    downstream: hydro.downstream,
    lake: hydro.lake,
    iceSheet: climate.ice.iceSheet,
    npp: flora.npp,
    soil: flora.soil,
    vegetation: flora.vegetation,
    landmass: fauna.landmass,
    landmassAreas: fauna.landmassAreas,
    deposits: minerals.deposits,
  });

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
    elevationTrench[j] = state.boundary[j] === BOUNDARY_SUBDUCTING ? -convergentDepression(state.crustType[j], state.thickness[j]) : 0;
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
      cloudAnnual: climate.moisture.cloudAnnual,
      sunshineHours: climate.sunshineHours,
      cloudShortwave: climate.temperature.cloudShortwave,
      cloudLongwave: climate.temperature.cloudLongwave,
    },
    { seaIceMonths: climate.ice.seaIceMonths, iceSheet: climate.ice.iceSheet, koppen, npp: flora.npp, vegetation: flora.vegetation, realm: fauna.realm, endemism: fauna.endemism },
    { deposits: minerals.deposits },
    { arrivalKa: civilization.arrivalKa, landmass: fauna.landmass, landmassAreas: fauna.landmassAreas, cities: civilization.cities },
  );

  // The hydrology object is reused for the next keyframe, so its arrays are copied out.
  return {
    params,
    level: ctx.level,
    preview: ctx.preview,
    reference: null,
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
    coal: state.coal,
    oil: state.oil,
    salt: state.salt,
    mineralPotential: minerals.potential,
    deposits: minerals.deposits,
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
    temperatureBalance: climate.temperature.balanceTerm,
    temperatureLapse: climate.temperature.lapseTerm,
    temperatureContinental: climate.temperature.continentalTerm,
    windU: climate.windU,
    windV: climate.windV,
    cloud: climate.moisture.cloud,
    cloudAnnual: climate.moisture.cloudAnnual,
    sunshineHours: climate.sunshineHours,
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
    npp: flora.npp,
    soil: flora.soil,
    soilAsh: flora.soilAsh,
    soilAlluvium: flora.soilAlluvium,
    soilLoss: flora.soilLoss,
    vegetation: flora.vegetation,
    lineage: fauna.lineage,
    realm: fauna.realm,
    endemism: fauna.endemism,
    richness: fauna.richness,
    megafauna: fauna.megafauna,
    landmass: fauna.landmass,
    landmassAreas: fauna.landmassAreas,
    habitability: civilization.habitability,
    habitabilityTerms: civilization.habitabilityTerms,
    agriculture: civilization.agriculture,
    citySite: civilization.citySite,
    cityTerms: civilization.cityTerms,
    cities: civilization.cities,
    arrivalKa: civilization.arrivalKa,
    origin: civilization.origin,
    circulation: climate.circulation,
    globalMeanTemperature: climate.globalMeanTemperature,
    plates: state.plates,
    hotspots: state.hotspots,
    events: state.events,
    stats,
  };
}

/** Largest share of the water inventory that ice sheets may lock away (Earth's land fully glaciated would hold about a fifth of its ocean). */
export const MAX_ICE_SHARE = 0.5;

/** Steps between in-loop climate updates that feed real precipitation to the fluvial erosion. */
export const IN_LOOP_CLIMATE_INTERVAL = 25;
/** Levels below the planet's own at which the in-loop climate runs (level 4 for Earth: a tenth of a second per update). */
export const IN_LOOP_CLIMATE_COARSER = 2;

/** Prolongate a coarse field up to a finer grid through the intermediate levels. */
export function liftToLevel(coarse: Grid, fine: Grid, field: Float64Array): Float64Array {
  let current = field;
  for (let level = coarse.level; level < fine.level; level++) {
    const from = Grid.get(level);
    const to = Grid.get(level + 1);
    const next = new Float64Array(to.n);
    prolongate(from, to, current, next);
    current = next;
  }
  return current;
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

/**
 * Steps at which keyframes are captured when a frame is wanted every `interval` steps: the
 * multiples of the interval below the age. When they would exceed `maxCount`, the interval is
 * widened to the smallest multiple of itself that fits, so the frames stay at round ages.
 */
export function keyframeStepsEvery(tectonicAge: number, interval: number, maxCount: number): number[] {
  if (interval <= 0 || maxCount <= 0 || tectonicAge <= interval) return [];
  const inside = Math.ceil(tectonicAge / interval) - 1;
  const spacing = interval * Math.ceil(inside / maxCount);
  const out: number[] = [];
  for (let step = spacing; step < tectonicAge; step += spacing) out.push(step);
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
  const wanted = options.keyframeInterval
    ? keyframeStepsEvery(params.tectonicAge, options.keyframeInterval, options.keyframes ?? Infinity)
    : keyframeSteps(params.tectonicAge, options.keyframes ?? 0);
  const snapshots: ReliefState[] = [];
  // Real precipitation inside the loop (DESIGN 9.1): every IN_LOOP_CLIMATE_INTERVAL steps the
  // climate runs on a coarse grid and its rain and evaporation drive the fluvial passes until
  // the next update. The schedule depends only on the parameters, never on the keyframes asked
  // for, so a keyframe at step t is still the planet of a build of age t.
  const coarseLevel = Math.max(MIN_LEVEL, level - IN_LOOP_CLIMATE_COARSER);
  const coarseGrid = Grid.get(coarseLevel);
  const coarseArea = cellAreasKm2(coarseGrid, params.radiusKm);
  const coarseHydro = new Hydrology(coarseGrid, coarseArea, params.radiusKm);
  const updateLoopClimate = (): void => {
    const elevation = sim.elevation.subarray(0, coarseGrid.n);
    coarseHydro.applyProxyPrecipitation(elevation, sim.seaLevel);
    coarseHydro.run(elevation, sim.seaLevel);
    const climate = computeClimate(coarseGrid, params, elevation, sim.seaLevel, coarseArea, coarseHydro.oceanDistance, coarseHydro.lake);
    const evaporation = new Float64Array(coarseGrid.n);
    for (let i = 0; i < coarseGrid.n; i++) evaporation[i] = evaporationRate(climate.temperature.annual[i]);
    sim.setPrecipitation(
      liftToLevel(coarseGrid, grid, climate.moisture.annual),
      liftToLevel(coarseGrid, grid, evaporation),
      liftToLevel(coarseGrid, grid, climate.temperature.annual),
    );
  };
  sim.run(
    params.tectonicAge,
    (f) => onProgress('tectonics', 0.05 + 0.6 * f),
    (step) => {
      if (step % IN_LOOP_CLIMATE_INTERVAL === 0 && step < params.tectonicAge) updateLoopClimate();
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
