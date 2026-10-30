import { build, worldBuffers } from '../sim/pipeline.ts';
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
    const world = build(request.params, (stage, fraction) => {
      scope.postMessage({ type: 'progress', id: request.id, stage, fraction });
    }, request.options ?? {});
    scope.postMessage(
      { type: 'done', id: request.id, world, elapsedMs: performance.now() - started },
      worldBuffers(world),
    );
  } catch (err) {
    scope.postMessage({ type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
  }
};
