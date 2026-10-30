import { describe, expect, it } from 'vitest';
import { cellAreasKm2, Grid } from '../src/sim/grid/grid.ts';
import { oceanFraction } from '../src/sim/hypsometry.ts';
import { EARTH, PRESETS, validateParams } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';

function sameBytes(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
}

describe('build', () => {
  const world = build(EARTH);

  it('is byte-for-byte deterministic for the same params and seed', () => {
    const again = build(EARTH);
    expect(sameBytes(world.elevation, again.elevation)).toBe(true);
    expect(again.seaLevel).toBe(world.seaLevel);
    expect(again.stats).toEqual(world.stats);
  });

  it('changes with the seed', () => {
    const other = build({ ...EARTH, seed: 2 });
    expect(sameBytes(world.elevation, other.elevation)).toBe(false);
  });

  it('uses level 6 for Earth and produces finite elevations', () => {
    expect(world.level).toBe(6);
    expect(world.n).toBe(40962);
    expect(world.elevation.length).toBe(world.n);
    for (const e of world.elevation) expect(Number.isFinite(e)).toBe(true);
    expect(Number.isFinite(world.seaLevel)).toBe(true);
  });

  it('reports stats consistent with the elevation field', () => {
    const areas = cellAreasKm2(Grid.get(world.level), world.radiusKm);
    expect(world.stats.oceanFraction).toBeCloseTo(oceanFraction(world.elevation, areas, world.seaLevel), 12);
    expect(world.stats.oceanFraction + world.stats.landFraction).toBeCloseTo(1, 12);
    expect(world.stats.maxElevation).toBeGreaterThan(0);
    expect(world.stats.minElevation).toBeLessThan(0);
  });

  it('gives the Earth preset a plausible ocean fraction with the placeholder terrain', () => {
    expect(world.stats.oceanFraction).toBeGreaterThan(0.5);
    expect(world.stats.oceanFraction).toBeLessThan(0.85);
  });

  it('raises sea level with more water', () => {
    const wet = build({ ...EARTH, waterVolume: 2 });
    const dry = build({ ...EARTH, waterVolume: 0.5 });
    expect(wet.seaLevel).toBeGreaterThan(world.seaLevel);
    expect(dry.seaLevel).toBeLessThan(world.seaLevel);
    expect(wet.stats.oceanFraction).toBeGreaterThan(dry.stats.oceanFraction);
  });

  it('builds every preset without NaN', () => {
    for (const preset of PRESETS) {
      const w = build({ ...preset.params, radiusKm: Math.min(preset.params.radiusKm, 6371) });
      for (const e of w.elevation) expect(Number.isNaN(e)).toBe(false);
    }
  });
});

describe('validateParams', () => {
  it('clamps out-of-range values and normalizes the seed', () => {
    const p = validateParams({ ...EARTH, radiusKm: 1, waterVolume: 99, seed: -1 });
    expect(p.radiusKm).toBe(1900);
    expect(p.waterVolume).toBe(5);
    expect(p.seed).toBe(0);
    expect(validateParams({ ...EARTH, seed: 1.7 }).seed).toBe(1);
    expect(validateParams({ ...EARTH, seed: 1e12 }).seed).toBe(4294967295);
  });
});
