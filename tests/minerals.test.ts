import { describe, expect, it } from 'vitest';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { MINERALS, MINERAL_COUNT, SHIELD_MIN_KM } from '../src/sim/resources/minerals.ts';
import { CONTINENTAL } from '../src/sim/tectonics/crust.ts';

/** The default planet at its full age: the resource rules need the whole history of swamps, arcs and collisions. */
const world = build({ ...EARTH, seed: 2 });
const index = (m: (typeof MINERALS)[number]): number => MINERALS.indexOf(m);

describe('mineral resources (M21)', () => {
  it('leaves the geography and the climate exactly as they were before the rules existed', () => {
    // Recorded at M20 for the Earth preset, seed 2: the loop's bookkeeping must not touch its arithmetic.
    expect(world.stats.oceanFraction).toBe(0.7465123244488925);
    expect(world.stats.meanLandElevation).toBe(528.7195279552244);
    expect(world.stats.meanTemperature).toBe(13.815604285309503);
    expect(world.seaLevel).toBe(-177.02847310983134);
  });

  it('keeps potentials in [0, 1], draws deposits only where there is potential, and keeps ores on land', () => {
    const n = world.n;
    const oil = index('oil');
    for (let i = 0; i < n; i++) {
      const land = world.elevation[i] >= world.seaLevel;
      for (let m = 0; m < MINERAL_COUNT; m++) {
        const p = world.mineralPotential[m * n + i];
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        const has = (world.deposits[i] >> m) & 1;
        if (has) expect(p).toBeGreaterThan(0);
        if (!land && m !== oil) {
          expect(p).toBe(0);
          expect(has).toBe(0);
        }
      }
    }
  });

  it('reads every potential from the provenance it claims', () => {
    const n = world.n;
    let copper = 0;
    let coal = 0;
    let oil = 0;
    let salt = 0;
    let iron = 0;
    for (let i = 0; i < n; i++) {
      if (world.mineralPotential[index('copper') * n + i] > 0) {
        copper++;
        expect(world.volcanic[i]).toBeGreaterThan(0);
        expect(world.crustType[i]).toBe(CONTINENTAL);
      }
      if (world.mineralPotential[index('coal') * n + i] > 0) {
        coal++;
        expect(world.coal[i]).toBeGreaterThan(0);
      }
      if (world.mineralPotential[index('oil') * n + i] > 0) {
        oil++;
        expect(world.oil[i]).toBeGreaterThan(0);
        expect(world.sediment[i]).toBeGreaterThan(0);
      }
      if (world.mineralPotential[index('salt') * n + i] > 0) {
        salt++;
        expect(world.salt[i]).toBeGreaterThan(0);
      }
      if (world.mineralPotential[index('iron') * n + i] > 0) {
        iron++;
        expect(world.thickness[i]).toBeGreaterThan(SHIELD_MIN_KM);
        expect(world.crustAge[i]).toBeGreaterThanOrEqual(world.steps - 1);
      }
      if (world.mineralPotential[index('gold') * n + i] > 0) expect(world.orogenyStep[i]).toBeGreaterThanOrEqual(0);
    }
    for (const count of [copper, coal, oil, salt, iron]) expect(count).toBeGreaterThan(20);
    // Every resource has at least one deposit on this planet, and none is everywhere.
    for (let m = 0; m < MINERAL_COUNT; m++) {
      expect(world.stats.depositCounts[m]).toBeGreaterThan(0);
      expect(world.stats.depositCounts[m]).toBeLessThan(0.1 * n);
    }
  });
});
