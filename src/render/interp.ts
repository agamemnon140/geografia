import { triple3 } from '../sim/grid/geometry.ts';
import type { Grid } from '../sim/grid/grid.ts';

/**
 * Barycentric interpolation on the geodesic mesh (DESIGN 8.5). A point on
 * the sphere lies in one of the triangles around its nearest vertex; the
 * weights of the three corners come from the gnomonic projection onto the
 * triangle's plane (Cramer's rule on the three corner vectors), clamped
 * and normalized so they are non-negative and sum to one. Scalar fields
 * stored per cell become continuous across the map, and coastlines follow
 * the zero crossing of the interpolated elevation instead of cell edges.
 */

/** Fill `idx` (three cell ids) and `w` (three weights summing to one) for the unit vector (x, y, z) near cell `nearest`. */
export function locateTriangle(grid: Grid, nearest: number, x: number, y: number, z: number, idx: Int32Array, w: Float64Array, o = 0): void {
  const xyz = grid.xyz;
  const v = nearest;
  const vx = xyz[3 * v];
  const vy = xyz[3 * v + 1];
  const vz = xyz[3 * v + 2];
  const s = grid.nbStart[v];
  const d = grid.nbStart[v + 1] - s;
  let bestMin = -Infinity;
  let bi = -1;
  let ba = 0;
  let bb = 0;
  let bc = 0;
  for (let j = 0; j < d; j++) {
    const a = grid.nb[s + j];
    const b = grid.nb[s + ((j + 1) % d)];
    const ax = xyz[3 * a];
    const ay = xyz[3 * a + 1];
    const az = xyz[3 * a + 2];
    const bx = xyz[3 * b];
    const by = xyz[3 * b + 1];
    const bz = xyz[3 * b + 2];
    const det = triple3(vx, vy, vz, ax, ay, az, bx, by, bz);
    if (Math.abs(det) < 1e-18) continue;
    const alpha = triple3(x, y, z, ax, ay, az, bx, by, bz) / det;
    const beta = triple3(vx, vy, vz, x, y, z, bx, by, bz) / det;
    const gamma = triple3(vx, vy, vz, ax, ay, az, x, y, z) / det;
    const min = Math.min(alpha, beta, gamma);
    if (min > bestMin) {
      bestMin = min;
      bi = j;
      ba = alpha;
      bb = beta;
      bc = gamma;
    }
  }
  if (bi < 0) {
    idx[o] = v;
    idx[o + 1] = v;
    idx[o + 2] = v;
    w[o] = 1;
    w[o + 1] = 0;
    w[o + 2] = 0;
    return;
  }
  const wa = Math.max(0, ba);
  const wb = Math.max(0, bb);
  const wc = Math.max(0, bc);
  const sum = wa + wb + wc || 1;
  idx[o] = v;
  idx[o + 1] = grid.nb[s + bi];
  idx[o + 2] = grid.nb[s + ((bi + 1) % d)];
  w[o] = wa / sum;
  w[o + 1] = wb / sum;
  w[o + 2] = wc / sum;
}
