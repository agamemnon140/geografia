import { Grid } from '../sim/grid/grid.ts';
import type { World } from '../sim/pipeline.ts';
import { layerById, paintLayer } from './layers.ts';
import { equirectRaster } from './raster.ts';

/** Paint a world's layer into a small canvas (gallery thumbnails). */
export function paintThumbnail(world: World, canvas: HTMLCanvasElement, layerId = 'elevation'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const raster = equirectRaster(Grid.get(world.level), canvas.width, canvas.height);
  const image = ctx.createImageData(canvas.width, canvas.height);
  paintLayer(world, raster, layerById(layerId), image.data);
  ctx.putImageData(image, 0, 0);
}
