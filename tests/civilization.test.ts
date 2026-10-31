import { describe, expect, it } from 'vitest';
import { CITY_COUNT, CITY_SPACING_KM, CITY_TERMS, UNREACHED } from '../src/sim/civilization/civilization.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';

const world = build({ ...EARTH, seed: 2 });

describe('civilization (M24)', () => {
  it('keeps the indices in range and the city score itemized', () => {
    const n = world.n;
    for (let i = 0; i < n; i++) {
      const land = world.elevation[i] >= world.seaLevel && world.lake[i] < 0;
      for (const v of [world.habitability[i], world.agriculture[i], world.citySite[i]]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (!land) expect(v).toBe(0);
      }
      if (world.iceSheet[i]) expect(world.citySite[i]).toBe(0);
      for (let k = 0; k < CITY_TERMS.length; k++) {
        const t = world.cityTerms[i * CITY_TERMS.length + k];
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  it('places the candidate cities apart, best first, on habitable land', () => {
    const grid = Grid.get(world.level);
    expect(world.cities.length).toBe(CITY_COUNT);
    const minDot = Math.cos(CITY_SPACING_KM / world.radiusKm);
    for (let a = 0; a < world.cities.length; a++) {
      const ca = world.cities[a];
      expect(world.elevation[ca.cell]).toBeGreaterThanOrEqual(world.seaLevel);
      expect(world.habitability[ca.cell]).toBeGreaterThan(0.1);
      if (a > 0) expect(ca.score).toBeLessThanOrEqual(world.cities[a - 1].score);
      for (let b = a + 1; b < world.cities.length; b++) {
        const cb = world.cities[b];
        const dot = grid.xyz[3 * ca.cell] * grid.xyz[3 * cb.cell] + grid.xyz[3 * ca.cell + 1] * grid.xyz[3 * cb.cell + 1] + grid.xyz[3 * ca.cell + 2] * grid.xyz[3 * cb.cell + 2];
        expect(dot).toBeLessThanOrEqual(minDot + 1e-9);
      }
    }
    // The best sites sit on rivers or coasts, not in deserts: their river or harbor term is set.
    const top = world.cities.slice(0, 5);
    for (const c of top) {
      const river = world.cityTerms[c.cell * CITY_TERMS.length];
      const harbor = world.cityTerms[c.cell * CITY_TERMS.length + 1];
      expect(Math.max(river, harbor)).toBeGreaterThan(0.3);
    }
  });

  it('spreads people from a tropical origin across the land and over narrow seas, not onto ice', () => {
    expect(world.origin).toBeGreaterThanOrEqual(0);
    expect(world.arrivalKa[world.origin]).toBe(0);
    expect(Math.abs(Grid.get(world.level).lat[world.origin]) * (180 / Math.PI)).toBeLessThanOrEqual(30);
    let reached = 0;
    let land = 0;
    for (let i = 0; i < world.n; i++) {
      if (world.elevation[i] < world.seaLevel || world.lake[i] >= 0) {
        expect(world.arrivalKa[i]).toBe(UNREACHED);
        continue;
      }
      land++;
      if (world.arrivalKa[i] !== UNREACHED) {
        reached++;
        expect(world.arrivalKa[i]).toBeLessThanOrEqual(100);
      }
      if (world.iceSheet[i]) expect(world.arrivalKa[i]).toBe(UNREACHED);
    }
    expect(reached / land).toBeGreaterThan(0.5);
    expect(world.stats.landmassesReached).toBeGreaterThanOrEqual(2);
    expect(world.stats.landmassesReached).toBeLessThanOrEqual(world.stats.landmassesTotal);
  });
});
