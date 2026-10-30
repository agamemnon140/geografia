import { Grid, cellAreasKm2, levelForRadius } from './grid/grid.ts';
import { solveSeaLevel } from './hypsometry.ts';
import { validateParams, waterVolumeKm3, type PlanetParams } from './params.ts';
import { Rng } from './rng/xoshiro.ts';
import { computeStats, type WorldStats } from './stats.ts';
import { placeholderTerrain } from './terrain/placeholder.ts';

/**
 * A built planet. Plain data and typed arrays only, so it can be posted from
 * the worker and later stored per step for the timeline. Elevations are
 * absolute meters; subtract `seaLevel` for height above the sea.
 */
export interface World {
  params: PlanetParams;
  level: number;
  n: number;
  radiusKm: number;
  seaLevel: number;
  elevation: Float64Array;
  stats: WorldStats;
}

export type Progress = (stage: string, fraction: number) => void;

/** Transferable buffers of a world, for zero-copy posting between threads. */
export function worldBuffers(world: World): ArrayBuffer[] {
  return [world.elevation.buffer as ArrayBuffer];
}

/** Build a planet from parameters. Deterministic: same params and seed, same arrays. */
export function build(input: PlanetParams, onProgress: Progress = () => {}): World {
  const params = validateParams(input);
  onProgress('grid', 0);
  const level = levelForRadius(params.radiusKm);
  const grid = Grid.get(level);
  const rng = new Rng(params.seed);

  onProgress('terrain', 0.2);
  const elevation = placeholderTerrain(grid, rng.fork('terrain'));

  onProgress('sea level', 0.7);
  const areaKm2 = cellAreasKm2(grid, params.radiusKm);
  const seaLevel = solveSeaLevel(elevation, areaKm2, waterVolumeKm3(params));

  onProgress('stats', 0.9);
  const stats = computeStats(elevation, areaKm2, seaLevel);

  onProgress('done', 1);
  return { params, level, n: grid.n, radiusKm: params.radiusKm, seaLevel, elevation, stats };
}
