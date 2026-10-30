import { ANNUAL } from '../sim/climate/insolation.ts';
import { Grid } from '../sim/grid/grid.ts';
import type { FloatArray, World } from '../sim/pipeline.ts';
import type { RGB } from './colors.ts';
import { RIVER_COLOR, RIVER_MIN_KM3, type Layer } from './layers.ts';
import { strokeSegment } from './lines.ts';
import { equirectRaster, latLonToPixel, type Raster } from './raster.ts';

/**
 * The smooth painter (DESIGN 8.5). Layers that define `smooth` get a sampler
 * that interpolates any per-cell field at the pixel; layers flagged `relief`
 * are hillshaded from the interpolated elevation; layers flagged `rivers`
 * get the drainage network drawn as lines whose width grows with discharge.
 * Map and globe differ only in their raster and in how a cell projects to
 * the screen, both supplied by the caller.
 */

/** Cartographic vertical exaggeration of the hillshade: slopes are tiny at 30 km per pixel. */
export const SHADE_EXAGGERATION = 15;
/** Light direction for the hillshade in (east, north, up). */
const SHADE_LIGHT = normalize(-0.6, 0.5, 0.65);
const SHADE_AMBIENT_LAND = 0.55;
/** The sea floor is stepped cell by cell (crust ages), so its shading stays faint. */
const SHADE_AMBIENT_SEA = 0.92;
/** River width in pixels at RIVER_MIN_KM3 and the growth per decade of discharge, at ten pixels per cell. */
const RIVER_WIDTH_MIN = 0.9;
const RIVER_WIDTH_PER_DECADE = 1.4;
const RIVER_WIDTH_MAX = 4.5;

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/** Per-pixel access to the mesh: the nearest cell, and interpolation of any per-cell field. */
export class PixelSampler {
  cell = 0;
  private i0 = 0;
  private i1 = 0;
  private i2 = 0;
  private w0 = 1;
  private w1 = 0;
  private w2 = 0;

  set(raster: Raster, p: number): void {
    this.cell = raster.cell[p];
    this.i0 = raster.tri[3 * p];
    this.i1 = raster.tri[3 * p + 1];
    this.i2 = raster.tri[3 * p + 2];
    this.w0 = raster.weight[3 * p];
    this.w1 = raster.weight[3 * p + 1];
    this.w2 = raster.weight[3 * p + 2];
  }

  /** Interpolated value of a per-cell field. */
  interp(field: ArrayLike<number>): number {
    return field[this.i0] * this.w0 + field[this.i1] * this.w1 + field[this.i2] * this.w2;
  }

  /** Interpolated value of a sample-major seasonal field; ANNUAL reads `annual` instead. */
  interpSeasonal(samples: FloatArray, annual: FloatArray, n: number, sample: number): number {
    if (sample >= ANNUAL) return this.interp(annual);
    const base = sample * n;
    return samples[base + this.i0] * this.w0 + samples[base + this.i1] * this.w1 + samples[base + this.i2] * this.w2;
  }
}

export interface PaintOptions {
  sample?: number;
  /** Lighting factor per pixel (the globe's shading), applied on top of everything. */
  shade?: Float32Array | null;
  /** Screen position of a cell center, or null when hidden; needed for rivers. */
  project?: (cell: number) => [number, number] | null;
  /** Meters per pixel in x and y at a pixel, for the hillshade slopes. */
  metersPerPixel?: (x: number, y: number) => [number, number];
  /** Pixels per cell on screen, to scale river widths. */
  pixelsPerCell?: number;
}

const BACKGROUND: RGB = [20, 22, 26];

/** Paint a layer with interpolation, hillshade and rivers where the layer asks for them. */
export function paintSmooth(world: World, raster: Raster, layer: Layer, out: Uint8ClampedArray, options: PaintOptions = {}): void {
  const sample = options.sample ?? ANNUAL;
  const count = raster.width * raster.height;
  const px = new PixelSampler();
  const smooth = layer.smooth;
  const cellColorCache = smooth ? null : new Map<number, RGB>();
  for (let p = 0; p < count; p++) {
    const o = p * 4;
    if (raster.cell[p] < 0) {
      out[o] = BACKGROUND[0];
      out[o + 1] = BACKGROUND[1];
      out[o + 2] = BACKGROUND[2];
      out[o + 3] = 255;
      continue;
    }
    px.set(raster, p);
    let color: RGB;
    if (smooth) color = smooth(world, px, sample);
    else {
      const cached = cellColorCache!.get(px.cell);
      if (cached) color = cached;
      else {
        color = layer.cellColor(world, px.cell, sample);
        cellColorCache!.set(px.cell, color);
      }
    }
    out[o] = color[0];
    out[o + 1] = color[1];
    out[o + 2] = color[2];
    out[o + 3] = 255;
  }
  if (layer.relief && options.metersPerPixel) hillshade(world, raster, out, options.metersPerPixel, layer.relief === 'light');
  if (options.shade) {
    const shade = options.shade;
    for (let p = 0; p < count; p++) {
      if (raster.cell[p] < 0) continue;
      const o = p * 4;
      out[o] *= shade[p];
      out[o + 1] *= shade[p];
      out[o + 2] *= shade[p];
    }
  }
  if (layer.rivers && options.project) drawRivers(world, raster, out, options.project, options.pixelsPerCell ?? 10);
}

/** Projection, pixel scale and river scale of an equirectangular map of the given size. */
export function mapPaintOptions(world: World, width: number, height: number, sample = ANNUAL): PaintOptions {
  const grid = Grid.get(world.level);
  const radiusM = world.radiusKm * 1000;
  return {
    sample,
    project: (cell) => latLonToPixel(grid.lat[cell], grid.lon[cell], width, height),
    metersPerPixel: (_x, y) => {
      const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
      return [Math.max(1, (2 * Math.PI * radiusM * Math.cos(lat)) / width), (Math.PI * radiusM) / height];
    },
    pixelsPerCell: (width * Math.sqrt((4 * Math.PI) / grid.n)) / (2 * Math.PI),
  };
}

/** Smooth paint of a layer onto an equirectangular RGBA buffer of the given size. */
export function paintEquirect(world: World, layer: Layer, width: number, height: number, out: Uint8ClampedArray, sample = ANNUAL): void {
  const raster = equirectRaster(Grid.get(world.level), width, height);
  paintSmooth(world, raster, layer, out, mapPaintOptions(world, width, height, sample));
}

/** Multiply the colors by a hillshade from the interpolated elevation; the sea gets a gentler version. */
function hillshade(world: World, raster: Raster, out: Uint8ClampedArray, metersPerPixel: (x: number, y: number) => [number, number], light: boolean): void {
  const { width, height } = raster;
  const px = new PixelSampler();
  const elevation = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (raster.cell[p] < 0) continue;
    px.set(raster, p);
    elevation[p] = px.interp(world.elevation);
  }
  const strength = light ? 0.5 : 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (raster.cell[p] < 0) continue;
      const xl = x > 0 && raster.cell[p - 1] >= 0 ? p - 1 : p;
      const xr = x < width - 1 && raster.cell[p + 1] >= 0 ? p + 1 : p;
      const yu = y > 0 && raster.cell[p - width] >= 0 ? p - width : p;
      const yd = y < height - 1 && raster.cell[p + width] >= 0 ? p + width : p;
      const [mx, my] = metersPerPixel(x, y);
      const dzdx = ((elevation[xr] - elevation[xl]) / ((xr - xl) || 1)) / mx;
      const dzdy = ((elevation[yu] - elevation[yd]) / ((yd - yu) || 1)) / my;
      const nx = -dzdx * SHADE_EXAGGERATION;
      const ny = -dzdy * SHADE_EXAGGERATION;
      const len = Math.hypot(nx, ny, 1);
      const lit = (nx * SHADE_LIGHT[0] + ny * SHADE_LIGHT[1] + SHADE_LIGHT[2]) / len;
      const sea = elevation[p] < world.seaLevel;
      const ambient = sea ? SHADE_AMBIENT_SEA : SHADE_AMBIENT_LAND;
      const shade = 1 - strength * (1 - (ambient + (1 - ambient) * Math.max(0, lit)));
      const o = p * 4;
      out[o] *= shade;
      out[o + 1] *= shade;
      out[o + 2] *= shade;
    }
  }
}

/** The drainage network as lines from each river cell to its downstream cell; width grows with the logarithm of discharge. */
function drawRivers(world: World, raster: Raster, out: Uint8ClampedArray, project: (cell: number) => [number, number] | null, pixelsPerCell: number): void {
  const { width, height } = raster;
  const scale = pixelsPerCell / 10;
  for (let i = 0; i < world.n; i++) {
    if (world.elevation[i] < world.seaLevel || world.lake[i] >= 0) continue;
    const q = world.discharge[i];
    if (q < RIVER_MIN_KM3) continue;
    const d = world.downstream[i];
    if (d < 0) continue;
    const a = project(i);
    const b = project(d);
    if (!a || !b) continue;
    let [x1, y1] = b;
    // Segments that wrap around the map edge are skipped; a mouth stops halfway to the sea cell.
    if (Math.abs(x1 - a[0]) > width / 2) continue;
    if (world.elevation[d] < world.seaLevel || world.lake[d] >= 0) {
      x1 = (a[0] + x1) / 2;
      y1 = (a[1] + y1) / 2;
    }
    const thickness = Math.min(RIVER_WIDTH_MAX, RIVER_WIDTH_MIN + RIVER_WIDTH_PER_DECADE * Math.log10(q / RIVER_MIN_KM3)) * scale;
    strokeSegment(out, width, height, a[0], a[1], x1, y1, thickness, RIVER_COLOR);
  }
}
