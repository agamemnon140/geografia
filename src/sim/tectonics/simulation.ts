import { cellAreasKm2, type Grid } from '../grid/grid.ts';
import { nearestCell } from '../grid/locate.ts';
import { Hydrology } from '../hydrology/routing.ts';
import { solveSeaLevel, solveSeaLevelForFraction } from '../hypsometry.ts';
import { relativeGravity, waterVolumeKm3, type PlanetParams } from '../params.ts';
import { REFERENCE_CELL_KM } from '../constants.ts';
import { Noise3D } from '../rng/noise.ts';
import type { Rng } from '../rng/xoshiro.ts';
import {
  ANDEAN_RADIUS,
  ANDEAN_SHORTENING_KM,
  ARC_OVERRIDE_KM,
  ARC_ACCRETION_KM,
  ARC_RADIUS,
  ARC_RATE_KM,
  BUOYANT_THICKNESS_KM,
  COAL_MIN_C,
  COAL_MIN_MM,
  COLLISION_BRAKE,
  COLLISION_SATURATION_CELLS,
  CONTINENTAL,
  CONTINENTAL_BASE_M,
  CONTINENTAL_THICKNESS_KM,
  CRUST_DIFFUSION,
  DELTA_COAL_SHARE,
  EROSION_RATE,
  EVAPORITE_KM_PER_STEP,
  FLOW_RATE,
  FLOW_STAMP_KM,
  FLOW_THRESHOLD_KM,
  FLUVIAL_INTERVAL,
  FLUVIAL_K,
  FLUVIAL_MAX_DROP_FRACTION,
  HOTSPOT_COUNT,
  HOTSPOT_RATE_KM,
  ISOSTASY_M_PER_KM,
  LINEAGE_BARRIER,
  LINEAGE_COUNT,
  LINEAGE_DESERT_MM,
  LINEAGE_DIFFUSION,
  LINEAGE_LANDMASS_MIXING,
  LINEAGE_MOUNTAIN_M,
  MARGIN_EVENT_LOCK_STEPS,
  MAX_PLATES,
  MERGE_LOCK_STEPS,
  MERGE_MIN_SUTURE,
  MIN_THRUST_KM,
  OIL_MIN_C,
  PLATE_EVENT_INTERVAL,
  POLE_WALK_INTERVAL,
  RIFT_LOCK_STEPS,
  SHELF_DEPTH_M,
  RIFT_MIN_CONTINENT_FRACTION,
  RIFT_MIN_THICKNESS_KM,
  RIFT_POLE_MARGIN,
  RIFT_FAIL_HINGE,
  RIFT_FAIL_PROBABILITY,
  RIFT_FAIL_STEPS,
  RIFT_OFFSET,
  RIFT_PROBABILITY,
  RIFT_RATE_CELLS,
  ROLLBACK_MAX_CONTINENTAL_KM,
  ROLLBACK_MIN_AGE,
  ROLLBACK_MIN_CELLS,
  ROLLBACK_MIN_TRENCH,
  ROLLBACK_PROBABILITY,
  ROLLBACK_RATE_CELLS,
  ROLLBACK_WIDTH,
  SLIVER_MAX_NORMAL_COSINE,
  SLIVER_MIN_LENGTH,
  SLIVER_PROBABILITY,
  SLIVER_WIDTH,
  SLAB_BREAKOFF_CELLS,
  SLAB_PULL_RATE,
  SLAB_PULL_SATURATION_CELLS,
  SLAB_PULL_SPEED_CELLS,
  SLOW_RATE_CELLS,
  SEDIMENT_CAP_KM,
  SEDIMENT_M_PER_KM,
  SUPERCONTINENT_FRACTION,
  OCEANIC,
  OCEANIC_THICKNESS_KM,
  VOLCANIC_CAP_KM,
  convergentDepression,
  crustElevation,
  thicknessCap,
  volcanicFactor,
} from './crust.ts';
import { ParcelPool } from './parcels.ts';
import { genesis } from './genesis.ts';
import { makeRiftPath, riftDistance } from './riftpath.ts';
import { eulerVector, perturbPlates, randomUnit, rotatePlates, setEulerVector, velocityAt, type Plate } from './plates.ts';
import { apply, applyTranspose } from './rotation.ts';
import { normalize3 } from '../grid/geometry.ts';

/**
 * A plate event: a rift (`plate` split off `other`), a failed rift (`plate`
 * welded back onto `other`), a merger (`plate` joined `other`), a back-arc
 * opening (the arc became `plate`, off `other`) or a sliver capture
 * (`plate` took a strip of `other`'s coast).
 */
export interface TectonicEvent {
  step: number;
  type: 'rift' | 'fail' | 'merge' | 'rollback' | 'capture';
  plate: number;
  other: number;
}

export const BOUNDARY_NONE = 0;
export const BOUNDARY_DIVERGENT = 1;
export const BOUNDARY_CONVERGENT = 2;
export const BOUNDARY_SUBDUCTING = 3;
export const BOUNDARY_TRANSFORM = 4;

export const BOUNDARY_NAMES = ['interior', 'divergent (ridge)', 'convergent (overriding)', 'convergent (subducting)', 'transform'];

/**
 * Rigid-plate tectonics with crust parcels stored in plate frames (DESIGN 3.3).
 *
 * Each step: rotate every plate; map every parcel forward to the world cell
 * under it; resolve cells claimed by two plates (subduction, collision or a
 * harmless transform overlap); fill unclaimed cells either from a plate that
 * still covers them (resampling holes) or with new oceanic crust (ridges);
 * classify boundaries from relative velocities; compute elevation and sea
 * level; erode; feed hotspots; age the crust.
 */
export class TectonicsSim {
  readonly grid: Grid;
  readonly plates: Plate[];
  readonly pool: ParcelPool;
  readonly hotspots: Int32Array;
  readonly areaKm2: Float64Array;
  /** Shared with the pipeline, which runs the final pass on the finished relief. */
  readonly hydrology: Hydrology;
  readonly waterKm3: number;
  /** Target ocean cover; 0 lets the water volume set the sea level. */
  readonly targetOceanFraction: number;
  readonly cap: number;
  /** Angle of one grid cell, radians. */
  readonly cellAngle: number;
  /** Angle of one reference cell (about 112 km) on this planet: speeds in "cells per step" are in these. */
  readonly unitAngle: number;
  /** Grid cells per reference cell: 1 on Earth's grid, 2 on the fine grid. */
  readonly cellsPerUnit: number;
  /** Side of a grid cell, km. */
  readonly cellKm: number;
  /** Hop radii and counts converted to this grid (M18). */
  private readonly arcRadius: number;
  private readonly andeanRadius: number;
  private readonly rollbackWidth: number;
  private readonly sliverWidth: number;
  private readonly mergeMinSuture: number;
  private readonly rollbackMinTrench: number;
  private readonly rollbackMinCells: number;
  private readonly sliverMinLength: number;
  private readonly collisionSaturation: number;
  private readonly slabPullSaturation: number;
  private readonly slabBreakoff: number;
  /** Per-cell rates converted so fluxes per kilometer and per cell area stay the same on every grid. */
  private readonly arcRate: number;
  private readonly hotspotRadius: number;
  private readonly hotspotRate: number;
  private readonly crustDiffusion: number;
  private readonly flowRate: number;
  /** Mantle heat flux relative to Earth, and the plate speed factor derived from it. */
  readonly heat: number;
  readonly speed: number;
  step = 0;
  /** Cumulative continental thickness removed by erosion, in km times km^2. */
  erodedContinental = 0;
  /** Plate births and deaths, in order (DESIGN 9.1). */
  readonly events: TectonicEvent[] = [];
  /** Running counts of what the loop did, for diagnostics. */
  readonly tally = { subductions: 0, collisions: 0, accretions: 0, andeanKm: 0 };
  /** Consecutive steps each plate has spent below the locked speed. */
  readonly slowSteps: number[] = [];
  /** Plates that merged into another and own nothing anymore. */
  readonly dead: boolean[] = [];
  /** Continental collision cells per plate in the current step, for the brake. */
  private collisionCells: number[] = [];
  /** Rifts that will fail: the child welds back onto its parent at the given step. */
  private failingRifts: { child: number; parent: number; step: number }[] = [];
  /** Step of each plate's last back-arc opening or sliver capture. */
  private lastMarginEvent: number[] = [];
  private pullSum = new Float64Array(0);
  private pullCells = new Int32Array(0);
  /** Resampling pass in which each parcel arrived in its current frame, to tell aliasing from true overlap. */
  private arrivalStamp = new Int32Array(0);
  private eventRng: Rng;
  private totalAreaKm2 = 0;

  /** World view: parcel under each world cell. */
  readonly wParcel: Int32Array;
  readonly wPlate: Int32Array;
  readonly prevPlate: Int32Array;
  readonly boundary: Uint8Array;
  readonly elevation: Float64Array;
  seaLevel = 0;

  private poleRng: Rng;
  private conflicts: number[] = [];
  private posDot: Float64Array;
  private tmp = new Float64Array(6);
  private queue: Int32Array;
  private queued: Uint8Array;
  private stamp: Int32Array;
  private stampCounter = 0;
  private arcQueue = new Int32Array(128);
  private arcDist = new Int32Array(128);
  private andeanFound = new Int32Array(32);
  private delta: Float64Array;
  private flowDelta = new Float64Array(0);
  private tried = new Int32Array(8);
  private triedCount = new Int32Array(8);
  private triedParcel = new Int32Array(8);

  constructor(grid: Grid, params: PlanetParams, rng: Rng) {
    this.grid = grid;
    const n = grid.n;
    this.cellAngle = Math.sqrt((4 * Math.PI) / n);
    this.cellKm = params.radiusKm * this.cellAngle;
    this.unitAngle = REFERENCE_CELL_KM / params.radiusKm;
    this.cellsPerUnit = REFERENCE_CELL_KM / this.cellKm;
    const cells = (units: number): number => Math.max(1, Math.round(units * this.cellsPerUnit));
    const footprint = (radius: number): number => 1 + 3 * radius * (radius + 1);
    this.arcRadius = cells(ARC_RADIUS);
    this.andeanRadius = cells(ANDEAN_RADIUS);
    this.rollbackWidth = cells(ROLLBACK_WIDTH);
    this.sliverWidth = cells(SLIVER_WIDTH);
    this.mergeMinSuture = cells(MERGE_MIN_SUTURE);
    this.rollbackMinTrench = cells(ROLLBACK_MIN_TRENCH);
    this.rollbackMinCells = Math.max(1, Math.round(ROLLBACK_MIN_CELLS * this.cellsPerUnit * this.cellsPerUnit));
    this.sliverMinLength = cells(SLIVER_MIN_LENGTH);
    this.collisionSaturation = cells(COLLISION_SATURATION_CELLS);
    this.slabPullSaturation = cells(SLAB_PULL_SATURATION_CELLS);
    this.slabBreakoff = cells(SLAB_BREAKOFF_CELLS);
    // Arc magma per event spread over the footprint: the same volume per kilometer of trench on any grid.
    this.arcRate = (ARC_RATE_KM * footprint(ARC_RADIUS)) / footprint(this.arcRadius);
    // A hotspot feeds one reference cell's area per step, spread over the grid cells that cover it.
    this.hotspotRadius = cells(1) - 1;
    this.hotspotRate = (HOTSPOT_RATE_KM * this.cellsPerUnit * this.cellsPerUnit) / footprint(this.hotspotRadius);
    // Explicit diffusion and flow scale with the inverse square of the cell size, within stability.
    this.crustDiffusion = Math.min(0.12, CRUST_DIFFUSION * this.cellsPerUnit * this.cellsPerUnit);
    this.flowRate = Math.min(0.15, FLOW_RATE * this.cellsPerUnit * this.cellsPerUnit);
    if (this.arcQueue.length < 4 * footprint(Math.max(this.arcRadius, this.andeanRadius, this.hotspotRadius) + 1)) {
      const size = 4 * footprint(Math.max(this.arcRadius, this.andeanRadius, this.hotspotRadius) + 1);
      this.arcQueue = new Int32Array(size);
      this.arcDist = new Int32Array(size);
      this.andeanFound = new Int32Array(size);
    }
    this.areaKm2 = cellAreasKm2(grid, params.radiusKm);
    this.hydrology = new Hydrology(grid, this.areaKm2, params.radiusKm);
    this.waterKm3 = waterVolumeKm3(params);
    this.targetOceanFraction = params.oceanFraction;
    this.cap = thicknessCap(relativeGravity(params));
    this.poleRng = rng.fork('pole-walk');
    this.eventRng = rng.fork('plate-events');
    this.heat = params.mantleHeat;
    this.speed = Math.sqrt(params.mantleHeat);
    for (let j = 0; j < n; j++) this.totalAreaKm2 += this.areaKm2[j];

    const count = params.plateCount;
    // The initial condition: a rifted supercontinent and weighted Voronoi plates (tectonics/genesis.ts).
    const start = genesis(grid, count, rng.fork('genesis'), this.unitAngle, this.cellsPerUnit, this.speed);
    this.plates = start.plates;
    for (let p = 0; p < count; p++) {
      this.slowSteps.push(0);
      this.dead.push(false);
      this.collisionCells.push(0);
      this.lastMarginEvent.push(-MARGIN_EVENT_LOCK_STEPS);
    }
    const plateOf = start.plateOf;
    const isContinental = start.isContinental;
    this.pool = new ParcelPool(n, count);
    this.posDot = new Float64Array(this.pool.capacity);
    const detailNoise = new Noise3D(rng.fork('crust-detail'));
    const xyz = grid.xyz;
    // Margins (shelves, slopes, troughs) come with the initial condition; a little detail noise on top.
    for (let i = 0; i < n; i++) {
      const id = this.pool.alloc(plateOf[i], i, i);
      const x = xyz[3 * i];
      const y = xyz[3 * i + 1];
      const z = xyz[3 * i + 2];
      if (isContinental[i]) {
        this.pool.setContinental(id, start.thickness[i] + 4 * detailNoise.fbm(x * 4, y * 4, z * 4, 4));
      } else {
        this.pool.age[id] = start.oceanAge[i];
      }
    }

    this.seedLineages(isContinental);

    const hotspotRng = rng.fork('hotspots');
    this.hotspots = new Int32Array(HOTSPOT_COUNT);
    for (let h = 0; h < HOTSPOT_COUNT; h++) this.hotspots[h] = hotspotRng.int(n);

    this.wParcel = new Int32Array(n).fill(-1);
    this.wPlate = new Int32Array(n);
    this.prevPlate = new Int32Array(n);
    this.boundary = new Uint8Array(n);
    this.elevation = new Float64Array(n);
    this.queue = new Int32Array(n);
    this.queued = new Uint8Array(n);
    this.stamp = new Int32Array(n);
    this.delta = new Float64Array(n);

    this.advect();
    this.resolveConflicts();
    this.fillGaps();
    this.classifyBoundaries();
    this.prevPlate.set(this.wPlate);
    this.computeElevation();
  }

  /**
   * Advance `steps` steps. `onStep` runs after every step with the elevation
   * refreshed to match the parcels, so callers can snapshot the state for a
   * timeline (DESIGN 9.1).
   */
  run(steps: number, onProgress: (fraction: number) => void = () => {}, onStep: (step: number) => void = () => {}): void {
    for (let s = 0; s < steps; s++) {
      this.stepOnce();
      if (s % 10 === 9 || s === steps - 1) onProgress((s + 1) / steps);
      // The elevation of this step was computed before its erosion; refresh so the
      // state matches the parcels.
      this.computeElevation();
      onStep(this.step);
    }
  }

  /** Recompute the elevation and sea level from the parcels (after erosion). */
  refreshElevation(): void {
    this.computeElevation();
  }

  stepOnce(): void {
    rotatePlates(this.plates);
    this.prevPlate.set(this.wPlate);
    this.advect();
    this.resolveConflicts();
    this.fillGaps();
    this.classifyBoundaries();
    this.computeElevation();
    this.erode();
    if ((this.step + 1) % FLUVIAL_INTERVAL === 0) this.erodeFluvial();
    this.applyHotspots();
    this.ageCrust();
    this.step++;
    this.slabPull();
    this.brakeCollisions();
    if (this.step % POLE_WALK_INTERVAL === 0) perturbPlates(this.plates, this.poleRng, this.unitAngle, this.speed);
    this.trackSpeeds();
    if (this.step % PLATE_EVENT_INTERVAL === 0) {
      this.evolvePlates();
      // Mergers fuse parcels after this step's erosion; the cap must hold before the state is read.
      this.enforceCap();
    }
  }

  /**
   * Slab pull: each plate's Euler vector relaxes toward the rotation that
   * carries its subducting oceanic edge into the trench. The rotation that
   * moves a point x along a tangent direction n is x cross n; summing over
   * the plate's subducting cells gives the pull direction, and the length of
   * the trench sets its strength.
   */
  private slabPull(): void {
    const grid = this.grid;
    const xyz = grid.xyz;
    const pool = this.pool;
    const wPlate = this.wPlate;
    const claim = this.wParcel;
    const plates = this.plates;
    const count = plates.length;
    if (this.pullSum.length < 3 * count) {
      this.pullSum = new Float64Array(3 * count);
      this.pullCells = new Int32Array(count);
    }
    const sum = this.pullSum;
    const cells = this.pullCells;
    sum.fill(0);
    cells.fill(0);
    for (let j = 0; j < grid.n; j++) {
      if (this.boundary[j] !== BOUNDARY_SUBDUCTING) continue;
      const i = claim[j];
      if (pool.crustType[i] === CONTINENTAL && pool.thickness[i] >= BUOYANT_THICKNESS_KM) continue;
      const p = wPlate[j];
      const xj = xyz[3 * j];
      const yj = xyz[3 * j + 1];
      const zj = xyz[3 * j + 2];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        if (wPlate[nb] === p) continue;
        nx += xyz[3 * nb] - xj;
        ny += xyz[3 * nb + 1] - yj;
        nz += xyz[3 * nb + 2] - zj;
      }
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      sum[3 * p] += yj * nz - zj * ny;
      sum[3 * p + 1] += zj * nx - xj * nz;
      sum[3 * p + 2] += xj * ny - yj * nx;
      cells[p]++;
    }
    for (let p = 0; p < count; p++) {
      if (cells[p] === 0 || this.dead[p]) continue;
      // Slab break-off: a continent in the trench detaches the slab; the pull is gone.
      if (this.collisionCells[p] >= this.slabBreakoff) continue;
      const len = Math.hypot(sum[3 * p], sum[3 * p + 1], sum[3 * p + 2]);
      if (len < 1e-12) continue;
      const speed = SLAB_PULL_SPEED_CELLS * this.unitAngle * this.speed * Math.min(1, cells[p] / this.slabPullSaturation);
      const [ex, ey, ez] = eulerVector(plates[p]);
      const k = SLAB_PULL_RATE;
      setEulerVector(
        plates[p],
        ex + k * ((sum[3 * p] / len) * speed - ex),
        ey + k * ((sum[3 * p + 1] / len) * speed - ey),
        ez + k * ((sum[3 * p + 2] / len) * speed - ez),
      );
    }
  }

  /** Continental collision resists: a plate slows in proportion to how much of it is colliding this step. */
  private brakeCollisions(): void {
    for (let p = 0; p < this.plates.length; p++) {
      const cells = this.collisionCells[p];
      if (cells === 0) continue;
      this.plates[p].rate *= COLLISION_BRAKE ** Math.min(1, cells / this.collisionSaturation);
      this.collisionCells[p] = 0;
    }
  }

  private trackSpeeds(): void {
    const locked = SLOW_RATE_CELLS * this.unitAngle;
    for (let p = 0; p < this.plates.length; p++) {
      this.slowSteps[p] = this.plates[p].rate < locked ? this.slowSteps[p] + 1 : 0;
    }
  }

  /**
   * Plate births and deaths (DESIGN 9.1, M13). A rift that was going to fail
   * welds its child back onto the parent, leaving the gulf it opened. A plate
   * locked along a long continental suture merges into the plate it collided
   * with. A large continental plate that has been stalled for a while rifts,
   * because mantle heat piles up under a motionless continent, and a
   * supercontinent rifts whether it moves or not. Hotter mantles rift more
   * often, and some rifts are born to fail.
   */
  private evolvePlates(): void {
    const plates = this.plates;
    const due = this.failingRifts.filter((f) => f.step <= this.step);
    this.failingRifts = this.failingRifts.filter((f) => f.step > this.step);
    for (const f of due) {
      if (this.dead[f.child] || this.dead[f.parent]) continue;
      this.merge(f.child, f.parent);
      this.events[this.events.length - 1].type = 'fail';
    }
    for (let a = 0; a < plates.length; a++) {
      if (this.dead[a] || this.slowSteps[a] < MERGE_LOCK_STEPS) continue;
      const [b, suture] = this.longestSuture(a);
      if (b >= 0 && suture >= this.mergeMinSuture) this.merge(a, b);
    }
    const minArea = RIFT_MIN_CONTINENT_FRACTION * this.totalAreaKm2;
    const superArea = SUPERCONTINENT_FRACTION * this.totalAreaKm2;
    const count = plates.length;
    for (let p = 0; p < count; p++) {
      if (this.dead[p]) continue;
      const area = this.continentalArea(p);
      if (area < minArea) continue;
      if (this.slowSteps[p] < RIFT_LOCK_STEPS && area < superArea) continue;
      if (this.eventRng.float() < RIFT_PROBABILITY * this.heat) {
        this.rift(p, this.eventRng.float() < RIFT_FAIL_PROBABILITY);
      }
    }
    // Margin events (M14): back-arc openings where old floor goes down, sliver captures at transforms.
    for (let p = 0; p < count && this.plates.length < MAX_PLATES; p++) {
      if (this.dead[p] || this.step - this.lastMarginEvent[p] < MARGIN_EVENT_LOCK_STEPS) continue;
      const trench = this.findRollback(p);
      if (trench && trench.cells.length >= this.rollbackMinTrench && trench.meanAge >= ROLLBACK_MIN_AGE && this.eventRng.float() < ROLLBACK_PROBABILITY) {
        if (this.rollback(p, trench.cells) >= 0) continue;
      }
      const coast = this.findSliver(p);
      if (coast && coast.cells.length >= this.sliverMinLength && this.eventRng.float() < SLIVER_PROBABILITY) this.capture(p, coast.other, coast.cells);
    }
  }

  /** A new plate with the same frame and rotation as its parent at this instant. */
  private newPlate(parent: Plate): number {
    const id = this.pool.addPlate(this.grid.n);
    this.plates.push({ id, axis: [parent.axis[0], parent.axis[1], parent.axis[2]], rate: parent.rate, rotation: Float64Array.from(parent.rotation) });
    this.slowSteps.push(0);
    this.dead.push(false);
    this.collisionCells.push(0);
    this.lastMarginEvent.push(this.step);
    return id;
  }

  /**
   * The longest trench along which plate p overrides sinking oceanic crust:
   * the neighbor plate, p's cells on the trench and the mean age of the floor
   * going down. Null when p overrides nothing.
   */
  findRollback(p: number): { other: number; cells: number[]; meanAge: number } | null {
    const grid = this.grid;
    const pool = this.pool;
    const wPlate = this.wPlate;
    const claim = this.wParcel;
    const boundary = this.boundary;
    const found = new Map<number, { cells: number[]; age: number }>();
    for (let j = 0; j < grid.n; j++) {
      if (wPlate[j] !== p || boundary[j] !== BOUNDARY_CONVERGENT) continue;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        const q = wPlate[nb];
        if (q === p || boundary[nb] !== BOUNDARY_SUBDUCTING) continue;
        const i = claim[nb];
        if (pool.crustType[i] === CONTINENTAL && pool.thickness[i] >= BUOYANT_THICKNESS_KM) continue;
        let entry = found.get(q);
        if (!entry) {
          entry = { cells: [], age: 0 };
          found.set(q, entry);
        }
        entry.cells.push(j);
        entry.age += pool.age[i];
        break;
      }
    }
    let best: { other: number; cells: number[]; meanAge: number } | null = null;
    for (const [q, entry] of found) {
      if (!best || entry.cells.length > best.cells.length) best = { other: q, cells: entry.cells, meanAge: entry.age / entry.cells.length };
    }
    return best;
  }

  /**
   * Back-arc opening: plate p's cells within ROLLBACK_WIDTH of the trench
   * (forearc and arc) become a new plate that moves toward the trench, and a
   * marginal sea opens behind it as the gap fills with thinned margins and
   * new sea floor. Returns the arc plate's id, or -1 when the strip is too
   * small.
   */
  rollback(p: number, trench: number[]): number {
    const grid = this.grid;
    const pool = this.pool;
    const xyz = grid.xyz;
    const claim = this.wParcel;
    const wPlate = this.wPlate;
    const stamp = ++this.stampCounter;
    const st = this.stamp;
    let frontier: number[] = [];
    const taken: number[] = [];
    for (const j of trench) {
      if (st[j] === stamp) continue;
      st[j] = stamp;
      frontier.push(j);
      taken.push(j);
    }
    for (let d = 1; d < this.rollbackWidth && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const j of frontier) {
        for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
          const nb = grid.nb[t];
          if (st[nb] === stamp || wPlate[nb] !== p) continue;
          const i = claim[nb];
          if (pool.crustType[i] === CONTINENTAL && pool.thickness[i] >= ROLLBACK_MAX_CONTINENTAL_KM) continue;
          st[nb] = stamp;
          next.push(nb);
          taken.push(nb);
        }
      }
      frontier = next;
    }
    if (taken.length < this.rollbackMinCells) return -1;
    const parent = this.plates[p];
    const id = this.newPlate(parent);
    const parentIndex = pool.frameIndex[p];
    const childIndex = pool.frameIndex[id];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const j of taken) {
      const i = claim[j];
      if (i < 0 || !pool.alive[i] || pool.plate[i] !== p) continue;
      const k = pool.frameCell[i];
      parentIndex[k] = -1;
      childIndex[k] = i;
      pool.plate[i] = id;
      cx += xyz[3 * j];
      cy += xyz[3 * j + 1];
      cz += xyz[3 * j + 2];
    }
    // The arc swings like a door hinged at one end of the trench (M17): its far end moves toward
    // the trench and a triangular marginal sea opens behind it, leaving a peninsula attached at the
    // hinge (Italy and the Tyrrhenian, Japan and its sea). Rotation about the hinge point h at a
    // rate set so the far end moves at the rollback speed, signed so the arc moves outward.
    let tx = 0;
    let ty = 0;
    let tz = 0;
    for (const j of trench) {
      tx += xyz[3 * j];
      ty += xyz[3 * j + 1];
      tz += xyz[3 * j + 2];
    }
    const c = normalize3(cx, cy, cz);
    const t = normalize3(tx, ty, tz);
    // Trench direction: the axis of greatest spread of the trench cells; the hinge is one of its ends.
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const j of trench) {
      const dx = xyz[3 * j] - t[0];
      const dy = xyz[3 * j + 1] - t[1];
      const dz = xyz[3 * j + 2] - t[2];
      const sgn = ax * dx + ay * dy + az * dz >= 0 ? 1 : -1;
      ax += sgn * dx;
      ay += sgn * dy;
      az += sgn * dz;
    }
    let hinge = trench[0];
    let far = trench[0];
    let lo = Infinity;
    let hi = -Infinity;
    for (const j of trench) {
      const s = xyz[3 * j] * ax + xyz[3 * j + 1] * ay + xyz[3 * j + 2] * az;
      if (s < lo) {
        lo = s;
        hinge = j;
      }
      if (s > hi) {
        hi = s;
        far = j;
      }
    }
    if (this.eventRng.float() < 0.5) [hinge, far] = [far, hinge];
    const h: [number, number, number] = [xyz[3 * hinge], xyz[3 * hinge + 1], xyz[3 * hinge + 2]];
    const f: [number, number, number] = [xyz[3 * far], xyz[3 * far + 1], xyz[3 * far + 2]];
    // Outward: from the arc's centroid toward the trench, tangent at the far end.
    let nx = t[0] - c[0];
    let ny = t[1] - c[1];
    let nz = t[2] - c[2];
    const nf = nx * f[0] + ny * f[1] + nz * f[2];
    nx -= nf * f[0];
    ny -= nf * f[1];
    nz -= nf * f[2];
    const nlen = Math.hypot(nx, ny, nz);
    const sinHF = Math.hypot(h[1] * f[2] - h[2] * f[1], h[2] * f[0] - h[0] * f[2], h[0] * f[1] - h[1] * f[0]);
    if (nlen > 1e-9 && sinHF > 1e-6) {
      const speed = this.unitAngle * this.speed * this.eventRng.range(ROLLBACK_RATE_CELLS[0], ROLLBACK_RATE_CELLS[1]);
      let rate = speed / sinHF;
      // Velocity of the far end under omega = rate * h is rate * (h x f); flip if it points inward.
      const vx = h[1] * f[2] - h[2] * f[1];
      const vy = h[2] * f[0] - h[0] * f[2];
      const vz = h[0] * f[1] - h[1] * f[0];
      if (vx * nx + vy * ny + vz * nz < 0) rate = -rate;
      const [ex, ey, ez] = eulerVector(parent);
      setEulerVector(this.plates[id], ex + rate * h[0], ey + rate * h[1], ez + rate * h[2]);
    }
    this.lastMarginEvent[p] = this.step;
    this.events.push({ step: this.step, type: 'rollback', plate: id, other: p });
    return id;
  }

  /**
   * The longest stretch of plate p's continental coast sliding past an
   * oceanic plate (a transform margin): that plate and p's coastal cells.
   */
  findSliver(p: number): { other: number; cells: number[] } | null {
    const grid = this.grid;
    const pool = this.pool;
    const wPlate = this.wPlate;
    const claim = this.wParcel;
    const boundary = this.boundary;
    const xyz = grid.xyz;
    const tmp = this.tmp;
    const found = new Map<number, number[]>();
    for (let j = 0; j < grid.n; j++) {
      if (wPlate[j] !== p || boundary[j] === BOUNDARY_NONE) continue;
      const i = claim[j];
      if (pool.crustType[i] !== CONTINENTAL || pool.thickness[i] < BUOYANT_THICKNESS_KM) continue;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        const q = wPlate[nb];
        if (q === p || this.dead[q]) continue;
        const o = claim[nb];
        if (pool.crustType[o] === CONTINENTAL && pool.thickness[o] >= BUOYANT_THICKNESS_KM) continue;
        // Sliding: the relative motion is mostly along the coast, not across it.
        velocityAt(this.plates[q], xyz[3 * j], xyz[3 * j + 1], xyz[3 * j + 2], tmp, 0);
        velocityAt(this.plates[p], xyz[3 * j], xyz[3 * j + 1], xyz[3 * j + 2], tmp, 3);
        const vx = tmp[0] - tmp[3];
        const vy = tmp[1] - tmp[4];
        const vz = tmp[2] - tmp[5];
        const nx = xyz[3 * nb] - xyz[3 * j];
        const ny = xyz[3 * nb + 1] - xyz[3 * j + 1];
        const nz = xyz[3 * nb + 2] - xyz[3 * j + 2];
        const vlen = Math.hypot(vx, vy, vz);
        if (vlen < 1e-15) continue;
        const cosine = Math.abs(vx * nx + vy * ny + vz * nz) / (vlen * Math.hypot(nx, ny, nz));
        if (cosine > SLIVER_MAX_NORMAL_COSINE) continue;
        let cells = found.get(q);
        if (!cells) {
          cells = [];
          found.set(q, cells);
        }
        cells.push(j);
        break;
      }
    }
    let best: { other: number; cells: number[] } | null = null;
    for (const [q, cells] of found) if (!best || cells.length > best.cells.length) best = { other: q, cells };
    return best;
  }

  /**
   * Sliver capture: the continental cells of plate p within SLIVER_WIDTH of
   * the given coast pass to the other plate, resampled into its frame (as in a
   * merger), and travel with it from now on. Returns how many parcels moved.
   */
  capture(p: number, other: number, coast: number[]): number {
    const grid = this.grid;
    const pool = this.pool;
    const xyz = grid.xyz;
    const claim = this.wParcel;
    const wPlate = this.wPlate;
    const tmp = this.tmp;
    const stamp = ++this.stampCounter;
    const st = this.stamp;
    let frontier: number[] = [];
    const taken: number[] = [];
    for (const j of coast) {
      if (st[j] === stamp) continue;
      st[j] = stamp;
      frontier.push(j);
      taken.push(j);
    }
    for (let d = 1; d < this.sliverWidth && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const j of frontier) {
        for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
          const nb = grid.nb[t];
          if (st[nb] === stamp || wPlate[nb] !== p || pool.crustType[claim[nb]] !== CONTINENTAL) continue;
          st[nb] = stamp;
          next.push(nb);
          taken.push(nb);
        }
      }
      frontier = next;
    }
    const indexP = pool.frameIndex[p];
    const rq = this.plates[other].rotation;
    const arrival = ++this.stampCounter;
    let moved = 0;
    for (const j of taken) {
      const i = claim[j];
      if (i < 0 || !pool.alive[i] || pool.plate[i] !== p) continue;
      // The parcel sits under world cell j now; find that spot in the other plate's frame.
      applyTranspose(rq, xyz[3 * j], xyz[3 * j + 1], xyz[3 * j + 2], tmp, 0);
      const kq = nearestCell(grid, tmp[0], tmp[1], tmp[2], j);
      indexP[pool.frameCell[i]] = -1;
      this.placeInFrame(i, other, kq, arrival);
      moved++;
    }
    if (moved === 0) return 0;
    this.lastMarginEvent[p] = this.step;
    this.lastMarginEvent[other] = this.step;
    this.events.push({ step: this.step, type: 'capture', plate: other, other: p });
    return moved;
  }

  /** Continental area carried by a plate, km^2 (world view). */
  continentalArea(p: number): number {
    const pool = this.pool;
    let sum = 0;
    for (let j = 0; j < this.grid.n; j++) {
      if (this.wPlate[j] === p && pool.crustType[this.wParcel[j]] === CONTINENTAL) sum += this.areaKm2[j];
    }
    return sum;
  }

  /** The neighbor plate sharing the longest continental convergent contact with plate a, and that length in cells. */
  longestSuture(a: number): [number, number] {
    const grid = this.grid;
    const pool = this.pool;
    const counts = new Map<number, number>();
    for (let j = 0; j < grid.n; j++) {
      if (this.wPlate[j] !== a || pool.crustType[this.wParcel[j]] !== CONTINENTAL) continue;
      const type = this.boundary[j];
      if (type !== BOUNDARY_CONVERGENT && type !== BOUNDARY_SUBDUCTING) continue;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        const b = this.wPlate[nb];
        if (b === a || pool.crustType[this.wParcel[nb]] !== CONTINENTAL) continue;
        counts.set(b, (counts.get(b) ?? 0) + 1);
        break;
      }
    }
    let best = -1;
    let bestCount = 0;
    for (const [b, c] of counts) {
      if (c > bestCount || (c === bestCount && b < best)) {
        best = b;
        bestCount = c;
      }
    }
    return [best, bestCount];
  }

  /**
   * Split plate p along a rift through its continental centroid with a
   * random strike: a great circle bent at the thousand-kilometer scale and
   * offset by transform faults (riftpath.ts). The parcels on one side
   * become a new plate whose frame starts equal to the parent's, so nothing
   * moves at the instant of the split; the two plates then receive opposite
   * halves of a relative Euler vector whose pole sits just beyond one end of
   * the continent, so the rift opens along its whole length (fastest at the
   * far end), and the gap fills with thinned margins and then new sea floor.
   * A rift born to fail welds back after a few tens of steps (evolvePlates),
   * leaving the gulf it opened. Returns the new plate id, or -1 when the
   * plate has no continental crust.
   */
  rift(p: number, fails = false): number {
    const pool = this.pool;
    const grid = this.grid;
    const xyz = grid.xyz;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i] || pool.plate[i] !== p || pool.crustType[i] !== CONTINENTAL) continue;
      const k = pool.frameCell[i];
      cx += xyz[3 * k];
      cy += xyz[3 * k + 1];
      cz += xyz[3 * k + 2];
    }
    if (Math.hypot(cx, cy, cz) < 1e-9) return -1;
    const [ux, uy, uz] = normalize3(cx, cy, cz);
    // Normal of the rift's great circle: perpendicular to the centroid, random strike.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const [rx, ry, rz] = randomUnit(this.eventRng);
      nx = uy * rz - uz * ry;
      ny = uz * rx - ux * rz;
      nz = ux * ry - uy * rx;
      if (Math.hypot(nx, ny, nz) > 0.2) break;
    }
    [nx, ny, nz] = normalize3(nx, ny, nz);
    const path = makeRiftPath([nx, ny, nz], [ux, uy, uz], this.eventRng.fork(`rift-${this.events.length}`));
    // Extent of the continent along the circle, in the basis (u, w = n x u).
    const wx = ny * uz - nz * uy;
    const wy = nz * ux - nx * uz;
    const wz = nx * uy - ny * ux;
    let thetaMin = Infinity;
    let thetaMax = -Infinity;
    let dMin = Infinity;
    let dMax = -Infinity;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i] || pool.plate[i] !== p || pool.crustType[i] !== CONTINENTAL) continue;
      const k = pool.frameCell[i];
      const x = xyz[3 * k];
      const y = xyz[3 * k + 1];
      const z = xyz[3 * k + 2];
      const theta = Math.atan2(x * wx + y * wy + z * wz, x * ux + y * uy + z * uz);
      if (theta < thetaMin) thetaMin = theta;
      if (theta > thetaMax) thetaMax = theta;
      const d = x * nx + y * ny + z * nz;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
    // The line runs parallel to the centroid's great circle, shifted so the split is uneven.
    const shift = this.eventRng.range(-RIFT_OFFSET, RIFT_OFFSET) * 0.5 * (dMax - dMin);
    // A rift that will fail hinges inside the continent: a gulf opens beyond the hinge and the
    // crust on the near side is squeezed a little. A lasting rift hinges just beyond one end.
    const phi = fails
      ? thetaMin + this.eventRng.range(RIFT_FAIL_HINGE[0], RIFT_FAIL_HINGE[1]) * (thetaMax - thetaMin)
      : thetaMin - RIFT_POLE_MARGIN;
    const px = Math.cos(phi) * ux + Math.sin(phi) * wx;
    const py = Math.cos(phi) * uy + Math.sin(phi) * wy;
    const pz = Math.cos(phi) * uz + Math.sin(phi) * wz;

    // The new plate: same frame and rotation as the parent at this instant.
    const parent = this.plates[p];
    const id = this.newPlate(parent);
    const child = this.plates[id];
    const parentIndex = pool.frameIndex[p];
    const childIndex = pool.frameIndex[id];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i] || pool.plate[i] !== p) continue;
      const k = pool.frameCell[i];
      if (riftDistance(path, xyz[3 * k], xyz[3 * k + 1], xyz[3 * k + 2]) - shift <= 0) continue;
      parentIndex[k] = -1;
      childIndex[k] = i;
      pool.plate[i] = id;
      sx += xyz[3 * k];
      sy += xyz[3 * k + 1];
      sz += xyz[3 * k + 2];
    }
    // Relative Euler vector in the mantle frame, signed so the child moves away from the circle.
    const tmp = this.tmp;
    apply(parent.rotation, px, py, pz, tmp, 0);
    const rate = RIFT_RATE_CELLS * this.unitAngle * this.speed;
    let ox = tmp[0] * rate;
    let oy = tmp[1] * rate;
    let oz = tmp[2] * rate;
    apply(parent.rotation, nx, ny, nz, tmp, 3);
    const [gx, gy, gz] = normalize3(sx, sy, sz);
    apply(parent.rotation, gx, gy, gz, tmp, 0);
    const vx = oy * tmp[2] - oz * tmp[1];
    const vy = oz * tmp[0] - ox * tmp[2];
    const vz = ox * tmp[1] - oy * tmp[0];
    if (vx * tmp[3] + vy * tmp[4] + vz * tmp[5] < 0) {
      ox = -ox;
      oy = -oy;
      oz = -oz;
    }
    const [ex, ey, ez] = eulerVector(parent);
    setEulerVector(parent, ex - 0.5 * ox, ey - 0.5 * oy, ez - 0.5 * oz);
    setEulerVector(child, ex + 0.5 * ox, ey + 0.5 * oy, ez + 0.5 * oz);
    this.slowSteps[p] = 0;
    this.events.push({ step: this.step, type: 'rift', plate: id, other: p });
    if (fails) {
      const open = Math.round(this.eventRng.range(RIFT_FAIL_STEPS[0], RIFT_FAIL_STEPS[1]));
      this.failingRifts.push({ child: id, parent: p, step: this.step + open });
    }
    return id;
  }

  /**
   * Weld plate a onto plate b: every parcel of a is resampled into b's
   * frame at its current world position (two landing on one frame cell
   * fuse, continental thickness adding up), and a is left empty and dead.
   */
  merge(a: number, b: number): void {
    const pool = this.pool;
    const grid = this.grid;
    const xyz = grid.xyz;
    const tmp = this.tmp;
    const indexA = pool.frameIndex[a];
    const ra = this.plates[a].rotation;
    const rb = this.plates[b].rotation;
    const stamp = ++this.stampCounter;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i] || pool.plate[i] !== a) continue;
      const k = pool.frameCell[i];
      apply(ra, xyz[3 * k], xyz[3 * k + 1], xyz[3 * k + 2], tmp, 0);
      applyTranspose(rb, tmp[0], tmp[1], tmp[2], tmp, 3);
      const kb = nearestCell(grid, tmp[3], tmp[4], tmp[5], pool.lastWorld[i]);
      indexA[k] = -1;
      this.placeInFrame(i, b, kb, stamp);
    }
    this.dead[a] = true;
    this.slowSteps[a] = 0;
    this.slowSteps[b] = 0;
    this.events.push({ step: this.step, type: 'merge', plate: a, other: b });
  }

  /**
   * Put parcel i, resampled from another plate, on frame cell k of plate q.
   * Two parcels of the same source often land on one target cell (the two
   * lattices never line up), so a parcel that finds the cell taken by one
   * that arrived in the same resampling moves to the nearest free cell
   * within two rings instead of stacking on it: stacking doubled the crust
   * and left a field of 5 km peaks after every merger (M18). Only a cell held
   * by a parcel the target plate already had, a true overlap, fuses.
   */
  private placeInFrame(i: number, q: number, k: number, stamp: number): void {
    const pool = this.pool;
    const grid = this.grid;
    const index = pool.frameIndex[q];
    let target = k;
    const existing = index[k];
    // Any taken cell: look for a free one nearby first; stacking is the last resort (a true overlap
    // with the target plate's own crust, nowhere else to go).
    if (existing >= 0 && pool.alive[existing]) {
      target = -1;
      let best = Infinity;
      const kx = grid.xyz[3 * k];
      const ky = grid.xyz[3 * k + 1];
      const kz = grid.xyz[3 * k + 2];
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1] && target < 0; t++) {
        const nb = grid.nb[t];
        if (index[nb] < 0 || !pool.alive[index[nb]]) target = nb;
      }
      if (target < 0) {
        for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
          const ring = grid.nb[t];
          for (let u = grid.nbStart[ring]; u < grid.nbStart[ring + 1]; u++) {
            const nb = grid.nb[u];
            if (index[nb] >= 0 && pool.alive[index[nb]]) continue;
            const d = (grid.xyz[3 * nb] - kx) ** 2 + (grid.xyz[3 * nb + 1] - ky) ** 2 + (grid.xyz[3 * nb + 2] - kz) ** 2;
            if (d < best) {
              best = d;
              target = nb;
            }
          }
        }
      }
      if (target < 0) target = k;
    }
    const holder = index[target];
    if (holder >= 0 && pool.alive[holder]) {
      this.fuse(holder, i);
      pool.plate[i] = q;
      pool.frameCell[i] = target;
      pool.release(i);
      return;
    }
    pool.plate[i] = q;
    pool.frameCell[i] = target;
    index[target] = i;
    if (this.arrivalStamp.length < pool.capacity) {
      const grown = new Int32Array(pool.capacity);
      grown.set(this.arrivalStamp);
      this.arrivalStamp = grown;
    }
    this.arrivalStamp[i] = stamp;
  }

  /** Fold parcel `gone` into parcel `keep` (same frame cell after a merger). */
  private fuse(keep: number, gone: number): void {
    const pool = this.pool;
    if (pool.crustType[gone] === CONTINENTAL) {
      if (pool.crustType[keep] === CONTINENTAL) pool.thickness[keep] += pool.thickness[gone];
      else {
        pool.crustType[keep] = CONTINENTAL;
        pool.thickness[keep] = pool.thickness[gone];
      }
      pool.orogenyStep[keep] = this.step;
    }
    pool.volcanic[keep] = Math.min(VOLCANIC_CAP_KM, pool.volcanic[keep] + pool.volcanic[gone]);
    pool.sediment[keep] = Math.min(SEDIMENT_CAP_KM, pool.sediment[keep] + pool.sediment[gone]);
    pool.coal[keep] += pool.coal[gone];
    pool.oil[keep] += pool.oil[gone];
    pool.salt[keep] += pool.salt[gone];
    this.mergeLineages(keep, gone);
    pool.eroded[keep] = Math.max(pool.eroded[keep], pool.eroded[gone]);
    pool.age[keep] = Math.min(pool.age[keep], pool.age[gone]);
    this.spreadExcess(keep);
  }

  /** Continental crust volume in km times km^2 (thickness times frame-cell area), for conservation checks. */
  continentalVolume(): number {
    const pool = this.pool;
    let sum = 0;
    for (let i = 0; i < pool.count; i++) {
      if (pool.alive[i] && pool.crustType[i] === CONTINENTAL) sum += pool.thickness[i] * this.areaKm2[pool.frameCell[i]];
    }
    return sum;
  }

  /** Number of plates that still own at least one parcel. */
  activePlates(): number {
    const seen = new Uint8Array(this.plates.length);
    let count = 0;
    for (let j = 0; j < this.grid.n; j++) {
      const p = this.wPlate[j];
      if (!seen[p]) {
        seen[p] = 1;
        count++;
      }
    }
    return count;
  }

  private advect(): void {
    const pool = this.pool;
    const grid = this.grid;
    const xyz = grid.xyz;
    const claim = this.wParcel;
    const tmp = this.tmp;
    if (this.posDot.length < pool.capacity) this.posDot = new Float64Array(pool.capacity);
    const posDot = this.posDot;
    claim.fill(-1);
    this.conflicts.length = 0;
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i]) continue;
      const k = pool.frameCell[i];
      apply(this.plates[pool.plate[i]].rotation, xyz[3 * k], xyz[3 * k + 1], xyz[3 * k + 2], tmp, 0);
      const j = nearestCell(grid, tmp[0], tmp[1], tmp[2], pool.lastWorld[i]);
      pool.lastWorld[i] = j;
      posDot[i] = tmp[0] * xyz[3 * j] + tmp[1] * xyz[3 * j + 1] + tmp[2] * xyz[3 * j + 2];
      if (claim[j] < 0) claim[j] = i;
      else this.conflicts.push(j, i);
    }
  }

  private resolveConflicts(): void {
    const pool = this.pool;
    const claim = this.wParcel;
    const conflicts = this.conflicts;
    for (let c = 0; c < conflicts.length; c += 2) {
      const j = conflicts[c];
      const b = conflicts[c + 1];
      const a = claim[j];
      if (!pool.alive[b]) continue;
      if (a < 0 || !pool.alive[a]) {
        claim[j] = b;
        continue;
      }
      if (pool.plate[a] === pool.plate[b]) {
        if (this.posDot[b] > this.posDot[a]) claim[j] = b;
        continue;
      }
      const winner = this.winner(a, b);
      const loser = winner === a ? b : a;
      if (this.isConverging(j, pool.plate[loser], pool.plate[winner]) || this.isStranded(j, pool.plate[loser])) {
        this.consume(winner, loser);
        claim[j] = winner;
      } else {
        claim[j] = this.prevPlate[j] === pool.plate[b] ? b : a;
      }
    }
  }

  /**
   * Overriding parcel of two: continental beats oceanic; younger (more buoyant)
   * oceanic overrides older; between continents the lower plate id underthrusts
   * consistently along the whole suture (a thickness rule would make the
   * thickest cell a self-reinforcing sink).
   */
  private winner(a: number, b: number): number {
    const pool = this.pool;
    // Thin continental slivers (accreted margins) behave like oceanic crust in a collision.
    const ca = pool.crustType[a] === CONTINENTAL && pool.thickness[a] >= BUOYANT_THICKNESS_KM;
    const cb = pool.crustType[b] === CONTINENTAL && pool.thickness[b] >= BUOYANT_THICKNESS_KM;
    if (ca !== cb) return ca ? a : b;
    if (!ca) {
      // An arc's thickened crust resists subduction: the taller volcanic pile overrides.
      const dv = pool.volcanic[a] - pool.volcanic[b];
      if (Math.abs(dv) >= ARC_OVERRIDE_KM) return dv > 0 ? a : b;
      if (pool.age[a] !== pool.age[b]) return pool.age[a] < pool.age[b] ? a : b;
    }
    return pool.plate[a] < pool.plate[b] ? a : b;
  }

  /** Is the loser plate moving toward the winner plate's side of world cell j? */
  private isConverging(j: number, loserPlate: number, winnerPlate: number): boolean {
    const grid = this.grid;
    const xyz = grid.xyz;
    const prev = this.prevPlate;
    const xj = xyz[3 * j];
    const yj = xyz[3 * j + 1];
    const zj = xyz[3 * j + 2];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
      const nb = grid.nb[t];
      const sgn = prev[nb] === winnerPlate ? 1 : prev[nb] === loserPlate ? -1 : 0;
      if (sgn === 0) continue;
      nx += sgn * (xyz[3 * nb] - xj);
      ny += sgn * (xyz[3 * nb + 1] - yj);
      nz += sgn * (xyz[3 * nb + 2] - zj);
    }
    const d = nx * xj + ny * yj + nz * zj;
    nx -= d * xj;
    ny -= d * yj;
    nz -= d * zj;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-12) return true;
    const tmp = this.tmp;
    velocityAt(this.plates[loserPlate], xj, yj, zj, tmp, 0);
    velocityAt(this.plates[winnerPlate], xj, yj, zj, tmp, 3);
    const vx = tmp[0] - tmp[3];
    const vy = tmp[1] - tmp[4];
    const vz = tmp[2] - tmp[5];
    const vlen = Math.hypot(vx, vy, vz);
    if (vlen < 1e-15) return false;
    return vx * nx + vy * ny + vz * nz > 0.05 * vlen * nlen;
  }

  /** A parcel landing on a cell with no neighbor of its own plate is an intruder, whatever its velocity. */
  private isStranded(j: number, plate: number): boolean {
    const grid = this.grid;
    const prev = this.prevPlate;
    for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
      if (prev[grid.nb[t]] === plate) return false;
    }
    return prev[j] !== plate;
  }

  /** Collision or subduction of `loser` under `winner`. */
  private consume(winner: number, loser: number): void {
    const pool = this.pool;
    if (pool.crustType[loser] === CONTINENTAL) {
      // Crustal shortening. The stretched margins on both sides are the first to be
      // stacked back to full thickness (basin inversion: the seaway between two
      // colliding continents closes); what is left thickens the suture cell and its
      // continental neighbors on the overriding plate (a fold-and-thrust belt).
      const grid = this.grid;
      const index = pool.frameIndex[pool.plate[winner]];
      const k = pool.frameCell[winner];
      let mass = pool.thickness[loser];
      mass = this.invertMargins(index, k, mass);
      mass = this.invertMargins(pool.frameIndex[pool.plate[loser]], pool.frameCell[loser], mass);
      let count = 0;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const id = index[grid.nb[t]];
        if (id >= 0 && pool.alive[id] && pool.crustType[id] === CONTINENTAL) count++;
      }
      const toNeighbors = count > 0 ? 0.6 * mass : 0;
      pool.thickness[winner] += mass - toNeighbors;
      if (count > 0) {
        const share = toNeighbors / count;
        for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
          const id = index[grid.nb[t]];
          if (id >= 0 && pool.alive[id] && pool.crustType[id] === CONTINENTAL) {
            pool.thickness[id] += share;
            pool.orogenyStep[id] = this.step;
          }
        }
      }
      pool.orogenyStep[winner] = this.step;
      pool.volcanic[winner] = Math.min(VOLCANIC_CAP_KM, pool.volcanic[winner] + pool.volcanic[loser]);
      pool.sediment[winner] = Math.min(SEDIMENT_CAP_KM, pool.sediment[winner] + pool.sediment[loser]);
      // The suture keeps the swamps and salt of both sides; oil is cooked out of half of it.
      pool.coal[winner] += pool.coal[loser];
      pool.oil[winner] += 0.5 * pool.oil[loser];
      pool.salt[winner] += pool.salt[loser];
      this.mergeLineages(winner, loser);
      this.spreadExcess(winner);
      // Continental collision resists: both plates slow down (India after hitting Eurasia); applied per step.
      this.tally.collisions++;
      this.collisionCells[pool.plate[winner]]++;
      this.collisionCells[pool.plate[loser]]++;
    } else {
      this.tally.subductions++;
      this.addArc(winner);
      this.shortenMargin(winner);
      pool.sediment[winner] = Math.min(SEDIMENT_CAP_KM, pool.sediment[winner] + 0.5 * pool.sediment[loser]);
      // The accretionary prism scrapes half of the sea floor's organic sediment onto the margin.
      pool.coal[winner] += 0.5 * pool.coal[loser];
      pool.oil[winner] += 0.5 * pool.oil[loser];
    }
    pool.release(loser);
  }

  /**
   * Spend `mass` km of consumed crust restoring the continental frame
   * neighbors of cell k (on the plate with this frame index) that are thinner
   * than standard crust, thinnest first. Returns what is left.
   */
  private invertMargins(index: Int32Array, k: number, mass: number): number {
    const pool = this.pool;
    const grid = this.grid;
    for (let pass = 0; pass < 2 && mass > 1e-9; pass++) {
      // Two passes: the thinnest cell first, then whatever still falls short.
      let thinnest = -1;
      let thin = CONTINENTAL_THICKNESS_KM;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const id = index[grid.nb[t]];
        if (id < 0 || !pool.alive[id] || pool.crustType[id] !== CONTINENTAL) continue;
        if (pool.thickness[id] < thin) {
          thin = pool.thickness[id];
          thinnest = id;
        }
      }
      if (thinnest < 0) break;
      const fill = Math.min(mass, CONTINENTAL_THICKNESS_KM - thin);
      pool.thickness[thinnest] += fill;
      pool.orogenyStep[thinnest] = this.step;
      mass -= fill;
    }
    return mass;
  }

  /**
   * Push thickness above the cap onto every frame neighbor in equal shares
   * (plateau building). Continental neighbors thicken; oceanic neighbors are
   * accreted into continental crust; empty frame cells receive new continental
   * parcels (the crust thrusts outward). Volume is conserved, and a saturated
   * plateau always has an outlet at its edge.
   */
  private spreadExcess(w: number): void {
    const pool = this.pool;
    if (pool.thickness[w] <= this.cap) return;
    const grid = this.grid;
    const p = pool.plate[w];
    const index = pool.frameIndex[p];
    const k = pool.frameCell[w];
    const s = grid.nbStart[k];
    const e = grid.nbStart[k + 1];
    const share = (pool.thickness[w] - this.cap) / (e - s);
    pool.thickness[w] = this.cap;
    // Thrusting into empty frame cells only when the share is a real slab of crust;
    // smaller amounts go to the living neighbors instead.
    let alive = 0;
    for (let t = s; t < e; t++) {
      const id = index[grid.nb[t]];
      if (id >= 0 && pool.alive[id]) alive++;
    }
    const fillEmpty = share >= MIN_THRUST_KM || alive === 0;
    const aliveShare = fillEmpty ? share : share * ((e - s) / Math.max(1, alive));
    for (let t = s; t < e; t++) {
      const cell = grid.nb[t];
      const id = index[cell];
      if (id >= 0 && pool.alive[id]) {
        pool.crustType[id] = CONTINENTAL;
        pool.thickness[id] += aliveShare;
        pool.orogenyStep[id] = this.step;
      } else if (fillEmpty) {
        const fresh = pool.alloc(p, cell, pool.lastWorld[w]);
        pool.setContinental(fresh, share);
        pool.orogenyStep[fresh] = this.step;
      }
    }
  }

  /**
   * Andean orogeny: the continental crust of the overriding plate within
   * ANDEAN_RADIUS of the trench shortens and thickens a little with every
   * parcel subducted beneath it (shared among the cells found), whether the
   * trench sits on the continent itself or on the strip of sea floor it
   * carries.
   */
  private shortenMargin(w: number): void {
    const pool = this.pool;
    const grid = this.grid;
    const index = pool.frameIndex[pool.plate[w]];
    const stamp = ++this.stampCounter;
    const st = this.stamp;
    const q = this.arcQueue;
    const dist = this.arcDist;
    let head = 0;
    let tail = 0;
    q[tail] = pool.frameCell[w];
    dist[tail++] = 0;
    st[pool.frameCell[w]] = stamp;
    let found = 0;
    while (head < tail) {
      const k = q[head];
      const d = dist[head++];
      const id = index[k];
      if (id >= 0 && pool.alive[id] && pool.crustType[id] === CONTINENTAL) {
        this.andeanFound[found++] = id;
        if (found >= this.andeanFound.length) break;
      }
      if (d >= this.andeanRadius) continue;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const nb = grid.nb[t];
        if (st[nb] === stamp || tail >= q.length) continue;
        st[nb] = stamp;
        q[tail] = nb;
        dist[tail++] = d + 1;
      }
    }
    if (found === 0) return;
    const share = ANDEAN_SHORTENING_KM / found;
    this.tally.andeanKm += ANDEAN_SHORTENING_KM;
    for (let f = 0; f < found; f++) {
      const id = this.andeanFound[f];
      pool.thickness[id] += share;
      pool.orogenyStep[id] = this.step;
      this.spreadExcess(id);
    }
  }

  /** Volcanic arc: thicken the overriding plate's frame cells within ARC_RADIUS of the boundary cell. */
  private addArc(w: number): void {
    const pool = this.pool;
    const grid = this.grid;
    const index = pool.frameIndex[pool.plate[w]];
    const stamp = ++this.stampCounter;
    const st = this.stamp;
    const q = this.arcQueue;
    const dist = this.arcDist;
    let head = 0;
    let tail = 0;
    q[tail] = pool.frameCell[w];
    dist[tail++] = 0;
    st[pool.frameCell[w]] = stamp;
    while (head < tail) {
      const k = q[head];
      const d = dist[head++];
      const id = index[k];
      if (id >= 0 && pool.alive[id] && pool.volcanic[id] < VOLCANIC_CAP_KM) {
        pool.volcanic[id] += this.arcRate;
        if (pool.crustType[id] === OCEANIC && pool.volcanic[id] >= ARC_ACCRETION_KM) this.accreteArc(id);
      }
      if (d >= this.arcRadius) continue;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const nb = grid.nb[t];
        if (st[nb] === stamp || tail >= q.length) continue;
        st[nb] = stamp;
        q[tail] = nb;
        dist[tail++] = d + 1;
      }
    }
  }

  /**
   * An island arc has grown on oceanic crust: the pile becomes buoyant
   * continental crust of the thickness that keeps its surface where it is
   * (Japan, the Philippines, Central America), so it accretes to whatever it
   * meets instead of subducting. Volume is not conserved here on purpose: arc
   * magmas come from the mantle.
   */
  private accreteArc(id: number): void {
    const pool = this.pool;
    const surface = crustElevation(OCEANIC, OCEANIC_THICKNESS_KM, pool.age[id], pool.volcanic[id], 0);
    const thickness = CONTINENTAL_THICKNESS_KM + (surface - CONTINENTAL_BASE_M) / ISOSTASY_M_PER_KM;
    pool.setContinental(id, Math.min(this.cap, Math.max(BUOYANT_THICKNESS_KM, thickness)));
    pool.volcanic[id] = 0;
    pool.orogenyStep[id] = this.step;
    this.tally.accretions++;
  }

  /** Unclaimed world cells: resampling holes get the plate still covering them; true gaps get new oceanic crust. */
  private fillGaps(): void {
    const grid = this.grid;
    const pool = this.pool;
    const claim = this.wParcel;
    const queue = this.queue;
    const queued = this.queued;
    const tmp = this.tmp;
    const xyz = grid.xyz;
    const tried = this.tried;
    const triedCount = this.triedCount;
    const triedParcel = this.triedParcel;
    queued.fill(0);
    let head = 0;
    let tail = 0;
    for (let j = 0; j < grid.n; j++) {
      if (claim[j] >= 0) continue;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        if (claim[grid.nb[t]] >= 0) {
          queue[tail++] = j;
          queued[j] = 1;
          break;
        }
      }
    }
    while (head < tail) {
      const j = queue[head++];
      if (claim[j] >= 0) continue;
      const xj = xyz[3 * j];
      const yj = xyz[3 * j + 1];
      const zj = xyz[3 * j + 2];
      // Candidate plates among claimed neighbors, with how many neighbors each has.
      let nTried = 0;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const a = claim[grid.nb[t]];
        if (a < 0) continue;
        const p = pool.plate[a];
        let seen = false;
        for (let u = 0; u < nTried; u++) {
          if (tried[u] === p) {
            triedCount[u]++;
            seen = true;
            break;
          }
        }
        if (seen) continue;
        tried[nTried] = p;
        triedCount[nTried] = 1;
        triedParcel[nTried] = a;
        nTried++;
      }
      // Sort candidates by neighbor count (desc), then plate id, so the majority plate is tried first.
      for (let u = 1; u < nTried; u++) {
        for (let v = u; v > 0; v--) {
          const better = triedCount[v] > triedCount[v - 1] || (triedCount[v] === triedCount[v - 1] && tried[v] < tried[v - 1]);
          if (!better) break;
          let tmpI = tried[v]; tried[v] = tried[v - 1]; tried[v - 1] = tmpI;
          tmpI = triedCount[v]; triedCount[v] = triedCount[v - 1]; triedCount[v - 1] = tmpI;
          tmpI = triedParcel[v]; triedParcel[v] = triedParcel[v - 1]; triedParcel[v - 1] = tmpI;
        }
      }
      let found = -1;
      for (let u = 0; u < nTried && found < 0; u++) {
        const p = tried[u];
        applyTranspose(this.plates[p].rotation, xj, yj, zj, tmp, 0);
        const k = nearestCell(grid, tmp[0], tmp[1], tmp[2], pool.frameCell[triedParcel[u]]);
        const id = pool.frameIndex[p][k];
        if (id >= 0 && pool.alive[id]) found = id;
      }
      if (found >= 0) {
        claim[j] = found;
      } else if (nTried > 0) {
        const p = tried[0];
        const margin = triedParcel[0];
        applyTranspose(this.plates[p].rotation, xj, yj, zj, tmp, 0);
        const k = nearestCell(grid, tmp[0], tmp[1], tmp[2], pool.frameCell[margin]);
        const existing = pool.frameIndex[p][k];
        if (existing >= 0 && pool.alive[existing]) {
          claim[j] = existing;
        } else {
          const fresh = pool.alloc(p, k, j);
          claim[j] = fresh;
          // Continental rifting: before sea-floor spreading starts, the margin stretches and
          // half of its crust moves into the gap as thinned continental crust (volume conserved).
          if (pool.crustType[margin] === CONTINENTAL && pool.thickness[margin] > RIFT_MIN_THICKNESS_KM) {
            const half = 0.5 * pool.thickness[margin];
            pool.thickness[margin] -= half;
            pool.setContinental(fresh, half);
            pool.age[fresh] = pool.age[margin];
          }
        }
      }
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        if (claim[nb] < 0 && !queued[nb]) {
          queued[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }
  }

  /** Boundary type per world cell from the relative velocity of neighboring plates. */
  private classifyBoundaries(): void {
    const grid = this.grid;
    const pool = this.pool;
    const claim = this.wParcel;
    const wPlate = this.wPlate;
    const boundary = this.boundary;
    const xyz = grid.xyz;
    const tmp = this.tmp;
    const plates = this.plates;
    for (let j = 0; j < grid.n; j++) wPlate[j] = pool.plate[claim[j]];
    for (let j = 0; j < grid.n; j++) {
      const p = wPlate[j];
      const xj = xyz[3 * j];
      const yj = xyz[3 * j + 1];
      const zj = xyz[3 * j + 2];
      let type = BOUNDARY_NONE;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        const q = wPlate[nb];
        if (q === p) continue;
        velocityAt(plates[q], xj, yj, zj, tmp, 0);
        velocityAt(plates[p], xj, yj, zj, tmp, 3);
        const vx = tmp[0] - tmp[3];
        const vy = tmp[1] - tmp[4];
        const vz = tmp[2] - tmp[5];
        const nx = xyz[3 * nb] - xj;
        const ny = xyz[3 * nb + 1] - yj;
        const nz = xyz[3 * nb + 2] - zj;
        const vlen = Math.hypot(vx, vy, vz);
        const nlen = Math.hypot(nx, ny, nz);
        const s = vlen > 1e-15 ? (vx * nx + vy * ny + vz * nz) / (vlen * nlen) : 0;
        if (s < -0.3) {
          if (type !== BOUNDARY_CONVERGENT && type !== BOUNDARY_SUBDUCTING) {
            type = this.winner(claim[j], claim[nb]) === claim[j] ? BOUNDARY_CONVERGENT : BOUNDARY_SUBDUCTING;
          }
        } else if (s > 0.3) {
          if (type === BOUNDARY_NONE || type === BOUNDARY_TRANSFORM) type = BOUNDARY_DIVERGENT;
        } else if (type === BOUNDARY_NONE) {
          type = BOUNDARY_TRANSFORM;
        }
      }
      boundary[j] = type;
    }
  }

  private computeElevation(): void {
    const pool = this.pool;
    const claim = this.wParcel;
    const elevation = this.elevation;
    const boundary = this.boundary;
    for (let j = 0; j < this.grid.n; j++) {
      const i = claim[j];
      let e = crustElevation(pool.crustType[i], pool.thickness[i], pool.age[i], pool.volcanic[i], pool.sediment[i]);
      if (boundary[j] === BOUNDARY_SUBDUCTING) e -= convergentDepression(pool.crustType[i], pool.thickness[i]);
      elevation[j] = e;
    }
    // Either the water inventory sets the sea level, or a target ocean cover does and the inventory follows.
    this.seaLevel = this.targetOceanFraction > 0
      ? solveSeaLevelForFraction(elevation, this.areaKm2, this.targetOceanFraction)
      : solveSeaLevel(elevation, this.areaKm2, this.waterKm3);
  }

  /** Erosion of land toward the lowest neighbor, diffusion of continental thickness, cap enforcement. */
  private erode(): void {
    const grid = this.grid;
    const pool = this.pool;
    const claim = this.wParcel;
    const elevation = this.elevation;
    const sea = this.seaLevel;
    for (let j = 0; j < grid.n; j++) {
      const h = elevation[j] - sea;
      if (h <= 0) continue;
      let lowest = j;
      let le = elevation[j];
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        if (elevation[nb] < le) {
          le = elevation[nb];
          lowest = nb;
        }
      }
      if (lowest === j) continue;
      const dk = this.denude(j, EROSION_RATE * h);
      if (dk <= 0) continue;
      const target = claim[lowest];
      if (pool.sediment[target] < SEDIMENT_CAP_KM) pool.sediment[target] += dk;
    }

    const delta = this.delta;
    const wPlate = this.wPlate;
    delta.fill(0);
    for (let j = 0; j < grid.n; j++) {
      const i = claim[j];
      if (pool.crustType[i] !== CONTINENTAL) continue;
      const p = wPlate[j];
      let sum = 0;
      for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
        const nb = grid.nb[t];
        if (wPlate[nb] !== p) continue;
        const b = claim[nb];
        if (b === i || pool.crustType[b] !== CONTINENTAL) continue;
        sum += pool.thickness[b] - pool.thickness[i];
      }
      delta[j] = this.crustDiffusion * sum;
    }
    for (let j = 0; j < grid.n; j++) {
      if (delta[j] !== 0) pool.thickness[claim[j]] += delta[j];
    }
    this.crustalFlow();
    this.enforceCap();
  }

  /**
   * Hard cap on every parcel, visible or not. A worklist follows the excess
   * outward until no parcel stands more than half a kilometer over the cap:
   * a large plateau fed by a long collision needs many more rings than a
   * fixed number of sweeps would allow.
   */
  private enforceCap(): void {
    const pool = this.pool;
    const grid = this.grid;
    const limit = this.cap + 0.5;
    const work: number[] = [];
    for (let i = 0; i < pool.count; i++) {
      if (pool.alive[i] && pool.crustType[i] === CONTINENTAL && pool.thickness[i] > limit) work.push(i);
    }
    let budget = 50 * pool.count;
    while (work.length > 0 && budget-- > 0) {
      const i = work.pop() as number;
      if (!pool.alive[i] || pool.thickness[i] <= limit) continue;
      this.spreadExcess(i);
      const index = pool.frameIndex[pool.plate[i]];
      const k = pool.frameCell[i];
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const id = index[grid.nb[t]];
        if (id >= 0 && pool.alive[id] && pool.crustType[id] === CONTINENTAL && pool.thickness[id] > limit) work.push(id);
      }
    }
  }

  /**
   * Remove `de` meters of surface from the parcel under world cell j: volcanic
   * rock first, then sediment, then continental crust. Eroding continental
   * crust lowers the surface by only 150 m per km removed (isostatic rebound),
   * so a 1 km drop in elevation strips about 7 km of crust. Returns the
   * volume removed as km of thickness, to be deposited elsewhere.
   */
  private denude(j: number, de: number): number {
    const pool = this.pool;
    const i = this.wParcel[j];
    let dk: number;
    if (pool.volcanic[i] > 0) {
      const factor = volcanicFactor(pool.crustType[i]);
      dk = Math.min(de / factor, pool.volcanic[i]);
      pool.volcanic[i] -= dk;
      pool.eroded[i] += dk * factor;
    } else if (pool.sediment[i] > 0) {
      dk = Math.min(de / SEDIMENT_M_PER_KM, pool.sediment[i]);
      pool.sediment[i] -= dk;
      pool.eroded[i] += dk * SEDIMENT_M_PER_KM;
    } else if (pool.crustType[i] === CONTINENTAL) {
      dk = de / ISOSTASY_M_PER_KM;
      pool.thickness[i] -= dk;
      this.erodedContinental += dk * this.areaKm2[j];
      pool.eroded[i] += de;
    } else {
      return 0;
    }
    return dk;
  }

  /**
   * Stream-power erosion along the drainage network (DESIGN 3.4), every
   * FLUVIAL_INTERVAL steps: each land cell loses K * sqrt(discharge) * slope
   * meters per step, where the slope is measured to the water surface of the
   * downstream cell (sea level or lake level at a mouth, so base level is the
   * water, not the sea floor). Lake beds do not erode. The products travel
   * down the network and settle at the river mouth: deltas on the shelf,
   * fills in lakes and closed basins.
   */
  /**
   * Precipitation and open-water evaporation (mm per year) from the climate
   * stage, used by the fluvial passes instead of the proxy until replaced;
   * null restores the proxy (DESIGN 9.1: real precipitation inside the loop).
   */
  setPrecipitation(precipitation: Float64Array | null, evaporation: Float64Array | null, temperature: Float64Array | null = null): void {
    this.externalPrecipitation = precipitation;
    this.externalEvaporation = evaporation;
    this.externalTemperature = temperature;
  }

  private externalPrecipitation: Float64Array | null = null;
  private externalEvaporation: Float64Array | null = null;
  /** Annual-mean surface temperature from the in-loop climate, for the resource bookkeeping (M21). */
  private externalTemperature: Float64Array | null = null;

  private erodeFluvial(): void {
    const grid = this.grid;
    const hydro = this.hydrology;
    this.computeElevation();
    if (this.externalPrecipitation) {
      hydro.precipitation.set(this.externalPrecipitation);
      hydro.evaporation = this.externalEvaporation;
    } else {
      hydro.applyProxyPrecipitation(this.elevation, this.seaLevel);
    }
    hydro.run(this.elevation, this.seaLevel);
    this.recordEvaporites();
    this.mixLineages();
    const elevation = this.elevation;
    const sea = this.seaLevel;
    const down = hydro.downstream;
    const lake = hydro.lake;
    const level = hydro.waterLevel;
    const discharge = hydro.discharge;
    const mouth = hydro.mouth;
    for (let j = 0; j < grid.n; j++) {
      if (elevation[j] < sea || lake[j] >= 0) continue;
      const d = down[j];
      if (d < 0) continue;
      const base = level[d] > sea ? level[d] : sea;
      const drop = elevation[j] - base;
      if (drop <= 0) continue;
      const slope = drop / hydro.hopDistanceM(j, d);
      const de = Math.min(FLUVIAL_K * Math.sqrt(discharge[j]) * slope * FLUVIAL_INTERVAL, FLUVIAL_MAX_DROP_FRACTION * drop);
      const dk = this.denude(j, de);
      if (dk > 0) this.deposit(mouth[j], dk);
    }
  }

  /**
   * Settle eroded material where a river ends. A delta fills its water body
   * up to the water surface and no higher (M17: before, a full cell spilled
   * onto all its neighbors and closed basins grew rings of sediment hills);
   * what does not fit moves to the lowest flooded neighbor, and the rest is
   * lost to the deep.
   */
  private deposit(j: number, dk: number): void {
    const pool = this.pool;
    const claim = this.wParcel;
    const grid = this.grid;
    const hydro = this.hydrology;
    const elevation = this.elevation;
    const surface = (cell: number): number => (hydro.lake[cell] >= 0 ? hydro.waterLevel[cell] : this.seaLevel);
    const fill = (cell: number, amount: number): number => {
      const i = claim[cell];
      const room = Math.min(SEDIMENT_CAP_KM - pool.sediment[i], (surface(cell) - elevation[cell]) / SEDIMENT_M_PER_KM);
      if (room <= 0) return 0;
      const put = room < amount ? room : amount;
      pool.sediment[i] += put;
      this.recordDeposit(cell, i, put);
      elevation[cell] += put * SEDIMENT_M_PER_KM;
      return put;
    };
    let rest = dk - fill(j, dk);
    if (rest <= 1e-9) return;
    let lowest = -1;
    let low = Infinity;
    for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
      const nb = grid.nb[t];
      if (elevation[nb] < low && elevation[nb] < surface(nb)) {
        low = elevation[nb];
        lowest = nb;
      }
    }
    if (lowest >= 0) rest -= fill(lowest, rest);
  }

  /**
   * Resource bookkeeping of a delta fill (M21, constants in crust.ts):
   * sediment laid down in a lake or on a flood plain under a warm, wet
   * climate is a swamp and counts toward coal; sediment laid down in a
   * shallow warm sea over continental crust counts toward oil source rock,
   * and half toward coal when the climate is a swamp's. Both ride with the
   * parcel. The in-loop climate supplies temperature and precipitation;
   * before its first update nothing is recorded.
   */
  private recordDeposit(cell: number, parcel: number, km: number): void {
    const t = this.externalTemperature;
    const p = this.externalPrecipitation;
    if (!t || !p) return;
    const pool = this.pool;
    const swamp = t[cell] > COAL_MIN_C && p[cell] > COAL_MIN_MM;
    if (this.elevation[cell] >= this.seaLevel) {
      if (swamp) pool.coal[parcel] += km;
    } else if (pool.crustType[parcel] === CONTINENTAL && this.seaLevel - this.elevation[cell] < SHELF_DEPTH_M) {
      if (t[cell] > OIL_MIN_C) pool.oil[parcel] += km;
      if (swamp) pool.coal[parcel] += km * DELTA_COAL_SHARE;
    }
  }

  /**
   * Eight ancestral faunas (M23): every continental parcel gets the lineage
   * of its angular sector around the supercontinent's centroid, so the
   * later splits carry distinct faunas apart. Runs in the constructor, where
   * parcel i sits on cell i.
   */
  private seedLineages(isContinental: ArrayLike<number | boolean>): void {
    const grid = this.grid;
    const xyz = grid.xyz;
    const pool = this.pool;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < grid.n; i++) {
      if (!isContinental[i]) continue;
      cx += xyz[3 * i];
      cy += xyz[3 * i + 1];
      cz += xyz[3 * i + 2];
    }
    const norm = Math.hypot(cx, cy, cz) || 1;
    cx /= norm;
    cy /= norm;
    cz /= norm;
    // A tangent frame at the centroid: e1 = a x c for a helper axis a not parallel to c, e2 = c x e1.
    const ax = Math.abs(cx) < 0.9 ? 1 : 0;
    const ay = 1 - ax;
    let e1x = ay * cz;
    let e1y = -ax * cz;
    let e1z = ax * cy - ay * cx;
    const e1n = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= e1n;
    e1y /= e1n;
    e1z /= e1n;
    const e2x = cy * e1z - cz * e1y;
    const e2y = cz * e1x - cx * e1z;
    const e2z = cx * e1y - cy * e1x;
    for (let i = 0; i < grid.n; i++) {
      if (!isContinental[i]) continue;
      const px = xyz[3 * i];
      const py = xyz[3 * i + 1];
      const pz = xyz[3 * i + 2];
      const angle = Math.atan2(px * e2x + py * e2y + pz * e2z, px * e1x + py * e1y + pz * e1z);
      const sector = Math.min(LINEAGE_COUNT - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * LINEAGE_COUNT));
      pool.lineage[i * LINEAGE_COUNT + sector] = 1;
    }
  }

  /** A merged parcel's lineages: the thickness-weighted mean of both, or the other's when one has none. */
  private mergeLineages(keep: number, gone: number): void {
    const pool = this.pool;
    const L = LINEAGE_COUNT;
    let sumKeep = 0;
    let sumGone = 0;
    for (let k = 0; k < L; k++) {
      sumKeep += pool.lineage[keep * L + k];
      sumGone += pool.lineage[gone * L + k];
    }
    if (sumGone <= 0) return;
    if (sumKeep <= 0) {
      for (let k = 0; k < L; k++) pool.lineage[keep * L + k] = pool.lineage[gone * L + k] / sumGone;
      return;
    }
    const wk = pool.thickness[keep];
    const wg = pool.thickness[gone];
    for (let k = 0; k < L; k++) {
      pool.lineage[keep * L + k] = (wk * (pool.lineage[keep * L + k] / sumKeep) + wg * (pool.lineage[gone * L + k] / sumGone)) / (wk + wg);
    }
  }

  private lineageStamp = new Int32Array(0);
  private lineageQueue = new Int32Array(0);
  private lineageNext = new Float32Array(0);

  /**
   * Fauna dispersal (M23, constants in crust.ts): within each connected
   * landmass above the sea, every land parcel's lineage vector moves toward
   * its land neighbors' mean (diffusion) and a little toward the landmass
   * mean, slower across deserts and high ground; nothing crosses the sea,
   * and crust that just became land takes its landmass's fauna. Pure
   * bookkeeping: nothing here touches the relief.
   */
  private mixLineages(): void {
    const grid = this.grid;
    const n = grid.n;
    const pool = this.pool;
    const claim = this.wParcel;
    const sea = this.seaLevel;
    const elevation = this.elevation;
    const L = LINEAGE_COUNT;
    if (this.lineageStamp.length < n) {
      this.lineageStamp = new Int32Array(n);
      this.lineageQueue = new Int32Array(n);
    }
    if (this.lineageNext.length < L * n) this.lineageNext = new Float32Array(L * n);
    const stamp = this.lineageStamp;
    const queue = this.lineageQueue;
    const next = this.lineageNext;
    const precip = this.externalPrecipitation ?? this.hydrology.precipitation;
    const mean = new Float64Array(L);
    const nbMean = new Float64Array(L);
    stamp.fill(-1);
    let id = 0;
    for (let s = 0; s < n; s++) {
      if (stamp[s] >= 0 || elevation[s] < sea) continue;
      // Flood fill the landmass; its cells are queue[0 .. tail).
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      stamp[s] = id;
      mean.fill(0);
      let weight = 0;
      while (head < tail) {
        const i = queue[head++];
        const base = claim[i] * L;
        let sum = 0;
        for (let k = 0; k < L; k++) sum += pool.lineage[base + k];
        if (sum > 0) {
          const a = this.areaKm2[i];
          for (let k = 0; k < L; k++) mean[k] += (a * pool.lineage[base + k]) / sum;
          weight += a;
        }
        for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
          const j = grid.nb[t];
          if (stamp[j] < 0 && elevation[j] >= sea) {
            stamp[j] = id;
            queue[tail++] = j;
          }
        }
      }
      if (weight > 0) {
        for (let k = 0; k < L; k++) mean[k] /= weight;
        // New vectors from the old ones, so the order of cells does not matter.
        for (let q = 0; q < tail; q++) {
          const i = queue[q];
          const base = claim[i] * L;
          let sum = 0;
          for (let k = 0; k < L; k++) sum += pool.lineage[base + k];
          if (sum <= 0) {
            for (let k = 0; k < L; k++) next[i * L + k] = mean[k];
            continue;
          }
          nbMean.fill(0);
          let count = 0;
          for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
            const j = grid.nb[t];
            if (elevation[j] < sea) continue;
            const jb = claim[j] * L;
            let js = 0;
            for (let k = 0; k < L; k++) js += pool.lineage[jb + k];
            if (js <= 0) continue;
            for (let k = 0; k < L; k++) nbMean[k] += pool.lineage[jb + k] / js;
            count++;
          }
          let barrier = 1;
          if (precip[i] < LINEAGE_DESERT_MM) barrier *= LINEAGE_BARRIER;
          if (elevation[i] - sea > LINEAGE_MOUNTAIN_M) barrier *= LINEAGE_BARRIER;
          const d = count > 0 ? LINEAGE_DIFFUSION * barrier : 0;
          const m = LINEAGE_LANDMASS_MIXING * barrier;
          for (let k = 0; k < L; k++) {
            const v = pool.lineage[base + k] / sum;
            const local = count > 0 ? nbMean[k] / count : v;
            next[i * L + k] = v + d * (local - v) + m * (mean[k] - v);
          }
        }
        for (let q = 0; q < tail; q++) {
          const i = queue[q];
          const base = claim[i] * L;
          for (let k = 0; k < L; k++) pool.lineage[base + k] = next[i * L + k];
        }
      }
      id++;
    }
  }

  /** Closed-basin lakes whose evaporation outruns their inflow lay down evaporites (M21): salt on the parcels of their cells, per fluvial pass. */
  private recordEvaporites(): void {
    const hydro = this.hydrology;
    const lakes = hydro.lakes;
    const lake = hydro.lake;
    const pool = this.pool;
    const claim = this.wParcel;
    for (let j = 0; j < this.grid.n; j++) {
      const id = lake[j];
      if (id < 0) continue;
      const info = lakes[id];
      if (!info.endorheic || info.evaporationFullKm3 <= 0) continue;
      const deficit = 1 - Math.min(1, info.inflowKm3 / info.evaporationFullKm3);
      pool.salt[claim[j]] += EVAPORITE_KM_PER_STEP * FLUVIAL_INTERVAL * deficit;
    }
  }

  /**
   * Gravitational spreading of thick crust in the plate frame: above
   * FLOW_THRESHOLD_KM, a fraction of the thickness difference flows to each
   * thinner continental neighbor every step. This is what turns a suture into a
   * broad plateau instead of a spike, and it bounds thickness without any
   * bouncing of excess between saturated cells.
   */
  private crustalFlow(): void {
    const pool = this.pool;
    const grid = this.grid;
    if (this.flowDelta.length < pool.capacity) this.flowDelta = new Float64Array(pool.capacity);
    const fd = this.flowDelta;
    fd.fill(0, 0, pool.count);
    for (let i = 0; i < pool.count; i++) {
      if (!pool.alive[i] || pool.crustType[i] !== CONTINENTAL) continue;
      const ti = pool.thickness[i];
      if (ti <= FLOW_THRESHOLD_KM) continue;
      const index = pool.frameIndex[pool.plate[i]];
      const k = pool.frameCell[i];
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const b = index[grid.nb[t]];
        if (b < 0 || !pool.alive[b] || pool.crustType[b] !== CONTINENTAL) continue;
        const diff = ti - pool.thickness[b];
        if (diff <= 0) continue;
        const f = this.flowRate * diff;
        fd[i] -= f;
        fd[b] += f;
      }
    }
    for (let i = 0; i < pool.count; i++) {
      if (fd[i] === 0) continue;
      pool.thickness[i] += fd[i];
      // Crust thickened by flow from a collision belt is part of the orogen (provenance for the inspector).
      if (fd[i] > FLOW_STAMP_KM) pool.orogenyStep[i] = this.step;
    }
  }

  private applyHotspots(): void {
    const pool = this.pool;
    const grid = this.grid;
    const claim = this.wParcel;
    const stamp = ++this.stampCounter;
    const st = this.stamp;
    const q = this.arcQueue;
    const dist = this.arcDist;
    for (let h = 0; h < this.hotspots.length; h++) {
      // The plume feeds the world cells within hotspotRadius of the hotspot (one reference cell's area).
      let head = 0;
      let tail = 0;
      q[tail] = this.hotspots[h];
      dist[tail++] = 0;
      st[this.hotspots[h]] = stamp;
      while (head < tail) {
        const j = q[head];
        const d = dist[head++];
        const i = claim[j];
        if (i >= 0 && pool.alive[i] && pool.volcanic[i] < VOLCANIC_CAP_KM) pool.volcanic[i] += this.hotspotRate * this.heat;
        if (d >= this.hotspotRadius) continue;
        for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1]; t++) {
          const nb = grid.nb[t];
          if (st[nb] === stamp || tail >= q.length) continue;
          st[nb] = stamp;
          q[tail] = nb;
          dist[tail++] = d + 1;
        }
      }
    }
  }

  private ageCrust(): void {
    const pool = this.pool;
    for (let i = 0; i < pool.count; i++) if (pool.alive[i]) pool.age[i] += 1;
  }
}
