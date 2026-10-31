import { angleBetween, normalize3, type Vec3 } from '../grid/geometry.ts';
import type { Grid } from '../grid/grid.ts';
import { nearestCell } from '../grid/locate.ts';
import { Noise3D } from '../rng/noise.ts';
import type { Rng } from '../rng/xoshiro.ts';
import { CONTINENTAL_FRACTION, CONTINENTAL_THICKNESS_KM, RIFT_POLE_MARGIN } from './crust.ts';
import { randomUnit, setEulerVector, type Plate } from './plates.ts';
import { makeRiftPath, riftAngle, riftDistance, type RiftPath } from './riftpath.ts';
import { identity } from './rotation.ts';

/**
 * The initial condition (DESIGN 3.3, revised in M12 and M13): the planet
 * starts as a Pangea. One connected supercontinent with a lobed outline
 * holds nearly all the continental crust; a far microcontinent (an India)
 * may travel alone. A single rift has just begun to split the
 * supercontinent along a bent, stair-stepped line, with a young ocean that
 * widens from the hinge to the far end; a third arm of that rift may have
 * failed, leaving a flooded trough that notches the coast. The margins
 * facing the young ocean are stretched and wide; those facing the old ocean
 * are narrow and active. Oceanic crust just offshore rides with the
 * continent, so the subduction zone sits off the coast; the rest of the
 * ocean is tiled by a few plates of unequal size that converge on the
 * supercontinent. Everything after that is history: the simulation's own
 * rifts, failed rifts, collisions and arcs reshape it over the planet's
 * tectonic age.
 */

/** Width of the supercontinent core, radians (one sigma of its gaussian), and its aspect ratio (range). */
export const CORE_SIGMA = 0.9;
export const CORE_ASPECT: [number, number] = [1.2, 1.8];
/** Lobes of the outline: a low-frequency noise added to the gaussian, so the coast has gulfs and peninsulas at the scale of thousands of km. */
export const LOBE_AMPLITUDE = 0.3;
export const LOBE_FREQUENCY = 0.8;
export const LOBE_OCTAVES = 3;
/** A far microcontinent exists with this probability, with this gaussian weight and width. */
export const TRAVELER_PROBABILITY = 0.6;
export const TRAVELER_WEIGHT = 0.6;
export const TRAVELER_SIGMA = 0.35;
/** Continental fragments smaller than this share of all continental crust are dropped: the start has no scattered islands. */
export const ISLAND_MIN_SHARE = 0.03;
/** Half-width of the young ocean at the far end of the first rift, in cells (range); it tapers to zero at the hinge. */
export const RIFT_WIDTH_CELLS: [number, number] = [2, 5];
/** Mean age of the old ocean's floor at the start, steps (Earth's sea floor averages about 60 Myr); it varies by as much around that. */
export const OLD_OCEAN_AGE = 50;
/** Age of the sea floor at the edge of the young ocean, in steps (range). */
export const RIFT_EDGE_AGE: [number, number] = [15, 40];
/** Angular rate of the first rift about its pole, cells per step (range). */
export const RIFT_OPENING_CELLS: [number, number] = [0.2, 0.35];
/** A failed third arm (aulacogen) exists with this probability; its length and half-width in cells. */
export const AULACOGEN_PROBABILITY = 0.7;
export const AULACOGEN_LENGTH_CELLS: [number, number] = [6, 14];
export const AULACOGEN_WIDTH_CELLS: [number, number] = [1, 2.2];
/** Crust thickness on the axis of the failed arm (a flooded trough) and at its edge. */
export const AULACOGEN_THICKNESS_KM: [number, number] = [19, 30];
/** Passive (rifted) margins: thickness one to five cells from the young ocean, slope and shelf, all flooded (Earth floods 11% of its surface this way: Siberian, Sunda and Patagonian shelves). */
export const MARGIN_PASSIVE_KM = [16, 20, 24, 27, 30, 33];
/** Shields and basins: amplitude (km) and frequency of a low-frequency variation of the interior thickness; the deepest basins flood into inland seas (Hudson Bay, the Baltic). */
export const BASIN_AMPLITUDE_KM = 5;
export const BASIN_FREQUENCY = 1.2;
/** Active margins facing the old ocean are narrower: three cells. */
export const MARGIN_ACTIVE_KM = [22, 27, 31, 33];
/** Oceanic cells within this many hops of continental crust ride with the continent (the subduction zone sits offshore). */
export const STRIP_CELLS: [number, number] = [1, 3];
/** Free (oceanic) seeds keep this many hops from continental crust and this angle from each other. */
export const FREE_SEED_CLEARANCE_CELLS = 5;
export const FREE_SPACING = 0.4;
/** Large-scale warp of the oceanic plate boundaries, radians. */
export const BOUNDARY_WARP = 0.06;
/** Plate-size variety among free seeds: additive bias (radians) on the distance, a clipped normal. */
export const SIZE_BIAS = 0.07;
export const SIZE_BIAS_MAX = 0.14;
/** Oceanic plates converge on the supercontinent (a ring of fire): share of their motion pointed at the core. */
export const RING_CONVERGENCE = 0.5;
/** The traveler's speed, cells per step (range), and the chance it heads for the supercontinent. */
export const TRAVELER_SPEED_CELLS: [number, number] = [0.2, 0.4];
export const TRAVELER_INBOUND_PROBABILITY = 0.5;

export interface Genesis {
  plateOf: Int32Array;
  isContinental: Uint8Array;
  /** Crust thickness of continental cells, km (margins and troughs included); 0 on oceanic cells. */
  thickness: Float64Array;
  /** Sea-floor age for oceanic cells, steps. */
  oceanAge: Float64Array;
  plates: Plate[];
  /** The first rift, through the supercontinent. */
  rift: RiftPath;
  /** Core of the supercontinent. */
  core: Vec3;
  /** Plates on the negative and positive sides of the first rift. */
  sides: [number, number];
  /** Plate of the far microcontinent, or -1. */
  traveler: number;
}

/**
 * `unitAngle` is the angle of one reference cell (about 112 km) on this planet and
 * `cellsPerUnit` how many grid cells fit in one, so widths in cells and speeds in
 * cells per step mean the same kilometers on every grid (M18).
 */
export function genesis(grid: Grid, count: number, rng: Rng, unitAngle: number, cellsPerUnit: number, speed: number): Genesis {
  const n = grid.n;
  const cellAngle = unitAngle;
  const hops = (units: number): number => Math.max(1, Math.round(units * cellsPerUnit));
  const xyz = grid.xyz;
  const coreRng = rng.fork('genesis-cores');
  const seedRng = rng.fork('genesis-seeds');
  const riftRng = rng.fork('genesis-rift');
  const lobeNoise = new Noise3D(rng.fork('genesis-noise'));
  const warpNoise = new Noise3D(rng.fork('genesis-warp'));
  const ageNoise = new Noise3D(rng.fork('ocean-age'));
  const stripNoise = new Noise3D(rng.fork('genesis-strip'));
  const basinNoise = new Noise3D(rng.fork('genesis-basins'));

  // 1. The continental mask: a lobed elliptical supercontinent, maybe a far microcontinent, no islands.
  const core = randomUnit(coreRng);
  const hasTraveler = coreRng.float() < TRAVELER_PROBABILITY;
  let second = randomUnit(coreRng);
  for (let tries = 0; tries < 30 && angleBetween(core[0], core[1], core[2], second[0], second[1], second[2]) < 1.7; tries++) second = randomUnit(coreRng);
  const aspect = coreRng.range(CORE_ASPECT[0], CORE_ASPECT[1]);
  const spin = coreRng.range(0, Math.PI);
  const [ca, cb] = tangentBasis(core);
  const dirAt = (azimuth: number): Vec3 => [
    Math.cos(azimuth) * ca[0] + Math.sin(azimuth) * cb[0],
    Math.cos(azimuth) * ca[1] + Math.sin(azimuth) * cb[1],
    Math.cos(azimuth) * ca[2] + Math.sin(azimuth) * cb[2],
  ];
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
    let s = 1.1 * Math.exp(-(stretched * stretched) / (2 * CORE_SIGMA * CORE_SIGMA)) +
      LOBE_AMPLITUDE * lobeNoise.fbm(x * LOBE_FREQUENCY, y * LOBE_FREQUENCY, z * LOBE_FREQUENCY, LOBE_OCTAVES);
    if (hasTraveler) {
      const a2 = angleBetween(x, y, z, second[0], second[1], second[2]);
      s += TRAVELER_WEIGHT * Math.exp(-(a2 * a2) / (2 * TRAVELER_SIGMA * TRAVELER_SIGMA));
    }
    score[i] = s;
  }
  const { mask: isContinental, label } = maskWithoutIslands(grid, score, CONTINENTAL_FRACTION);

  // 2. The first rift: a bent, stair-stepped line through the core with a random strike, and a
  // young ocean along it that widens from the hinge (the pole end) to the far end.
  const strikeDir = dirAt(riftRng.range(0, Math.PI));
  const rift = makeRiftPath(cross(core, strikeDir), core, riftRng);
  let thetaMin = Infinity;
  let thetaMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (label[i] !== 0) continue;
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    if (Math.abs(riftDistance(rift, x, y, z)) > 0.25) continue;
    const theta = riftAngle(rift, x, y, z);
    if (theta < thetaMin) thetaMin = theta;
    if (theta > thetaMax) thetaMax = theta;
  }
  if (!Number.isFinite(thetaMin)) {
    thetaMin = -0.5;
    thetaMax = 0.5;
  }
  const hingeAtMin = riftRng.float() < 0.5;
  const thetaPole = hingeAtMin ? thetaMin - RIFT_POLE_MARGIN : thetaMax + RIFT_POLE_MARGIN;
  const thetaFar = hingeAtMin ? thetaMax : thetaMin;
  const farWidth = cellAngle * riftRng.range(RIFT_WIDTH_CELLS[0], RIFT_WIDTH_CELLS[1]);
  const edgeAge = riftRng.range(RIFT_EDGE_AGE[0], RIFT_EDGE_AGE[1]);
  const oceanAge = new Float64Array(n);
  const young = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    oceanAge[i] = Math.max(0, OLD_OCEAN_AGE + OLD_OCEAN_AGE * ageNoise.fbm(x * 2, y * 2, z * 2, 4));
    const theta = riftAngle(rift, x, y, z);
    if (theta < thetaMin - 0.15 || theta > thetaMax + 0.15) continue;
    const frac = Math.min(1, Math.max(0, (theta - thetaPole) / (thetaFar - thetaPole)));
    const w = farWidth * frac;
    const d = Math.abs(riftDistance(rift, x, y, z));
    if (d >= w) continue;
    isContinental[i] = 0;
    label[i] = -1;
    young[i] = 1;
    oceanAge[i] = Math.min(oceanAge[i], (edgeAge * d) / w);
  }

  // 3. A failed third arm: a flooded trough running from the rift into one side.
  const trough = new Float64Array(n);
  if (riftRng.float() < AULACOGEN_PROBABILITY) {
    const thetaA = thetaMin + riftRng.range(0.25, 0.75) * (thetaMax - thetaMin);
    const base = onCircle(rift, thetaA);
    const shift = riftDistance(rift, base[0], base[1], base[2]);
    const start = normalize3(base[0] - shift * rift.normal[0], base[1] - shift * rift.normal[1], base[2] - shift * rift.normal[2]);
    const side = riftRng.float() < 0.5 ? -1 : 1;
    const tangent = cross(rift.normal, start);
    const skew = riftRng.range(-0.5, 0.5);
    const dir = normalize3(
      side * Math.cos(skew) * rift.normal[0] + Math.sin(skew) * tangent[0],
      side * Math.cos(skew) * rift.normal[1] + Math.sin(skew) * tangent[1],
      side * Math.cos(skew) * rift.normal[2] + Math.sin(skew) * tangent[2],
    );
    const armNormal = normalize3(...cross(start, dir));
    const length = cellAngle * riftRng.range(AULACOGEN_LENGTH_CELLS[0], AULACOGEN_LENGTH_CELLS[1]);
    const halfWidth = cellAngle * riftRng.range(AULACOGEN_WIDTH_CELLS[0], AULACOGEN_WIDTH_CELLS[1]);
    for (let i = 0; i < n; i++) {
      if (!isContinental[i]) continue;
      const x = xyz[3 * i];
      const y = xyz[3 * i + 1];
      const z = xyz[3 * i + 2];
      const perp = Math.abs(x * armNormal[0] + y * armNormal[1] + z * armNormal[2]);
      if (perp >= halfWidth) continue;
      const s = Math.atan2(x * dir[0] + y * dir[1] + z * dir[2], x * start[0] + y * start[1] + z * start[2]);
      if (s < 0 || s > length) continue;
      // Deepest on the axis near the rift, shoaling toward the edges and the tip.
      const across = perp / halfWidth;
      const tip = Math.max(0, (s - 0.7 * length) / (0.3 * length));
      const t = Math.min(1, Math.hypot(across, tip));
      trough[i] = AULACOGEN_THICKNESS_KM[0] + (AULACOGEN_THICKNESS_KM[1] - AULACOGEN_THICKNESS_KM[0]) * t;
    }
  }

  // 4. Margins: a BFS from the ocean tells each continental cell its distance to the sea and whether
  // that sea is the young ocean (passive, wide margin) or the old one (active, narrow margin).
  const toOcean = new Int32Array(n).fill(99);
  const fromYoung = new Uint8Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isContinental[i]) continue;
    toOcean[i] = 0;
    fromYoung[i] = young[i];
    frontier.push(i);
  }
  const marginHops = hops(MARGIN_PASSIVE_KM.length);
  for (let d = 1; d <= marginHops && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const nb = grid.nb[t];
        if (toOcean[nb] > d) {
          toOcean[nb] = d;
          fromYoung[nb] = fromYoung[i];
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  const thickness = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!isContinental[i]) continue;
    const d = toOcean[i];
    // Rifted fragments (the traveler and any other) have passive margins all around.
    const table = fromYoung[i] || label[i] >= 1 ? MARGIN_PASSIVE_KM : MARGIN_ACTIVE_KM;
    let base: number;
    const units = d / cellsPerUnit;
    if (d >= 1 && units <= table.length) base = marginThickness(table, units);
    else {
      const x = xyz[3 * i];
      const y = xyz[3 * i + 1];
      const z = xyz[3 * i + 2];
      base = CONTINENTAL_THICKNESS_KM + BASIN_AMPLITUDE_KM * basinNoise.fbm(x * BASIN_FREQUENCY, y * BASIN_FREQUENCY, z * BASIN_FREQUENCY, 3);
    }
    if (trough[i] > 0) base = Math.min(base, trough[i]);
    thickness[i] = base;
  }

  // 5. Plates. The two sides of the rift; the traveler; a strip of sea floor along every coast rides
  // with its continent; the rest of the ocean is a warped weighted Voronoi of free seeds.
  const plateOf = new Int32Array(n).fill(-1);
  const sideA = 0;
  const sideB = 1;
  let components = 0;
  for (let i = 0; i < n; i++) components = Math.max(components, label[i] + 1);
  const traveler = components > 1 && count >= 4 ? 2 : -1;
  const firstFree = traveler >= 0 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    if (!isContinental[i] && !young[i]) continue;
    if (label[i] === 1 && traveler >= 0) plateOf[i] = traveler;
    else plateOf[i] = riftDistance(rift, xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]) < 0 ? sideA : sideB;
  }
  const hop = new Int32Array(n).fill(99);
  const source = new Int32Array(n).fill(-1);
  frontier = [];
  for (let i = 0; i < n; i++) {
    if (plateOf[i] < 0) continue;
    hop[i] = 0;
    source[i] = plateOf[i];
    frontier.push(i);
  }
  const maxHop = hops(Math.max(STRIP_CELLS[1], FREE_SEED_CLEARANCE_CELLS));
  for (let d = 1; d <= maxHop && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const nb = grid.nb[t];
        if (hop[nb] > d) {
          hop[nb] = d;
          source[nb] = source[i];
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  for (let i = 0; i < n; i++) {
    if (plateOf[i] >= 0 || hop[i] > hops(STRIP_CELLS[1])) continue;
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    const width = STRIP_CELLS[0] + (STRIP_CELLS[1] - STRIP_CELLS[0]) * (0.5 + 0.5 * stripNoise.fbm(x * 1.5, y * 1.5, z * 1.5, 2));
    if (hop[i] <= Math.round(width * cellsPerUnit)) plateOf[i] = source[i];
  }
  const seeds: Vec3[] = [];
  const bias: number[] = [];
  while (seeds.length < count - firstFree) {
    let candidate = randomUnit(seedRng);
    for (let tries = 0; tries < 60; tries++) {
      let nearest = Infinity;
      for (const s of seeds) nearest = Math.min(nearest, angleBetween(candidate[0], candidate[1], candidate[2], s[0], s[1], s[2]));
      const cell = nearestCell(grid, candidate[0], candidate[1], candidate[2]);
      if (nearest > FREE_SPACING && hop[cell] > hops(FREE_SEED_CLEARANCE_CELLS)) break;
      candidate = randomUnit(seedRng);
    }
    seeds.push(candidate);
    bias.push(Math.max(-SIZE_BIAS_MAX, Math.min(SIZE_BIAS_MAX, SIZE_BIAS * seedRng.normal())));
  }
  for (let i = 0; i < n; i++) {
    if (plateOf[i] >= 0) continue;
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    if (seeds.length === 0) {
      plateOf[i] = riftDistance(rift, x, y, z) < 0 ? sideA : sideB;
      continue;
    }
    const wx = x + BOUNDARY_WARP * warpNoise.fbm(x * 1.5 + 11, y * 1.5, z * 1.5, 3);
    const wy = y + BOUNDARY_WARP * warpNoise.fbm(x * 1.5, y * 1.5 + 23, z * 1.5, 3);
    const wz = z + BOUNDARY_WARP * warpNoise.fbm(x * 1.5, y * 1.5, z * 1.5 + 37, 3);
    const [px, py, pz] = normalize3(wx, wy, wz);
    let best = 0;
    let bestScore = -Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const sc = px * seeds[s][0] + py * seeds[s][1] + pz * seeds[s][2] + bias[s];
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    plateOf[i] = firstFree + best;
  }

  // 6. Motions. The two sides open about the hinge pole; oceanic plates converge on the
  // supercontinent; the traveler drifts, half the time toward it.
  const plates: Plate[] = [];
  for (let p = 0; p < count; p++) {
    plates.push({ id: p, axis: randomUnit(seedRng), rate: cellAngle * speed * seedRng.range(0.15, 0.5), rotation: identity() });
  }
  const pole = onCircle(rift, thetaPole);
  const far = onCircle(rift, thetaFar);
  const opening = cellAngle * speed * riftRng.range(RIFT_OPENING_CELLS[0], RIFT_OPENING_CELLS[1]);
  let ox = pole[0] * opening;
  let oy = pole[1] * opening;
  let oz = pole[2] * opening;
  const v = cross([ox, oy, oz], far);
  if (v[0] * rift.normal[0] + v[1] * rift.normal[1] + v[2] * rift.normal[2] < 0) {
    ox = -ox;
    oy = -oy;
    oz = -oz;
  }
  const drift = randomUnit(seedRng);
  const driftRate = cellAngle * speed * seedRng.range(0.03, 0.1);
  setEulerVector(plates[sideA], drift[0] * driftRate - 0.5 * ox, drift[1] * driftRate - 0.5 * oy, drift[2] * driftRate - 0.5 * oz);
  setEulerVector(plates[sideB], drift[0] * driftRate + 0.5 * ox, drift[1] * driftRate + 0.5 * oy, drift[2] * driftRate + 0.5 * oz);
  if (traveler >= 0) {
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] !== 1) continue;
      gx += xyz[3 * i];
      gy += xyz[3 * i + 1];
      gz += xyz[3 * i + 2];
    }
    const g = normalize3(gx, gy, gz);
    const rate = cellAngle * speed * seedRng.range(TRAVELER_SPEED_CELLS[0], TRAVELER_SPEED_CELLS[1]);
    const axis = seedRng.float() < TRAVELER_INBOUND_PROBABILITY ? normalize3(...cross(g, core)) : randomUnit(seedRng);
    setEulerVector(plates[traveler], axis[0] * rate, axis[1] * rate, axis[2] * rate);
  }
  for (let s = 0; s < seeds.length; s++) {
    const p = plates[firstFree + s];
    const inbound = normalize3(...cross(seeds[s], core));
    const rate = p.rate;
    setEulerVector(
      p,
      rate * ((1 - RING_CONVERGENCE) * p.axis[0] + RING_CONVERGENCE * inbound[0]),
      rate * ((1 - RING_CONVERGENCE) * p.axis[1] + RING_CONVERGENCE * inbound[1]),
      rate * ((1 - RING_CONVERGENCE) * p.axis[2] + RING_CONVERGENCE * inbound[2]),
    );
  }

  return { plateOf, isContinental, thickness, oceanAge, plates, rift, core, sides: [sideA, sideB], traveler };
}

/**
 * Threshold the score at the quantile giving `fraction` of the cells, drop connected
 * fragments smaller than ISLAND_MIN_SHARE of the total, and lower the threshold to make
 * up for what was dropped. Labels are 0 for the largest component, then by size; -1 is ocean.
 */
function maskWithoutIslands(grid: Grid, score: Float64Array, fraction: number): { mask: Uint8Array; label: Int32Array } {
  const n = grid.n;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[b] - score[a]);
  const target = Math.round(fraction * n);
  let take = target;
  let mask = new Uint8Array(n);
  for (let iter = 0; iter < 8; iter++) {
    mask = new Uint8Array(n);
    for (let k = 0; k < Math.min(n, take); k++) mask[order[k]] = 1;
    const labeled = labelComponents(grid, mask);
    const minSize = ISLAND_MIN_SHARE * take;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (labeled.sizes[labeled.label[i]] < minSize) mask[i] = 0;
      else kept++;
    }
    if (kept >= target - 0.004 * n) break;
    take += target - kept;
  }
  return { mask, label: labelComponents(grid, mask).label };
}

/** Connected components of the mask over grid neighbors, labeled by decreasing size; -1 outside the mask. */
function labelComponents(grid: Grid, mask: Uint8Array): { label: Int32Array; sizes: number[] } {
  const n = grid.n;
  const raw = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || raw[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    raw[i] = id;
    stack.push(i);
    while (stack.length > 0) {
      const k = stack.pop() as number;
      size++;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const nb = grid.nb[t];
        if (mask[nb] && raw[nb] < 0) {
          raw[nb] = id;
          stack.push(nb);
        }
      }
    }
    sizes.push(size);
  }
  const rank = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  const remap = new Int32Array(sizes.length);
  for (let r = 0; r < rank.length; r++) remap[rank[r]] = r;
  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) label[i] = raw[i] < 0 ? -1 : remap[raw[i]];
  return { label, sizes: rank.map((i) => sizes[i]) };
}

/** Margin thickness at a distance from the sea in reference cells, interpolated between the table's values at whole cells. */
function marginThickness(table: readonly number[], units: number): number {
  if (units <= 1) return table[0];
  const last = table.length;
  if (units >= last) return table[last - 1];
  const lo = Math.floor(units);
  const f = units - lo;
  return table[lo - 1] * (1 - f) + table[lo] * f;
}

/** Point on the rift's base circle at the given along-angle. */
function onCircle(rift: RiftPath, theta: number): Vec3 {
  return [
    Math.cos(theta) * rift.origin[0] + Math.sin(theta) * rift.along[0],
    Math.cos(theta) * rift.origin[1] + Math.sin(theta) * rift.along[1],
    Math.cos(theta) * rift.origin[2] + Math.sin(theta) * rift.along[2],
  ];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Two orthonormal tangent vectors at a unit vector. */
function tangentBasis(p: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const t1 = normalize3(helper[1] * p[2] - helper[2] * p[1], helper[2] * p[0] - helper[0] * p[2], helper[0] * p[1] - helper[1] * p[0]);
  const t2 = normalize3(p[1] * t1[2] - p[2] * t1[1], p[2] * t1[0] - p[0] * t1[2], p[0] * t1[1] - p[1] * t1[0]);
  return [t1, t2];
}
