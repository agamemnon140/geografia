import { describe, expect, it } from 'vitest';
import { ANNUAL } from '../src/sim/climate/insolation.ts';
import { meshGeometry } from '../src/sim/climate/mesh.ts';
import { DEG } from '../src/sim/grid/geometry.ts';
import { Grid, cellAreasKm2 } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { windAt } from '../src/render/layers.ts';

const QUICK = { ...EARTH, tectonicAge: 50 };
const worlds: World[] = [1, 2, 3].map((seed) => build({ ...QUICK, seed }));

function isLand(w: World, i: number): boolean {
  return w.elevation[i] >= w.seaLevel;
}

/** Area-weighted mean of a value over the cells passing the filter. */
function meanWhere(w: World, value: (i: number) => number, filter: (i: number) => boolean): number {
  const grid = Grid.get(w.level);
  let sum = 0;
  let area = 0;
  for (let i = 0; i < w.n; i++) {
    if (!filter(i)) continue;
    sum += grid.area[i] * value(i);
    area += grid.area[i];
  }
  return area > 0 ? sum / area : NaN;
}

function absLat(w: World, i: number): number {
  return Math.abs(Grid.get(w.level).lat[i]) / DEG;
}

describe('moisture with the Earth preset', () => {
  it('rains out what evaporates', () => {
    for (const w of worlds) {
      const areas = cellAreasKm2(Grid.get(w.level), w.radiusKm);
      let rain = 0;
      let evap = 0;
      for (let i = 0; i < w.n; i++) {
        rain += areas[i] * w.precipitation[i];
        evap += areas[i] * w.evaporation[i];
        expect(w.precipitation[i]).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(w.precipitation[i])).toBe(true);
      }
      expect(Math.abs(rain - evap) / evap).toBeLessThan(0.03);
      expect(w.stats.meanPrecipitation).toBeGreaterThan(800);
      expect(w.stats.meanPrecipitation).toBeLessThan(1300);
    }
  });

  it('is wettest near the equator and driest in the subtropics, with Earth-like land totals', () => {
    for (const w of worlds) {
      const p = (i: number): number => w.precipitation[i];
      const tropics = meanWhere(w, p, (i) => absLat(w, i) < 10);
      const subtropics = meanWhere(w, p, (i) => absLat(w, i) >= 18 && absLat(w, i) < 32);
      const midLatitudes = meanWhere(w, p, (i) => absLat(w, i) >= 40 && absLat(w, i) < 60);
      expect(tropics).toBeGreaterThan(subtropics);
      expect(midLatitudes).toBeGreaterThan(subtropics);
      const subtropicalLand = meanWhere(w, p, (i) => isLand(w, i) && absLat(w, i) >= 18 && absLat(w, i) < 32);
      expect(subtropicalLand).toBeLessThan(600);
      expect(w.stats.meanLandPrecipitation).toBeGreaterThan(500);
      expect(w.stats.meanLandPrecipitation).toBeLessThan(1300);
      expect(w.stats.desertFraction).toBeGreaterThan(0.05);
      expect(w.stats.desertFraction).toBeLessThan(0.45);
    }
  });

  it('keeps subtropical west coasts drier than east coasts', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      const mesh = meshGeometry(grid);
      const coast = (i: number, sign: number): boolean => {
        if (!isLand(w, i) || absLat(w, i) < 15 || absLat(w, i) > 35) return false;
        for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
          if (!isLand(w, grid.nb[t]) && mesh.east[t] * sign > 0.7) return true;
        }
        return false;
      };
      const west = meanWhere(w, (i) => w.precipitation[i], (i) => coast(i, -1));
      const east = meanWhere(w, (i) => w.precipitation[i], (i) => coast(i, 1));
      expect(west).toBeLessThan(east);
    }
  });

  it('leaves the lee of mountains drier than the windward side', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      const mesh = meshGeometry(grid);
      let windward = 0;
      let lee = 0;
      let count = 0;
      for (let m = 0; m < w.n; m++) {
        if (!isLand(w, m) || w.elevation[m] - w.seaLevel < 2000) continue;
        const [u, v] = windAt(w, m, ANNUAL);
        const speed = Math.hypot(u, v);
        if (speed < 2) continue;
        let up = 0;
        let upCount = 0;
        let down = 0;
        let downCount = 0;
        for (let t = grid.nbStart[m]; t < grid.nbStart[m + 1]; t++) {
          const j = grid.nb[t];
          if (!isLand(w, j)) continue;
          const along = (u * mesh.east[t] + v * mesh.north[t]) / speed;
          if (along < -0.5) {
            up += w.precipitation[j];
            upCount++;
          } else if (along > 0.5) {
            down += w.precipitation[j];
            downCount++;
          }
        }
        if (upCount === 0 || downCount === 0) continue;
        windward += up / upCount;
        lee += down / downCount;
        count++;
      }
      expect(count).toBeGreaterThan(10);
      expect(lee).toBeLessThan(windward);
    }
  });
});

describe('ocean currents with the Earth preset', () => {
  it('turns one way per hemisphere in the subtropics and flows westward under the trades', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      const north = meanWhere(w, (i) => w.streamfunction[i], (i) => w.basin[i] >= 0 && grid.lat[i] / DEG > 15 && grid.lat[i] / DEG < 40);
      const south = meanWhere(w, (i) => w.streamfunction[i], (i) => w.basin[i] >= 0 && grid.lat[i] / DEG < -15 && grid.lat[i] / DEG > -40);
      expect(north).toBeGreaterThan(0);
      expect(south).toBeLessThan(0);
      const trades = meanWhere(w, (i) => w.currentU[i], (i) => w.basin[i] >= 0 && absLat(w, i) > 12 && absLat(w, i) < 25);
      const westerlies = meanWhere(w, (i) => w.currentU[i], (i) => w.basin[i] >= 0 && absLat(w, i) > 35 && absLat(w, i) < 50);
      expect(trades).toBeLessThan(0);
      expect(westerlies).toBeGreaterThan(0);
      expect(w.stats.strongestCurrent).toBeGreaterThan(0.05);
      expect(w.stats.strongestCurrent).toBeLessThanOrEqual(2.5);
    }
  });

  it('warms western boundaries and cools eastern ones', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      const mesh = meshGeometry(grid);
      const boundary = (i: number, sign: number): boolean => {
        if (w.basin[i] < 0 || absLat(w, i) < 20 || absLat(w, i) > 45) return false;
        for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
          if (isLand(w, grid.nb[t]) && mesh.east[t] * sign > 0.7) return true;
        }
        return false;
      };
      const western = meanWhere(w, (i) => w.sstAnomaly[i], (i) => boundary(i, -1));
      const eastern = meanWhere(w, (i) => w.sstAnomaly[i], (i) => boundary(i, 1));
      expect(western).toBeGreaterThan(eastern);
      expect(western).toBeGreaterThan(0);
      expect(w.stats.warmestCurrentAnomaly).toBeGreaterThan(1);
      expect(w.stats.coldestCurrentAnomaly).toBeLessThan(-1);
    }
  });
});
