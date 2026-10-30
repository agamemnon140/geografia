import type { Grid } from '../grid/grid.ts';
import { SAMPLES } from './insolation.ts';
import type { TemperatureFields } from './temperature.ts';

/**
 * Ice (DESIGN 3.5 step 6). Sea ice forms in any sample whose sea-surface
 * temperature is below the freezing point of sea water; an ice sheet covers
 * land whose warmest sample stays below zero, altitude included. Ice is
 * bright: one albedo-feedback pass cools every iced cell and recomputes the
 * extent once. Ice sheets lock water away from the ocean; the pipeline turns
 * their volume into a lower sea level, so a cold planet also has a lower
 * coastline, which is how the glacial-phase parameter reaches the map.
 */

/** Freezing point of sea water, degrees C. */
export const SEA_ICE_C = -1.8;
/** Land whose warmest sample is below this never melts. */
export const ICE_SHEET_C = 0;
/** Cooling of an ice-covered cell from its albedo, degrees C (one feedback pass). */
export const ICE_ALBEDO_COOLING = 4;
/** Mean thickness of an ice sheet, km (Antarctica 2.2, Greenland 1.7); sets how much ocean it locks away. */
export const ICE_SHEET_THICKNESS_KM = 2;
/** Global cooling at the glacial maximum (glacial phase 1), degrees C; Earth's last one was about 6. */
export const GLACIAL_COOLING_C = 6;

export interface IceFields {
  /** Samples per year with sea ice on an ocean cell, 0 to 12; 0 on land. */
  seaIceMonths: Uint8Array;
  /** 1 where an ice sheet covers the land. */
  iceSheet: Uint8Array;
  /** Water locked in ice sheets, km^3. */
  iceVolumeKm3: number;
}

/** Ice extent from the temperature fields; applies the albedo cooling to `temperature` in place. */
export function computeIce(
  grid: Grid,
  temperature: TemperatureFields,
  elevation: Float64Array,
  seaLevel: number,
  areaKm2: Float64Array,
): IceFields {
  const n = grid.n;
  const seaIceMonths = new Uint8Array(n);
  const iceSheet = new Uint8Array(n);
  const iced = new Uint8Array(n);
  classify(n, temperature, elevation, seaLevel, seaIceMonths, iceSheet);
  // Albedo feedback: iced cells (any sea ice, or an ice sheet) cool, then the extent is recomputed once.
  for (let i = 0; i < n; i++) iced[i] = iceSheet[i] || seaIceMonths[i] > 0 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    if (!iced[i]) continue;
    const cooling = ICE_ALBEDO_COOLING * (iceSheet[i] ? 1 : seaIceMonths[i] / SAMPLES);
    temperature.annual[i] -= cooling;
    for (let s = 0; s < SAMPLES; s++) temperature.samples[s * n + i] -= cooling;
  }
  classify(n, temperature, elevation, seaLevel, seaIceMonths, iceSheet);
  let volume = 0;
  for (let i = 0; i < n; i++) if (iceSheet[i]) volume += areaKm2[i] * ICE_SHEET_THICKNESS_KM;
  return { seaIceMonths, iceSheet, iceVolumeKm3: volume };
}

function classify(
  n: number,
  temperature: TemperatureFields,
  elevation: Float64Array,
  seaLevel: number,
  seaIceMonths: Uint8Array,
  iceSheet: Uint8Array,
): void {
  for (let i = 0; i < n; i++) {
    let warmest = -Infinity;
    let frozen = 0;
    for (let s = 0; s < SAMPLES; s++) {
      const t = temperature.samples[s * n + i];
      if (t > warmest) warmest = t;
      if (t < SEA_ICE_C) frozen++;
    }
    if (elevation[i] < seaLevel) {
      seaIceMonths[i] = frozen;
      iceSheet[i] = 0;
    } else {
      seaIceMonths[i] = 0;
      iceSheet[i] = warmest < ICE_SHEET_C ? 1 : 0;
    }
  }
}
