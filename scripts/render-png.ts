/**
 * Render a planet to a PNG from the command line, without a browser:
 *   node scripts/render-png.ts out.png [preset] [seed] [layer] [width]
 * Runs on Node's built-in TypeScript type stripping; imports only pure modules.
 */
import { writeFileSync } from 'node:fs';
import { layerById, paintLayer } from '../src/render/layers.ts';
import { equirectRaster } from '../src/render/raster.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { encodePng } from './png.ts';

const [, , outPath = 'planet.png', presetName = 'Earth', seedArg, layerId = 'elevation', widthArg] = process.argv;
const preset = PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}". Known: ${PRESETS.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
const params = { ...preset.params, seed: seedArg !== undefined ? Number(seedArg) >>> 0 : preset.params.seed };
const width = widthArg ? Number(widthArg) : 1440;
const height = width / 2;

const t0 = performance.now();
const world = build(params, (stage, fraction) => console.error(`${stage.padEnd(10)} ${(fraction * 100).toFixed(0).padStart(3)}%`));
const t1 = performance.now();
const raster = equirectRaster(Grid.get(world.level), width, height);
const t2 = performance.now();
const rgba = new Uint8ClampedArray(width * height * 4);
paintLayer(world, raster, layerById(layerId), rgba);
writeFileSync(outPath, encodePng(width, height, rgba));
const t3 = performance.now();

console.log(JSON.stringify({
  preset: preset.name,
  seed: params.seed,
  level: world.level,
  cells: world.n,
  seaLevel: Math.round(world.seaLevel),
  stats: world.stats,
  timingMs: { build: Math.round(t1 - t0), raster: Math.round(t2 - t1), paintAndEncode: Math.round(t3 - t2) },
  out: outPath,
}, null, 2));
