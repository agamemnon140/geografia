import { EARTH_RADIUS_KM, EARTH_WATER_VOLUME_KM3 } from './constants.ts';

/** The physical core parameters (DESIGN section 4). Every one has a causal path to the output. */
export interface PlanetParams {
  /** Unsigned 32-bit integer; drives all randomness. */
  seed: number;
  /** Planet radius in km. */
  radiusKm: number;
  /** Mean density relative to Earth; gravity = density * radius (relative). */
  density: number;
  /** Water inventory relative to Earth, scaled to the planet's surface area. */
  waterVolume: number;
  /** Target share of the surface under the sea (0.05 to 0.95); 0 lets the water volume set the sea level instead. */
  oceanFraction: number;
  /** Axial tilt in degrees. */
  axialTiltDeg: number;
  /** Rotation period in hours. */
  rotationHours: number;
  /** Stellar flux at the planet relative to Earth. */
  insolation: number;
  /** Initial number of tectonic plates. */
  plateCount: number;
  /** Steps the plates have moved since the supercontinent began to rift, one per million years (0 to 400). */
  tectonicAge: number;
  /** 0 = interglacial, 1 = glacial maximum. */
  glacialPhase: number;
  /** Mantle heat flux relative to Earth: plate speed, hotspot volcanism and rifting rate. */
  mantleHeat: number;
  /** Greenhouse strength relative to Earth (logarithmic forcing, like carbon dioxide). */
  greenhouse: number;
  /** Surface pressure in bar: heat transport, pressure broadening, thermal inertia. */
  pressureBar: number;
  /** Orbital eccentricity: unequal seasons between the hemispheres. */
  eccentricity: number;
}

export interface ParamSpec {
  key: keyof PlanetParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Milestone in which the parameter starts to affect the output. */
  wiredIn: number;
  /** The causal path, shown in the UI. */
  help: string;
}

/** Milestone currently implemented; parameters wired in later milestones are shown disabled. */
export const CURRENT_MILESTONE = 9;

export const PARAM_SPECS: ParamSpec[] = [
  { key: 'seed', label: 'Seed', min: 0, max: 4294967295, step: 1, unit: '', wiredIn: 1, help: 'All randomness' },
  { key: 'radiusKm', label: 'Radius', min: 1900, max: 16000, step: 10, unit: 'km', wiredIn: 1, help: 'Cell count; circulation cells; plate size' },
  { key: 'density', label: 'Density', min: 0.3, max: 2, step: 0.05, unit: 'x Earth', wiredIn: 2, help: 'Gravity: isostasy ceiling, lapse rate' },
  { key: 'waterVolume', label: 'Water volume', min: 0, max: 5, step: 0.05, unit: 'x Earth', wiredIn: 1, help: 'Sea level from hypsometry (ignored when ocean cover is set)' },
  { key: 'oceanFraction', label: 'Ocean cover', min: 0, max: 0.95, step: 0.01, unit: '0 = by water', wiredIn: 9, help: 'Sea level set each step so the ocean covers this share of the surface; the water volume follows' },
  { key: 'axialTiltDeg', label: 'Axial tilt', min: 0, max: 90, step: 0.5, unit: 'deg', wiredIn: 4, help: 'Seasonal insolation amplitude, polar night' },
  { key: 'rotationHours', label: 'Rotation period', min: 4, max: 5000, step: 1, unit: 'h', wiredIn: 4, help: 'Coriolis, number of circulation cells' },
  { key: 'insolation', label: 'Insolation', min: 0.3, max: 2, step: 0.01, unit: 'x Earth', wiredIn: 4, help: 'Global temperature baseline' },
  { key: 'plateCount', label: 'Plates', min: 4, max: 30, step: 1, unit: '', wiredIn: 2, help: 'Initial plate seeds' },
  { key: 'tectonicAge', label: 'Age since Pangea', min: 0, max: 400, step: 10, unit: 'million years', wiredIn: 2, help: 'Time the plates have moved since the supercontinent began to rift (one step per million years): more rifts, orogenies and erosion; 0 shows the supercontinent itself; the timeline keeps a frame every 25 million years' },
  { key: 'glacialPhase', label: 'Glacial phase', min: 0, max: 1, step: 0.05, unit: '', wiredIn: 6, help: 'Temperature offset, sea-level drop, ice extent' },
  { key: 'mantleHeat', label: 'Mantle heat', min: 0.3, max: 3, step: 0.1, unit: 'x Earth', wiredIn: 8, help: 'Plate speed, hotspot volcanism, rifting rate' },
  { key: 'greenhouse', label: 'Greenhouse', min: 0.2, max: 5, step: 0.1, unit: 'x Earth', wiredIn: 9, help: 'Longwave trapping: global temperature, ice extent' },
  { key: 'pressureBar', label: 'Air pressure', min: 0.1, max: 10, step: 0.1, unit: 'bar', wiredIn: 9, help: 'Heat transport to the poles, pressure broadening, seasonal inertia' },
  { key: 'eccentricity', label: 'Eccentricity', min: 0, max: 0.3, step: 0.01, unit: '', wiredIn: 9, help: 'Unequal seasons between hemispheres (perihelion in southern summer)' },
];

export const EARTH: PlanetParams = {
  seed: 2,
  radiusKm: EARTH_RADIUS_KM,
  density: 1,
  waterVolume: 1,
  oceanFraction: 0,
  axialTiltDeg: 23.44,
  rotationHours: 23.93,
  insolation: 1,
  plateCount: 12,
  tectonicAge: 200,
  glacialPhase: 0,
  mantleHeat: 1,
  greenhouse: 1,
  pressureBar: 1,
  eccentricity: 0.0167,
};

export interface Preset {
  name: string;
  params: PlanetParams;
}

export const PRESETS: Preset[] = [
  { name: 'Earth', params: EARTH },
  { name: 'Super-Earth', params: { ...EARTH, radiusKm: 1.5 * EARTH_RADIUS_KM, density: 1.1, plateCount: 20 } },
  { name: 'Slow rotator', params: { ...EARTH, rotationHours: 24 * 100 } },
  { name: 'High tilt', params: { ...EARTH, axialTiltDeg: 45 } },
  { name: 'Waterworld', params: { ...EARTH, waterVolume: 2.5 } },
  { name: 'Dry world', params: { ...EARTH, waterVolume: 0.3 } },
  { name: 'Half ocean', params: { ...EARTH, oceanFraction: 0.5 } },
  { name: 'Snowball', params: { ...EARTH, insolation: 0.85, glacialPhase: 1 } },
  { name: 'Pangea', params: { ...EARTH, tectonicAge: 0 } },
  { name: 'Young planet', params: { ...EARTH, tectonicAge: 50 } },
  { name: 'Old planet', params: { ...EARTH, tectonicAge: 400 } },
  { name: 'Hot mantle', params: { ...EARTH, mantleHeat: 2.5, tectonicAge: 300 } },
  { name: 'Greenhouse', params: { ...EARTH, greenhouse: 3 } },
  { name: 'Thin air', params: { ...EARTH, pressureBar: 0.3 } },
  { name: 'Eccentric orbit', params: { ...EARTH, eccentricity: 0.2 } },
];

/** Clamp every parameter into its spec range and normalize the seed to uint32. */
export function validateParams(p: PlanetParams): PlanetParams {
  const out = { ...p };
  for (const spec of PARAM_SPECS) {
    const v = Number(out[spec.key]);
    out[spec.key] = Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : EARTH[spec.key];
  }
  out.seed = out.seed >>> 0;
  return out;
}

/** Surface gravity relative to Earth: g is proportional to density times radius. */
export function relativeGravity(p: PlanetParams): number {
  return p.density * (p.radiusKm / EARTH_RADIUS_KM);
}

/** Absolute water inventory in km^3 (ocean plus ice): the relative inventory scaled by surface area. */
export function waterVolumeKm3(p: PlanetParams): number {
  const ratio = p.radiusKm / EARTH_RADIUS_KM;
  return p.waterVolume * EARTH_WATER_VOLUME_KM3 * ratio * ratio;
}
