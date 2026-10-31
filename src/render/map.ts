import { ANNUAL } from '../sim/climate/insolation.ts';
import { Grid } from '../sim/grid/grid.ts';
import type { World } from '../sim/pipeline.ts';
import { layerById } from './layers.ts';
import { paintProjection } from './paint.ts';
import { FULL_VIEW, clampViewport, projectLatLon, projectionRaster, unprojectPixel, type ProjectionId, type Viewport } from './raster.ts';

/** Zoom factor per wheel notch. */
const WHEEL_ZOOM = 1.25;

/** A longitude difference in radians brought into (-pi, pi]. */
function wrapDegrees(dLon: number): number {
  return ((dLon + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}
/** Pointer movement below which a press counts as a click. */
const CLICK_SLOP_PX = 3;

/**
 * Flat map (equirectangular, or Equal Earth) on a canvas with a fixed
 * internal resolution, scaled by CSS. The wheel zooms around the cursor (or
 * pans sideways on a horizontal scroll), dragging pans (the equirectangular
 * world wraps around its antimeridian; Equal Earth turns its central
 * meridian), a double click shows the whole world again, and a click picks
 * a cell. While a drag lasts the last rendering is translated; the window
 * is re-rendered when it ends.
 */
export class MapView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private image: ImageData;
  private world: World | null = null;
  private layerId = 'elevation';
  private sample = ANNUAL;
  private viewport: Viewport = { ...FULL_VIEW };
  private projection: ProjectionId = 'equirect';
  private selected = -1;
  private clickHandlers: ((cell: number) => void)[] = [];
  private viewHandlers: ((view: Viewport) => void)[] = [];
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartPx = 0;
  private dragStartPy = 0;
  private dragDx = 0;
  private dragDy = 0;
  private snapshot: HTMLCanvasElement | null = null;
  /** Active pointers by id (client coordinates), for the two-finger pinch (M21). */
  private pointers = new Map<number, [number, number]>();
  private pinch: { startDistance: number; startZoom: number; anchor: [number, number] | null } | null = null;
  private pinchFrame = false;

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
    canvas.addEventListener('pointerdown', (e) => this.startDrag(e));
    canvas.addEventListener('pointermove', (e) => this.moveDrag(e));
    canvas.addEventListener('pointerup', (e) => this.endDrag(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', () => this.setView(FULL_VIEW));
  }

  setWorld(world: World): void {
    this.world = world;
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

  get view(): Viewport {
    return { ...this.viewport };
  }

  /** Switch between the equirectangular cylinder and Equal Earth; the window carries over. */
  setProjection(projection: ProjectionId): void {
    if (projection === this.projection) return;
    this.projection = projection;
    this.draw();
  }

  /** Change the window; notifies listeners (used to keep the two panes of the Compare view together). */
  setView(view: Viewport, notify = true): void {
    const next = clampViewport(view);
    if (next.lon0 === this.viewport.lon0 && next.lat0 === this.viewport.lat0 && next.zoom === this.viewport.zoom) return;
    this.viewport = next;
    this.draw();
    if (notify) for (const h of this.viewHandlers) h(this.view);
  }

  onViewChange(handler: (view: Viewport) => void): void {
    this.viewHandlers.push(handler);
  }

  select(cell: number): void {
    this.selected = cell;
    this.draw();
  }

  onCellClick(handler: (cell: number) => void): void {
    this.clickHandlers.push(handler);
  }

  /** The current map as a PNG blob. */
  toPng(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
    });
  }

  draw(): void {
    if (!this.world) return;
    paintProjection(this.world, layerById(this.layerId), this.width, this.height, this.image.data, this.sample, this.viewport, this.projection);
    this.ctx.putImageData(this.image, 0, 0);
    if (this.selected >= 0) this.drawMarker(this.selected);
    this.drawLabels();
  }

  /** Texts beside cells (the candidate cities' numbers): white on a dark outline. */
  private drawLabels(): void {
    if (!this.world) return;
    const layer = layerById(this.layerId);
    if (!layer.labels) return;
    const grid = Grid.get(this.world.level);
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillStyle = '#fff';
    for (const label of layer.labels(this.world)) {
      const [px, py] = projectLatLon(this.projection, grid.lat[label.cell], grid.lon[label.cell], this.width, this.height, this.viewport);
      if (px < 0 || py < 0 || px > this.width || py > this.height) continue;
      ctx.strokeText(label.text, px + 6, py - 6);
      ctx.fillText(label.text, px + 6, py - 6);
    }
    ctx.restore();
  }

  private drawMarker(cell: number): void {
    if (!this.world) return;
    const grid = Grid.get(this.world.level);
    const [px, py] = projectLatLon(this.projection, grid.lat[cell], grid.lon[cell], this.width, this.height, this.viewport);
    if (px < -10 || py < -10 || px > this.width + 10 || py > this.height + 10) return;
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

  /** Canvas pixel under a pointer event, accounting for object-fit: contain inside the element box. */
  private pixelOf(event: MouseEvent): [number, number] {
    return this.pixelAt(event.clientX, event.clientY);
  }

  private pixelAt(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / this.width, rect.height / this.height);
    const drawnW = this.width * scale;
    const drawnH = this.height * scale;
    const offX = rect.left + (rect.width - drawnW) / 2;
    const offY = rect.top + (rect.height - drawnH) / 2;
    return [(clientX - offX) / scale, (clientY - offY) / scale];
  }

  /** Two fingers: zoom by their distance around their midpoint, which stays on the same point of the planet. */
  private beginPinch(): void {
    const [a, b] = Array.from(this.pointers.values());
    const mid = this.pixelAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    this.pinch = {
      startDistance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])),
      startZoom: this.viewport.zoom,
      anchor: unprojectPixel(this.projection, mid[0], mid[1], this.width, this.height, this.viewport),
    };
    this.dragging = false;
  }

  private movePinch(): void {
    if (!this.pinch || this.pointers.size < 2 || this.pinchFrame) return;
    this.pinchFrame = true;
    requestAnimationFrame(() => {
      this.pinchFrame = false;
      if (!this.pinch || this.pointers.size < 2) return;
      const [a, b] = Array.from(this.pointers.values());
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const zoom = Math.min(16, Math.max(1, (this.pinch.startZoom * distance) / this.pinch.startDistance));
      const next = clampViewport({ ...this.viewport, zoom });
      const mid = this.pixelAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const after = unprojectPixel(this.projection, mid[0], mid[1], this.width, this.height, next);
      const before = this.pinch.anchor;
      if (!before || !after) {
        this.setView(next);
        return;
      }
      this.setView({
        zoom,
        lon0: next.lon0 + (wrapDegrees(before[1] - after[1]) * 180) / Math.PI,
        lat0: next.lat0 + ((before[0] - after[0]) * 180) / Math.PI,
      });
    });
  }

  private cssScale(): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.min(rect.width / this.width, rect.height / this.height) || 1;
  }

  private wheel(event: WheelEvent): void {
    if (!this.world) return;
    event.preventDefault();
    const [px, py] = this.pixelOf(event);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      // Sideways scroll: pan along the parallels.
      const degrees = (event.deltaX / this.width) * (360 / this.viewport.zoom);
      this.setView({ ...this.viewport, lon0: this.viewport.lon0 + degrees });
      return;
    }
    const factor = event.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM;
    const zoom = Math.min(16, Math.max(1, this.viewport.zoom * factor));
    if (zoom === this.viewport.zoom) return;
    // Keep the point under the cursor where it is (when the cursor is on the map at all).
    const next = clampViewport({ ...this.viewport, zoom });
    const before = unprojectPixel(this.projection, px, py, this.width, this.height, this.viewport);
    const after = unprojectPixel(this.projection, px, py, this.width, this.height, next);
    if (!before || !after) {
      this.setView(next);
      return;
    }
    this.setView({
      zoom,
      lon0: next.lon0 + (wrapDegrees(before[1] - after[1]) * 180) / Math.PI,
      lat0: next.lat0 + ((before[0] - after[0]) * 180) / Math.PI,
    });
  }

  private startDrag(event: PointerEvent): void {
    if (!this.world) return;
    this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
    this.canvas.setPointerCapture(event.pointerId);
    if (this.pointers.size >= 2) {
      this.beginPinch();
      return;
    }
    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    [this.dragStartPx, this.dragStartPy] = this.pixelOf(event);
    this.dragDx = 0;
    this.dragDy = 0;
    this.canvas.setPointerCapture(event.pointerId);
    // Snapshot of the current rendering, translated while the drag lasts.
    if (!this.snapshot) {
      this.snapshot = document.createElement('canvas');
      this.snapshot.width = this.width;
      this.snapshot.height = this.height;
    }
    this.snapshot.getContext('2d')?.drawImage(this.canvas, 0, 0);
  }

  private moveDrag(event: PointerEvent): void {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (this.pinch) {
      this.movePinch();
      return;
    }
    if (!this.dragging || !this.snapshot) return;
    const scale = this.cssScale();
    this.dragDx = (event.clientX - this.dragStartX) / scale;
    this.dragDy = (event.clientY - this.dragStartY) / scale;
    if (Math.abs(this.dragDx) < CLICK_SLOP_PX && Math.abs(this.dragDy) < CLICK_SLOP_PX) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.drawImage(this.snapshot, this.dragDx, this.dragDy);
    if (this.viewport.zoom === 1 && this.projection === 'equirect') {
      // The whole cylinder is on screen: show the world wrapping around.
      ctx.drawImage(this.snapshot, this.dragDx - this.width, this.dragDy);
      ctx.drawImage(this.snapshot, this.dragDx + this.width, this.dragDy);
    }
  }

  private cancelDrag(): void {
    this.pointers.clear();
    this.pinch = null;
    this.dragging = false;
    this.draw();
  }

  /** A finger lifted during a pinch ends it without a click or a drag. */
  private endPinch(event: PointerEvent): boolean {
    this.pointers.delete(event.pointerId);
    if (!this.pinch) return false;
    if (this.pointers.size < 2) {
      this.pinch = null;
      this.dragging = false;
      this.draw();
    }
    return true;
  }

  private endDrag(event: PointerEvent): void {
    if (this.endPinch(event)) return;
    if (!this.dragging || !this.world) return;
    this.dragging = false;
    const moved = Math.abs(this.dragDx) >= CLICK_SLOP_PX || Math.abs(this.dragDy) >= CLICK_SLOP_PX;
    if (moved) {
      const view = this.viewport;
      // The ground under the pointer follows it: compare where the drag began and ended.
      const from = unprojectPixel(this.projection, this.dragStartPx, this.dragStartPy, this.width, this.height, view);
      const to = unprojectPixel(this.projection, this.dragStartPx + this.dragDx, this.dragStartPy + this.dragDy, this.width, this.height, view);
      if (from && to) {
        this.setView({
          zoom: view.zoom,
          lon0: view.lon0 - (wrapDegrees(to[1] - from[1]) * 180) / Math.PI,
          lat0: view.lat0 - ((to[0] - from[0]) * 180) / Math.PI,
        });
      } else {
        this.setView({
          zoom: view.zoom,
          lon0: view.lon0 - (this.dragDx / this.width) * (360 / view.zoom),
          lat0: view.lat0 + (this.dragDy / this.height) * (180 / view.zoom),
        });
      }
      this.draw();
      return;
    }
    const [px, py] = this.pixelOf(event);
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const raster = projectionRaster(Grid.get(this.world.level), this.width, this.height, this.viewport, this.projection);
    const cell = raster.cell[y * this.width + x];
    if (cell < 0) return;
    this.select(cell);
    for (const h of this.clickHandlers) h(cell);
  }
}
