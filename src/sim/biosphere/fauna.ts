import type { Grid } from '../grid/grid.ts';
import { EARTH_O2 } from '../params.ts';
import type { ReliefState } from '../pipeline.ts';
import { LINEAGE_COUNT, LINEAGE_SECTOR_NAMES } from '../tectonics/crust.ts';

/**
 * Fauna (M23; DESIGN 3.12): biogeographic realms, endemism, richness and
 * megafauna from the lineages the tectonic loop carried on the crust
 * parcels (tectonics/crust.ts LINEAGE_*). The loop seeded eight ancestral
 * faunas around the supercontinent and let them diffuse along the land at
 * every fluvial pass, never across the sea, so a continent that split off
 * long ago keeps the lineages it left with and a strait that opened late
 * divides two faunas that are still alike: the realm map is an outcome of
 * the plate history. Richness follows the species-energy and the
 * species-area relations (productivity and landmass size); endemism is the
 * share of a cell's fauna found on no other landmass; large herbivores
 * need productive ground on a landmass of some size, large predators a
 * bigger one. A relief without a history (the real Earth) gets one lineage
 * per large landmass, smaller ones taking the nearest's: realms by present
 * connectivity only.
 */

export const REALM_NONE = 255;
/** Landmass size at which large herbivores and large predators are sustained, km^2 (Madagascar carries the first, not the second). */
export const HERBIVORE_LANDMASS_KM2 = 2e5;
export const PREDATOR_LANDMASS_KM2 = 1e6;
/** Productivity for large herbivores, g C/m^2/yr (steppes qualify, deserts do not). */
export const HERBIVORE_NPP = 200;
/** Richness: productivity at which the energy term saturates, and the landmass sizes between which the area term rises (log scale). */
export const RICHNESS_NPP = 1000;
export const RICHNESS_AREA_MIN_KM2 = 1e4;
export const RICHNESS_AREA_MAX_KM2 = 1e7;
/** Landmasses that seed their own lineage on a relief without history. */
export const HISTORYLESS_REALMS = LINEAGE_COUNT;
export const MEGAFAUNA_HERBIVORES = 1;
export const MEGAFAUNA_PREDATORS = 2;
/** Composition (M26): large active animals need oxygen. None below HYPOXIA_O2, full aerobic scope at Earth's fraction (the productivity a large herbivore needs rises as the scope falls); giant arthropods, the Carboniferous dragonflies, above GIANT_ARTHROPOD_O2. */
export const MEGAFAUNA_GIANT_ARTHROPODS = 4;
export const HYPOXIA_O2 = 0.1;
export const GIANT_ARTHROPOD_O2 = 0.27;
/** Aerobic scope of the oxygen fraction: exactly 1 on Earth, 0 at 10 %. */
export function aerobicScope(oxygen: number): number {
  return clamp01((oxygen - HYPOXIA_O2) / (EARTH_O2 - HYPOXIA_O2));
}

export interface FaunaFields {
  /** Lineage shares per cell, cell-major (cell * LINEAGE_COUNT + k), summing to 1 on land, 0 on water. */
  lineage: Float64Array;
  /** Dominant lineage, REALM_NONE on water. */
  realm: Uint8Array;
  /** Share of the cell's fauna found on no other landmass, 0 to 1. */
  endemism: Float64Array;
  /** Species richness index 0 to 1. */
  richness: Float64Array;
  /** MEGAFAUNA_* bits. */
  megafauna: Uint8Array;
  /** Landmass id per cell (-1 on water) and the landmasses' areas, km^2. */
  landmass: Int32Array;
  landmassAreas: number[];
  /** Names of the eight lineages (M27): the compass sector of the supercontinent where each began, or, without a history, the landmass that seeds it. */
  names: string[];
  /** Per lineage, the cell at the heart of its largest contiguous realm (-1 where it dominates nowhere): where the map writes its name. */
  labelCells: number[];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Connected land components: id per cell (-1 on water) and their areas. */
export function labelLandmasses(grid: Grid, elevation: Float64Array, seaLevel: number, areaKm2: Float64Array): { landmass: Int32Array; areas: number[] } {
  const n = grid.n;
  const landmass = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const areas: number[] = [];
  for (let s = 0; s < n; s++) {
    if (landmass[s] >= 0 || elevation[s] < seaLevel) continue;
    const id = areas.length;
    let head = 0;
    let tail = 0;
    let area = 0;
    landmass[s] = id;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      area += areaKm2[i];
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const j = grid.nb[t];
        if (landmass[j] < 0 && elevation[j] >= seaLevel) {
          landmass[j] = id;
          queue[tail++] = j;
        }
      }
    }
    areas.push(area);
  }
  return { landmass, areas };
}

/** Lineages for a relief without history: the largest landmasses get one each, every other cell the nearest large landmass's. */
function historylessLineages(grid: Grid, landmass: Int32Array, areas: number[]): Float64Array {
  const n = grid.n;
  const L = LINEAGE_COUNT;
  const out = new Float64Array(L * n);
  const ranked = areas.map((a, id) => [a, id] as const).sort((p, q) => q[0] - p[0]).slice(0, HISTORYLESS_REALMS);
  const lineageOf = new Int32Array(areas.length).fill(-1);
  ranked.forEach(([, id], k) => (lineageOf[id] = k));
  // Multi-source breadth-first search from the large landmasses over every cell, water included.
  const nearest = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) {
    const id = landmass[i];
    if (id >= 0 && lineageOf[id] >= 0) {
      nearest[i] = lineageOf[id];
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      if (nearest[j] < 0) {
        nearest[j] = nearest[i];
        queue[tail++] = j;
      }
    }
  }
  for (let i = 0; i < n; i++) if (landmass[i] >= 0 && nearest[i] >= 0) out[i * L + nearest[i]] = 1;
  return out;
}

/** Land without any lineage (an island risen from the sea floor, which nothing could reach by land) takes the fauna of the nearest cell that has one: waif dispersal across the sea. */
function colonizeEmptyLand(grid: Grid, landmass: Int32Array, lineage: Float64Array): void {
  const n = grid.n;
  const L = LINEAGE_COUNT;
  const source = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (landmass[i] < 0) continue;
    let sum = 0;
    for (let k = 0; k < L; k++) sum += lineage[i * L + k];
    if (sum > 0) {
      source[i] = i;
      queue[tail++] = i;
    }
  }
  if (tail === 0) return;
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      if (source[j] < 0) {
        source[j] = source[i];
        queue[tail++] = j;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const s = source[i];
    if (landmass[i] < 0 || s < 0 || s === i) continue;
    for (let k = 0; k < L; k++) lineage[i * L + k] = lineage[s * L + k];
  }
}

export function computeFauna(
  grid: Grid,
  state: ReliefState,
  seaLevel: number,
  areaKm2: Float64Array,
  npp: Float64Array,
  iceSheet: Uint8Array,
  history: boolean,
  oxygen: number = EARTH_O2,
): FaunaFields {
  const n = grid.n;
  const L = LINEAGE_COUNT;
  const { landmass, areas } = labelLandmasses(grid, state.elevation, seaLevel, areaKm2);
  const lineage = new Float64Array(L * n);
  if (history) {
    // Normalized shares from the parcels' vectors (cell-major here, parcel-major in the pool).
    for (let i = 0; i < n; i++) {
      if (landmass[i] < 0) continue;
      let sum = 0;
      for (let k = 0; k < L; k++) sum += state.lineage[i * L + k];
      if (sum <= 0) continue;
      for (let k = 0; k < L; k++) lineage[i * L + k] = state.lineage[i * L + k] / sum;
    }
    colonizeEmptyLand(grid, landmass, lineage);
  } else {
    lineage.set(historylessLineages(grid, landmass, areas));
  }

  // Lineage area per landmass and in all, for the endemism (the share found on no other landmass).
  const perLandmass = new Float64Array(L * areas.length);
  const total = new Float64Array(L);
  for (let i = 0; i < n; i++) {
    const id = landmass[i];
    if (id < 0) continue;
    for (let k = 0; k < L; k++) {
      const v = areaKm2[i] * lineage[i * L + k];
      perLandmass[id * L + k] += v;
      total[k] += v;
    }
  }

  const realm = new Uint8Array(n).fill(REALM_NONE);
  const endemism = new Float64Array(n);
  const richness = new Float64Array(n);
  const megafauna = new Uint8Array(n);
  const logSpan = Math.log10(RICHNESS_AREA_MAX_KM2 / RICHNESS_AREA_MIN_KM2);
  const aerobic = aerobicScope(oxygen);
  const herbivoreNpp = aerobic > 0 ? HERBIVORE_NPP / aerobic : Infinity;
  for (let i = 0; i < n; i++) {
    const id = landmass[i];
    if (id < 0) continue;
    let best = -1;
    let bestShare = 0;
    let endemic = 0;
    for (let k = 0; k < L; k++) {
      const v = lineage[i * L + k];
      if (v > bestShare) {
        bestShare = v;
        best = k;
      }
      if (v > 0 && total[k] > 0) endemic += v * (perLandmass[id * L + k] / total[k]);
    }
    if (best >= 0) realm[i] = best;
    endemism[i] = clamp01(endemic);
    const area = areas[id];
    const energy = Math.sqrt(clamp01(npp[i] / RICHNESS_NPP));
    const size = clamp01(Math.log10(Math.max(RICHNESS_AREA_MIN_KM2, area) / RICHNESS_AREA_MIN_KM2) / logSpan);
    richness[i] = iceSheet[i] ? 0 : energy * size;
    if (!iceSheet[i] && npp[i] >= herbivoreNpp && area >= HERBIVORE_LANDMASS_KM2) {
      megafauna[i] = MEGAFAUNA_HERBIVORES | (area >= PREDATOR_LANDMASS_KM2 ? MEGAFAUNA_PREDATORS : 0);
    }
    if (!iceSheet[i] && oxygen >= GIANT_ARTHROPOD_O2 && npp[i] >= HERBIVORE_NPP) megafauna[i] |= MEGAFAUNA_GIANT_ARTHROPODS;
  }
  const names = lineageNames(grid, history, landmass, areas, areaKm2);
  const labelCells = realmLabelCells(grid, realm, areaKm2);
  return { lineage, realm, endemism, richness, megafauna, landmass, landmassAreas: areas, names, labelCells };
}

function ordinal(k: number): string {
  return k === 1 ? 'largest' : k === 2 ? '2nd largest' : k === 3 ? '3rd largest' : `${k}th largest`;
}

/** Lineage names (M27): the seeding sector on a planet with a history; the seeding landmass (the k-th largest, with where it lies) without one. */
export function lineageNames(grid: Grid, history: boolean, landmass: Int32Array, areas: number[], areaKm2: Float64Array): string[] {
  if (history) return LINEAGE_SECTOR_NAMES.map((name) => name);
  const ranked = areas.map((a, id) => [a, id] as const).sort((p, q) => q[0] - p[0]).slice(0, HISTORYLESS_REALMS);
  const names: string[] = [];
  for (let k = 0; k < LINEAGE_COUNT; k++) {
    if (k >= ranked.length) {
      names.push('unused');
      continue;
    }
    const id = ranked[k][1];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < grid.n; i++) {
      if (landmass[i] !== id) continue;
      const a = areaKm2[i];
      x += a * grid.xyz[3 * i];
      y += a * grid.xyz[3 * i + 1];
      z += a * grid.xyz[3 * i + 2];
    }
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;
    names.push(`${ordinal(k + 1)} landmass (${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'})`);
  }
  return names;
}

/** Where each lineage's name goes on the map (M27): the cell of its largest contiguous realm nearest that realm's centroid, -1 where it dominates nowhere. */
export function realmLabelCells(grid: Grid, realm: Uint8Array, areaKm2: Float64Array): number[] {
  const n = grid.n;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const bestArea = new Float64Array(LINEAGE_COUNT);
  const bestCell: number[] = new Array<number>(LINEAGE_COUNT).fill(-1);
  for (let s = 0; s < n; s++) {
    const k = realm[s];
    if (seen[s] || k >= LINEAGE_COUNT) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    let area = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    while (head < tail) {
      const i = queue[head++];
      const a = areaKm2[i];
      area += a;
      x += a * grid.xyz[3 * i];
      y += a * grid.xyz[3 * i + 1];
      z += a * grid.xyz[3 * i + 2];
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const j = grid.nb[t];
        if (!seen[j] && realm[j] === k) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    if (area <= bestArea[k]) continue;
    bestArea[k] = area;
    let best = s;
    let bestDot = -Infinity;
    for (let q = 0; q < tail; q++) {
      const i = queue[q];
      const dot = x * grid.xyz[3 * i] + y * grid.xyz[3 * i + 1] + z * grid.xyz[3 * i + 2];
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    bestCell[k] = best;
  }
  return bestCell;
}
