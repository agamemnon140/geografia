import { describe, expect, it } from 'vitest';
import { Grid, cellAreasKm2 } from '../src/sim/grid/grid.ts';
import { RUNOFF_COEFFICIENT } from '../src/sim/hydrology/precipitation.ts';
import { Hydrology } from '../src/sim/hydrology/routing.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';

const SEEDS = [1, 2, 3];
const worlds: World[] = SEEDS.map((seed) => build({ ...EARTH, seed }));

function isLand(w: World, i: number): boolean {
  return w.elevation[i] >= w.seaLevel;
}

describe('hydrology with the Earth preset', () => {
  it('routes every land cell to the ocean or a lake, without cycles', () => {
    for (const w of worlds) {
      let longestPath = 0;
      for (let i = 0; i < w.n; i++) {
        if (!isLand(w, i)) continue;
        let cur = i;
        let hops = 0;
        while (w.downstream[cur] >= 0) {
          cur = w.downstream[cur];
          hops++;
          if (hops > w.n) throw new Error(`cycle in the drainage tree from cell ${i}`);
        }
        if (hops > longestPath) longestPath = hops;
        const endsInWater = !isLand(w, cur) || w.lake[cur] >= 0;
        expect(endsInWater).toBe(true);
      }
      expect(longestPath).toBeGreaterThan(10);
    }
  });

  it('never flows uphill on the water surface', () => {
    for (const w of worlds) {
      for (let i = 0; i < w.n; i++) {
        const d = w.downstream[i];
        if (d < 0) continue;
        expect(w.waterLevel[d]).toBeLessThanOrEqual(w.waterLevel[i] + 1e-9);
        if (w.lake[i] < 0) expect(w.elevation[d]).toBeLessThanOrEqual(w.elevation[i] + 1e-9);
      }
    }
  });

  it('has non-decreasing discharge downstream and delivers all runoff to the ocean or closed basins', () => {
    for (const w of worlds) {
      const areas = cellAreasKm2(Grid.get(w.level), w.radiusKm);
      let runoff = 0;
      let delivered = 0;
      for (let i = 0; i < w.n; i++) {
        const d = w.downstream[i];
        if (d >= 0) expect(w.discharge[d]).toBeGreaterThanOrEqual(w.discharge[i]);
        else delivered += w.discharge[i];
        if (isLand(w, i)) runoff += w.precipitation[i] * 1e-6 * RUNOFF_COEFFICIENT * areas[i];
      }
      expect(delivered).toBeCloseTo(runoff, 6);
    }
  });

  it('keeps lake water above the lake bed, at one level per open lake', () => {
    for (const w of worlds) {
      const counts = new Int32Array(w.lakes.length);
      for (let i = 0; i < w.n; i++) {
        expect(w.waterLevel[i]).toBeGreaterThanOrEqual(w.elevation[i]);
        const id = w.lake[i];
        if (id < 0) {
          expect(w.waterLevel[i]).toBe(w.elevation[i]);
          continue;
        }
        counts[id]++;
        const lake = w.lakes[id];
        expect(isLand(w, i)).toBe(true);
        if (!lake.endorheic) {
          expect(w.waterLevel[i]).toBe(lake.level);
          expect(w.waterLevel[i]).toBeGreaterThan(w.elevation[i]);
        }
      }
      for (const lake of w.lakes) {
        expect(counts[lake.id]).toBe(lake.cells);
        if (lake.endorheic) {
          expect(lake.outlet).toBe(-1);
          expect(lake.inflowKm3).toBeLessThan(lake.evaporationFullKm3);
        } else {
          expect(lake.outlet).toBeGreaterThanOrEqual(0);
          expect(w.lake[lake.outlet]).not.toBe(lake.id);
        }
      }
    }
  });

  it('produces Earth-like rivers, lakes and precipitation', () => {
    for (const w of worlds) {
      const s = w.stats;
      expect(s.meanLandPrecipitation).toBeGreaterThan(500);
      expect(s.meanLandPrecipitation).toBeLessThan(1300);
      expect(s.lakeCount).toBeGreaterThan(10);
      // Interior basins below sea level that lost their outlet fill as inland seas (a Caspian).
      expect(s.lakeFraction).toBeLessThan(0.08);
      expect(s.longestRiverKm).toBeGreaterThan(2500);
      expect(s.largestRiverKm3).toBeGreaterThan(300);
      expect(s.endorheicLandFraction).toBeLessThan(0.25);
    }
  });

  it('erodes the land toward an Earth-like mean elevation', () => {
    for (const w of worlds) {
      // Earth's bedrock averages about 650 m without its ice; a planet whose continents dispersed
      // from one supercontinent without a major collision is flatter (M13 calibration: 0.3 to 0.55 km).
      expect(w.stats.meanLandElevation).toBeGreaterThan(250);
      expect(w.stats.meanLandElevation).toBeLessThan(1300);
      let erodedCells = 0;
      for (let i = 0; i < w.n; i++) if (w.eroded[i] > 100) erodedCells++;
      expect(erodedCells / w.n).toBeGreaterThan(0.05);
    }
  });
});

describe('routing on a synthetic relief', () => {
  const grid = Grid.get(4);
  const areas = cellAreasKm2(grid, EARTH.radiusKm);
  // A plateau at 1000 m with a southern ocean and one bowl two hops wide around a pit.
  const pit = (() => {
    let best = 0;
    for (let i = 0; i < grid.n; i++) if (Math.abs(grid.lat[i]) + Math.abs(grid.lon[i]) < Math.abs(grid.lat[best]) + Math.abs(grid.lon[best])) best = i;
    return best;
  })();
  const elevation = new Float64Array(grid.n).fill(1000);
  for (let i = 0; i < grid.n; i++) if (grid.lat[i] < -1.0) elevation[i] = -3000;
  const ring: number[] = [];
  for (const nb of grid.neighbors(pit)) {
    elevation[nb] = 500;
    ring.push(nb);
  }
  elevation[pit] = 100;
  const seaLevel = 0;

  it('fills the bowl to its spill point when inflow beats evaporation', () => {
    const hydro = new Hydrology(grid, areas, EARTH.radiusKm);
    hydro.precipitation.fill(20000);
    hydro.run(elevation, seaLevel);
    expect(hydro.lakes.length).toBe(1);
    const lake = hydro.lakes[0];
    expect(lake.endorheic).toBe(false);
    expect(lake.level).toBe(1000);
    expect(lake.cells).toBe(1 + ring.length);
    expect(hydro.lake[pit]).toBe(0);
    for (const r of ring) expect(hydro.lake[r]).toBe(0);
    expect(elevation[lake.outlet]).toBe(1000);
    expect(hydro.waterLevel[pit]).toBe(1000);
    // Everything on the plateau still reaches the ocean.
    let cur = pit;
    while (hydro.downstream[cur] >= 0) cur = hydro.downstream[cur];
    expect(elevation[cur]).toBe(-3000);
  });

  it('shrinks the lake into a closed basin when evaporation beats inflow', () => {
    const hydro = new Hydrology(grid, areas, EARTH.radiusKm);
    hydro.precipitation.fill(200);
    hydro.run(elevation, seaLevel);
    expect(hydro.lakes.length).toBe(1);
    const lake = hydro.lakes[0];
    expect(lake.endorheic).toBe(true);
    expect(lake.outlet).toBe(-1);
    expect(lake.cells).toBeLessThan(1 + ring.length);
    expect(hydro.lake[pit]).toBe(0);
    expect(hydro.downstream[pit]).toBe(-1);
    expect(hydro.waterLevel[pit]).toBeGreaterThan(100);
    expect(hydro.waterLevel[pit]).toBeLessThan(1000);
    // The ring drains into the pit, and the pit keeps all the basin's water.
    for (const r of ring) {
      let cur = r;
      while (hydro.downstream[cur] >= 0) cur = hydro.downstream[cur];
      expect(cur).toBe(pit);
    }
    expect(hydro.discharge[pit]).toBeCloseTo(lake.inflowKm3, 9);
  });
});
