import { describe, expect, it } from 'vitest';
import { VEGETATION_NAMES, VEG_DESERT, VEG_ICE, VEG_OCEAN, VEG_RAINFOREST, VEG_TUNDRA, miamiNpp } from '../src/sim/biosphere/flora.ts';
import { EARTH } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';

const QUICK = { ...EARTH, tectonicAge: 50 };
const worlds: World[] = [1, 2].map((seed) => build({ ...QUICK, seed }));

describe('flora (M22)', () => {
  it('follows the Miami model: warm and wet grows, cold or dry does not', () => {
    expect(miamiNpp(27, 2500)).toBeGreaterThan(1000);
    expect(miamiNpp(27, 2500)).toBeLessThan(1400);
    expect(miamiNpp(25, 100)).toBeLessThan(100);
    expect(miamiNpp(-10, 2000)).toBeLessThan(150);
    expect(miamiNpp(10, 700)).toBeGreaterThan(300);
    expect(miamiNpp(10, 700)).toBeLessThan(600);
  });

  it('keeps productivity, soil and vegetation consistent on Earth-like planets', () => {
    for (const w of worlds) {
      let deserts = 0;
      let desertNpp = 0;
      let forests = 0;
      let forestNpp = 0;
      for (let i = 0; i < w.n; i++) {
        const land = w.elevation[i] >= w.seaLevel && w.lake[i] < 0;
        const v = w.vegetation[i];
        expect(v).toBeLessThan(VEGETATION_NAMES.length);
        if (!land) {
          expect(v).toBe(VEG_OCEAN);
          expect(w.npp[i]).toBe(0);
          continue;
        }
        expect(v).not.toBe(VEG_OCEAN);
        expect(w.npp[i]).toBeGreaterThanOrEqual(0);
        expect(w.npp[i]).toBeLessThan(1500);
        expect(w.soil[i]).toBeGreaterThanOrEqual(0);
        expect(w.soil[i]).toBeLessThanOrEqual(1);
        if (w.iceSheet[i]) {
          expect(v).toBe(VEG_ICE);
          expect(w.npp[i]).toBe(0);
        }
        if (v === VEG_DESERT) {
          deserts++;
          desertNpp += w.npp[i];
        } else if (v === VEG_RAINFOREST) {
          forests++;
          forestNpp += w.npp[i];
        }
        // No month above 10 C: the annual mean stays single-digit (maritime tundra can reach 6 or 7).
        if (v === VEG_TUNDRA) expect(w.temperatureAnnual[i]).toBeLessThan(8);
      }
      expect(deserts).toBeGreaterThan(0);
      expect(forests).toBeGreaterThan(0);
      expect(desertNpp / deserts).toBeLessThan(150);
      expect(forestNpp / forests).toBeGreaterThan(700);
      // The land's production: Earth's 56 Gt C/yr, these planets have less land and more desert.
      expect(w.stats.landNppGtC).toBeGreaterThan(15);
      expect(w.stats.landNppGtC).toBeLessThan(90);
      const shares = w.stats.vegetationShares;
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });
});
