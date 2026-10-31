/**
 * The Equal Earth projection (Savric, Patterson and Jenny, 2018): an
 * equal-area pseudocylindrical projection with the look of Robinson's. The
 * sphere has unit radius; longitudes are relative to the central meridian.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const SQRT3 = Math.sqrt(3);

/** Half-width of the whole map at the equator and half-height at the poles, in projection units. */
export const EQUAL_EARTH_X_MAX = (2 * SQRT3 * Math.PI) / (3 * A1);
export const EQUAL_EARTH_Y_MAX = yOf(Math.asin(M));

function yOf(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
}

function dyOf(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
}

/** Projection coordinates of a latitude and a longitude relative to the central meridian, radians. */
export function equalEarthForward(lat: number, lon: number): [number, number] {
  const theta = Math.asin(M * Math.sin(lat));
  return [(2 * SQRT3 * lon * Math.cos(theta)) / (3 * dyOf(theta)), yOf(theta)];
}

/** Latitude and relative longitude at projection coordinates, or null outside the map's outline. */
export function equalEarthInverse(x: number, y: number): [number, number] | null {
  if (Math.abs(y) > EQUAL_EARTH_Y_MAX + 1e-9) return null;
  // Newton on y(theta); the function is monotonic and close to linear.
  let theta = y / A1;
  for (let i = 0; i < 12; i++) {
    const delta = (yOf(theta) - y) / dyOf(theta);
    theta -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  const s = Math.sin(theta) / M;
  if (Math.abs(s) > 1 + 1e-9) return null;
  const lat = Math.asin(Math.max(-1, Math.min(1, s)));
  const cosTheta = Math.cos(theta);
  if (cosTheta < 1e-12) return Math.abs(x) < 1e-9 ? [lat, 0] : null;
  const lon = (3 * x * dyOf(theta)) / (2 * SQRT3 * cosTheta);
  if (Math.abs(lon) > Math.PI + 1e-9) return null;
  return [lat, lon];
}
