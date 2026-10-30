import type { Grid } from '../grid/grid.ts';

/**
 * Per-edge geometry of the grid for the climate solvers, CSR-aligned with
 * `grid.nb`: the unit tangent direction (east, north components in the
 * cell's own local basis) and great-circle length of each hop, plus the
 * index of the reverse edge so a flux can be read from either end in its own
 * cell's basis (the local bases rotate between neighbors, strongly so near
 * the poles). Cached per grid level.
 */
export interface MeshGeometry {
  east: Float64Array;
  north: Float64Array;
  /** Hop length in meters for a planet of the given radius is `angle * radius`; this is the angle. */
  angle: Float64Array;
  /** CSR index of the edge j -> i for the edge i -> j at this index. */
  rev: Int32Array;
}

const cache = new Map<number, MeshGeometry>();

export function meshGeometry(grid: Grid): MeshGeometry {
  const hit = cache.get(grid.level);
  if (hit) return hit;
  const total = grid.nb.length;
  const east = new Float64Array(total);
  const north = new Float64Array(total);
  const angle = new Float64Array(total);
  const rev = new Int32Array(total);
  const xyz = grid.xyz;
  for (let i = 0; i < grid.n; i++) {
    const lat = grid.lat[i];
    const lon = grid.lon[i];
    const ex = -Math.sin(lon);
    const ey = Math.cos(lon);
    const nx = -Math.sin(lat) * Math.cos(lon);
    const ny = -Math.sin(lat) * Math.sin(lon);
    const nz = Math.cos(lat);
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      const dx = xyz[3 * j] - xyz[3 * i];
      const dy = xyz[3 * j + 1] - xyz[3 * i + 1];
      const dz = xyz[3 * j + 2] - xyz[3 * i + 2];
      const de = dx * ex + dy * ey;
      const dn = dx * nx + dy * ny + dz * nz;
      const len = Math.hypot(de, dn) || 1;
      east[t] = de / len;
      north[t] = dn / len;
      const dot = xyz[3 * i] * xyz[3 * j] + xyz[3 * i + 1] * xyz[3 * j + 1] + xyz[3 * i + 2] * xyz[3 * j + 2];
      angle[t] = Math.acos(Math.max(-1, Math.min(1, dot)));
      rev[t] = -1;
      for (let s = grid.nbStart[j]; s < grid.nbStart[j + 1]; s++) {
        if (grid.nb[s] === i) {
          rev[t] = s;
          break;
        }
      }
    }
  }
  const geometry = { east, north, angle, rev };
  cache.set(grid.level, geometry);
  return geometry;
}
