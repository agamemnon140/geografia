import { EARTH_HISTORY_AGES, buildEarth, buildEarthKeyframe, earthContext, earthDeposits, parseEarthElevation, parseEarthHistory } from '../sim/earth.ts';
import { buildHistory, compactWorld, finalize, worldBuffers } from '../sim/pipeline.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  const started = performance.now();
  const progress = (stage: string, fraction: number): void => {
    scope.postMessage({ type: 'progress', id: request.id, stage, fraction });
  };
  try {
    if (request.type === 'earth') {
      const context = earthContext();
      const deposits = request.minerals ? earthDeposits(context.grid, request.minerals) : undefined;
      const world = buildEarth(parseEarthElevation(request.elevation), progress, context, deposits);
      scope.postMessage({ type: 'done', id: request.id, world, elapsedMs: performance.now() - started }, worldBuffers(world));
      // The real past follows the present: each reconstructed relief gets its climate now, oldest first.
      const historyStart = performance.now();
      if (request.history) {
        const slices = parseEarthHistory(request.history);
        slices.forEach((slice, k) => {
          const keyframe = compactWorld(buildEarthKeyframe(context, slice, EARTH_HISTORY_AGES[k]));
          scope.postMessage({ type: 'keyframe', id: request.id, index: k, total: slices.length, world: keyframe }, worldBuffers(keyframe));
        });
      }
      scope.postMessage({ type: 'history', id: request.id, elapsedMs: performance.now() - historyStart });
      return;
    }
    const history = buildHistory(request.params, progress, request.options ?? {});
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
