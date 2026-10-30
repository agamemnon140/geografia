import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { relativeRotation } from './circulation.ts';
import { SAMPLES } from './insolation.ts';
import { meshGeometry, type MeshGeometry } from './mesh.ts';
import { levelsUpTo, prolongate } from './multilevel.ts';

/**
 * Wind-driven ocean circulation (DESIGN 3.5 step 4), solved rather than
 * drawn: the steady linear vorticity balance of Stommel (1948) on the
 * sphere, beta * dPsi/dx + r * laplacian(Psi) = curl(tau) / rho, with Psi
 * the transport streamfunction, zero on every coast. The beta term makes
 * the return flow pile up on the western side of each basin (Gulf Stream,
 * Kuroshio, Brazil and Agulhas currents); for a slow rotator beta vanishes
 * and the gyres become symmetric. The solve runs coarse to fine over the
 * icosphere levels, since basin-scale gyres converge slowly on the fine
 * grid alone. Currents then carry the zonal temperature contrast along the
 * flow: poleward boundary currents warm their coast, equatorward ones cool
 * it.
 */

/** Earth's rotation rate, rad/s. */
export const OMEGA_EARTH = 7.2921e-5;
export const AIR_DENSITY = 1.2;
/** Effective drag coefficient for wind stress, tau = rho_air * Cd * |w| * w, on the monthly-mean wind; gustiness roughly doubles the open-sea value of 1.3e-3. */
export const DRAG_COEFFICIENT = 2.5e-3;
export const WATER_DENSITY = 1025;
/** Depth over which the wind-driven transport is spread to give a surface velocity, m (the surface moves faster than the depth average). */
export const CURRENT_DEPTH_M = 100;
/** Width of the Stommel western boundary layer, r / beta, in cells of the level being solved; two to three cells keeps it resolved. */
export const STOMMEL_WIDTH_CELLS = 2.5;
/** Friction never drops below this fraction of its Earth value, so a non-rotating ocean still has finite gyres. */
export const MIN_FRICTION_FRACTION = 0.2;
export const SOR_RELAXATION = 1.7;
/** Sweeps on the coarse levels and on the finest level. */
export const COARSE_SWEEPS = 300;
export const FINE_SWEEPS = 150;
export const SOR_TOLERANCE = 1e-6;
/** Surface currents are clamped here; the linear model has no eddies to spend energy on. */
export const MAX_CURRENT_MS = 2.5;
/** Seconds of along-flow advection of the zonal temperature gradient that a cell's water keeps as an anomaly. */
export const HEAT_ADVECTION_SECONDS = 1e6;
/** Fraction of the upstream anomaly that survives one hop along the current. */
export const HEAT_DECAY_PER_HOP = 0.8;
export const HEAT_ITERATIONS = 80;
/** Fraction of the neighboring sea's anomaly that the coast feels, per hop inland. */
export const COASTAL_SHARE = 0.8;
export const COASTAL_HOPS = 4;

export interface BasinInfo {
  id: number;
  cells: number;
  areaKm2: number;
}

export interface OceanFields {
  /** Ocean basin id per cell, -1 on land. */
  basin: Int32Array;
  basins: BasinInfo[];
  /** Transport streamfunction, m^3/s (Sverdrups times 1e6); zero on land. */
  streamfunction: Float64Array;
  /** Surface current, eastward and northward, m/s; zero on land. */
  currentU: Float64Array;
  currentV: Float64Array;
  /** Temperature anomaly carried by the currents, degrees C, spread a few hops onto the coast. */
  sstAnomaly: Float64Array;
}

export function computeOcean(
  grid: Grid,
  params: PlanetParams,
  mesh: MeshGeometry,
  elevation: Float64Array,
  seaLevel: number,
  areaKm2: Float64Array,
  windU: Float64Array,
  windV: Float64Array,
  temperatureAnnual: Float64Array,
): OceanFields {
  const n = grid.n;
  const radiusM = params.radiusKm * 1000;
  const basin = new Int32Array(n).fill(-1);
  const basins = findBasins(grid, elevation, seaLevel, areaKm2, basin);

  // Annual-mean wind stress; indexable at every level since coarse vertices keep their ids.
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let s = 0; s < SAMPLES; s++) {
    for (let i = 0; i < n; i++) {
      u[i] += windU[s * n + i] / SAMPLES;
      v[i] += windV[s * n + i] / SAMPLES;
    }
  }
  const tauX = new Float64Array(n);
  const tauY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const speed = Math.hypot(u[i], v[i]);
    tauX[i] = AIR_DENSITY * DRAG_COEFFICIENT * speed * u[i];
    tauY[i] = AIR_DENSITY * DRAG_COEFFICIENT * speed * v[i];
  }

  const omega = OMEGA_EARTH * relativeRotation(params);
  const betaEarth30 = (2 * OMEGA_EARTH * Math.cos(Math.PI / 6)) / 6371008.8;
  const beta30 = (2 * omega * Math.cos(Math.PI / 6)) / radiusM;
  const levels = levelsUpTo(grid.level);
  let psi = new Float64Array(0);
  for (let l = 0; l < levels.length; l++) {
    const g = levels[l];
    const next = new Float64Array(g.n);
    if (l > 0) prolongate(levels[l - 1], g, psi, next);
    const hMean = Math.sqrt((4 * Math.PI) / g.n) * radiusM;
    const friction = Math.max(beta30, MIN_FRICTION_FRACTION * betaEarth30) * STOMMEL_WIDTH_CELLS * hMean;
    solveStommel(g, meshGeometry(g), elevation, seaLevel, tauX, tauY, radiusM, omega, friction, next, l === levels.length - 1 ? FINE_SWEEPS : COARSE_SWEEPS);
    psi = next;
  }

  // Surface velocity from the streamfunction: u = -dPsi/dy / H, v = dPsi/dx / H.
  const currentU = new Float64Array(n);
  const currentV = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (basin[i] < 0) continue;
    let gx = 0;
    let gy = 0;
    const s0 = grid.nbStart[i];
    const s1 = grid.nbStart[i + 1];
    for (let t = s0; t < s1; t++) {
      const d = (psi[grid.nb[t]] - psi[i]) / (mesh.angle[t] * radiusM);
      gx += d * mesh.east[t];
      gy += d * mesh.north[t];
    }
    const f = 2 / (s1 - s0);
    let cu = (-gy * f) / CURRENT_DEPTH_M;
    let cv = (gx * f) / CURRENT_DEPTH_M;
    const speed = Math.hypot(cu, cv);
    if (speed > MAX_CURRENT_MS) {
      cu *= MAX_CURRENT_MS / speed;
      cv *= MAX_CURRENT_MS / speed;
    }
    currentU[i] = cu;
    currentV[i] = cv;
  }

  const sstAnomaly = heatAdvection(grid, mesh, radiusM, basin, currentU, currentV, temperatureAnnual);
  return { basin, basins, streamfunction: psi, currentU, currentV, sstAnomaly };
}

/** Stommel balance on one level by successive over-relaxation; `psi` holds the initial guess and receives the solution, zero on land. */
function solveStommel(
  g: Grid,
  mesh: MeshGeometry,
  elevation: Float64Array,
  seaLevel: number,
  tauX: Float64Array,
  tauY: Float64Array,
  radiusM: number,
  omega: number,
  friction: number,
  psi: Float64Array,
  sweeps: number,
): void {
  const n = g.n;
  const forcing = new Float64Array(n);
  const coef = new Float64Array(g.nb.length);
  const diag = new Float64Array(n);
  const oceanCells: number[] = [];
  for (let i = 0; i < n; i++) {
    if (elevation[i] >= seaLevel) {
      psi[i] = 0;
      continue;
    }
    oceanCells.push(i);
    const beta = (2 * omega * Math.cos(g.lat[i])) / radiusM;
    const s0 = g.nbStart[i];
    const s1 = g.nbStart[i + 1];
    let curl = 0;
    let sum = 0;
    for (let t = s0; t < s1; t++) {
      const j = g.nb[t];
      const h = mesh.angle[t] * radiusM;
      curl += ((tauY[j] - tauY[i]) * mesh.east[t] - (tauX[j] - tauX[i]) * mesh.north[t]) / h;
      const c = (2 / ((s1 - s0) * h)) * ((2 * friction) / h + beta * mesh.east[t]);
      coef[t] = c;
      sum += c;
    }
    forcing[i] = ((2 / (s1 - s0)) * curl) / WATER_DENSITY;
    diag[i] = sum;
  }
  let scale = 0;
  for (const i of oceanCells) scale = Math.max(scale, Math.abs(psi[i]));
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let maxChange = 0;
    const forward = sweep % 2 === 0;
    for (let k = 0; k < oceanCells.length; k++) {
      const i = oceanCells[forward ? k : oceanCells.length - 1 - k];
      let sum = 0;
      for (let t = g.nbStart[i]; t < g.nbStart[i + 1]; t++) sum += coef[t] * psi[g.nb[t]];
      const next = (sum - forcing[i]) / diag[i];
      const updated = psi[i] + SOR_RELAXATION * (next - psi[i]);
      const change = Math.abs(updated - psi[i]);
      if (change > maxChange) maxChange = change;
      psi[i] = updated;
      const mag = Math.abs(updated);
      if (mag > scale) scale = mag;
    }
    if (sweep > 20 && maxChange < SOR_TOLERANCE * scale) break;
  }
}

/** Connected components of ocean cells. */
function findBasins(grid: Grid, elevation: Float64Array, seaLevel: number, areaKm2: Float64Array, basin: Int32Array): BasinInfo[] {
  const basins: BasinInfo[] = [];
  const queue = new Int32Array(grid.n);
  for (let s = 0; s < grid.n; s++) {
    if (basin[s] >= 0 || elevation[s] >= seaLevel) continue;
    const id = basins.length;
    let head = 0;
    let tail = 0;
    let cells = 0;
    let area = 0;
    basin[s] = id;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      cells++;
      area += areaKm2[i];
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const j = grid.nb[t];
        if (basin[j] < 0 && elevation[j] < seaLevel) {
          basin[j] = id;
          queue[tail++] = j;
        }
      }
    }
    basins.push({ id, cells, areaKm2: area });
  }
  return basins;
}

/**
 * Temperature anomaly carried along the current. Each cell's water picks up
 * minus (current dot gradient of the annual temperature) over a short time
 * and keeps a decaying share of what flowed in from upstream; the result is
 * then spread a few hops onto the coast.
 */
function heatAdvection(
  grid: Grid,
  mesh: MeshGeometry,
  radiusM: number,
  basin: Int32Array,
  cu: Float64Array,
  cv: Float64Array,
  temperature: Float64Array,
): Float64Array {
  const n = grid.n;
  const source = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (basin[i] < 0) continue;
    let gx = 0;
    let gy = 0;
    let count = 0;
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      if (basin[j] < 0) continue;
      const d = (temperature[j] - temperature[i]) / (mesh.angle[t] * radiusM);
      gx += d * mesh.east[t];
      gy += d * mesh.north[t];
      count++;
    }
    if (count === 0) continue;
    const f = 2 / count;
    source[i] = -(cu[i] * gx * f + cv[i] * gy * f) * HEAT_ADVECTION_SECONDS;
  }
  // Inflow weights per edge: how much of neighbor j's water enters i.
  const inflow = new Float64Array(grid.nb.length);
  for (let i = 0; i < n; i++) {
    if (basin[i] < 0) continue;
    for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
      const j = grid.nb[t];
      const r = mesh.rev[t];
      if (basin[j] < 0 || r < 0) continue;
      const w = cu[j] * mesh.east[r] + cv[j] * mesh.north[r];
      inflow[t] = w > 0 ? w : 0;
    }
  }
  let anomaly = Float64Array.from(source);
  let next = new Float64Array(n);
  for (let iter = 0; iter < HEAT_ITERATIONS; iter++) {
    for (let i = 0; i < n; i++) {
      if (basin[i] < 0) continue;
      let sum = 0;
      let weight = 0;
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const w = inflow[t];
        if (w <= 0) continue;
        sum += w * anomaly[grid.nb[t]];
        weight += w;
      }
      next[i] = source[i] + (weight > 0 ? (HEAT_DECAY_PER_HOP * sum) / weight : 0);
    }
    const swap = anomaly;
    anomaly = next;
    next = swap;
  }
  // Maritime influence: the coast feels its sea, fading inland.
  for (let hop = 0; hop < COASTAL_HOPS; hop++) {
    for (let i = 0; i < n; i++) {
      if (basin[i] >= 0) {
        next[i] = anomaly[i];
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const j = grid.nb[t];
        if (anomaly[j] !== 0 || basin[j] >= 0) {
          sum += anomaly[j];
          count++;
        }
      }
      next[i] = count > 0 ? (COASTAL_SHARE * sum) / count : 0;
    }
    const swap = anomaly;
    anomaly = next;
    next = swap;
  }
  return anomaly;
}
