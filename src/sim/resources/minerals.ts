import { REFERENCE_CELL_KM } from '../constants.ts';
import type { Grid } from '../grid/grid.ts';
import { EARTH_O2 } from '../params.ts';
import type { ReliefState } from '../pipeline.ts';
import { mix32 } from '../rng/hash.ts';
import { CONTINENTAL } from '../tectonics/crust.ts';
import { BOUNDARY_SUBDUCTING } from '../tectonics/simulation.ts';

/**
 * Mineral resources from the tectonic provenance (M21; DESIGN 3.10). Each
 * cell gets a potential from 0 to 1 for seven resources, each read from
 * what the tectonic loop recorded: shields (thick, old, deeply eroded
 * continental crust) carry iron and the granites that concentrate uranium;
 * volcanic arcs over subduction carry copper; thickened collision belts
 * carry gold and tin once erosion exposes them; the swamp, shallow-sea and
 * evaporite sediment the parcels accumulated inside the loop give coal, oil
 * and salt. Deposits are then drawn cell by cell with a probability equal to
 * the potential times a density, from a hash of the seed, so a map of
 * sparse, fixed deposits comes out of a continuous field and never changes
 * the geography. The real Earth, which has no tectonic history here, gets
 * measured deposits instead (sim/earth.ts) and potentials of zero. The
 * planet's composition (M26) scales the potentials before the draw: the
 * crustal iron and metal abundances multiply the ore potentials, and a
 * low-oxygen atmosphere preserves the organic matter of the source rock,
 * so a richer planet has a superset of a poorer one's deposits.
 */

export const MINERALS = ['iron', 'copper', 'gold', 'uranium', 'coal', 'oil', 'salt'] as const;
export type Mineral = (typeof MINERALS)[number];
export const MINERAL_COUNT = MINERALS.length;
export const MINERAL_NAMES: Record<Mineral, string> = {
  iron: 'iron',
  copper: 'copper',
  gold: 'gold and tin',
  uranium: 'uranium',
  coal: 'coal',
  oil: 'oil and gas',
  salt: 'salt',
};

/** A shield: continental crust from the planet's start (not an accreted arc), never thinned below the standard 35 km by rifting, full at 38, that has not collided for a while. */
export const SHIELD_MIN_KM = 33;
export const SHIELD_FULL_KM = 38;
export const SHIELD_QUIET_STEPS = 60;
/** Erosion that exposes a young collision belt's gold and an arc's copper (they sit kilometers down until the cover is stripped), meters of surface over the crust's life. Shields need none: their basement has been bare since long before this history. */
export const EXPOSURE_M = 800;
/** Sediment cover that buries a shield's iron and uranium, km. */
export const COVER_KM = 0.5;
/** Potential of a bare shield: banded iron formations and uranium granites are provinces within shields, not the whole shield. */
export const SHIELD_ORE_SHARE = 0.5;
/** Volcanic pile for full copper potential, km (the Andes carry a few kilometers). */
export const ARC_FULL_KM = 3;
/** Reach of an arc from its trench, in reference cells of 112 km (the volcanic front sits 150 to 300 km inboard). */
export const ARC_REACH_CELLS = 3;
/** Collision belts: thickness at which gold and tin appear and at which they are full, km. */
export const OROGENIC_MIN_KM = 42;
export const OROGENIC_FULL_KM = 55;
/** Sandstone basins next to a shield (within this many reference cells) host roll-front uranium; the sediment that counts, km. */
export const URANIUM_BASIN_REACH_CELLS = 2;
export const URANIUM_BASIN_SEDIMENT_KM = 0.2;
/** Swamp sediment for full coal potential, shallow-sea sediment for full oil potential, burial that matures it, evaporite for full salt potential, km. */
export const COAL_FULL_KM = 0.3;
export const OIL_FULL_KM = 0.5;
export const OIL_BURIAL_KM = 0.8;
export const SALT_FULL_KM = 0.5;
/** Share of the cells of full potential that get a deposit. */
export const DEPOSIT_CHANCE = 0.3;

export interface MineralFields {
  /** Potential of each mineral per cell, mineral-major (mineral * n + cell), 0 to 1. */
  potential: Float64Array;
  /** Bit m set where mineral m (in MINERALS order) has a deposit. */
  deposits: Uint8Array;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hops from any marked cell, up to `reach`; cells beyond get reach + 1. */
function hopsFrom(grid: Grid, marked: Uint8Array, reach: number): Uint8Array {
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

/** Composition (M26): anoxic seas preserve organic matter, so the oil source rock scales with Earth's oxygen over the planet's, clamped. */
export const OIL_PRESERVATION_MIN = 0.5;
export const OIL_PRESERVATION_MAX = 2;
export function oilPreservation(oxygen: number): number {
  return Math.min(OIL_PRESERVATION_MAX, Math.max(OIL_PRESERVATION_MIN, EARTH_O2 / oxygen));
}
/** Crustal abundances relative to Earth, and the oxygen fraction, that scale the potentials before the deposits are drawn. */
export interface Composition {
  crustIron: number;
  crustMetals: number;
  oxygen: number;
}
export const EARTH_COMPOSITION: Composition = { crustIron: 1, crustMetals: 1, oxygen: EARTH_O2 };

/** Potentials and deposits of a relief state; `seed` draws the deposits, `radiusKm` scales the reach constants to the grid, `composition` scales the potentials (exactly 1 on Earth). */
export function computeMinerals(grid: Grid, state: ReliefState, seaLevel: number, seed: number, radiusKm: number, composition: Composition = EARTH_COMPOSITION): MineralFields {
  const n = grid.n;
  const potential = new Float64Array(MINERAL_COUNT * n);
  const deposits = new Uint8Array(n);
  const cellKm = Math.sqrt((4 * Math.PI * radiusKm * radiusKm) / n);
  const cellsPerUnit = REFERENCE_CELL_KM / cellKm;

  // Shields and trenches, for the reach-based rules.
  const shield = new Float64Array(n);
  const shieldMask = new Uint8Array(n);
  const trench = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    if (state.boundary[j] === BOUNDARY_SUBDUCTING) trench[j] = 1;
    if (state.crustType[j] !== CONTINENTAL) continue;
    const orogeny = state.orogenyStep[j];
    const quiet = orogeny < 0 || state.step - orogeny > SHIELD_QUIET_STEPS;
    const ancient = state.crustAge[j] >= state.step - 1;
    if (!quiet || !ancient) continue;
    shield[j] = clamp01((state.thickness[j] - SHIELD_MIN_KM) / (SHIELD_FULL_KM - SHIELD_MIN_KM));
    if (shield[j] > 0.5) shieldMask[j] = 1;
  }
  const trenchHops = hopsFrom(grid, trench, Math.max(1, Math.round(ARC_REACH_CELLS * cellsPerUnit)));
  const shieldHops = hopsFrom(grid, shieldMask, Math.max(1, Math.round(URANIUM_BASIN_REACH_CELLS * cellsPerUnit)));
  const arcReach = Math.max(1, Math.round(ARC_REACH_CELLS * cellsPerUnit));
  const basinReach = Math.max(1, Math.round(URANIUM_BASIN_REACH_CELLS * cellsPerUnit));

  for (let j = 0; j < n; j++) {
    const continental = state.crustType[j] === CONTINENTAL;
    const land = state.elevation[j] >= seaLevel;
    const exposure = clamp01(state.eroded[j] / EXPOSURE_M);
    const cover = clamp01(state.sediment[j] / COVER_KM);
    const orogeny = state.orogenyStep[j];
    let iron = 0;
    let copper = 0;
    let gold = 0;
    let uranium = 0;
    if (continental && land) {
      iron = clamp01(SHIELD_ORE_SHARE * shield[j] * (1 - cover) * composition.crustIron);
      const near = trenchHops[j] <= arcReach ? 1 : 0.5;
      copper = clamp01(clamp01(state.volcanic[j] / ARC_FULL_KM) * near * (0.5 + 0.5 * exposure) * composition.crustMetals);
      const orogenic = orogeny >= 0 ? clamp01((state.thickness[j] - OROGENIC_MIN_KM) / (OROGENIC_FULL_KM - OROGENIC_MIN_KM)) : 0;
      gold = clamp01(orogenic * exposure * composition.crustMetals);
      const basin = state.sediment[j] >= URANIUM_BASIN_SEDIMENT_KM && shieldHops[j] <= basinReach && shieldMask[j] === 0
        ? 0.6 * clamp01(state.sediment[j] / COVER_KM)
        : 0;
      uranium = clamp01(Math.max(SHIELD_ORE_SHARE * 0.7 * shield[j] * (1 - cover), basin) * composition.crustMetals);
    }
    const coal = land ? clamp01(state.coal[j] / COAL_FULL_KM) : 0;
    const oil = continental ? clamp01(clamp01(state.oil[j] / OIL_FULL_KM) * clamp01(state.sediment[j] / OIL_BURIAL_KM) * oilPreservation(composition.oxygen)) : 0;
    const salt = land ? clamp01(state.salt[j] / SALT_FULL_KM) : 0;
    const values = [iron, copper, gold, uranium, coal, oil, salt];
    let bits = 0;
    for (let m = 0; m < MINERAL_COUNT; m++) {
      potential[m * n + j] = values[m];
      if (values[m] <= 0) continue;
      const draw = mix32((seed ^ Math.imul(j * 8 + m, 0x9e3779b1)) >>> 0) / 4294967296;
      if (draw < DEPOSIT_CHANCE * values[m]) bits |= 1 << m;
    }
    deposits[j] = bits;
  }
  return { potential, deposits };
}

/** Potential of one mineral at a cell. */
export function mineralPotentialAt(potential: ArrayLike<number>, n: number, mineral: number, cell: number): number {
  return potential[mineral * n + cell];
}
