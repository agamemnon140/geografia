import { cloudAt, koppenName, precipitationAt, temperatureAt, windAt, type LayerGroup } from '../render/layers.ts';
import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { Grid, cellAreasKm2 } from '../sim/grid/grid.ts';
import type { World } from '../sim/pipeline.ts';
import { MEGAFAUNA_HERBIVORES, MEGAFAUNA_PREDATORS, REALM_NONE } from '../sim/biosphere/fauna.ts';
import { SOIL_BASE, SOIL_WEIGHT, SUNSHINE_REFERENCE_H, SUNSHINE_WEIGHT, VEGETATION_NAMES, miamiNpp } from '../sim/biosphere/flora.ts';
import { REALM_NAMES } from '../render/layers.ts';
import { LINEAGE_COUNT } from '../sim/tectonics/crust.ts';
import { MINERALS, MINERAL_COUNT, MINERAL_NAMES } from '../sim/resources/minerals.ts';
import { BOUNDARY_NAMES } from '../sim/tectonics/simulation.ts';

/**
 * Explain mode (DESIGN 3.7 and 8.2): the causal chain of one cell, itemized
 * from the provenance the simulator stored. Nothing here is physics; every
 * number is read from the world or is a sum of stored components.
 */

export interface Section {
  title: string;
  lines: string[];
  /** Sections beyond geography are shown only when the app's "Beyond geography" toggle is on. */
  group?: LayerGroup;
}

const RAD = 180 / Math.PI;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function sampleName(sample: number): string {
  return sample >= ANNUAL ? 'annual' : MONTHS[sample];
}

function signed(v: number, digits = 0): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function bearing(east: number, north: number): string {
  return `${(((Math.atan2(east, north) * RAD) + 360) % 360).toFixed(0)}°`;
}

function range(values: (s: number) => number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let s = 0; s < SAMPLES; s++) {
    const v = values(s);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function explainCell(world: World, cell: number, sample: number): Section[] {
  const grid = Grid.get(world.level);
  const area = cellAreasKm2(grid, world.radiusKm)[cell];
  const rel = world.elevation[cell] - world.seaLevel;
  const land = rel >= 0;
  const sections: Section[] = [];

  sections.push({
    title: `Cell ${cell}`,
    lines: [
      `${(grid.lat[cell] * RAD).toFixed(2)}°, ${(grid.lon[cell] * RAD).toFixed(2)}°, ${area.toFixed(0)} km², ${land ? 'land' : 'ocean'}`,
    ],
  });

  // Relief: the components sum to the model-frame elevation; sea level is subtracted at the end.
  const orogeny = world.orogenyStep[cell];
  const relief: string[] = [
    `${signed(rel)} m relative to the sea`,
    `  = crust ${world.elevationCrust[cell].toFixed(0)} + volcanic ${world.elevationVolcanic[cell].toFixed(0)} + sediment ${world.elevationSediment[cell].toFixed(0)}` +
      `${world.elevationTrench[cell] !== 0 ? ` + trench ${world.elevationTrench[cell].toFixed(0)}` : ''} − sea level ${world.seaLevel.toFixed(0)}`,
    `crust       ${world.crustType[cell] === 1 ? 'continental' : 'oceanic'}, ${world.thickness[cell].toFixed(1)} km, ${world.crustAge[cell].toFixed(0)} steps old`,
    `plate       #${world.plate[cell]}, ${BOUNDARY_NAMES[world.boundary[cell]]}`,
    `orogeny     ${orogeny >= 0 ? `step ${orogeny} (${world.steps - orogeny} steps ago)` : 'none'}`,
    `volcanic    ${world.volcanic[cell].toFixed(2)} km of rock${world.hotspots.includes(cell) ? ' (over a hotspot now)' : ''}`,
    `eroded      ${world.eroded[cell].toFixed(0)} m of surface over the crust's life, ${world.sediment[cell].toFixed(2)} km of sediment received`,
  ];
  sections.push({ title: 'Relief', lines: relief });

  // Water.
  const [pLo, pHi] = range((s) => precipitationAt(world, cell, s));
  const p = world.precipitation[cell];
  const oro = world.precipitationOrographic[cell];
  const conv = world.precipitationConvergence[cell];
  const lakeId = world.lake[cell];
  const mouthLake = world.lake[world.mouth[cell]];
  let drainsTo: string;
  if (!land) drainsTo = 'is ocean';
  else if (mouthLake >= 0) drainsTo = `lake #${mouthLake}${world.lakes[mouthLake].endorheic ? ' (closed basin)' : ''}`;
  else if (world.downstream[cell] < 0 && lakeId < 0) drainsTo = 'nowhere (pit)';
  else drainsTo = 'the ocean';
  const water: string[] = [
    `precip      ${p.toFixed(0)} mm/yr (${pLo.toFixed(0)} to ${pHi.toFixed(0)} over the year)`,
    `  = advected ${(p - oro - conv).toFixed(0)} + orographic ${oro.toFixed(0)} + convergence ${conv.toFixed(0)}`,
    `evaporation ${world.evaporation[cell].toFixed(0)} mm/yr`,
  ];
  if (land) {
    water.push(
      `discharge   ${world.discharge[cell].toFixed(1)} km³/yr, ${world.riverLength[cell].toFixed(0)} km from the farthest source, drains to ${drainsTo}`,
    );
    if (lakeId >= 0) {
      const lake = world.lakes[lakeId];
      water.push(
        `lake        #${lakeId}, ${(world.waterLevel[cell] - world.elevation[cell]).toFixed(0)} m deep here, surface ${(lake.level - world.seaLevel).toFixed(0)} m, ` +
          `${lake.areaKm2.toFixed(0)} km², inflow ${lake.inflowKm3.toFixed(1)} km³/yr${lake.endorheic ? ', closed basin (evaporation wins)' : ', overflows'}`,
      );
    }
  } else {
    water.push(`discharge   ${world.discharge[cell].toFixed(1)} km³/yr received from rivers`);
  }
  sections.push({ title: 'Water', lines: water });

  // Climate: the annual mean is the global mean plus stored terms; the ice albedo is the remainder.
  const [tLo, tHi] = range((s) => temperatureAt(world, cell, s));
  const t = world.temperatureAnnual[cell];
  const balanceTerm = world.temperatureBalance[cell];
  const lapseTerm = world.temperatureLapse[cell];
  const continentalTerm = world.temperatureContinental[cell];
  const current = world.sstAnomaly[cell];
  const [u, v] = windAt(world, cell, sample);
  const [cLo, cHi] = range((s) => cloudAt(world, cell, s));
  const sun = world.sunshineHours[cell];
  const climate: string[] = [
    `temperature ${t.toFixed(1)} °C annual (${tLo.toFixed(1)} to ${tHi.toFixed(1)} over the year)`,
    `  = global ${world.globalMeanTemperature.toFixed(1)} ${signed(balanceTerm, 1)} energy balance (sunlight, clouds, albedo, transport) ` +
      `${signed(lapseTerm, 1)} altitude ${signed(continentalTerm, 1)} continentality ${signed(current, 1)} currents`,
    `insolation  ${world.insolationAnnual[cell].toFixed(0)} W/m² annual mean at the top of the atmosphere`,
    `sunshine    ${Math.round(sun).toLocaleString('en-US')} h/yr (${Math.round(sun / 12)} clear-day equivalents), ` +
      `clouds ${(100 * world.cloudAnnual[cell]).toFixed(0)}% (${(100 * cLo).toFixed(0)} to ${(100 * cHi).toFixed(0)}% over the year)`,
    `wind        ${sampleName(sample)}: ${Math.hypot(u, v).toFixed(1)} m/s toward ${bearing(u, v)}`,
  ];
  if (world.basin[cell] >= 0) {
    const cu = world.currentU[cell];
    const cv = world.currentV[cell];
    climate.push(`current     ${Math.hypot(cu, cv).toFixed(2)} m/s toward ${bearing(cu, cv)}, basin #${world.basin[cell]}`);
  }
  sections.push({ title: 'Climate', lines: climate });

  // Biome.
  const months = world.seaIceMonths[cell];
  const biome: string[] = [];
  if (land) biome.push(`Koppen      ${koppenName(world, cell)}`);
  biome.push(
    `ice         ${world.iceSheet[cell] ? 'ice sheet' : months >= SAMPLES ? 'sea ice all year' : months > 0 ? `sea ice ${months} months a year` : 'none'}`,
  );
  sections.push({ title: 'Biome', lines: biome });

  // Resources (M21): each potential with the provenance behind it.
  const n = world.n;
  const bits = world.deposits[cell];
  const resources: string[] = [];
  for (let m = 0; m < MINERAL_COUNT; m++) {
    const p = world.mineralPotential[m * n + cell];
    const has = (bits >> m) & 1;
    if (p < 0.005 && !has) continue;
    resources.push(`${MINERAL_NAMES[MINERALS[m]].padEnd(13)}${has ? 'deposit; ' : ''}potential ${p.toFixed(2)}`);
  }
  if (resources.length === 0) {
    resources.push(world.reference ? 'no measured deposit here' : 'none: no shield, arc, collision belt, swamp, shallow sea or salt pan in this cell\'s history');
  }
  if (!world.reference) {
    resources.push(
      `history     swamp sediment ${world.coal[cell].toFixed(2)} km, shallow-sea sediment ${world.oil[cell].toFixed(2)} km, evaporite ${world.salt[cell].toFixed(3)} km`,
    );
  }
  sections.push({ title: 'Resources', lines: resources, group: 'resources' });

  // Flora (M22): productivity itemized, the soil's terms, the vegetation class.
  if (land) {
    const flora: string[] = [];
    if (world.iceSheet[cell]) flora.push('ice sheet: no soil, no growth');
    else {
      const base = miamiNpp(t, p);
      const sunFactor = 1 + SUNSHINE_WEIGHT * Math.max(-1, Math.min(1, (sun - SUNSHINE_REFERENCE_H) / SUNSHINE_REFERENCE_H));
      const soilFactor = 1 - SOIL_WEIGHT / 2 + SOIL_WEIGHT * world.soil[cell];
      flora.push(
        `growth      ${world.npp[cell].toFixed(0)} g C/m²/yr = Miami ${base.toFixed(0)} (the lesser of warmth and rain) × sun ${sunFactor.toFixed(2)} × soil ${soilFactor.toFixed(2)}`,
        `soil        ${world.soil[cell].toFixed(2)} = base ${SOIL_BASE} + ash ${world.soilAsh[cell].toFixed(2)} + alluvium ${world.soilAlluvium[cell].toFixed(2)} − losses ${world.soilLoss[cell].toFixed(2)} (leaching, old shield, cold)`,
        `vegetation  ${VEGETATION_NAMES[world.vegetation[cell]]}`,
      );
    }
    sections.push({ title: 'Flora', lines: flora, group: 'life' });

    // Fauna (M23): the lineages, where they came from, and what they support.
    const fauna: string[] = [];
    const shares: string[] = [];
    for (let k = 0; k < LINEAGE_COUNT; k++) {
      const v = world.lineage[cell * LINEAGE_COUNT + k];
      if (v >= 0.05) shares.push(`${REALM_NAMES[k]} ${(100 * v).toFixed(0)}%`);
    }
    const realm = world.realm[cell];
    const mass = world.landmass[cell];
    const area = mass >= 0 ? world.landmassAreas[mass] : 0;
    fauna.push(
      `realm       ${realm === REALM_NONE ? 'none' : REALM_NAMES[realm]}${shares.length ? ` (lineages: ${shares.join(', ')})` : ''}${world.reference ? '; by present connectivity, no history' : ''}`,
      `endemism    ${world.endemism[cell].toFixed(2)}: share of this fauna found on no other landmass`,
      `richness    ${world.richness[cell].toFixed(2)} = growth term × landmass term (${area >= 1e6 ? `${(area / 1e6).toFixed(1)} million` : area.toFixed(0)} km²)`,
      `megafauna   ${world.megafauna[cell] & MEGAFAUNA_PREDATORS ? 'large herbivores and large predators' : world.megafauna[cell] & MEGAFAUNA_HERBIVORES ? 'large herbivores, no large predators (the landmass is too small)' : 'none: too little growth or too small a landmass'}`,
    );
    sections.push({ title: 'Fauna', lines: fauna, group: 'life' });
  }

  return sections;
}
