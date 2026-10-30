import type { PlanetParams } from '../sim/params.ts';
import type { Progress, World } from '../sim/pipeline.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

interface Pending {
  resolve: (result: BuildResult) => void;
  reject: (err: Error) => void;
  onProgress: Progress;
}

export interface BuildResult {
  world: World;
  elapsedMs: number;
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
      for (const p of this.pending.values()) p.reject(new Error(event.message));
      this.pending.clear();
    };
  }

  build(params: PlanetParams, onProgress: Progress = () => {}): Promise<BuildResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const request: WorkerRequest = { type: 'build', id, params };
      this.worker.postMessage(request);
    });
  }

  private handle(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress(msg.stage, msg.fraction);
    } else if (msg.type === 'done') {
      this.pending.delete(msg.id);
      p.resolve({ world: msg.world, elapsedMs: msg.elapsedMs });
    } else {
      this.pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  }
}
