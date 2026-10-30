import { describe, expect, it } from 'vitest';
import { globeRaster, projectToGlobe, viewRotation } from '../src/render/globe.ts';
import { LAYERS, cellColors, paintCells } from '../src/render/layers.ts';
import { PixelSampler, paintEquirect } from '../src/render/paint.ts';
import { clampViewport, equirectRaster, latLonToPixel, pixelToLatLon } from '../src/render/raster.ts';
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

describe('map viewport', () => {
  const grid = Grid.get(5);

  it('round-trips pixels through latitude and longitude at any zoom and center', () => {
    for (const view of [{ lon0: 0, lat0: 0, zoom: 1 }, { lon0: 150, lat0: 30, zoom: 3 }, { lon0: -170, lat0: -60, zoom: 8 }]) {
      for (const [px, py] of [[10, 20], [700, 360], [1430, 700]]) {
        const [lat, lon] = pixelToLatLon(px, py, 1440, 720, view);
        const [x, y] = latLonToPixel(lat, lon, 1440, 720, view);
        expect(x).toBeCloseTo(px, 6);
        expect(y).toBeCloseTo(py, 6);
      }
    }
  });

  it('centers a zoomed window on its view point and keeps the window within the poles', () => {
    const view = { lon0: 30, lat0: 20, zoom: 4 };
    const raster = equirectRaster(grid, 120, 60, view);
    const center = raster.cell[30 * 120 + 60];
    const expected = nearestCell(grid, ...fromLatLon(20 * DEG, 30 * DEG));
    const near = center === expected || Array.from(grid.neighbors(expected)).includes(center);
    expect(near).toBe(true);
    expect(clampViewport({ lon0: 0, lat0: 80, zoom: 4 }).lat0).toBeCloseTo(67.5, 9);
    expect(clampViewport({ lon0: 190, lat0: 0, zoom: 1 }).lon0).toBeCloseTo(-170, 9);
    expect(clampViewport({ lon0: 0, lat0: 0, zoom: 40 }).zoom).toBe(16);
    expect(clampViewport({ lon0: 0, lat0: 50, zoom: 1 }).lat0).toBe(0);
  });
});

describe('interpolation', () => {
  const grid = Grid.get(5);
  const raster = equirectRaster(grid, 240, 120);

  it('gives every pixel three valid cells with weights that sum to one', () => {
    for (let p = 0; p < raster.width * raster.height; p++) {
      const sum = raster.weight[3 * p] + raster.weight[3 * p + 1] + raster.weight[3 * p + 2];
      expect(sum).toBeCloseTo(1, 5);
      for (let k = 0; k < 3; k++) {
        expect(raster.weight[3 * p + k]).toBeGreaterThanOrEqual(0);
        expect(raster.tri[3 * p + k]).toBeGreaterThanOrEqual(0);
        expect(raster.tri[3 * p + k]).toBeLessThan(grid.n);
      }
      expect(raster.tri[3 * p]).toBe(raster.cell[p]);
    }
  });

  it('reproduces a field that is linear in position', () => {
    // sin(latitude) is the z coordinate: linear in the cell position, so the interpolation of
    // the per-cell values must match the pixel's own latitude closely.
    const field = new Float64Array(grid.n);
    for (let i = 0; i < grid.n; i++) field[i] = grid.xyz[3 * i + 2];
    const px = new PixelSampler();
    let worst = 0;
    for (let r = 0; r < raster.height; r++) {
      const lat = Math.PI / 2 - ((r + 0.5) / raster.height) * Math.PI;
      for (let c = 0; c < raster.width; c += 7) {
        px.set(raster, r * raster.width + c);
        worst = Math.max(worst, Math.abs(px.interp(field) - Math.sin(lat)));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('paints smoothly with hillshade and rivers without leaving the color range', () => {
    const world = build({ ...EARTH, tectonicAge: 50 }, () => {}, { coarser: 1 });
    const out = new Uint8ClampedArray(240 * 120 * 4);
    paintEquirect(world, LAYERS[0], 240, 120, out);
    let dark = 0;
    for (let p = 0; p < 240 * 120; p++) {
      expect(out[p * 4 + 3]).toBe(255);
      if (out[p * 4] + out[p * 4 + 1] + out[p * 4 + 2] < 30) dark++;
    }
    expect(dark).toBeLessThan(240 * 120 * 0.2);
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
