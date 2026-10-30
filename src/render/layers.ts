import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { KOPPEN_NAMES } from '../sim/climate/koppen.ts';
import type { World } from '../sim/pipeline.ts';
import {
  BOUNDARY_CONVERGENT,
  BOUNDARY_DIVERGENT,
  BOUNDARY_SUBDUCTING,
  BOUNDARY_TRANSFORM,
} from '../sim/tectonics/simulation.ts';
import { cellDebugColor, hypsometric, mix, ramp, type RGB, type Stop } from './colors.ts';
import type { PixelSampler } from './paint.ts';
import type { Raster } from './raster.ts';

/** What a layer's colors mean, for the legend (DESIGN 8.4). */
export type Legend =
  | { kind: 'ramp'; stops: Stop[]; unit: string }
  /** One swatch per item, or a row of swatches (`colors`) for a family of shades. */
  | { kind: 'categories'; items: { color: RGB; colors?: RGB[]; label: string }[] }
  | { kind: 'text'; items: string[] };

/**
 * A map layer. `cellColor` is the flat color of a cell (thumbnails, tests,
 * fallback); `smooth` colors a pixel from interpolated fields (DESIGN 8.5)
 * and is what the map and the globe use. `relief` asks for a hillshade,
 * `rivers` for the drainage network drawn as lines. Seasonal layers take a
 * sample index (0 to 11) or ANNUAL.
 */
export interface Layer {
  id: string;
  name: string;
  /** True when the layer changes with the sample (month) selector. */
  seasonal?: boolean;
  legend?: Legend;
  relief?: boolean | 'light';
  rivers?: boolean;
  cellColor(world: World, cell: number, sample: number): RGB;
  smooth?(world: World, px: PixelSampler, sample: number): RGB;
}

/** Pixels whose raster entry is -1 (outside the globe) get this. */
const BACKGROUND: RGB = [20, 22, 26];

const TEMPERATURE_RAMP: Stop[] = [
  [-40, [60, 0, 90]],
  [-20, [50, 60, 190]],
  [-5, [90, 170, 230]],
  [5, [170, 225, 200]],
  [15, [200, 220, 90]],
  [25, [240, 150, 50]],
  [35, [200, 40, 30]],
  [45, [120, 0, 20]],
];

/** Temperature of a cell for a sample index or ANNUAL. */
export function temperatureAt(world: World, cell: number, sample: number): number {
  return sample >= ANNUAL ? world.temperatureAnnual[cell] : world.temperature[sample * world.n + cell];
}

/** Wind of a cell (east, north, m/s) for a sample index; ANNUAL averages the samples. */
export function windAt(world: World, cell: number, sample: number): [number, number] {
  if (sample < ANNUAL) return [world.windU[sample * world.n + cell], world.windV[sample * world.n + cell]];
  let u = 0;
  let v = 0;
  for (let s = 0; s < ANNUAL; s++) {
    u += world.windU[s * world.n + cell];
    v += world.windV[s * world.n + cell];
  }
  return [u / ANNUAL, v / ANNUAL];
}

/** Interpolated wind at a pixel; ANNUAL averages the samples. */
function windSmooth(world: World, px: PixelSampler, sample: number): [number, number] {
  if (sample < ANNUAL) {
    const base = sample * world.n;
    return [px.interp(world.windU.subarray(base, base + world.n)), px.interp(world.windV.subarray(base, base + world.n))];
  }
  let u = 0;
  let v = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const base = s * world.n;
    u += px.interp(world.windU.subarray(base, base + world.n));
    v += px.interp(world.windV.subarray(base, base + world.n));
  }
  return [u / SAMPLES, v / SAMPLES];
}

/** Flow direction as a hue (toward east = red, north = yellow-green, west = cyan, south = violet), speed as brightness. */
function directionColor(u: number, v: number, fullSpeed: number, dim: number): RGB {
  const speed = Math.hypot(u, v);
  const hue = ((Math.atan2(v, u) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  const value = Math.min(1, 0.25 + speed / fullSpeed) * dim;
  return hsvColor(hue, 0.85, value);
}

function hsvColor(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}

const BOUNDARY_COLORS: Record<number, RGB> = {
  [BOUNDARY_DIVERGENT]: [255, 70, 70],
  [BOUNDARY_CONVERGENT]: [30, 30, 30],
  [BOUNDARY_SUBDUCTING]: [255, 210, 0],
  [BOUNDARY_TRANSFORM]: [90, 255, 140],
};

const AGE_RAMP: Stop[] = [
  [0, [255, 245, 150]],
  [30, [255, 170, 60]],
  [70, [200, 70, 60]],
  [110, [120, 30, 90]],
  [150, [40, 10, 60]],
];

const THICKNESS_RAMP: Stop[] = [
  [5, [30, 40, 90]],
  [20, [70, 110, 150]],
  [35, [110, 160, 110]],
  [50, [220, 180, 90]],
  [70, [255, 255, 255]],
];

const PRECIPITATION_RAMP: Stop[] = [
  [0, [245, 235, 200]],
  [250, [225, 205, 140]],
  [500, [180, 200, 120]],
  [1000, [90, 170, 110]],
  [1500, [40, 130, 140]],
  [2200, [20, 70, 130]],
  [3500, [40, 20, 90]],
];

const ANOMALY_RAMP: Stop[] = [
  [-8, [20, 40, 160]],
  [-3, [90, 150, 220]],
  [0, [235, 235, 235]],
  [3, [240, 140, 90]],
  [8, [170, 20, 30]],
];

const ICE_SHEET: RGB = [245, 248, 255];
const SEA_ICE: RGB = [215, 232, 245];

/**
 * Koppen colors by family, indexed like KOPPEN_NAMES: one hue per main
 * group (A deep forest greens, B reds and oranges, C yellow-greens and
 * olives, D purples, E grays), the second and third letters as lightness
 * steps, lighter when drier or colder. Blue is kept for water. The
 * textbook palette of Peel et al. (2007) spreads thirty saturated hues
 * that blur at this scale; here a glance gives the group and the legend or
 * the inspector gives the subtype.
 */
export const KOPPEN_COLORS: RGB[] = [
  [70, 82, 100],
  [0, 88, 40], [20, 130, 60], [75, 168, 85],
  [215, 45, 35], [235, 135, 120], [235, 145, 35], [245, 205, 120],
  [175, 168, 40], [200, 195, 85], [222, 218, 140],
  [120, 160, 35], [155, 185, 70], [190, 210, 120],
  [140, 180, 55], [170, 200, 90], [200, 220, 135],
  [140, 55, 150], [165, 95, 175], [190, 135, 200], [215, 175, 225],
  [105, 50, 165], [135, 90, 195], [165, 130, 215], [195, 170, 235],
  [75, 45, 145], [105, 85, 175], [140, 125, 200], [175, 165, 225],
  [185, 185, 185], [240, 240, 245],
];

/** The sea on the Koppen layer: bathymetry pulled toward slate, so the land carries the color. */
const KOPPEN_SEA: RGB = [88, 98, 114];

function koppenSea(rel: number): RGB {
  return mix(hypsometric(rel), KOPPEN_SEA, 0.6);
}

/** Koppen name of a cell. */
export function koppenName(world: World, cell: number): string {
  return KOPPEN_NAMES[world.koppen[cell]] ?? 'unknown';
}

/** Precipitation of a cell for a sample index or ANNUAL, mm per year. */
export function precipitationAt(world: World, cell: number, sample: number): number {
  return sample >= ANNUAL ? world.precipitation[cell] : world.precipitationSamples[sample * world.n + cell];
}

const LAKE_COLOR: RGB = [40, 120, 210];
export const RIVER_COLOR: RGB = [20, 70, 190];
const LAND_WASH: RGB = [240, 236, 226];
/** Discharge at which a river starts to show, km^3 per year (a basin of roughly ten cells). */
export const RIVER_MIN_KM3 = 40;
/** Discharge drawn at full strength in the flat cell painter. */
const RIVER_FULL_KM3 = 4000;
/** Interpolated lake depth above which a pixel is lake water, meters. */
const LAKE_DEPTH_M = 0.5;

function plateColor(plate: number): RGB {
  return cellDebugColor(plate * 17 + 3);
}

/** Elevation legend: bathymetry below zero, hypsometric tints above (the same stops the painter uses). */
const ELEVATION_LEGEND: Stop[] = [
  [-6000, hypsometric(-6000)],
  [-3000, hypsometric(-3000)],
  [-1000, hypsometric(-1000)],
  [0, hypsometric(0)],
  [500, hypsometric(500)],
  [1500, hypsometric(1500)],
  [3000, hypsometric(3000)],
  [5000, hypsometric(5000)],
];

const DIRECTION_LEGEND = [
  'hue is the direction the flow goes to:',
  'red east, yellow-green north, cyan west, violet south',
];

/** Interpolated elevation relative to the sea at a pixel. */
function relief(world: World, px: PixelSampler): number {
  return px.interp(world.elevation) - world.seaLevel;
}

function dim(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export const LAYERS: Layer[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    legend: { kind: 'ramp', stops: ELEVATION_LEGEND, unit: 'm above sea level' },
    relief: true,
    rivers: true,
    cellColor: (world, i) => hypsometric(world.elevation[i] - world.seaLevel),
    smooth: (world, px) => hypsometric(relief(world, px)),
  },
  {
    id: 'koppen',
    name: 'Koppen climate',
    legend: {
      kind: 'categories',
      items: [
        { color: KOPPEN_COLORS[2], colors: KOPPEN_COLORS.slice(1, 4), label: 'Tropical, hot all year (deep greens): rainforest, monsoon, savanna with a dry season' },
        { color: KOPPEN_COLORS[4], colors: KOPPEN_COLORS.slice(4, 8), label: 'Dry (reds and oranges): hot desert, cold desert, hot steppe, cold steppe' },
        { color: KOPPEN_COLORS[14], colors: [KOPPEN_COLORS[8], KOPPEN_COLORS[11], KOPPEN_COLORS[14], KOPPEN_COLORS[16]], label: 'Mild winters (yellow-greens): dry-summer Mediterranean, dry-winter, rainy all year; paler where summers are cool' },
        { color: KOPPEN_COLORS[26], colors: [KOPPEN_COLORS[17], KOPPEN_COLORS[21], KOPPEN_COLORS[25], KOPPEN_COLORS[28]], label: 'Cold winters, real summers (purples): forests of the north; paler where winters are harsher' },
        { color: KOPPEN_COLORS[29], colors: [KOPPEN_COLORS[29], KOPPEN_COLORS[30]], label: 'Polar: tundra (gray, no month above 10 °C), ice cap (white, never above freezing)' },
        { color: KOPPEN_SEA, label: 'Sea (blue is kept for water)' },
      ],
    },
    relief: 'light',
    cellColor: (world, i) => {
      if (world.elevation[i] < world.seaLevel) return koppenSea(world.elevation[i] - world.seaLevel);
      return KOPPEN_COLORS[world.koppen[i]] ?? [0, 0, 0];
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel < 0) return koppenSea(rel);
      return KOPPEN_COLORS[world.koppen[px.cell]] ?? [0, 0, 0];
    },
  },
  {
    id: 'ice',
    name: 'Ice',
    legend: {
      kind: 'categories',
      items: [
        { color: ICE_SHEET, label: 'ice sheet' },
        { color: SEA_ICE, label: 'sea ice all year' },
        { color: mix([36, 86, 160], SEA_ICE, 0.5), label: 'seasonal sea ice (paler with more months)' },
      ],
    },
    relief: 'light',
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel >= 0) return world.iceSheet[i] ? ICE_SHEET : mix(hypsometric(rel), LAND_WASH, 0.3);
      const months = world.seaIceMonths[i];
      if (months === 0) return hypsometric(rel);
      return mix(hypsometric(rel), SEA_ICE, 0.35 + 0.65 * (months / SAMPLES));
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel >= 0) return world.iceSheet[px.cell] ? ICE_SHEET : mix(hypsometric(rel), LAND_WASH, 0.3);
      const months = px.interp(world.seaIceMonths);
      if (months < 0.25) return hypsometric(rel);
      return mix(hypsometric(rel), SEA_ICE, 0.35 + 0.65 * Math.min(1, months / SAMPLES));
    },
  },
  {
    id: 'rivers',
    name: 'Rivers and lakes',
    legend: {
      kind: 'categories',
      items: [
        { color: LAKE_COLOR, label: 'lake' },
        { color: RIVER_COLOR, label: `river, from ${RIVER_MIN_KM3} km³/yr; wider with discharge` },
      ],
    },
    relief: 'light',
    rivers: true,
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel < 0) return hypsometric(rel);
      if (world.lake[i] >= 0) return LAKE_COLOR;
      const land = mix(hypsometric(rel), LAND_WASH, 0.45);
      const q = world.discharge[i];
      if (q < RIVER_MIN_KM3) return land;
      const t = Math.min(1, Math.log(q / RIVER_MIN_KM3) / Math.log(RIVER_FULL_KM3 / RIVER_MIN_KM3));
      return mix(land, RIVER_COLOR, 0.4 + 0.6 * t);
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel < 0) return hypsometric(rel);
      if (px.interp(world.waterLevel) - px.interp(world.elevation) > LAKE_DEPTH_M) return LAKE_COLOR;
      return mix(hypsometric(rel), LAND_WASH, 0.45);
    },
  },
  {
    id: 'temperature',
    name: 'Temperature',
    seasonal: true,
    legend: { kind: 'ramp', stops: TEMPERATURE_RAMP, unit: '°C' },
    cellColor: (world, i, sample) => {
      const c = ramp(TEMPERATURE_RAMP, temperatureAt(world, i, sample));
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.75, c[1] * 0.75, c[2] * 0.8];
    },
    smooth: (world, px, sample) => {
      const c = ramp(TEMPERATURE_RAMP, px.interpSeasonal(world.temperature, world.temperatureAnnual, world.n, sample));
      return relief(world, px) >= 0 ? c : [c[0] * 0.75, c[1] * 0.75, c[2] * 0.8];
    },
  },
  {
    id: 'wind',
    name: 'Surface wind (hue = direction)',
    seasonal: true,
    legend: { kind: 'text', items: DIRECTION_LEGEND.concat('brightness: speed, full at 10 m/s') },
    cellColor: (world, i, sample) => {
      const [u, v] = windAt(world, i, sample);
      return directionColor(u, v, 10, world.elevation[i] >= world.seaLevel ? 1 : 0.7);
    },
    smooth: (world, px, sample) => {
      const [u, v] = windSmooth(world, px, sample);
      return directionColor(u, v, 10, relief(world, px) >= 0 ? 1 : 0.7);
    },
  },
  {
    id: 'precipitation',
    name: 'Precipitation',
    seasonal: true,
    legend: { kind: 'ramp', stops: PRECIPITATION_RAMP, unit: 'mm/yr' },
    cellColor: (world, i, sample) => {
      const c = ramp(PRECIPITATION_RAMP, precipitationAt(world, i, sample));
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
    smooth: (world, px, sample) => {
      const c = ramp(PRECIPITATION_RAMP, px.interpSeasonal(world.precipitationSamples, world.precipitation, world.n, sample));
      return relief(world, px) >= 0 ? c : [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
  },
  {
    id: 'currents',
    name: 'Ocean currents (hue = direction)',
    legend: { kind: 'text', items: DIRECTION_LEGEND.concat('brightness: speed, full at 0.5 m/s') },
    cellColor: (world, i) => {
      if (world.basin[i] < 0) return [70, 70, 70];
      return directionColor(world.currentU[i], world.currentV[i], 0.5, 1);
    },
    smooth: (world, px) => {
      if (relief(world, px) >= 0) return [70, 70, 70];
      return directionColor(px.interp(world.currentU), px.interp(world.currentV), 0.5, 1);
    },
  },
  {
    id: 'sstAnomaly',
    name: 'Current heat transport',
    legend: { kind: 'ramp', stops: ANOMALY_RAMP, unit: '°C carried by currents' },
    cellColor: (world, i) => {
      const c = ramp(ANOMALY_RAMP, world.sstAnomaly[i]);
      return world.basin[i] >= 0 ? c : dim(c, 0.6);
    },
    smooth: (world, px) => {
      const c = ramp(ANOMALY_RAMP, px.interp(world.sstAnomaly));
      return relief(world, px) < 0 ? c : dim(c, 0.6);
    },
  },
  {
    id: 'plates',
    name: 'Plates and boundaries',
    legend: {
      kind: 'categories',
      items: [
        { color: BOUNDARY_COLORS[BOUNDARY_DIVERGENT], label: 'divergent (ridge, rift)' },
        { color: BOUNDARY_COLORS[BOUNDARY_CONVERGENT], label: 'convergent, overriding side' },
        { color: BOUNDARY_COLORS[BOUNDARY_SUBDUCTING], label: 'convergent, subducting side (trench)' },
        { color: BOUNDARY_COLORS[BOUNDARY_TRANSFORM], label: 'transform' },
        { color: plateColor(3), label: 'one color per plate, darker under the sea' },
      ],
    },
    cellColor: (world, i) => {
      const b = world.boundary[i];
      if (b !== 0) return BOUNDARY_COLORS[b];
      return dim(plateColor(world.plate[i]), world.elevation[i] >= world.seaLevel ? 1 : 0.55);
    },
    smooth: (world, px) => {
      const b = world.boundary[px.cell];
      if (b !== 0) return BOUNDARY_COLORS[b];
      return dim(plateColor(world.plate[px.cell]), relief(world, px) >= 0 ? 1 : 0.55);
    },
  },
  {
    id: 'crustAge',
    name: 'Crust age (oceanic)',
    legend: { kind: 'ramp', stops: AGE_RAMP, unit: 'steps since the sea floor formed (continents gray)' },
    cellColor: (world, i) => (world.crustType[i] === 1 ? [110, 110, 110] : ramp(AGE_RAMP, world.crustAge[i])),
    smooth: (world, px) => (world.crustType[px.cell] === 1 ? [110, 110, 110] : ramp(AGE_RAMP, px.interp(world.crustAge))),
  },
  {
    id: 'thickness',
    name: 'Crust thickness',
    legend: { kind: 'ramp', stops: THICKNESS_RAMP, unit: 'km' },
    cellColor: (world, i) => ramp(THICKNESS_RAMP, world.thickness[i]),
    smooth: (world, px) => ramp(THICKNESS_RAMP, px.interp(world.thickness)),
  },
  {
    id: 'cells',
    name: 'Grid cells (debug)',
    cellColor: (_world, i) => cellDebugColor(i),
  },
];

export function layerById(id: string): Layer {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
}

/** The layer's flat color of every cell, 3 bytes per cell. */
export function cellColors(world: World, layer: Layer, sample = ANNUAL): Uint8ClampedArray {
  const n = world.n;
  const colors = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = layer.cellColor(world, i, sample);
    colors[3 * i] = r;
    colors[3 * i + 1] = g;
    colors[3 * i + 2] = b;
  }
  return colors;
}

/**
 * Fill an RGBA buffer from per-cell colors and a pixel-to-cell lookup; -1
 * entries get the background, and an optional shade (0 to 1) darkens each
 * pixel. This is the flat painter: thumbnails and the globe while it turns.
 */
export function paintCells(colors: Uint8ClampedArray, cells: Int32Array, out: Uint8ClampedArray, shade: Float32Array | null = null): void {
  for (let p = 0; p < cells.length; p++) {
    const o = p * 4;
    const i = cells[p];
    if (i < 0) {
      out[o] = BACKGROUND[0];
      out[o + 1] = BACKGROUND[1];
      out[o + 2] = BACKGROUND[2];
      out[o + 3] = 255;
      continue;
    }
    const c = i * 3;
    const k = shade ? shade[p] : 1;
    out[o] = colors[c] * k;
    out[o + 1] = colors[c + 1] * k;
    out[o + 2] = colors[c + 2] * k;
    out[o + 3] = 255;
  }
}

/** Flat paint of a layer through a raster (one color per cell). */
export function paintLayer(world: World, raster: Raster, layer: Layer, out: Uint8ClampedArray, sample = ANNUAL): void {
  paintCells(cellColors(world, layer, sample), raster.cell, out);
}
