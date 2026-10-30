import { koppenName, precipitationAt, temperatureAt, windAt } from '../render/layers.ts';
import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { Grid, cellAreasKm2 } from '../sim/grid/grid.ts';
import type { World } from '../sim/pipeline.ts';
import { BOUNDARY_NAMES } from '../sim/tectonics/simulation.ts';

/**
 * Explain mode (DESIGN 3.7 and 8.2): the causal chain of one cell, itemized
 * from the provenance the simulator stored. Nothing here is physics; every
 * number is read from the world or is a sum of stored components.
 */

export interface Section {
  title: string;
  lines: string[];
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
  const climate: string[] = [
    `temperature ${t.toFixed(1)} °C annual (${tLo.toFixed(1)} to ${tHi.toFixed(1)} over the year)`,
    `  = global ${world.globalMeanTemperature.toFixed(1)} ${signed(balanceTerm, 1)} energy balance (sunlight, albedo, transport) ` +
      `${signed(lapseTerm, 1)} altitude ${signed(continentalTerm, 1)} continentality ${signed(current, 1)} currents`,
    `insolation  ${world.insolationAnnual[cell].toFixed(0)} W/m² annual mean at the top of the atmosphere`,
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

  return sections;
}
