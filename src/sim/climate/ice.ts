import type { Grid } from '../grid/grid.ts';
import { ALBEDO_ICE, ALBEDO_LAND, ALBEDO_OCEAN } from './ebm.ts';
import { SAMPLES } from './insolation.ts';
import type { TemperatureFields } from './temperature.ts';

/**
 * Ice (DESIGN 3.5 step 6). Sea ice forms in any sample whose sea-surface
 * temperature is below the freezing point of sea water; an ice sheet covers
 * land whose warmest sample stays below zero, altitude included. Ice is
 * bright: the climate feeds the albedo of this extent back into the energy
 * balance and iterates. Ice sheets lock water away from the ocean; the
 * pipeline turns their volume into a lower sea level, so a cold planet also
 * has a lower coastline.
 */

/** Freezing point of sea water, degrees C. */
export const SEA_ICE_C = -1.8;
/** Land whose warmest sample is below this never melts. */
export const ICE_SHEET_C = 0;
/** Mean thickness of an ice sheet, km (Antarctica 2.2, Greenland 1.7); sets how much ocean it locks away. */
export const ICE_SHEET_THICKNESS_KM = 2;

export interface IceFields {
  /** Samples per year with sea ice on an ocean cell, 0 to 12; 0 on land. */
  seaIceMonths: Uint8Array;
  /** 1 where an ice sheet covers the land. */
  iceSheet: Uint8Array;
  /** Water locked in ice sheets, km^3. */
  iceVolumeKm3: number;
}

/**
 * Ice extent from the temperature samples. `marginC` raises both thresholds;
 * the climate uses it for its first pass (a cold start), because ice keeps
 * itself once present and a bare-ground first guess would never let it form.
 */
export function classifyIce(
  grid: Grid,
  temperature: TemperatureFields,
  elevation: Float64Array,
  seaLevel: number,
  areaKm2: Float64Array,
  marginC = 0,
): IceFields {
  const n = grid.n;
  const seaIceMonths = new Uint8Array(n);
  const iceSheet = new Uint8Array(n);
  let volume = 0;
  for (let i = 0; i < n; i++) {
    let warmest = -Infinity;
    let frozen = 0;
    for (let s = 0; s < SAMPLES; s++) {
      const t = temperature.samples[s * n + i];
      if (t > warmest) warmest = t;
      if (t < SEA_ICE_C + marginC) frozen++;
    }
    if (elevation[i] < seaLevel) {
      seaIceMonths[i] = frozen;
    } else if (warmest < ICE_SHEET_C + marginC) {
      iceSheet[i] = 1;
      volume += areaKm2[i] * ICE_SHEET_THICKNESS_KM;
    }
  }
  return { seaIceMonths, iceSheet, iceVolumeKm3: volume };
}

/** Planetary albedo per cell for an ice extent (null: no ice yet); sea ice counts by its share of the year. */
export function surfaceAlbedo(grid: Grid, elevation: Float64Array, seaLevel: number, ice: IceFields | null, out: Float64Array): void {
  for (let i = 0; i < grid.n; i++) {
    if (elevation[i] < seaLevel) {
      const share = ice ? ice.seaIceMonths[i] / SAMPLES : 0;
      out[i] = ALBEDO_OCEAN + (ALBEDO_ICE - ALBEDO_OCEAN) * share;
    } else {
      out[i] = ice && ice.iceSheet[i] ? ALBEDO_ICE : ALBEDO_LAND;
    }
  }
}
