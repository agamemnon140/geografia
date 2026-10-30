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
import type { Raster } from './raster.ts';

/** What a layer's colors mean, for the legend (DESIGN 8.4). */
export type Legend =
  | { kind: 'ramp'; stops: Stop[]; unit: string }
  | { kind: 'categories'; items: { color: RGB; label: string }[] }
  | { kind: 'text'; items: string[] };

/**
 * A map layer: a color per cell. Painting to pixels goes through a raster
 * lookup (equirectangular map or orthographic globe). Seasonal layers take
 * a sample index (0 to 11) or ANNUAL.
 */
export interface Layer {
  id: string;
  name: string;
  /** True when the layer changes with the sample (month) selector. */
  seasonal?: boolean;
  legend?: Legend;
  cellColor(world: World, cell: number, sample: number): RGB;
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

/** Wind direction as a hue (blowing east = red, north = yellow-green, west = cyan, south = violet), speed as brightness. */
function windColor(u: number, v: number, dim: number): RGB {
  const speed = Math.hypot(u, v);
  const hue = ((Math.atan2(v, u) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  const value = Math.min(1, 0.25 + speed / 10) * dim;
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

/** Standard Koppen-Geiger colors (Peel et al. 2007), indexed like KOPPEN_NAMES. */
export const KOPPEN_COLORS: RGB[] = [
  [30, 50, 90],
  [0, 0, 255], [0, 120, 255], [70, 170, 250],
  [255, 0, 0], [255, 150, 150], [245, 165, 0], [255, 220, 100],
  [255, 255, 0], [200, 200, 0], [150, 150, 0],
  [150, 255, 150], [100, 200, 100], [50, 150, 50],
  [200, 255, 80], [100, 255, 80], [50, 200, 0],
  [255, 0, 255], [200, 0, 200], [150, 50, 150], [150, 100, 150],
  [170, 175, 255], [90, 120, 220], [75, 80, 180], [50, 0, 135],
  [0, 255, 255], [55, 200, 255], [0, 125, 125], [0, 70, 95],
  [178, 178, 178], [102, 102, 102],
];

/** Koppen name of a cell. */
export function koppenName(world: World, cell: number): string {
  return KOPPEN_NAMES[world.koppen[cell]] ?? 'unknown';
}

/** Precipitation of a cell for a sample index or ANNUAL, mm per year. */
export function precipitationAt(world: World, cell: number, sample: number): number {
  return sample >= ANNUAL ? world.precipitation[cell] : world.precipitationSamples[sample * world.n + cell];
}

const LAKE_COLOR: RGB = [40, 120, 210];
const RIVER_COLOR: RGB = [20, 70, 190];
const LAND_WASH: RGB = [240, 236, 226];
/** Discharge at which a river starts to show, km^3 per year (a basin of roughly ten cells). */
const RIVER_MIN_KM3 = 40;
/** Discharge drawn at full strength. */
const RIVER_FULL_KM3 = 4000;

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

export const LAYERS: Layer[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    legend: { kind: 'ramp', stops: ELEVATION_LEGEND, unit: 'm above sea level' },
    cellColor: (world, i) => hypsometric(world.elevation[i] - world.seaLevel),
  },
  {
    id: 'koppen',
    name: 'Koppen climate',
    legend: {
      kind: 'categories',
      items: [
        { color: KOPPEN_COLORS[1], label: 'A tropical (Af, Am, Aw)' },
        { color: KOPPEN_COLORS[4], label: 'B arid (BW desert, BS steppe)' },
        { color: KOPPEN_COLORS[15], label: 'C temperate (Cs, Cw, Cf)' },
        { color: KOPPEN_COLORS[26], label: 'D continental (Ds, Dw, Df)' },
        { color: KOPPEN_COLORS[29], label: 'E polar (ET tundra, EF ice cap)' },
      ],
    },
    cellColor: (world, i) => {
      if (world.elevation[i] < world.seaLevel) return hypsometric(world.elevation[i] - world.seaLevel);
      return KOPPEN_COLORS[world.koppen[i]] ?? [0, 0, 0];
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
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel >= 0) return world.iceSheet[i] ? ICE_SHEET : mix(hypsometric(rel), LAND_WASH, 0.3);
      const months = world.seaIceMonths[i];
      if (months === 0) return hypsometric(rel);
      return mix(hypsometric(rel), SEA_ICE, 0.35 + 0.65 * (months / SAMPLES));
    },
  },
  {
    id: 'rivers',
    name: 'Rivers and lakes',
    legend: {
      kind: 'categories',
      items: [
        { color: LAKE_COLOR, label: 'lake' },
        { color: mix(LAND_WASH, RIVER_COLOR, 0.4), label: `river from ${RIVER_MIN_KM3} km³/yr` },
        { color: RIVER_COLOR, label: `river at ${RIVER_FULL_KM3} km³/yr and above` },
      ],
    },
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
  },
  {
    id: 'wind',
    name: 'Surface wind (hue = direction)',
    seasonal: true,
    legend: { kind: 'text', items: DIRECTION_LEGEND.concat('brightness: speed, full at 10 m/s') },
    cellColor: (world, i, sample) => {
      const [u, v] = windAt(world, i, sample);
      return windColor(u, v, world.elevation[i] >= world.seaLevel ? 1 : 0.7);
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
  },
  {
    id: 'currents',
    name: 'Ocean currents (hue = direction)',
    legend: { kind: 'text', items: DIRECTION_LEGEND.concat('brightness: speed, full at 0.5 m/s') },
    cellColor: (world, i) => {
      if (world.basin[i] < 0) return [70, 70, 70];
      const u = world.currentU[i];
      const v = world.currentV[i];
      const speed = Math.hypot(u, v);
      const hue = ((Math.atan2(v, u) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
      return hsvColor(hue, 0.85, Math.min(1, 0.2 + speed / 0.6));
    },
  },
  {
    id: 'sstAnomaly',
    name: 'Current heat transport',
    legend: { kind: 'ramp', stops: ANOMALY_RAMP, unit: '°C carried by currents' },
    cellColor: (world, i) => {
      const c = ramp(ANOMALY_RAMP, world.sstAnomaly[i]);
      if (world.basin[i] >= 0) return c;
      return [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];
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
      const [r, g, bl] = plateColor(world.plate[i]);
      const land = world.elevation[i] >= world.seaLevel;
      const k = land ? 1 : 0.55;
      return [r * k, g * k, bl * k];
    },
  },
  {
    id: 'crustAge',
    name: 'Crust age (oceanic)',
    legend: { kind: 'ramp', stops: AGE_RAMP, unit: 'steps since the sea floor formed (continents gray)' },
    cellColor: (world, i) => (world.crustType[i] === 1 ? [110, 110, 110] : ramp(AGE_RAMP, world.crustAge[i])),
  },
  {
    id: 'thickness',
    name: 'Crust thickness',
    legend: { kind: 'ramp', stops: THICKNESS_RAMP, unit: 'km' },
    cellColor: (world, i) => ramp(THICKNESS_RAMP, world.thickness[i]),
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

/** The layer's color of every cell, 3 bytes per cell. */
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
 * pixel, which is how the globe gets its lighting.
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

/** Fill an RGBA buffer (4 bytes per pixel, raster-sized) with the layer's colors. */
export function paintLayer(world: World, raster: Raster, layer: Layer, out: Uint8ClampedArray, sample = ANNUAL): void {
  paintCells(cellColors(world, layer, sample), raster.cell, out);
}
