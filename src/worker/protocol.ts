import type { PlanetParams } from '../sim/params.ts';
import type { World } from '../sim/pipeline.ts';

export type WorkerRequest = { type: 'build'; id: number; params: PlanetParams };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'done'; id: number; world: World; elapsedMs: number }
  | { type: 'error'; id: number; message: string };
