/**
 * Render a planet to a PNG from the command line, without a browser:
 *   node scripts/render-png.ts out.png [preset] [seed] [layer] [width] [sample]
 * `sample` is a month index 0 to 11 for seasonal layers; omitted means annual.
 * Runs on Node's built-in TypeScript type stripping; imports only pure modules.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { layerById } from '../src/render/layers.ts';
import { EARTH_DATA_PATH, buildEarth, parseEarthElevation } from '../src/sim/earth.ts';
import { paintEquirect } from '../src/render/paint.ts';
import { equirectRaster } from '../src/render/raster.ts';
import { ANNUAL } from '../src/sim/climate/insolation.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { encodePng } from './png.ts';

const [, , outPath = 'planet.png', presetName = 'Earth', seedArg, layerId = 'elevation', widthArg, sampleArg] = process.argv;
const sample = sampleArg !== undefined ? Number(sampleArg) : ANNUAL;
const real = presetName.toLowerCase() === 'real';
const preset = real ? PRESETS[0] : PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}". Known: Real (measured relief), ${PRESETS.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
const params = { ...preset.params, seed: seedArg !== undefined ? Number(seedArg) >>> 0 : preset.params.seed };
const width = widthArg ? Number(widthArg) : 1440;
const height = width / 2;

const t0 = performance.now();
const log = (stage: string, fraction: number): void => console.error(`${stage.padEnd(10)} ${(fraction * 100).toFixed(0).padStart(3)}%`);
const world = real ? buildEarth(parseEarthElevation(readEarthFile()), log) : build(params, log);
const t1 = performance.now();
equirectRaster(Grid.get(world.level), width, height);
const t2 = performance.now();
const rgba = new Uint8ClampedArray(width * height * 4);
paintEquirect(world, layerById(layerId), width, height, rgba, sample);
writeFileSync(outPath, encodePng(width, height, rgba));
const t3 = performance.now();

function readEarthFile(): ArrayBuffer {
  const file = readFileSync(`public/${EARTH_DATA_PATH}`);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

console.log(JSON.stringify({
  preset: real ? 'Real Earth' : preset.name,
  seed: params.seed,
  level: world.level,
  cells: world.n,
  seaLevel: Math.round(world.seaLevel),
  stats: world.stats,
  timingMs: { build: Math.round(t1 - t0), raster: Math.round(t2 - t1), paintAndEncode: Math.round(t3 - t2) },
  out: outPath,
}, null, 2));
