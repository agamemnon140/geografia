import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EARTH_DATA_PATH, EARTH_HISTORY_AGES, EARTH_HISTORY_PATH, EARTH_HISTORY_REFERENCE, buildEarth, buildEarthKeyframe, earthContext, earthElevationAt, parseEarthElevation, parseEarthHistory } from '../src/sim/earth.ts';
import { DEG } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { nearestCell } from '../src/sim/grid/locate.ts';
import { fromLatLon } from '../src/sim/grid/geometry.ts';

const file = readFileSync(`public/${EARTH_DATA_PATH}`);
const elevation = parseEarthElevation(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const earth = buildEarth(elevation);

function cellAt(latDeg: number, lonDeg: number): number {
  const [x, y, z] = fromLatLon(latDeg * DEG, lonDeg * DEG);
  return nearestCell(Grid.get(earth.level), x, y, z);
}

describe('the real Earth reference', () => {
  it('reads the shipped relief the right way round', () => {
    expect(earthElevationAt(elevation, 33, 88)).toBeGreaterThan(4000);
    expect(earthElevationAt(elevation, 11.3, 142.2)).toBeLessThan(-7000);
    expect(earthElevationAt(elevation, 0, -50)).toBeGreaterThan(-200);
    expect(earthElevationAt(elevation, 23, 10)).toBeGreaterThan(200);
    expect(earth.elevation[cellAt(33, 88)]).toBeGreaterThan(4000);
    expect(earth.elevation[cellAt(40, -30)]).toBeLessThan(-1000);
    expect(earth.elevation[cellAt(-80, 90)]).toBeGreaterThan(2500);
  });

  it('has Earth-like land, relief and sea level', () => {
    expect(earth.reference).toBe('ETOPO5');
    expect(earth.seaLevel).toBe(0);
    expect(earth.stats.oceanFraction).toBeGreaterThan(0.68);
    expect(earth.stats.oceanFraction).toBeLessThan(0.73);
    expect(earth.stats.maxElevation).toBeGreaterThan(4500);
    expect(earth.stats.minElevation).toBeLessThan(-7000);
    // The Bering Strait is narrower than a cell, so the Americas join Afro-Eurasia: four landmasses
    // above a million km^2 (with Antarctica, Australia and Greenland).
    expect(earth.stats.continents).toBeGreaterThanOrEqual(4);
    expect(earth.stats.continents).toBeLessThanOrEqual(8);
  });

  it('gets an Earth-like climate from the simulator alone', () => {
    const s = earth.stats;
    expect(s.meanTemperature).toBeGreaterThan(10);
    expect(s.meanTemperature).toBeLessThan(18);
    expect(s.iceSheetFraction).toBeGreaterThan(0.05);
    expect(s.iceSheetFraction).toBeLessThan(0.2);
    expect(s.meanLandPrecipitation).toBeGreaterThan(500);
    expect(s.meanLandPrecipitation).toBeLessThan(1100);
    const k = s.koppen;
    expect(k.A).toBeGreaterThan(0.1);
    expect(k.A).toBeLessThan(0.3);
    expect(k.B).toBeGreaterThan(0.15);
    expect(k.B).toBeLessThan(0.45);
    expect(k.E).toBeGreaterThan(0.05);
    expect(k.E).toBeLessThan(0.3);
    // The Sahara is arid and the Amazon basin is tropical.
    expect(earth.precipitation[cellAt(23, 10)]).toBeLessThan(300);
    expect(earth.temperatureAnnual[cellAt(-3, -60)]).toBeGreaterThan(20);
    expect(earth.precipitation[cellAt(-3, -60)]).toBeGreaterThan(1200);
    // Siberia is cold in the annual mean, Antarctica is ice.
    expect(earth.temperatureAnnual[cellAt(65, 120)]).toBeLessThan(-5);
    expect(earth.iceSheet[cellAt(-80, 90)]).toBe(1);
  });
});

describe("the real Earth's past", () => {
  it('ships twenty reconstructions and builds the oldest as Pangea with its age as the step', () => {
    const history = readFileSync(`public/${EARTH_HISTORY_PATH}`);
    const slices = parseEarthHistory(history.buffer.slice(history.byteOffset, history.byteOffset + history.byteLength));
    expect(slices.length).toBe(EARTH_HISTORY_AGES.length);
    expect(EARTH_HISTORY_AGES[0]).toBe(200);
    expect(EARTH_HISTORY_AGES[EARTH_HISTORY_AGES.length - 1]).toBe(10);
    let land = 0;
    for (const v of slices[0].data) if (v >= 0) land++;
    expect(land / slices[0].data.length).toBeGreaterThan(0.2);
    expect(land / slices[0].data.length).toBeLessThan(0.45);
    const pangea = buildEarthKeyframe(earthContext(), slices[0], EARTH_HISTORY_AGES[0]);
    expect(pangea.steps).toBe(0);
    expect(pangea.params.tectonicAge).toBe(200);
    expect(pangea.reference).toBe(EARTH_HISTORY_REFERENCE);
    expect(pangea.seaLevel).toBe(0);
    expect(pangea.stats.oceanFraction).toBeGreaterThan(0.6);
    expect(pangea.stats.oceanFraction).toBeLessThan(0.8);
    // One supercontinent, give or take the terranes of the Tethys.
    expect(pangea.stats.continents).toBeLessThanOrEqual(4);
    expect(pangea.stats.largestLandmassKm2 / (pangea.stats.landFraction * pangea.stats.totalAreaKm2)).toBeGreaterThan(0.7);
    for (let i = 0; i < pangea.n; i += 97) expect(Number.isFinite(pangea.temperatureAnnual[i])).toBe(true);
  });
});
