import { Grid, cellAreasKm2 } from '../grid/grid.ts';
import { MIN_SATURATED_COLUMN_MM, SATURATION_OVER_EQUILIBRIUM, cloudCover, cloudLongwave, deepCloud } from './clouds.ts';
import { SAMPLES } from './insolation.ts';
import { meshGeometry, type MeshGeometry } from './mesh.ts';
import { levelsUpTo, prolongate } from './multilevel.ts';

/**
 * Moisture transport (DESIGN 3.5 step 5), solved as a steady state for each
 * sample: evaporation feeds a column of water vapor that the surface wind
 * carries from cell to cell (first-order upwind) and that transient eddies
 * spread across the wind (diffusion); the column rains out at a base rate,
 * faster where the wind lifts it over rising ground (orographic rain, and a
 * shadow in the lee because the column arrives depleted) and where the wind
 * field converges (the ITCZ and the polar front). Land re-evaporates a fixed
 * share of its rain, which is how moisture reaches continental interiors;
 * that share is folded into the land sink so one linear solve is exact.
 * The solve runs coarse to fine over the icosphere levels. SI inside, mm per
 * year outside.
 */

/** Ocean evaporation at the reference temperature, mm per year (Earth's ocean mean). */
export const OCEAN_EVAPORATION_MM = 1200;
export const EVAPORATION_REFERENCE_C = 18;
/** Clausius-Clapeyron: saturation vapor rises about 6.5% per degree C. */
export const CLAUSIUS_PER_C = 0.065;
/** Residence time of column moisture with no lifting, days (Earth's water vapor: about 9). */
export const RAINOUT_DAYS = 9;
/** Cold air rains out faster: extra rainout per degree below 20 C. */
export const COLD_RAINOUT_PER_C = 0.02;
/** Fraction of the column condensed per meter of lift (one over the moisture scale height). */
export const MOISTURE_SCALE_HEIGHT_M = 2500;
/** Rainout from convergence: fraction of the column per unit of negative divergence (seconds). */
export const CONVERGENCE_RAINOUT = 0.4;
/** Fraction of land precipitation that evaporates again (Earth: about 0.6 of continental rain comes back as evapotranspiration). */
export const LAND_RECYCLING = 0.6;
/** Transient eddies (storms) mix moisture across the mean wind: eddy diffusivity, m^2/s. */
export const EDDY_DIFFUSIVITY = 1.5e6;
/** Gauss-Seidel sweeps on the coarse levels and on the finest level. */
export const COARSE_SWEEPS = 300;
export const FINE_SWEEPS = 80;
export const SOLVE_TOLERANCE = 1e-5;
const SECONDS_PER_YEAR = 3.15576e7;

export interface MoistureFields {
  /** Precipitation per sample, sample-major, mm per year. */
  samples: Float64Array;
  /** Annual mean precipitation, mm per year. */
  annual: Float64Array;
  /** Annual evaporation (open water, and the recycled share on land), mm per year. */
  evaporation: Float64Array;
  /** Share of the annual precipitation due to orographic lift, mm per year. */
  orographic: Float64Array;
  /** Share due to wind convergence, mm per year. */
  convergence: Float64Array;
  /** Cloud cover per sample, sample-major, 0 to 1 (clouds.ts). */
  cloud: Float64Array;
  /** Annual-mean cloud cover. */
  cloudAnnual: Float64Array;
  /** Annual-mean longwave the clouds trap, W/m^2 (clouds.ts). */
  cloudLongwave: Float64Array;
}

/** Evaporation from open water at a surface temperature, mm per year. */
export function evaporationRate(temperatureC: number): number {
  return OCEAN_EVAPORATION_MM * Math.exp(CLAUSIUS_PER_C * (temperatureC - EVAPORATION_REFERENCE_C));
}

/** Per-level working arrays of the solver. */
interface Level {
  grid: Grid;
  mesh: MeshGeometry;
  areaKm2: Float64Array;
  hop: Float64Array;
  surface: Float64Array;
  water: Uint8Array;
  inflow: Float64Array;
  denom: Float64Array;
  rainout: Float64Array;
  oroShare: Float64Array;
  convShare: Float64Array;
  /** Lifting (orographic plus convergent rainout) and sinking (divergence plus descent) relative to the base rainout, for the cloud cover. */
  lifting: Float64Array;
  sinking: Float64Array;
  source: Float64Array;
  q: Float64Array;
}

export function computeMoisture(
  grid: Grid,
  radiusKm: number,
  elevation: Float64Array,
  seaLevel: number,
  lake: Int32Array,
  windU: Float64Array,
  windV: Float64Array,
  temperature: Float64Array,
  coldWater: Float64Array | null = null,
): MoistureFields {
  const nFine = grid.n;
  const radiusM = radiusKm * 1000;
  const levels: Level[] = levelsUpTo(grid.level).map((g) => {
    const mesh = meshGeometry(g);
    const edges = g.nb.length;
    const hop = new Float64Array(edges);
    for (let t = 0; t < edges; t++) hop[t] = mesh.angle[t] * radiusM;
    const surface = new Float64Array(g.n);
    const water = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) {
      surface[i] = elevation[i] >= seaLevel ? elevation[i] : seaLevel;
      water[i] = elevation[i] < seaLevel || lake[i] >= 0 ? 1 : 0;
    }
    return {
      grid: g, mesh, areaKm2: cellAreasKm2(g, radiusKm), hop, surface, water,
      inflow: new Float64Array(edges), denom: new Float64Array(g.n), rainout: new Float64Array(g.n),
      oroShare: new Float64Array(g.n), convShare: new Float64Array(g.n), lifting: new Float64Array(g.n), sinking: new Float64Array(g.n),
      source: new Float64Array(g.n), q: new Float64Array(g.n),
    };
  });
  const fine = levels[levels.length - 1];
  const samples = new Float64Array(SAMPLES * nFine);
  const annual = new Float64Array(nFine);
  const evaporation = new Float64Array(nFine);
  const orographic = new Float64Array(nFine);
  const convergence = new Float64Array(nFine);
  const cloud = new Float64Array(SAMPLES * nFine);
  const cloudAnnual = new Float64Array(nFine);
  const longwave = new Float64Array(nFine);
  const baseRate = 1 / (RAINOUT_DAYS * 86400);

  for (let s = 0; s < SAMPLES; s++) {
    const base = s * nFine;
    for (let l = 0; l < levels.length; l++) {
      const level = levels[l];
      buildCoefficients(level, base, windU, windV, temperature);
      // The coarsest level starts from the previous sample (seasons change slowly); the others from the level below.
      if (l > 0) prolongate(levels[l - 1].grid, level.grid, levels[l - 1].q, level.q);
      solveSteadyState(level, l === levels.length - 1 ? FINE_SWEEPS : COARSE_SWEEPS);
    }
    for (let i = 0; i < nFine; i++) {
      const p = fine.rainout[i] * fine.q[i] * SECONDS_PER_YEAR;
      const e = fine.water[i] ? fine.source[i] * SECONDS_PER_YEAR : LAND_RECYCLING * p;
      samples[base + i] = p;
      annual[i] += p / SAMPLES;
      evaporation[i] += e / SAMPLES;
      orographic[i] += (p * fine.oroShare[i]) / SAMPLES;
      convergence[i] += (p * fine.convShare[i]) / SAMPLES;
      // Cloud cover (clouds.ts): the column against the saturated column, taken as the equilibrium
      // column of a still open sea at the surface temperature (evaporation over the base rainout,
      // cold air raining out faster) times a saturation margin; then the lifting, the sinking and
      // the cold water of the cell.
      const t = temperature[base + i];
      const equilibrium = evaporationRate(t) / SECONDS_PER_YEAR / (baseRate * (1 + COLD_RAINOUT_PER_C * Math.max(0, 20 - t)));
      const saturated = Math.max(MIN_SATURATED_COLUMN_MM, SATURATION_OVER_EQUILIBRIUM * equilibrium);
      const cover = cloudCover(Math.min(1, fine.q[i] / saturated), fine.lifting[i], fine.sinking[i], fine.water[i] === 1, coldWater ? -coldWater[i] : 0);
      cloud[base + i] = cover;
      cloudAnnual[i] += cover / SAMPLES;
      longwave[i] += cloudLongwave(cover, deepCloud(fine.lifting[i], fine.sinking[i])) / SAMPLES;
    }
  }
  return { samples, annual, evaporation, orographic, convergence, cloud, cloudAnnual, cloudLongwave: longwave };
}

/** Transport, rainout and source coefficients of one level for one sample; `base` indexes the fine sample-major fields. */
function buildCoefficients(level: Level, base: number, windU: Float64Array, windV: Float64Array, temperature: Float64Array): void {
  const { grid, mesh, areaKm2, hop, surface, water, inflow, denom, rainout, oroShare, convShare, lifting, sinking, source } = level;
  const baseRate = 1 / (RAINOUT_DAYS * 86400);
  for (let i = 0; i < grid.n; i++) {
    const ui = windU[base + i];
    const vi = windV[base + i];
    const s0 = grid.nbStart[i];
    const s1 = grid.nbStart[i + 1];
    let out = 0;
    let lift = 0;
    let div = 0;
    for (let t = s0; t < s1; t++) {
      const j = grid.nb[t];
      const along = ui * mesh.east[t] + vi * mesh.north[t];
      const diffusion = EDDY_DIFFUSIVITY / (hop[t] * hop[t]);
      out += diffusion + (along > 0 ? along / (2 * hop[t]) : 0);
      const r = mesh.rev[t];
      const fromJ = windU[base + j] * mesh.east[r] + windV[base + j] * mesh.north[r];
      inflow[t] = (diffusion + (fromJ > 0 ? fromJ / (2 * hop[t]) : 0)) * (areaKm2[j] / areaKm2[i]);
      const slope = (surface[j] - surface[i]) / hop[t];
      lift += along * slope;
      div += ((windU[base + j] - ui) * mesh.east[t] + (windV[base + j] - vi) * mesh.north[t]) / hop[t];
    }
    const f = 2 / (s1 - s0);
    lift *= f;
    div *= f;
    const t = temperature[base + i];
    const cold = 1 + COLD_RAINOUT_PER_C * Math.max(0, 20 - t);
    const oro = lift > 0 ? lift / MOISTURE_SCALE_HEIGHT_M : 0;
    const conv = div < 0 ? -div * CONVERGENCE_RAINOUT : 0;
    const rate = baseRate * cold + oro + conv;
    rainout[i] = rate;
    oroShare[i] = oro / rate;
    convShare[i] = conv / rate;
    // Descent and divergence do not rain out; they dry the column's cloud (the lee, the subtropical highs).
    const sink = (lift < 0 ? -lift / MOISTURE_SCALE_HEIGHT_M : 0) + (div > 0 ? div * CONVERGENCE_RAINOUT : 0);
    lifting[i] = (oro + conv) / (baseRate * cold);
    sinking[i] = sink / (baseRate * cold);
    if (water[i]) {
      source[i] = evaporationRate(t) / SECONDS_PER_YEAR;
      denom[i] = out + rate;
    } else {
      source[i] = 0;
      denom[i] = out + rate * (1 - LAND_RECYCLING);
    }
  }
}

/** Gauss-Seidel on q * denom = source + sum of inflows, alternating sweep direction. */
function solveSteadyState(level: Level, maxSweeps: number): void {
  const { grid, inflow, denom, source, q } = level;
  const n = grid.n;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxChange = 0;
    let maxValue = 0;
    const forward = sweep % 2 === 0;
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k;
      let sum = source[i];
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) sum += inflow[t] * q[grid.nb[t]];
      const next = sum / denom[i];
      const change = Math.abs(next - q[i]);
      if (change > maxChange) maxChange = change;
      if (next > maxValue) maxValue = next;
      q[i] = next;
    }
    if (sweep > 5 && maxChange < SOLVE_TOLERANCE * maxValue) break;
  }
}
