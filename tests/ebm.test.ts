import { describe, expect, it } from 'vitest';
import { diffusion, olrOffset } from '../src/sim/climate/ebm.ts';
import { orbitalFactors, SAMPLES } from '../src/sim/climate/insolation.ts';
import { DEG } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';

const QUICK = { ...EARTH, tectonicAge: 50 };
const earth = build(QUICK);

/** Mean seasonal range (warmest minus coldest sample) over land cells in a latitude band of one hemisphere. */
function landRange(w: World, lo: number, hi: number): number {
  const grid = Grid.get(w.level);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < w.n; i++) {
    const lat = grid.lat[i] / DEG;
    if (lat < lo || lat > hi || w.elevation[i] < w.seaLevel) continue;
    let min = Infinity;
    let max = -Infinity;
    for (let s = 0; s < SAMPLES; s++) {
      const t = w.temperature[s * w.n + i];
      if (t < min) min = t;
      if (t > max) max = t;
    }
    sum += max - min;
    count++;
  }
  return count > 0 ? sum / count : NaN;
}

describe('energy-balance model', () => {
  it('gives Earth its climate from the balance alone', () => {
    const s = earth.stats;
    // Geography moves the mean by a degree or two (a supercontinent world runs colder: more polar ocean, more sea ice).
    expect(earth.globalMeanTemperature).toBeGreaterThan(11);
    expect(earth.globalMeanTemperature).toBeLessThan(18);
    expect(s.equatorTemperature).toBeGreaterThan(22);
    expect(s.equatorTemperature).toBeLessThan(32);
    expect(s.poleTemperature).toBeGreaterThan(-30);
    expect(s.poleTemperature).toBeLessThan(-5);
    // Ice sheets need polar land, which this geography barely has; some ice exists somewhere.
    expect(s.iceSheetFraction + s.permanentSeaIceFraction).toBeGreaterThan(0.01);
    expect(s.iceSheetFraction).toBeLessThan(0.3);
    // Seed 1 is a cold world with a wide polar ocean; the model also overestimates permanent sea ice (DESIGN 3.5).
    expect(s.permanentSeaIceFraction).toBeLessThan(0.3);
  });

  it('freezes over at low insolation and bakes at high insolation, with nothing but the balance', () => {
    const dim = build({ ...QUICK, insolation: 0.8 });
    const bright = build({ ...QUICK, insolation: 1.2 });
    expect(dim.stats.permanentSeaIceFraction).toBeGreaterThan(0.9);
    expect(dim.stats.iceSheetFraction).toBeGreaterThan(0.7);
    expect(dim.stats.meanTemperature).toBeLessThan(-30);
    expect(bright.stats.iceSheetFraction).toBeLessThan(0.05);
    expect(bright.stats.permanentSeaIceFraction).toBe(0);
    expect(bright.stats.meanTemperature).toBeGreaterThan(30);
  });

  it('warms with the greenhouse and cools without it', () => {
    const thick = build({ ...QUICK, greenhouse: 3 });
    const thin = build({ ...QUICK, greenhouse: 0.4 });
    expect(thick.stats.meanTemperature).toBeGreaterThan(earth.stats.meanTemperature + 6);
    expect(thin.stats.meanTemperature).toBeLessThan(earth.stats.meanTemperature - 6);
    expect(thick.stats.iceSheetFraction).toBeLessThan(earth.stats.iceSheetFraction);
    expect(olrOffset({ ...EARTH, greenhouse: 3 })).toBeLessThan(olrOffset(EARTH));
  });

  it('flattens the equator-to-pole contrast with more air and steepens it with less', () => {
    const dense = build({ ...QUICK, pressureBar: 5 });
    const thin = build({ ...QUICK, pressureBar: 0.3 });
    const contrast = (w: World): number => w.stats.equatorTemperature - w.stats.poleTemperature;
    expect(contrast(dense)).toBeLessThan(contrast(earth));
    expect(contrast(thin)).toBeGreaterThan(contrast(earth));
    expect(diffusion({ ...EARTH, pressureBar: 5 })).toBeGreaterThan(diffusion(EARTH));
    expect(diffusion({ ...EARTH, rotationHours: 8 })).toBeLessThan(diffusion(EARTH));
    expect(diffusion({ ...EARTH, radiusKm: 2 * EARTH.radiusKm })).toBeLessThan(diffusion(EARTH));
  });

  it('gives an eccentric orbit unequal seasons, harsher in the aphelion hemisphere', () => {
    const factors = orbitalFactors(0.2);
    let mean = 0;
    for (let s = 0; s < SAMPLES; s++) mean += factors[s] / SAMPLES;
    expect(mean).toBeCloseTo(1, 6);
    expect(factors[0]).toBeGreaterThan(factors[6]);
    const eccentric = build({ ...QUICK, eccentricity: 0.2 });
    // Perihelion in southern summer: the south swings more than the north, compared with the same
    // geography on a circular orbit (the land itself is not spread evenly between hemispheres).
    const asymmetry = (w: World): number => landRange(w, -60, -40) - landRange(w, 40, 60);
    expect(asymmetry(eccentric)).toBeGreaterThan(asymmetry(earth) + 5);
  });

  it('keeps every field finite under extreme parameters', () => {
    for (const p of [
      { ...QUICK, insolation: 0.3, greenhouse: 0.2, pressureBar: 0.1 },
      { ...QUICK, insolation: 2, greenhouse: 5, pressureBar: 10, eccentricity: 0.3 },
    ]) {
      const w = build(p);
      for (let i = 0; i < w.n; i += 13) {
        expect(Number.isFinite(w.temperatureAnnual[i])).toBe(true);
        expect(Number.isFinite(w.precipitation[i])).toBe(true);
      }
    }
  });
});
