import { describe, expect, it } from 'vitest';
import { EQUAL_EARTH_X_MAX, EQUAL_EARTH_Y_MAX, equalEarthForward, equalEarthInverse } from '../src/render/equalearth.ts';
import { layerById } from '../src/render/layers.ts';
import { paintProjection } from '../src/render/paint.ts';
import { FULL_VIEW, projectLatLon, projectionRaster, unprojectPixel } from '../src/render/raster.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';

const DEG = Math.PI / 180;

describe('the Equal Earth projection', () => {
  it('inverts its forward mapping and keeps the equator and the central meridian straight', () => {
    for (const [lat, lon] of [[0, 0], [45, 90], [-60, -170], [80, 10], [-89, 179], [30, -45]]) {
      const [x, y] = equalEarthForward(lat * DEG, lon * DEG);
      const back = equalEarthInverse(x, y);
      expect(back).not.toBeNull();
      expect(back![0]).toBeCloseTo(lat * DEG, 9);
      expect(back![1]).toBeCloseTo(lon * DEG, 9);
    }
    expect(equalEarthForward(0, 1)[1]).toBe(0);
    expect(equalEarthForward(1, 0)[0]).toBe(0);
    expect(equalEarthForward(0, Math.PI)[0]).toBeCloseTo(EQUAL_EARTH_X_MAX, 12);
    expect(equalEarthForward(Math.PI / 2, 0)[1]).toBeCloseTo(EQUAL_EARTH_Y_MAX, 12);
  });

  it('is equal-area: the Jacobian equals the cosine of the latitude', () => {
    const h = 1e-6;
    for (const [lat, lon] of [[0, 0], [30, 60], [-50, -120], [70, 150]]) {
      const la = lat * DEG;
      const lo = lon * DEG;
      const [x0, y0] = equalEarthForward(la, lo);
      const [x1] = equalEarthForward(la, lo + h);
      const [x2, y2] = equalEarthForward(la + h, lo);
      const jacobian = Math.abs(((x1 - x0) / h) * ((y2 - y0) / h) - ((x2 - x0) / h) * 0);
      expect(jacobian).toBeCloseTo(Math.cos(la), 4);
    }
  });

  it('leaves the corners of the canvas empty and maps the center to a cell', () => {
    const grid = Grid.get(4);
    const raster = projectionRaster(grid, 200, 100, FULL_VIEW, 'equalEarth');
    expect(raster.cell[0]).toBe(-1);
    expect(raster.cell[199]).toBe(-1);
    expect(raster.cell[99 * 200]).toBe(-1);
    expect(raster.cell[50 * 200 + 100]).toBeGreaterThanOrEqual(0);
    let drawn = 0;
    for (let p = 0; p < raster.cell.length; p++) if (raster.cell[p] >= 0) drawn++;
    // The outline covers 4 pi of the 15.1 square projection units of a 2:1 canvas: about 83%.
    expect(drawn / raster.cell.length).toBeGreaterThan(0.78);
    expect(drawn / raster.cell.length).toBeLessThan(0.88);
    expect(unprojectPixel('equalEarth', 1, 1, 200, 100)).toBeNull();
    const center = unprojectPixel('equalEarth', 100, 50, 200, 100);
    expect(center).not.toBeNull();
    expect(center![0]).toBeCloseTo(0, 6);
    expect(center![1]).toBeCloseTo(0, 6);
    const [px, py] = projectLatLon('equalEarth', 0.3, -1.2, 200, 100, { lon0: 20, lat0: 0, zoom: 1 });
    const back = unprojectPixel('equalEarth', px, py, 200, 100, { lon0: 20, lat0: 0, zoom: 1 });
    expect(back![0]).toBeCloseTo(0.3, 9);
    expect(back![1]).toBeCloseTo(-1.2, 9);
  });

  it('paints a planet with the background outside the outline', () => {
    const world = build({ ...EARTH, tectonicAge: 50 }, () => {}, { coarser: 2 });
    const w = 240;
    const h = 120;
    const out = new Uint8ClampedArray(w * h * 4);
    paintProjection(world, layerById('elevation'), w, h, out, undefined, FULL_VIEW, 'equalEarth');
    expect(out[3]).toBe(255);
    expect([out[0], out[1], out[2]]).toEqual([20, 22, 26]);
    const c = 4 * (60 * w + 120);
    expect(out[c + 3]).toBe(255);
    expect(out[c] + out[c + 1] + out[c + 2]).not.toBe(20 + 22 + 26);
  });
});
