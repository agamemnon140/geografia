import { icosphere } from './icosphere.ts';
import { cross3, dot3, normalize3, sphericalTriangleArea, toLat, toLon } from './geometry.ts';
import { EARTH_CELL_AREA_KM2, MAX_LEVEL, MIN_LEVEL } from '../constants.ts';

/**
 * Geodesic grid: the vertices of a subdivided icosahedron are the cells, and
 * each cell's tile is the dual (Voronoi) polygon whose corners are the
 * circumcenters of the triangles around the vertex. Twelve cells are pentagons,
 * every other cell is a hexagon.
 *
 * Neighbor lists are stored in CSR form (`nbStart`, `nb`) and are sorted
 * counter-clockwise seen from outside the sphere. Corner j of cell i is the
 * circumcenter of the triangle (i, nb[j], nb[j+1]).
 */
export class Grid {
  readonly level: number;
  /** Number of cells. */
  readonly n: number;
  /** Unit vector of each cell center, 3 per cell. */
  readonly xyz: Float64Array;
  /** Latitude of each cell center, radians. */
  readonly lat: Float64Array;
  /** Longitude of each cell center, radians in (-pi, pi]. */
  readonly lon: Float64Array;
  /** Area of each dual tile in steradians; multiply by R^2 for km^2. */
  readonly area: Float64Array;
  /** CSR offsets into `nb`, length n + 1. */
  readonly nbStart: Uint32Array;
  /** Neighbor ids, counter-clockwise. */
  readonly nb: Uint32Array;
  /** Dual tile corners as unit vectors, 3 numbers per entry of `nb`. */
  readonly corner: Float64Array;
  /** Triangles of the underlying mesh, 3 vertex ids each, counter-clockwise. */
  readonly tris: Uint32Array;

  private static cache = new Map<number, Grid>();

  /** Cached grid for a level; building level 7 takes well under a second. */
  static get(level: number): Grid {
    let grid = Grid.cache.get(level);
    if (!grid) {
      grid = new Grid(level);
      Grid.cache.set(level, grid);
    }
    return grid;
  }

  private constructor(level: number) {
    const mesh = icosphere(level);
    const n = mesh.xyz.length / 3;
    const tris = mesh.tris;
    const nt = tris.length / 3;
    const xyz = mesh.xyz;

    // Degree of a vertex equals its number of incident triangles on a closed mesh.
    const deg = new Uint32Array(n);
    for (let t = 0; t < tris.length; t++) deg[tris[t]]++;
    const nbStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) nbStart[i + 1] = nbStart[i] + deg[i];
    const total = nbStart[n];

    // For each vertex v and each incident triangle (v, b, c) in CCW order, record the
    // successor relation b -> c. Chaining successors walks the neighbors CCW.
    const from = new Uint32Array(total);
    const to = new Uint32Array(total);
    const fill = new Uint32Array(n);
    const put = (v: number, next: number, after: number): void => {
      const slot = nbStart[v] + fill[v]++;
      from[slot] = next;
      to[slot] = after;
    };
    for (let t = 0; t < nt; t++) {
      const a = tris[3 * t];
      const b = tris[3 * t + 1];
      const c = tris[3 * t + 2];
      put(a, b, c);
      put(b, c, a);
      put(c, a, b);
    }
    const nb = new Uint32Array(total);
    for (let v = 0; v < n; v++) {
      const s = nbStart[v];
      const d = deg[v];
      let cur = from[s];
      for (let j = 0; j < d; j++) {
        nb[s + j] = cur;
        for (let k = 0; k < d; k++) {
          if (from[s + k] === cur) {
            cur = to[s + k];
            break;
          }
        }
      }
    }

    // Dual corners (circumcenters) and tile areas.
    const corner = new Float64Array(total * 3);
    const area = new Float64Array(n);
    const lat = new Float64Array(n);
    const lon = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      const vx = xyz[3 * v];
      const vy = xyz[3 * v + 1];
      const vz = xyz[3 * v + 2];
      const s = nbStart[v];
      const d = deg[v];
      for (let j = 0; j < d; j++) {
        const a = nb[s + j];
        const b = nb[s + ((j + 1) % d)];
        const [cx0, cy0, cz0] = cross3(
          xyz[3 * a] - vx, xyz[3 * a + 1] - vy, xyz[3 * a + 2] - vz,
          xyz[3 * b] - vx, xyz[3 * b + 1] - vy, xyz[3 * b + 2] - vz,
        );
        let [cx, cy, cz] = normalize3(cx0, cy0, cz0);
        if (dot3(cx, cy, cz, vx, vy, vz) < 0) {
          cx = -cx; cy = -cy; cz = -cz;
        }
        corner[3 * (s + j)] = cx;
        corner[3 * (s + j) + 1] = cy;
        corner[3 * (s + j) + 2] = cz;
      }
      let sum = 0;
      for (let j = 0; j < d; j++) {
        const p = 3 * (s + j);
        const q = 3 * (s + ((j + 1) % d));
        sum += sphericalTriangleArea(
          vx, vy, vz,
          corner[p], corner[p + 1], corner[p + 2],
          corner[q], corner[q + 1], corner[q + 2],
        );
      }
      area[v] = sum;
      lat[v] = toLat(vz);
      lon[v] = toLon(vx, vy);
    }

    this.level = level;
    this.n = n;
    this.xyz = xyz;
    this.lat = lat;
    this.lon = lon;
    this.area = area;
    this.nbStart = nbStart;
    this.nb = nb;
    this.corner = corner;
    this.tris = tris;
  }

  degree(i: number): number {
    return this.nbStart[i + 1] - this.nbStart[i];
  }

  neighbors(i: number): Uint32Array {
    return this.nb.subarray(this.nbStart[i], this.nbStart[i + 1]);
  }

  /** Corners of cell i as a flat xyz array, counter-clockwise. */
  corners(i: number): Float64Array {
    return this.corner.subarray(3 * this.nbStart[i], 3 * this.nbStart[i + 1]);
  }
}

/**
 * Subdivision level that keeps cell area close to the Earth level-6 cell
 * (DESIGN 3.1): a bigger planet gets more cells, up to the cap.
 */
export function levelForRadius(radiusKm: number): number {
  const cells = (4 * Math.PI * radiusKm * radiusKm) / EARTH_CELL_AREA_KM2;
  const raw = Math.log((cells - 2) / 10) / Math.log(4);
  const level = Number.isFinite(raw) ? Math.round(raw) : MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level));
}

/** Cell areas in km^2 for a planet of the given radius. */
export function cellAreasKm2(grid: Grid, radiusKm: number): Float64Array {
  const out = new Float64Array(grid.n);
  const r2 = radiusKm * radiusKm;
  for (let i = 0; i < grid.n; i++) out[i] = grid.area[i] * r2;
  return out;
}
