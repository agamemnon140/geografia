import { normalize3, type Vec3 } from '../grid/geometry.ts';
import { Noise3D } from '../rng/noise.ts';
import type { Rng } from '../rng/xoshiro.ts';

/**
 * Geometry of a rift (DESIGN 3.3, M13). A rift follows a great circle only
 * at the largest scale: at the scale of a thousand kilometers it bends, and
 * it is offset in steps by transform faults every thousand or two thousand
 * kilometers, like the equatorial Atlantic's stair-steps. The two coasts
 * that separate along it are complementary but not straight, and the
 * continents they bound are not convex: the bulge of Brazil fits the Gulf
 * of Guinea.
 */
export interface RiftPath {
  /** Unit normal of the base great circle; the positive side is the side it points to. */
  normal: Vec3;
  /** Point on the circle where the along-circle angle is zero. */
  origin: Vec3;
  /** Tangent of the circle at the origin (normal cross origin). */
  along: Vec3;
  /** Angular length of a transform segment, radians. */
  segment: number;
  /** Perpendicular offset of each segment, radians. */
  offsets: Float64Array;
  /** Amplitude of the large-scale bend, radians, and the noise behind it. */
  bend: number;
  frequency: number;
  noise: Noise3D;
}

/** Transform segments are 1500 to 2500 km long and offset the rift by up to 350 km each. */
export const TRANSFORM_SEGMENT: [number, number] = [0.24, 0.4];
export const TRANSFORM_OFFSET = 0.055;
/** The bend: 500 km of amplitude at a wavelength of about 3000 km. */
export const RIFT_BEND = 0.08;
export const RIFT_BEND_FREQUENCY = 2;

export function makeRiftPath(normal: Vec3, origin: Vec3, rng: Rng): RiftPath {
  const n = normalize3(normal[0], normal[1], normal[2]);
  // Project the origin onto the circle so the along-angle is well defined.
  const d = origin[0] * n[0] + origin[1] * n[1] + origin[2] * n[2];
  const o = normalize3(origin[0] - d * n[0], origin[1] - d * n[1], origin[2] - d * n[2]);
  const along = normalize3(n[1] * o[2] - n[2] * o[1], n[2] * o[0] - n[0] * o[2], n[0] * o[1] - n[1] * o[0]);
  const segments = Math.max(8, Math.round((2 * Math.PI) / rng.range(TRANSFORM_SEGMENT[0], TRANSFORM_SEGMENT[1])));
  const offsets = new Float64Array(segments);
  for (let s = 0; s < segments; s++) offsets[s] = rng.range(-TRANSFORM_OFFSET, TRANSFORM_OFFSET);
  return { normal: n, origin: o, along, segment: (2 * Math.PI) / segments, offsets, bend: RIFT_BEND, frequency: RIFT_BEND_FREQUENCY, noise: new Noise3D(rng.fork('rift-bend')) };
}

/** Angle along the rift circle of a point, in (-pi, pi], measured from the origin. */
export function riftAngle(path: RiftPath, x: number, y: number, z: number): number {
  return Math.atan2(x * path.along[0] + y * path.along[1] + z * path.along[2], x * path.origin[0] + y * path.origin[1] + z * path.origin[2]);
}

/**
 * Signed distance of a point from the rift line, radians (small-angle), positive
 * on the side the normal points to. The base plane distance is shifted by the
 * segment's transform offset and by the large-scale bend.
 */
export function riftDistance(path: RiftPath, x: number, y: number, z: number): number {
  const d = x * path.normal[0] + y * path.normal[1] + z * path.normal[2];
  const theta = riftAngle(path, x, y, z);
  let s = Math.floor((theta + Math.PI) / path.segment);
  if (s >= path.offsets.length) s = path.offsets.length - 1;
  if (s < 0) s = 0;
  const f = path.frequency;
  return d - path.offsets[s] - path.bend * path.noise.fbm(x * f + 5, y * f + 7, z * f + 9, 2);
}
