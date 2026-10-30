import type { Grid } from '../sim/grid/grid.ts';
import { nearestCell } from '../sim/grid/locate.ts';

/** Equirectangular lookup: the cell id under each pixel, row-major, north at the top, longitude -180 at the left. */
export interface Raster {
  width: number;
  height: number;
  cell: Int32Array;
}

const cache = new Map<string, Raster>();

export function equirectRaster(grid: Grid, width: number, height: number): Raster {
  const key = `${grid.level}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cell = new Int32Array(width * height);
  let rowStart = 0;
  for (let r = 0; r < height; r++) {
    const lat = Math.PI / 2 - ((r + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    let prev = rowStart;
    for (let c = 0; c < width; c++) {
      const lon = -Math.PI + ((c + 0.5) / width) * 2 * Math.PI;
      const id = nearestCell(grid, cl * Math.cos(lon), cl * Math.sin(lon), sl, prev);
      cell[r * width + c] = id;
      prev = id;
      if (c === 0) rowStart = id;
    }
  }
  const raster = { width, height, cell };
  cache.set(key, raster);
  return raster;
}

/** Pixel coordinates (fractional) of a latitude/longitude in radians. */
export function latLonToPixel(lat: number, lon: number, width: number, height: number): [number, number] {
  return [((lon + Math.PI) / (2 * Math.PI)) * width, ((Math.PI / 2 - lat) / Math.PI) * height];
}
