import { describe, expect, it } from 'vitest';
import { HYPOXIA_O2, MEGAFAUNA_GIANT_ARTHROPODS, MEGAFAUNA_HERBIVORES, aerobicScope } from '../src/sim/biosphere/fauna.ts';
import { VEG_SAVANNA, carbonGrowthFactor, fireFactor, oxygenGrowthFactor } from '../src/sim/biosphere/flora.ts';
import { CEILING_M, PLATEAU_M, airTerm, hypoxiaShiftM, oxygenPartialPressure } from '../src/sim/civilization/civilization.ts';
import { EARTH, EARTH_O2 } from '../src/sim/params.ts';
import { build, type World } from '../src/sim/pipeline.ts';
import { MINERALS, oilPreservation } from '../src/sim/resources/minerals.ts';

/** Composition (M26): every factor is exactly Earth at the defaults, and each parameter moves only what its causal path says. */

const QUICK = { ...EARTH, tectonicAge: 50 };
const options = { coarser: 1 };

function sameBytes(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
}

function countLand(w: World, pass: (i: number) => boolean): number {
  let count = 0;
  for (let i = 0; i < w.n; i++) if (w.elevation[i] >= w.seaLevel && w.lake[i] < 0 && pass(i)) count++;
  return count;
}

const countBits = (w: World, bit: number): number => countLand(w, (i) => (w.megafauna[i] & bit) !== 0);
const countDeposits = (w: World, m: number): number => {
  let count = 0;
  for (let i = 0; i < w.n; i++) if ((w.deposits[i] >> m) & 1) count++;
  return count;
};
const potentialSum = (w: World, m: number): number => {
  let sum = 0;
  for (let i = 0; i < w.n; i++) sum += w.mineralPotential[m * w.n + i];
  return sum;
};
const mineral = (name: string): number => MINERALS.indexOf(name as (typeof MINERALS)[number]);

describe('composition factors', () => {
  it('are exactly Earth at the defaults and move the right way', () => {
    expect(oxygenGrowthFactor(EARTH_O2)).toBe(1);
    expect(oxygenGrowthFactor(0.3)).toBeLessThan(1);
    expect(oxygenGrowthFactor(0.12)).toBeGreaterThan(1);
    expect(oxygenGrowthFactor(0.05)).toBeLessThanOrEqual(1.5);
    expect(carbonGrowthFactor(1)).toBe(1);
    expect(carbonGrowthFactor(2)).toBeGreaterThan(1.27);
    expect(carbonGrowthFactor(2)).toBeLessThan(1.29);
    expect(carbonGrowthFactor(0.2)).toBe(0.5);
    expect(fireFactor(EARTH_O2)).toBe(1);
    expect(fireFactor(0.3)).toBeGreaterThan(1.5);
    expect(fireFactor(0.15)).toBeLessThan(0.7);
    expect(oilPreservation(EARTH_O2)).toBe(1);
    expect(oilPreservation(0.1)).toBe(2);
    expect(oilPreservation(0.35)).toBeCloseTo(0.6, 2);
    expect(aerobicScope(EARTH_O2)).toBe(1);
    expect(aerobicScope(HYPOXIA_O2)).toBe(0);
    expect(aerobicScope(0.3)).toBe(1);
  });

  it('set the hypoxia ceiling from the oxygen partial pressure', () => {
    expect(hypoxiaShiftM(EARTH)).toBe(0);
    expect(airTerm(EARTH, 0)).toBe(1);
    expect(airTerm(EARTH, PLATEAU_M)).toBe(1);
    expect(airTerm(EARTH, CEILING_M)).toBe(0);
    expect(airTerm(EARTH, (PLATEAU_M + CEILING_M) / 2)).toBeCloseTo(0.5, 6);
    expect(oxygenPartialPressure(EARTH, 0)).toBeCloseTo(EARTH_O2, 10);
    expect(oxygenPartialPressure(EARTH, 5500)).toBeLessThan(0.11);
    expect(hypoxiaShiftM({ ...EARTH, oxygen: 0.12 })).toBeLessThan(-4000);
    expect(airTerm({ ...EARTH, oxygen: 0.12 }, 2000)).toBe(0);
    expect(airTerm({ ...EARTH, pressureBar: 0.3 }, 0)).toBe(0);
    expect(airTerm({ ...EARTH, oxygen: 0.3 }, CEILING_M)).toBeGreaterThan(0);
  });
});

describe('composition on a planet (one level coarser)', () => {
  const base = build(QUICK, () => {}, options);
  const rich = build({ ...QUICK, oxygen: 0.3 }, () => {}, options);
  const low = build({ ...QUICK, oxygen: 0.12 }, () => {}, options);
  const iron = build({ ...QUICK, crustIron: 3 }, () => {}, options);
  const metals = build({ ...QUICK, crustMetals: 3 }, () => {}, options);
  const co2 = build({ ...QUICK, greenhouse: 2 }, () => {}, options);

  it('never touches the relief or the climate', () => {
    for (const w of [rich, low, iron, metals]) {
      expect(sameBytes(w.elevation, base.elevation)).toBe(true);
      expect(w.seaLevel).toBe(base.seaLevel);
      expect(sameBytes(w.temperatureAnnual, base.temperatureAnnual)).toBe(true);
      expect(sameBytes(w.precipitation, base.precipitation)).toBe(true);
    }
  });

  it('oxygen lowers growth by photorespiration and spreads the savannas by fire', () => {
    expect(rich.stats.landNppGtC).toBeLessThan(base.stats.landNppGtC);
    expect(low.stats.landNppGtC).toBeGreaterThan(base.stats.landNppGtC);
    expect(rich.stats.vegetationShares[VEG_SAVANNA]).toBeGreaterThanOrEqual(base.stats.vegetationShares[VEG_SAVANNA]);
    expect(low.stats.vegetationShares[VEG_SAVANNA]).toBeLessThanOrEqual(base.stats.vegetationShares[VEG_SAVANNA]);
  });

  it('oxygen sets the size of the animals', () => {
    expect(countBits(rich, MEGAFAUNA_GIANT_ARTHROPODS)).toBeGreaterThan(0);
    expect(countBits(base, MEGAFAUNA_GIANT_ARTHROPODS)).toBe(0);
    expect(countBits(low, MEGAFAUNA_GIANT_ARTHROPODS)).toBe(0);
    expect(countBits(low, MEGAFAUNA_HERBIVORES)).toBeLessThan(countBits(base, MEGAFAUNA_HERBIVORES));
  });

  it('thin air empties the heights and shortens the reach of people', () => {
    const ceiling = CEILING_M + hypoxiaShiftM(low.params);
    expect(ceiling).toBeLessThan(2500);
    for (let i = 0; i < low.n; i++) {
      if (low.elevation[i] - low.seaLevel > ceiling) expect(low.habitability[i]).toBe(0);
    }
    expect(countLand(low, (i) => low.habitability[i] > 0)).toBeLessThanOrEqual(countLand(base, (i) => base.habitability[i] > 0));
    expect(low.stats.landmassesReached).toBeLessThanOrEqual(base.stats.landmassesReached);
    // Earth's own heights: only land above the plateau height loses any air.
    for (let i = 0; i < base.n; i++) {
      if (base.elevation[i] - base.seaLevel <= PLATEAU_M) expect(base.habitabilityTerms[4 * i + 3]).toBe(base.elevation[i] >= base.seaLevel && base.lake[i] < 0 && !base.iceSheet[i] ? 1 : 0);
    }
  });

  it('crustal abundances scale the ores, each its own, and keep the draw', () => {
    const fe = mineral('iron');
    const cu = mineral('copper');
    const au = mineral('gold');
    const u = mineral('uranium');
    expect(potentialSum(iron, fe)).toBeGreaterThan(potentialSum(base, fe));
    expect(countDeposits(iron, fe)).toBeGreaterThan(countDeposits(base, fe));
    for (let i = 0; i < base.n; i++) if ((base.deposits[i] >> fe) & 1) expect((iron.deposits[i] >> fe) & 1).toBe(1);
    expect(countDeposits(iron, cu)).toBe(countDeposits(base, cu));
    expect(countDeposits(metals, cu)).toBeGreaterThan(countDeposits(base, cu));
    expect(countDeposits(metals, au)).toBeGreaterThan(countDeposits(base, au));
    expect(countDeposits(metals, u)).toBeGreaterThan(countDeposits(base, u));
    expect(countDeposits(metals, fe)).toBe(countDeposits(base, fe));
  });

  it('carbon dioxide fertilizes growth', () => {
    expect(co2.stats.landNppGtC).toBeGreaterThan(base.stats.landNppGtC);
  });
});
