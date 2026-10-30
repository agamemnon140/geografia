/**
 * Zonal diagnostics of the climate stage, for tuning:
 *   node scripts/diag-climate.ts [preset] [seed]
 * Prints per 10-degree band the land and ocean precipitation, temperature,
 * zonal wind and current, then global moisture and ocean summaries.
 */
import { readFileSync } from 'node:fs';
import { EARTH_DATA_PATH, buildEarth, parseEarthElevation } from '../src/sim/earth.ts';
import { DEG } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
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
  } else {
    oceanA[b] += a;
    oceanP[b] += a * w.precipitation[i];
    oceanT[b] += a * w.temperatureAnnual[i];
    cur[b] += a * Math.hypot(w.currentU[i], w.currentV[i]);
    evap[b] += a * w.evaporation[i];
  }
  windU[b] += a * windAt(w, i, ANNUAL)[0];
}
console.log('band      landP   oro  conv | oceanP  evap |  landT oceanT |  u   | current');
for (let b = bands - 1; b >= 0; b--) {
  const la = landA[b] || NaN;
  const oa = oceanA[b] || NaN;
  const ta = landA[b] + oceanA[b];
  console.log(
    `${String(b * 10 - 90).padStart(4)}..${String(b * 10 - 80).padStart(3)} ` +
    `${(landP[b] / la).toFixed(0).padStart(6)} ${(oro[b] / la).toFixed(0).padStart(5)} ${(conv[b] / la).toFixed(0).padStart(5)} | ` +
    `${(oceanP[b] / oa).toFixed(0).padStart(6)} ${(evap[b] / oa).toFixed(0).padStart(5)} | ` +
    `${(landT[b] / la).toFixed(1).padStart(6)} ${(oceanT[b] / oa).toFixed(1).padStart(6)} | ` +
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
