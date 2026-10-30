import { ANNUAL } from '../sim/climate/insolation.ts';
import type { World } from '../sim/pipeline.ts';
import {
  BOUNDARY_CONVERGENT,
  BOUNDARY_DIVERGENT,
  BOUNDARY_SUBDUCTING,
  BOUNDARY_TRANSFORM,
} from '../sim/tectonics/simulation.ts';
import { cellDebugColor, hypsometric, mix, ramp, type RGB, type Stop } from './colors.ts';
import type { Raster } from './raster.ts';

/**
 * A map layer: a color per cell. Painting to pixels goes through the raster
 * lookup. Seasonal layers take a sample index (0 to 11) or ANNUAL.
 */
export interface Layer {
  id: string;
  name: string;
  /** True when the layer changes with the sample (month) selector. */
  seasonal?: boolean;
  cellColor(world: World, cell: number, sample: number): RGB;
}

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
];

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

export const LAYERS: Layer[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    cellColor: (world, i) => hypsometric(world.elevation[i] - world.seaLevel),
  },
  {
    id: 'rivers',
    name: 'Rivers and lakes',
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
    cellColor: (world, i, sample) => {
      const [u, v] = windAt(world, i, sample);
      return windColor(u, v, world.elevation[i] >= world.seaLevel ? 1 : 0.7);
    },
  },
  {
    id: 'precipitation',
    name: 'Precipitation (proxy)',
    cellColor: (world, i) => {
      const c = ramp(PRECIPITATION_RAMP, world.precipitation[i]);
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
  },
  {
    id: 'plates',
    name: 'Plates and boundaries',
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
    cellColor: (world, i) => (world.crustType[i] === 1 ? [110, 110, 110] : ramp(AGE_RAMP, world.crustAge[i])),
  },
  {
    id: 'thickness',
    name: 'Crust thickness',
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

/** Fill an RGBA buffer (4 bytes per pixel, raster-sized) with the layer's colors. */
export function paintLayer(world: World, raster: Raster, layer: Layer, out: Uint8ClampedArray, sample = ANNUAL): void {
  const n = world.n;
  const colors = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = layer.cellColor(world, i, sample);
    colors[3 * i] = r;
    colors[3 * i + 1] = g;
    colors[3 * i + 2] = b;
  }
  const cell = raster.cell;
  for (let p = 0; p < cell.length; p++) {
    const c = cell[p] * 3;
    const o = p * 4;
    out[o] = colors[c];
    out[o + 1] = colors[c + 1];
    out[o + 2] = colors[c + 2];
    out[o + 3] = 255;
  }
}
