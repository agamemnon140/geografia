/**
 * Zonal diagnostics of the climate stage, for tuning:
 *   node scripts/diag-climate.ts [preset] [seed]
 * Prints per 10-degree band the land and ocean precipitation, temperature,
 * cloud cover, sunshine, zonal wind and current, then global moisture, cloud
 * and ocean summaries; for the real Earth, named places against observed
 * sunshine normals.
 */
import { readFileSync } from 'node:fs';
import { EARTH_DATA_PATH, buildEarth, parseEarthElevation } from '../src/sim/earth.ts';
import { DEG, fromLatLon } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { nearestCell } from '../src/sim/grid/locate.ts';
import { PRESETS } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { ANNUAL } from '../src/sim/climate/insolation.ts';
import { windAt } from '../src/render/layers.ts';

const [, , presetName = 'Earth', seedArg = '1'] = process.argv;
const real = presetName.toLowerCase() === 'real';
const preset = real ? PRESETS[0] : PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
if (!preset) {
  console.error(`Unknown preset "${presetName}" (use Real for the measured relief)`);
  process.exit(1);
}
const t0 = performance.now();
const stages: string[] = [];
let last = t0;
const log = (stage: string): void => {
  const now = performance.now();
  stages.push(`${stage} +${(now - last).toFixed(0)}ms`);
  last = now;
};
const w = real
  ? buildEarth(parseEarthElevation((() => { const f = readFileSync(`public/${EARTH_DATA_PATH}`); return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer; })()), log)
  : build({ ...preset.params, seed: Number(seedArg) >>> 0 }, log);
console.log(`build ${((performance.now() - t0) / 1000).toFixed(2)} s: ${stages.join(', ')}`);
const grid = Grid.get(w.level);

const bands = 18;
const acc = (): Float64Array => new Float64Array(bands);
const landA = acc(), landP = acc(), landT = acc(), oceanA = acc(), oceanP = acc(), oceanT = acc(), windU = acc(), cur = acc(), oro = acc(), conv = acc(), evap = acc();
const landC = acc(), oceanC = acc(), landSun = acc();
for (let i = 0; i < w.n; i++) {
  const b = Math.min(bands - 1, Math.floor((grid.lat[i] / DEG + 90) / 10));
  const a = grid.area[i];
  const land = w.elevation[i] >= w.seaLevel;
  if (land) {
    landA[b] += a;
    landP[b] += a * w.precipitation[i];
    landT[b] += a * w.temperatureAnnual[i];
    oro[b] += a * w.precipitationOrographic[i];
    conv[b] += a * w.precipitationConvergence[i];
    landC[b] += a * w.cloudAnnual[i];
    landSun[b] += a * w.sunshineHours[i];
  } else {
    oceanA[b] += a;
    oceanP[b] += a * w.precipitation[i];
    oceanT[b] += a * w.temperatureAnnual[i];
    cur[b] += a * Math.hypot(w.currentU[i], w.currentV[i]);
    evap[b] += a * w.evaporation[i];
    oceanC[b] += a * w.cloudAnnual[i];
  }
  windU[b] += a * windAt(w, i, ANNUAL)[0];
}
console.log('band      landP   oro  conv | oceanP  evap |  landT oceanT | cldL cldO  sunL |  u   | current');
for (let b = bands - 1; b >= 0; b--) {
  const la = landA[b] || NaN;
  const oa = oceanA[b] || NaN;
  const ta = landA[b] + oceanA[b];
  console.log(
    `${String(b * 10 - 90).padStart(4)}..${String(b * 10 - 80).padStart(3)} ` +
    `${(landP[b] / la).toFixed(0).padStart(6)} ${(oro[b] / la).toFixed(0).padStart(5)} ${(conv[b] / la).toFixed(0).padStart(5)} | ` +
    `${(oceanP[b] / oa).toFixed(0).padStart(6)} ${(evap[b] / oa).toFixed(0).padStart(5)} | ` +
    `${(landT[b] / la).toFixed(1).padStart(6)} ${(oceanT[b] / oa).toFixed(1).padStart(6)} | ` +
    `${(landC[b] / la).toFixed(2).padStart(4)} ${(oceanC[b] / oa).toFixed(2).padStart(4)} ${(landSun[b] / la).toFixed(0).padStart(5)} | ` +
    `${(windU[b] / ta).toFixed(1).padStart(4)} | ${(cur[b] / oa).toFixed(3)}`,
  );
}
let psiMax = 0;
for (let i = 0; i < w.n; i++) psiMax = Math.max(psiMax, Math.abs(w.streamfunction[i]));
const s = w.stats;
console.log(
  `global P ${s.meanPrecipitation.toFixed(0)} E ${s.meanEvaporation.toFixed(0)} landP ${s.meanLandPrecipitation.toFixed(0)} desert ${(s.desertFraction * 100).toFixed(0)}% wettest ${s.wettestMm.toFixed(0)} | ` +
  `basins ${s.oceanBasins} psiMax ${(psiMax / 1e6).toFixed(1)} Sv current max ${s.strongestCurrent.toFixed(2)} m/s anomaly ${s.warmestCurrentAnomaly.toFixed(1)}/${s.coldestCurrentAnomaly.toFixed(1)} | ` +
  `T mean ${s.meanTemperature.toFixed(1)} eq ${s.equatorTemperature.toFixed(1)} pole ${s.poleTemperature.toFixed(1)} | lakes ${s.lakeCount} (${s.endorheicLakeCount} closed) longest ${s.longestRiverKm.toFixed(0)} km largest ${s.largestRiverKm3.toFixed(0)}`,
);
console.log(
  `cloud mean ${s.meanCloudFraction.toFixed(2)} land sunshine ${s.meanLandSunshineHours.toFixed(0)} h/yr | cloud forcing SW ${s.cloudShortwaveForcing.toFixed(1)} LW ${s.cloudLongwaveForcing.toFixed(1)} W/m2 | ` +
  `ice sheets ${(s.iceSheetFraction * 100).toFixed(0)}% of land, sea ice ${(s.permanentSeaIceFraction * 100).toFixed(0)}% permanent ${(s.seasonalSeaIceFraction * 100).toFixed(0)}% seasonal | Koppen A${(s.koppen.A * 100).toFixed(0)} B${(s.koppen.B * 100).toFixed(0)} C${(s.koppen.C * 100).toFixed(0)} D${(s.koppen.D * 100).toFixed(0)} E${(s.koppen.E * 100).toFixed(0)}`,
);

if (real) {
  // Observed sunshine normals (hours per year, WMO-era station climatologies, rounded) for the calibration of the cloud model.
  const places: [string, number, number, number][] = [
    ['Yuma', 32.7, -114.6, 4000], ['Cairo', 30.0, 31.2, 3450], ['Alice Springs', -23.7, 133.9, 3500], ['Sahara (23N 10E)', 23, 10, 3600],
    ['Los Angeles', 34.0, -118.2, 3250], ['Lisbon', 38.7, -9.1, 2800], ['Tokyo', 35.7, 139.7, 1880], ['New York', 40.7, -74.0, 2530],
    ['London', 51.5, -0.1, 1600], ['Paris', 48.9, 2.3, 1660], ['Dublin', 53.3, -6.3, 1450], ['Reykjavik', 64.1, -21.9, 1270],
    ['Singapore', 1.3, 103.8, 2020], ['Manaus', -3.1, -60.0, 1900], ['Lima', -12.0, -77.0, 1280], ['Walvis Bay', -22.9, 14.5, 3000],
    ['Yakutsk', 62.0, 129.7, 2000], ['Vostok', -78.5, 106.8, 3700], ['Buenos Aires', -34.6, -58.4, 2525], ['Sao Paulo', -23.5, -46.6, 1900],
  ];
  console.log('place               model h/yr  obs  cloud   T     P');
  for (const [name, lat, lon, obs] of places) {
    const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
    const i = nearestCell(grid, x, y, z);
    console.log(
      `${name.padEnd(18)} ${w.sunshineHours[i].toFixed(0).padStart(10)} ${String(obs).padStart(5)} ${(100 * w.cloudAnnual[i]).toFixed(0).padStart(5)}% ${w.temperatureAnnual[i].toFixed(1).padStart(6)} ${w.precipitation[i].toFixed(0).padStart(5)}`,
    );
  }
}
