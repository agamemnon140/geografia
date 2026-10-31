import type { Grid } from '../grid/grid.ts';
import { SAMPLES, daylightHours } from './insolation.ts';

/**
 * Cloud cover and sunshine (M20). The moisture solver's column of water
 * vapor, against the column that saturated air at the surface temperature
 * holds, gives a relative-humidity proxy; low cloud grows with it as in
 * Sundqvist (1978). Lifted cloud comes from the orographic and convergent
 * rainout (fronts, the ITCZ, windward slopes), stratus from cold water
 * (the Humboldt and Benguela decks), and sinking air (the subtropical
 * highs, the lee of ranges) clears what the humidity made. Sunshine hours
 * are the daylight hours not under cloud, summed over the year. The cover
 * feeds back into the energy balance: clouds reflect sunlight
 * (ebm.ts planetaryAlbedo) and trap longwave, more under the cold tops of
 * lifted cloud than under warm low decks, which is why a stratus coast is
 * a net cooling and the ITCZ nearly neutral, as observed.
 */

/** Saturated column over the equilibrium column of a still open sea at the same temperature (evaporation over the base rainout), so an undisturbed sea reads 1/1.08 = 0.93 relative humidity. */
export const SATURATION_OVER_EQUILIBRIUM = 1.08;
/** Floor of the saturated column, mm: the polar night must not read saturated by nothing. */
export const MIN_SATURATED_COLUMN_MM = 1;
/**
 * Humidity cloud: none below RH_CLEAR, RH_CLOUD_MAX at RH_OVERCAST, linear
 * between. The proxy is a column ratio (the moisture the winds bring over
 * what the surface could hold), which runs lower than the surface humidity
 * where the winds export moisture, so the ramp starts low; the cap keeps
 * the wet tropics from being overcast by humidity alone (the rest is
 * lifted cloud).
 */
export const RH_CLEAR = 0.05;
export const RH_OVERCAST = 0.8;
export const RH_CLOUD_MAX = 0.8;
/** Boundary-layer cloud over open water: the air just above a sea is always moist, and trade cumulus or stratocumulus cover a third of the sky even under the subtropical highs (the clearest oceans have 0.4 to 0.5). Not cleared by sinking. */
export const MARINE_CLOUD = 0.35;
/** Lifted cloud: DEEP_MAX (1 - exp(-lifting / LIFT_SCALE)), lifting being the orographic plus convergent rainout relative to the base rainout; convective cloud is intermittent, so even the ITCZ is not overcast. */
export const LIFT_SCALE = 1;
export const DEEP_MAX = 0.65;
/**
 * Clearing by sinking air (descent plus divergence relative to the base
 * rainout): humidity and lifted cloud are multiplied by
 * 1 - SINK_MAX (1 - exp(-sinking / SINK_SCALE)); stratus over cold water is
 * spared, because marine stratocumulus lives under the subtropical
 * subsidence. The model's winds die over a few cells at the circulation
 * edges, so the divergence there is several times the base rainout.
 */
export const SINK_SCALE = 4;
export const SINK_MAX = 0.6;
/** Stratus over cold water: cover per degree of cold current anomaly, capped at STRATUS_MAX. */
export const STRATUS_PER_C = 0.2;
export const STRATUS_MAX = 0.8;
/** Longwave trapped per unit cover by low cloud (warm tops) and by lifted cloud (cold tops), W/m^2; Earth's clouds trap 27 W/m^2 at a cover of 0.62 with about a third of it deep. */
export const LOW_CLOUD_LONGWAVE_W = 38;
export const DEEP_CLOUD_LONGWAVE_W = 45;
/** Earth's mean cloud cover and trapped longwave: the prior of the first climate pass, before the moisture is known. */
export const CLOUD_PRIOR = 0.62;
export const CLOUD_PRIOR_LONGWAVE_W = 27;
export const DAYS_PER_YEAR = 365.25;
/** Share of the covered sky that blocks the direct sun: broken cloud lets some through, so station sunshine runs above daylight x (1 - cover). */
export const SUNSHINE_OPACITY = 0.8;

/** Share of the humidity and lifted cloud that survives sinking air. */
function clearing(sinking: number): number {
  return sinking > 0 ? 1 - SINK_MAX * (1 - Math.exp(-sinking / SINK_SCALE)) : 1;
}

/** Share of the sky under lifted (deep) cloud, after the clearing by sinking air. */
export function deepCloud(lifting: number, sinking: number): number {
  const deep = lifting > 0 ? DEEP_MAX * (1 - Math.exp(-lifting / LIFT_SCALE)) : 0;
  return deep * clearing(sinking);
}

/**
 * Total cloud cover of a cell for one sample. Humidity and lifted cloud
 * share the same moist air, so the larger of the two counts (maximum
 * overlap); the marine deck and the stratus over cold water are separate
 * layers and overlap at random.
 */
export function cloudCover(rh: number, lifting: number, sinking: number, openWater: boolean, coldWaterC: number): number {
  let low = (RH_CLOUD_MAX * (rh - RH_CLEAR)) / (RH_OVERCAST - RH_CLEAR);
  if (low < 0) low = 0;
  else if (low > RH_CLOUD_MAX) low = RH_CLOUD_MAX;
  const air = Math.max(low * clearing(sinking), deepCloud(lifting, sinking));
  const marine = openWater ? MARINE_CLOUD : 0;
  const stratus = coldWaterC > 0 ? Math.min(STRATUS_MAX, STRATUS_PER_C * coldWaterC) : 0;
  return 1 - (1 - air) * (1 - marine) * (1 - stratus);
}

/** Longwave trapped by a cover of which `deep` is lifted cloud, W/m^2. */
export function cloudLongwave(cover: number, deep: number): number {
  return (cover - deep) * LOW_CLOUD_LONGWAVE_W + deep * DEEP_CLOUD_LONGWAVE_W;
}

/** Sunshine hours per year per cell: the daylight hours not under cloud, summed over the samples. */
export function sunshineHours(grid: Grid, declinations: Float64Array, cloud: Float64Array): Float64Array {
  const n = grid.n;
  const out = new Float64Array(n);
  const daysPerSample = DAYS_PER_YEAR / SAMPLES;
  for (let s = 0; s < SAMPLES; s++) {
    const base = s * n;
    for (let i = 0; i < n; i++) out[i] += daylightHours(grid.lat[i], declinations[s]) * (1 - SUNSHINE_OPACITY * cloud[base + i]) * daysPerSample;
  }
  return out;
}
