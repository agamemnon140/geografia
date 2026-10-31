import { describe, expect, it } from 'vitest';
import { REFERENCE_CELL_KM } from '../src/sim/constants.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH, validateParams } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { TectonicsSim } from '../src/sim/tectonics/simulation.ts';

const params = validateParams({ ...EARTH, seed: 2 });

describe('resolution independence', () => {
  it('measures the grid in reference cells and converts speeds to kilometers per step', () => {
    const coarse = new TectonicsSim(Grid.get(6), params, new Rng(2).fork('tectonics'));
    const fine = new TectonicsSim(Grid.get(7), params, new Rng(2).fork('tectonics'));
    expect(coarse.cellsPerUnit).toBeCloseTo(1, 1);
    expect(fine.cellsPerUnit).toBeCloseTo(2, 1);
    expect(coarse.unitAngle).toBeCloseTo(fine.unitAngle, 12);
    expect(coarse.cellKm).toBeCloseTo(REFERENCE_CELL_KM, 0);
    // The same initial condition: plate speeds in kilometers per step do not depend on the grid.
    const kmPerStep = (sim: TectonicsSim): number => sim.plates.reduce((s, p) => s + p.rate * params.radiusKm, 0) / sim.plates.length;
    expect(Math.abs(kmPerStep(fine) - kmPerStep(coarse)) / kmPerStep(coarse)).toBeLessThan(0.05);
    expect(kmPerStep(coarse)).toBeGreaterThan(15);
    expect(kmPerStep(coarse)).toBeLessThan(60);
  });

  it('gives the fine grid the same planet in kilometers: land share and relief within a few points', () => {
    const quick = { ...params, tectonicAge: 50 };
    const coarse = build(quick);
    const fine = build(quick, () => {}, { coarser: -1 });
    expect(fine.level).toBe(7);
    expect(fine.n).toBe(163842);
    expect(Math.abs(fine.stats.oceanFraction - coarse.stats.oceanFraction)).toBeLessThan(0.06);
    const ratio = fine.stats.meanLandElevation / coarse.stats.meanLandElevation;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.7);
    expect(Math.abs(fine.stats.meanTemperature - coarse.stats.meanTemperature)).toBeLessThan(3);
    for (let i = 0; i < fine.n; i += 101) expect(Number.isFinite(fine.elevation[i])).toBe(true);
  });
});
