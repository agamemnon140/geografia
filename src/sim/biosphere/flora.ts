import { SAMPLES } from '../climate/insolation.ts';
import type { Grid } from '../grid/grid.ts';
import { EARTH_O2 } from '../params.ts';
import type { ReliefState } from '../pipeline.ts';

/**
 * Flora (M22; DESIGN 3.11): the living cover of the land from the climate
 * and the provenance, in three fields. Net primary productivity follows
 * the Miami model of Lieth (1975), the smaller of a temperature curve and
 * a rainfall curve fitted to measured stands, scaled by the sunshine and
 * by the soil. Soil fertility is itemized from what the simulator stored:
 * volcanic ash and alluvium enrich, leaching in the hot wet tropics, old
 * shields and cold impoverish, ice sheets zero it. The vegetation type is
 * read from the monthly climate and the productivity in thirteen classes
 * richer than Koppen's letters: forests by their winter and their rain,
 * grasslands and scrub by their dryness, wetlands by the rivers. There is
 * no succession: the cover is the one the current climate supports.
 * The planet's composition (M26) enters as three pure factors that are
 * exactly 1 on Earth: photorespiration lowers growth as the oxygen rises,
 * CO2 (the greenhouse parameter) fertilizes it, and a fire regime that
 * rises steeply with oxygen moves the forest thresholds of the seasonal
 * climates, so savannas spread on an oxygen-rich planet.
 */

/** Vegetation classes; index 0 is the ocean (lakes keep their water color on the map). */
export const VEGETATION_NAMES = [
  'ocean',
  'ice or bare rock',
  'tundra',
  'boreal forest',
  'temperate forest',
  'temperate rainforest',
  'steppe and prairie',
  'Mediterranean woodland',
  'semi-arid scrub',
  'desert',
  'savanna',
  'tropical seasonal forest',
  'tropical rainforest',
  'wetland',
] as const;
export const VEG_OCEAN = 0, VEG_ICE = 1, VEG_TUNDRA = 2, VEG_BOREAL = 3, VEG_TEMPERATE = 4, VEG_TEMPERATE_RAIN = 5, VEG_STEPPE = 6;
export const VEG_MEDITERRANEAN = 7, VEG_SCRUB = 8, VEG_DESERT = 9, VEG_SAVANNA = 10, VEG_SEASONAL = 11, VEG_RAINFOREST = 12, VEG_WETLAND = 13;

/** Miami model (Lieth 1975): dry matter, g/m^2/yr, as a function of annual temperature (C) and rainfall (mm). */
export const MIAMI_MAX = 3000;
export const MIAMI_T_OFFSET = 1.315;
export const MIAMI_T_SLOPE = 0.119;
export const MIAMI_P_SCALE = 0.000664;
/** Carbon share of dry matter. */
export const CARBON_SHARE = 0.45;
/** Sunshine factor: 1 at Earth's mean land sunshine, a fifth less under permanent cloud, a fifth more under a clear sky. */
export const SUNSHINE_REFERENCE_H = 2500;
export const SUNSHINE_WEIGHT = 0.2;
/** Soil factor: productivity scales from 0.6 on barren soil to 1.4 on the richest. */
export const SOIL_WEIGHT = 0.8;
/** Composition (M26): photorespiration lowers C3 growth by this share per unit of relative oxygen change (the Warburg effect), clamped. */
export const PHOTORESPIRATION_SLOPE = 0.35;
export const OXYGEN_GROWTH_MIN = 0.5;
export const OXYGEN_GROWTH_MAX = 1.5;
/** CO2 fertilization: growth rises with the logarithm of the greenhouse parameter (FACE experiments: about +28 % per doubling), floored. */
export const CO2_BETA = 0.4;
export const CO2_GROWTH_MIN = 0.5;
/** Fire regime: fire frequency rises steeply with oxygen (Belcher 2010); the forest thresholds of the seasonal climates scale by this factor, clamped. */
export const FIRE_EXPONENT = 1.5;
export const FIRE_MIN = 0.3;
export const FIRE_MAX = 3;

/** Growth factor of the oxygen fraction: 1 on Earth, 0.85 at 30 %, 1.15 at 12 %. */
export function oxygenGrowthFactor(oxygen: number): number {
  return Math.min(OXYGEN_GROWTH_MAX, Math.max(OXYGEN_GROWTH_MIN, 1 - PHOTORESPIRATION_SLOPE * ((oxygen - EARTH_O2) / EARTH_O2)));
}
/** Growth factor of the greenhouse (CO2) parameter: 1 on Earth, 1.28 at twice the CO2. */
export function carbonGrowthFactor(greenhouse: number): number {
  return Math.max(CO2_GROWTH_MIN, 1 + CO2_BETA * Math.log(greenhouse));
}
/** Fire factor of the oxygen fraction: 1 on Earth, 1.71 at 30 %, 0.6 at 15 %. */
export function fireFactor(oxygen: number): number {
  return Math.min(FIRE_MAX, Math.max(FIRE_MIN, Math.pow(oxygen / EARTH_O2, FIRE_EXPONENT)));
}

/** Soil fertility terms (0 to 1 after the sum): a base, enrichment by ash and alluvium, losses. */
export const SOIL_BASE = 0.45;
/** Volcanic ash: full enrichment at 1 km of volcanic rock in the cell. */
export const ASH_BONUS = 0.3;
export const ASH_FULL_KM = 1;
/** Alluvium: full enrichment on the flood plain of a river of 400 km^3/yr or on 0.3 km of basin sediment. */
export const ALLUVIUM_BONUS = 0.25;
export const ALLUVIUM_RIVER_KM3 = 400;
export const ALLUVIUM_SEDIMENT_KM = 0.3;
export const RIVER_MIN_KM3 = 40;
/** Leaching: hot wet tropics lose up to this once rain exceeds 1,500 mm (full at 3,000). */
export const LEACHING_LOSS = 0.25;
export const LEACHING_C = 20;
export const LEACHING_MM = 1500;
/** Old shields (ancient crust never in an orogeny) are deeply weathered; cold ground (annual mean below zero) is thin and frozen. */
export const SHIELD_LOSS = 0.1;
export const COLD_LOSS = 0.15;
export const SOIL_MIN = 0.05;

/** Vegetation thresholds (mm per year, degrees C). */
export const DESERT_MM = 250;
export const SCRUB_MM = 500;
export const TROPICAL_SCRUB_MM = 600;
export const TROPICAL_FOREST_MM = 1500;
export const RAINFOREST_MM = 1800;
export const TEMPERATE_RAIN_MM = 1500;
/** A dry season: a sample raining at less than Koppen's 60 mm per month, as an annual rate. */
export const DRY_SEASON_MM = 720;
export const TUNDRA_WARMEST_C = 10;
export const BOREAL_WARMEST_C = 18;
export const CONTINENTAL_COLDEST_C = -3;
export const TROPICAL_COLDEST_C = 18;
export const WARM_ANNUAL_C = 12;
export const FOREST_NPP = 300;
/** Wetlands: flood plains at a river mouth or beside a lake, with a river of this size. */
export const WETLAND_RIVER_KM3 = 100;

export interface FloraFields {
  /** Net primary productivity, g C/m^2/yr; 0 on water and ice. */
  npp: Float64Array;
  /** Soil fertility 0 to 1, and its terms: ash and alluvium (gains), losses (leaching, shield, cold). */
  soil: Float64Array;
  soilAsh: Float64Array;
  soilAlluvium: Float64Array;
  soilLoss: Float64Array;
  /** Vegetation class, index into VEGETATION_NAMES. */
  vegetation: Uint8Array;
}

export interface FloraInputs {
  temperatureAnnual: Float64Array;
  /** Per sample, sample-major. */
  temperature: Float64Array;
  precipitation: Float64Array;
  precipitationSamples: Float64Array;
  sunshineHours: Float64Array;
  iceSheet: Uint8Array;
  discharge: Float64Array;
  downstream: Int32Array;
  lake: Int32Array;
  /** False for a measured relief without provenance (the real Earth): the shield term, which reads the crust's history, is skipped. */
  history: boolean;
  /** Composition (M26): the atmospheric oxygen fraction and the greenhouse (CO2) parameter. */
  oxygen: number;
  greenhouse: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Miami productivity in g C/m^2/yr before the sunshine and soil factors. */
export function miamiNpp(temperatureC: number, precipitationMm: number): number {
  const byT = MIAMI_MAX / (1 + Math.exp(MIAMI_T_OFFSET - MIAMI_T_SLOPE * temperatureC));
  const byP = MIAMI_MAX * (1 - Math.exp(-MIAMI_P_SCALE * precipitationMm));
  return CARBON_SHARE * Math.min(byT, byP);
}

export function computeFlora(grid: Grid, state: ReliefState, seaLevel: number, input: FloraInputs): FloraFields {
  const n = grid.n;
  const npp = new Float64Array(n);
  const soil = new Float64Array(n);
  const soilAsh = new Float64Array(n);
  const soilAlluvium = new Float64Array(n);
  const soilLoss = new Float64Array(n);
  const vegetation = new Uint8Array(n);
  const water = (j: number): boolean => state.elevation[j] < seaLevel || input.lake[j] >= 0;
  const oxygenFactor = oxygenGrowthFactor(input.oxygen);
  const carbonFactor = carbonGrowthFactor(input.greenhouse);
  const fire = fireFactor(input.oxygen);

  for (let i = 0; i < n; i++) {
    if (water(i)) continue;
    const t = input.temperatureAnnual[i];
    const p = input.precipitation[i];
    const ancient = input.history && state.crustAge[i] >= state.step - 1 && state.orogenyStep[i] < 0;

    // Soil: itemized terms.
    if (input.iceSheet[i]) {
      vegetation[i] = VEG_ICE;
      continue;
    }
    const ash = ASH_BONUS * clamp01(state.volcanic[i] / ASH_FULL_KM);
    const river = input.discharge[i] >= RIVER_MIN_KM3 ? clamp01(Math.log(input.discharge[i] / RIVER_MIN_KM3) / Math.log(ALLUVIUM_RIVER_KM3 / RIVER_MIN_KM3)) : 0;
    const alluvium = ALLUVIUM_BONUS * Math.max(river, clamp01(state.sediment[i] / ALLUVIUM_SEDIMENT_KM));
    let loss = 0;
    if (t > LEACHING_C && p > LEACHING_MM) loss += LEACHING_LOSS * clamp01((p - LEACHING_MM) / LEACHING_MM);
    if (ancient) loss += SHIELD_LOSS;
    if (t < 0) loss += COLD_LOSS;
    const fertility = Math.max(SOIL_MIN, Math.min(1, SOIL_BASE + ash + alluvium - loss));
    soil[i] = fertility;
    soilAsh[i] = ash;
    soilAlluvium[i] = alluvium;
    soilLoss[i] = loss;

    // Productivity.
    const sun = 1 + SUNSHINE_WEIGHT * Math.max(-1, Math.min(1, (input.sunshineHours[i] - SUNSHINE_REFERENCE_H) / SUNSHINE_REFERENCE_H));
    const soilFactor = 1 - SOIL_WEIGHT / 2 + SOIL_WEIGHT * fertility;
    npp[i] = miamiNpp(t, p) * sun * soilFactor * oxygenFactor * carbonFactor;

    // Vegetation from the monthly climate.
    let warmest = -Infinity;
    let coldest = Infinity;
    let driest = Infinity;
    let summer = 0;
    let winter = 0;
    const north = grid.lat[i] >= 0;
    for (let s = 0; s < SAMPLES; s++) {
      const ts = input.temperature[s * n + i];
      const ps = input.precipitationSamples[s * n + i];
      if (ts > warmest) warmest = ts;
      if (ts < coldest) coldest = ts;
      if (ps < driest) driest = ps;
      // Sample 0 is mid-January-like: the northern summer half-year is samples 3 to 8.
      const inNorthSummer = s >= 3 && s <= 8;
      if (inNorthSummer === north) summer += ps;
      else winter += ps;
    }
    const down = input.downstream[i];
    const flood = input.discharge[i] >= WETLAND_RIVER_KM3 && down >= 0 && water(down);
    let lakeside = false;
    if (!flood && input.discharge[i] >= RIVER_MIN_KM3) {
      for (let k = grid.nbStart[i]; k < grid.nbStart[i + 1]; k++) {
        if (input.lake[grid.nb[k]] >= 0) {
          lakeside = true;
          break;
        }
      }
    }
    let v: number;
    if (warmest < TUNDRA_WARMEST_C) v = VEG_TUNDRA;
    else if (p < DESERT_MM) v = VEG_DESERT;
    else if (coldest < CONTINENTAL_COLDEST_C) {
      if (p < SCRUB_MM) v = VEG_STEPPE;
      else v = warmest < BOREAL_WARMEST_C ? VEG_BOREAL : VEG_TEMPERATE;
    } else if (coldest < TROPICAL_COLDEST_C) {
      if (p < SCRUB_MM) v = t > WARM_ANNUAL_C ? VEG_SCRUB : VEG_STEPPE;
      else if (summer < 0.5 * winter && t > WARM_ANNUAL_C) v = VEG_MEDITERRANEAN;
      else if (p > TEMPERATE_RAIN_MM) v = VEG_TEMPERATE_RAIN;
      else v = npp[i] > FOREST_NPP * fire ? VEG_TEMPERATE : VEG_STEPPE;
    } else if (p < TROPICAL_SCRUB_MM) v = VEG_SCRUB;
    else if (driest < DRY_SEASON_MM) v = p < TROPICAL_FOREST_MM * fire ? VEG_SAVANNA : VEG_SEASONAL;
    else v = p > RAINFOREST_MM ? VEG_RAINFOREST : VEG_SEASONAL;
    if ((flood || lakeside) && t > 0 && p > SCRUB_MM && v !== VEG_TUNDRA) v = VEG_WETLAND;
    vegetation[i] = v;
  }
  return { npp, soil, soilAsh, soilAlluvium, soilLoss, vegetation };
}
