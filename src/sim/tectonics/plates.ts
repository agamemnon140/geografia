import { normalize3 } from '../grid/geometry.ts';
import type { Grid } from '../grid/grid.ts';
import type { Rng } from '../rng/xoshiro.ts';
import { axisAngle, identity, multiply, type Mat3 } from './rotation.ts';

export interface Plate {
  id: number;
  /** Euler pole axis, unit vector in the mantle (world) frame. */
  axis: [number, number, number];
  /** Angular rate in radians per step. */
  rate: number;
  /** Total rotation taking the plate frame to the world frame. */
  rotation: Mat3;
}

/** Random unit vector, uniform on the sphere. */
export function randomUnit(rng: Rng): [number, number, number] {
  const z = rng.range(-1, 1);
  const phi = rng.range(-Math.PI, Math.PI);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** Plates with random Euler poles; `cellAngle` is the angular size of a cell, plates move 0.15 to 0.5 cells per step. */
export function initPlates(count: number, rng: Rng, cellAngle: number): Plate[] {
  const plates: Plate[] = [];
  for (let p = 0; p < count; p++) {
    plates.push({ id: p, axis: randomUnit(rng), rate: cellAngle * rng.range(0.15, 0.5), rotation: identity() });
  }
  return plates;
}

/** Advance every plate's total rotation by one step. */
export function rotatePlates(plates: Plate[]): void {
  for (const p of plates) {
    p.rotation = multiply(axisAngle(p.axis[0], p.axis[1], p.axis[2], p.rate), p.rotation);
  }
}

/**
 * Slow random walk of the poles so plate motions change over geological time.
 * Rates random-walk too and relax toward a typical speed, so a plate braked by
 * a continental collision regains motion over a few hundred steps as if new
 * subduction had started elsewhere.
 */
export function perturbPlates(plates: Plate[], rng: Rng, cellAngle: number): void {
  const typical = cellAngle * 0.3;
  for (const p of plates) {
    const [dx, dy, dz] = randomUnit(rng);
    p.axis = normalize3(p.axis[0] + 0.25 * dx, p.axis[1] + 0.25 * dy, p.axis[2] + 0.25 * dz);
    const walked = p.rate * rng.range(0.85, 1.15);
    const relaxed = walked + 0.03 * (typical - walked);
    p.rate = Math.min(cellAngle * 0.45, Math.max(cellAngle * 0.05, relaxed));
  }
}

/** Surface velocity of a plate at world point x: omega cross x, with omega = rate * axis. */
export function velocityAt(p: Plate, x: number, y: number, z: number, out: Float64Array, o: number): void {
  const wx = p.rate * p.axis[0];
  const wy = p.rate * p.axis[1];
  const wz = p.rate * p.axis[2];
  out[o] = wy * z - wz * y;
  out[o + 1] = wz * x - wx * z;
  out[o + 2] = wx * y - wy * x;
}

/**
 * Initial plate layout: multi-source breadth-first growth from random seed
 * cells, with the visiting order shuffled at each layer so boundaries are not
 * perfectly regular Voronoi edges.
 */
export function seedPlates(grid: Grid, count: number, rng: Rng): Int32Array {
  const plate = new Int32Array(grid.n).fill(-1);
  let queue: number[] = [];
  for (let p = 0; p < count; p++) {
    let c = rng.int(grid.n);
    while (plate[c] >= 0) c = rng.int(grid.n);
    plate[c] = p;
    queue.push(c);
  }
  while (queue.length > 0) {
    rng.shuffle(queue);
    const next: number[] = [];
    for (const c of queue) {
      for (const nb of grid.neighbors(c)) {
        if (plate[nb] < 0) {
          plate[nb] = plate[c];
          next.push(nb);
        }
      }
    }
    queue = next;
  }
  return plate;
}
