import type { PlanetParams } from '../sim/params.ts';
import type { BuildOptions, Progress, World } from '../sim/pipeline.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

export interface BuildResult {
  world: World;
  elapsedMs: number;
}

export interface BuildCallbacks {
  onProgress?: Progress;
  /** A timeline keyframe, oldest first; `index` counts from 0 to `total - 1`. */
  onKeyframe?: (world: World, index: number, total: number) => void;
  /** Every keyframe has arrived. */
  onHistory?: (elapsedMs: number) => void;
}

interface Pending extends BuildCallbacks {
  resolve: (result: BuildResult) => void;
  reject: (err: Error) => void;
  done: boolean;
}

/** Main-thread handle to the simulation worker. One build at a time per client is the expected use. */
export class SimClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      for (const p of this.pending.values()) if (!p.done) p.reject(new Error(event.message));
      this.pending.clear();
    };
  }

  /** Resolves with the final world; keyframes keep arriving through the callbacks afterwards. */
  build(params: PlanetParams, callbacks: BuildCallbacks = {}, options: BuildOptions = {}): Promise<BuildResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { ...callbacks, resolve, reject, done: false });
      const request: WorkerRequest = { type: 'build', id, params, options };
      this.worker.postMessage(request);
    });
  }

  /** The real Earth from the shipped elevation bytes, and its past from the history bytes when given (both transferred to the worker). */
  buildEarth(elevation: ArrayBuffer, callbacks: BuildCallbacks = {}, history?: ArrayBuffer): Promise<BuildResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { ...callbacks, resolve, reject, done: false });
      const request: WorkerRequest = { type: 'earth', id, elevation, history };
      this.worker.postMessage(request, history ? [elevation, history] : [elevation]);
    });
  }

  private handle(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case 'progress':
        p.onProgress?.(msg.stage, msg.fraction);
        break;
      case 'done':
        p.done = true;
        p.resolve({ world: msg.world, elapsedMs: msg.elapsedMs });
        break;
      case 'keyframe':
        p.onKeyframe?.(msg.world, msg.index, msg.total);
        break;
      case 'history':
        this.pending.delete(msg.id);
        p.onHistory?.(msg.elapsedMs);
        break;
      case 'error':
        this.pending.delete(msg.id);
        if (!p.done) p.reject(new Error(msg.message));
        break;
    }
  }
}
