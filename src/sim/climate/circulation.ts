import { EARTH_RADIUS_KM } from '../constants.ts';
import { DEG } from '../grid/geometry.ts';
import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { SAMPLES } from './insolation.ts';
import type { TemperatureFields } from './temperature.ts';

/**
 * Atmospheric circulation (DESIGN 3.5 step 3). The Hadley cell reaches the
 * latitude where angular momentum conservation stops the poleward flow,
 * which scales as 1 / (rotation rate * radius) (Held and Hou 1980). Earth's
 * cell ends near 30 degrees, leaving three cells per hemisphere; a slow
 * rotator has one cell from equator to pole, a fast rotator many bands.
 * Surface winds blow equatorward in even cells and poleward in odd cells,
 * deflected by Coriolis into easterlies and westerlies. The pattern follows
 * the sun with a lag, and a monsoon term blows from cold to warm across the
 * smoothed seasonal temperature anomaly (land-sea contrast).
 */

/** Poleward edge of Earth's Hadley cell, degrees. */
export const HADLEY_EDGE_EARTH_DEG = 30;
/** Most circulation cells per hemisphere the model resolves. */
export const MAX_CELLS = 9;
/** Peak surface wind of a circulation cell, m/s. */
export const SURFACE_WIND_MS = 7;
/** tan(deflection from the meridian) = this times (rotation rate / Earth's) times |sin latitude|; 45 degrees at 30 N on Earth. */
export const CORIOLIS_DEFLECTION = 2;
/** The circulation shifts by this fraction of the (lagged) solar declination; Earth's ITCZ moves about 8 degrees for a 23 degree tilt. */
export const ITCZ_SHIFT_FRACTION = 0.35;
/** Monsoon wind, m/s per degree C of smoothed seasonal anomaly difference between neighboring cells. */
export const MONSOON_GAIN = 2.5;
/** Neighbor-averaging passes applied to the seasonal anomaly before taking its gradient (about a 1000 km scale). */
export const MONSOON_SMOOTHING_PASSES = 6;

export interface CirculationInfo {
  /** Circulation cells per hemisphere. */
  cells: number;
  /** Poleward edge of the Hadley cell, degrees. */
  hadleyEdgeDeg: number;
}

export interface WindFields {
  /** Eastward component per sample, sample-major, m/s. */
  u: Float64Array;
  /** Northward component per sample, sample-major, m/s. */
  v: Float64Array;
}

/** Rotation rate relative to Earth. */
export function relativeRotation(params: PlanetParams): number {
  return 23.93 / params.rotationHours;
}

export function circulationCells(params: PlanetParams): CirculationInfo {
  const scale = relativeRotation(params) * (params.radiusKm / EARTH_RADIUS_KM);
  const hadley = Math.min(90, HADLEY_EDGE_EARTH_DEG / Math.max(scale, 1e-9));
  const cells = Math.max(1, Math.min(MAX_CELLS, Math.round(90 / hadley)));
  return { cells, hadleyEdgeDeg: hadley };
}

/** Unit tangent direction (east, north components) from each cell to each neighbor, CSR-aligned with grid.nb. */
export function tangentDirections(grid: Grid): { east: Float64Array; north: Float64Array } {
  const total = grid.nb.length;
  const east = new Float64Array(total);
  const north = new Float64Array(total);
  const xyz = grid.xyz;
  for (let i = 0; i < grid.n; i++) {
    const lat = grid.lat[i];
    const lon = grid.lon[i];
    const ex = -Math.sin(lon);
    const ey = Math.cos(lon);
    const nx = -Math.sin(lat) * Math.cos(lon);
    const ny = -Math.sin(lat) * Math.sin(lon);
    const nz = Math.cos(lat);
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      const dx = xyz[3 * j] - xyz[3 * i];
      const dy = xyz[3 * j + 1] - xyz[3 * i + 1];
      const dz = xyz[3 * j + 2] - xyz[3 * i + 2];
      const de = dx * ex + dy * ey;
      const dn = dx * nx + dy * ny + dz * nz;
      const len = Math.hypot(de, dn) || 1;
      east[t] = de / len;
      north[t] = dn / len;
    }
  }
  return { east, north };
}

export function computeWinds(
  grid: Grid,
  params: PlanetParams,
  info: CirculationInfo,
  declinations: Float64Array,
  temperature: TemperatureFields,
): WindFields {
  const n = grid.n;
  const u = new Float64Array(SAMPLES * n);
  const v = new Float64Array(SAMPLES * n);
  const omega = relativeRotation(params);
  const bandWidth = 90 / info.cells;
  const { east, north } = tangentDirections(grid);
  const anomaly = new Float64Array(n);
  const smooth = new Float64Array(n);

  for (let s = 0; s < SAMPLES; s++) {
    const lagged = declinations[(s + SAMPLES - 1) % SAMPLES] / DEG;
    const shift = ITCZ_SHIFT_FRACTION * lagged;
    const base = s * n;

    // Smoothed seasonal anomaly for the monsoon term.
    for (let i = 0; i < n; i++) anomaly[i] = temperature.samples[base + i] - temperature.annual[i];
    for (let pass = 0; pass < MONSOON_SMOOTHING_PASSES; pass++) {
      for (let i = 0; i < n; i++) {
        let sum = anomaly[i];
        const s0 = grid.nbStart[i];
        const s1 = grid.nbStart[i + 1];
        for (let t = s0; t < s1; t++) sum += anomaly[grid.nb[t]];
        smooth[i] = sum / (1 + s1 - s0);
      }
      anomaly.set(smooth);
    }

    for (let i = 0; i < n; i++) {
      const latDeg = grid.lat[i] / DEG;
      const phi = latDeg - shift;
      const hs = phi >= 0 ? 1 : -1;
      const a = Math.min(90, Math.abs(phi));
      const k = Math.min(info.cells - 1, Math.floor(a / bandWidth));
      const t = (a - k * bandWidth) / bandWidth;
      const profile = Math.sin(Math.PI * Math.min(1, t));
      const equatorward = k % 2 === 0;
      const vDir = equatorward ? -hs : hs;
      const uDir = equatorward ? -1 : 1;
      const theta = Math.atan(CORIOLIS_DEFLECTION * omega * Math.abs(Math.sin(grid.lat[i])));
      const speed = SURFACE_WIND_MS * profile;
      let ue = speed * Math.sin(theta) * uDir;
      let vn = speed * Math.cos(theta) * vDir;

      // Monsoon: flow from cold toward warm along the anomaly gradient, turned by Coriolis
      // (to the right in the north, to the left in the south) by half the band deflection.
      let ge = 0;
      let gn = 0;
      const s0 = grid.nbStart[i];
      const s1 = grid.nbStart[i + 1];
      for (let tt = s0; tt < s1; tt++) {
        const d = anomaly[grid.nb[tt]] - anomaly[i];
        ge += d * east[tt];
        gn += d * north[tt];
      }
      const scale = (2 / (s1 - s0)) * MONSOON_GAIN;
      ge *= scale;
      gn *= scale;
      const beta = 0.5 * theta * (grid.lat[i] >= 0 ? 1 : -1);
      const cb = Math.cos(beta);
      const sb = Math.sin(beta);
      ue += ge * cb + gn * sb;
      vn += -ge * sb + gn * cb;

      u[base + i] = ue;
      v[base + i] = vn;
    }
  }
  return { u, v };
}
