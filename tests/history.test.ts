import { describe, expect, it } from 'vitest';
import { EARTH } from '../src/sim/params.ts';
import { build, buildHistory, compactWorld, finalize, keyframeSteps, worldBuffers } from '../src/sim/pipeline.ts';

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
}

describe('timeline keyframes', () => {
  it('spaces keyframes evenly inside the run', () => {
    expect(keyframeSteps(200, 8)).toEqual([22, 44, 67, 89, 111, 133, 156, 178]);
    expect(keyframeSteps(100, 1)).toEqual([50]);
    expect(keyframeSteps(50, 0)).toEqual([]);
  });

  it('reproduces, at step 50 of a 100-step run, the planet of a 50-step run', () => {
    const history = buildHistory({ ...EARTH, tectonicAge: 100 }, () => {}, { keyframes: 1 });
    expect(history.snapshots.length).toBe(1);
    expect(history.snapshots[0].step).toBe(50);
    const keyframe = finalize(history.context, history.snapshots[0]);
    const direct = build({ ...EARTH, tectonicAge: 50 });
    expect(keyframe.steps).toBe(50);
    expect(sameBytes(keyframe.elevation, direct.elevation)).toBe(true);
    expect(sameBytes(keyframe.thickness, direct.thickness)).toBe(true);
    expect(sameBytes(keyframe.temperatureAnnual, direct.temperatureAnnual)).toBe(true);
    expect(sameBytes(keyframe.discharge, direct.discharge)).toBe(true);
    expect(keyframe.seaLevel).toBe(direct.seaLevel);
    expect(keyframe.stats).toEqual(direct.stats);
    // Capturing keyframes does not disturb the final world.
    expect(sameBytes(history.world.elevation, build({ ...EARTH, tectonicAge: 100 }).elevation)).toBe(true);
    expect(history.world.steps).toBe(100);
  });

  it('compacts a world to Float32 without touching the integer fields', () => {
    const world = build({ ...EARTH, tectonicAge: 50 });
    const compact = compactWorld(world);
    expect(compact.elevation).toBeInstanceOf(Float32Array);
    expect(compact.plate).toBe(world.plate);
    expect(compact.koppen).toBe(world.koppen);
    expect(compact.stats).toBe(world.stats);
    for (let i = 0; i < world.n; i += 97) {
      expect(compact.elevation[i]).toBeCloseTo(world.elevation[i], 1);
      expect(compact.temperatureAnnual[i]).toBeCloseTo(world.temperatureAnnual[i], 3);
    }
    expect(worldBuffers(compact).length).toBe(worldBuffers(world).length);
    let bytes = 0;
    for (const b of worldBuffers(compact)) bytes += b.byteLength;
    let full = 0;
    for (const b of worldBuffers(world)) full += b.byteLength;
    expect(bytes).toBeLessThan(0.6 * full);
  });
});
