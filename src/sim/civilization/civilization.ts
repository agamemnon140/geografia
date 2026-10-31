import { VEG_BOREAL, VEG_DESERT, VEG_ICE, VEG_MEDITERRANEAN, VEG_RAINFOREST, VEG_SAVANNA, VEG_SCRUB, VEG_SEASONAL, VEG_STEPPE, VEG_TEMPERATE, VEG_TEMPERATE_RAIN, VEG_TUNDRA, VEG_WETLAND } from '../biosphere/flora.ts';
import { REFERENCE_CELL_KM } from '../constants.ts';
import type { Grid } from '../grid/grid.ts';
import { EARTH_O2, relativeGravity, type PlanetParams } from '../params.ts';
import type { ReliefState } from '../pipeline.ts';
import { MINERAL_COUNT } from '../resources/minerals.ts';

/**
 * Civilization (M24; DESIGN 3.13): where people could live, farm and build
 * cities, and how they would spread, as explainable indices on the
 * geography rather than a scripted history. Habitability combines food,
 * fresh water and thermal comfort; agricultural potential combines soil,
 * growth and the climates where large-seeded grasses live; the city-site
 * score is a weighted sum of eight itemized terms (river, harbor, fresh
 * water, farmland within reach, defensibility, safety from the plates,
 * minerals within reach, centrality on the landmass), and the best local
 * maxima, spaced apart, are the candidate cities of antiquity. Human
 * dispersal is a shortest path from an origin chosen by rule over land
 * (slower across mountains, deserts and tundra, faster along coasts) and
 * across straits (costly per cell of open water, free where the glacial
 * sea level exposes the floor), timed so the Earth's own spread takes
 * about seventy thousand years. The planet's air (M26) sets a hypoxia
 * ceiling: the oxygen partial pressure, from the oxygen fraction and the
 * pressure, shifts Earth's habitation limits up or down by the scale
 * height, in the comfort of a cell and in the cost of crossing it.
 */

/** Habitability: growth for full food, mm of rain over 250 for full water, the comfortable band of annual means and the range past which a season is hostile. */
export const FOOD_NPP = 600;
export const WATER_MM = 750;
export const WATER_FLOOR_MM = 250;
export const COMFORT_MIN_C = 5;
export const COMFORT_MAX_C = 25;
export const COMFORT_SPAN_C = 15;
export const HARSH_RANGE_C = 40;
/** Air (M26): Earth's atmospheric scale height, m (divided by the relative gravity); the heights between which permanent habitation fades on Earth (La Rinconada at 5,100 m is the highest town); both shifted by the planet's oxygen partial pressure. */
export const SCALE_HEIGHT_M = 8400;
export const PLATEAU_M = 5000;
export const CEILING_M = 6500;
export const HABITABILITY_TERMS = ['food', 'water', 'comfort', 'air'] as const;
export function scaleHeightM(params: PlanetParams): number {
  return SCALE_HEIGHT_M / relativeGravity(params);
}
/** Height by which the planet's air shifts Earth's habitation limits: exactly zero on Earth, negative where the oxygen partial pressure is lower. */
export function hypoxiaShiftM(params: PlanetParams): number {
  return scaleHeightM(params) * Math.log((params.oxygen * params.pressureBar) / EARTH_O2);
}
/** Oxygen partial pressure at a height, atm (Earth's sea level 0.21). */
export function oxygenPartialPressure(params: PlanetParams, heightM: number): number {
  return params.oxygen * params.pressureBar * Math.exp(-heightM / scaleHeightM(params));
}
/** The air term of habitability: 1 up to the plateau height, 0 at the ceiling, both shifted by the planet's air. */
export function airTerm(params: PlanetParams, heightM: number): number {
  return clamp01((CEILING_M + hypoxiaShiftM(params) - heightM) / (CEILING_M - PLATEAU_M));
}
/** Rivers that water a cell (irrigation) and that count as a city's river, km^3/yr; the river that makes a mouth. */
export const RIVER_KM3 = 40;
export const BIG_RIVER_KM3 = 4000;
export const MOUTH_KM3 = 100;
/** Agriculture: growth for full farmland and the vegetation multipliers (seasonal-dry grasslands and Mediterranean climates domesticated the cereals). */
export const FARM_NPP = 700;
export const FARM_MULTIPLIER: Record<number, number> = {
  [VEG_ICE]: 0, [VEG_TUNDRA]: 0.1, [VEG_BOREAL]: 0.3, [VEG_TEMPERATE]: 1, [VEG_TEMPERATE_RAIN]: 0.7, [VEG_STEPPE]: 1,
  [VEG_MEDITERRANEAN]: 1.3, [VEG_SCRUB]: 0.5, [VEG_DESERT]: 0.1, [VEG_SAVANNA]: 1.2, [VEG_SEASONAL]: 1.1, [VEG_RAINFOREST]: 0.5, [VEG_WETLAND]: 1.2,
};
/** City-site terms, in CITY_TERMS order, and their weights (sum 1). */
export const CITY_TERMS = ['river', 'harbor', 'fresh water', 'farmland within reach', 'defensibility', 'safety', 'minerals within reach', 'centrality'] as const;
export const CITY_WEIGHTS = [0.15, 0.15, 0.15, 0.2, 0.05, 0.1, 0.1, 0.1];
/** Reach of the farmland and mineral terms, reference cells of 112 km; the hazard reach of a plate boundary. */
export const HINTERLAND_CELLS = 3;
export const MINERAL_REACH_CELLS = 2;
export const HAZARD_REACH_CELLS = 2;
/** Minerals within reach for the full term; volcanic rock that makes a cell hazardous, km. */
export const MINERALS_FULL = 3;
export const VOLCANO_KM = 0.5;
/** Hilltop contrast for full defensibility, m above the neighbors' mean. */
export const DEFENSE_M = 300;
/** Candidate cities: how many, and the spacing between them, km. */
export const CITY_COUNT = 30;
export const CITY_SPACING_KM = 500;
/** Dispersal: thousands of years per cell of easy land, the terrain multipliers, the cost of a cell of open water, the glacial sea-level drop that exposes bridges, and the horizon past which land counts as unreached. */
export const KA_PER_CELL = 0.25;
export const COST_COAST = 0.7;
export const COST_RAINFOREST = 1.5;
export const COST_TUNDRA = 2;
export const COST_DESERT = 3;
export const COST_MOUNTAIN = 4;
export const COST_WATER = 6;
export const GLACIAL_DROP_M = 120;
export const MOUNTAIN_M = 2500;
export const DISPERSAL_HORIZON_KA = 100;
export const UNREACHED = -1;
/** Origin: the largest landmass, within this latitude, on savanna or seasonal forest. */
export const ORIGIN_LAT_DEG = 30;

export interface CityInfo {
  cell: number;
  score: number;
}

export interface CivilizationFields {
  habitability: Float64Array;
  /** Food, water, comfort and air terms, cell-major (cell * 4 + k, HABITABILITY_TERMS order). */
  habitabilityTerms: Float64Array;
  agriculture: Float64Array;
  citySite: Float64Array;
  /** CITY_TERMS per cell, cell-major (cell * 8 + k), each 0 to 1 before its weight. */
  cityTerms: Float64Array;
  cities: CityInfo[];
  /** Arrival of people, thousands of years after the origin; UNREACHED where none arrive within the horizon; the origin cell. */
  arrivalKa: Float64Array;
  origin: number;
}

export interface CivilizationInputs {
  /** The planet's parameters: the air (oxygen, pressure, gravity) sets the hypoxia ceiling (M26). */
  params: PlanetParams;
  areaKm2: Float64Array;
  radiusKm: number;
  temperatureAnnual: Float64Array;
  temperature: Float64Array;
  precipitation: Float64Array;
  discharge: Float64Array;
  downstream: Int32Array;
  lake: Int32Array;
  iceSheet: Uint8Array;
  npp: Float64Array;
  soil: Float64Array;
  vegetation: Uint8Array;
  landmass: Int32Array;
  landmassAreas: number[];
  deposits: Uint8Array;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hops from any marked cell, up to `reach`; cells beyond get reach + 1. */
/** Breadth-first hops from the marked cells over every cell, capped at reach + 1 (shared with the fantasy rules). */
export function hopsFrom(grid: Grid, marked: Uint8Array, reach: number): Uint8Array {
  const n = grid.n;
  const out = new Uint8Array(n).fill(reach + 1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (marked[i]) {
      out[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const d = out[i] + 1;
    if (d > reach) continue;
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      if (out[j] > d) {
        out[j] = d;
        queue[tail++] = j;
      }
    }
  }
  return out;
}

/** Mean of a field over the land cells within `reach` hops of each land cell (a small breadth-first search per cell). */
function neighborhoodMean(grid: Grid, land: Uint8Array, field: Float64Array, reach: number): Float64Array {
  const n = grid.n;
  const out = new Float64Array(n);
  const seen = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const depth = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!land[s]) continue;
    let head = 0;
    let tail = 0;
    let sum = 0;
    let count = 0;
    seen[s] = s;
    depth[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      sum += field[i];
      count++;
      if (depth[i] >= reach) continue;
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const j = grid.nb[t];
        if (seen[j] !== s && land[j]) {
          seen[j] = s;
          depth[j] = depth[i] + 1;
          queue[tail++] = j;
        }
      }
    }
    out[s] = count > 0 ? sum / count : 0;
  }
  return out;
}

/** A binary heap of (cost, cell) for the dispersal's shortest paths. */
class CostHeap {
  private cost: number[] = [];
  private cell: number[] = [];
  get size(): number {
    return this.cost.length;
  }
  push(cost: number, cell: number): void {
    this.cost.push(cost);
    this.cell.push(cell);
    let i = this.cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.cost[0], this.cell[0]];
    const lastCost = this.cost.pop() as number;
    const lastCell = this.cell.pop() as number;
    if (this.cost.length > 0) {
      this.cost[0] = lastCost;
      this.cell[0] = lastCell;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.cost.length && this.cost[l] < this.cost[m]) m = l;
        if (r < this.cost.length && this.cost[r] < this.cost[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const c = this.cost[a];
    this.cost[a] = this.cost[b];
    this.cost[b] = c;
    const d = this.cell[a];
    this.cell[a] = this.cell[b];
    this.cell[b] = d;
  }
}

export function computeCivilization(grid: Grid, state: ReliefState, seaLevel: number, input: CivilizationInputs): CivilizationFields {
  const n = grid.n;
  const cellKm = Math.sqrt((4 * Math.PI * input.radiusKm * input.radiusKm) / n);
  const cellsPerUnit = REFERENCE_CELL_KM / cellKm;
  const reach = (units: number): number => Math.max(1, Math.round(units * cellsPerUnit));
  const land = new Uint8Array(n);
  const coast = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = state.elevation[i] >= seaLevel && input.lake[i] < 0 ? 1 : 0;

  // Habitability and agriculture.
  const habitability = new Float64Array(n);
  const T = HABITABILITY_TERMS.length;
  const habitabilityTerms = new Float64Array(T * n);
  const agriculture = new Float64Array(n);
  const water = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i] || input.iceSheet[i]) continue;
    const t = input.temperatureAnnual[i];
    const food = clamp01(input.npp[i] / FOOD_NPP);
    const river = input.discharge[i] >= RIVER_KM3;
    let lakeside = false;
    let oceanNeighbors = 0;
    for (let k = grid.nbStart[i]; k < grid.nbStart[i + 1]; k++) {
      const j = grid.nb[k];
      if (input.lake[j] >= 0) lakeside = true;
      else if (state.elevation[j] < seaLevel) oceanNeighbors++;
    }
    if (oceanNeighbors > 0) coast[i] = 1;
    water[i] = river || lakeside ? 1 : clamp01((input.precipitation[i] - WATER_FLOOR_MM) / WATER_MM);
    let comfort = t < COMFORT_MIN_C ? clamp01(1 - (COMFORT_MIN_C - t) / COMFORT_SPAN_C) : t > COMFORT_MAX_C ? clamp01(1 - (t - COMFORT_MAX_C) / COMFORT_SPAN_C) : 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = 0; s < 12; s++) {
      const v = input.temperature[s * n + i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > HARSH_RANGE_C) comfort *= 0.6;
    const air = airTerm(input.params, state.elevation[i] - seaLevel);
    habitabilityTerms[T * i] = food;
    habitabilityTerms[T * i + 1] = water[i];
    habitabilityTerms[T * i + 2] = comfort;
    habitabilityTerms[T * i + 3] = air;
    habitability[i] = Math.sqrt(food * water[i]) * comfort * air;
    agriculture[i] = clamp01(input.soil[i] * clamp01(input.npp[i] / FARM_NPP) * (FARM_MULTIPLIER[input.vegetation[i]] ?? 0) * (0.3 + 0.7 * water[i]) * 1.6);
  }

  // City-site terms.
  const boundaryMask = new Uint8Array(n);
  const volcanoMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (state.boundary[i] !== 0) boundaryMask[i] = 1;
    if (state.volcanic[i] > VOLCANO_KM) volcanoMask[i] = 1;
  }
  const hazardReach = reach(HAZARD_REACH_CELLS);
  const boundaryHops = hopsFrom(grid, boundaryMask, hazardReach);
  const volcanoHops = hopsFrom(grid, volcanoMask, hazardReach);
  const farmland = neighborhoodMean(grid, land, agriculture, reach(HINTERLAND_CELLS));
  const mineralReach = reach(MINERAL_REACH_CELLS);
  // Landmass centroids and radii for the centrality term.
  const masses = input.landmassAreas.length;
  const cx = new Float64Array(masses);
  const cy = new Float64Array(masses);
  const cz = new Float64Array(masses);
  for (let i = 0; i < n; i++) {
    const m = input.landmass[i];
    if (m < 0) continue;
    const a = input.areaKm2[i];
    cx[m] += a * grid.xyz[3 * i];
    cy[m] += a * grid.xyz[3 * i + 1];
    cz[m] += a * grid.xyz[3 * i + 2];
  }
  const citySite = new Float64Array(n);
  const cityTerms = new Float64Array(CITY_TERMS.length * n);
  const seenMineral = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const depth = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i] || input.iceSheet[i]) continue;
    const q = input.discharge[i];
    const down = input.downstream[i];
    const mouth = q >= MOUTH_KM3 && down >= 0 && (state.elevation[down] < seaLevel || input.lake[down] >= 0);
    const river = Math.max(q >= RIVER_KM3 ? clamp01(Math.log(q / RIVER_KM3) / Math.log(BIG_RIVER_KM3 / RIVER_KM3)) : 0, mouth ? 1 : 0);
    let harbor = 0;
    let landNeighbors = 0;
    let neighbors = 0;
    let neighborElevation = 0;
    for (let k = grid.nbStart[i]; k < grid.nbStart[i + 1]; k++) {
      const j = grid.nb[k];
      neighbors++;
      neighborElevation += state.elevation[j];
      if (land[j]) landNeighbors++;
    }
    if (coast[i]) harbor = clamp01((landNeighbors - 2) / 3);
    const defense = clamp01((state.elevation[i] - neighborElevation / neighbors) / DEFENSE_M);
    const safety = 1 - 0.5 * clamp01(1 - boundaryHops[i] / (hazardReach + 1)) - 0.3 * clamp01(1 - volcanoHops[i] / (hazardReach + 1));
    // Distinct minerals within reach.
    let bits = 0;
    let head = 0;
    let tail = 0;
    seenMineral[i] = i;
    depth[i] = 0;
    queue[tail++] = i;
    while (head < tail) {
      const c = queue[head++];
      bits |= input.deposits[c];
      if (depth[c] >= mineralReach) continue;
      for (let k = grid.nbStart[c]; k < grid.nbStart[c + 1]; k++) {
        const j = grid.nb[k];
        if (seenMineral[j] !== i) {
          seenMineral[j] = i;
          depth[j] = depth[c] + 1;
          queue[tail++] = j;
        }
      }
    }
    let kinds = 0;
    for (let m = 0; m < MINERAL_COUNT; m++) if ((bits >> m) & 1) kinds++;
    const minerals = clamp01(kinds / MINERALS_FULL);
    const m = input.landmass[i];
    let centrality = 0;
    if (m >= 0) {
      const norm = Math.hypot(cx[m], cy[m], cz[m]) || 1;
      const dot = (grid.xyz[3 * i] * cx[m] + grid.xyz[3 * i + 1] * cy[m] + grid.xyz[3 * i + 2] * cz[m]) / norm;
      const distKm = Math.acos(Math.max(-1, Math.min(1, dot))) * input.radiusKm;
      const radiusKm = Math.sqrt(input.landmassAreas[m] / Math.PI);
      centrality = clamp01(1 - distKm / (2 * radiusKm));
    }
    const terms = [river, harbor, water[i], farmland[i], defense, clamp01(safety), minerals, centrality];
    let score = 0;
    for (let k = 0; k < terms.length; k++) {
      cityTerms[i * CITY_TERMS.length + k] = terms[k];
      score += CITY_WEIGHTS[k] * terms[k];
    }
    citySite[i] = score * habitabilityTerms[T * i + 2] * habitabilityTerms[T * i + 3];
  }

  // Candidate cities: the best cells, each at least CITY_SPACING_KM from the ones already chosen.
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => citySite[i] > 0).sort((a, b) => citySite[b] - citySite[a]);
  const cities: CityInfo[] = [];
  const minDot = Math.cos(CITY_SPACING_KM / input.radiusKm);
  for (const i of order) {
    if (cities.length >= CITY_COUNT) break;
    let far = true;
    for (const c of cities) {
      const dot = grid.xyz[3 * i] * grid.xyz[3 * c.cell] + grid.xyz[3 * i + 1] * grid.xyz[3 * c.cell + 1] + grid.xyz[3 * i + 2] * grid.xyz[3 * c.cell + 2];
      if (dot > minDot) {
        far = false;
        break;
      }
    }
    if (far) cities.push({ cell: i, score: citySite[i] });
  }

  // Dispersal from the origin.
  const { arrivalKa, origin } = disperse(grid, state, seaLevel, input, land, coast, habitability, farmland);
  return { habitability, habitabilityTerms, agriculture, citySite, cityTerms, cities, arrivalKa, origin };
}

/** The origin by rule, then a shortest-path spread with terrain and water costs; arrival in thousands of years. */
function disperse(
  grid: Grid,
  state: ReliefState,
  seaLevel: number,
  input: CivilizationInputs,
  land: Uint8Array,
  coast: Uint8Array,
  habitability: Float64Array,
  farmland: Float64Array,
): { arrivalKa: Float64Array; origin: number } {
  const n = grid.n;
  const arrivalKa = new Float64Array(n).fill(UNREACHED);
  // Origin: on the largest landmass, within the tropics, on savanna or seasonal forest, where people would do best; else the most habitable cell anywhere.
  let largest = -1;
  input.landmassAreas.forEach((a, m) => {
    if (largest < 0 || a > input.landmassAreas[largest]) largest = m;
  });
  let origin = -1;
  let best = -1;
  let fallback = -1;
  let fallbackScore = -1;
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    if (habitability[i] > fallbackScore) {
      fallbackScore = habitability[i];
      fallback = i;
    }
    const v = input.vegetation[i];
    if (input.landmass[i] !== largest || Math.abs(grid.lat[i]) > (ORIGIN_LAT_DEG * Math.PI) / 180) continue;
    if (v !== VEG_SAVANNA && v !== VEG_SEASONAL) continue;
    const score = habitability[i] * (0.5 + farmland[i]);
    if (score > best) {
      best = score;
      origin = i;
    }
  }
  if (origin < 0) origin = fallback;
  if (origin < 0) return { arrivalKa, origin };

  // Cost to enter a cell, in cells of easy land; the planet's air shifts the mountain line and sets a ceiling (M26).
  const shift = hypoxiaShiftM(input.params);
  const enter = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (land[i]) {
      if (input.iceSheet[i]) {
        enter[i] = Infinity;
        continue;
      }
      const rel = state.elevation[i] - seaLevel;
      if (rel > CEILING_M + shift) {
        enter[i] = Infinity;
        continue;
      }
      let c = 1;
      const v = input.vegetation[i];
      if (rel > MOUNTAIN_M + shift) c *= COST_MOUNTAIN;
      if (v === VEG_DESERT) c *= COST_DESERT;
      else if (v === VEG_TUNDRA) c *= COST_TUNDRA;
      else if (v === VEG_RAINFOREST) c *= COST_RAINFOREST;
      if (coast[i]) c *= COST_COAST;
      enter[i] = c;
    } else if (input.lake[i] >= 0) {
      enter[i] = COST_WATER;
    } else {
      // Sea: a glacial bridge where the floor lies within the glacial drop, open water beyond.
      enter[i] = seaLevel - state.elevation[i] < GLACIAL_DROP_M ? 2 : COST_WATER;
    }
  }
  const cost = new Float64Array(n).fill(Infinity);
  const heap = new CostHeap();
  cost[origin] = 0;
  heap.push(0, origin);
  const horizon = DISPERSAL_HORIZON_KA / KA_PER_CELL;
  while (heap.size > 0) {
    const [c, i] = heap.pop();
    if (c > cost[i]) continue;
    if (c > horizon) break;
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      const next = c + enter[j];
      if (next < cost[j]) {
        cost[j] = next;
        heap.push(next, j);
      }
    }
  }
  for (let i = 0; i < n; i++) if (land[i] && cost[i] <= horizon) arrivalKa[i] = cost[i] * KA_PER_CELL;
  return { arrivalKa, origin };
}
