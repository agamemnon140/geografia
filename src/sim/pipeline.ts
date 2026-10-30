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
 * the sea. Per-cell crust and water fields are the provenance the inspector
 * shows.
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
  /** Precipitation in mm per year (the in-loop proxy until M5). */
  precipitation: Float64Array;
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
    world.precipitation, world.discharge, world.downstream, world.waterLevel, world.lake,
    world.mouth, world.riverLength,
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

  onProgress('tectonics', 0.05);
  const sim = new TectonicsSim(grid, params, rng.fork('tectonics'));
  sim.run(params.tectonicAge, (f) => onProgress('tectonics', 0.05 + 0.8 * f));

  // Final hydrology on the finished relief. M5 will feed the climate's precipitation here.
  onProgress('hydrology', 0.86);
  const hydro = sim.hydrology;
  hydro.applyProxyPrecipitation(sim.elevation, sim.seaLevel);
  hydro.run(sim.elevation, sim.seaLevel);

  onProgress('stats', 0.92);
  const n = grid.n;
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
  const areaKm2 = cellAreasKm2(grid, params.radiusKm);
  const stats = computeStats(
    { elevation: sim.elevation, areaKm2, seaLevel: sim.seaLevel, crustType, thickness, activePlates: sim.activePlates() },
    { precipitation: hydro.precipitation, discharge: hydro.discharge, lake: hydro.lake, mouth: hydro.mouth, riverLength: hydro.riverLength, lakes: hydro.lakes },
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
    discharge: hydro.discharge,
    downstream: hydro.downstream,
    waterLevel: hydro.waterLevel,
    lake: hydro.lake,
    mouth: hydro.mouth,
    riverLength: hydro.riverLength,
    lakes: hydro.lakes,
    plates: sim.plates.map((p) => ({ axis: [p.axis[0], p.axis[1], p.axis[2]], rate: p.rate })),
    hotspots: Array.from(sim.hotspots),
    stats,
  };
}
