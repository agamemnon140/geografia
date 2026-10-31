import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH, validateParams } from '../src/sim/params.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { OCEANIC, ROLLBACK_MIN_TRENCH, SLIVER_MIN_LENGTH } from '../src/sim/tectonics/crust.ts';
import { TectonicsSim } from '../src/sim/tectonics/simulation.ts';

const grid = Grid.get(6);
const params = validateParams({ ...EARTH, seed: 2 });

function freshSim(): TectonicsSim {
  return new TectonicsSim(grid, params, new Rng(params.seed).fork('tectonics'));
}

describe('margin events', () => {
  it('opens a back-arc basin: the arc becomes its own plate and a marginal sea grows behind it', () => {
    const sim = freshSim();
    sim.run(20);
    let parent = -1;
    let trench: { other: number; cells: number[]; meanAge: number } | null = null;
    for (let p = 0; p < sim.plates.length; p++) {
      if (sim.dead[p]) continue;
      const found = sim.findRollback(p);
      if (found && (!trench || found.cells.length > trench.cells.length)) {
        trench = found;
        parent = p;
      }
    }
    expect(trench).not.toBeNull();
    const cells = (trench as { cells: number[] }).cells;
    expect(cells.length).toBeGreaterThanOrEqual(ROLLBACK_MIN_TRENCH);
    const before = sim.continentalVolume();
    const arc = sim.rollback(parent, cells);
    expect(arc).toBeGreaterThanOrEqual(params.plateCount);
    // Parcels only change plate at the instant of the split: nothing is created or lost.
    expect(sim.continentalVolume()).toBeCloseTo(before, 6);
    expect(sim.events[sim.events.length - 1]).toEqual({ step: 20, type: 'rollback', plate: arc, other: parent });
    sim.run(25);
    let arcCells = 0;
    let marginalSea = 0;
    for (let j = 0; j < grid.n; j++) {
      const p = sim.wPlate[j];
      if (p === arc) arcCells++;
      if (p !== arc && p !== parent) continue;
      const i = sim.wParcel[j];
      if (sim.pool.crustType[i] !== OCEANIC || sim.pool.age[i] > 25) continue;
      for (const nb of grid.neighbors(j)) {
        if (sim.wPlate[nb] === (p === arc ? parent : arc)) {
          marginalSea++;
          break;
        }
      }
    }
    expect(arcCells).toBeGreaterThan(10);
    expect(marginalSea).toBeGreaterThan(3);
  });

  it('captures a sliver of coast onto the oceanic plate sliding past it', () => {
    const sim = freshSim();
    sim.run(30);
    let donor = -1;
    let coast: { other: number; cells: number[] } | null = null;
    for (let p = 0; p < sim.plates.length; p++) {
      if (sim.dead[p]) continue;
      const found = sim.findSliver(p);
      if (found && (!coast || found.cells.length > coast.cells.length)) {
        coast = found;
        donor = p;
      }
    }
    expect(coast).not.toBeNull();
    const found = coast as { other: number; cells: number[] };
    expect(found.cells.length).toBeGreaterThanOrEqual(SLIVER_MIN_LENGTH);
    const before = sim.continentalVolume();
    const areaBefore = sim.continentalArea(found.other);
    const moved = sim.capture(donor, found.other, found.cells);
    expect(moved).toBeGreaterThanOrEqual(SLIVER_MIN_LENGTH);
    // Resampling into the other frame shifts cell areas a little; the crust itself is all there.
    expect(Math.abs(sim.continentalVolume() - before) / before).toBeLessThan(0.05);
    expect(sim.events[sim.events.length - 1]).toEqual({ step: 30, type: 'capture', plate: found.other, other: donor });
    sim.run(5);
    expect(sim.continentalArea(found.other)).toBeGreaterThan(areaBefore);
  });
});
