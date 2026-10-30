import { DEG } from '../sim/grid/geometry.ts';
import { Grid } from '../sim/grid/grid.ts';
import { nearestCell } from '../sim/grid/locate.ts';
import { ANNUAL } from '../sim/climate/insolation.ts';
import type { World } from '../sim/pipeline.ts';
import { apply, applyTranspose, axisAngle, multiply, type Mat3 } from '../sim/tectonics/rotation.ts';
import { locateTriangle } from './interp.ts';
import { cellColors, layerById, paintCells, type Layer } from './layers.ts';
import { paintSmooth } from './paint.ts';
import type { Raster } from './raster.ts';

/**
 * Orthographic globe (DESIGN 8.4), software-rendered on a 2D canvas so the
 * app stays dependency-free: every pixel inside the disc is unprojected to
 * the sphere, rotated into the planet's frame and looked up with the same
 * nearest-cell walk and triangle interpolation the flat map uses. The
 * lookup is cached per view direction; while the globe turns it is painted
 * flat, and at rest with the smooth painter (interpolation, hillshade,
 * rivers).
 */

export interface GlobeRaster extends Raster {
  /** Lighting factor per pixel, 0 to 1. */
  shade: Float32Array;
}

/** Light direction in view space (viewer on +x, screen right +y, screen up +z): from the upper left, slightly in front. */
const LIGHT = normalize(0.7, -0.5, 0.6);
const AMBIENT = 0.45;

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/**
 * Rotation taking planet coordinates to view coordinates for a viewer above
 * (lonDeg, latDeg): first spin the globe so that meridian faces +x, then tilt
 * so that latitude lands on the equator of the view.
 */
export function viewRotation(lonDeg: number, latDeg: number): Mat3 {
  const spin = axisAngle(0, 0, 1, -lonDeg * DEG);
  const tilt = axisAngle(0, 1, 0, latDeg * DEG);
  return multiply(tilt, spin);
}

const cache = new Map<string, GlobeRaster>();

/** Pixel-to-mesh lookup and lighting of the disc for a view; cached per grid level, size and view (rounded to half a degree). */
export function globeRaster(grid: Grid, size: number, lonDeg: number, latDeg: number): GlobeRaster {
  const lon = Math.round(lonDeg * 2) / 2;
  const lat = Math.round(latDeg * 2) / 2;
  const key = `${grid.level}:${size}:${lon}:${lat}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 48) cache.clear();
  const rotation = viewRotation(lon, lat);
  const count = size * size;
  const cell = new Int32Array(count).fill(-1);
  const tri = new Int32Array(count * 3);
  const weight = new Float32Array(count * 3);
  const shade = new Float32Array(count);
  const tmp = new Float64Array(3);
  const w = new Float64Array(3);
  const idx = new Int32Array(3);
  let prev = 0;
  for (let py = 0; py < size; py++) {
    const sy = 1 - ((py + 0.5) / size) * 2;
    let rowStart = -1;
    for (let px = 0; px < size; px++) {
      const sx = ((px + 0.5) / size) * 2 - 1;
      const r2 = sx * sx + sy * sy;
      if (r2 > 1) continue;
      const vx = Math.sqrt(1 - r2);
      applyTranspose(rotation, vx, sx, sy, tmp, 0);
      const id = nearestCell(grid, tmp[0], tmp[1], tmp[2], prev);
      const p = py * size + px;
      cell[p] = id;
      locateTriangle(grid, id, tmp[0], tmp[1], tmp[2], idx, w);
      tri[3 * p] = idx[0];
      tri[3 * p + 1] = idx[1];
      tri[3 * p + 2] = idx[2];
      weight[3 * p] = w[0];
      weight[3 * p + 1] = w[1];
      weight[3 * p + 2] = w[2];
      const lit = vx * LIGHT[0] + sx * LIGHT[1] + sy * LIGHT[2];
      shade[p] = AMBIENT + (1 - AMBIENT) * Math.max(0, lit);
      prev = id;
      if (rowStart < 0) rowStart = id;
    }
    if (rowStart >= 0) prev = rowStart;
  }
  const raster = { width: size, height: size, cell, tri, weight, shade };
  cache.set(key, raster);
  return raster;
}

/** A function giving the screen position of each cell for a view, or null when it faces away. */
export function globeProjector(grid: Grid, size: number, lonDeg: number, latDeg: number): (cell: number) => [number, number] | null {
  const rotation = viewRotation(lonDeg, latDeg);
  const tmp = new Float64Array(3);
  return (cell) => {
    apply(rotation, grid.xyz[3 * cell], grid.xyz[3 * cell + 1], grid.xyz[3 * cell + 2], tmp, 0);
    if (tmp[0] < 0) return null;
    return [((tmp[1] + 1) / 2) * size, ((1 - tmp[2]) / 2) * size];
  };
}

/** Screen position (pixels) of a planet point for a view, or null when it faces away. */
export function projectToGlobe(grid: Grid, cell: number, size: number, lonDeg: number, latDeg: number): [number, number] | null {
  return globeProjector(grid, size, lonDeg, latDeg)(cell);
}

/** Smooth paint of the globe into an RGBA buffer of size x size pixels. */
export function paintGlobe(world: World, layer: Layer, size: number, lonDeg: number, latDeg: number, out: Uint8ClampedArray, sample = ANNUAL): void {
  const grid = Grid.get(world.level);
  const raster = globeRaster(grid, size, lonDeg, latDeg);
  const radiusM = world.radiusKm * 1000;
  const meters = (2 * radiusM) / size;
  paintSmooth(world, raster, layer, out, {
    sample,
    shade: raster.shade,
    project: globeProjector(grid, size, lonDeg, latDeg),
    metersPerPixel: () => [meters, meters],
    pixelsPerCell: (size / 2) * Math.sqrt((4 * Math.PI) / grid.n),
  });
}

/** Interactive globe on a canvas: drag to turn, click to pick a cell. */
export class GlobeView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private image: ImageData;
  private world: World | null = null;
  private layerId = 'elevation';
  private sample = ANNUAL;
  private lon = 0;
  private lat = 20;
  private flatColors: Uint8ClampedArray | null = null;
  private flatKey = '';
  private selected = -1;
  private clickHandlers: ((cell: number) => void)[] = [];
  private dragging = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private pendingDraw = false;

  constructor(canvas: HTMLCanvasElement, size = 720) {
    this.canvas = canvas;
    this.size = size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.image = ctx.createImageData(size, size);
    canvas.addEventListener('pointerdown', (e) => this.startDrag(e));
    canvas.addEventListener('pointermove', (e) => this.moveDrag(e));
    canvas.addEventListener('pointerup', (e) => this.endDrag(e));
    canvas.addEventListener('pointerleave', () => this.releaseDrag());
  }

  setWorld(world: World): void {
    this.world = world;
    this.selected = -1;
    this.flatColors = null;
    this.draw();
  }

  setLayer(id: string): void {
    this.layerId = id;
    this.flatColors = null;
    this.draw();
  }

  setSample(sample: number): void {
    this.sample = sample;
    this.flatColors = null;
    this.draw();
  }

  setView(lonDeg: number, latDeg: number): void {
    this.lon = ((lonDeg + 540) % 360) - 180;
    this.lat = Math.max(-89, Math.min(89, latDeg));
    this.draw();
  }

  get view(): [number, number] {
    return [this.lon, this.lat];
  }

  select(cell: number): void {
    this.selected = cell;
    this.draw();
  }

  onCellClick(handler: (cell: number) => void): void {
    this.clickHandlers.push(handler);
  }

  toPng(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
    });
  }

  /** Full smooth paint at rest; flat paint while turning. */
  draw(quick = false): void {
    if (!this.world) return;
    const world = this.world;
    const grid = Grid.get(world.level);
    const layer = layerById(this.layerId);
    if (quick) {
      const raster = globeRaster(grid, this.size, this.lon, this.lat);
      const key = `${world.params.seed}:${world.steps}:${world.level}:${this.layerId}:${this.sample}`;
      if (!this.flatColors || this.flatKey !== key) {
        this.flatColors = cellColors(world, layer, this.sample);
        this.flatKey = key;
      }
      paintCells(this.flatColors, raster.cell, this.image.data, raster.shade);
    } else {
      paintGlobe(world, layer, this.size, this.lon, this.lat, this.image.data, this.sample);
    }
    this.ctx.putImageData(this.image, 0, 0);
    if (this.selected >= 0) {
      const at = projectToGlobe(grid, this.selected, this.size, this.lon, this.lat);
      if (at) {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.arc(at[0], at[1], 7, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.arc(at[0], at[1], 5, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private pixelOf(event: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / this.size, rect.height / this.size);
    const drawn = this.size * scale;
    const offX = rect.left + (rect.width - drawn) / 2;
    const offY = rect.top + (rect.height - drawn) / 2;
    return [(event.clientX - offX) / scale, (event.clientY - offY) / scale];
  }

  private startDrag(event: PointerEvent): void {
    this.dragging = true;
    this.dragMoved = false;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    this.dragMoved = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    const rect = this.canvas.getBoundingClientRect();
    const degPerPx = 180 / Math.max(1, Math.min(rect.width, rect.height));
    this.lon = ((this.lon - dx * degPerPx + 540) % 360) - 180;
    this.lat = Math.max(-89, Math.min(89, this.lat + dy * degPerPx));
    if (!this.pendingDraw) {
      this.pendingDraw = true;
      requestAnimationFrame(() => {
        this.pendingDraw = false;
        this.draw(true);
      });
    }
  }

  private releaseDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragMoved) this.draw();
  }

  private endDrag(event: PointerEvent): void {
    if (!this.dragging) return;
    const moved = this.dragMoved;
    this.releaseDrag();
    if (moved || !this.world) return;
    const [px, py] = this.pixelOf(event);
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const raster = globeRaster(Grid.get(this.world.level), this.size, this.lon, this.lat);
    const cell = raster.cell[y * this.size + x];
    if (cell < 0) return;
    this.select(cell);
    for (const h of this.clickHandlers) h(cell);
  }
}
