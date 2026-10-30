/** Vector and spherical geometry on the unit sphere. All angles in radians. */

export const DEG = Math.PI / 180;
export const TWO_PI = 2 * Math.PI;

export type Vec3 = [number, number, number];

export function normalize3(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

export function dot3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return ax * bx + ay * by + az * bz;
}

export function cross3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Vec3 {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/**
 * Scalar triple product a . (b x c) = det[a b c].
 * For three points on the sphere it is positive when (a, b, c) is counter-clockwise
 * seen from outside the sphere.
 */
export function triple3(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  return ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
}

/**
 * Signed area (spherical excess, steradians) of the spherical triangle with
 * unit-vector corners a, b, c. Positive for counter-clockwise triangles.
 * Formula from Van Oosterom and Strackee (1983).
 */
export function sphericalTriangleArea(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const t = triple3(ax, ay, az, bx, by, bz, cx, cy, cz);
  const d = 1 + dot3(ax, ay, az, bx, by, bz) + dot3(bx, by, bz, cx, cy, cz) + dot3(cx, cy, cz, ax, ay, az);
  return 2 * Math.atan2(t, d);
}

/** Great-circle angle between two unit vectors. */
export function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const [cx, cy, cz] = cross3(ax, ay, az, bx, by, bz);
  return Math.atan2(Math.hypot(cx, cy, cz), dot3(ax, ay, az, bx, by, bz));
}

/** Latitude of a unit vector (z is the north pole). */
export function toLat(z: number): number {
  return Math.asin(Math.max(-1, Math.min(1, z)));
}

/** Longitude of a unit vector in (-pi, pi]; x points to longitude 0, y to 90 degrees east. */
export function toLon(x: number, y: number): number {
  return Math.atan2(y, x);
}

export function fromLatLon(lat: number, lon: number): Vec3 {
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}
