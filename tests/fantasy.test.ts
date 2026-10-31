import { describe, expect, it } from 'vitest';
import { VEG_BOREAL, VEG_MEDITERRANEAN, VEG_RAINFOREST, VEG_SEASONAL, VEG_TEMPERATE, VEG_TEMPERATE_RAIN, VEG_WETLAND } from '../src/sim/biosphere/flora.ts';
import { DOMINANCE_THRESHOLD, ENTITIES, ENTITY_COUNT, FANTASY_NONE, LAIR_COUNT, LAIR_MIN, LAIR_SPACING_KM, MONSTERS, MONSTER_COUNT, PEOPLES, PEOPLE_COUNT, TERMS_PER_ENTITY, WATER_ENTITIES, suitabilityAt, termAt } from '../src/sim/fantasy/fantasy.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';

/** The sandbox rules (M28) on the full seed-2 planet: ranges, provenance, dominance and lairs. */
const world = build({ ...EARTH, seed: 2 });
const grid = Grid.get(world.level);
const n = world.n;
const land = (i: number): boolean => world.elevation[i] >= world.seaLevel && world.lake[i] < 0;
const sea = (i: number): boolean => world.elevation[i] < world.seaLevel;
const entity = (name: string): number => ENTITIES.indexOf(name as (typeof ENTITIES)[number]);
/** The land entities that stay on an ice sheet. */
const ICE_HARDY = new Set<string>(['dwarves', 'giants', 'dragons', 'trolls']);

describe('fantasy (M28)', () => {
  it('keeps every suitability and term in [0, 1] and off the wrong kind of cell', () => {
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < ENTITY_COUNT; e++) {
        const v = suitabilityAt(world.fantasy, i, e);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        let product = 1;
        for (let k = 0; k < TERMS_PER_ENTITY; k++) {
          const t = termAt(world.fantasyTerms, i, e, k);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(1);
          product *= t;
        }
        if (v > 0) expect(product).toBeCloseTo(v, 3);
        const water = WATER_ENTITIES.has(ENTITIES[e]);
        if (water && !sea(i)) expect(v).toBe(0);
        if (!water && !land(i)) expect(v).toBe(0);
        if (!water && land(i) && world.iceSheet[i] && !ICE_HARDY.has(ENTITIES[e])) expect(v).toBe(0);
      }
    }
  });

  it('gives each people the cells where its rule is strongest, above the threshold', () => {
    const dominant = new Set<number>();
    for (let i = 0; i < n; i++) {
      const p = world.fantasyPeople[i];
      if (p === FANTASY_NONE) {
        const from = land(i) ? 0 : 5;
        const to = land(i) ? 5 : 6;
        for (let e = from; e < to; e++) expect(suitabilityAt(world.fantasy, i, e)).toBeLessThan(DOMINANCE_THRESHOLD);
        continue;
      }
      dominant.add(p);
      expect(p).toBeLessThan(PEOPLE_COUNT);
      const v = suitabilityAt(world.fantasy, i, p);
      expect(v).toBeGreaterThanOrEqual(DOMINANCE_THRESHOLD);
      if (PEOPLES[p] === 'merfolk') expect(sea(i)).toBe(true);
      else {
        expect(land(i)).toBe(true);
        for (let e = 0; e < 5; e++) expect(suitabilityAt(world.fantasy, i, e)).toBeLessThanOrEqual(v);
      }
    }
    expect(dominant.size).toBeGreaterThanOrEqual(3);
    const shares = world.stats.fantasyShares;
    expect(shares.length).toBe(PEOPLE_COUNT);
    for (const s of shares) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('reads its terms from the geography it claims to', () => {
    const forests = new Set([VEG_TEMPERATE, VEG_TEMPERATE_RAIN, VEG_RAINFOREST, VEG_SEASONAL, VEG_BOREAL, VEG_MEDITERRANEAN, VEG_WETLAND]);
    for (let i = 0; i < n; i++) {
      const rel = world.elevation[i] - world.seaLevel;
      if (suitabilityAt(world.fantasy, i, entity('dwarves')) > 0) {
        expect(rel).toBeGreaterThan(1000);
        expect(world.thickness[i]).toBeGreaterThan(40);
      }
      if (suitabilityAt(world.fantasy, i, entity('elves')) > 0) expect(forests.has(world.vegetation[i])).toBe(true);
      if (suitabilityAt(world.fantasy, i, entity('halflings')) > 0) expect(world.agriculture[i]).toBeGreaterThan(0);
      if (suitabilityAt(world.fantasy, i, entity('giants')) > 0) expect(world.temperatureAnnual[i]).toBeLessThan(8);
      if (suitabilityAt(world.fantasy, i, entity('merfolk')) > 0) expect(-rel).toBeLessThan(200);
      if (suitabilityAt(world.fantasy, i, entity('dragons')) > 0) expect(rel > 2000 || world.volcanic[i] > 0).toBe(true);
      if (suitabilityAt(world.fantasy, i, entity('sea serpents')) > 0) expect(-rel).toBeGreaterThan(2000);
      if (suitabilityAt(world.fantasy, i, entity('giant spiders')) > 0) expect([VEG_RAINFOREST, VEG_SEASONAL, VEG_WETLAND]).toContain(world.vegetation[i]);
    }
  });

  it('places a few lairs per monster, best first and far apart', () => {
    expect(world.stats.lairCounts.length).toBe(MONSTER_COUNT);
    const minDot = Math.cos(LAIR_SPACING_KM / world.radiusKm);
    for (let m = 0; m < MONSTER_COUNT; m++) {
      const lairs = world.lairs.filter((l) => l.monster === m);
      expect(lairs.length).toBe(world.stats.lairCounts[m]);
      expect(lairs.length).toBeLessThanOrEqual(LAIR_COUNT);
      for (let a = 0; a < lairs.length; a++) {
        expect(lairs[a].score).toBeGreaterThanOrEqual(LAIR_MIN);
        expect(lairs[a].score).toBe(suitabilityAt(world.fantasy, lairs[a].cell, PEOPLE_COUNT + m));
        if (a > 0) expect(lairs[a].score).toBeLessThanOrEqual(lairs[a - 1].score);
        for (let b = 0; b < a; b++) {
          const i = lairs[a].cell;
          const c = lairs[b].cell;
          const dot = grid.xyz[3 * i] * grid.xyz[3 * c] + grid.xyz[3 * i + 1] * grid.xyz[3 * c + 1] + grid.xyz[3 * i + 2] * grid.xyz[3 * c + 2];
          expect(dot).toBeLessThanOrEqual(minDot + 1e-9);
        }
      }
    }
    // Dragons and sea serpents exist on an Earth-like planet; dragons keep away from the cities.
    expect(world.stats.lairCounts[MONSTERS.indexOf('dragons')]).toBeGreaterThan(0);
    expect(world.stats.lairCounts[MONSTERS.indexOf('sea serpents')]).toBeGreaterThan(0);
    for (const l of world.lairs.filter((l) => l.monster === MONSTERS.indexOf('dragons'))) expect(termAt(world.fantasyTerms, l.cell, PEOPLE_COUNT, 2)).toBeGreaterThan(0.1);
  });
});
