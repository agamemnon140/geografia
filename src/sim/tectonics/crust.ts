/**
 * Crust model constants (DESIGN 3.3). Units: thickness in km, elevation in m,
 * ages in tectonic steps (one step is one million years). Lengths, counts and
 * speeds given "in cells" mean reference cells of about 112 km, the size of
 * an Earth-level cell (constants.ts); the simulation converts them to its
 * own grid (M18), so a finer grid gives the same planet in kilometers.
 */

export const OCEANIC = 0;
export const CONTINENTAL = 1;

/** Typical oceanic crust thickness. */
export const OCEANIC_THICKNESS_KM = 7;
/** Typical continental crust thickness. */
export const CONTINENTAL_THICKNESS_KM = 35;
/**
 * Surface height of 35 km continental crust in the model's reference frame,
 * whose zero is Earth's: ridge crests at -2500 m, old sea floor near -5500 m,
 * so standard crust is 2500 m above the ridge crest. Sea level is solved
 * separately from the water volume and comes out a few hundred meters below
 * zero (the model's sea floor is a little older than Earth's), which leaves
 * standard crust 300 to 600 m above the sea, where Earth's cratons stand,
 * and floods the deeper interior basins into inland seas.
 */
export const CONTINENTAL_BASE_M = 250;
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
/** Trench depression on the subducting side of a convergent boundary. */
export const TRENCH_M = 2500;
/** Where buoyant continental crust underthrusts another continent there is no trench, only a foreland basin. */
export const FORELAND_M = 600;
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
/**
 * Volcanic thickening per subduction event on each cell of the arc. With a
 * one-cell radius and a plate consumed at 0.3 cells per step, an arc cell
 * receives about two events per step: 0.2 km per step, 20 km^3 per km of
 * arc per Myr, the low end of Earth's arc magmatic flux (30 to 90).
 */
export const ARC_RATE_KM = 0.15;
/** Arc width in cells around the overriding boundary cell (arcs are 100 to 300 km wide). */
export const ARC_RADIUS = 1;
/** Between two oceanic parcels, the one carrying this much more volcanic rock overrides (thickened arc crust resists subduction), so an arc keeps its polarity once it starts. */
export const ARC_OVERRIDE_KM = 1;
/** An oceanic parcel carrying this much arc volcanism has become an island arc: buoyant continental crust that accretes instead of subducting. */
export const ARC_ACCRETION_KM = 8;
/** Shortening of a continental margin per oceanic parcel subducted beneath it (Andean orogeny: the Andes owe their 70 km crust to compression more than to magma), shared by the continental cells within ANDEAN_RADIUS of the trench. */
export const ANDEAN_SHORTENING_KM = 0.5;
export const ANDEAN_RADIUS = 2;
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
/** Fraction of the surface seeded as continental crust (Earth: about 40% counting every shelf and slope). Island arcs add about 2% more over 200 steps. A compact supercontinent floods only 5 to 6% of the surface where Earth's dissected continents flood 11%, so these planets carry 32 to 34% of land against Earth's 29%; lowering the fraction does not help, because the sea falls with it (DESIGN 3.3, M13). */
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
export const RIFT_PROBABILITY = 0.15;
/** A rift runs parallel to a line through the continent's centroid, shifted by up to this share of the continent's half-extent: splits are uneven, as Madagascar, India or Greenland were. */
export const RIFT_OFFSET = 0.6;
/** A failing rift hinges inside the continent, this far along its extent (range): it opens a gulf at one end and closes it at the other. */
export const RIFT_FAIL_HINGE: [number, number] = [0.3, 0.6];
/** A plate carrying this share of the planet's surface as continental crust rifts whether locked or not: a supercontinent insulates the mantle beneath it. */
export const SUPERCONTINENT_FRACTION = 0.14;
/** Share of rifts that fail (aulacogens): the young ocean stops opening and the two sides weld again, leaving a gulf. */
export const RIFT_FAIL_PROBABILITY = 0.4;
/** Steps a failing rift stays open before it welds (range). */
export const RIFT_FAIL_STEPS: [number, number] = [10, 30];
/** Relative opening rate across a new rift at its far end, in cells per step. */
export const RIFT_RATE_CELLS = 0.3;
/** Angular margin between the end of the continent and the relative pole of a rift, radians (about 10 degrees). */
export const RIFT_POLE_MARGIN = 0.17;
/**
 * Slab pull (DESIGN 3.3, M13): a plate whose oceanic edge subducts is pulled
 * toward that trench, the dominant plate-driving force on Earth. Its Euler
 * vector relaxes at this rate per step toward the vector that moves its
 * subducting cells into the trench, at this speed in cells per step once the
 * trench is this many cells long. Buoyant continental crust being
 * underthrust pulls nothing (India slowed when its ocean was gone).
 */
export const SLAB_PULL_RATE = 0.03;
export const SLAB_PULL_SPEED_CELLS = 0.35;
export const SLAB_PULL_SATURATION_CELLS = 30;
/** Slab break-off (M17): a plate colliding on at least this many continental cells this step has lost its slab and feels no pull; the collision brake then stops it with the seas it had not closed still open (the Mediterranean). */
export const SLAB_BREAKOFF_CELLS = 3;
/**
 * Back-arc opening by slab rollback (DESIGN 3.3, M14). Old, dense sea floor
 * sinks steeply and its trench retreats; the overriding plate's arc and
 * forearc follow it and a marginal sea opens behind them (the Sea of Japan,
 * the Tyrrhenian, the Caribbean behind the Antilles). The floor going down
 * must be this old (steps) along a trench this long (cells); the chance per
 * check; the width of the strip that becomes the arc plate (cells) and its
 * minimum size; its speed toward the trench (cells per step, range).
 */
export const ROLLBACK_MIN_AGE = 70;
export const ROLLBACK_MIN_TRENCH = 12;
export const ROLLBACK_PROBABILITY = 0.12;
export const ROLLBACK_WIDTH = 3;
export const ROLLBACK_MIN_CELLS = 20;
/** Only the margin goes with the arc: continental crust at least this thick (a craton) stays with the parent. */
export const ROLLBACK_MAX_CONTINENTAL_KM = 32;
export const ROLLBACK_RATE_CELLS: [number, number] = [0.15, 0.3];
/** A plate waits this many steps between margin events (back-arc openings, sliver captures), and plates never exceed this count. */
export const MARGIN_EVENT_LOCK_STEPS = 80;
export const MAX_PLATES = 22;
/**
 * Sliver capture at a transform margin (M14): where continental crust slides
 * past an oceanic plate, a strip of the coast this wide (cells) and at least
 * this long can pass to the oceanic plate and travel with it (Baja California
 * on the Pacific plate, the Gulf of California opening behind it); the chance
 * per check.
 */
export const SLIVER_WIDTH = 2;
export const SLIVER_MIN_LENGTH = 8;
export const SLIVER_PROBABILITY = 0.15;
/** A coast counts as sliding when the relative motion across it is this oblique or more (cosine of the angle to the boundary normal). */
export const SLIVER_MAX_NORMAL_COSINE = 0.6;
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

/** Depression at a convergent boundary on the underthrusting side: a trench, unless the crust there is buoyant continental crust (a collision), where a foreland basin forms instead. */
export function convergentDepression(type: number, thickness: number): number {
  return type === CONTINENTAL && thickness >= BUOYANT_THICKNESS_KM ? FORELAND_M : TRENCH_M;
}

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

/**
 * Resource bookkeeping inside the loop (M21). Sediment laid down in a lake
 * or on a flood plain under a warm, wet climate is a swamp and counts toward
 * coal (the Carboniferous forests grew where it was warmer than 15 C with
 * more than a meter of rain); sediment laid down in a shallow warm sea over
 * continental crust counts toward oil source rock (most source rocks formed
 * on shelves of warm seas), a delta there counting half toward coal too.
 * Closed-basin lakes whose evaporation outruns their inflow lay down
 * evaporites: 10 m of salt per step at full deficit (the Messinian laid 2 km
 * in under a million years; most basins are far slower).
 */
export const COAL_MIN_C = 15;
export const COAL_MIN_MM = 1000;
export const OIL_MIN_C = 18;
export const SHELF_DEPTH_M = 500;
export const DELTA_COAL_SHARE = 0.5;
export const EVAPORITE_KM_PER_STEP = 0.01;

/**
 * Fauna lineages (M23). Every land parcel carries a vector over
 * LINEAGE_COUNT ancestral faunas, seeded by angular sector around the
 * supercontinent; at each fluvial pass the vector moves halfway to its land
 * neighbors' mean (diffusion along the land, about 700 km over a 200-step
 * history: a toy for dispersal, which keeps a continent's regions distinct)
 * and 1% toward its landmass's mean (long-range exchange); deserts and
 * ground above 2,500 m pass faunas at a third of the rate; nothing crosses
 * the sea. There is no speciation: isolation preserves a fauna, it does not
 * create one.
 */
export const LINEAGE_COUNT = 8;
export const LINEAGE_DIFFUSION = 0.5;
export const LINEAGE_LANDMASS_MIXING = 0.01;
export const LINEAGE_BARRIER = 0.3;
export const LINEAGE_DESERT_MM = 250;
export const LINEAGE_MOUNTAIN_M = 2500;
