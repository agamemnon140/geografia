import { angleBetween, normalize3 } from '../grid/geometry.ts';
import type { Grid } from '../grid/grid.ts';
import { Noise3D } from '../rng/noise.ts';
import type { Rng } from '../rng/xoshiro.ts';
import { CONTINENTAL_FRACTION } from './crust.ts';
import { randomUnit, setEulerVector, type Plate } from './plates.ts';
import { identity } from './rotation.ts';

/**
 * The initial condition (DESIGN 3.3, revised in M12): the planet starts as
 * the end of an earlier supercontinent cycle rather than as noise. An
 * elliptical supercontinent sits around a random core, with a smaller mass
 * on the far side. Three rifts meet at the core in a triple junction, 120
 * degrees apart, and have already opened young oceans along great circles;
 * the plates are a weighted spherical Voronoi whose first seeds sit at the
 * centers of the three sectors, so the bisectors between them are exactly
 * the rift lines and the three wedges drift away from the junction. The
 * far-side mass gets one rift with a mirror pair of seeds; the remaining
 * seeds, with unequal weights, tile the ocean hemisphere. That is where
 * Earth's shapes come from: complementary coastlines, wedge-shaped
 * fragments, one dominant landmass with smaller pieces, plates of very
 * different sizes, boundaries smooth at the scale of a thousand kilometers.
 */

type Vec = [number, number, number];

/** Half-width of a young ocean at the start, in cells (range): 700 to 2000 km across, an Atlantic in its youth. */
export const RIFT_WIDTH_CELLS: [number, number] = [3, 9];
/** Age of the sea floor at the edge of a young ocean, in steps (range). */
export const RIFT_EDGE_AGE: [number, number] = [40, 120];
/** Angular distance of the junction seeds from the core, radians. */
export const JUNCTION_SEED_OFFSET = 0.55;
/** Jitter of the rift azimuths around the ideal 120 degrees, radians. */
export const JUNCTION_JITTER = 0.25;
/** Angular offset of the far-side mirror pair from its rift plane, radians. */
export const PAIR_OFFSET = 0.4;
/** Opening rate of the wedges away from the junction and across the far rift, cells per step (range). */
export const RIFT_OPENING_CELLS: [number, number] = [0.15, 0.35];
/** Width of the supercontinent core, radians (one sigma of its gaussian), and its aspect ratio (range). */
export const CORE_SIGMA = 0.8;
export const CORE_ASPECT: [number, number] = [1.3, 1.9];
export const SECOND_CORE_SIGMA = 0.45;
export const SECOND_CORE_WEIGHT = 0.5;
/** Free seeds keep at least these angles from the core and from the far-side core. */
export const FREE_CLEARANCE_CORE = 1.15;
export const FREE_CLEARANCE_SECOND = 0.7;
export const FREE_SPACING = 0.4;
/** Large-scale warp of plate boundaries, radians. */
export const BOUNDARY_WARP = 0.06;
/** Plate-size variety among free seeds: additive bias (radians) on the distance, a clipped normal. */
export const SIZE_BIAS = 0.07;
export const SIZE_BIAS_MAX = 0.14;
/** Weight and frequency of the noise in the continental mask: large-scale, so it bends coasts and grows peninsulas without scattering islands. */
export const MASK_NOISE = 0.2;
export const MASK_NOISE_FREQUENCY = 0.9;

export interface Genesis {
  plateOf: Int32Array;
  isContinental: Uint8Array;
  /** Sea-floor age for oceanic cells, steps. */
  oceanAge: Float64Array;
  plates: Plate[];
  /** Unit normals of the initial rift planes (the three junction rifts first), for tests and diagnostics. */
  riftNormals: Vec[];
  /** Core of the supercontinent. */
  core: Vec;
}

export function genesis(grid: Grid, count: number, rng: Rng, cellAngle: number, speed: number): Genesis {
  const n = grid.n;
  const xyz = grid.xyz;
  const seedRng = rng.fork('genesis-seeds');
  const coreRng = rng.fork('genesis-cores');
  const noise = new Noise3D(rng.fork('genesis-noise'));
  const warpNoise = new Noise3D(rng.fork('genesis-warp'));
  const ageNoise = new Noise3D(rng.fork('ocean-age'));

  // Cores of the continental mass: the supercontinent and a smaller far-side mass.
  const core = randomUnit(coreRng);
  let second = randomUnit(coreRng);
  for (let tries = 0; tries < 20 && angleBetween(core[0], core[1], core[2], second[0], second[1], second[2]) < 1.6; tries++) second = randomUnit(coreRng);
  const [ca, cb] = tangentBasis(core);
  const dirAt = (azimuth: number): Vec => [
    Math.cos(azimuth) * ca[0] + Math.sin(azimuth) * cb[0],
    Math.cos(azimuth) * ca[1] + Math.sin(azimuth) * cb[1],
    Math.cos(azimuth) * ca[2] + Math.sin(azimuth) * cb[2],
  ];

  // Triple junction at the core: three rifts 120 degrees apart, seeds at the sector centers.
  const junction = Math.min(3, Math.max(0, count - 1));
  const riftNormals: Vec[] = [];
  const riftWidth: number[] = [];
  const riftAge: number[] = [];
  /** Ray direction of each junction rift: the band exists only on the ray's half of the great circle. */
  const riftRay: (Vec | null)[] = [];
  const seeds: Vec[] = [];
  const bias: number[] = [];
  const baseAzimuth = seedRng.range(0, 2 * Math.PI);
  const azimuths: number[] = [];
  for (let k = 0; k < junction; k++) azimuths.push(baseAzimuth + (k * 2 * Math.PI) / junction + seedRng.range(-JUNCTION_JITTER, JUNCTION_JITTER));
  for (let k = 0; k < junction; k++) {
    const d = dirAt(azimuths[k]);
    riftNormals.push(normalize3(core[1] * d[2] - core[2] * d[1], core[2] * d[0] - core[0] * d[2], core[0] * d[1] - core[1] * d[0]));
    riftRay.push(d);
    riftWidth.push(cellAngle * seedRng.range(RIFT_WIDTH_CELLS[0], RIFT_WIDTH_CELLS[1]));
    riftAge.push(seedRng.range(RIFT_EDGE_AGE[0], RIFT_EDGE_AGE[1]));
    // Seed k sits between rifts k and k + 1 (sector center).
    const next = azimuths[(k + 1) % junction] + (k + 1 === junction ? 2 * Math.PI : 0);
    const mid = dirAt(0.5 * (azimuths[k] + next));
    seeds.push(normalize3(core[0] + JUNCTION_SEED_OFFSET * mid[0], core[1] + JUNCTION_SEED_OFFSET * mid[1], core[2] + JUNCTION_SEED_OFFSET * mid[2]));
    bias.push(0);
  }

  // The far-side mass: one rift through it, a mirror pair of seeds across it.
  const farPair = count - junction >= 3;
  let farNormal: Vec | null = null;
  if (farPair) {
    const [ta, tb] = tangentBasis(second);
    const strike = seedRng.range(0, Math.PI);
    const t: Vec = [Math.cos(strike) * ta[0] + Math.sin(strike) * tb[0], Math.cos(strike) * ta[1] + Math.sin(strike) * tb[1], Math.cos(strike) * ta[2] + Math.sin(strike) * tb[2]];
    farNormal = normalize3(second[1] * t[2] - second[2] * t[1], second[2] * t[0] - second[0] * t[2], second[0] * t[1] - second[1] * t[0]);
    riftNormals.push(farNormal);
    riftRay.push(null);
    riftWidth.push(cellAngle * seedRng.range(RIFT_WIDTH_CELLS[0], RIFT_WIDTH_CELLS[1]));
    riftAge.push(seedRng.range(RIFT_EDGE_AGE[0], RIFT_EDGE_AGE[1]));
    seeds.push(normalize3(second[0] + PAIR_OFFSET * farNormal[0], second[1] + PAIR_OFFSET * farNormal[1], second[2] + PAIR_OFFSET * farNormal[2]));
    seeds.push(normalize3(second[0] - PAIR_OFFSET * farNormal[0], second[1] - PAIR_OFFSET * farNormal[1], second[2] - PAIR_OFFSET * farNormal[2]));
    bias.push(0, 0);
  }

  // Free seeds tile the ocean hemisphere, kept away from both masses and from each other.
  while (seeds.length < count) {
    let candidate = randomUnit(seedRng);
    for (let tries = 0; tries < 40; tries++) {
      let nearest = Infinity;
      for (const s of seeds) nearest = Math.min(nearest, angleBetween(candidate[0], candidate[1], candidate[2], s[0], s[1], s[2]));
      const fromCore = angleBetween(candidate[0], candidate[1], candidate[2], core[0], core[1], core[2]);
      const fromSecond = angleBetween(candidate[0], candidate[1], candidate[2], second[0], second[1], second[2]);
      if (nearest > FREE_SPACING && fromCore > FREE_CLEARANCE_CORE && (!farPair || fromSecond > FREE_CLEARANCE_SECOND)) break;
      candidate = randomUnit(seedRng);
    }
    seeds.push(candidate);
    bias.push(Math.max(-SIZE_BIAS_MAX, Math.min(SIZE_BIAS_MAX, SIZE_BIAS * seedRng.normal())));
  }

  // Weighted Voronoi with a large-scale warp: boundaries are smooth, wavy over a thousand kilometers.
  const plateOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    const wx = x + BOUNDARY_WARP * warpNoise.fbm(x * 1.5 + 11, y * 1.5, z * 1.5, 3);
    const wy = y + BOUNDARY_WARP * warpNoise.fbm(x * 1.5, y * 1.5 + 23, z * 1.5, 3);
    const wz = z + BOUNDARY_WARP * warpNoise.fbm(x * 1.5, y * 1.5, z * 1.5 + 37, 3);
    const [px, py, pz] = normalize3(wx, wy, wz);
    let best = -1;
    let bestScore = -Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const score = px * seeds[s][0] + py * seeds[s][1] + pz * seeds[s][2] + bias[s];
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    plateOf[i] = best;
  }

  // Young oceans along the rifts: cells in a band are sea floor aging away from the band's center,
  // and cannot be continental, whatever the mask says.
  const oceanAge = new Float64Array(n);
  const inRift = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    oceanAge[i] = Math.max(0, 60 + 60 * ageNoise.fbm(x * 2, y * 2, z * 2, 4));
  }
  for (let k = 0; k < riftNormals.length; k++) {
    const m = riftNormals[k];
    const ray = riftRay[k];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xyz[3 * i] * m[0] + xyz[3 * i + 1] * m[1] + xyz[3 * i + 2] * m[2]);
      if (d >= riftWidth[k]) continue;
      // A junction rift is one ray of its great circle: the other half runs through a wedge's middle.
      if (ray && xyz[3 * i] * ray[0] + xyz[3 * i + 1] * ray[1] + xyz[3 * i + 2] * ray[2] < 0) continue;
      inRift[i] = 1;
      oceanAge[i] = Math.min(oceanAge[i], (riftAge[k] * d) / riftWidth[k]);
    }
  }

  // Continental mass: an elliptical core (random long axis) and the far-side core, plus large-scale
  // noise, cut at the quantile that gives the global fraction once the rift bands are excluded.
  const aspect = coreRng.range(CORE_ASPECT[0], CORE_ASPECT[1]);
  const spin = coreRng.range(0, Math.PI);
  const longAxis = dirAt(spin);
  const shortAxis = dirAt(spin + Math.PI / 2);
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    const a1 = angleBetween(x, y, z, core[0], core[1], core[2]);
    const du = x * longAxis[0] + y * longAxis[1] + z * longAxis[2];
    const dv = x * shortAxis[0] + y * shortAxis[1] + z * shortAxis[2];
    const planar = Math.hypot(du, dv) || 1e-9;
    const stretched = a1 * Math.hypot(du / planar / aspect, (dv / planar) * aspect);
    const a2 = angleBetween(x, y, z, second[0], second[1], second[2]);
    score[i] = inRift[i]
      ? -Infinity
      : MASK_NOISE * noise.fbm(x * MASK_NOISE_FREQUENCY, y * MASK_NOISE_FREQUENCY, z * MASK_NOISE_FREQUENCY, 5) +
        1.1 * Math.exp(-(stretched * stretched) / (2 * CORE_SIGMA * CORE_SIGMA)) +
        SECOND_CORE_WEIGHT * Math.exp(-(a2 * a2) / (2 * SECOND_CORE_SIGMA * SECOND_CORE_SIGMA));
  }
  const sorted = Float64Array.from(score).sort();
  const threshold = sorted[Math.min(n - 1, Math.floor((1 - CONTINENTAL_FRACTION) * n))];
  const isContinental = new Uint8Array(n);
  for (let i = 0; i < n; i++) isContinental[i] = score[i] > threshold ? 1 : 0;

  // Plates: random poles for the free seeds; the wedges drift away from the junction; the far pair diverges.
  const plates: Plate[] = [];
  for (let p = 0; p < count; p++) {
    plates.push({ id: p, axis: randomUnit(seedRng), rate: cellAngle * speed * seedRng.range(0.15, 0.5), rotation: identity() });
  }
  const commonDrift = randomUnit(seedRng);
  const driftRate = cellAngle * speed * seedRng.range(0.03, 0.1);
  for (let k = 0; k < junction; k++) {
    const s = seeds[k];
    // omega = -rate * (core x s) moves the plate center away from the core.
    const axis = normalize3(core[1] * s[2] - core[2] * s[1], core[2] * s[0] - core[0] * s[2], core[0] * s[1] - core[1] * s[0]);
    const rate = cellAngle * speed * seedRng.range(RIFT_OPENING_CELLS[0], RIFT_OPENING_CELLS[1]);
    setEulerVector(plates[k], commonDrift[0] * driftRate - axis[0] * rate, commonDrift[1] * driftRate - axis[1] * rate, commonDrift[2] * driftRate - axis[2] * rate);
  }
  if (farPair && farNormal) {
    const a = plates[junction];
    const b = plates[junction + 1];
    const m = farNormal;
    // Relative pole on the far rift circle, a quarter turn from the core of the mass.
    const pole = normalize3(m[1] * second[2] - m[2] * second[1], m[2] * second[0] - m[0] * second[2], m[0] * second[1] - m[1] * second[0]);
    const rate = cellAngle * speed * seedRng.range(RIFT_OPENING_CELLS[0], RIFT_OPENING_CELLS[1]);
    let ox = pole[0] * rate;
    let oy = pole[1] * rate;
    let oz = pole[2] * rate;
    const vx = oy * second[2] - oz * second[1];
    const vy = oz * second[0] - ox * second[2];
    const vz = ox * second[1] - oy * second[0];
    if (vx * m[0] + vy * m[1] + vz * m[2] < 0) {
      ox = -ox;
      oy = -oy;
      oz = -oz;
    }
    const drift = randomUnit(seedRng);
    const dr = cellAngle * speed * seedRng.range(0.05, 0.15);
    setEulerVector(a, drift[0] * dr + 0.5 * ox, drift[1] * dr + 0.5 * oy, drift[2] * dr + 0.5 * oz);
    setEulerVector(b, drift[0] * dr - 0.5 * ox, drift[1] * dr - 0.5 * oy, drift[2] * dr - 0.5 * oz);
  }

  return { plateOf, isContinental, oceanAge, plates, riftNormals, core };
}

/** Two orthonormal tangent vectors at a unit vector. */
function tangentBasis(p: Vec): [Vec, Vec] {
  const helper: Vec = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const t1 = normalize3(helper[1] * p[2] - helper[2] * p[1], helper[2] * p[0] - helper[0] * p[2], helper[0] * p[1] - helper[1] * p[0]);
  const t2 = normalize3(p[1] * t1[2] - p[2] * t1[1], p[2] * t1[0] - p[0] * t1[2], p[0] * t1[1] - p[1] * t1[0]);
  return [t1, t2];
}
