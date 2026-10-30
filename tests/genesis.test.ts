import { describe, expect, it } from 'vitest';
import { Grid, cellAreasKm2 } from '../src/sim/grid/grid.ts';
import { EARTH, validateParams } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { CONTINENTAL_FRACTION, thicknessCap } from '../src/sim/tectonics/crust.ts';
import { genesis } from '../src/sim/tectonics/genesis.ts';
import { BOUNDARY_DIVERGENT, TectonicsSim } from '../src/sim/tectonics/simulation.ts';

const grid = Grid.get(6);
const params = validateParams({ ...EARTH, seed: 1 });
const cellAngle = Math.sqrt((4 * Math.PI) / grid.n);

describe('the initial condition', () => {
  const g = genesis(grid, params.plateCount, new Rng(1).fork('tectonics').fork('genesis'), cellAngle, 1);

  it('seeds the requested share of continental crust and plates of unequal size', () => {
    const areas = cellAreasKm2(grid, params.radiusKm);
    let total = 0;
    let continental = 0;
    const perPlate = new Float64Array(params.plateCount);
    for (let i = 0; i < grid.n; i++) {
      total += areas[i];
      if (g.isContinental[i]) continental += areas[i];
      perPlate[g.plateOf[i]] += areas[i];
    }
    expect(Math.abs(continental / total - CONTINENTAL_FRACTION)).toBeLessThan(0.02);
    let largest = 0;
    let smallest = Infinity;
    for (const a of perPlate) {
      largest = Math.max(largest, a);
      smallest = Math.min(smallest, a);
      expect(a).toBeGreaterThan(0);
    }
    expect(largest / smallest).toBeGreaterThan(2.5);
  });

  it('opens young oceans along the three junction rifts, each between two different plates', () => {
    const xyz = grid.xyz;
    for (let k = 0; k < 3; k++) {
      const m = g.riftNormals[k];
      const c = g.core;
      // A tangent direction along the great circle at the core: the rift occupies one half (ray).
      const along = [m[1] * c[2] - m[2] * c[1], m[2] * c[0] - m[0] * c[2], m[0] * c[1] - m[1] * c[0]];
      const oceanic = [0, 0];
      const cells: { i: number; d: number; ray: number }[] = [];
      for (let i = 0; i < grid.n; i++) {
        const nearCore = xyz[3 * i] * c[0] + xyz[3 * i + 1] * c[1] + xyz[3 * i + 2] * c[2];
        if (nearCore < Math.cos(0.8)) continue;
        const d = xyz[3 * i] * m[0] + xyz[3 * i + 1] * m[1] + xyz[3 * i + 2] * m[2];
        if (Math.abs(d) > 6.5 * cellAngle) continue;
        const ray = xyz[3 * i] * along[0] + xyz[3 * i + 1] * along[1] + xyz[3 * i + 2] * along[2] > 0 ? 0 : 1;
        cells.push({ i, d, ray });
        if (Math.abs(d) < 2.5 * cellAngle && !g.isContinental[i]) oceanic[ray]++;
      }
      // The rift half is the one that holds the young ocean; the other half crosses a wedge.
      const riftHalf = oceanic[0] >= oceanic[1] ? 0 : 1;
      const sides = [new Map<number, number>(), new Map<number, number>()];
      let youngest = Infinity;
      let bandCells = 0;
      for (const { i, d, ray } of cells) {
        if (ray !== riftHalf) continue;
        if (Math.abs(d) < 2.5 * cellAngle && !g.isContinental[i]) {
          bandCells++;
          youngest = Math.min(youngest, g.oceanAge[i]);
        }
        // Plates are read a few cells away from the center, beyond the warp of the boundaries.
        if (Math.abs(d) < 3.5 * cellAngle) continue;
        const side = sides[d > 0 ? 0 : 1];
        side.set(g.plateOf[i], (side.get(g.plateOf[i]) ?? 0) + 1);
      }
      const dominant = (s: Map<number, number>): number => [...s.entries()].sort((a, b) => b[1] - a[1])[0][0];
      expect(bandCells).toBeGreaterThan(20);
      expect(youngest).toBeLessThan(3);
      expect(dominant(sides[0])).not.toBe(dominant(sides[1]));
    }
  });

  it('starts the simulation with divergent boundaries along the rifts and the cap respected', () => {
    const sim = new TectonicsSim(grid, params, new Rng(1).fork('tectonics'));
    let divergent = 0;
    for (let j = 0; j < grid.n; j++) if (sim.boundary[j] === BOUNDARY_DIVERGENT) divergent++;
    expect(divergent).toBeGreaterThan(100);
    sim.run(30);
    const cap = thicknessCap(1);
    for (let i = 0; i < sim.pool.count; i++) {
      if (sim.pool.alive[i]) expect(sim.pool.thickness[i]).toBeLessThanOrEqual(cap + 1);
    }
  });
});

describe('continents after an Earth-like history', () => {
  const worlds: World[] = [1, 2, 3].map((seed) => build({ ...EARTH, seed }));

  it('are few, unequal and hold the crust under the cap', () => {
    const cap = thicknessCap(1);
    for (const w of worlds) {
      const s = w.stats;
      expect(s.continents).toBeGreaterThanOrEqual(3);
      expect(s.continents).toBeLessThanOrEqual(10);
      expect(s.largestLandmassKm2 / (s.landFraction * s.totalAreaKm2)).toBeGreaterThan(0.2);
      expect(s.maxThickness).toBeLessThanOrEqual(cap + 1);
      expect(s.maxElevation).toBeLessThan(12000);
    }
  });
});
