/**
 * Physical constants and grid-level constants. Every value has a source or a
 * justification so tuning stays honest.
 */

/** Mean Earth radius (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

/** Earth ocean volume (NOAA ETOPO1 estimate, 1.335e9 km^3). */
export const EARTH_OCEAN_VOLUME_KM3 = 1.335e9;

/** Water locked in Earth's present ice sheets (Antarctica and Greenland), km^3. */
export const EARTH_ICE_VOLUME_KM3 = 2.9e7;

/** Earth's surface water inventory: ocean plus ice sheets. The simulator locks part of it in ice from the climate. */
export const EARTH_WATER_VOLUME_KM3 = EARTH_OCEAN_VOLUME_KM3 + EARTH_ICE_VOLUME_KM3;

/** Earth surface area for the mean radius. */
export const EARTH_SURFACE_KM2 = 4 * Math.PI * EARTH_RADIUS_KM * EARTH_RADIUS_KM;

/** Icosahedron subdivision level used for an Earth-sized planet (DESIGN 3.1). */
export const EARTH_LEVEL = 6;

/** Clamp range for the subdivision level (DESIGN 3.1). */
export const MIN_LEVEL = 4;
export const MAX_LEVEL = 7;

/** Number of cells (vertices of the subdivided icosahedron) at a level. */
export function cellCount(level: number): number {
  return 10 * 4 ** level + 2;
}

/** Target cell area: Earth surface divided by the Earth-level cell count (~12,450 km^2). */
export const EARTH_CELL_AREA_KM2 = EARTH_SURFACE_KM2 / cellCount(EARTH_LEVEL);

/**
 * The reference cell (M18): the side of an Earth-level cell, about 112 km.
 * Tectonic constants written "in cells" mean reference cells, and every
 * simulation converts them to its own grid, so a finer grid or a bigger
 * planet gets the same planet in kilometers, not a different one.
 */
export const REFERENCE_CELL_KM = Math.sqrt(EARTH_CELL_AREA_KM2);
