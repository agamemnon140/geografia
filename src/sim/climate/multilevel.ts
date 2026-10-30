import { MIN_LEVEL } from '../constants.ts';
import { Grid } from '../grid/grid.ts';

/**
 * Multilevel helpers for the climate solvers. Icosphere subdivision keeps
 * the ids of the coarse vertices and appends the new ones, each sitting
 * between exactly two coarse vertices, so a field solved on a coarse level
 * prolongates to the next level by copying the coarse values and averaging
 * the two parents for the new cells. Large-scale balances converge on the
 * cheap coarse grids; the fine grid only has to fix local detail.
 */

/** Grid levels from the coarsest the model uses up to the given level. */
export function levelsUpTo(level: number): Grid[] {
  const out: Grid[] = [];
  for (let l = MIN_LEVEL; l <= level; l++) out.push(Grid.get(l));
  return out;
}

/** Copy a coarse field onto the next finer grid, averaging the two parents of every new cell. */
export function prolongate(coarse: Grid, fine: Grid, from: Float64Array, to: Float64Array): void {
  const nc = coarse.n;
  for (let i = 0; i < nc; i++) to[i] = from[i];
  for (let i = nc; i < fine.n; i++) {
    let sum = 0;
    let count = 0;
    for (let t = fine.nbStart[i]; t < fine.nbStart[i + 1]; t++) {
      const nb = fine.nb[t];
      if (nb < nc) {
        sum += from[nb];
        count++;
      }
    }
    to[i] = count > 0 ? sum / count : 0;
  }
}
