import { fnv1a32, mix32 } from './hash.ts';

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Seeded pseudo-random generator (xoshiro128**), integer-only so the sequence
 * is identical on every JavaScript engine. Never use Math.random in the sim.
 */
export class Rng {
  readonly seed: number;
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    // Fill the state with splitmix32 outputs so that nearby seeds differ in every word.
    let x = this.seed;
    const next = (): number => {
      x = (x + 0x9e3779b9) | 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** Next 32-bit unsigned integer. */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Uniform float in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.float();
  }

  /** Standard normal deviate (Box-Muller). */
  normal(): number {
    let u = this.float();
    if (u < 1e-12) u = 1e-12;
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle(arr: number[] | Uint8Array | Uint32Array | Int32Array | Float64Array): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  /**
   * Independent generator for a named sub-module. Derived from the seed and the
   * label only, so draws from one module never shift another module's sequence.
   */
  fork(label: string): Rng {
    return new Rng((fnv1a32(label) ^ mix32(this.seed)) >>> 0);
  }
}
