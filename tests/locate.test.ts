import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid/grid.ts';
import { nearestCell } from '../src/sim/grid/locate.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { equirectRaster, latLonToPixel } from '../src/render/raster.ts';

function bruteForce(grid: Grid, x: number, y: number, z: number): number {
  let best = -1;
  let bestDot = -Infinity;
  for (let i = 0; i < grid.n; i++) {
    const d = grid.xyz[3 * i] * x + grid.xyz[3 * i + 1] * y + grid.xyz[3 * i + 2] * z;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

describe('nearestCell', () => {
  it('matches brute force for random points from arbitrary starts', () => {
    const grid = Grid.get(5);
    const rng = new Rng(42);
    for (let k = 0; k < 500; k++) {
      const z = rng.range(-1, 1);
      const phi = rng.range(-Math.PI, Math.PI);
      const r = Math.sqrt(1 - z * z);
      const x = r * Math.cos(phi);
      const y = r * Math.sin(phi);
      const start = rng.int(grid.n);
      expect(nearestCell(grid, x, y, z, start)).toBe(bruteForce(grid, x, y, z));
    }
  });

  it('returns the cell itself for a cell center', () => {
    const grid = Grid.get(4);
    for (let i = 0; i < grid.n; i += 37) {
      expect(nearestCell(grid, grid.xyz[3 * i], grid.xyz[3 * i + 1], grid.xyz[3 * i + 2], 0)).toBe(i);
    }
  });
});

describe('equirectRaster', () => {
  it('maps every pixel to a valid cell and cell centers to themselves', () => {
    const grid = Grid.get(4);
    const raster = equirectRaster(grid, 360, 180);
    for (const c of raster.cell) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(grid.n);
    }
    // Cells touched by at least one pixel should cover almost the whole grid at this resolution.
    const seen = new Set<number>(raster.cell);
    expect(seen.size / grid.n).toBeGreaterThan(0.95);
    for (let i = 0; i < grid.n; i += 11) {
      const [px, py] = latLonToPixel(grid.lat[i], grid.lon[i], raster.width, raster.height);
      const x = Math.min(raster.width - 1, Math.floor(px));
      const y = Math.min(raster.height - 1, Math.floor(py));
      const found = raster.cell[y * raster.width + x];
      // The pixel center may fall in a neighboring cell near a tile edge; accept self or neighbor.
      const ok = found === i || Array.from(grid.neighbors(i)).includes(found);
      expect(ok).toBe(true);
    }
  });

  it('is cached per level and size', () => {
    const grid = Grid.get(3);
    expect(equirectRaster(grid, 64, 32)).toBe(equirectRaster(grid, 64, 32));
  });
});
