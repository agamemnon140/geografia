import { describe, expect, it } from 'vitest';
import { Grid, cellAreasKm2 } from '../src/sim/grid/grid.ts';
import { EARTH, validateParams } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { CONTINENTAL_FRACTION, CONTINENTAL_THICKNESS_KM, thicknessCap } from '../src/sim/tectonics/crust.ts';
import { BASIN_AMPLITUDE_KM, MARGIN_PASSIVE_KM, RIFT_EDGE_AGE, genesis } from '../src/sim/tectonics/genesis.ts';
import { riftAngle, riftDistance } from '../src/sim/tectonics/riftpath.ts';
import { BOUNDARY_DIVERGENT, TectonicsSim } from '../src/sim/tectonics/simulation.ts';

const grid = Grid.get(6);
const params = validateParams({ ...EARTH, seed: 1 });
const cellAngle = Math.sqrt((4 * Math.PI) / grid.n);
const areas = cellAreasKm2(grid, params.radiusKm);

/** Area of the largest connected component of the mask, and the total area under it. */
function largestComponent(mask: Uint8Array): [number, number] {
  const seen = new Uint8Array(grid.n);
  const stack: number[] = [];
  let largest = 0;
  let total = 0;
  for (let i = 0; i < grid.n; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length > 0) {
      const k = stack.pop() as number;
      area += areas[k];
      for (const nb of grid.neighbors(k)) {
        if (mask[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    total += area;
    largest = Math.max(largest, area);
  }
  return [largest, total];
}

describe('the initial condition', () => {
  const g = genesis(grid, params.plateCount, new Rng(1).fork('tectonics').fork('genesis'), cellAngle, 1);

  it('seeds the requested share of continental crust as one supercontinent, on plates of unequal size', () => {
    let total = 0;
    const perPlate = new Float64Array(params.plateCount);
    for (let i = 0; i < grid.n; i++) {
      total += areas[i];
      perPlate[g.plateOf[i]] += areas[i];
    }
    const [largest, continental] = largestComponent(g.isContinental);
    expect(Math.abs(continental / total - CONTINENTAL_FRACTION)).toBeLessThan(0.025);
    // One mass holds nearly everything; a far microcontinent may hold the rest. No scattered islands.
    expect(largest / continental).toBeGreaterThan(0.75);
    let biggest = 0;
    let smallest = Infinity;
    for (const a of perPlate) {
      biggest = Math.max(biggest, a);
      smallest = Math.min(smallest, a);
      expect(a).toBeGreaterThan(0);
    }
    expect(biggest / smallest).toBeGreaterThan(2.5);
  });

  it('opens a young ocean along the first rift, with a different plate on each side', () => {
    const xyz = grid.xyz;
    const c = g.core;
    const sides = [new Map<number, number>(), new Map<number, number>()];
    let youngCells = 0;
    let youngest = Infinity;
    for (let i = 0; i < grid.n; i++) {
      const x = xyz[3 * i];
      const y = xyz[3 * i + 1];
      const z = xyz[3 * i + 2];
      if (x * c[0] + y * c[1] + z * c[2] < Math.cos(0.7)) continue;
      const d = riftDistance(g.rift, x, y, z);
      if (Math.abs(d) < 2 * cellAngle && !g.isContinental[i] && g.oceanAge[i] <= RIFT_EDGE_AGE[1]) {
        youngCells++;
        youngest = Math.min(youngest, g.oceanAge[i]);
      }
      if (Math.abs(d) < 3.5 * cellAngle || Math.abs(d) > 8 * cellAngle) continue;
      const side = sides[d > 0 ? 1 : 0];
      side.set(g.plateOf[i], (side.get(g.plateOf[i]) ?? 0) + 1);
    }
    const dominant = (s: Map<number, number>): number => [...s.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(youngCells).toBeGreaterThan(15);
    expect(youngest).toBeLessThan(3);
    expect(dominant(sides[0])).toBe(g.sides[0]);
    expect(dominant(sides[1])).toBe(g.sides[1]);
    expect(Number.isFinite(riftAngle(g.rift, c[0], c[1], c[2]))).toBe(true);
  });

  it('stretches the margins and keeps the interior near full thickness, with basins', () => {
    let continental = 0;
    let thin = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < grid.n; i++) {
      if (!g.isContinental[i]) {
        expect(g.thickness[i]).toBe(0);
        continue;
      }
      continental++;
      const t = g.thickness[i];
      min = Math.min(min, t);
      max = Math.max(max, t);
      if (t < 30) thin++;
    }
    expect(min).toBeGreaterThanOrEqual(MARGIN_PASSIVE_KM[0]);
    expect(max).toBeLessThanOrEqual(CONTINENTAL_THICKNESS_KM + BASIN_AMPLITUDE_KM + 1e-9);
    expect(thin / continental).toBeGreaterThan(0.04);
    expect(thin / continental).toBeLessThan(0.35);
  });

  it('starts the simulation with divergent boundaries along the rift and the cap respected', () => {
    const sim = new TectonicsSim(grid, params, new Rng(1).fork('tectonics'));
    let divergent = 0;
    for (let j = 0; j < grid.n; j++) if (sim.boundary[j] === BOUNDARY_DIVERGENT) divergent++;
    expect(divergent).toBeGreaterThan(60);
    sim.run(30);
    const cap = thicknessCap(1);
    for (let i = 0; i < sim.pool.count; i++) {
      if (sim.pool.alive[i]) expect(sim.pool.thickness[i]).toBeLessThanOrEqual(cap + 1);
    }
  });
});

describe('a rift born to fail', () => {
  it('welds its child back onto the parent within a few tens of steps and records the failure', () => {
    const sim = new TectonicsSim(grid, params, new Rng(1).fork('tectonics'));
    const parent = 0;
    const child = sim.rift(parent, true);
    expect(child).toBe(params.plateCount);
    sim.run(45);
    expect(sim.dead[child]).toBe(true);
    const fail = sim.events.find((e) => e.type === 'fail');
    expect(fail).toBeDefined();
    expect(fail?.plate).toBe(child);
    expect(fail?.other).toBe(parent);
    expect(fail?.step).toBeGreaterThanOrEqual(10);
    expect(fail?.step).toBeLessThanOrEqual(40);
  });
});

describe('continents after an Earth-like history', () => {
  const worlds: World[] = [1, 2, 3].map((seed) => build({ ...EARTH, seed }));

  it('are few, with one dominant landmass, and hold the crust under the cap', () => {
    const cap = thicknessCap(1);
    for (const w of worlds) {
      const s = w.stats;
      expect(s.continents).toBeGreaterThanOrEqual(2);
      // Remnant and marginal seas cut the land more than Earth's do today (Earth: 4 to 7 with Greenland).
      expect(s.continents).toBeLessThanOrEqual(9);
      expect(s.largestLandmassKm2 / (s.landFraction * s.totalAreaKm2)).toBeGreaterThan(0.35);
      expect(s.maxThickness).toBeLessThanOrEqual(cap + 1);
      expect(s.maxElevation).toBeLessThan(12000);
    }
  });
});
