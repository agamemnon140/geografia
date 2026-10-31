import type { Grid } from '../sim/grid/grid.ts';
import { nearestCell } from '../sim/grid/locate.ts';
import { EQUAL_EARTH_X_MAX, EQUAL_EARTH_Y_MAX, equalEarthForward, equalEarthInverse } from './equalearth.ts';
import { locateTriangle } from './interp.ts';

/** Flat projections of the map views: the equirectangular cylinder, or the equal-area Equal Earth. */
export type ProjectionId = 'equirect' | 'equalEarth';

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

/** Pixels per projection unit for the whole Equal Earth map to fit the canvas at zoom 1, with a small margin. */
function equalEarthScale(width: number, height: number): number {
  return 0.985 * Math.min(width / (2 * EQUAL_EARTH_X_MAX), height / (2 * EQUAL_EARTH_Y_MAX));
}

function wrapLon(lon: number): number {
  return ((lon + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/**
 * Latitude and longitude (radians) at a pixel of a window in a projection, or
 * null where the projection draws nothing. In Equal Earth the window's
 * center longitude is the central meridian and its center latitude sets the
 * vertical offset.
 */
export function unprojectPixel(projection: ProjectionId, px: number, py: number, width: number, height: number, view: Viewport = FULL_VIEW): [number, number] | null {
  if (projection === 'equirect') return pixelToLatLon(px, py, width, height, view);
  const s = equalEarthScale(width, height) * view.zoom;
  const yc = equalEarthForward((view.lat0 * Math.PI) / 180, 0)[1];
  const r = equalEarthInverse((px - width / 2) / s, yc + (height / 2 - py) / s);
  if (!r) return null;
  return [r[0], wrapLon(r[1] + (view.lon0 * Math.PI) / 180)];
}

/** Pixel coordinates (fractional) of a latitude and longitude in radians, in a projection. */
export function projectLatLon(projection: ProjectionId, lat: number, lon: number, width: number, height: number, view: Viewport = FULL_VIEW): [number, number] {
  if (projection === 'equirect') return latLonToPixel(lat, lon, width, height, view);
  const s = equalEarthScale(width, height) * view.zoom;
  const yc = equalEarthForward((view.lat0 * Math.PI) / 180, 0)[1];
  const [x, y] = equalEarthForward(lat, wrapLon(lon - (view.lon0 * Math.PI) / 180));
  return [width / 2 + x * s, height / 2 - (y - yc) * s];
}

/** Ground meters per pixel of an Equal Earth window: the projection is equal-area, so every pixel covers the same ground. */
export function equalEarthMetersPerPixel(radiusM: number, width: number, height: number, zoom: number): number {
  return radiusM / (equalEarthScale(width, height) * zoom);
}

const cache = new Map<string, Raster>();
/** Rasters are large (28 bytes per pixel); only a few windows stay cached. */
const CACHE_SIZE = 6;

/** Lookup for a window of a flat projection, row-major, north at the top; -1 outside the drawn area; cached per projection, level, size and window. */
export function projectionRaster(grid: Grid, width: number, height: number, view: Viewport = FULL_VIEW, projection: ProjectionId = 'equirect'): Raster {
  const key = `${projection}:${grid.level}:${width}x${height}:${view.zoom.toFixed(4)}:${view.lon0.toFixed(3)}:${view.lat0.toFixed(3)}`;
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
    let first = true;
    for (let c = 0; c < width; c++) {
      const p = r * width + c;
      const ll = unprojectPixel(projection, c + 0.5, r + 0.5, width, height, view);
      if (!ll) {
        cell[p] = -1;
        tri[3 * p] = tri[3 * p + 1] = tri[3 * p + 2] = -1;
        continue;
      }
      const [lat, lon] = ll;
      const cl = Math.cos(lat);
      const x = cl * Math.cos(lon);
      const y = cl * Math.sin(lon);
      const z = Math.sin(lat);
      const id = nearestCell(grid, x, y, z, prev);
      cell[p] = id;
      locateTriangle(grid, id, x, y, z, idx, w);
      tri[3 * p] = idx[0];
      tri[3 * p + 1] = idx[1];
      tri[3 * p + 2] = idx[2];
      weight[3 * p] = w[0];
      weight[3 * p + 1] = w[1];
      weight[3 * p + 2] = w[2];
      prev = id;
      if (first) {
        rowStart = id;
        first = false;
      }
    }
  }
  const raster = { width, height, cell, tri, weight };
  cache.set(key, raster);
  return raster;
}

/** Lookup for a window of the equirectangular map. */
export function equirectRaster(grid: Grid, width: number, height: number, view: Viewport = FULL_VIEW): Raster {
  return projectionRaster(grid, width, height, view, 'equirect');
}
