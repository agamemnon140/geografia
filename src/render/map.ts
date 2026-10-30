import { ANNUAL } from '../sim/climate/insolation.ts';
import { Grid } from '../sim/grid/grid.ts';
import type { World } from '../sim/pipeline.ts';
import { layerById, paintLayer } from './layers.ts';
import { equirectRaster, latLonToPixel, type Raster } from './raster.ts';

/** Equirectangular map on a canvas with a fixed internal resolution, scaled by CSS. */
export class MapView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private image: ImageData;
  private world: World | null = null;
  private raster: Raster | null = null;
  private layerId = 'elevation';
  private sample = ANNUAL;
  private selected = -1;
  private clickHandlers: ((cell: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement, width = 1440, height = 720) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.image = ctx.createImageData(width, height);
    canvas.addEventListener('click', (event) => this.handleClick(event));
  }

  setWorld(world: World): void {
    this.world = world;
    this.raster = equirectRaster(Grid.get(world.level), this.width, this.height);
    this.selected = -1;
    this.draw();
  }

  setLayer(id: string): void {
    this.layerId = id;
    this.draw();
  }

  /** Sample index 0 to 11, or ANNUAL. */
  setSample(sample: number): void {
    this.sample = sample;
    this.draw();
  }

  select(cell: number): void {
    this.selected = cell;
    this.draw();
  }

  onCellClick(handler: (cell: number) => void): void {
    this.clickHandlers.push(handler);
  }

  draw(): void {
    if (!this.world || !this.raster) return;
    paintLayer(this.world, this.raster, layerById(this.layerId), this.image.data, this.sample);
    this.ctx.putImageData(this.image, 0, 0);
    if (this.selected >= 0) this.drawMarker(this.selected);
  }

  private drawMarker(cell: number): void {
    if (!this.world) return;
    const grid = Grid.get(this.world.level);
    const [px, py] = latLonToPixel(grid.lat[cell], grid.lon[cell], this.width, this.height);
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  private handleClick(event: MouseEvent): void {
    if (!this.raster) return;
    const rect = this.canvas.getBoundingClientRect();
    // object-fit: contain keeps the 2:1 aspect; compute the drawn area inside the element box.
    const scale = Math.min(rect.width / this.width, rect.height / this.height);
    const drawnW = this.width * scale;
    const drawnH = this.height * scale;
    const offX = rect.left + (rect.width - drawnW) / 2;
    const offY = rect.top + (rect.height - drawnH) / 2;
    const px = Math.floor((event.clientX - offX) / scale);
    const py = Math.floor((event.clientY - offY) / scale);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const cell = this.raster.cell[py * this.width + px];
    this.select(cell);
    for (const h of this.clickHandlers) h(cell);
  }
}
