import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { BOUNDARY_DIVERGENT, TectonicsSim } from '../src/sim/tectonics/simulation.ts';

function freshSim(seed = 1): TectonicsSim {
  return new TectonicsSim(Grid.get(6), { ...EARTH, seed }, new Rng(seed).fork('tectonics'));
}

/** Plate carrying the most continental area. */
function biggestContinent(sim: TectonicsSim): number {
  let best = 0;
  let bestArea = -1;
  for (let p = 0; p < sim.plates.length; p++) {
    const area = sim.continentalArea(p);
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return best;
}

describe('plate births and deaths', () => {
  it('rifts a continent into two diverging plates and conserves its crust', () => {
    const sim = freshSim();
    const parent = biggestContinent(sim);
    const before = sim.continentalVolume();
    const childArea = sim.continentalArea(parent);
    const child = sim.rift(parent);
    expect(child).toBe(EARTH.plateCount);
    expect(sim.plates.length).toBe(EARTH.plateCount + 1);
    expect(sim.continentalVolume()).toBeCloseTo(before, 6);
    sim.run(15);
    // Other rifts may follow in those steps (a supercontinent rifts whether it moves or not).
    expect(sim.activePlates()).toBeGreaterThanOrEqual(EARTH.plateCount + 1);
    // Both halves kept continental crust, and the contact between them opened.
    expect(sim.continentalArea(child)).toBeGreaterThan(0.1 * childArea);
    expect(sim.continentalArea(parent)).toBeGreaterThan(0.1 * childArea);
    const grid = sim.grid;
    let divergent = 0;
    let contact = 0;
    for (let j = 0; j < grid.n; j++) {
      if (sim.wPlate[j] !== child) continue;
      let touchesParent = false;
      for (const nb of grid.neighbors(j)) if (sim.wPlate[nb] === parent) touchesParent = true;
      if (!touchesParent) continue;
      contact++;
      if (sim.boundary[j] === BOUNDARY_DIVERGENT) divergent++;
    }
    expect(contact).toBeGreaterThan(5);
    expect(divergent / contact).toBeGreaterThan(0.5);
    expect(sim.events[0]).toEqual({ step: 0, type: 'rift', plate: child, other: parent });
    expect((sim.continentalVolume() + sim.erodedContinental) / before).toBeGreaterThan(0.97);
  });

  it('merges a plate into its neighbor, keeping its crust', () => {
    const sim = freshSim();
    const a = biggestContinent(sim);
    const [b] = sim.longestSuture(a);
    const other = b >= 0 ? b : (a + 1) % EARTH.plateCount;
    const before = sim.continentalVolume();
    const areaA = sim.continentalArea(a);
    sim.merge(a, other);
    for (let i = 0; i < sim.pool.count; i++) if (sim.pool.alive[i]) expect(sim.pool.plate[i]).not.toBe(a);
    expect(sim.dead[a]).toBe(true);
    // Resampling into the other frame shifts cell areas a little; the thickness itself is all there.
    expect(Math.abs(sim.continentalVolume() - before) / before).toBeLessThan(0.05);
    sim.run(5);
    expect(sim.activePlates()).toBeLessThanOrEqual(EARTH.plateCount - 1);
    expect(sim.continentalArea(a)).toBe(0);
    expect(sim.continentalArea(other)).toBeGreaterThan(0.8 * areaA);
    expect(sim.events[0]).toEqual({ step: 0, type: 'merge', plate: a, other });
  });

  it('lets plates be born and die over an Earth-like history', () => {
    let events = 0;
    for (const seed of [1, 2, 3]) {
      const w = build({ ...EARTH, seed });
      events += w.events.length;
      expect(w.plates.length).toBeGreaterThanOrEqual(EARTH.plateCount);
      for (const e of w.events) {
        expect(e.step).toBeGreaterThan(0);
        expect(e.step).toBeLessThanOrEqual(EARTH.tectonicAge);
      }
    }
    expect(events).toBeGreaterThan(0);
  });

  it('moves plates faster and feeds hotspots more on a hotter mantle', () => {
    const cool = build({ ...EARTH, tectonicAge: 50 });
    const hot = build({ ...EARTH, tectonicAge: 50, mantleHeat: 2.5 });
    const meanRate = (rates: number[]): number => rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(meanRate(hot.plates.map((p) => p.rate))).toBeGreaterThan(meanRate(cool.plates.map((p) => p.rate)));
    let coolVolcanic = 0;
    let hotVolcanic = 0;
    for (let i = 0; i < cool.n; i++) {
      coolVolcanic += cool.volcanic[i];
      hotVolcanic += hot.volcanic[i];
    }
    expect(hotVolcanic).toBeGreaterThan(coolVolcanic);
  });
});
