import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';
import { axisAngle, apply, applyTranspose, multiply } from '../src/sim/tectonics/rotation.ts';
import {
  BOUNDARY_CONVERGENT,
  BOUNDARY_DIVERGENT,
  BOUNDARY_SUBDUCTING,
  TectonicsSim,
} from '../src/sim/tectonics/simulation.ts';
import { thicknessCap } from '../src/sim/tectonics/crust.ts';

const SEEDS = [1, 2, 3];
const worlds: World[] = SEEDS.map((seed) => build({ ...EARTH, seed }));

/** Hop distance from any cell satisfying `isSource`, capped at `maxDist`. */
function hopDistance(grid: Grid, isSource: (i: number) => boolean, maxDist: number): Int32Array {
  const dist = new Int32Array(grid.n).fill(maxDist + 1);
  let frontier: number[] = [];
  for (let i = 0; i < grid.n; i++) {
    if (isSource(i)) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; d <= maxDist && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const nb of grid.neighbors(i)) {
        if (dist[nb] > maxDist) {
          dist[nb] = d;
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

describe('rotation matrices', () => {
  it('rotate by the right angle and invert with the transpose', () => {
    const m = axisAngle(0, 0, 1, Math.PI / 2);
    const out = new Float64Array(3);
    apply(m, 1, 0, 0, out, 0);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(1, 12);
    applyTranspose(m, out[0], out[1], out[2], out, 0);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    const twice = multiply(m, m);
    apply(twice, 1, 0, 0, out, 0);
    expect(out[0]).toBeCloseTo(-1, 12);
  });
});

describe('tectonics with the Earth preset', () => {
  it('keeps every field finite and within physical ranges', () => {
    for (const w of worlds) {
      const cap = thicknessCap(1);
      for (let i = 0; i < w.n; i++) {
        expect(Number.isFinite(w.elevation[i])).toBe(true);
        expect(w.thickness[i]).toBeGreaterThan(0);
        expect(w.thickness[i]).toBeLessThanOrEqual(cap * 1.5);
        expect(w.boundary[i]).toBeLessThanOrEqual(4);
        expect(w.crustAge[i]).toBeGreaterThanOrEqual(0);
      }
      expect(w.stats.activePlates).toBeGreaterThanOrEqual(1);
      expect(w.stats.activePlates).toBeLessThanOrEqual(EARTH.plateCount);
    }
  });

  it('has an Earth-like ocean fraction', () => {
    for (const w of worlds) {
      expect(w.stats.oceanFraction).toBeGreaterThan(0.6);
      expect(w.stats.oceanFraction).toBeLessThan(0.75);
    }
  });

  it('has a bimodal hypsometry: abyssal plains, few slopes, low continents', () => {
    for (const w of worlds) {
      const h = w.stats.hypsometry;
      const bin = (m: number): number => Math.floor((m + 8000) / 500);
      const sum = (from: number, to: number): number => h.slice(bin(from), bin(to)).reduce((a, b) => a + b, 0);
      const abyssal = sum(-6500, -2000);
      const slopes = sum(-2000, -500);
      const lowlands = sum(-500, 1500);
      expect(abyssal).toBeGreaterThan(0.35);
      expect(lowlands).toBeGreaterThan(0.12);
      expect(slopes).toBeLessThan(abyssal);
      expect(slopes).toBeLessThan(lowlands);
    }
  });

  it('puts the highest ground where crust collided, erupted or sits near a convergent boundary', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      const near = hopDistance(grid, (i) => w.boundary[i] === BOUNDARY_CONVERGENT || w.boundary[i] === BOUNDARY_SUBDUCTING, 3);
      const order = Array.from({ length: w.n }, (_, i) => i).sort((a, b) => w.elevation[b] - w.elevation[a]);
      const top = order.slice(0, Math.floor(w.n * 0.01));
      let explained = 0;
      for (const i of top) {
        if (w.orogenyStep[i] >= 0 || w.volcanic[i] > 0.5 || near[i] <= 3) explained++;
      }
      expect(explained / top.length).toBeGreaterThan(0.6);
    }
  });

  it('ages oceanic crust away from ridges', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      const dist = hopDistance(grid, (i) => w.boundary[i] === BOUNDARY_DIVERGENT, 6);
      const sum = new Float64Array(8);
      const count = new Float64Array(8);
      for (let i = 0; i < w.n; i++) {
        if (w.crustType[i] !== 0) continue;
        const d = Math.min(7, dist[i]);
        sum[d] += w.crustAge[i];
        count[d] += 1;
      }
      const meanAt = (d: number): number => sum[d] / count[d];
      expect(count[0]).toBeGreaterThan(50);
      expect(meanAt(0)).toBeLessThan(meanAt(3));
      expect(meanAt(0)).toBeLessThan(meanAt(7));
    }
  });

  it('conserves continental crust volume once erosion is accounted for', () => {
    const grid = Grid.get(6);
    const sim = new TectonicsSim(grid, EARTH, new Rng(EARTH.seed).fork('tectonics'));
    const before = sim.continentalVolume();
    sim.run(EARTH.tectonicAge);
    const after = sim.continentalVolume() + sim.erodedContinental;
    expect(Math.abs(after - before) / before).toBeLessThan(0.1);
  });

  it('builds Earth within the time budget', () => {
    const t0 = performance.now();
    build({ ...EARTH, seed: 7 });
    const seconds = (performance.now() - t0) / 1000;
    // The design budget is 10 s on its own (about 5 s on the reference machine); the suite runs
    // files in parallel, hence the slack.
    expect(seconds).toBeLessThan(20);
  });
});
