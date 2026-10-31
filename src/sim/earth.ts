import { EARTH_LEVEL } from './constants.ts';
import { Grid, cellAreasKm2 } from './grid/grid.ts';
import { fromLatLon, DEG } from './grid/geometry.ts';
import { nearestCell } from './grid/locate.ts';
import { Hydrology } from './hydrology/routing.ts';
import { EARTH } from './params.ts';
import { finalize, type BuildContext, type Progress, type ReliefState, type World } from './pipeline.ts';
import {
  CONTINENTAL,
  CONTINENTAL_THICKNESS_KM,
  ISOSTASY_M_PER_KM,
  OCEANIC,
  OCEANIC_THICKNESS_KM,
  RIDGE_DEPTH_M,
  SUBSIDENCE_MAX_AGE,
  SUBSIDENCE_M_PER_SQRT_STEP,
} from './tectonics/crust.ts';

/**
 * The real Earth as a reference world (DESIGN 3.9, built in M11). The relief
 * comes from NOAA's ETOPO5 grid, block-averaged to half a degree and shipped
 * as 360 x 720 little-endian Int16 meters (row 0 at 89.75 N, column 0 at
 * 179.75 W). Everything after the relief, from rivers to Koppen, is the
 * simulator's own, so the result is a test of the climate and hydrology
 * links on known ground. Tectonic provenance is not available: crust type,
 * thickness and sea-floor age are read back from the elevation with the
 * model's own isostasy and subsidence rules.
 */

export const EARTH_DATA_ROWS = 360;
export const EARTH_DATA_COLS = 720;
export const EARTH_DATA_PATH = 'data/earth-elevation-05deg.i16';
/** Elevation above which a cell is treated as continental crust (shelves and slopes included), meters. */
export const CONTINENTAL_SHELF_M = -2000;

export interface EarthElevation {
  rows: number;
  cols: number;
  /** Meters, row-major from the north. */
  data: Int16Array;
}

/** Validate and wrap the shipped elevation file. */
export function parseEarthElevation(buffer: ArrayBuffer): EarthElevation {
  const expected = EARTH_DATA_ROWS * EARTH_DATA_COLS * 2;
  if (buffer.byteLength !== expected) throw new Error(`Earth elevation file has ${buffer.byteLength} bytes, expected ${expected}`);
  const view = new DataView(buffer);
  const data = new Int16Array(EARTH_DATA_ROWS * EARTH_DATA_COLS);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true);
  return { rows: EARTH_DATA_ROWS, cols: EARTH_DATA_COLS, data };
}

/** Elevation of the half-degree sample containing a latitude and longitude in degrees. */
export function earthElevationAt(elevation: EarthElevation, latDeg: number, lonDeg: number): number {
  const r = Math.min(elevation.rows - 1, Math.max(0, Math.floor((90 - latDeg) / (180 / elevation.rows))));
  const c = Math.min(elevation.cols - 1, Math.max(0, Math.floor((((lonDeg + 180) % 360 + 360) % 360) / (360 / elevation.cols))));
  return elevation.data[r * elevation.cols + c];
}

/** Area-weighted mean of the samples nearest to each cell; cells that receive none take their nearest filled neighbor. */
export function earthReliefState(grid: Grid, elevation: EarthElevation): ReliefState {
  const n = grid.n;
  const sum = new Float64Array(n);
  const weight = new Float64Array(n);
  const dLat = 180 / elevation.rows;
  const dLon = 360 / elevation.cols;
  let prev = 0;
  for (let r = 0; r < elevation.rows; r++) {
    const lat = 90 - (r + 0.5) * dLat;
    const w = Math.cos(lat * DEG);
    let rowStart = -1;
    for (let c = 0; c < elevation.cols; c++) {
      const lon = -180 + (c + 0.5) * dLon;
      const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
      const cell = nearestCell(grid, x, y, z, prev);
      sum[cell] += w * elevation.data[r * elevation.cols + c];
      weight[cell] += w;
      prev = cell;
      if (rowStart < 0) rowStart = cell;
    }
    prev = rowStart;
  }
  const relief = new Float64Array(n);
  const filled = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (weight[i] > 0) {
      relief[i] = sum[i] / weight[i];
      filled[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const nb of grid.neighbors(i)) {
      if (filled[nb]) continue;
      relief[nb] = relief[i];
      filled[nb] = 1;
      queue.push(nb);
    }
  }

  // Crust read back from the relief with the model's own rules, so the crust layers mean the same thing.
  const crustType = new Uint8Array(n);
  const thickness = new Float64Array(n);
  const crustAge = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const e = relief[i];
    if (e >= CONTINENTAL_SHELF_M) {
      crustType[i] = CONTINENTAL;
      thickness[i] = Math.max(16, CONTINENTAL_THICKNESS_KM + e / ISOSTASY_M_PER_KM);
      crustAge[i] = EARTH.tectonicAge;
    } else {
      crustType[i] = OCEANIC;
      thickness[i] = OCEANIC_THICKNESS_KM;
      const root = (RIDGE_DEPTH_M - e) / SUBSIDENCE_M_PER_SQRT_STEP;
      crustAge[i] = Math.min(SUBSIDENCE_MAX_AGE, Math.max(0, root * root));
    }
  }
  return {
    step: 0,
    seaLevel: 0,
    elevation: relief,
    plate: new Int32Array(n),
    crustType,
    thickness,
    crustAge,
    volcanic: new Float64Array(n),
    sediment: new Float64Array(n),
    eroded: new Float64Array(n),
    orogenyStep: new Int32Array(n).fill(-1),
    boundary: new Uint8Array(n),
    plates: [{ axis: [0, 0, 1], rate: 0 }],
    hotspots: [],
    events: [],
  };
}

/** The context the real Earth is finalized in (grid level, cell areas, hydrology), shared by the present and its past. */
export function earthContext(): BuildContext {
  const grid = Grid.get(EARTH_LEVEL);
  const params = { ...EARTH, seed: 0 };
  const areaKm2 = cellAreasKm2(grid, params.radiusKm);
  return {
    params,
    grid,
    level: EARTH_LEVEL,
    preview: false,
    areaKm2,
    hydro: new Hydrology(grid, areaKm2, params.radiusKm),
    seaLevelOverride: 0,
  };
}

/** Hydrology, climate, ice and biomes of the real Earth from the shipped relief, at the Earth grid level. */
export function buildEarth(elevation: EarthElevation, onProgress: Progress = () => {}, context: BuildContext = earthContext()): World {
  onProgress('grid', 0);
  onProgress('relief', 0.05);
  const state = earthReliefState(context.grid, elevation);
  state.step = EARTH.tectonicAge;
  const world = finalize(context, state, onProgress);
  world.reference = 'ETOPO5';
  onProgress('done', 1);
  return world;
}

/**
 * The real Earth's past (M16): the PALEOMAP paleo-digital elevation models
 * of Scotese and Wright (2018), licensed CC BY 4.0, converted by
 * `scripts/convert-paleodem.ts` into one-degree cell-centered Int16 meters
 * (row 0 at 89.5 N, column 0 at 179.5 W), one slice every 10 million years
 * from 200 to 10 Ma, oldest first. The present is the ETOPO5 relief above.
 */
export const EARTH_HISTORY_PATH = 'data/earth-history-1deg.i16';
export const EARTH_HISTORY_ROWS = 180;
export const EARTH_HISTORY_COLS = 360;
export const EARTH_HISTORY_AGES: readonly number[] = Array.from({ length: 20 }, (_, i) => 200 - 10 * i);
export const EARTH_HISTORY_REFERENCE = 'PALEOMAP';

/** Validate and split the shipped history file into its slices, oldest first. */
export function parseEarthHistory(buffer: ArrayBuffer): EarthElevation[] {
  const per = EARTH_HISTORY_ROWS * EARTH_HISTORY_COLS;
  const expected = EARTH_HISTORY_AGES.length * per * 2;
  if (buffer.byteLength !== expected) throw new Error(`Earth history file has ${buffer.byteLength} bytes, expected ${expected}`);
  const view = new DataView(buffer);
  return EARTH_HISTORY_AGES.map((_, k) => {
    const data = new Int16Array(per);
    for (let i = 0; i < per; i++) data[i] = view.getInt16((k * per + i) * 2, true);
    return { rows: EARTH_HISTORY_ROWS, cols: EARTH_HISTORY_COLS, data };
  });
}

/**
 * One slice of the real Earth's past as a world: the reconstructed relief of
 * `ageMa` million years ago with the simulator's own rivers, climate, ice and
 * biomes, exactly as a simulated snapshot gets them. Its step counts up from
 * 200 Ma, so the timeline runs toward the present.
 */
export function buildEarthKeyframe(context: BuildContext, slice: EarthElevation, ageMa: number, onProgress: Progress = () => {}): World {
  const state = earthReliefState(context.grid, slice);
  state.step = EARTH.tectonicAge - ageMa;
  const world = finalize(context, state, onProgress);
  world.reference = EARTH_HISTORY_REFERENCE;
  return world;
}
