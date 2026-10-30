/**
 * Render the orthographic globe to a PNG from the command line:
 *   node scripts/render-globe.ts out.png [preset] [seed] [layer] [lon] [lat] [size] [sample]
 * Uses the same raster and painter as the Globe view in the app.
 */
import { writeFileSync } from 'node:fs';
import { globeRaster, paintGlobe } from '../src/render/globe.ts';
import { layerById } from '../src/render/layers.ts';
import { ANNUAL } from '../src/sim/climate/insolation.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { encodePng } from './png.ts';

const [, , outPath = 'globe.png', presetName = 'Earth', seedArg, layerId = 'elevation', lonArg = '0', latArg = '20', sizeArg = '720', sampleArg] = process.argv;
const preset = PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}". Known: ${PRESETS.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
const params = { ...preset.params, seed: seedArg !== undefined ? Number(seedArg) >>> 0 : preset.params.seed };
const size = Number(sizeArg);
const sample = sampleArg !== undefined ? Number(sampleArg) : ANNUAL;
const world = build(params);
const t0 = performance.now();
globeRaster(Grid.get(world.level), size, Number(lonArg), Number(latArg));
const t1 = performance.now();
const rgba = new Uint8ClampedArray(size * size * 4);
paintGlobe(world, layerById(layerId), size, Number(lonArg), Number(latArg), rgba, sample);
writeFileSync(outPath, encodePng(size, size, rgba));
console.log(JSON.stringify({ out: outPath, size, rasterMs: Math.round(t1 - t0), paintMs: Math.round(performance.now() - t1) }));
