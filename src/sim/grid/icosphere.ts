import { DEG, normalize3, triple3 } from './geometry.ts';

/** A triangle mesh on the unit sphere: xyz holds 3 numbers per vertex, tris 3 vertex ids per face. */
export interface Mesh {
  xyz: Float64Array;
  tris: Uint32Array;
}

/**
 * Base icosahedron oriented with a vertex at each pole.
 * Index 0 is the north pole, 1-5 the upper ring, 6-10 the lower ring, 11 the south pole.
 * Faces are wound counter-clockwise seen from outside.
 */
export function icosahedron(): Mesh {
  const xyz = new Float64Array(12 * 3);
  const set = (i: number, x: number, y: number, z: number): void => {
    const [nx, ny, nz] = normalize3(x, y, z);
    xyz[3 * i] = nx;
    xyz[3 * i + 1] = ny;
    xyz[3 * i + 2] = nz;
  };
  set(0, 0, 0, 1);
  set(11, 0, 0, -1);
  const ringLat = Math.atan(0.5);
  const c = Math.cos(ringLat);
  const s = Math.sin(ringLat);
  for (let i = 0; i < 5; i++) {
    const lonUpper = i * 72 * DEG;
    const lonLower = (36 + i * 72) * DEG;
    set(1 + i, c * Math.cos(lonUpper), c * Math.sin(lonUpper), s);
    set(6 + i, c * Math.cos(lonLower), c * Math.sin(lonLower), -s);
  }
  const faces: number[] = [];
  for (let i = 0; i < 5; i++) {
    const u0 = 1 + i;
    const u1 = 1 + ((i + 1) % 5);
    const l0 = 6 + i;
    const l1 = 6 + ((i + 1) % 5);
    faces.push(0, u0, u1);
    faces.push(u0, l0, u1);
    faces.push(l0, l1, u1);
    faces.push(11, l1, l0);
  }
  const tris = new Uint32Array(faces);
  orientOutward(xyz, tris);
  return { xyz, tris };
}

/** Flip any face whose winding is clockwise seen from outside. */
function orientOutward(xyz: Float64Array, tris: Uint32Array): void {
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    const det = triple3(
      xyz[a], xyz[a + 1], xyz[a + 2],
      xyz[b], xyz[b + 1], xyz[b + 2],
      xyz[c], xyz[c + 1], xyz[c + 2],
    );
    if (det < 0) {
      const tmp = tris[t + 1];
      tris[t + 1] = tris[t + 2];
      tris[t + 2] = tmp;
    }
  }
}

/** Edge key for the midpoint cache; vertex ids stay below 2^20 up to level 9. */
const EDGE_BASE = 1 << 20;

/** One level of class-I subdivision: each triangle becomes four, new vertices are normalized edge midpoints. */
export function subdivide(mesh: Mesh): Mesh {
  const nv = mesh.xyz.length / 3;
  const nt = mesh.tris.length / 3;
  const edges = (nt * 3) / 2;
  const xyz = new Float64Array((nv + edges) * 3);
  xyz.set(mesh.xyz);
  const cache = new Map<number, number>();
  let next = nv;
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * EDGE_BASE + b : b * EDGE_BASE + a;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const m = next++;
    const [x, y, z] = normalize3(
      xyz[3 * a] + xyz[3 * b],
      xyz[3 * a + 1] + xyz[3 * b + 1],
      xyz[3 * a + 2] + xyz[3 * b + 2],
    );
    xyz[3 * m] = x;
    xyz[3 * m + 1] = y;
    xyz[3 * m + 2] = z;
    cache.set(key, m);
    return m;
  };
  const tris = new Uint32Array(nt * 4 * 3);
  let w = 0;
  for (let t = 0; t < nt; t++) {
    const a = mesh.tris[3 * t];
    const b = mesh.tris[3 * t + 1];
    const c = mesh.tris[3 * t + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    tris[w++] = a; tris[w++] = ab; tris[w++] = ca;
    tris[w++] = b; tris[w++] = bc; tris[w++] = ab;
    tris[w++] = c; tris[w++] = ca; tris[w++] = bc;
    tris[w++] = ab; tris[w++] = bc; tris[w++] = ca;
  }
  return { xyz, tris };
}

/** Icosahedron subdivided `level` times: 10 * 4^level + 2 vertices. */
export function icosphere(level: number): Mesh {
  let mesh = icosahedron();
  for (let i = 0; i < level; i++) mesh = subdivide(mesh);
  return mesh;
}
