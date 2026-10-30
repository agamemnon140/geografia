import { describe, expect, it } from 'vitest';
import { oceanFraction, solveSeaLevel, waterVolumeBelow } from '../src/sim/hypsometry.ts';

describe('sea level solver', () => {
  const elevation = new Float64Array([0, 100]);
  const area = new Float64Array([1, 1]);

  it('fills the lowest basin first', () => {
    // V(s) = s / 1000 km^3 for s <= 100 m (one cell of 1 km^2), so 0.05 km^3 gives 50 m.
    expect(solveSeaLevel(elevation, area, 0.05)).toBeCloseTo(50, 4);
  });

  it('keeps filling above the highest cell', () => {
    // V(s) = (2 s - 100) / 1000 for s >= 100 m; 0.15 km^3 gives 125 m.
    expect(solveSeaLevel(elevation, area, 0.15)).toBeCloseTo(125, 6);
  });

  it('returns the lowest elevation for no water', () => {
    expect(solveSeaLevel(elevation, area, 0)).toBe(0);
  });

  it('is monotonic in the water volume and consistent with waterVolumeBelow', () => {
    const e = new Float64Array([-4000, -3000, -1000, 200, 800, 3000]);
    const a = new Float64Array([3, 2, 1, 2, 1, 1]);
    let prev = -Infinity;
    for (const v of [0.001, 0.01, 0.1, 1, 10]) {
      const s = solveSeaLevel(e, a, v);
      expect(s).toBeGreaterThan(prev);
      expect(waterVolumeBelow(e, a, s)).toBeCloseTo(v, 6);
      prev = s;
    }
  });

  it('reports the ocean fraction by area', () => {
    const e = new Float64Array([-10, -5, 5, 10]);
    const a = new Float64Array([1, 3, 1, 1]);
    expect(oceanFraction(e, a, 0)).toBeCloseTo(4 / 6, 12);
  });
});
