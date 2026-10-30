import type { PlanetParams } from '../sim/params.ts';
import type { BuildOptions, World } from '../sim/pipeline.ts';

export type WorkerRequest =
  | { type: 'build'; id: number; params: PlanetParams; options?: BuildOptions }
  /** The real Earth from the shipped elevation file (its bytes, transferred). */
  | { type: 'earth'; id: number; elevation: ArrayBuffer };

/**
 * A build answers with progress messages, then `done` with the final world,
 * then (when keyframes were requested) one `keyframe` per captured step,
 * oldest first, and finally `history`.
 */
export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'done'; id: number; world: World; elapsedMs: number }
  | { type: 'keyframe'; id: number; index: number; total: number; world: World }
  | { type: 'history'; id: number; elapsedMs: number }
  | { type: 'error'; id: number; message: string };
