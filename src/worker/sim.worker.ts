import { buildHistory, compactWorld, finalize, worldBuffers } from '../sim/pipeline.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'build') return;
  const started = performance.now();
  try {
    const history = buildHistory(request.params, (stage, fraction) => {
      scope.postMessage({ type: 'progress', id: request.id, stage, fraction });
    }, request.options ?? {});
    scope.postMessage(
      { type: 'done', id: request.id, world: history.world, elapsedMs: performance.now() - started },
      worldBuffers(history.world),
    );
    // The history follows the final world: each keyframe gets its climate now, compacted to Float32.
    const total = history.snapshots.length;
    const historyStart = performance.now();
    for (let k = 0; k < total; k++) {
      const world = compactWorld(finalize(history.context, history.snapshots[k]));
      scope.postMessage({ type: 'keyframe', id: request.id, index: k, total, world }, worldBuffers(world));
    }
    scope.postMessage({ type: 'history', id: request.id, elapsedMs: performance.now() - historyStart });
  } catch (err) {
    scope.postMessage({ type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
  }
};
