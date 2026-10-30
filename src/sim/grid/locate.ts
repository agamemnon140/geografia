import type { Grid } from './grid.ts';

/**
 * Nearest cell to a unit vector by greedy walking: move to the neighbor with the
 * largest dot product until no neighbor improves. The geodesic mesh is a
 * spherical Delaunay triangulation, where greedy walking reaches the nearest
 * vertex. Pass a good `start` (for example the previous query's answer) to make
 * the walk one or two steps long.
 */
export function nearestCell(grid: Grid, x: number, y: number, z: number, start = 0): number {
  const xyz = grid.xyz;
  let cur = start;
  let best = xyz[3 * cur] * x + xyz[3 * cur + 1] * y + xyz[3 * cur + 2] * z;
  for (let iter = 0; iter < 100000; iter++) {
    let candidate = -1;
    for (let j = grid.nbStart[cur]; j < grid.nbStart[cur + 1]; j++) {
      const k = grid.nb[j];
      const d = xyz[3 * k] * x + xyz[3 * k + 1] * y + xyz[3 * k + 2] * z;
      if (d > best) {
        best = d;
        candidate = k;
      }
    }
    if (candidate < 0) return cur;
    cur = candidate;
  }
  return cur;
}
