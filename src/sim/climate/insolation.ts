import { DEG } from '../grid/geometry.ts';

/** Solar constant at Earth's orbit, W/m^2 (Kopp and Lean 2011). */
export const SOLAR_CONSTANT = 1361;
/** Samples per year (DESIGN 3.5: 12 declination samples with thermal inertia). */
export const SAMPLES = 12;
/** Index used by layers and the inspector for the annual mean instead of a sample. */
export const ANNUAL = SAMPLES;

/**
 * Solar declination (radians) of each sample. Sample 0 is mid-January-like
 * (southern summer), sample 6 the opposite; equinoxes fall between samples 2
 * and 3 and between 8 and 9. The orbit is circular: no eccentricity term.
 */
export function declinations(tiltDeg: number): Float64Array {
  const out = new Float64Array(SAMPLES);
  for (let s = 0; s < SAMPLES; s++) out[s] = -tiltDeg * DEG * Math.cos((2 * Math.PI * (s + 0.5)) / SAMPLES);
  return out;
}

/**
 * Flux factor of each sample for an eccentric orbit, mean 1 over the year:
 * (1 + e cos(mean anomaly))^2 with perihelion at sample 0 (January-like,
 * southern summer, as on Earth today), so the hemispheres get unequal
 * seasons. The mean anomaly stands in for the true anomaly, fine for the
 * eccentricities allowed.
 */
export function orbitalFactors(eccentricity: number): Float64Array {
  const out = new Float64Array(SAMPLES);
  const mean = 1 + (eccentricity * eccentricity) / 2;
  for (let s = 0; s < SAMPLES; s++) {
    const f = 1 + eccentricity * Math.cos((2 * Math.PI * (s + 0.5)) / SAMPLES);
    out[s] = (f * f) / mean;
  }
  return out;
}

/**
 * Daily-mean insolation at the top of the atmosphere for a latitude and a
 * declination, W/m^2: the standard integral over the day with the sunrise
 * hour angle h0, handling polar day (h0 = pi) and polar night (zero).
 */
export function dailyMeanInsolation(lat: number, declination: number, s0: number): number {
  const x = -Math.tan(lat) * Math.tan(declination);
  let h0: number;
  if (x <= -1) h0 = Math.PI;
  else if (x >= 1) return 0;
  else h0 = Math.acos(x);
  const q = (s0 / Math.PI) * (h0 * Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.sin(h0));
  return q > 0 ? q : 0;
}

/**
 * Hours of daylight for a latitude and a declination, in hours of a 24-hour
 * day (24 h0 / pi): 24 in the polar day, 0 in the polar night. Earth hours
 * whatever the planet's rotation, so sunshine totals compare with Earth's
 * climatologies.
 */
export function daylightHours(lat: number, declination: number): number {
  const x = -Math.tan(lat) * Math.tan(declination);
  if (x <= -1) return 24;
  if (x >= 1) return 0;
  return (24 * Math.acos(x)) / Math.PI;
}
