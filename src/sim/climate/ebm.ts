import { EARTH_RADIUS_KM } from '../constants.ts';
import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { circulationCells, relativeRotation } from './circulation.ts';
import { DEG } from '../grid/geometry.ts';
import { meshGeometry } from './mesh.ts';
import { levelsUpTo, prolongate } from './multilevel.ts';

/**
 * Two-dimensional energy-balance model (DESIGN 9.1, built in M9), after
 * North, Cahalan and Coakley (1981): at every cell the absorbed sunlight
 * Q (1 - albedo) balances the outgoing longwave A + B T and the divergence
 * of a diffusive heat transport D laplacian(T), solved for the annual-mean
 * sea-level temperature on the sphere. The albedo depends on ice, so the
 * climate iterates the model with the ice extent it produces: a snowball
 * or a hothouse is an outcome, not a knob. A carries the greenhouse,
 * pressure broadening and the glacial-phase forcing; D carries pressure,
 * rotation and planet size.
 */

/**
 * Clear-sky outgoing longwave at 0 degrees C with Earth's greenhouse,
 * W/m^2. North et al. (1981) give 203.3 all-sky for a model whose
 * temperature is a zonal mean; here the balance is per cell with its own
 * albedo, the lapse rate measured from the mean surface, and the clouds'
 * trapped longwave subtracted per cell (M20), so A is the clear-sky value:
 * 206.5 brought the real Earth's surface mean to its observed 14.5 degrees
 * C with the clouds folded in, and the clouds now trap about 27 W/m^2 on
 * average (the ice feedback makes the response steep: about one degree per
 * W/m^2 here).
 */
export const OLR_A = 237;
/** Outgoing longwave slope, W/m^2 per degree C. */
export const OLR_B = 2.09;
/**
 * Earth's heat transport coefficient outside the Hadley cell for the
 * unit-sphere Laplacian, W/m^2 per degree C. North's 0.6 is the all-latitude
 * average; with the tropical boost below, 0.45 fits Earth's zonal profile
 * best (root-mean-square error 2.6 degrees, mid-latitudes 3 degrees too
 * cold, where the real storm tracks and ocean basins carry extra heat).
 */
export const DIFFUSION_EARTH = 0.45;
/** Greenhouse forcing per e-fold of greenhouse strength (carbon dioxide forcing is logarithmic), W/m^2. */
export const GREENHOUSE_FORCING_W = 20;
/** Pressure broadening: forcing per e-fold of surface pressure, W/m^2. */
export const PRESSURE_GREENHOUSE_W = 8;
/** Global cooling at the glacial maximum (glacial phase 1), degrees C; Earth's last one was about 6. */
export const GLACIAL_COOLING_C = 6;
/**
 * Clear-sky planetary albedo of open ocean, ice-free land and ice (M20;
 * until M19 the clouds were folded in as 0.27, 0.30 and 0.62). Clouds add
 * their own reflection through `planetaryAlbedo`, so under Earth's mean
 * cover of 0.62 the ocean returns to 0.26, the land to 0.30 and ice stays
 * near 0.65 (a bright surface under a cloud is still bright). ALBEDO_CLOUD
 * is the top-of-atmosphere reflection of an average deck (thick stratus
 * 0.6, thin cirrus 0.2); with these values clouds reflect about 50 W/m^2
 * of the real Earth's sunlight (observed 47).
 */
export const ALBEDO_OCEAN = 0.1;
export const ALBEDO_LAND = 0.16;
export const ALBEDO_ICE = 0.56;
export const ALBEDO_CLOUD = 0.3;
/** Longwave trapped per unit of cloud cover, W/m^2 (Earth's clouds trap about 27 W/m^2 at a cover of 0.62). */
export const CLOUD_LONGWAVE_W = 44;

/**
 * Albedo of a cell from its clear-sky surface albedo and its cloud cover.
 * Under the cloudy part the sunlight reflects between cloud and surface:
 * cloud + (1 - cloud)^2 surface / (1 - cloud surface), the two-stream sum,
 * which is why clouds hardly brighten an ice sheet but double the ocean's
 * reflection.
 */
export function planetaryAlbedo(surface: number, cloud: number): number {
  const cloudy = ALBEDO_CLOUD + ((1 - ALBEDO_CLOUD) * (1 - ALBEDO_CLOUD) * surface) / (1 - ALBEDO_CLOUD * surface);
  return surface * (1 - cloud) + cloudy * cloud;
}
export const MIN_DIFFUSION = 0.03;
export const MAX_DIFFUSION = 30;
/**
 * Extra transport inside the Hadley cell, as a multiple of D at the equator
 * fading linearly to zero at the cell's edge: the mean overturning carries
 * heat far more efficiently than mid-latitude eddies, which is why the real
 * tropics are nearly isothermal while the mid-latitudes are steep. A slow
 * rotator's planet-wide Hadley cell therefore comes out nearly isothermal.
 */
export const TROPICAL_TRANSPORT = 4;
/** Conjugate-gradient iterations and relative residual; the operator is symmetric positive definite. */
export const CG_MAX_ITERATIONS = 600;
export const CG_TOLERANCE = 1e-8;

/** Heat transport coefficient: more air transports more, faster rotation less (smaller eddies), a bigger planet needs more per unit angle. */
export function diffusion(params: PlanetParams, base = DIFFUSION_EARTH): number {
  const size = EARTH_RADIUS_KM / params.radiusKm;
  const d = (base * size * size * params.pressureBar) / relativeRotation(params);
  return Math.min(MAX_DIFFUSION, Math.max(MIN_DIFFUSION, d));
}

/** Transport coefficient per cell: the planet's D, boosted inside the Hadley cell. The last two arguments exist for tuning scripts. */
export function diffusionField(grid: Grid, params: PlanetParams, base = DIFFUSION_EARTH, boost = TROPICAL_TRANSPORT): Float64Array {
  const d = diffusion(params, base);
  const edge = circulationCells(params).hadleyEdgeDeg;
  const out = new Float64Array(grid.n);
  for (let i = 0; i < grid.n; i++) {
    const tropical = Math.max(0, 1 - Math.abs(grid.lat[i]) / DEG / edge);
    out[i] = d * (1 + boost * tropical);
  }
  return out;
}

/** Outgoing longwave at 0 degrees C for the planet's greenhouse, pressure and glacial phase, W/m^2. */
export function olrOffset(params: PlanetParams): number {
  return OLR_A
    - GREENHOUSE_FORCING_W * Math.log(params.greenhouse)
    - PRESSURE_GREENHOUSE_W * Math.log(params.pressureBar)
    + OLR_B * GLACIAL_COOLING_C * params.glacialPhase;
}

/**
 * Solve B T - div(D grad T) = absorbed - A for the annual-mean temperature
 * (degrees C) with preconditioned conjugate gradients, the coarse levels
 * giving the fine one its starting point. `absorbed` is the annual-mean
 * absorbed sunlight per fine cell, indexable at every level since coarse
 * vertices keep their ids. The edge weights use the mean transport of the
 * two cells and a fixed degree of six, so the operator is symmetric
 * positive definite and the iteration count stays in the tens however
 * stiff the transport makes the system. `forcing` is an optional per-cell
 * term added to the absorbed side (the longwave the clouds trap).
 */
export function solveEnergyBalance(grid: Grid, params: PlanetParams, absorbed: Float64Array, out: Float64Array, base = DIFFUSION_EARTH, boost = TROPICAL_TRANSPORT, forcing: Float64Array | null = null): void {
  const d = diffusionField(grid, params, base, boost);
  const a = olrOffset(params);
  const levels = levelsUpTo(grid.level);
  let t = new Float64Array(0);
  for (let l = 0; l < levels.length; l++) {
    const g = levels[l];
    const mesh = meshGeometry(g);
    const next = new Float64Array(g.n);
    if (l > 0) prolongate(levels[l - 1], g, t, next);
    else for (let i = 0; i < g.n; i++) next[i] = (absorbed[i] + (forcing ? forcing[i] : 0) - a) / OLR_B;
    const coef = new Float64Array(g.nb.length);
    const diag = new Float64Array(g.n);
    const rhs = new Float64Array(g.n);
    for (let i = 0; i < g.n; i++) {
      let sum = 0;
      for (let k = g.nbStart[i]; k < g.nbStart[i + 1]; k++) {
        const h = mesh.angle[k];
        const c = ((d[i] + d[g.nb[k]]) * 2) / (6 * h * h);
        coef[k] = c;
        sum += c;
      }
      diag[i] = OLR_B + sum;
      rhs[i] = absorbed[i] + (forcing ? forcing[i] : 0) - a;
    }
    conjugateGradient(g, coef, diag, rhs, next);
    t = next;
  }
  out.set(t);
}

/** Jacobi-preconditioned conjugate gradients on (diag - offdiag) x = rhs; `x` holds the initial guess and the answer. */
function conjugateGradient(g: Grid, coef: Float64Array, diag: Float64Array, rhs: Float64Array, x: Float64Array): void {
  const n = g.n;
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const q = new Float64Array(n);
  const apply = (v: Float64Array, outv: Float64Array): void => {
    for (let i = 0; i < n; i++) {
      let sum = diag[i] * v[i];
      for (let k = g.nbStart[i]; k < g.nbStart[i + 1]; k++) sum -= coef[k] * v[g.nb[k]];
      outv[i] = sum;
    }
  };
  apply(x, q);
  let rhsNorm = 0;
  for (let i = 0; i < n; i++) {
    r[i] = rhs[i] - q[i];
    rhsNorm += rhs[i] * rhs[i];
  }
  const target = CG_TOLERANCE * Math.sqrt(rhsNorm || 1);
  let rz = 0;
  for (let i = 0; i < n; i++) {
    z[i] = r[i] / diag[i];
    p[i] = z[i];
    rz += r[i] * z[i];
  }
  for (let iter = 0; iter < CG_MAX_ITERATIONS; iter++) {
    apply(p, q);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += p[i] * q[i];
    if (pq <= 0) break;
    const alpha = rz / pq;
    let rr = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * q[i];
      rr += r[i] * r[i];
    }
    if (Math.sqrt(rr) < target) break;
    let rzNext = 0;
    for (let i = 0; i < n; i++) {
      z[i] = r[i] / diag[i];
      rzNext += r[i] * z[i];
    }
    const beta = rzNext / rz;
    rz = rzNext;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
}
