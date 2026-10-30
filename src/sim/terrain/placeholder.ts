import type { Grid } from '../grid/grid.ts';
import { Noise3D } from '../rng/noise.ts';
import type { Rng } from '../rng/xoshiro.ts';

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Milestone-1 stand-in for tectonics: a bimodal noise terrain (continental
 * shelves near +500 m, abyssal plains near -4000 m) so the sea-level solver and
 * the renderer have something Earth-shaped to work with. Replaced in M2 by the
 * plate simulation; nothing downstream depends on how it is produced.
 */
export function placeholderTerrain(grid: Grid, rng: Rng): Float64Array {
  const continents = new Noise3D(rng.fork('continents'));
  const detail = new Noise3D(rng.fork('detail'));
  const elevation = new Float64Array(grid.n);
  for (let i = 0; i < grid.n; i++) {
    const x = grid.xyz[3 * i];
    const y = grid.xyz[3 * i + 1];
    const z = grid.xyz[3 * i + 2];
    const c = continents.fbm(x * 1.6, y * 1.6, z * 1.6, 5, 2, 0.5);
    const d = detail.fbm(x * 6, y * 6, z * 6, 5, 2, 0.5);
    const land = smoothstep(0.04, 0.16, c);
    const base = -4000 * (1 - land) + 500 * land;
    elevation[i] = base + d * (land * 1800 + (1 - land) * 900);
  }
  return elevation;
}
