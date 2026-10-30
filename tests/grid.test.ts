import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM, cellCount } from '../src/sim/constants.ts';
import { dot3, triple3 } from '../src/sim/grid/geometry.ts';
import { Grid, cellAreasKm2, levelForRadius } from '../src/sim/grid/grid.ts';

const LEVELS = [0, 1, 2, 3, 4, 5, 6];

describe('geodesic grid', () => {
  it('has 10 * 4^L + 2 cells and exactly 12 pentagons', () => {
    for (const level of LEVELS) {
      const g = Grid.get(level);
      expect(g.n).toBe(cellCount(level));
      let pentagons = 0;
      for (let i = 0; i < g.n; i++) {
        const d = g.degree(i);
        expect(d === 5 || d === 6).toBe(true);
        if (d === 5) pentagons++;
      }
      expect(pentagons).toBe(12);
    }
  });

  it('has unit-length centers and latitudes within range', () => {
    const g = Grid.get(5);
    for (let i = 0; i < g.n; i++) {
      const len = Math.hypot(g.xyz[3 * i], g.xyz[3 * i + 1], g.xyz[3 * i + 2]);
      expect(Math.abs(len - 1)).toBeLessThan(1e-12);
      expect(Math.abs(g.lat[i])).toBeLessThanOrEqual(Math.PI / 2);
      expect(Math.abs(g.lon[i])).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('has symmetric neighbor relations', () => {
    const g = Grid.get(5);
    for (let i = 0; i < g.n; i++) {
      for (const j of g.neighbors(i)) {
        expect(Array.from(g.neighbors(j))).toContain(i);
      }
    }
  });

  it('lists neighbors counter-clockwise seen from outside', () => {
    const g = Grid.get(5);
    for (let v = 0; v < g.n; v++) {
      const nb = g.neighbors(v);
      for (let j = 0; j < nb.length; j++) {
        const a = nb[j];
        const b = nb[(j + 1) % nb.length];
        const det = triple3(
          g.xyz[3 * v], g.xyz[3 * v + 1], g.xyz[3 * v + 2],
          g.xyz[3 * a], g.xyz[3 * a + 1], g.xyz[3 * a + 2],
          g.xyz[3 * b], g.xyz[3 * b + 1], g.xyz[3 * b + 2],
        );
        expect(det).toBeGreaterThan(0);
      }
    }
  });

  it('has dual corners equidistant from the three cells they separate', () => {
    const g = Grid.get(4);
    for (let v = 0; v < g.n; v++) {
      const nb = g.neighbors(v);
      const corners = g.corners(v);
      for (let j = 0; j < nb.length; j++) {
        const a = nb[j];
        const b = nb[(j + 1) % nb.length];
        const cx = corners[3 * j];
        const cy = corners[3 * j + 1];
        const cz = corners[3 * j + 2];
        const dv = dot3(cx, cy, cz, g.xyz[3 * v], g.xyz[3 * v + 1], g.xyz[3 * v + 2]);
        const da = dot3(cx, cy, cz, g.xyz[3 * a], g.xyz[3 * a + 1], g.xyz[3 * a + 2]);
        const db = dot3(cx, cy, cz, g.xyz[3 * b], g.xyz[3 * b + 1], g.xyz[3 * b + 2]);
        expect(dv).toBeGreaterThan(0);
        expect(Math.abs(dv - da)).toBeLessThan(1e-9);
        expect(Math.abs(dv - db)).toBeLessThan(1e-9);
      }
    }
  });

  it('tiles the sphere: areas sum to 4 pi and are nearly uniform', () => {
    for (const level of LEVELS) {
      const g = Grid.get(level);
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < g.n; i++) {
        const a = g.area[i];
        expect(a).toBeGreaterThan(0);
        sum += a;
        if (a < min) min = a;
        if (a > max) max = a;
      }
      expect(Math.abs(sum - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(1e-9);
      if (level >= 3) expect(max / min).toBeLessThan(2.2);
    }
  });

  it('scales cell areas by the planet radius', () => {
    const g = Grid.get(6);
    const areas = cellAreasKm2(g, EARTH_RADIUS_KM);
    let sum = 0;
    for (const a of areas) sum += a;
    expect(Math.abs(sum - 4 * Math.PI * EARTH_RADIUS_KM ** 2) / sum).toBeLessThan(1e-9);
  });

  it('caches grids per level', () => {
    expect(Grid.get(3)).toBe(Grid.get(3));
  });
});

describe('levelForRadius', () => {
  it('gives Earth level 6, doubles the level step for 2x radius, and clamps', () => {
    expect(levelForRadius(EARTH_RADIUS_KM)).toBe(6);
    expect(levelForRadius(2 * EARTH_RADIUS_KM)).toBe(7);
    expect(levelForRadius(0.5 * EARTH_RADIUS_KM)).toBe(5);
    expect(levelForRadius(500)).toBe(4);
    expect(levelForRadius(100000)).toBe(7);
    expect(levelForRadius(0)).toBe(4);
  });

  it('is monotonic in the radius', () => {
    let prev = 0;
    for (let r = 1000; r <= 20000; r += 100) {
      const l = levelForRadius(r);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });
});
