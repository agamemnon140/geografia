import { describe, expect, it } from 'vitest';
import { cellAreasKm2, Grid } from '../src/sim/grid/grid.ts';
import { oceanFraction } from '../src/sim/hypsometry.ts';
import { EARTH, PRESETS, validateParams } from '../src/sim/params.ts';
import { build, worldBuffers } from '../src/sim/pipeline.ts';

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
}

/** Shortest allowed run so the pipeline tests stay fast; the physics tests run the full age. */
const QUICK = { ...EARTH, tectonicAge: 50 };

describe('build', () => {
  const world = build(QUICK);

  it('is byte-for-byte deterministic for the same params and seed, in every field', () => {
    const again = build(QUICK);
    const a = worldBuffers(world);
    const b = worldBuffers(again);
    expect(a.length).toBe(b.length);
    for (let k = 0; k < a.length; k++) expect(sameBytes(new Uint8Array(a[k]), new Uint8Array(b[k]))).toBe(true);
    expect(again.seaLevel).toBe(world.seaLevel);
    expect(again.iceVolumeKm3).toBe(world.iceVolumeKm3);
    expect(again.stats).toEqual(world.stats);
    expect(again.lakes).toEqual(world.lakes);
    expect(again.basins).toEqual(world.basins);
  });

  it('previews one level coarser in under two seconds', () => {
    const t0 = performance.now();
    const preview = build(EARTH, () => {}, { coarser: 1 });
    const seconds = (performance.now() - t0) / 1000;
    expect(preview.preview).toBe(true);
    expect(preview.level).toBe(5);
    expect(preview.n).toBe(10242);
    // 1.4 s alone on the reference machine; the suite runs files in parallel, hence the slack,
    // and shared CI runners are slower still.
    expect(seconds).toBeLessThan(process.env.CI ? 9 : 3);
    for (let i = 0; i < preview.n; i++) expect(Number.isFinite(preview.temperatureAnnual[i])).toBe(true);
  });

  it('changes with the seed', () => {
    const other = build({ ...QUICK, seed: 2 });
    expect(sameBytes(world.elevation, other.elevation)).toBe(false);
  });

  it('uses level 6 for Earth and produces finite fields', () => {
    expect(world.level).toBe(6);
    expect(world.n).toBe(40962);
    expect(world.steps).toBe(50);
    expect(world.elevation.length).toBe(world.n);
    for (let i = 0; i < world.n; i++) {
      expect(Number.isFinite(world.elevation[i])).toBe(true);
      expect(Number.isFinite(world.thickness[i])).toBe(true);
      expect(world.plate[i]).toBeGreaterThanOrEqual(0);
      expect(world.plate[i]).toBeLessThan(EARTH.plateCount);
    }
    expect(Number.isFinite(world.seaLevel)).toBe(true);
  });

  it('reports stats consistent with the elevation field', () => {
    const areas = cellAreasKm2(Grid.get(world.level), world.radiusKm);
    expect(world.stats.oceanFraction).toBeCloseTo(oceanFraction(world.elevation, areas, world.seaLevel), 12);
    expect(world.stats.oceanFraction + world.stats.landFraction).toBeCloseTo(1, 12);
    expect(world.stats.maxElevation).toBeGreaterThan(0);
    expect(world.stats.minElevation).toBeLessThan(0);
    const hypsSum = world.stats.hypsometry.reduce((a, b) => a + b, 0);
    expect(hypsSum).toBeCloseTo(1, 9);
  });

  it('pins the ocean cover when asked, the water volume following', () => {
    const half = build({ ...QUICK, oceanFraction: 0.5 });
    const wide = build({ ...QUICK, oceanFraction: 0.85 });
    const areas = cellAreasKm2(Grid.get(half.level), half.radiusKm);
    // The loop holds the pinned cover exactly; ice sheets then take some water back (a few
    // percent of the surface, more on a land-heavy planet with large ice sheets).
    expect(oceanFraction(half.elevation, areas, half.loopSeaLevel)).toBeCloseTo(0.5, 2);
    expect(oceanFraction(wide.elevation, areas, wide.loopSeaLevel)).toBeCloseTo(0.85, 2);
    expect(Math.abs(half.stats.oceanFraction - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(wide.stats.oceanFraction - 0.85)).toBeLessThan(0.1);
    expect(wide.seaLevel).toBeGreaterThan(half.seaLevel);
    expect(Math.abs(half.loopSeaLevel - half.seaLevel)).toBeLessThan(500);
  });

  it('raises sea level with more water', () => {
    const wet = build({ ...QUICK, waterVolume: 2 });
    const dry = build({ ...QUICK, waterVolume: 0.5 });
    expect(wet.seaLevel).toBeGreaterThan(world.seaLevel);
    expect(dry.seaLevel).toBeLessThan(world.seaLevel);
    expect(wet.stats.oceanFraction).toBeGreaterThan(dry.stats.oceanFraction);
  });

  it('builds every preset without NaN', { timeout: 120000 }, () => {
    for (const preset of PRESETS) {
      const w = build({ ...preset.params, radiusKm: Math.min(preset.params.radiusKm, 6371), tectonicAge: 50 });
      for (let i = 0; i < w.n; i++) {
        expect(Number.isNaN(w.elevation[i])).toBe(false);
        expect(Number.isNaN(w.thickness[i])).toBe(false);
      }
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
