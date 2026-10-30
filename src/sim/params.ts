import { EARTH_OCEAN_VOLUME_KM3, EARTH_RADIUS_KM } from './constants.ts';

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
  /** Axial tilt in degrees. */
  axialTiltDeg: number;
  /** Rotation period in hours. */
  rotationHours: number;
  /** Stellar flux at the planet relative to Earth. */
  insolation: number;
  /** Initial number of tectonic plates. */
  plateCount: number;
  /** Number of tectonic steps to simulate. */
  tectonicAge: number;
  /** 0 = interglacial, 1 = glacial maximum. */
  glacialPhase: number;
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
export const CURRENT_MILESTONE = 4;

export const PARAM_SPECS: ParamSpec[] = [
  { key: 'seed', label: 'Seed', min: 0, max: 4294967295, step: 1, unit: '', wiredIn: 1, help: 'All randomness' },
  { key: 'radiusKm', label: 'Radius', min: 1900, max: 16000, step: 10, unit: 'km', wiredIn: 1, help: 'Cell count; circulation cells; plate size' },
  { key: 'density', label: 'Density', min: 0.3, max: 2, step: 0.05, unit: 'x Earth', wiredIn: 2, help: 'Gravity: isostasy ceiling, lapse rate' },
  { key: 'waterVolume', label: 'Water volume', min: 0, max: 5, step: 0.05, unit: 'x Earth', wiredIn: 1, help: 'Sea level from hypsometry' },
  { key: 'axialTiltDeg', label: 'Axial tilt', min: 0, max: 90, step: 0.5, unit: 'deg', wiredIn: 4, help: 'Seasonal insolation amplitude, polar night' },
  { key: 'rotationHours', label: 'Rotation period', min: 4, max: 5000, step: 1, unit: 'h', wiredIn: 4, help: 'Coriolis, number of circulation cells' },
  { key: 'insolation', label: 'Insolation', min: 0.3, max: 2, step: 0.01, unit: 'x Earth', wiredIn: 4, help: 'Global temperature baseline' },
  { key: 'plateCount', label: 'Plates', min: 4, max: 30, step: 1, unit: '', wiredIn: 2, help: 'Initial plate seeds' },
  { key: 'tectonicAge', label: 'Tectonic age', min: 50, max: 400, step: 10, unit: 'steps', wiredIn: 2, help: 'Loop length: more orogenies, more erosion' },
  { key: 'glacialPhase', label: 'Glacial phase', min: 0, max: 1, step: 0.05, unit: '', wiredIn: 6, help: 'Temperature offset, sea-level drop, ice extent' },
];

export const EARTH: PlanetParams = {
  seed: 1,
  radiusKm: EARTH_RADIUS_KM,
  density: 1,
  waterVolume: 1,
  axialTiltDeg: 23.44,
  rotationHours: 23.93,
  insolation: 1,
  plateCount: 12,
  tectonicAge: 200,
  glacialPhase: 0,
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
  { name: 'Snowball', params: { ...EARTH, insolation: 0.85, glacialPhase: 1 } },
  { name: 'Young planet', params: { ...EARTH, tectonicAge: 50 } },
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

/** Absolute water volume in km^3: the relative inventory scaled by surface area. */
export function waterVolumeKm3(p: PlanetParams): number {
  const ratio = p.radiusKm / EARTH_RADIUS_KM;
  return p.waterVolume * EARTH_OCEAN_VOLUME_KM3 * ratio * ratio;
}
