import { MEGAFAUNA_GIANT_ARTHROPODS } from '../biosphere/fauna.ts';
import { VEG_BOREAL, VEG_DESERT, VEG_ICE, VEG_MEDITERRANEAN, VEG_RAINFOREST, VEG_SAVANNA, VEG_SCRUB, VEG_SEASONAL, VEG_STEPPE, VEG_TEMPERATE, VEG_TEMPERATE_RAIN, VEG_TUNDRA, VEG_WETLAND } from '../biosphere/flora.ts';
import { HABITABILITY_TERMS, hopsFrom, type CityInfo } from '../civilization/civilization.ts';
import { REFERENCE_CELL_KM } from '../constants.ts';
import type { Grid } from '../grid/grid.ts';
import type { ReliefState } from '../pipeline.ts';
import { MINERALS } from '../resources/minerals.ts';
import { BOUNDARY_SUBDUCTING } from '../tectonics/simulation.ts';

/**
 * Fantasy (M28; DESIGN 3.14): an explicit sandbox rule set, off by default.
 * Where the peoples and monsters of the usual fantasy would live if they
 * followed the geography, the flora, the fauna and the deposits this
 * simulator computed. Nothing here is physics or biology: every rule is
 * invented, named, and itemized in the explain drawer so it can be argued
 * with or changed. Each entity gets a suitability from 0 to 1 per cell, the
 * product of four named terms in 0 to 1 read from stored fields; a people
 * dominates a cell when its suitability passes a threshold; a monster gets a
 * few lairs, its best cells spaced apart like the candidate cities. Land
 * entities score 0 on water and lakes; on ice sheets only the dwarves, the
 * giants, the dragons and the trolls remain; the two water entities score 0
 * on land and lakes. On a relief without a history (the real Earth)
 * the volcanic, boundary and orogeny terms read as quiet ground, and the
 * ore terms switch off while no deposit exists on the planet.
 */

export const PEOPLES = ['dwarves', 'elves', 'halflings', 'orcs', 'giants', 'merfolk'] as const;
export const MONSTERS = ['dragons', 'sea serpents', 'trolls', 'giant spiders'] as const;
export type Entity = (typeof PEOPLES)[number] | (typeof MONSTERS)[number];
export const ENTITIES: readonly Entity[] = [...PEOPLES, ...MONSTERS];
export const PEOPLE_COUNT = PEOPLES.length;
export const MONSTER_COUNT = MONSTERS.length;
export const ENTITY_COUNT = ENTITIES.length;
export const TERMS_PER_ENTITY = 4;
/** The four named terms of each entity, in the order they are stored. */
export const ENTITY_TERMS: Record<Entity, readonly [string, string, string, string]> = {
  dwarves: ['mountain', 'thick crust', 'ore within reach', 'rugged'],
  elves: ['forest', 'growth', 'ancient ground', 'seclusion'],
  halflings: ['river valley', 'farmland', 'gentle', 'mild'],
  orcs: ['harsh terrain', 'hardship', 'reachable', 'badlands'],
  giants: ['cold', 'high', 'open', 'solitude'],
  merfolk: ['shallow', 'warm', 'open water', 'reef'],
  dragons: ['fire mountain', 'hoard', 'remoteness', 'crags'],
  'sea serpents': ['abyss', 'trench', 'cold water', 'current'],
  trolls: ['boreal', 'relief', 'cold', 'solitude'],
  'giant spiders': ['canopy', 'dense', 'warm', 'wet'],
};
/** Entities that live in the sea rather than on land. */
export const WATER_ENTITIES: ReadonlySet<Entity> = new Set<Entity>(['merfolk', 'sea serpents']);
/** A people dominates a cell above this suitability. */
export const DOMINANCE_THRESHOLD = 0.3;
/** Lairs per monster, their spacing, km, and the least suitability that makes a lair. */
export const LAIR_COUNT = 6;
export const LAIR_SPACING_KM = 1500;
export const LAIR_MIN = 0.15;
/** Two-letter codes that label the lairs on the map, in MONSTERS order. */
export const LAIR_CODES = ['Dr', 'Se', 'Tr', 'Sp'] as const;
/** Reference cells (112 km) from a candidate city for full remoteness; the reach of the ore terms; the neighbor contrast for full ruggedness, m; steps since an orogeny for ancient ground. */
export const REMOTE_CELLS = 6;
export const METAL_REACH_CELLS = 2;
export const RUGGED_M = 600;
export const QUIET_STEPS = 60;
export const FANTASY_NONE = 255;

export interface LairInfo {
  monster: number;
  cell: number;
  score: number;
}

export interface FantasyFields {
  /** Suitability per cell and entity, cell-major (cell * ENTITY_COUNT + e), 0 to 1. */
  suitability: Float64Array;
  /** The four terms of each entity per cell, cell-major (cell * ENTITY_COUNT * TERMS_PER_ENTITY + e * TERMS_PER_ENTITY + k). */
  terms: Float32Array;
  /** Dominant people per cell (PEOPLES index), FANTASY_NONE where none passes the threshold. */
  people: Uint8Array;
  /** The lairs, monster-major, best first. */
  lairs: LairInfo[];
}

export interface FantasyInputs {
  areaKm2: Float64Array;
  radiusKm: number;
  temperatureAnnual: Float64Array;
  precipitation: Float64Array;
  discharge: Float64Array;
  lake: Int32Array;
  iceSheet: Uint8Array;
  sstAnomaly: Float64Array;
  currentU: Float64Array;
  currentV: Float64Array;
  seaIceMonths: Uint8Array;
  npp: Float64Array;
  vegetation: Uint8Array;
  agriculture: Float64Array;
  habitability: Float64Array;
  habitabilityTerms: Float64Array;
  arrivalKa: Float64Array;
  deposits: Uint8Array;
  megafauna: Uint8Array;
  cities: CityInfo[];
  /** False for a measured relief without provenance. */
  history: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A term that never falls below `floor`: the rule prefers x but does not forbid its absence. */
function soft(x: number, floor: number): number {
  return floor + (1 - floor) * clamp01(x);
}

const ELF_FOREST: Record<number, number> = { [VEG_TEMPERATE]: 1, [VEG_TEMPERATE_RAIN]: 1, [VEG_RAINFOREST]: 0.8, [VEG_SEASONAL]: 0.7, [VEG_BOREAL]: 0.6, [VEG_MEDITERRANEAN]: 0.5, [VEG_WETLAND]: 0.3 };
const ORC_TERRAIN: Record<number, number> = { [VEG_STEPPE]: 1, [VEG_SCRUB]: 1, [VEG_DESERT]: 0.5, [VEG_SAVANNA]: 0.5, [VEG_MEDITERRANEAN]: 0.4, [VEG_TUNDRA]: 0.2 };
const GIANT_OPEN: Record<number, number> = { [VEG_TUNDRA]: 1, [VEG_ICE]: 0.8, [VEG_BOREAL]: 0.5, [VEG_STEPPE]: 0.5 };
const TROLL_BOREAL: Record<number, number> = { [VEG_BOREAL]: 1, [VEG_TUNDRA]: 0.8, [VEG_ICE]: 0.5, [VEG_TEMPERATE_RAIN]: 0.5, [VEG_TEMPERATE]: 0.4 };
const SPIDER_CANOPY: Record<number, number> = { [VEG_RAINFOREST]: 1, [VEG_SEASONAL]: 0.5, [VEG_WETLAND]: 0.4 };

export function computeFantasy(grid: Grid, state: ReliefState, seaLevel: number, input: FantasyInputs): FantasyFields {
  const n = grid.n;
  const E = ENTITY_COUNT;
  const T = TERMS_PER_ENTITY;
  const H = HABITABILITY_TERMS.length;
  const suitability = new Float64Array(E * n);
  const terms = new Float32Array(E * T * n);
  const people = new Uint8Array(n).fill(FANTASY_NONE);
  const cellKm = Math.sqrt((4 * Math.PI * input.radiusKm * input.radiusKm) / n);
  const cellsPerUnit = REFERENCE_CELL_KM / cellKm;
  const reach = (units: number): number => Math.max(1, Math.round(units * cellsPerUnit));

  // Land, water, ruggedness, the neighbors that matter.
  const land = new Uint8Array(n);
  const rugged = new Float64Array(n);
  const lakeside = new Uint8Array(n);
  const landNeighbor = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    land[i] = state.elevation[i] >= seaLevel && input.lake[i] < 0 ? 1 : 0;
    let contrast = 0;
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      const d = Math.abs(state.elevation[i] - state.elevation[j]);
      if (d > contrast) contrast = d;
      if (input.lake[j] >= 0) lakeside[i] = 1;
      if (state.elevation[j] >= seaLevel && input.lake[j] < 0) landNeighbor[i] = 1;
    }
    rugged[i] = clamp01(contrast / RUGGED_M);
  }

  // Remoteness from the candidate cities (over land and sea alike); the ore within reach.
  const cityMask = new Uint8Array(n);
  for (const c of input.cities) cityMask[c.cell] = 1;
  const remoteReach = reach(REMOTE_CELLS);
  const cityHops = input.cities.length > 0 ? hopsFrom(grid, cityMask, remoteReach) : null;
  const remote = (i: number): number => (cityHops ? clamp01(cityHops[i] / remoteReach) : 1);
  const ores = ['iron', 'copper', 'gold', 'uranium'].map((name) => MINERALS.indexOf(name as (typeof MINERALS)[number]));
  const metalReach = reach(METAL_REACH_CELLS);
  let hasOre = false;
  const oreHops = ores.map((m) => {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if ((input.deposits[i] >> m) & 1) {
        mask[i] = 1;
        hasOre = true;
      }
    }
    return hopsFrom(grid, mask, metalReach);
  });
  const goldHops = oreHops[2];

  const set = (i: number, e: number, t1: number, t2: number, t3: number, t4: number): void => {
    const base = (i * E + e) * T;
    terms[base] = t1;
    terms[base + 1] = t2;
    terms[base + 2] = t3;
    terms[base + 3] = t4;
    suitability[i * E + e] = t1 * t2 * t3 * t4;
  };

  for (let i = 0; i < n; i++) {
    const rel = state.elevation[i] - seaLevel;
    const temp = input.temperatureAnnual[i];
    const veg = input.vegetation[i];
    if (land[i]) {
      const ice = input.iceSheet[i] === 1;
      const q = input.discharge[i];
      const river = q >= 40 ? clamp01(Math.log(q / 40) / Math.log(100)) : 0;
      const quiet = !input.history || state.orogenyStep[i] < 0 || state.step - state.orogenyStep[i] > QUIET_STEPS;
      let metals = 0;
      for (const hops of oreHops) if (hops[i] <= metalReach) metals++;
      const comfort = input.habitabilityTerms[H * i + 2];
      // Peoples.
      set(i, 0, clamp01((rel - 1000) / 2000), clamp01((state.thickness[i] - 40) / 20), hasOre ? soft(metals / 2, 0.25) : 1, soft(rugged[i], 0.5));
      if (!ice) set(i, 1, ELF_FOREST[veg] ?? 0, clamp01(input.npp[i] / 600), quiet && state.volcanic[i] < 0.5 ? 1 : 0.4, soft(remote(i), 0.2));
      if (!ice) set(i, 2, Math.max(river, lakeside[i] ? 0.6 : 0), clamp01(input.agriculture[i] / 0.6), soft(1 - rugged[i], 0.3), comfort);
      if (!ice) set(i, 3, Math.max(ORC_TERRAIN[veg] ?? 0.1, clamp01(state.volcanic[i] / 1)), 1 - clamp01(input.habitability[i] / 0.6), input.arrivalKa[i] >= 0 ? 1 : 0.2, soft(rugged[i], 0.5));
      set(i, 4, clamp01((8 - temp) / 15), soft(clamp01((rel - 500) / 2000), 0.3), GIANT_OPEN[veg] ?? 0.2, soft(remote(i), 0.3));
      // Land monsters.
      set(i, 6, Math.max(clamp01((rel - 2000) / 2500), clamp01(state.volcanic[i] / 2)), hasOre ? soft(goldHops[i] <= metalReach ? 1 : 0, 0.2) : 1, soft(remote(i), 0.1), soft(rugged[i], 0.4));
      set(i, 8, TROLL_BOREAL[veg] ?? 0, soft(rugged[i], 0.2), clamp01((10 - temp) / 15), soft(remote(i), 0.3));
      const dense = clamp01((input.npp[i] / 900) * (input.megafauna[i] & MEGAFAUNA_GIANT_ARTHROPODS ? 1.3 : 1));
      if (!ice) set(i, 9, SPIDER_CANOPY[veg] ?? 0, dense, clamp01((temp - 18) / 8), clamp01((input.precipitation[i] - 1500) / 1500));
    } else if (rel < 0) {
      const depth = -rel;
      const speed = Math.hypot(input.currentU[i], input.currentV[i]);
      set(i, 5, clamp01(1 - depth / 200), clamp01((temp - 15) / 10), 1 - clamp01(input.seaIceMonths[i] / 6), soft(landNeighbor[i], 0.5));
      const trench = Math.max(state.boundary[i] === BOUNDARY_SUBDUCTING ? 1 : 0, clamp01((depth - 5000) / 2000));
      set(i, 7, clamp01((depth - 2000) / 4000), soft(trench, 0.3), soft(Math.max(clamp01((12 - temp) / 14), clamp01(-input.sstAnomaly[i] / 3)), 0.3), soft(speed / 0.3, 0.5));
    }
    // The dominant people: the land peoples on land, the merfolk in the sea.
    let best = -1;
    let bestValue = DOMINANCE_THRESHOLD;
    const from = land[i] ? 0 : 5;
    const to = land[i] ? 5 : 6;
    for (let e = from; e < to; e++) {
      const v = suitability[i * E + e];
      if (v >= bestValue && v > 0) {
        bestValue = v;
        best = e;
      }
    }
    if (best >= 0) people[i] = best;
  }

  // Lairs: per monster, the best cells at least LAIR_SPACING_KM apart, like the candidate cities.
  const lairs: LairInfo[] = [];
  const minDot = Math.cos(LAIR_SPACING_KM / input.radiusKm);
  for (let m = 0; m < MONSTER_COUNT; m++) {
    const e = PEOPLE_COUNT + m;
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (suitability[i * E + e] >= LAIR_MIN) order.push(i);
    order.sort((a, b) => suitability[b * E + e] - suitability[a * E + e] || a - b);
    const chosen: number[] = [];
    for (const i of order) {
      if (chosen.length >= LAIR_COUNT) break;
      let apart = true;
      for (const c of chosen) {
        const dot = grid.xyz[3 * i] * grid.xyz[3 * c] + grid.xyz[3 * i + 1] * grid.xyz[3 * c + 1] + grid.xyz[3 * i + 2] * grid.xyz[3 * c + 2];
        if (dot > minDot) {
          apart = false;
          break;
        }
      }
      if (!apart) continue;
      chosen.push(i);
      lairs.push({ monster: m, cell: i, score: suitability[i * E + e] });
    }
  }
  return { suitability, terms, people, lairs };
}

/** Suitability of one entity at a cell. */
export function suitabilityAt(suitability: ArrayLike<number>, cell: number, entity: number): number {
  return suitability[cell * ENTITY_COUNT + entity];
}

/** One term of one entity at a cell. */
export function termAt(terms: ArrayLike<number>, cell: number, entity: number, term: number): number {
  return terms[(cell * ENTITY_COUNT + entity) * TERMS_PER_ENTITY + term];
}
