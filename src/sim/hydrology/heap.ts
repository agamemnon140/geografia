/**
 * Binary min-heap of cell ids keyed by a float, with ties broken by insertion
 * order (first in, first out). FIFO ties matter for priority-flood: inside a
 * flat lake surface they make the drainage tree grow breadth-first from the
 * spill point, so lake cells drain toward the outlet by the shortest path.
 */
export class MinHeap {
  private keys: Float64Array;
  private seqs: Int32Array;
  private vals: Int32Array;
  private size = 0;
  private counter = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.seqs = new Int32Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.size = 0;
    this.counter = 0;
  }

  push(key: number, value: number): void {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    const seq = this.counter++;
    const keys = this.keys;
    const seqs = this.seqs;
    const vals = this.vals;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] < key || (keys[parent] === key && seqs[parent] < seq)) break;
      keys[i] = keys[parent];
      seqs[i] = seqs[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    seqs[i] = seq;
    vals[i] = value;
  }

  /** Key of the top element; only valid when length > 0. */
  peekKey(): number {
    return this.keys[0];
  }

  /** Remove and return the value with the smallest key (oldest among ties). */
  pop(): number {
    const keys = this.keys;
    const seqs = this.seqs;
    const vals = this.vals;
    const top = vals[0];
    const last = --this.size;
    if (last === 0) return top;
    const key = keys[last];
    const seq = seqs[last];
    const val = vals[last];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      const right = child + 1;
      if (right < last && (keys[right] < keys[child] || (keys[right] === keys[child] && seqs[right] < seqs[child]))) {
        child = right;
      }
      if (keys[child] > key || (keys[child] === key && seqs[child] > seq)) break;
      keys[i] = keys[child];
      seqs[i] = seqs[child];
      vals[i] = vals[child];
      i = child;
    }
    keys[i] = key;
    seqs[i] = seq;
    vals[i] = val;
    return top;
  }

  private grow(): void {
    const cap = this.keys.length * 2;
    const keys = new Float64Array(cap);
    const seqs = new Int32Array(cap);
    const vals = new Int32Array(cap);
    keys.set(this.keys);
    seqs.set(this.seqs);
    vals.set(this.vals);
    this.keys = keys;
    this.seqs = seqs;
    this.vals = vals;
  }
}
