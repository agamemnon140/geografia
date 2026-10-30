import { EARTH_RADIUS_KM } from '../constants.ts';
import type { Grid } from '../grid/grid.ts';
import type { PlanetParams } from '../params.ts';
import { relativeRotation } from './circulation.ts';
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

/** Outgoing longwave at 0 degrees C with Earth's greenhouse, W/m^2 (North et al. 1981). */
export const OLR_A = 203.3;
/** Outgoing longwave slope, W/m^2 per degree C. */
export const OLR_B = 2.09;
/** Earth's heat transport coefficient for the unit-sphere Laplacian, W/m^2 per degree C. */
export const DIFFUSION_EARTH = 0.6;
/** Greenhouse forcing per e-fold of greenhouse strength (carbon dioxide forcing is logarithmic), W/m^2. */
export const GREENHOUSE_FORCING_W = 20;
/** Pressure broadening: forcing per e-fold of surface pressure, W/m^2. */
export const PRESSURE_GREENHOUSE_W = 8;
/** Global cooling at the glacial maximum (glacial phase 1), degrees C; Earth's last one was about 6. */
export const GLACIAL_COOLING_C = 6;
/** Planetary albedo of open ocean, bare land and ice, clouds included (Earth's mean is 0.30). */
export const ALBEDO_OCEAN = 0.26;
export const ALBEDO_LAND = 0.34;
export const ALBEDO_ICE = 0.62;
export const MIN_DIFFUSION = 0.03;
export const MAX_DIFFUSION = 30;
export const COARSE_SWEEPS = 200;
export const FINE_SWEEPS = 60;
export const SOR_RELAXATION = 1.6;
export const SOR_TOLERANCE = 1e-6;

/** Heat transport coefficient: more air transports more, faster rotation less (smaller eddies), a bigger planet needs more per unit angle. */
export function diffusion(params: PlanetParams): number {
  const size = EARTH_RADIUS_KM / params.radiusKm;
  const d = (DIFFUSION_EARTH * size * size * params.pressureBar) / relativeRotation(params);
  return Math.min(MAX_DIFFUSION, Math.max(MIN_DIFFUSION, d));
}

/** Outgoing longwave at 0 degrees C for the planet's greenhouse, pressure and glacial phase, W/m^2. */
export function olrOffset(params: PlanetParams): number {
  return OLR_A
    - GREENHOUSE_FORCING_W * Math.log(params.greenhouse)
    - PRESSURE_GREENHOUSE_W * Math.log(params.pressureBar)
    + OLR_B * GLACIAL_COOLING_C * params.glacialPhase;
}

/**
 * Solve B T - D laplacian(T) = absorbed - A for the annual-mean temperature
 * (degrees C), coarse to fine over the icosphere levels. `absorbed` is the
 * annual-mean absorbed sunlight per fine cell, indexable at every level.
 */
export function solveEnergyBalance(grid: Grid, params: PlanetParams, absorbed: Float64Array, out: Float64Array): void {
  const d = diffusion(params);
  const a = olrOffset(params);
  const levels = levelsUpTo(grid.level);
  let t = new Float64Array(0);
  for (let l = 0; l < levels.length; l++) {
    const g = levels[l];
    const mesh = meshGeometry(g);
    const next = new Float64Array(g.n);
    if (l > 0) prolongate(levels[l - 1], g, t, next);
    else for (let i = 0; i < g.n; i++) next[i] = (absorbed[i] - a) / OLR_B;
    const coef = new Float64Array(g.nb.length);
    const diag = new Float64Array(g.n);
    for (let i = 0; i < g.n; i++) {
      const s0 = g.nbStart[i];
      const s1 = g.nbStart[i + 1];
      let sum = 0;
      for (let k = s0; k < s1; k++) {
        const h = mesh.angle[k];
        const c = (d * 4) / ((s1 - s0) * h * h);
        coef[k] = c;
        sum += c;
      }
      diag[i] = OLR_B + sum;
    }
    const sweeps = l === levels.length - 1 ? FINE_SWEEPS : COARSE_SWEEPS;
    for (let sweep = 0; sweep < sweeps; sweep++) {
      let maxChange = 0;
      let scale = 0;
      const forward = sweep % 2 === 0;
      for (let k = 0; k < g.n; k++) {
        const i = forward ? k : g.n - 1 - k;
        let sum = absorbed[i] - a;
        for (let e = g.nbStart[i]; e < g.nbStart[i + 1]; e++) sum += coef[e] * next[g.nb[e]];
        const value = next[i] + SOR_RELAXATION * (sum / diag[i] - next[i]);
        const change = Math.abs(value - next[i]);
        if (change > maxChange) maxChange = change;
        next[i] = value;
        const mag = Math.abs(value);
        if (mag > scale) scale = mag;
      }
      if (sweep > 5 && maxChange < SOR_TOLERANCE * Math.max(1, scale)) break;
    }
    t = next;
  }
  out.set(t);
}
