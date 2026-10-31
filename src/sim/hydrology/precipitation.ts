import { DEG } from '../grid/geometry.ts';
import type { Grid } from '../grid/grid.ts';

/**
 * Precipitation proxy used inside the tectonic loop (DESIGN 3.4): a zonal
 * profile times an ocean-proximity decay. It knows nothing about winds,
 * mountains or seasons; M5 replaces it with advected moisture on the final
 * relief. Values are mm per year so discharges come out in km^3 per year.
 */

/** Zonal annual precipitation over land near the coast, by absolute latitude in degrees (Earth climatology, smoothed). */
const ZONAL_PROFILE: [number, number][] = [
  [0, 2000],
  [10, 1800],
  [20, 1000],
  [28, 500],
  [40, 900],
  [55, 1100],
  [70, 500],
  [90, 150],
];

/** Precipitation on the continental interior relative to the coast (rain shadow of distance alone). */
export const INTERIOR_FLOOR = 0.25;
/** Hop distance to the ocean at which the excess over the floor has decayed by e. */
export const OCEAN_DECAY_CELLS = 7;
/**
 * Shape of the Budyko curve in Fu's form (M18): the share of precipitation
 * that evaporates is 1 + phi - (1 + phi^w)^(1/w), with phi the ratio of
 * potential evaporation to precipitation. Catchments fit w near 2.6 with
 * land potential evaporation; with the open-water potential the climate
 * provides, w = 2 gives Earth's land-mean runoff share of about 0.35 to 0.4,
 * half of the rain in the Amazon and a few percent in deserts.
 */
export const BUDYKO_OMEGA = 2;

/** Share of precipitation that runs off, from precipitation and potential evaporation in the same units. */
export function runoffFraction(precipitation: number, potentialEvaporation: number): number {
  if (precipitation <= 0) return 0;
  const phi = Math.max(0, potentialEvaporation) / precipitation;
  return Math.max(0, Math.min(1, (1 + phi ** BUDYKO_OMEGA) ** (1 / BUDYKO_OMEGA) - phi));
}
/** Potential evaporation of a lake at the equator, mm per year. */
export const EVAPORATION_EQUATOR_MM = 2000;
/** Potential evaporation never falls below this fraction of the equatorial value. */
export const EVAPORATION_FLOOR = 0.15;

/** Zonal profile, piecewise linear in absolute latitude (radians). */
export function zonalPrecipitation(lat: number): number {
  const a = Math.abs(lat) / DEG;
  for (let i = 1; i < ZONAL_PROFILE.length; i++) {
    const [a1, p1] = ZONAL_PROFILE[i];
    if (a <= a1) {
      const [a0, p0] = ZONAL_PROFILE[i - 1];
      return p0 + ((p1 - p0) * (a - a0)) / (a1 - a0);
    }
  }
  return ZONAL_PROFILE[ZONAL_PROFILE.length - 1][1];
}

/** Potential evaporation from open water, mm per year; a cosine of latitude stands in for temperature until M4. */
export function potentialEvaporation(lat: number): number {
  return EVAPORATION_EQUATOR_MM * Math.max(EVAPORATION_FLOOR, Math.cos(lat));
}

/** Hop distance from every cell to the nearest ocean cell (0 on the ocean). */
export function oceanDistance(grid: Grid, elevation: Float64Array, seaLevel: number, out: Int32Array, queue: Int32Array): void {
  const n = grid.n;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (elevation[i] < seaLevel) {
      out[i] = 0;
      queue[tail++] = i;
    } else {
      out[i] = -1;
    }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const d = out[i] + 1;
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const nb = grid.nb[t];
      if (out[nb] < 0) {
        out[nb] = d;
        queue[tail++] = nb;
      }
    }
  }
  // A planet with no ocean at all: every cell is "far from the sea".
  for (let i = 0; i < n; i++) if (out[i] < 0) out[i] = 99;
}

/** Proxy precipitation per cell in mm per year; ocean cells get the zonal value. */
export function proxyPrecipitation(grid: Grid, distance: Int32Array, out: Float64Array): void {
  for (let i = 0; i < grid.n; i++) {
    const zonal = zonalPrecipitation(grid.lat[i]);
    const proximity = INTERIOR_FLOOR + (1 - INTERIOR_FLOOR) * Math.exp(-distance[i] / OCEAN_DECAY_CELLS);
    out[i] = zonal * proximity;
  }
}
