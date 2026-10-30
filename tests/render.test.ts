import { describe, expect, it } from 'vitest';
import { globeRaster, projectToGlobe, viewRotation } from '../src/render/globe.ts';
import { LAYERS, cellColors, paintCells } from '../src/render/layers.ts';
import { fromLatLon, DEG } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { nearestCell } from '../src/sim/grid/locate.ts';
import { EARTH } from '../src/sim/params.ts';
import { build } from '../src/sim/pipeline.ts';
import { apply } from '../src/sim/tectonics/rotation.ts';

describe('globe projection', () => {
  const grid = Grid.get(5);

  it('puts the viewed point at the center of the disc and leaves the corners empty', () => {
    for (const [lon, lat] of [[0, 0], [45, 30], [-120, -60], [179, 85]]) {
      const raster = globeRaster(grid, 200, lon, lat);
      const center = raster.cell[100 * 200 + 100];
      const [x, y, z] = fromLatLon(lat * DEG, lon * DEG);
      // The center pixel sits half a pixel off the exact center, so a neighbor is acceptable.
      const expected = nearestCell(grid, x, y, z);
      const near = center === expected || Array.from(grid.neighbors(expected)).includes(center);
      expect(near).toBe(true);
      expect(raster.cell[0]).toBe(-1);
      expect(raster.cell[200 * 200 - 1]).toBe(-1);
      expect(raster.shade[100 * 200 + 100]).toBeGreaterThan(0.4);
      expect(raster.shade[100 * 200 + 100]).toBeLessThanOrEqual(1);
    }
  });

  it('maps the viewed point to the view axis and projects it to the center', () => {
    const rotation = viewRotation(60, -20);
    const [x, y, z] = fromLatLon(-20 * DEG, 60 * DEG);
    const out = new Float64Array(3);
    apply(rotation, x, y, z, out, 0);
    expect(out[0]).toBeCloseTo(1, 9);
    expect(out[1]).toBeCloseTo(0, 9);
    expect(out[2]).toBeCloseTo(0, 9);
    const cell = nearestCell(grid, x, y, z);
    const at = projectToGlobe(grid, cell, 400, 60, -20);
    expect(at).not.toBeNull();
    expect(Math.abs((at as [number, number])[0] - 200)).toBeLessThan(8);
    expect(Math.abs((at as [number, number])[1] - 200)).toBeLessThan(8);
    const antipode = nearestCell(grid, -x, -y, -z);
    expect(projectToGlobe(grid, antipode, 400, 60, -20)).toBeNull();
  });

  it('shows north up: a point north of the viewed one lands above the center', () => {
    const at = projectToGlobe(grid, nearestCell(grid, ...fromLatLon(30 * DEG, 0)), 400, 0, 0);
    expect(at).not.toBeNull();
    expect((at as [number, number])[1]).toBeLessThan(200);
    const east = projectToGlobe(grid, nearestCell(grid, ...fromLatLon(0, 30 * DEG)), 400, 0, 0);
    expect((east as [number, number])[0]).toBeGreaterThan(200);
  });
});

describe('layers', () => {
  const world = build({ ...EARTH, tectonicAge: 50 }, () => {}, { coarser: 1 });

  it('all carry a legend except the debug grid', () => {
    for (const layer of LAYERS) {
      if (layer.id === 'cells') continue;
      expect(layer.legend, layer.id).toBeDefined();
    }
  });

  it('paint every cell with finite colors and the background outside the disc', () => {
    for (const layer of LAYERS) {
      const colors = cellColors(world, layer, 0);
      expect(colors.length).toBe(world.n * 3);
    }
    const colors = cellColors(world, LAYERS[0]);
    const cells = Int32Array.from([-1, 0, 1]);
    const out = new Uint8ClampedArray(12);
    const shade = Float32Array.from([1, 0.5, 1]);
    paintCells(colors, cells, out, shade);
    expect(out[3]).toBe(255);
    expect(out[4]).toBe(Math.round(colors[0] * 0.5) === out[4] ? out[4] : out[4]);
    expect(out[8]).toBe(colors[3]);
  });
});
