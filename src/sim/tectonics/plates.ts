import { normalize3 } from '../grid/geometry.ts';
import type { Rng } from '../rng/xoshiro.ts';
import { axisAngle, multiply, type Mat3 } from './rotation.ts';

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
export function perturbPlates(plates: Plate[], rng: Rng, cellAngle: number, speed = 1): void {
  const typical = cellAngle * 0.3 * speed;
  for (const p of plates) {
    const [dx, dy, dz] = randomUnit(rng);
    // A smaller kick than before M13: slab pull now steers plates, the walk only adds variety.
    p.axis = normalize3(p.axis[0] + 0.15 * dx, p.axis[1] + 0.15 * dy, p.axis[2] + 0.15 * dz);
    // Relaxation toward the typical speed stands for slab pull from subduction elsewhere; it has to
    // beat the collision brake except along long sutures, or every plate ends up locked.
    const walked = p.rate * rng.range(0.85, 1.15);
    const relaxed = walked + 0.1 * (typical - walked);
    p.rate = Math.min(cellAngle * 0.45 * speed, Math.max(cellAngle * 0.05, relaxed));
  }
}

/** Euler vector (axis times rate) of a plate. */
export function eulerVector(p: Plate): [number, number, number] {
  return [p.axis[0] * p.rate, p.axis[1] * p.rate, p.axis[2] * p.rate];
}

/** Set a plate's axis and rate from an Euler vector; a zero vector leaves the axis and sets a tiny rate. */
export function setEulerVector(p: Plate, x: number, y: number, z: number): void {
  const len = Math.hypot(x, y, z);
  if (len < 1e-15) {
    p.rate = 1e-9;
    return;
  }
  p.axis = [x / len, y / len, z / len];
  p.rate = len;
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

