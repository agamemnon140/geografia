/**
 * Crust model constants (DESIGN 3.3). Units: thickness in km, elevation in m,
 * ages in tectonic steps (one step is roughly one million years at Earth-like
 * plate speeds, since a cell is ~110 km and plates move a fraction of a cell
 * per step).
 */

export const OCEANIC = 0;
export const CONTINENTAL = 1;

/** Typical oceanic crust thickness. */
export const OCEANIC_THICKNESS_KM = 7;
/** Typical continental crust thickness. */
export const CONTINENTAL_THICKNESS_KM = 35;
/**
 * Surface height of 35 km continental crust in the model's reference frame;
 * sea level is solved separately and comes out near -1100 m for Earth's
 * water, so standard crust stands about 900 m above the sea, as Earth's
 * old cratons do. (Was 500 while the start was noise blobs with wide
 * thinned margins; the rifted start keeps more crust at full thickness.)
 */
export const CONTINENTAL_BASE_M = -200;
/** Airy isostasy: (rho_mantle - rho_crust) / rho_mantle with 3300 and 2800 kg/m^3 gives ~0.15 m of surface per m of root, i.e. 150 m per km. */
export const ISOSTASY_M_PER_KM = 150;
/** Depth of a mid-ocean ridge crest. */
export const RIDGE_DEPTH_M = -2500;
/** Thermal subsidence of oceanic lithosphere: depth deepens with the square root of age (Parsons and Sclater). */
export const SUBSIDENCE_M_PER_SQRT_STEP = 280;
/** Age after which oceanic lithosphere stops subsiding (flattening of old sea floor). */
export const SUBSIDENCE_MAX_AGE = 120;
/** Continental margins thinner than this stop rifting as continental crust; sea-floor spreading takes over. */
export const RIFT_MIN_THICKNESS_KM = 16;
/** Volcanic edifices on strong oceanic lithosphere are flexurally supported: large surface rise per km. */
export const ADDED_M_PER_KM = 600;
/** On weaker continental lithosphere a volcanic load sinks further: smaller surface rise per km. */
export const ADDED_CONTINENTAL_M_PER_KM = 300;
/** Sediment is light and loads a basin that subsides under it: little surface rise per km. */
export const SEDIMENT_M_PER_KM = 200;
/** Passive margins are stretched: continental thickness one to four cells from the ocean at the start (slope and shelf); about a quarter of the continental crust starts flooded, as on Earth. */
export const MARGIN_THICKNESS_KM = [16, 20, 26, 30];
/** Trench depression on the subducting side of a convergent boundary. */
export const TRENCH_M = 2500;
/** Thickest crust the lithosphere holds on Earth (Tibet); scales with 1/g. */
export const THICKNESS_CAP_EARTH_KM = 70;
/** Fraction of height above sea level removed per step by erosion. */
export const EROSION_RATE = 0.004;
/** Diffusion of continental thickness between neighbors per step (hillslope smoothing). */
export const CRUST_DIFFUSION = 0.02;
/** Thickness above which crust spreads gravitationally toward thinner neighbors (plateau building). */
export const FLOW_THRESHOLD_KM = 45;
/** Fraction of the thickness difference that flows to each thinner neighbor per step above the threshold. */
export const FLOW_RATE = 0.1;
/** Crustal flow above this, in km per step, stamps the receiving cell with the current orogeny step. */
export const FLOW_STAMP_KM = 0.05;
/** Volcanic thickening per subduction event on each cell of the arc. */
export const ARC_RATE_KM = 0.01;
/** Arc width in cells around the overriding boundary cell. */
export const ARC_RADIUS = 2;
/** Volcanic thickening per step on the cell above a hotspot. */
export const HOTSPOT_RATE_KM = 3;
/** Volcanic edifices stop growing past this (lithospheric flexure; a 10 km pile on the sea floor is a Hawaii-sized island). */
export const VOLCANIC_CAP_KM = 10;
/** Basins stop accepting sediment past this; the rest bypasses to the deep ocean. */
export const SEDIMENT_CAP_KM = 10;
/** Continental crust thinner than this behaves like oceanic crust in a collision (accreted slivers). */
export const BUOYANT_THICKNESS_KM = 20;
/** Minimum crust slab that thrusts into an empty frame cell as a new parcel. */
export const MIN_THRUST_KM = 5;
/** Plate rate multiplier per step for a plate in a full continental collision (India after hitting Eurasia: speed divided by three in a few tens of steps). */
export const COLLISION_BRAKE = 0.97;
/** Collision cells per step at which the brake saturates; shorter sutures brake proportionally less. */
export const COLLISION_SATURATION_CELLS = 10;
export const HOTSPOT_COUNT = 8;
/** Fraction of the surface seeded as continental crust (Earth: ~40%, of which a quarter is flooded shelf and slope). */
export const CONTINENTAL_FRACTION = 0.4;
/** Steps between random walks of the Euler poles. */
export const POLE_WALK_INTERVAL = 20;
/** Steps between checks for plate births (rifts) and deaths (mergers) (DESIGN 9.1, built in M8). */
export const PLATE_EVENT_INTERVAL = 10;
/** A plate slower than this many cells per step counts as locked. */
export const SLOW_RATE_CELLS = 0.12;
/** Locked steps before a large continental plate may rift (mantle heat piles up under a stalled continent). */
export const RIFT_LOCK_STEPS = 20;
/** Continental area a plate needs before it can rift, as a fraction of the planet's surface (Earth: Africa is 6%). */
export const RIFT_MIN_CONTINENT_FRACTION = 0.04;
/** Probability per check that an eligible plate rifts, at Earth's mantle heat. */
export const RIFT_PROBABILITY = 0.25;
/** Relative opening rate across a new rift at its far end, in cells per step. */
export const RIFT_RATE_CELLS = 0.3;
/** Angular margin between the end of the continent and the relative pole of a rift, radians (about 10 degrees). */
export const RIFT_POLE_MARGIN = 0.17;
/** Locked steps before a plate welded to a neighbor along a continental suture merges into it. */
export const MERGE_LOCK_STEPS = 40;
/** Minimum continental suture length, in cells, for a merger. */
export const MERGE_MIN_SUTURE = 12;
/** Steps between fluvial erosion passes (DESIGN 3.4: hydrology every K steps inside the loop). */
export const FLUVIAL_INTERVAL = 5;
/**
 * Stream-power coefficient: meters of surface removed per step per unit of
 * sqrt(discharge in km^3/yr) times slope. Calibrated so that a mountain cell
 * with a small river (10 km^3/yr, 2% slope) loses a few tens of meters per
 * step, i.e. a few hundredths of a millimeter per year, the low end of
 * observed orogen denudation; the isostatic conversion below multiplies the
 * crust removed by 1/0.15.
 */
export const FLUVIAL_K = 1500;
/** A fluvial pass never removes more than this fraction of the drop to the downstream cell (explicit-scheme stability). */
export const FLUVIAL_MAX_DROP_FRACTION = 0.5;

/** Surface elevation (m, model frame) of a crust parcel before trench and sea-level effects. */
export function crustElevation(type: number, thickness: number, age: number, volcanic: number, sediment: number): number {
  const base = type === CONTINENTAL
    ? CONTINENTAL_BASE_M + (thickness - CONTINENTAL_THICKNESS_KM) * ISOSTASY_M_PER_KM
    : RIDGE_DEPTH_M - SUBSIDENCE_M_PER_SQRT_STEP * Math.sqrt(Math.min(age, SUBSIDENCE_MAX_AGE));
  return base + volcanic * volcanicFactor(type) + sediment * SEDIMENT_M_PER_KM;
}

/** Surface rise per km of volcanic rock for a crust type. */
export function volcanicFactor(type: number): number {
  return type === CONTINENTAL ? ADDED_CONTINENTAL_M_PER_KM : ADDED_M_PER_KM;
}

/** Maximum crust thickness for a planet with the given gravity relative to Earth. */
export function thicknessCap(relativeGravity: number): number {
  return THICKNESS_CAP_EARTH_KM / relativeGravity;
}
