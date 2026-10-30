import type { World } from '../sim/pipeline.ts';
import { cellDebugColor, hypsometric, type RGB } from './colors.ts';
import type { Raster } from './raster.ts';

/** A map layer: a color per cell. Painting to pixels goes through the raster lookup. */
export interface Layer {
  id: string;
  name: string;
  cellColor(world: World, cell: number): RGB;
}

export const LAYERS: Layer[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    cellColor: (world, i) => hypsometric(world.elevation[i] - world.seaLevel),
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
