import type { World } from '../sim/pipeline.ts';
import {
  BOUNDARY_CONVERGENT,
  BOUNDARY_DIVERGENT,
  BOUNDARY_SUBDUCTING,
  BOUNDARY_TRANSFORM,
} from '../sim/tectonics/simulation.ts';
import { cellDebugColor, hypsometric, ramp, type RGB, type Stop } from './colors.ts';
import type { Raster } from './raster.ts';

/** A map layer: a color per cell. Painting to pixels goes through the raster lookup. */
export interface Layer {
  id: string;
  name: string;
  cellColor(world: World, cell: number): RGB;
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
export function paintLayer(world: World, raster: Raster, layer: Layer, out: Uint8ClampedArray): void {
  const n = world.n;
  const colors = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = layer.cellColor(world, i);
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
