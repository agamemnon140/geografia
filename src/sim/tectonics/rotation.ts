/** 3x3 rotation matrices, row-major in a Float64Array of length 9. */
export type Mat3 = Float64Array;

export function identity(): Mat3 {
  const m = new Float64Array(9);
  m[0] = 1; m[4] = 1; m[8] = 1;
  return m;
}

/** Rotation by `angle` radians about the unit axis (ax, ay, az), Rodrigues form. */
export function axisAngle(ax: number, ay: number, az: number, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const m = new Float64Array(9);
  m[0] = t * ax * ax + c;      m[1] = t * ax * ay - s * az; m[2] = t * ax * az + s * ay;
  m[3] = t * ax * ay + s * az; m[4] = t * ay * ay + c;      m[5] = t * ay * az - s * ax;
  m[6] = t * ax * az - s * ay; m[7] = t * ay * az + s * ax; m[8] = t * az * az + c;
  return m;
}

/** Product a * b. */
export function multiply(a: Mat3, b: Mat3): Mat3 {
  const m = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
    }
  }
  return m;
}

/** Writes m * v into out[o..o+2]. */
export function apply(m: Mat3, x: number, y: number, z: number, out: Float64Array, o: number): void {
  out[o] = m[0] * x + m[1] * y + m[2] * z;
  out[o + 1] = m[3] * x + m[4] * y + m[5] * z;
  out[o + 2] = m[6] * x + m[7] * y + m[8] * z;
}

/** Writes transpose(m) * v (the inverse rotation) into out[o..o+2]. */
export function applyTranspose(m: Mat3, x: number, y: number, z: number, out: Float64Array, o: number): void {
  out[o] = m[0] * x + m[3] * y + m[6] * z;
  out[o + 1] = m[1] * x + m[4] * y + m[7] * z;
  out[o + 2] = m[2] * x + m[5] * y + m[8] * z;
}
