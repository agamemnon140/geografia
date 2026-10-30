import { CONTINENTAL_THICKNESS_KM, OCEANIC, OCEANIC_THICKNESS_KM } from './crust.ts';

/**
 * Crust parcels. Each parcel is a piece of crust fixed to one cell of its
 * plate's own reference frame; the plate's rotation carries it across the
 * world grid. Storing crust in plate frames means resampling never destroys
 * or duplicates material: the world map is only a view.
 *
 * Arrays are indexed by parcel id. `frameIndex[plate][cell]` gives the parcel
 * sitting on that frame cell, or -1.
 */
export class ParcelPool {
  capacity: number;
  /** High-water mark of allocated ids. */
  count = 0;
  private free: number[] = [];

  plate: Int32Array;
  frameCell: Int32Array;
  /** World cell this parcel mapped to in the last step; start of the next nearest-cell walk. */
  lastWorld: Int32Array;
  alive: Uint8Array;
  crustType: Uint8Array;
  thickness: Float64Array;
  age: Float64Array;
  volcanic: Float64Array;
  sediment: Float64Array;
  orogenyStep: Int32Array;
  frameIndex: Int32Array[];

  constructor(n: number, plateCount: number) {
    this.capacity = n + (n >> 1);
    this.plate = new Int32Array(this.capacity);
    this.frameCell = new Int32Array(this.capacity);
    this.lastWorld = new Int32Array(this.capacity);
    this.alive = new Uint8Array(this.capacity);
    this.crustType = new Uint8Array(this.capacity);
    this.thickness = new Float64Array(this.capacity);
    this.age = new Float64Array(this.capacity);
    this.volcanic = new Float64Array(this.capacity);
    this.sediment = new Float64Array(this.capacity);
    this.orogenyStep = new Int32Array(this.capacity);
    this.frameIndex = [];
    for (let p = 0; p < plateCount; p++) this.frameIndex.push(new Int32Array(n).fill(-1));
  }

  /** New parcel on a frame cell of a plate; defaults to fresh oceanic crust. */
  alloc(plate: number, frameCell: number, lastWorld: number): number {
    let id: number;
    if (this.free.length > 0) id = this.free.pop() as number;
    else {
      if (this.count >= this.capacity) this.grow();
      id = this.count++;
    }
    this.plate[id] = plate;
    this.frameCell[id] = frameCell;
    this.lastWorld[id] = lastWorld;
    this.alive[id] = 1;
    this.crustType[id] = OCEANIC;
    this.thickness[id] = OCEANIC_THICKNESS_KM;
    this.age[id] = 0;
    this.volcanic[id] = 0;
    this.sediment[id] = 0;
    this.orogenyStep[id] = -1;
    this.frameIndex[plate][frameCell] = id;
    return id;
  }

  /** Make a parcel continental with the given thickness. */
  setContinental(id: number, thickness = CONTINENTAL_THICKNESS_KM): void {
    this.crustType[id] = 1;
    this.thickness[id] = thickness;
  }

  /** Remove a parcel (consumed by subduction or collision). */
  release(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    const index = this.frameIndex[this.plate[id]];
    if (index[this.frameCell[id]] === id) index[this.frameCell[id]] = -1;
    this.free.push(id);
  }

  private grow(): void {
    const cap = this.capacity * 2;
    const grow32 = (a: Int32Array): Int32Array => { const b = new Int32Array(cap); b.set(a); return b; };
    const grow8 = (a: Uint8Array): Uint8Array => { const b = new Uint8Array(cap); b.set(a); return b; };
    const grow64 = (a: Float64Array): Float64Array => { const b = new Float64Array(cap); b.set(a); return b; };
    this.plate = grow32(this.plate);
    this.frameCell = grow32(this.frameCell);
    this.lastWorld = grow32(this.lastWorld);
    this.orogenyStep = grow32(this.orogenyStep);
    this.alive = grow8(this.alive);
    this.crustType = grow8(this.crustType);
    this.thickness = grow64(this.thickness);
    this.age = grow64(this.age);
    this.volcanic = grow64(this.volcanic);
    this.sediment = grow64(this.sediment);
    this.capacity = cap;
  }
}
