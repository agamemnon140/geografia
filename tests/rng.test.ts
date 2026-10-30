import { describe, expect, it } from 'vitest';
import { Noise3D } from '../src/sim/rng/noise.ts';
import { Rng } from '../src/sim/rng/xoshiro.ts';

describe('Rng', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const c = new Rng(124);
    const sa = Array.from({ length: 16 }, () => a.next());
    const sb = Array.from({ length: 16 }, () => b.next());
    const sc = Array.from({ length: 16 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('produces unsigned 32-bit integers and floats in [0, 1) with a sane mean', () => {
    const rng = new Rng(7);
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const u = rng.next();
      expect(Number.isInteger(u) && u >= 0 && u < 4294967296).toBe(true);
      const f = rng.float();
      expect(f >= 0 && f < 1).toBe(true);
      sum += f;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.01);
  });

  it('forks are independent of the parent sequence and of each other', () => {
    const parent1 = new Rng(99);
    const forkA1 = parent1.fork('plates');
    parent1.next();
    parent1.next();
    const forkB1 = parent1.fork('hotspots');

    const parent2 = new Rng(99);
    const forkB2 = parent2.fork('hotspots');
    const forkA2 = parent2.fork('plates');

    expect(forkA1.next()).toBe(forkA2.next());
    expect(forkB1.next()).toBe(forkB2.next());
    expect(new Rng(99).fork('plates').next()).not.toBe(new Rng(99).fork('hotspots').next());
  });

  it('shuffles into a permutation', () => {
    const rng = new Rng(5);
    const arr = Array.from({ length: 50 }, (_, i) => i);
    rng.shuffle(arr);
    expect([...arr].sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(arr).not.toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('normal deviates have roughly zero mean and unit variance', () => {
    const rng = new Rng(11);
    let sum = 0;
    let sq = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      sum += v;
      sq += v * v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
    expect(Math.abs(sq / n - 1)).toBeLessThan(0.03);
  });
});

describe('Noise3D', () => {
  it('is deterministic per seed, bounded, non-constant and continuous', () => {
    const n1 = new Noise3D(new Rng(3));
    const n2 = new Noise3D(new Rng(3));
    const n3 = new Noise3D(new Rng(4));
    const rng = new Rng(8);
    let min = Infinity;
    let max = -Infinity;
    let differs = false;
    for (let i = 0; i < 2000; i++) {
      const x = rng.range(-10, 10);
      const y = rng.range(-10, 10);
      const z = rng.range(-10, 10);
      const v = n1.eval(x, y, z);
      expect(v).toBe(n2.eval(x, y, z));
      if (v !== n3.eval(x, y, z)) differs = true;
      if (v < min) min = v;
      if (v > max) max = v;
      const dv = Math.abs(v - n1.eval(x + 1e-4, y, z));
      expect(dv).toBeLessThan(1e-2);
    }
    expect(differs).toBe(true);
    expect(min).toBeGreaterThanOrEqual(-1.05);
    expect(max).toBeLessThanOrEqual(1.05);
    expect(max - min).toBeGreaterThan(0.5);
  });

  it('fbm stays within [-1, 1]', () => {
    const noise = new Noise3D(new Rng(1));
    const rng = new Rng(2);
    for (let i = 0; i < 2000; i++) {
      const v = noise.fbm(rng.range(-5, 5), rng.range(-5, 5), rng.range(-5, 5));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});
