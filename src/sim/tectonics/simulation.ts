import { cellAreasKm2, type Grid } from '../grid/grid.ts';
import { nearestCell } from '../grid/locate.ts';
import { Hydrology } from '../hydrology/routing.ts';
import { solveSeaLevel } from '../hypsometry.ts';
import { relativeGravity, waterVolumeKm3, type PlanetParams } from '../params.ts';
import { Noise3D } from '../rng/noise.ts';
import type { Rng } from '../rng/xoshiro.ts';
import {
  ARC_RADIUS,
  ARC_RATE_KM,
  BUOYANT_THICKNESS_KM,
  COLLISION_BRAKE,
  CONTINENTAL,
  CONTINENTAL_FRACTION,
  CONTINENTAL_THICKNESS_KM,
  CRUST_DIFFUSION,
  EROSION_RATE,
  FLOW_RATE,
  FLOW_THRESHOLD_KM,
  FLUVIAL_INTERVAL,
  FLUVIAL_K,
  FLUVIAL_MAX_DROP_FRACTION,
  HOTSPOT_COUNT,
  HOTSPOT_RATE_KM,
  INTERIOR_BIAS,
  ISOSTASY_M_PER_KM,
  MARGIN_THICKNESS_KM,
  MIN_THRUST_KM,
  OCEANIC_PLATE_SHARE,
  POLE_WALK_INTERVAL,
  RIFT_MIN_THICKNESS_KM,
  SEDIMENT_CAP_KM,
  SEDIMENT_M_PER_KM,
  TRENCH_M,
  VOLCANIC_CAP_KM,
  crustElevation,
  thicknessCap,
  volcanicFactor,
} from './crust.ts';
import { ParcelPool } from './parcels.ts';
import { initPlates, perturbPlates, rotatePlates, seedPlates, velocityAt, type Plate } from './plates.ts';
import { apply, applyTranspose } from './rotation.ts';

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
  readonly cap: number;
  readonly cellAngle: number;
  step = 0;
  /** Cumulative continental thickness removed by erosion, in km times km^2. */
  erodedContinental = 0;

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
  private delta: Float64Array;
  private flowDelta = new Float64Array(0);
  private tried = new Int32Array(8);
  private triedCount = new Int32Array(8);
  private triedParcel = new Int32Array(8);

  constructor(grid: Grid, params: PlanetParams, rng: Rng) {
    this.grid = grid;
    const n = grid.n;
    this.cellAngle = Math.sqrt((4 * Math.PI) / n);
    this.areaKm2 = cellAreasKm2(grid, params.radiusKm);
    this.hydrology = new Hydrology(grid, this.areaKm2, params.radiusKm);
    this.waterKm3 = waterVolumeKm3(params);
    this.cap = thicknessCap(relativeGravity(params));
    this.poleRng = rng.fork('pole-walk');

    const count = params.plateCount;
    this.plates = initPlates(count, rng.fork('poles'), this.cellAngle);
    const plateOf = seedPlates(grid, count, rng.fork('plates'));
    this.pool = new ParcelPool(n, count);
    this.posDot = new Float64Array(this.pool.capacity);

    // Initial crust: continental where a plate-biased noise field exceeds the quantile
    // that yields CONTINENTAL_FRACTION of the cells; oceanic elsewhere with a smooth age field.
    const crustNoise = new Noise3D(rng.fork('crust'));
    const detailNoise = new Noise3D(rng.fork('crust-detail'));
    const ageNoise = new Noise3D(rng.fork('ocean-age'));
    const offsetRng = rng.fork('plate-offset');
    const offsets = new Float64Array(count);
    for (let p = 0; p < count; p++) {
      offsets[p] = offsetRng.float() < OCEANIC_PLATE_SHARE ? -10 : offsetRng.normal() * 0.12;
    }
    // Hop distance to the nearest cell of another plate: continents are seeded toward plate
    // interiors so most margins start passive (oceanic), as on Earth.
    const interior = new Int32Array(n).fill(-1);
    let frontier: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        if (plateOf[grid.nb[t]] !== plateOf[i]) {
          interior[i] = 0;
          frontier.push(i);
          break;
        }
      }
    }
    for (let d = 1; frontier.length > 0; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
          const nb = grid.nb[t];
          if (interior[nb] < 0) {
            interior[nb] = d;
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    const score = new Float64Array(n);
    const xyz = grid.xyz;
    for (let i = 0; i < n; i++) {
      score[i] =
        crustNoise.fbm(xyz[3 * i] * 1.3, xyz[3 * i + 1] * 1.3, xyz[3 * i + 2] * 1.3, 5) +
        offsets[plateOf[i]] +
        INTERIOR_BIAS * Math.min(1, Math.max(0, interior[i]) / 8);
    }
    const sorted = Float64Array.from(score).sort();
    const threshold = sorted[Math.min(n - 1, Math.floor((1 - CONTINENTAL_FRACTION) * n))];
    const isContinental = new Uint8Array(n);
    for (let i = 0; i < n; i++) isContinental[i] = score[i] > threshold ? 1 : 0;
    // Passive margins: continental cells one and two hops from the ocean start stretched (shelves).
    const toOcean = new Int32Array(n).fill(99);
    frontier = [];
    for (let i = 0; i < n; i++) {
      if (isContinental[i]) continue;
      toOcean[i] = 0;
      frontier.push(i);
    }
    for (let d = 1; d <= MARGIN_THICKNESS_KM.length && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
          const nb = grid.nb[t];
          if (toOcean[nb] > d) {
            toOcean[nb] = d;
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    for (let i = 0; i < n; i++) {
      const id = this.pool.alloc(plateOf[i], i, i);
      const x = xyz[3 * i];
      const y = xyz[3 * i + 1];
      const z = xyz[3 * i + 2];
      if (isContinental[i]) {
        const d = toOcean[i];
        const base = d >= 1 && d <= MARGIN_THICKNESS_KM.length ? MARGIN_THICKNESS_KM[d - 1] : CONTINENTAL_THICKNESS_KM;
        this.pool.setContinental(id, base + 4 * detailNoise.fbm(x * 4, y * 4, z * 4, 4));
      } else {
        this.pool.age[id] = Math.max(0, 60 + 60 * ageNoise.fbm(x * 2, y * 2, z * 2, 4));
      }
    }

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

  run(steps: number, onProgress: (fraction: number) => void = () => {}): void {
    for (let s = 0; s < steps; s++) {
      this.stepOnce();
      if (s % 10 === 9 || s === steps - 1) onProgress((s + 1) / steps);
    }
    // The elevation of the last step was computed before its erosion; refresh so the
    // output matches the parcels.
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
    if (this.step % POLE_WALK_INTERVAL === 0) perturbPlates(this.plates, this.poleRng, this.cellAngle);
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
    if (!ca && pool.age[a] !== pool.age[b]) return pool.age[a] < pool.age[b] ? a : b;
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
      // Crustal shortening: the consumed column thickens the suture cell and its
      // continental neighbors on the overriding plate (a fold-and-thrust belt).
      const grid = this.grid;
      const index = pool.frameIndex[pool.plate[winner]];
      const k = pool.frameCell[winner];
      let count = 0;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const id = index[grid.nb[t]];
        if (id >= 0 && pool.alive[id] && pool.crustType[id] === CONTINENTAL) count++;
      }
      const mass = pool.thickness[loser];
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
      this.spreadExcess(winner);
      // Continental collision resists: both plates slow down (India after hitting Eurasia).
      this.plates[pool.plate[winner]].rate *= COLLISION_BRAKE;
      this.plates[pool.plate[loser]].rate *= COLLISION_BRAKE;
    } else {
      this.addArc(winner);
      pool.sediment[winner] = Math.min(SEDIMENT_CAP_KM, pool.sediment[winner] + 0.5 * pool.sediment[loser]);
    }
    pool.release(loser);
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
      } else if (fillEmpty) {
        const fresh = pool.alloc(p, cell, pool.lastWorld[w]);
        pool.setContinental(fresh, share);
      }
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
      if (id >= 0 && pool.alive[id] && pool.volcanic[id] < VOLCANIC_CAP_KM) pool.volcanic[id] += ARC_RATE_KM;
      if (d >= ARC_RADIUS) continue;
      for (let t = grid.nbStart[k]; t < grid.nbStart[k + 1]; t++) {
        const nb = grid.nb[t];
        if (st[nb] === stamp || tail >= q.length) continue;
        st[nb] = stamp;
        q[tail] = nb;
        dist[tail++] = d + 1;
      }
    }
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
      if (boundary[j] === BOUNDARY_SUBDUCTING) e -= TRENCH_M;
      elevation[j] = e;
    }
    this.seaLevel = solveSeaLevel(elevation, this.areaKm2, this.waterKm3);
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
      delta[j] = CRUST_DIFFUSION * sum;
    }
    for (let j = 0; j < grid.n; j++) {
      if (delta[j] !== 0) pool.thickness[claim[j]] += delta[j];
    }
    this.crustalFlow();
    // Hard cap on every parcel, visible or not, repeated until the excess has flowed outward.
    for (let pass = 0; pass < 10; pass++) {
      let worst = 0;
      for (let i = 0; i < pool.count; i++) {
        if (!pool.alive[i] || pool.crustType[i] !== CONTINENTAL) continue;
        const over = pool.thickness[i] - this.cap;
        if (over > 0) {
          if (over > worst) worst = over;
          this.spreadExcess(i);
        }
      }
      if (worst < 1) break;
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
  private erodeFluvial(): void {
    const grid = this.grid;
    const hydro = this.hydrology;
    this.computeElevation();
    hydro.applyProxyPrecipitation(this.elevation, this.seaLevel);
    hydro.run(this.elevation, this.seaLevel);
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

  /** Settle eroded material on a cell, spilling to its neighbors once the basin is full; the rest is lost to the deep ocean. */
  private deposit(j: number, dk: number): void {
    const pool = this.pool;
    const claim = this.wParcel;
    let rest = dk;
    const i = claim[j];
    const room = SEDIMENT_CAP_KM - pool.sediment[i];
    if (room > 0) {
      const put = room < rest ? room : rest;
      pool.sediment[i] += put;
      rest -= put;
    }
    if (rest <= 0) return;
    const grid = this.grid;
    for (let t = grid.nbStart[j]; t < grid.nbStart[j + 1] && rest > 0; t++) {
      const b = claim[grid.nb[t]];
      const r = SEDIMENT_CAP_KM - pool.sediment[b];
      if (r <= 0) continue;
      const put = r < rest ? r : rest;
      pool.sediment[b] += put;
      rest -= put;
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
        const f = FLOW_RATE * diff;
        fd[i] -= f;
        fd[b] += f;
      }
    }
    for (let i = 0; i < pool.count; i++) {
      if (fd[i] !== 0) pool.thickness[i] += fd[i];
    }
  }

  private applyHotspots(): void {
    const pool = this.pool;
    for (let h = 0; h < this.hotspots.length; h++) {
      const i = this.wParcel[this.hotspots[h]];
      if (pool.volcanic[i] < VOLCANIC_CAP_KM) pool.volcanic[i] += HOTSPOT_RATE_KM;
    }
  }

  private ageCrust(): void {
    const pool = this.pool;
    for (let i = 0; i < pool.count; i++) if (pool.alive[i]) pool.age[i] += 1;
  }
}
