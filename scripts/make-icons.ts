/**
 * Render the app's icons from the default planet: the globe seen over its
 * largest landmass, on the app's dark background, at the sizes the web
 * manifest and iOS want. Writes to public/icons/.
 *   node scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { paintGlobe } from '../src/render/globe.ts';
import { layerById } from '../src/render/layers.ts';
import { toLat, toLon } from '../src/sim/grid/geometry.ts';
import { Grid, cellAreasKm2 } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { encodePng } from './png.ts';

const BACKGROUND = [20, 22, 26];
const world = build(EARTH);
const grid = Grid.get(world.level);
const areas = cellAreasKm2(grid, world.radiusKm);

// View direction: the area-weighted center of the land, so the icon shows the main continent.
let cx = 0;
let cy = 0;
let cz = 0;
for (let i = 0; i < world.n; i++) {
  if (world.elevation[i] < world.seaLevel) continue;
  cx += areas[i] * grid.xyz[3 * i];
  cy += areas[i] * grid.xyz[3 * i + 1];
  cz += areas[i] * grid.xyz[3 * i + 2];
}
const len = Math.hypot(cx, cy, cz) || 1;
const lon = (toLon(cx / len, cy / len) * 180) / Math.PI;
const lat = Math.max(-35, Math.min(35, (toLat(cz / len) * 180) / Math.PI));

mkdirSync('public/icons', { recursive: true });

/** Globe of `share` of the icon's width, painted at twice the size and averaged down for a soft edge. */
function icon(size: number, share: number, name: string): void {
  const d = Math.round(size * share);
  const big = 2 * d;
  const globe = new Uint8ClampedArray(big * big * 4);
  paintGlobe(world, layerById('elevation'), big, lon, lat, globe);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    out[4 * p] = BACKGROUND[0];
    out[4 * p + 1] = BACKGROUND[1];
    out[4 * p + 2] = BACKGROUND[2];
    out[4 * p + 3] = 255;
  }
  const off = Math.floor((size - d) / 2);
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const o = 4 * ((y + off) * size + x + off);
      for (let ch = 0; ch < 3; ch++) {
        const a = globe[4 * (2 * y * big + 2 * x) + ch];
        const b = globe[4 * (2 * y * big + 2 * x + 1) + ch];
        const c = globe[4 * ((2 * y + 1) * big + 2 * x) + ch];
        const e = globe[4 * ((2 * y + 1) * big + 2 * x + 1) + ch];
        out[o + ch] = Math.round((a + b + c + e) / 4);
      }
    }
  }
  writeFileSync(`public/icons/${name}`, encodePng(size, size, out));
  console.log(`public/icons/${name} (${size} px, globe ${d} px)`);
}

icon(512, 0.86, 'icon-512.png');
icon(192, 0.86, 'icon-192.png');
icon(180, 0.86, 'apple-touch-icon.png');
icon(64, 0.9, 'favicon-64.png');
// Maskable icons keep their content inside the central 80%: a smaller globe.
icon(512, 0.66, 'icon-maskable-512.png');
console.log(JSON.stringify({ seed: world.params.seed, lon: Math.round(lon), lat: Math.round(lat) }));
