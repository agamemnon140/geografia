import type { FloatArray } from './types.ts';

/**
 * Sea level from the water budget (DESIGN 3.3): the sea level is the elevation
 * at which the volume of the basins below it equals the planet's water volume.
 * Elevations are in meters, areas in km^2, volumes in km^3.
 */

/** Volume of water held below `level` by every cell, in km^3. */
export function waterVolumeBelow(elevation: FloatArray, areaKm2: Float64Array, level: number): number {
  let sum = 0;
  for (let i = 0; i < elevation.length; i++) {
    const depth = level - elevation[i];
    if (depth > 0) sum += areaKm2[i] * depth;
  }
  return sum / 1000;
}

/** Sea level in meters for a given water volume, by bisection on the monotonic volume function. */
export function solveSeaLevel(elevation: FloatArray, areaKm2: Float64Array, volumeKm3: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let total = 0;
  for (let i = 0; i < elevation.length; i++) {
    const e = elevation[i];
    if (e < lo) lo = e;
    if (e > hi) hi = e;
    total += areaKm2[i];
  }
  if (!(volumeKm3 > 0)) return lo;
  const full = waterVolumeBelow(elevation, areaKm2, hi);
  if (volumeKm3 >= full) return hi + ((volumeKm3 - full) * 1000) / total;
  for (let iter = 0; iter < 100; iter++) {
    const mid = 0.5 * (lo + hi);
    if (waterVolumeBelow(elevation, areaKm2, mid) < volumeKm3) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Sea level at which the ocean covers the given fraction of the surface
 * (the area-weighted quantile of elevation), by bisection. Used when the
 * ocean cover is a parameter and the water volume follows from it.
 */
export function solveSeaLevelForFraction(elevation: FloatArray, areaKm2: Float64Array, fraction: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let total = 0;
  for (let i = 0; i < elevation.length; i++) {
    const e = elevation[i];
    if (e < lo) lo = e;
    if (e > hi) hi = e;
    total += areaKm2[i];
  }
  if (fraction <= 0) return lo;
  if (fraction >= 1) return hi + 1;
  const target = fraction * total;
  for (let iter = 0; iter < 100; iter++) {
    const mid = 0.5 * (lo + hi);
    let below = 0;
    for (let i = 0; i < elevation.length; i++) if (elevation[i] < mid) below += areaKm2[i];
    if (below < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return 0.5 * (lo + hi);
}

/** Fraction of the surface area below sea level. */
export function oceanFraction(elevation: FloatArray, areaKm2: Float64Array, seaLevel: number): number {
  let ocean = 0;
  let total = 0;
  for (let i = 0; i < elevation.length; i++) {
    total += areaKm2[i];
    if (elevation[i] < seaLevel) ocean += areaKm2[i];
  }
  return ocean / total;
}
