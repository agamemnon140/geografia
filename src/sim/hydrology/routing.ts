import { angleBetween } from '../grid/geometry.ts';
import type { Grid } from '../grid/grid.ts';
import { MinHeap } from './heap.ts';
import { RUNOFF_COEFFICIENT, oceanDistance, potentialEvaporation, proxyPrecipitation } from './precipitation.ts';

export interface LakeInfo {
  id: number;
  /** Cells under water. */
  cells: number;
  areaKm2: number;
  /** Water surface in model-frame meters (subtract sea level for altitude). */
  level: number;
  maxDepthM: number;
  /** Cell that receives the overflow; -1 when the lake is endorheic. */
  outlet: number;
  /** True when evaporation balances the inflow below the spill point, so nothing leaves. */
  endorheic: boolean;
  /** Water entering from rivers and rain, km^3 per year. */
  inflowKm3: number;
  /** Potential evaporation if the lake filled its whole depression, km^3 per year. */
  evaporationFullKm3: number;
}

/**
 * Surface hydrology on the geodesic grid (DESIGN 3.4). Reusable: the
 * tectonic loop calls `run` every few steps for fluvial erosion, and the
 * pipeline calls it once more on the final relief.
 *
 * Routing is priority-flood from the ocean (Barnes, Lehman and Mulla 2014):
 * cells are visited in order of their flooded elevation, each land cell drains
 * to the cell that reached it first, which is its lowest neighbor on the
 * flooded surface. Depressions come out filled to their spill point, so every
 * land cell has a path to the ocean. A filled depression is a lake; when the
 * potential evaporation over the depression exceeds its inflow, the lake is
 * endorheic: its level drops until evaporation balances inflow, the dry bed
 * drains into the remaining water body and nothing leaves the basin.
 */
export class Hydrology {
  readonly grid: Grid;
  readonly areaKm2: Float64Array;
  readonly radiusKm: number;

  /** Precipitation in mm per year (the proxy, or the climate field once M5 supplies it). */
  readonly precipitation: Float64Array;
  /** Flooded surface: lake level on lake cells, the elevation elsewhere. */
  readonly waterLevel: Float64Array;
  /** Cell the water of this cell flows to; -1 on the ocean and on terminal pits. */
  readonly downstream: Int32Array;
  /** Local runoff, km^3 per year. */
  readonly runoff: Float64Array;
  /** Water passing through the cell, its own runoff included, km^3 per year. */
  readonly discharge: Float64Array;
  /** Lake id of cells under lake water, else -1. */
  readonly lake: Int32Array;
  /** Depression id of every cell of a filled depression, dry bed included, else -1. */
  readonly depression: Int32Array;
  /** First ocean or lake cell downstream (the cell itself for ocean and lake cells). */
  readonly mouth: Int32Array;
  /** Longest flow path ending in this cell, km. */
  readonly riverLength: Float64Array;
  /** Hop distance to the ocean. */
  readonly oceanDistance: Int32Array;
  /** Potential evaporation from open water, mm per year; null means the latitude proxy. The climate stage sets it. */
  evaporation: Float64Array | null = null;
  lakes: LakeInfo[] = [];

  /** Cells in upstream-first order (every cell before its downstream). */
  private order: Int32Array;
  private orderCount = 0;
  private heap: MinHeap;
  private visited: Uint8Array;
  private inDegree: Int32Array;
  private queue: Int32Array;
  private sortBuffer: number[] = [];
  private lakeEvaporation: Float64Array;
  /** Cells of every depression, CSR by depression id. */
  private depCells: Int32Array;
  private depStart: number[] = [0];

  constructor(grid: Grid, areaKm2: Float64Array, radiusKm: number) {
    this.grid = grid;
    this.areaKm2 = areaKm2;
    this.radiusKm = radiusKm;
    const n = grid.n;
    this.precipitation = new Float64Array(n);
    this.waterLevel = new Float64Array(n);
    this.downstream = new Int32Array(n);
    this.runoff = new Float64Array(n);
    this.discharge = new Float64Array(n);
    this.lake = new Int32Array(n);
    this.depression = new Int32Array(n);
    this.mouth = new Int32Array(n);
    this.riverLength = new Float64Array(n);
    this.oceanDistance = new Int32Array(n);
    this.order = new Int32Array(n);
    this.heap = new MinHeap(n);
    this.visited = new Uint8Array(n);
    this.inDegree = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.lakeEvaporation = new Float64Array(n);
    this.depCells = new Int32Array(n);
  }

  /** Fill `precipitation` with the in-loop proxy for the given relief. */
  applyProxyPrecipitation(elevation: Float64Array, seaLevel: number): void {
    oceanDistance(this.grid, elevation, seaLevel, this.oceanDistance, this.queue);
    proxyPrecipitation(this.grid, this.oceanDistance, this.precipitation);
    this.evaporation = null;
  }

  /** Potential evaporation of a cell, mm per year: the climate's field when set, else the latitude proxy. */
  private evaporationAt(i: number): number {
    return this.evaporation ? this.evaporation[i] : potentialEvaporation(this.grid.lat[i]);
  }

  /** Route the water of `precipitation` over the relief: fills every output array. */
  run(elevation: Float64Array, seaLevel: number): void {
    this.flood(elevation, seaLevel);
    this.computeRunoff(elevation, seaLevel);
    this.findDepressions(elevation);
    this.balanceLakes(elevation);
    this.computeMouths(elevation, seaLevel);
    this.computeRiverLengths(elevation, seaLevel);
  }

  /** Priority-flood from the ocean: flooded surface and drainage tree. */
  private flood(elevation: Float64Array, seaLevel: number): void {
    const grid = this.grid;
    const n = grid.n;
    const heap = this.heap;
    const visited = this.visited;
    const level = this.waterLevel;
    const down = this.downstream;
    heap.clear();
    visited.fill(0);
    let seeded = 0;
    for (let i = 0; i < n; i++) {
      down[i] = -1;
      if (elevation[i] >= seaLevel) continue;
      level[i] = elevation[i];
      visited[i] = 1;
      seeded++;
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        if (elevation[grid.nb[t]] >= seaLevel) {
          heap.push(elevation[i], i);
          break;
        }
      }
    }
    if (seeded === 0) {
      // No ocean: the lowest cell is the terminal sink of the whole planet.
      let lowest = 0;
      for (let i = 1; i < n; i++) if (elevation[i] < elevation[lowest]) lowest = i;
      level[lowest] = elevation[lowest];
      visited[lowest] = 1;
      heap.push(elevation[lowest], lowest);
    }
    while (heap.length > 0) {
      const cur = heap.pop();
      const base = level[cur];
      for (let t = grid.nbStart[cur]; t < grid.nbStart[cur + 1]; t++) {
        const nb = grid.nb[t];
        if (visited[nb]) continue;
        visited[nb] = 1;
        const e = elevation[nb];
        level[nb] = e > base ? e : base;
        down[nb] = cur;
        heap.push(level[nb], nb);
      }
    }
  }

  private computeRunoff(elevation: Float64Array, seaLevel: number): void {
    const n = this.grid.n;
    const p = this.precipitation;
    const area = this.areaKm2;
    const runoff = this.runoff;
    for (let i = 0; i < n; i++) {
      runoff[i] = elevation[i] >= seaLevel ? p[i] * 1e-6 * RUNOFF_COEFFICIENT * area[i] : 0;
    }
  }

  /** Upstream-first order of all cells (Kahn's algorithm on the drainage tree), then discharge. */
  private accumulate(): void {
    const n = this.grid.n;
    const down = this.downstream;
    const inDegree = this.inDegree;
    const order = this.order;
    inDegree.fill(0);
    for (let i = 0; i < n; i++) if (down[i] >= 0) inDegree[down[i]]++;
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) if (inDegree[i] === 0) order[tail++] = i;
    while (head < tail) {
      const i = order[head++];
      const d = down[i];
      if (d >= 0 && --inDegree[d] === 0) order[tail++] = d;
    }
    this.orderCount = tail;
    const discharge = this.discharge;
    discharge.set(this.runoff);
    for (let k = 0; k < tail; k++) {
      const i = order[k];
      const d = down[i];
      if (d >= 0) discharge[d] += discharge[i];
    }
  }

  /** Connected components of flooded cells at one level: the depressions, each a candidate lake. */
  private findDepressions(elevation: Float64Array): void {
    const grid = this.grid;
    const n = grid.n;
    const level = this.waterLevel;
    const dep = this.depression;
    const lake = this.lake;
    const queue = this.queue;
    const area = this.areaKm2;
    const evap = this.lakeEvaporation;
    const depCells = this.depCells;
    const depStart = this.depStart;
    dep.fill(-1);
    this.lakes = [];
    depStart.length = 1;
    let filled = 0;
    for (let s = 0; s < n; s++) {
      if (dep[s] >= 0 || level[s] <= elevation[s]) continue;
      const id = this.lakes.length;
      const surface = level[s];
      let cells = 0;
      let areaSum = 0;
      let maxDepth = 0;
      let evapSum = 0;
      let head = 0;
      let tail = 0;
      dep[s] = id;
      queue[tail++] = s;
      while (head < tail) {
        const i = queue[head++];
        depCells[filled++] = i;
        cells++;
        areaSum += area[i];
        const depth = surface - elevation[i];
        if (depth > maxDepth) maxDepth = depth;
        evapSum += this.evaporationAt(i) * 1e-6 * area[i];
        for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
          const nb = grid.nb[t];
          if (dep[nb] < 0 && level[nb] === surface && level[nb] > elevation[nb]) {
            dep[nb] = id;
            queue[tail++] = nb;
          }
        }
      }
      depStart.push(filled);
      evap[id] = evapSum;
      this.lakes.push({
        id,
        cells,
        areaKm2: areaSum,
        level: surface,
        maxDepthM: maxDepth,
        outlet: -1,
        endorheic: false,
        inflowKm3: 0,
        evaporationFullKm3: evapSum,
      });
    }
    for (let i = 0; i < n; i++) lake[i] = dep[i];
  }

  /**
   * Water balance of every depression. Lakes whose full-extent evaporation
   * exceeds their inflow become endorheic; their depression is re-routed by
   * steepest descent into its pits and their water body shrinks to the lowest
   * cells whose evaporation matches the inflow. Upstream lakes can starve
   * downstream ones, so the pass repeats until no lake changes state.
   */
  private balanceLakes(elevation: Float64Array): void {
    const dep = this.depression;
    const down = this.downstream;
    const discharge = this.discharge;
    const lakes = this.lakes;
    const evap = this.lakeEvaporation;
    const depCells = this.depCells;
    const depStart = this.depStart;
    const inflow = new Float64Array(lakes.length);
    for (let round = 0; round < 32; round++) {
      this.accumulate();
      inflow.fill(0);
      for (const l of lakes) {
        const id = l.id;
        for (let k = depStart[id]; k < depStart[id + 1]; k++) {
          const i = depCells[k];
          const d = down[i];
          if (d < 0 || dep[d] !== id) {
            inflow[id] += discharge[i];
            if (d >= 0 && !l.endorheic) l.outlet = d;
          }
        }
      }
      let changed = false;
      for (const l of lakes) {
        l.inflowKm3 = inflow[l.id];
        if (!l.endorheic && inflow[l.id] < evap[l.id]) {
          l.endorheic = true;
          l.outlet = -1;
          changed = true;
          this.rerouteDepression(l.id, elevation);
        }
      }
      if (!changed) break;
    }
    for (const l of lakes) if (l.endorheic) this.shrinkLake(l, elevation);
  }

  /** Steepest descent on the raw relief inside a depression; pits become terminal sinks. */
  private rerouteDepression(id: number, elevation: Float64Array): void {
    const grid = this.grid;
    const down = this.downstream;
    const depCells = this.depCells;
    const depStart = this.depStart;
    for (let k = depStart[id]; k < depStart[id + 1]; k++) {
      const i = depCells[k];
      let lowest = i;
      let le = elevation[i];
      for (let t = grid.nbStart[i]; t < grid.nbStart[i + 1]; t++) {
        const nb = grid.nb[t];
        if (elevation[nb] < le) {
          le = elevation[nb];
          lowest = nb;
        }
      }
      down[i] = lowest === i ? -1 : lowest;
    }
  }

  /** Water body of an endorheic lake: the lowest cells whose evaporation balances the inflow. */
  private shrinkLake(l: LakeInfo, elevation: Float64Array): void {
    const lake = this.lake;
    const level = this.waterLevel;
    const area = this.areaKm2;
    const down = this.downstream;
    const cells = this.sortBuffer;
    cells.length = 0;
    for (let k = this.depStart[l.id]; k < this.depStart[l.id + 1]; k++) cells.push(this.depCells[k]);
    cells.sort((a, b) => elevation[a] - elevation[b] || a - b);
    const spill = l.level;
    let cum = 0;
    let last = -1;
    let surface = spill;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const e = this.evaporationAt(i) * 1e-6 * area[i];
      if (cum + e >= l.inflowKm3) {
        const next = k + 1 < cells.length ? elevation[cells[k + 1]] : spill;
        const fraction = e > 0 ? (l.inflowKm3 - cum) / e : 1;
        surface = elevation[i] + fraction * (next - elevation[i]);
        last = k;
        break;
      }
      cum += e;
      last = k;
    }
    let count = 0;
    let areaSum = 0;
    let maxDepth = 0;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      // Terminal pits above the water line hold a pond of their own; they stay lake cells so
      // every river ends in water.
      const wet = k <= last || down[i] < 0;
      if (wet) {
        lake[i] = l.id;
        level[i] = k <= last ? Math.max(surface, elevation[i]) : elevation[i];
        count++;
        areaSum += area[i];
        const depth = level[i] - elevation[i];
        if (depth > maxDepth) maxDepth = depth;
      } else {
        lake[i] = -1;
        level[i] = elevation[i];
      }
    }
    l.cells = count;
    l.areaKm2 = areaSum;
    l.level = surface;
    l.maxDepthM = maxDepth;
  }

  /** First ocean or lake cell along each cell's path. */
  private computeMouths(elevation: Float64Array, seaLevel: number): void {
    const order = this.order;
    const down = this.downstream;
    const lake = this.lake;
    const mouth = this.mouth;
    for (let k = this.orderCount - 1; k >= 0; k--) {
      const i = order[k];
      if (elevation[i] < seaLevel || lake[i] >= 0) mouth[i] = i;
      else {
        const d = down[i];
        mouth[i] = d >= 0 ? mouth[d] : i;
      }
    }
  }

  /** Longest flow path reaching each cell, km, following the drainage tree over land. */
  private computeRiverLengths(elevation: Float64Array, seaLevel: number): void {
    const grid = this.grid;
    const xyz = grid.xyz;
    const order = this.order;
    const down = this.downstream;
    const len = this.riverLength;
    len.fill(0);
    for (let k = 0; k < this.orderCount; k++) {
      const i = order[k];
      const d = down[i];
      if (d < 0 || elevation[i] < seaLevel) continue;
      const hop = angleBetween(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2], xyz[3 * d], xyz[3 * d + 1], xyz[3 * d + 2]) * this.radiusKm;
      const candidate = len[i] + hop;
      if (candidate > len[d]) len[d] = candidate;
    }
  }

  /** Distance between the centers of two adjacent cells, meters. */
  hopDistanceM(a: number, b: number): number {
    const xyz = this.grid.xyz;
    return angleBetween(xyz[3 * a], xyz[3 * a + 1], xyz[3 * a + 2], xyz[3 * b], xyz[3 * b + 1], xyz[3 * b + 2]) * this.radiusKm * 1000;
  }

  /** Number of cells placed in topological order; equals n when the drainage tree has no cycle. */
  get orderedCount(): number {
    return this.orderCount;
  }
}
