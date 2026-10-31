import { describe, expect, it } from 'vitest';
import { MEGAFAUNA_HERBIVORES, MEGAFAUNA_PREDATORS, PREDATOR_LANDMASS_KM2, REALM_NONE } from '../src/sim/biosphere/fauna.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { LINEAGE_COUNT } from '../src/sim/tectonics/crust.ts';

/** The full history: lineages need the splits and dockings of 200 steps to make realms. */
const world = build({ ...EARTH, seed: 2 });

describe('fauna (M23)', () => {
  it('leaves the geography exactly as it was (the lineages are bookkeeping)', () => {
    expect(world.stats.oceanFraction).toBe(0.7465123244488925);
    expect(world.stats.meanLandElevation).toBe(528.7195279552244);
    expect(world.seaLevel).toBe(-177.02847310983134);
  });

  it('gives every land cell a fauna that sums to one, a realm, and consistent indices', () => {
    const n = world.n;
    let realms = new Set<number>();
    for (let i = 0; i < n; i++) {
      const land = world.elevation[i] >= world.seaLevel;
      let sum = 0;
      for (let k = 0; k < LINEAGE_COUNT; k++) sum += world.lineage[i * LINEAGE_COUNT + k];
      if (!land) {
        expect(sum).toBe(0);
        expect(world.realm[i]).toBe(REALM_NONE);
        expect(world.landmass[i]).toBe(-1);
        continue;
      }
      expect(sum).toBeCloseTo(1, 4);
      expect(world.realm[i]).toBeLessThan(LINEAGE_COUNT);
      realms.add(world.realm[i]);
      expect(world.landmass[i]).toBeGreaterThanOrEqual(0);
      expect(world.endemism[i]).toBeGreaterThanOrEqual(0);
      expect(world.endemism[i]).toBeLessThanOrEqual(1);
      expect(world.richness[i]).toBeGreaterThanOrEqual(0);
      expect(world.richness[i]).toBeLessThanOrEqual(1);
      const area = world.landmassAreas[world.landmass[i]];
      if (world.megafauna[i] & MEGAFAUNA_PREDATORS) {
        expect(world.megafauna[i] & MEGAFAUNA_HERBIVORES).toBeTruthy();
        expect(area).toBeGreaterThanOrEqual(PREDATOR_LANDMASS_KM2);
      }
      if (world.iceSheet[i]) {
        expect(world.richness[i]).toBe(0);
        expect(world.megafauna[i]).toBe(0);
      }
    }
    // Several ancestral faunas survive two hundred steps of mixing, and more than one realm holds a continent.
    expect(realms.size).toBeGreaterThanOrEqual(3);
    expect(world.stats.realmCount).toBeGreaterThanOrEqual(2);
    expect(world.stats.meanEndemism).toBeGreaterThan(0);
  });

  it('names the lineages by their seeding sector and writes each realm name inside it (M27)', () => {
    expect(new Set(world.lineageNames).size).toBe(LINEAGE_COUNT);
    expect(world.lineageNames).toContain('northern');
    expect(world.realmLabelCells.length).toBe(LINEAGE_COUNT);
    let placed = 0;
    world.realmLabelCells.forEach((cell, k) => {
      if (cell < 0) return;
      placed++;
      expect(world.elevation[cell]).toBeGreaterThanOrEqual(world.seaLevel);
      expect(world.realm[cell]).toBe(k);
    });
    expect(placed).toBeGreaterThanOrEqual(world.stats.realmCount);
    const shares = world.stats.realmShares.reduce((a, b) => a + b, 0);
    expect(shares).toBeGreaterThan(0.9);
    expect(shares).toBeLessThanOrEqual(1.0001);
    world.stats.realmShares.forEach((s, k) => {
      if (s > 0) expect(world.stats.realmMainLandmass[k]).toBeGreaterThanOrEqual(0);
    });
  });

  it('keeps separated landmasses more endemic than the largest one', () => {
    const areas = world.landmassAreas;
    let largest = 0;
    for (let m = 1; m < areas.length; m++) if (areas[m] > areas[largest]) largest = m;
    let mainSum = 0;
    let mainCount = 0;
    let islandSum = 0;
    let islandCount = 0;
    for (let i = 0; i < world.n; i++) {
      const m = world.landmass[i];
      if (m < 0) continue;
      if (m === largest) {
        mainSum += world.endemism[i];
        mainCount++;
      } else if (areas[m] < 0.2 * areas[largest]) {
        islandSum += world.endemism[i];
        islandCount++;
      }
    }
    expect(mainCount).toBeGreaterThan(0);
    expect(islandCount).toBeGreaterThan(0);
    // An island's lineages are mostly shared with the continent it left; the continent's are mostly its own.
    expect(mainSum / mainCount).toBeGreaterThan(0.5);
    expect(islandSum / islandCount).toBeLessThan(mainSum / mainCount);
  });
});
