import { describe, expect, it } from 'vitest';
import { circulationCells } from '../src/sim/climate/circulation.ts';
import { ANNUAL, SAMPLES, SOLAR_CONSTANT, dailyMeanInsolation, daylightHours, declinations } from '../src/sim/climate/insolation.ts';
import { lapseRate } from '../src/sim/climate/temperature.ts';
import { DEG } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { temperatureAt, windAt } from '../src/render/layers.ts';

/** Short tectonic runs: the climate tests need a relief, not a mature one. */
const QUICK = { ...EARTH, tectonicAge: 50 };
const worlds: World[] = [1, 2, 3].map((seed) => build({ ...QUICK, seed }));

/** Area-weighted mean of a per-cell value over cells passing the filter, reduced to sea level when asked. */
function zonalMean(w: World, lo: number, hi: number, value: (i: number) => number, filter: (i: number) => boolean = () => true): number {
  const grid = Grid.get(w.level);
  let sum = 0;
  let area = 0;
  for (let i = 0; i < w.n; i++) {
    const a = Math.abs(grid.lat[i]) / DEG;
    if (a < lo || a >= hi || !filter(i)) continue;
    sum += grid.area[i] * value(i);
    area += grid.area[i];
  }
  return area > 0 ? sum / area : NaN;
}

function seaLevelTemperature(w: World, i: number): number {
  const height = Math.max(0, w.elevation[i] - w.seaLevel) / 1000;
  return w.temperatureAnnual[i] + lapseRate(w.params) * height;
}

describe('insolation', () => {
  it('gives S0/pi at the equator on an equinox and nothing in the polar night', () => {
    expect(dailyMeanInsolation(0, 0, SOLAR_CONSTANT)).toBeCloseTo(SOLAR_CONSTANT / Math.PI, 9);
    expect(dailyMeanInsolation(80 * DEG, -23 * DEG, SOLAR_CONSTANT)).toBe(0);
    expect(dailyMeanInsolation(80 * DEG, 23 * DEG, SOLAR_CONSTANT)).toBeGreaterThan(400);
  });

  it('averages S0/4 over the sphere and the year', () => {
    const grid = Grid.get(5);
    const decl = declinations(23.44);
    let sum = 0;
    let area = 0;
    for (let i = 0; i < grid.n; i++) {
      for (let s = 0; s < SAMPLES; s++) sum += grid.area[i] * dailyMeanInsolation(grid.lat[i], decl[s], SOLAR_CONSTANT);
      area += grid.area[i] * SAMPLES;
    }
    expect(sum / area).toBeCloseTo(SOLAR_CONSTANT / 4, 0);
  });
});

describe('daylight, clouds and sunshine (M20)', () => {
  it('gives twelve hours of daylight at the equator and on the equinox, polar day and night at 80 degrees', () => {
    expect(daylightHours(0, 23 * DEG)).toBeCloseTo(12, 9);
    expect(daylightHours(45 * DEG, 0)).toBeCloseTo(12, 9);
    expect(daylightHours(80 * DEG, 23 * DEG)).toBe(24);
    expect(daylightHours(80 * DEG, -23 * DEG)).toBe(0);
    expect(daylightHours(51.5 * DEG, 23.44 * DEG)).toBeGreaterThan(16);
    expect(daylightHours(51.5 * DEG, -23.44 * DEG)).toBeLessThan(8);
  });

  it('keeps the cloud cover between 0 and 1 with an Earth-like mean, and gives deserts more sun than rainforests', () => {
    for (const w of worlds) {
      let desertSun = 0;
      let deserts = 0;
      let wetSun = 0;
      let wets = 0;
      for (let i = 0; i < w.n; i++) {
        expect(w.cloudAnnual[i]).toBeGreaterThanOrEqual(0);
        expect(w.cloudAnnual[i]).toBeLessThanOrEqual(1);
        expect(w.sunshineHours[i]).toBeGreaterThanOrEqual(0);
        expect(w.sunshineHours[i]).toBeLessThanOrEqual(24 * 366);
        if (w.elevation[i] < w.seaLevel || w.iceSheet[i]) continue;
        if (w.precipitation[i] < 250) {
          desertSun += w.sunshineHours[i];
          deserts++;
        } else if (w.precipitation[i] > 1500) {
          wetSun += w.sunshineHours[i];
          wets++;
        }
      }
      for (let k = 0; k < SAMPLES * w.n; k += 7) {
        expect(w.cloud[k]).toBeGreaterThanOrEqual(0);
        expect(w.cloud[k]).toBeLessThanOrEqual(1);
      }
      expect(w.stats.meanCloudFraction).toBeGreaterThan(0.4);
      expect(w.stats.meanCloudFraction).toBeLessThan(0.8);
      expect(deserts).toBeGreaterThan(0);
      expect(wets).toBeGreaterThan(0);
      expect(desertSun / deserts).toBeGreaterThan(wetSun / wets + 500);
    }
  });
});

describe('temperature with the Earth preset', () => {
  it('has Earth-like zonal annual means at sea level', () => {
    for (const w of worlds) {
      const equator = zonalMean(w, 0, 5, (i) => seaLevelTemperature(w, i));
      const mid = zonalMean(w, 40, 50, (i) => seaLevelTemperature(w, i));
      const poles = zonalMean(w, 80, 91, (i) => seaLevelTemperature(w, i));
      expect(equator).toBeGreaterThan(20);
      expect(equator).toBeLessThan(30);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(equator);
      expect(poles).toBeGreaterThan(-35);
      expect(poles).toBeLessThan(-5);
    }
  });

  it('shows the lapse rate on mountains', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      let count = 0;
      for (let i = 0; i < w.n; i++) {
        const height = w.elevation[i] - w.seaLevel;
        if (height < 3000) continue;
        const a = Math.abs(grid.lat[i]) / DEG;
        const lowland = zonalMean(w, a - 3, a + 3, (j) => w.temperatureAnnual[j], (j) => w.elevation[j] >= w.seaLevel && w.elevation[j] - w.seaLevel < 500);
        if (Number.isNaN(lowland)) continue;
        expect(w.temperatureAnnual[i]).toBeLessThan(lowland - 10);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    }
  });

  it('gives the ocean a smaller seasonal swing than the land, lagging more', () => {
    for (const w of worlds) {
      expect(w.stats.oceanSeasonalRange).toBeLessThan(0.5 * w.stats.landSeasonalRange);
      expect(w.stats.landSeasonalRange).toBeGreaterThan(15);
      expect(w.stats.landSeasonalRange).toBeLessThan(45);
      // Warmest month: July-like (sample 6) on northern land, later over the ocean.
      const grid = Grid.get(w.level);
      let landPeak = 0;
      let oceanPeak = 0;
      let landCount = 0;
      let oceanCount = 0;
      for (let i = 0; i < w.n; i++) {
        const a = grid.lat[i] / DEG;
        if (a < 40 || a > 60) continue;
        let best = 0;
        for (let s = 1; s < SAMPLES; s++) if (temperatureAt(w, i, s) > temperatureAt(w, i, best)) best = s;
        if (w.elevation[i] >= w.seaLevel) {
          landPeak += best;
          landCount++;
        } else {
          oceanPeak += best;
          oceanCount++;
        }
      }
      expect(landPeak / landCount).toBeGreaterThan(5.5);
      expect(landPeak / landCount).toBeLessThan(7.5);
      expect(oceanPeak / oceanCount).toBeGreaterThan(landPeak / landCount);
    }
  });

  it('loses its seasons without tilt (bar the orbit) and cools with less insolation', () => {
    const flat = build({ ...QUICK, axialTiltDeg: 0, eccentricity: 0 });
    expect(flat.stats.landSeasonalRange).toBeLessThan(0.01);
    expect(flat.stats.oceanSeasonalRange).toBeLessThan(0.01);
    // Earth's small eccentricity alone leaves a faint cycle.
    const orbitOnly = build({ ...QUICK, axialTiltDeg: 0 });
    expect(orbitOnly.stats.landSeasonalRange).toBeGreaterThan(0.01);
    expect(orbitOnly.stats.landSeasonalRange).toBeLessThan(3);
    const dim = build({ ...QUICK, insolation: 0.85 });
    expect(dim.stats.meanTemperature).toBeLessThan(worlds[0].stats.meanTemperature - 5);
    expect(dim.globalMeanTemperature).toBeLessThan(worlds[0].globalMeanTemperature);
  });
});

describe('circulation', () => {
  it('has three cells for Earth, one for a slow rotator, more for a fast one', () => {
    expect(circulationCells(EARTH).cells).toBe(3);
    expect(circulationCells(EARTH).hadleyEdgeDeg).toBeCloseTo(30, 6);
    expect(circulationCells({ ...EARTH, rotationHours: 24 * 50 }).cells).toBe(1);
    expect(circulationCells({ ...EARTH, rotationHours: 24 * 100 }).cells).toBe(1);
    expect(circulationCells({ ...EARTH, rotationHours: 10 }).cells).toBeGreaterThan(3);
  });

  it('blows easterly trades and mid-latitude westerlies', () => {
    for (const w of worlds) {
      const trades = zonalMean(w, 8, 25, (i) => windAt(w, i, ANNUAL)[0]);
      const westerlies = zonalMean(w, 38, 55, (i) => windAt(w, i, ANNUAL)[0]);
      expect(trades).toBeLessThan(-1);
      expect(westerlies).toBeGreaterThan(1);
      // Trades converge on the equator: southward in the north, northward in the south.
      const grid = Grid.get(w.level);
      const north = zonalMean(w, 8, 25, (i) => windAt(w, i, ANNUAL)[1], (i) => grid.lat[i] > 0);
      const south = zonalMean(w, 8, 25, (i) => windAt(w, i, ANNUAL)[1], (i) => grid.lat[i] < 0);
      expect(north).toBeLessThan(0);
      expect(south).toBeGreaterThan(0);
    }
  });

  it('keeps a slow rotator meridional, with one cell per hemisphere', () => {
    const slow = build({ ...QUICK, rotationHours: 24 * 100 });
    expect(slow.circulation.cells).toBe(1);
    const zonal = zonalMean(slow, 0, 90, (i) => Math.abs(windAt(slow, i, ANNUAL)[0]));
    const meridional = zonalMean(slow, 0, 90, (i) => Math.abs(windAt(slow, i, ANNUAL)[1]));
    expect(zonal).toBeLessThan(0.3 * meridional);
  });
});
