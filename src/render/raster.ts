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

/** A window on the equirectangular cylinder: its center in degrees and how many times the whole world is magnified. */
export interface Viewport {
  lon0: number;
  lat0: number;
  zoom: number;
}

export const FULL_VIEW: Viewport = { lon0: 0, lat0: 0, zoom: 1 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;

/** Keep the window on the cylinder: longitude wraps, the latitude window stays within the poles. */
export function clampViewport(view: Viewport): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const halfHeight = 90 / zoom;
  return {
    lon0: ((view.lon0 + 540) % 360) - 180,
    lat0: Math.max(-90 + halfHeight, Math.min(90 - halfHeight, view.lat0)),
    zoom,
  };
}

/** Latitude and longitude (radians) at a pixel of the window. */
export function pixelToLatLon(px: number, py: number, width: number, height: number, view: Viewport = FULL_VIEW): [number, number] {
  const lon = (view.lon0 * Math.PI) / 180 + ((px / width - 0.5) * 2 * Math.PI) / view.zoom;
  const lat = (view.lat0 * Math.PI) / 180 + ((0.5 - py / height) * Math.PI) / view.zoom;
  return [lat, ((lon + 3 * Math.PI) % (2 * Math.PI)) - Math.PI];
}

/** Pixel coordinates (fractional) of a latitude and longitude in radians; the longitude is taken on the side of the window's center. */
export function latLonToPixel(lat: number, lon: number, width: number, height: number, view: Viewport = FULL_VIEW): [number, number] {
  let dLon = lon - (view.lon0 * Math.PI) / 180;
  dLon = ((dLon + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const x = width * (0.5 + (dLon / (2 * Math.PI)) * view.zoom);
  const y = height * (0.5 - ((lat - (view.lat0 * Math.PI) / 180) / Math.PI) * view.zoom);
  return [x, y];
}

const cache = new Map<string, Raster>();
/** Rasters are large (28 bytes per pixel); only a few windows stay cached. */
const CACHE_SIZE = 6;

/** Lookup for a window of the equirectangular map, row-major, north at the top; cached per level, size and window. */
export function equirectRaster(grid: Grid, width: number, height: number, view: Viewport = FULL_VIEW): Raster {
  const key = `${grid.level}:${width}x${height}:${view.zoom.toFixed(4)}:${view.lon0.toFixed(3)}:${view.lat0.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  const count = width * height;
  const cell = new Int32Array(count);
  const tri = new Int32Array(count * 3);
  const weight = new Float32Array(count * 3);
  const w = new Float64Array(3);
  const idx = new Int32Array(3);
  let rowStart = 0;
  for (let r = 0; r < height; r++) {
    let prev = rowStart;
    for (let c = 0; c < width; c++) {
      const [lat, lon] = pixelToLatLon(c + 0.5, r + 0.5, width, height, view);
      const cl = Math.cos(lat);
      const x = cl * Math.cos(lon);
      const y = cl * Math.sin(lon);
      const z = Math.sin(lat);
      const id = nearestCell(grid, x, y, z, prev);
      const p = r * width + c;
      cell[p] = id;
      locateTriangle(grid, id, x, y, z, idx, w);
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
