import type { Grid } from '../sim/grid/grid.ts';
import { nearestCell } from '../sim/grid/locate.ts';
import { locateTriangle } from './interp.ts';

/**
 * Pixel-to-mesh lookup for a projection: the nearest cell under each pixel
 * (-1 outside the drawn area), and the containing mesh triangle with its
 * barycentric weights for smooth interpolation of per-cell fields.
 */
export interface Raster {
  width: number;
  height: number;
  cell: Int32Array;
  /** Three cell ids per pixel. */
  tri: Int32Array;
  /** Three weights per pixel, summing to one. */
  weight: Float32Array;
}

const cache = new Map<string, Raster>();

/** Equirectangular lookup, row-major, north at the top, longitude -180 at the left; cached per level and size. */
export function equirectRaster(grid: Grid, width: number, height: number): Raster {
  const key = `${grid.level}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const count = width * height;
  const cell = new Int32Array(count);
  const tri = new Int32Array(count * 3);
  const weight = new Float32Array(count * 3);
  const w = new Float64Array(3);
  const idx = new Int32Array(3);
  let rowStart = 0;
  for (let r = 0; r < height; r++) {
    const lat = Math.PI / 2 - ((r + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    let prev = rowStart;
    for (let c = 0; c < width; c++) {
      const lon = -Math.PI + ((c + 0.5) / width) * 2 * Math.PI;
      const x = cl * Math.cos(lon);
      const y = cl * Math.sin(lon);
      const id = nearestCell(grid, x, y, sl, prev);
      const p = r * width + c;
      cell[p] = id;
      locateTriangle(grid, id, x, y, sl, idx, w);
      tri[3 * p] = idx[0];
      tri[3 * p + 1] = idx[1];
      tri[3 * p + 2] = idx[2];
      weight[3 * p] = w[0];
      weight[3 * p + 1] = w[1];
      weight[3 * p + 2] = w[2];
      prev = id;
      if (c === 0) rowStart = id;
    }
  }
  const raster = { width, height, cell, tri, weight };
  cache.set(key, raster);
  return raster;
}

/** Pixel coordinates (fractional) of a latitude/longitude in radians. */
export function latLonToPixel(lat: number, lon: number, width: number, height: number): [number, number] {
  return [((lon + Math.PI) / (2 * Math.PI)) * width, ((Math.PI / 2 - lat) / Math.PI) * height];
}
