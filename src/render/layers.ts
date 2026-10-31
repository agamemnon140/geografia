import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { KOPPEN_NAMES } from '../sim/climate/koppen.ts';
import type { World } from '../sim/pipeline.ts';
import { MEGAFAUNA_GIANT_ARTHROPODS, MEGAFAUNA_HERBIVORES, MEGAFAUNA_PREDATORS, REALM_NONE } from '../sim/biosphere/fauna.ts';
import { UNREACHED } from '../sim/civilization/civilization.ts';
import { VEGETATION_NAMES } from '../sim/biosphere/flora.ts';
import { LINEAGE_COUNT } from '../sim/tectonics/crust.ts';
import { MINERALS, MINERAL_COUNT, MINERAL_NAMES } from '../sim/resources/minerals.ts';
import {
  BOUNDARY_CONVERGENT,
  BOUNDARY_DIVERGENT,
  BOUNDARY_SUBDUCTING,
  BOUNDARY_TRANSFORM,
} from '../sim/tectonics/simulation.ts';
import { cellDebugColor, hypsometric, mix, ramp, type RGB, type Stop } from './colors.ts';
import type { PixelSampler } from './paint.ts';
import type { Raster } from './raster.ts';

/** What a layer's colors mean, for the legend (DESIGN 8.4). */
export type Legend =
  | { kind: 'ramp'; stops: Stop[]; unit: string }
  /** One swatch per item, or a row of swatches (`colors`) for a family of shades. */
  | { kind: 'categories'; items: { color: RGB; colors?: RGB[]; label: string }[] }
  | { kind: 'text'; items: string[] };

/**
 * A map layer. `cellColor` is the flat color of a cell (thumbnails, tests,
 * fallback); `smooth` colors a pixel from interpolated fields (DESIGN 8.5)
 * and is what the map and the globe use. `relief` asks for a hillshade,
 * `rivers` for the drainage network drawn as lines. Seasonal layers take a
 * sample index (0 to 11) or ANNUAL.
 */
/** Where a layer belongs in the UI: geography is always on, the rest behind the "Beyond geography" toggle (M21). */
export type LayerGroup = 'geography' | 'resources' | 'life' | 'civilization';

/** A point symbol drawn over the paint (a deposit, a site). */
export interface Mark {
  cell: number;
  color: RGB;
}

/** A short text drawn beside a cell by the interactive views (the command-line renderer has no text). */
export interface Label {
  cell: number;
  text: string;
}

export interface Layer {
  id: string;
  name: string;
  /** Default geography. */
  group?: LayerGroup;
  /** True when the layer changes with the sample (month) selector. */
  seasonal?: boolean;
  legend?: Legend;
  relief?: boolean | 'light';
  rivers?: boolean;
  cellColor(world: World, cell: number, sample: number): RGB;
  smooth?(world: World, px: PixelSampler, sample: number): RGB;
  /** Point symbols drawn after the paint and the rivers. */
  marks?(world: World): Mark[];
  /** Texts drawn beside cells by the interactive views. */
  labels?(world: World): Label[];
}

/** Layers of a group, for the UI's dropdowns. */
export function layersOfGroup(group: LayerGroup): Layer[] {
  return LAYERS.filter((l) => (l.group ?? 'geography') === group);
}

/** Pixels whose raster entry is -1 (outside the globe) get this. */
const BACKGROUND: RGB = [20, 22, 26];

const TEMPERATURE_RAMP: Stop[] = [
  [-40, [60, 0, 90]],
  [-20, [50, 60, 190]],
  [-5, [90, 170, 230]],
  [5, [170, 225, 200]],
  [15, [200, 220, 90]],
  [25, [240, 150, 50]],
  [35, [200, 40, 30]],
  [45, [120, 0, 20]],
];

/** Temperature of a cell for a sample index or ANNUAL. */
export function temperatureAt(world: World, cell: number, sample: number): number {
  return sample >= ANNUAL ? world.temperatureAnnual[cell] : world.temperature[sample * world.n + cell];
}

/** Wind of a cell (east, north, m/s) for a sample index; ANNUAL averages the samples. */
export function windAt(world: World, cell: number, sample: number): [number, number] {
  if (sample < ANNUAL) return [world.windU[sample * world.n + cell], world.windV[sample * world.n + cell]];
  let u = 0;
  let v = 0;
  for (let s = 0; s < ANNUAL; s++) {
    u += world.windU[s * world.n + cell];
    v += world.windV[s * world.n + cell];
  }
  return [u / ANNUAL, v / ANNUAL];
}

/** Interpolated wind at a pixel; ANNUAL averages the samples. */
function windSmooth(world: World, px: PixelSampler, sample: number): [number, number] {
  if (sample < ANNUAL) {
    const base = sample * world.n;
    return [px.interp(world.windU.subarray(base, base + world.n)), px.interp(world.windV.subarray(base, base + world.n))];
  }
  let u = 0;
  let v = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const base = s * world.n;
    u += px.interp(world.windU.subarray(base, base + world.n));
    v += px.interp(world.windV.subarray(base, base + world.n));
  }
  return [u / SAMPLES, v / SAMPLES];
}

/** Flow direction as a hue (toward east = red, north = yellow-green, west = cyan, south = violet), speed as brightness. */
function directionColor(u: number, v: number, fullSpeed: number, dim: number): RGB {
  const speed = Math.hypot(u, v);
  const hue = ((Math.atan2(v, u) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  const value = Math.min(1, 0.25 + speed / fullSpeed) * dim;
  return hsvColor(hue, 0.85, value);
}

function hsvColor(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}

const BOUNDARY_COLORS: Record<number, RGB> = {
  [BOUNDARY_DIVERGENT]: [255, 70, 70],
  [BOUNDARY_CONVERGENT]: [30, 30, 30],
  [BOUNDARY_SUBDUCTING]: [255, 210, 0],
  [BOUNDARY_TRANSFORM]: [90, 255, 140],
};

const AGE_RAMP: Stop[] = [
  [0, [255, 245, 150]],
  [30, [255, 170, 60]],
  [70, [200, 70, 60]],
  [110, [120, 30, 90]],
  [150, [40, 10, 60]],
];

const THICKNESS_RAMP: Stop[] = [
  [5, [30, 40, 90]],
  [20, [70, 110, 150]],
  [35, [110, 160, 110]],
  [50, [220, 180, 90]],
  [70, [255, 255, 255]],
];

const PRECIPITATION_RAMP: Stop[] = [
  [0, [245, 235, 200]],
  [250, [225, 205, 140]],
  [500, [180, 200, 120]],
  [1000, [90, 170, 110]],
  [1500, [40, 130, 140]],
  [2200, [20, 70, 130]],
  [3500, [40, 20, 90]],
];

const ANOMALY_RAMP: Stop[] = [
  [-8, [20, 40, 160]],
  [-3, [90, 150, 220]],
  [0, [235, 235, 235]],
  [3, [240, 140, 90]],
  [8, [170, 20, 30]],
];

const ICE_SHEET: RGB = [245, 248, 255];
const SEA_ICE: RGB = [215, 232, 245];

/**
 * Koppen colors by family, indexed like KOPPEN_NAMES: one hue per main
 * group (A deep forest greens, B reds and oranges, C yellow-greens and
 * olives, D purples, E grays), the second and third letters as lightness
 * steps, lighter when drier or colder. Blue is kept for water. The
 * textbook palette of Peel et al. (2007) spreads thirty saturated hues
 * that blur at this scale; here a glance gives the group and the legend or
 * the inspector gives the subtype.
 */
export const KOPPEN_COLORS: RGB[] = [
  [70, 82, 100],
  [0, 88, 40], [20, 130, 60], [75, 168, 85],
  [215, 45, 35], [235, 135, 120], [235, 145, 35], [245, 205, 120],
  [175, 168, 40], [200, 195, 85], [222, 218, 140],
  [120, 160, 35], [155, 185, 70], [190, 210, 120],
  [140, 180, 55], [170, 200, 90], [200, 220, 135],
  [140, 55, 150], [165, 95, 175], [190, 135, 200], [215, 175, 225],
  [105, 50, 165], [135, 90, 195], [165, 130, 215], [195, 170, 235],
  [75, 45, 145], [105, 85, 175], [140, 125, 200], [175, 165, 225],
  [185, 185, 185], [240, 240, 245],
];

/** The sea on the Koppen layer: bathymetry pulled toward slate, so the land carries the color. */
const KOPPEN_SEA: RGB = [88, 98, 114];

function koppenSea(rel: number): RGB {
  return mix(hypsometric(rel), KOPPEN_SEA, 0.6);
}

/** Koppen name of a cell. */
export function koppenName(world: World, cell: number): string {
  return KOPPEN_NAMES[world.koppen[cell]] ?? 'unknown';
}

/** Precipitation of a cell for a sample index or ANNUAL, mm per year. */
export function precipitationAt(world: World, cell: number, sample: number): number {
  return sample >= ANNUAL ? world.precipitation[cell] : world.precipitationSamples[sample * world.n + cell];
}

/** Cloud cover of a cell for a sample index or ANNUAL, 0 to 1. */
export function cloudAt(world: World, cell: number, sample: number): number {
  return sample >= ANNUAL ? world.cloudAnnual[cell] : world.cloud[sample * world.n + cell];
}

/** Sunshine hours per year: slate under permanent cloud, gold where the sky is clear. */
const SUNSHINE_RAMP: Stop[] = [
  [1000, [70, 85, 120]],
  [1600, [120, 140, 170]],
  [2200, [200, 205, 205]],
  [2800, [240, 230, 170]],
  [3400, [245, 200, 90]],
  [4000, [235, 140, 40]],
];

/** Cloud cover, percent of the sky: deep sky blue when clear, white when overcast. */
const CLOUD_RAMP: Stop[] = [
  [0, [40, 110, 200]],
  [50, [150, 160, 175]],
  [100, [245, 245, 248]],
];

/** Mineral colors in MINERALS order: rust, copper, gold, lime, black, violet, white. */
export const MINERAL_COLORS: RGB[] = [
  [175, 55, 35],
  [220, 125, 45],
  [245, 200, 40],
  [150, 215, 60],
  [25, 25, 28],
  [130, 70, 170],
  [245, 240, 245],
];

/** Productivity: parchment through greens to the darkest forest. */
const NPP_RAMP: Stop[] = [
  [0, [235, 225, 195]],
  [100, [215, 210, 150]],
  [300, [170, 190, 100]],
  [600, [95, 160, 70]],
  [900, [40, 120, 55]],
  [1200, [10, 70, 35]],
];

/** Soil: pale gray through ochre to dark loam. */
const SOIL_RAMP: Stop[] = [
  [0, [210, 205, 195]],
  [0.3, [205, 175, 120]],
  [0.6, [150, 110, 60]],
  [1, [70, 45, 25]],
];

/** Vegetation colors in VEGETATION_NAMES order: no blues (water keeps them), forests green, grass yellow, dry sand, cold gray. */
export const VEGETATION_COLORS: RGB[] = [
  [88, 98, 114],
  [240, 240, 245],
  [170, 175, 165],
  [45, 95, 85],
  [70, 140, 70],
  [30, 110, 90],
  [215, 200, 110],
  [150, 150, 60],
  [200, 175, 110],
  [235, 210, 160],
  [190, 190, 70],
  [95, 165, 60],
  [20, 95, 40],
  [90, 160, 140],
];

/** The eight ancestral faunas, named by the colors that draw them (no blues). */
export const REALM_NAMES: string[] = ['crimson', 'orange', 'gold', 'olive', 'green', 'teal', 'violet', 'rose'];
export const REALM_COLORS: RGB[] = [
  [190, 40, 60],
  [235, 130, 40],
  [240, 200, 50],
  [140, 150, 40],
  [50, 150, 70],
  [40, 150, 140],
  [130, 80, 180],
  [225, 120, 160],
];
const ENDEMISM_RAMP: Stop[] = [
  [0, [225, 222, 215]],
  [0.5, [205, 130, 170]],
  [1, [120, 20, 90]],
];
const RICHNESS_RAMP: Stop[] = [
  [0, [225, 222, 215]],
  [0.3, [200, 190, 110]],
  [0.6, [160, 120, 50]],
  [1, [90, 40, 20]],
];
const MEGAFAUNA_NONE: RGB = [215, 212, 205];
const MEGAFAUNA_HERBIVORE_COLOR: RGB = [210, 170, 90];
const MEGAFAUNA_PREDATOR_COLOR: RGB = [150, 60, 40];
/** Giant arthropods (M26, oxygen above 27 %) tint the cell toward violet. */
const MEGAFAUNA_ARTHROPOD_TINT: RGB = [120, 60, 160];

const HABITABILITY_RAMP: Stop[] = [
  [0, [225, 222, 215]],
  [0.5, [230, 180, 100]],
  [1, [170, 40, 30]],
];
const FARM_RAMP: Stop[] = [
  [0, [225, 222, 215]],
  [0.4, [220, 200, 90]],
  [1, [90, 120, 20]],
];
const CITY_RAMP: Stop[] = [
  [0, [225, 222, 215]],
  [0.3, [200, 170, 140]],
  [0.6, [150, 90, 90]],
  [1, [60, 20, 60]],
];
/** Arrival of people, thousands of years after the origin. */
const ARRIVAL_RAMP: Stop[] = [
  [0, [255, 240, 120]],
  [20, [240, 150, 50]],
  [50, [170, 50, 40]],
  [100, [60, 20, 50]],
];
const UNREACHED_COLOR: RGB = [150, 150, 150];
const CITY_MARK: RGB = [255, 255, 255];
const ORIGIN_MARK: RGB = [255, 240, 120];

const LAKE_COLOR: RGB = [40, 120, 210];
export const RIVER_COLOR: RGB = [20, 70, 190];
const LAND_WASH: RGB = [240, 236, 226];
/** Discharge at which a river starts to show, km^3 per year (a basin of roughly ten cells). */
export const RIVER_MIN_KM3 = 40;
/** Discharge drawn at full strength in the flat cell painter. */
const RIVER_FULL_KM3 = 4000;
/** Interpolated lake depth above which a pixel is lake water, meters. */
const LAKE_DEPTH_M = 0.5;

function plateColor(plate: number): RGB {
  return cellDebugColor(plate * 17 + 3);
}

/** Elevation legend: bathymetry below zero, hypsometric tints above (the same stops the painter uses). */
const ELEVATION_LEGEND: Stop[] = [
  [-6000, hypsometric(-6000)],
  [-3000, hypsometric(-3000)],
  [-1000, hypsometric(-1000)],
  [0, hypsometric(0)],
  [500, hypsometric(500)],
  [1500, hypsometric(1500)],
  [3000, hypsometric(3000)],
  [5000, hypsometric(5000)],
];

const DIRECTION_LEGEND = [
  'hue is the direction the flow goes to:',
  'red east, yellow-green north, cyan west, violet south',
];

/** Interpolated elevation relative to the sea at a pixel. */
function relief(world: World, px: PixelSampler): number {
  return px.interp(world.elevation) - world.seaLevel;
}

function dim(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export const LAYERS: Layer[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    legend: { kind: 'ramp', stops: ELEVATION_LEGEND, unit: 'm above sea level' },
    relief: true,
    rivers: true,
    cellColor: (world, i) => hypsometric(world.elevation[i] - world.seaLevel),
    smooth: (world, px) => hypsometric(relief(world, px)),
  },
  {
    id: 'koppen',
    name: 'Koppen climate',
    legend: {
      kind: 'categories',
      items: [
        { color: KOPPEN_COLORS[2], colors: KOPPEN_COLORS.slice(1, 4), label: 'Tropical, hot all year (deep greens): rainforest, monsoon, savanna with a dry season' },
        { color: KOPPEN_COLORS[4], colors: KOPPEN_COLORS.slice(4, 8), label: 'Dry (reds and oranges): hot desert, cold desert, hot steppe, cold steppe' },
        { color: KOPPEN_COLORS[14], colors: [KOPPEN_COLORS[8], KOPPEN_COLORS[11], KOPPEN_COLORS[14], KOPPEN_COLORS[16]], label: 'Mild winters (yellow-greens): dry-summer Mediterranean, dry-winter, rainy all year; paler where summers are cool' },
        { color: KOPPEN_COLORS[26], colors: [KOPPEN_COLORS[17], KOPPEN_COLORS[21], KOPPEN_COLORS[25], KOPPEN_COLORS[28]], label: 'Cold winters, real summers (purples): forests of the north; paler where winters are harsher' },
        { color: KOPPEN_COLORS[29], colors: [KOPPEN_COLORS[29], KOPPEN_COLORS[30]], label: 'Polar: tundra (gray, no month above 10 °C), ice cap (white, never above freezing)' },
        { color: KOPPEN_SEA, label: 'Sea (blue is kept for water)' },
      ],
    },
    relief: 'light',
    cellColor: (world, i) => {
      if (world.elevation[i] < world.seaLevel) return koppenSea(world.elevation[i] - world.seaLevel);
      return KOPPEN_COLORS[world.koppen[i]] ?? [0, 0, 0];
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel < 0) return koppenSea(rel);
      return KOPPEN_COLORS[world.koppen[px.cell]] ?? [0, 0, 0];
    },
  },
  {
    id: 'ice',
    name: 'Ice',
    legend: {
      kind: 'categories',
      items: [
        { color: ICE_SHEET, label: 'ice sheet' },
        { color: SEA_ICE, label: 'sea ice all year' },
        { color: mix([36, 86, 160], SEA_ICE, 0.5), label: 'seasonal sea ice (paler with more months)' },
      ],
    },
    relief: 'light',
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel >= 0) return world.iceSheet[i] ? ICE_SHEET : mix(hypsometric(rel), LAND_WASH, 0.3);
      const months = world.seaIceMonths[i];
      if (months === 0) return hypsometric(rel);
      return mix(hypsometric(rel), SEA_ICE, 0.35 + 0.65 * (months / SAMPLES));
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel >= 0) return world.iceSheet[px.cell] ? ICE_SHEET : mix(hypsometric(rel), LAND_WASH, 0.3);
      const months = px.interp(world.seaIceMonths);
      if (months < 0.25) return hypsometric(rel);
      return mix(hypsometric(rel), SEA_ICE, 0.35 + 0.65 * Math.min(1, months / SAMPLES));
    },
  },
  {
    id: 'rivers',
    name: 'Rivers and lakes',
    legend: {
      kind: 'categories',
      items: [
        { color: LAKE_COLOR, label: 'lake' },
        { color: RIVER_COLOR, label: `river, from ${RIVER_MIN_KM3} km³/yr; wider with discharge` },
      ],
    },
    relief: 'light',
    rivers: true,
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel < 0) return hypsometric(rel);
      if (world.lake[i] >= 0) return LAKE_COLOR;
      const land = mix(hypsometric(rel), LAND_WASH, 0.45);
      const q = world.discharge[i];
      if (q < RIVER_MIN_KM3) return land;
      const t = Math.min(1, Math.log(q / RIVER_MIN_KM3) / Math.log(RIVER_FULL_KM3 / RIVER_MIN_KM3));
      return mix(land, RIVER_COLOR, 0.4 + 0.6 * t);
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel < 0) return hypsometric(rel);
      if (px.interp(world.waterLevel) - px.interp(world.elevation) > LAKE_DEPTH_M) return LAKE_COLOR;
      return mix(hypsometric(rel), LAND_WASH, 0.45);
    },
  },
  {
    id: 'temperature',
    name: 'Temperature',
    seasonal: true,
    legend: { kind: 'ramp', stops: TEMPERATURE_RAMP, unit: '°C' },
    cellColor: (world, i, sample) => {
      const c = ramp(TEMPERATURE_RAMP, temperatureAt(world, i, sample));
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.75, c[1] * 0.75, c[2] * 0.8];
    },
    smooth: (world, px, sample) => {
      const c = ramp(TEMPERATURE_RAMP, px.interpSeasonal(world.temperature, world.temperatureAnnual, world.n, sample));
      return relief(world, px) >= 0 ? c : [c[0] * 0.75, c[1] * 0.75, c[2] * 0.8];
    },
  },
  {
    id: 'wind',
    name: 'Surface wind (hue = direction)',
    seasonal: true,
    legend: { kind: 'text', items: DIRECTION_LEGEND.concat('brightness: speed, full at 10 m/s') },
    cellColor: (world, i, sample) => {
      const [u, v] = windAt(world, i, sample);
      return directionColor(u, v, 10, world.elevation[i] >= world.seaLevel ? 1 : 0.7);
    },
    smooth: (world, px, sample) => {
      const [u, v] = windSmooth(world, px, sample);
      return directionColor(u, v, 10, relief(world, px) >= 0 ? 1 : 0.7);
    },
  },
  {
    id: 'precipitation',
    name: 'Precipitation',
    seasonal: true,
    legend: { kind: 'ramp', stops: PRECIPITATION_RAMP, unit: 'mm/yr' },
    cellColor: (world, i, sample) => {
      const c = ramp(PRECIPITATION_RAMP, precipitationAt(world, i, sample));
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
    smooth: (world, px, sample) => {
      const c = ramp(PRECIPITATION_RAMP, px.interpSeasonal(world.precipitationSamples, world.precipitation, world.n, sample));
      return relief(world, px) >= 0 ? c : [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
  },
  {
    id: 'sunshine',
    name: 'Sunshine',
    legend: { kind: 'ramp', stops: SUNSHINE_RAMP, unit: 'hours of sun per year (÷ 12 ≈ clear days: 1,200 h ≈ 100, 3,600 h ≈ 300)' },
    relief: 'light',
    cellColor: (world, i) => {
      const c = ramp(SUNSHINE_RAMP, world.sunshineHours[i]);
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
    smooth: (world, px) => {
      const c = ramp(SUNSHINE_RAMP, px.interp(world.sunshineHours));
      return relief(world, px) >= 0 ? c : [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    },
  },
  {
    id: 'cloud',
    name: 'Cloud cover',
    seasonal: true,
    legend: { kind: 'ramp', stops: CLOUD_RAMP, unit: '% of the sky covered' },
    cellColor: (world, i, sample) => {
      const c = ramp(CLOUD_RAMP, 100 * cloudAt(world, i, sample));
      if (world.elevation[i] >= world.seaLevel) return c;
      return [c[0] * 0.7, c[1] * 0.7, c[2] * 0.75];
    },
    smooth: (world, px, sample) => {
      const c = ramp(CLOUD_RAMP, 100 * px.interpSeasonal(world.cloud, world.cloudAnnual, world.n, sample));
      return relief(world, px) >= 0 ? c : [c[0] * 0.7, c[1] * 0.7, c[2] * 0.75];
    },
  },
  {
    id: 'currents',
    name: 'Ocean currents (hue = direction)',
    legend: { kind: 'text', items: DIRECTION_LEGEND.concat('brightness: speed, full at 0.5 m/s') },
    cellColor: (world, i) => {
      if (world.basin[i] < 0) return [70, 70, 70];
      return directionColor(world.currentU[i], world.currentV[i], 0.5, 1);
    },
    smooth: (world, px) => {
      if (relief(world, px) >= 0) return [70, 70, 70];
      return directionColor(px.interp(world.currentU), px.interp(world.currentV), 0.5, 1);
    },
  },
  {
    id: 'sstAnomaly',
    name: 'Current heat transport',
    legend: { kind: 'ramp', stops: ANOMALY_RAMP, unit: '°C carried by currents' },
    cellColor: (world, i) => {
      const c = ramp(ANOMALY_RAMP, world.sstAnomaly[i]);
      return world.basin[i] >= 0 ? c : dim(c, 0.6);
    },
    smooth: (world, px) => {
      const c = ramp(ANOMALY_RAMP, px.interp(world.sstAnomaly));
      return relief(world, px) < 0 ? c : dim(c, 0.6);
    },
  },
  {
    id: 'plates',
    name: 'Plates and boundaries',
    legend: {
      kind: 'categories',
      items: [
        { color: BOUNDARY_COLORS[BOUNDARY_DIVERGENT], label: 'divergent (ridge, rift)' },
        { color: BOUNDARY_COLORS[BOUNDARY_CONVERGENT], label: 'convergent, overriding side' },
        { color: BOUNDARY_COLORS[BOUNDARY_SUBDUCTING], label: 'convergent, subducting side (trench)' },
        { color: BOUNDARY_COLORS[BOUNDARY_TRANSFORM], label: 'transform' },
        { color: plateColor(3), label: 'one color per plate, darker under the sea' },
      ],
    },
    cellColor: (world, i) => {
      const b = world.boundary[i];
      if (b !== 0) return BOUNDARY_COLORS[b];
      return dim(plateColor(world.plate[i]), world.elevation[i] >= world.seaLevel ? 1 : 0.55);
    },
    smooth: (world, px) => {
      const b = world.boundary[px.cell];
      if (b !== 0) return BOUNDARY_COLORS[b];
      return dim(plateColor(world.plate[px.cell]), relief(world, px) >= 0 ? 1 : 0.55);
    },
  },
  {
    id: 'crustAge',
    name: 'Crust age (oceanic)',
    legend: { kind: 'ramp', stops: AGE_RAMP, unit: 'steps since the sea floor formed (continents gray)' },
    cellColor: (world, i) => (world.crustType[i] === 1 ? [110, 110, 110] : ramp(AGE_RAMP, world.crustAge[i])),
    smooth: (world, px) => (world.crustType[px.cell] === 1 ? [110, 110, 110] : ramp(AGE_RAMP, px.interp(world.crustAge))),
  },
  {
    id: 'thickness',
    name: 'Crust thickness',
    legend: { kind: 'ramp', stops: THICKNESS_RAMP, unit: 'km' },
    cellColor: (world, i) => ramp(THICKNESS_RAMP, world.thickness[i]),
    smooth: (world, px) => ramp(THICKNESS_RAMP, px.interp(world.thickness)),
  },
  {
    id: 'cells',
    name: 'Grid cells (debug)',
    cellColor: (_world, i) => cellDebugColor(i),
  },
  // Resources (M21): every deposit over a muted relief, then one layer per mineral with its potential.
  {
    id: 'minerals',
    name: 'Mineral deposits (all)',
    group: 'resources',
    legend: {
      kind: 'categories',
      items: MINERALS.map((m, k) => ({ color: MINERAL_COLORS[k], label: MINERAL_NAMES[m] })).concat([
        { color: LAND_WASH, label: 'deposits are drawn from the potential: dense where it is high, sparse where it is low; the real Earth shows measured deposits where data is shipped' },
      ]),
    },
    relief: 'light',
    cellColor: (world, i) => mutedLand(world.elevation[i] - world.seaLevel),
    smooth: (world, px) => mutedLand(relief(world, px)),
    marks: (world) => allDepositMarks(world),
  },
  ...MINERALS.map((m, k): Layer => ({
    id: `mineral-${m}`,
    name: `${MINERAL_NAMES[m][0].toUpperCase()}${MINERAL_NAMES[m].slice(1)} potential`,
    group: 'resources',
    legend: { kind: 'ramp', stops: mineralRamp(k), unit: `potential 0 to 1; dots are ${MINERAL_NAMES[m]} deposits` },
    relief: 'light',
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel < 0 && m !== 'oil') return mutedLand(rel);
      return mix(mutedLand(rel), MINERAL_COLORS[k], 0.85 * world.mineralPotential[k * world.n + i]);
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel < 0 && m !== 'oil') return mutedLand(rel);
      const base = k * world.n;
      return mix(mutedLand(rel), MINERAL_COLORS[k], 0.85 * px.interp(world.mineralPotential.subarray(base, base + world.n)));
    },
    marks: (world) => depositMarks(world, k),
  })),
  // Life (M22): productivity, soil and vegetation.
  {
    id: 'npp',
    name: 'Primary productivity',
    group: 'life',
    legend: { kind: 'ramp', stops: NPP_RAMP, unit: 'g C/m²/yr (deserts under 50, rainforests above 1,000)' },
    relief: 'light',
    cellColor: (world, i) => (world.elevation[i] < world.seaLevel ? koppenSea(world.elevation[i] - world.seaLevel) : world.lake[i] >= 0 ? LAKE_COLOR : ramp(NPP_RAMP, world.npp[i])),
    smooth: (world, px) => {
      const rel = relief(world, px);
      return rel < 0 ? koppenSea(rel) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(NPP_RAMP, px.interp(world.npp));
    },
  },
  {
    id: 'soil',
    name: 'Soil fertility',
    group: 'life',
    legend: { kind: 'ramp', stops: SOIL_RAMP, unit: '0 barren to 1 richest (ash and alluvium raise it, leaching, old shields and cold lower it)' },
    relief: 'light',
    cellColor: (world, i) => (world.elevation[i] < world.seaLevel ? koppenSea(world.elevation[i] - world.seaLevel) : world.lake[i] >= 0 ? LAKE_COLOR : ramp(SOIL_RAMP, world.soil[i])),
    smooth: (world, px) => {
      const rel = relief(world, px);
      return rel < 0 ? koppenSea(rel) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(SOIL_RAMP, px.interp(world.soil));
    },
  },
  {
    id: 'vegetation',
    name: 'Vegetation',
    group: 'life',
    legend: {
      kind: 'categories',
      items: VEGETATION_NAMES.slice(1).map((name, k): { color: RGB; label: string } => ({ color: VEGETATION_COLORS[k + 1], label: name })).concat([{ color: LAKE_COLOR, label: 'lake' }]),
    },
    relief: 'light',
    rivers: true,
    cellColor: (world, i) => {
      const rel = world.elevation[i] - world.seaLevel;
      if (rel < 0) return koppenSea(rel);
      if (world.lake[i] >= 0) return LAKE_COLOR;
      return VEGETATION_COLORS[world.vegetation[i]] ?? [0, 0, 0];
    },
    smooth: (world, px) => {
      const rel = relief(world, px);
      if (rel < 0) return koppenSea(rel);
      if (world.lake[px.cell] >= 0) return LAKE_COLOR;
      return VEGETATION_COLORS[world.vegetation[px.cell]] ?? [0, 0, 0];
    },
  },
  // Fauna (M23): realms from the lineages the plates carried, endemism, richness, megafauna.
  {
    id: 'realms',
    name: 'Faunal realms',
    group: 'life',
    legend: {
      kind: 'categories',
      items: REALM_NAMES.map((name, k): { color: RGB; label: string } => ({ color: REALM_COLORS[k], label: `${name} lineage` })).concat([
        { color: LAND_WASH, label: 'paler where the dominant lineage holds a smaller share (a mixed fauna)' },
      ]),
    },
    relief: 'light',
    cellColor: (world, i) => realmColor(world, i),
    smooth: (world, px) => (relief(world, px) < 0 ? koppenSea(relief(world, px)) : realmColor(world, px.cell)),
  },
  {
    id: 'endemism',
    name: 'Endemism',
    group: 'life',
    legend: { kind: 'ramp', stops: ENDEMISM_RAMP, unit: 'share of the fauna found on no other landmass' },
    relief: 'light',
    cellColor: (world, i) => (world.elevation[i] < world.seaLevel ? koppenSea(world.elevation[i] - world.seaLevel) : world.lake[i] >= 0 ? LAKE_COLOR : ramp(ENDEMISM_RAMP, world.endemism[i])),
    smooth: (world, px) => {
      const rel = relief(world, px);
      return rel < 0 ? koppenSea(rel) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(ENDEMISM_RAMP, px.interp(world.endemism));
    },
  },
  {
    id: 'richness',
    name: 'Species richness',
    group: 'life',
    legend: { kind: 'ramp', stops: RICHNESS_RAMP, unit: 'index 0 to 1: productivity (species-energy) × landmass size (species-area)' },
    relief: 'light',
    cellColor: (world, i) => (world.elevation[i] < world.seaLevel ? koppenSea(world.elevation[i] - world.seaLevel) : world.lake[i] >= 0 ? LAKE_COLOR : ramp(RICHNESS_RAMP, world.richness[i])),
    smooth: (world, px) => {
      const rel = relief(world, px);
      return rel < 0 ? koppenSea(rel) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(RICHNESS_RAMP, px.interp(world.richness));
    },
  },
  {
    id: 'megafauna',
    name: 'Megafauna',
    group: 'life',
    legend: {
      kind: 'categories',
      items: [
        { color: MEGAFAUNA_PREDATOR_COLOR, label: 'large herbivores and large predators (productive ground on a landmass above a million km²)' },
        { color: MEGAFAUNA_HERBIVORE_COLOR, label: 'large herbivores only (a landmass above 200,000 km²)' },
        { color: MEGAFAUNA_NONE, label: 'none: too little growth, ice, or too small a landmass' },
        { color: mix(MEGAFAUNA_HERBIVORE_COLOR, MEGAFAUNA_ARTHROPOD_TINT, 0.5), label: 'tinted violet where giant arthropods fly (oxygen above 27 % of the air)' },
      ],
    },
    relief: 'light',
    cellColor: (world, i) => megafaunaColor(world, i),
    smooth: (world, px) => (relief(world, px) < 0 ? koppenSea(relief(world, px)) : megafaunaColor(world, px.cell)),
  },
];

function realmColor(world: World, i: number): RGB {
  const rel = world.elevation[i] - world.seaLevel;
  if (rel < 0) return koppenSea(rel);
  if (world.lake[i] >= 0) return LAKE_COLOR;
  const k = world.realm[i];
  if (k === REALM_NONE || k >= LINEAGE_COUNT) return LAND_WASH;
  const share = world.lineage[i * LINEAGE_COUNT + k];
  return mix(LAND_WASH, REALM_COLORS[k], 0.35 + 0.65 * share);
}

function megafaunaColor(world: World, i: number): RGB {
  const rel = world.elevation[i] - world.seaLevel;
  if (rel < 0) return koppenSea(rel);
  if (world.lake[i] >= 0) return LAKE_COLOR;
  const bits = world.megafauna[i];
  const base = bits & MEGAFAUNA_PREDATORS ? MEGAFAUNA_PREDATOR_COLOR : bits & MEGAFAUNA_HERBIVORES ? MEGAFAUNA_HERBIVORE_COLOR : MEGAFAUNA_NONE;
  return bits & MEGAFAUNA_GIANT_ARTHROPODS ? mix(base, MEGAFAUNA_ARTHROPOD_TINT, 0.5) : base;
}

/** A land ramp with the sea dim and the lakes blue. */
function landRamp(world: World, i: number, stops: Stop[], value: number): RGB {
  const rel = world.elevation[i] - world.seaLevel;
  if (rel < 0) return koppenSea(rel);
  if (world.lake[i] >= 0) return LAKE_COLOR;
  return ramp(stops, value);
}

function arrivalColor(world: World, i: number): RGB {
  const rel = world.elevation[i] - world.seaLevel;
  if (rel < 0) return koppenSea(rel);
  if (world.lake[i] >= 0) return LAKE_COLOR;
  const ka = world.arrivalKa[i];
  return ka === UNREACHED ? UNREACHED_COLOR : ramp(ARRIVAL_RAMP, ka);
}

const CIVILIZATION_LAYERS: Layer[] = [
  {
    id: 'habitability',
    name: 'Habitability',
    group: 'civilization',
    legend: { kind: 'ramp', stops: HABITABILITY_RAMP, unit: '0 to 1: food × fresh water, under the thermal comfort' },
    relief: 'light',
    cellColor: (world, i) => landRamp(world, i, HABITABILITY_RAMP, world.habitability[i]),
    smooth: (world, px) => (relief(world, px) < 0 ? koppenSea(relief(world, px)) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(HABITABILITY_RAMP, px.interp(world.habitability))),
  },
  {
    id: 'agriculture',
    name: 'Agricultural potential',
    group: 'civilization',
    legend: { kind: 'ramp', stops: FARM_RAMP, unit: '0 to 1: soil × growth, best where the cereals were domesticated (seasonal grasslands, Mediterranean, flood plains)' },
    relief: 'light',
    cellColor: (world, i) => landRamp(world, i, FARM_RAMP, world.agriculture[i]),
    smooth: (world, px) => (relief(world, px) < 0 ? koppenSea(relief(world, px)) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(FARM_RAMP, px.interp(world.agriculture))),
  },
  {
    id: 'citySite',
    name: 'City sites',
    group: 'civilization',
    legend: {
      kind: 'ramp',
      stops: CITY_RAMP,
      unit: 'score 0 to 1: river, harbor, fresh water, farmland within reach, defensibility, safety, minerals, centrality; white dots are the candidate cities, numbered best first',
    },
    relief: 'light',
    rivers: true,
    cellColor: (world, i) => landRamp(world, i, CITY_RAMP, world.citySite[i]),
    smooth: (world, px) => (relief(world, px) < 0 ? koppenSea(relief(world, px)) : world.lake[px.cell] >= 0 ? LAKE_COLOR : ramp(CITY_RAMP, px.interp(world.citySite))),
    marks: (world) => world.cities.map((c) => ({ cell: c.cell, color: CITY_MARK })),
    labels: (world) => world.cities.map((c, k) => ({ cell: c.cell, text: String(k + 1) })),
  },
  {
    id: 'dispersal',
    name: 'Human dispersal',
    group: 'civilization',
    legend: {
      kind: 'ramp',
      stops: ARRIVAL_RAMP,
      unit: 'thousands of years after the origin (the yellow dot); gray land is not reached within 100,000 years',
    },
    relief: 'light',
    cellColor: (world, i) => arrivalColor(world, i),
    smooth: (world, px) => arrivalColor(world, px.cell),
    marks: (world) => (world.origin >= 0 ? [{ cell: world.origin, color: ORIGIN_MARK }] : []),
  },
];
LAYERS.push(...CIVILIZATION_LAYERS);

/** The land washed pale and the sea dim, so marks and potentials carry the color. */
function mutedLand(rel: number): RGB {
  return rel >= 0 ? mix(hypsometric(rel), LAND_WASH, 0.55) : koppenSea(rel);
}

function mineralRamp(k: number): Stop[] {
  return [
    [0, mix(hypsometric(300), LAND_WASH, 0.55)],
    [1, mix(mix(hypsometric(300), LAND_WASH, 0.55), MINERAL_COLORS[k], 0.85)],
  ];
}

function depositMarks(world: World, k: number): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i < world.n; i++) if ((world.deposits[i] >> k) & 1) out.push({ cell: i, color: MINERAL_COLORS[k] });
  return out;
}

function allDepositMarks(world: World): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i < world.n; i++) {
    const bits = world.deposits[i];
    if (!bits) continue;
    // One mark per cell: the first mineral set, so the symbols do not pile up.
    for (let k = 0; k < MINERAL_COUNT; k++) {
      if ((bits >> k) & 1) {
        out.push({ cell: i, color: MINERAL_COLORS[k] });
        break;
      }
    }
  }
  return out;
}

export function layerById(id: string): Layer {
  return LAYERS.find((l) => l.id === id) ?? LAYERS[0];
}

/** The layer's flat color of every cell, 3 bytes per cell. */
export function cellColors(world: World, layer: Layer, sample = ANNUAL): Uint8ClampedArray {
  const n = world.n;
  const colors = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = layer.cellColor(world, i, sample);
    colors[3 * i] = r;
    colors[3 * i + 1] = g;
    colors[3 * i + 2] = b;
  }
  return colors;
}

/**
 * Fill an RGBA buffer from per-cell colors and a pixel-to-cell lookup; -1
 * entries get the background, and an optional shade (0 to 1) darkens each
 * pixel. This is the flat painter: thumbnails and the globe while it turns.
 */
export function paintCells(colors: Uint8ClampedArray, cells: Int32Array, out: Uint8ClampedArray, shade: Float32Array | null = null): void {
  for (let p = 0; p < cells.length; p++) {
    const o = p * 4;
    const i = cells[p];
    if (i < 0) {
      out[o] = BACKGROUND[0];
      out[o + 1] = BACKGROUND[1];
      out[o + 2] = BACKGROUND[2];
      out[o + 3] = 255;
      continue;
    }
    const c = i * 3;
    const k = shade ? shade[p] : 1;
    out[o] = colors[c] * k;
    out[o + 1] = colors[c + 1] * k;
    out[o + 2] = colors[c + 2] * k;
    out[o + 3] = 255;
  }
}

/** Flat paint of a layer through a raster (one color per cell). */
export function paintLayer(world: World, raster: Raster, layer: Layer, out: Uint8ClampedArray, sample = ANNUAL): void {
  paintCells(cellColors(world, layer, sample), raster.cell, out);
}
