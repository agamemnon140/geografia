import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../src/sim/climate/insolation.ts';
import { KOPPEN_NAMES, classifyKoppen, koppenGroup } from '../src/sim/climate/koppen.ts';
import { DEG } from '../src/sim/grid/geometry.ts';
import { Grid } from '../src/sim/grid/grid.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { paramsFromHash, paramsToHash } from '../src/ui/url.ts';

const QUICK = { ...EARTH, tectonicAge: 50 };
const worlds: World[] = [1, 2, 3].map((seed) => build({ ...QUICK, seed }));

describe('ice with the Earth preset', () => {
  it('freezes both poles', () => {
    for (const w of worlds) {
      const grid = Grid.get(w.level);
      let north = 0;
      let south = 0;
      for (let i = 0; i < w.n; i++) {
        const lat = grid.lat[i] / DEG;
        if (Math.abs(lat) < 80) continue;
        const frozen = w.iceSheet[i] === 1 || w.seaIceMonths[i] >= SAMPLES / 2;
        if (!frozen) continue;
        if (lat > 0) north++;
        else south++;
      }
      expect(north).toBeGreaterThan(0);
      expect(south).toBeGreaterThan(0);
      expect(w.stats.iceSheetFraction).toBeLessThan(0.4);
      // A planet with its land clustered in one hemisphere leaves a wide polar ocean on the other
      // side; the model also overestimates permanent sea ice (DESIGN 3.5, M11 known biases).
      expect(w.stats.permanentSeaIceFraction).toBeLessThan(0.3);
    }
  });

  it('expands with the glacial phase and lowers the sea', () => {
    const warm = worlds[0];
    const cold = build({ ...QUICK, seed: 1, glacialPhase: 1 });
    expect(cold.stats.meanTemperature).toBeLessThan(warm.stats.meanTemperature - 4);
    expect(cold.stats.iceSheetFraction).toBeGreaterThan(warm.stats.iceSheetFraction);
    expect(cold.iceVolumeKm3).toBeGreaterThan(warm.iceVolumeKm3);
    expect(cold.seaLevel).toBeLessThan(warm.seaLevel);
    // The climate feeds the erosion inside the loop, so the two histories differ a little; the
    // water locked in ice dominates the sea-level difference.
    expect(Math.abs(cold.loopSeaLevel - warm.loopSeaLevel)).toBeLessThan(0.2 * (warm.seaLevel - cold.seaLevel));
    expect(warm.seaLevel).toBeLessThanOrEqual(warm.loopSeaLevel);
  });
});

describe('Koppen classification', () => {
  it('has every group on an Earth-like planet, with a plausible arid share', () => {
    for (const w of worlds) {
      const k = w.stats.koppen;
      for (const group of ['A', 'B', 'C', 'D', 'E'] as const) expect(k[group]).toBeGreaterThan(0);
      expect(k.B).toBeGreaterThan(0.1);
      // Compact continents have dry interiors (Pangea was arid); Earth's dissected ones give 30%.
      expect(k.B).toBeLessThan(0.52);
      expect(k.A + k.B + k.C + k.D + k.E).toBeCloseTo(1, 6);
      for (let i = 0; i < w.n; i++) {
        const land = w.elevation[i] >= w.seaLevel;
        expect(w.koppen[i] === 0).toBe(!land);
        expect(w.koppen[i]).toBeLessThan(KOPPEN_NAMES.length);
      }
    }
  });

  it('classifies synthetic climates the textbook way', () => {
    const grid = Grid.get(4);
    const n = grid.n;
    const elevation = new Float64Array(n).fill(100);
    const temperature = new Float64Array(SAMPLES * n);
    const precipitation = new Float64Array(SAMPLES * n);
    const set = (cell: number, t: (s: number) => number, p: (s: number) => number): void => {
      for (let s = 0; s < SAMPLES; s++) {
        temperature[s * n + cell] = t(s);
        precipitation[s * n + cell] = p(s);
      }
    };
    set(0, () => 26, () => 2400); // hot and wet every month: Af
    set(1, () => -20, () => 300); // never above freezing: EF
    set(2, () => 22, () => 100); // hot and dry: BWh
    set(3, (s) => 10 + 8 * Math.sin((2 * Math.PI * (s - 3)) / 12), () => 900); // 2 to 18 C, even rain, warm summer: Cfb
    set(4, (s) => 25 * Math.sin((2 * Math.PI * (s - 3)) / 12), () => 700); // -25 to 25 C, even rain, hot summer: Dfa
    const codes = classifyKoppen(grid, elevation, 0, temperature, precipitation);
    expect(KOPPEN_NAMES[codes[0]]).toMatch(/^Af/);
    expect(KOPPEN_NAMES[codes[1]]).toMatch(/^EF/);
    expect(KOPPEN_NAMES[codes[2]]).toMatch(/^BWh/);
    expect(KOPPEN_NAMES[codes[3]]).toMatch(/^Cfb/);
    expect(KOPPEN_NAMES[codes[4]]).toMatch(/^Dfa/);
    expect(koppenGroup(codes[0])).toBe('A');
    expect(koppenGroup(codes[4])).toBe('D');
  });
});

describe('statistics across seeds', () => {
  it('vary little for the same parameters', () => {
    const spread = (pick: (w: World) => number): number => {
      const values = worlds.map(pick);
      return Math.max(...values) - Math.min(...values);
    };
    expect(spread((w) => w.stats.oceanFraction)).toBeLessThan(0.12);
    expect(spread((w) => w.stats.meanTemperature)).toBeLessThan(4);
    expect(spread((w) => w.stats.meanPrecipitation)).toBeLessThan(300);
    expect(spread((w) => w.stats.circulationCells)).toBe(0);
  });
});

describe('shareable parameters', () => {
  it('round-trip through the URL hash', () => {
    const params = { ...EARTH, seed: 123456, radiusKm: 7000, axialTiltDeg: 30 };
    const parsed = paramsFromHash(paramsToHash(params));
    expect(parsed).toEqual(params);
    expect(paramsFromHash('')).toBeNull();
    expect(paramsFromHash('#seed=5&radiusKm=junk')?.radiusKm).toBe(EARTH.radiusKm);
  });
});
