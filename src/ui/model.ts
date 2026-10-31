/**
 * The Model view (M19): the physics and the rationale of the simulator in
 * plain prose, rendered from a small markdown subset (headings, paragraphs,
 * lists, pipe tables, bold, code). The full specification with every
 * constant is docs/DESIGN.md in the repository; this is the reader's guide.
 */

export const MODEL_TEXT = `
# How geografia works

Every map here is the output of a chain of physical links: plate tectonics builds the relief, rivers and lakes form on it, the climate is solved on the relief and the oceans, and the biomes follow from the climate. Nothing is painted by hand and nothing is a lookup table of "what a continent looks like"; the parameters are physical (radius, density, water, spin, obliquity, insolation, mantle heat, greenhouse, air pressure, eccentricity), every planet is deterministic for its seed, and the Explain drawer can show, for any cell, the chain from parameter to biome. The real Earth can be built through the same chain from measured relief, so each link is judged against known ground.

## 1. The grid and time

The planet is a subdivided icosahedron: 40,962 cells of about 112 km for an Earth-sized planet (level 6), 163,842 cells of 55 km with the Fine grid option (level 7). Fields live on the cells; the renderer interpolates them per pixel. One tectonic step is one million years. The Age since Pangea parameter (0 to 400 million years) sets how long the plates have moved since the supercontinent began to rift: 0 shows the supercontinent itself with its first rift open, the default of 200 is the Earth's time since Pangea began to break, and 400 runs the cycle of rifts, failures, arcs and dockings about twice over (a build takes 3 s at 0 and 14 s at 400). The timeline keeps a frame every 25 million years, every 50 when the age needs more than eight frames. Every constant written "per cell" means a reference cell of 112 km, converted to the grid in use, so the fine grid gives the same planet in kilometers, only sharper.

## 2. Tectonics

**Crust parcels in plate frames.** Plates are rigid caps of the sphere that rotate about Euler poles. Crust is stored as parcels fixed to each plate's own frame; the world map is only a view obtained by rotating the frames, so resampling never creates or destroys material. Where two parcels claim one cell, the overriding one is decided by buoyancy: continental crust beats oceanic, younger (warmer, lighter) sea floor overrides older, thickened arc crust overrides plain sea floor, and between two continents the lower plate id underthrusts consistently along the whole suture. The losing parcel is consumed: an oceanic one feeds a volcanic arc and shortens the overriding margin, a continental one thickens the suture after first restoring the stretched margins on both sides, so that the seaway between two colliding continents closes.

**Elevation from isostasy.** Standard continental crust of 35 km stands at +250 m in a frame where ridge crests sit at -2500 m; every extra kilometer of crust lifts the surface by 150 m (Airy isostasy with 2800 and 3300 kg/m3). Sea floor deepens with the square root of its age, 280 m per square-root-million-years from the ridge, flattening after 120 million years (Parsons and Sclater). Volcanic piles ride higher per kilometer than compensated crust (600 m on strong oceanic lithosphere, 300 m on continents), sediment lower (200 m). A trench of 2500 m marks the subducting side of a convergent boundary; where buoyant continental crust underthrusts, a foreland basin of 600 m replaces it. The sea level is solved each step as the height at which the basins hold the planet's water (or the height that gives a chosen ocean cover). Ice sheets lock part of the water at the end.

**The start is a Pangea.** The planet begins as the end of an earlier supercontinent cycle: one connected, lobed supercontinent holding 40% of the surface as continental crust (shelves included), with a first rift already open along a line that bends at the thousand-kilometer scale and steps sideways at transform faults, a V-shaped young ocean closed at its hinge, often a failed third arm notching the coast, and sometimes a far microcontinent traveling alone. Margins facing the young ocean are stretched and wide, those facing the old ocean narrow and active; shields and basins vary the interior thickness by 5 km; a strip of sea floor along every coast rides with its continent so the subduction zone sits offshore; the oceanic plates converge on the supercontinent, as Panthalassa did on Pangea.

**Forces.** Slab pull is the engine: a plate whose oceanic edge sinks is pulled toward that trench, faster the longer the trench; a continent entering the trench breaks the slab off and the pull is gone. A continental collision brakes both plates in proportion to the length of the suture. A slow random walk of the poles adds variety, and speeds relax only weakly toward a typical value, so a braked plate stays slow and the seas it had not closed survive.

**Events.** A supercontinent rifts whether it moves or not (it insulates the mantle); smaller continents rift once they have been locked for a while. The line runs off-center so splits are uneven, and four rifts in ten are born to fail: they hinge inside the continent, open a gulf for a few tens of steps and weld back. Plates locked along a long continental suture merge. Where old sea floor sinks, the trench rolls back and the overriding plate's arc swings out like a door hinged at one end, leaving a peninsula and a triangular marginal sea; where a continental coast slides past an oceanic plate, a sliver of it is captured and travels with that plate. Volcanic arcs grow on the overriding cells next to a trench, keep their polarity, and once they carry 8 km of volcanic rock they become buoyant continental crust that accretes instead of subducting; continental margins above a trench shorten and thicken (the Andes owe their crust to compression more than to magma). Eight hotspots fixed in the mantle leave island chains.

**Erosion and deposition.** Each step, land loses a fraction of its height to its lowest neighbor; every five steps the rivers of the current relief, fed by the climate solved inside the loop every 25 steps, erode by stream power (discharge and slope) and carry the material to their mouths, where deltas fill the water body up to the water surface and no higher. Crust thicker than 45 km flows toward thinner neighbors (plateau building) and never exceeds 70 km divided by the surface gravity, so a heavier planet has lower mountains. Erosion lowers the surface by only 150 m per kilometer of crust removed, because the root rebounds.

## 3. Hydrology

Every cell drains to its lowest neighbor after depressions are filled (priority flood). A depression whose potential evaporation exceeds its inflow is an endorheic lake: its level drops until evaporation balances inflow, like the Caspian or the Aral. Runoff follows Budyko's curve: the share of rain that reaches rivers depends on the ratio of potential evaporation to rainfall, a few percent in deserts, half in the wet tropics, about 0.35 for the land as a whole. Discharge accumulates downstream in cubic kilometers per year; the map draws rivers from 40 km3 per year, wider with the logarithm of discharge.

## 4. Climate

**Insolation** is the exact daily mean at twelve dates of the year, from obliquity, eccentricity and the solar constant.

**Temperature** solves the two-dimensional energy-balance model of North, Cahalan and Coakley on the sphere: absorbed sunlight equals outgoing longwave radiation (237 + 2.09 T watts per square meter under a clear sky, offset by the greenhouse and air-pressure parameters, minus what the clouds trap) plus the divergence of a diffusive heat transport, five times stronger inside the Hadley cell. The clear-sky albedo is 0.10 on the ocean, 0.16 on land and 0.56 on ice; under cloud the sunlight reflects between a cloud of albedo 0.30 and the surface, so clouds double the ocean's reflection and barely brighten an ice sheet. The ice extent is iterated with the temperature so the ice-albedo feedback is in the solution. Height cools the surface by the lapse rate measured from the mean surface, not from sea level, so a land-heavy planet does not freeze for being high. The seasonal swing follows the surface's heat capacity: large over continental interiors, small over oceans.

**Circulation and oceans.** Winds follow the Hadley, Ferrel and polar cells with the Coriolis deflection of the planet's spin. Ocean gyres are Stommel's wind-driven circulation solved per basin, and their currents carry heat: a warm western boundary current warms the coast it reaches and the cold return current cools the other side.

**Moisture.** Evaporation from the oceans (and 60% recycled over land) is advected by the winds and spread by eddies, raining out over nine days and faster where air converges or rises over mountains; the result is the annual and monthly precipitation. Ice sheets form where the warmest month stays below freezing and sea ice where the water stays below -1.8 C; the water they lock lowers the sea.

**Clouds and sunshine.** The cover of each cell and month comes out of the moisture solve: humidity cloud where the column of vapor approaches what air at that temperature holds, lifted cloud where the wind climbs or converges (never overcast: convective cloud is intermittent), a deck over open water, stratus over cold currents, and clearing where the air sinks under the subtropical highs or in the lee of a range. Clouds reflect sunlight and trap longwave (more under the cold tops of lifted cloud), so the climate is solved twice: once under Earth's mean cover, once under the cover the first solution produced. On the real Earth the clouds cover 61% of the sky, reflect 45 W/m² and trap 24 (observed about 0.66, 47 and 27). Sunshine is the daylight not under cloud, broken cloud letting a fifth of the direct sun through: Sahara 4,300 hours a year, Manaus 1,900, London 2,000 (observed 3,600, 1,900, 1,600).

**Biomes** are Koppen-Geiger classes from monthly temperature and precipitation: tropical, arid, temperate, continental and polar families with their subtypes, colored by family on the map.

## 5. The real Earth

The Real Earth button builds the measured relief (NOAA ETOPO5 at half a degree) through the same hydrology, climate, ice and biome links, and then streams twenty reconstructed reliefs of the past (PALEOMAP PaleoDEMs by Scotese and Wright, 2018, CC BY 4.0, one slice every ten million years from 200 Ma) as a history, each with the simulator's climate on top. The present is where the climate links were calibrated: a global mean of 14.5 C, 26.9 C at the equator, New York at 13 C, the Amazon at 24 C and 2,700 mm, land precipitation near 1,000 mm.

## 6. How the planets compare with Earth

| Quantity | Simulated planets (Earth preset) | Earth |
|---|---|---|
| Ocean cover | 66 to 74% | 71% |
| Landmasses above a million km2 | 4 to 9 | 4 to 7 (with Greenland) |
| Largest landmass, share of the land | 35 to 85% | 57% (Afro-Eurasia) |
| Mean land elevation | 0.3 to 1.0 km | 0.84 km (about 0.65 without ice) |
| Surface above 1.5 km | 1 to 7% | 6% (about 3% without ice) |
| Mean ocean depth | 3.5 to 4.0 km | 3.7 km |
| Mean temperature | 11 to 14 C | 14.5 C |
| Plates alive after 200 steps | 13 to 19 | 7 major, 8 minor |

## 7. Known deviations

The boreal belt runs 3 to 7 C too cold, so tundra replaces taiga (London 4 C against 11; it was 1 before the clouds); the subtropical deserts are still 5 to 7 C too cool (the Sahara 19 against 26; it was 14); permanent sea ice is overestimated; the polar plateaus get too much rain and therefore too much cloud, and regions the moisture model leaves too dry (Japan, the Pampas) come out too sunny; the seven resources are the only ones, shield ores fill whole shields rather than a few provinces, and the real Earth shows no deposits until the measured data is converted; planets with their land clustered in one hemisphere come out one to three degrees colder and more arid than Earth; plate boundaries are jagged at the cell scale; a few dozen one-cell suture spikes remain after collisions; the past greenhouse (the Cretaceous had several times today's CO2) is not applied to the Earth's history, so its past climates come out cooler than they were; the reconstructions are at one degree and infer coastlines and bathymetry.

## 8. Why it is built this way

- **Crust as parcels in plate frames.** A rigid rotation of a lattice onto itself cannot be exact; storing crust in the plate's own frame and treating the world map as a view keeps mass conserved and lets plates move for hundreds of steps without smearing.
- **One step is a million years and a cell is 112 km.** Plates move a third of a cell per step (3 cm per year), so the loop needs no sub-stepping, and the 200-step default is Earth's time since Pangea's breakup. Constants in reference cells make the fine grid the same planet.
- **A Pangea start rather than noise.** Noise blobs gave every plate a round continent of similar size; a triple junction of straight rifts gave convex wedges. Earth's shapes come from a history: complementary coastlines, uneven splits, gulfs from failed rifts, seaways closed by collisions, arcs that dock. The initial condition only provides the supercontinent and its first rift; the rest is simulated.
- **Slab pull and break-off.** Without a force toward trenches, continents never reassemble; with pull that never stops, every seaway closes. Pull that dies when a continent reaches the trench reassembles continents and leaves Mediterraneans.
- **Small plates.** Twelve large plates cannot make Europe or Central America; marginal seas behind rolling-back arcs, peninsulas hinged at one end and captured slivers are what dissect coasts.
- **Energy balance instead of prescribed temperatures.** A climate solved from absorbed sunlight and outgoing radiation responds to insolation, greenhouse, pressure, albedo and geography, so the parameters mean something and a snowball or a hothouse emerges rather than being drawn.
- **Low platforms and Budyko runoff.** Where the surface lies within 200 m of the sea, small differences decide land from water, which is where intricate coasts come from; rivers that only flow where rain exceeds evaporation keep deserts dry.
- **Calibration against the real Earth.** Every link is run on the measured relief, and the numbers above are the honest residue: the places where the model is still wrong are listed, not hidden.

## 9. Beyond geography: resources

Everything past the physical geography sits behind the "Beyond geography" checkbox, so whoever wants only the planet sees only the planet. Switched on, a second layer menu appears with the layers beyond, the explain drawer gains their sections and the statistics their rows.

**Minerals from the provenance.** Seven resources get a potential from 0 to 1 in every cell, each read from what the tectonic history recorded, never painted. Shields, the continental crust that has been there since the planet's start, never thinned by rifting and not in a collision for sixty steps, carry iron (the banded iron formations) and uranium (the granites of old cratons), as provinces within the shield rather than the whole of it, and uranium also in the sandstone basins beside them. Volcanic arcs over subduction carry copper, strongest within three cells of their trench and once erosion has cut into them. Collision belts thicker than 42 km carry gold and tin, again once exposed. Coal, oil and salt are bookkept on the crust parcels while the loop runs, so they travel with the plates: sediment laid down in a lake or on a flood plain where it is warmer than 15 °C with more than a meter of rain is a swamp and counts toward coal; sediment laid down in a sea shallower than 500 m over continental crust warmer than 18 °C counts toward oil source rock, which later needs burial; closed-basin lakes whose evaporation outruns their inflow lay down salt. A collision keeps both sides' coal and salt and cooks out half of the oil; a subduction scrapes half of the sea floor's organic sediment onto the margin.

**Deposits from potentials.** Real deposits are sparse points. Cell by cell, a hash of the seed is compared with the potential, so a planet gets fixed, sparse deposits that are dense where the potential is high and absent where it is zero, and nothing about the geography changes. On the Earth preset a planet gets a few hundred deposits of each resource: copper along the arcs, coal on the deltas and lake shores, salt in the closed basins of the interiors, gold in the collision belts, iron and uranium in the old interiors.

**The real Earth** has no tectonic history here, so its potentials are zero; it shows measured deposits from the USGS Mineral Resources Data System once that public-domain file has been converted and shipped, and says "not available" until then.

## 10. Beyond geography: flora

**Growth.** Every land cell gets a net primary productivity from the Miami model (Lieth 1975): the lesser of a warmth curve and a rainfall curve fitted to measured stands, 3,000 grams of dry matter per square meter a year at most, of which 45% is carbon; a sunny sky adds up to a fifth and a cloudy one takes a fifth; the soil scales it from 0.6 on barren ground to 1.4 on the richest. The real Earth comes out at 52 Gt of carbon a year on land (measured about 56), with the Amazon near 900 g C/m² and the Sahara under 150.

**Soil.** Fertility is itemized from what the simulator stored: a base of 0.45, up to 0.3 more under volcanic ash (the volcanic rock of arcs and hotspots), up to 0.25 more on flood plains of large rivers and in basins filled with sediment, minus up to 0.25 for leaching where it is hotter than 20 °C and wetter than 1,500 mm (the Amazon's soils are poor for that reason), minus 0.1 on old shields that have been weathering since the planet's start, minus 0.15 where the annual mean is below freezing; ice sheets have none.

**Vegetation (see below for the fauna).** Thirteen classes richer than Köppen's letters, read from the monthly climate, the rivers and the productivity: ice or bare rock, tundra where no month reaches 10 °C, boreal forest where winters freeze and summers stay under 18 °C, temperate forest and temperate rainforest (over 1,500 mm), steppe and prairie, Mediterranean woodland where the summer gets less than half the winter's rain, semi-arid scrub, desert under 250 mm, savanna and tropical seasonal forest where a month runs dry, tropical rainforest above 1,800 mm without a dry month, and wetland on the flood plains of large river mouths and lake shores. There is no succession: the cover is what the current climate supports, so a climate that shifts between two steps of the timeline shifts its forests at once.

## 11. Beyond geography: fauna

**Lineages that ride the plates.** Every piece of crust carries a vector over eight ancestral faunas. At the start, each compass sector of 45 degrees around the supercontinent's center gets its own, and the lineages are named by them: northern, north-eastern, and so on round to north-western (on the real Earth, which has no history here, each of the eight largest landmasses seeds one, named by that landmass). From then on, at every fluvial pass, every region of continuous easy ground (neither desert, high mountain nor polar cold) moves a quarter of the way toward its own mean fauna, so a continent of uniform habitat shares one fauna within a few tens of million years, as the real interchanges did; the fauna also diffuses to its land neighbors, twenty times slower through deserts, above 2,500 m and below -10 C, and never across the sea. So a continent that split off early keeps the lineages it left with, a strait that opened late divides two faunas that are still alike, a collision lets two faunas mix within tens of steps, a desert or a mountain belt keeps two faunas apart on one continent, and an island that rises from the sea takes the fauna of the land it joins.

**Reading the realm map.** The map is the dominant lineage of each cell, its color blended toward the second lineage by their shares and paler where the dominant one holds a smaller share, so a mixed fauna reads as a gradient and a sharp edge means a barrier: a sea, a desert, a mountain belt, polar ground. Each realm's name is written at the heart of its largest region, the legend names the eight lineages, and the explain drawer says, for any cell, which lineage dominates, what share it holds, where it began, and which other faunas mixed into it. It is an outcome of the plate history, not a drawing.

**What a fauna supports.** Endemism is the share of a cell's fauna found on no other landmass. Richness follows the two oldest rules of ecology: the species-energy relation (more growth, more species, as the square root of the productivity) and the species-area relation (bigger landmasses hold more, as the logarithm of the area from 10,000 to 10 million km²). Large herbivores need productive ground on a landmass above 200,000 km², large predators a landmass above a million (Madagascar kept the first and lost the second).

**Honest limits.** There is no speciation: isolation preserves a fauna, it does not create one, so a long-isolated island keeps the continent's lineage rather than growing its own. The real Earth has no plate history here, so its realms are the present connectivity: one lineage per large landmass, and the Americas share Afro-Eurasia's through the Bering cell.

## 12. Beyond geography: civilization

**Indices, not a script.** Where people could live is the square root of food times fresh water, under the thermal comfort of the annual mean and the seasons (and, since the composition chapter, the air). The candidate cities are ranked by the site score alone, the weighted sum of eight terms times comfort and air, each at least 500 km from the ones before; habitability does not rank them, and the City sites legend lists the scores with that rule. Where they could farm is the soil times the growth times how suitable the vegetation is, best on the seasonal grasslands, the Mediterranean woodlands and the flood plains where the cereals were domesticated. Where they would build a city is a weighted sum of eight terms, every one of them shown in the explain drawer: a river (or its mouth), a sheltered harbor, fresh water, farmland within three hundred kilometers, a defensible height, safety from plate boundaries and volcanoes, minerals within reach, and centrality on the landmass. The thirty best sites, each five hundred kilometers from the next, are the candidate cities of antiquity, numbered on the map. On the real Earth they fall on the Tagus, the Nile's neighborhood, the Aegean, the Colorado and Sacramento, Puget Sound, the Dnieper, the valley of Mexico and the Peruvian coast; the Asian river valleys are missed because the moisture model leaves the monsoon lands too dry.

**How people spread.** The origin is chosen by rule: the most habitable savanna or seasonal forest of the largest landmass within the tropics (West Africa, on the real Earth). From it a shortest path crosses the land at a quarter of a thousand years per cell, slower over mountains, deserts and tundra, faster along coasts, never onto ice sheets, and crosses the sea at six times the cost per cell of open water except where the glacial sea level, 120 m lower, exposes the floor (Bering, Sunda, Sahul). The real Earth comes out with Europe reached 10 thousand years after the origin, Siberia 23, Australia 50, Alaska 41, Patagonia 54 and Antarctica never; the real spread took about sixty thousand years to Patagonia, with Australia at fifty. Domestication, the spread of farming, trade routes and populations are the next slices of this phase.

## 13. Composition: oxygen, carbon and the crust

**Three more dials, exactly Earth by default.** The oxygen fraction of the air (Earth 0.21), the crustal iron and the crustal metals (copper, gold and tin, uranium; relative to Earth) join the parameters, and the greenhouse parameter, defined as a logarithmic forcing like carbon dioxide, now also acts as the CO2 that plants breathe. Every factor they introduce equals exactly 1 at Earth's values, so no planet built before changes, and the real Earth, built with Earth's composition, changes only above 5,000 m.

**Oxygen.** Plants: photorespiration lowers C3 growth as the oxygen rises (0.85 at 30 %, 1.15 at 12 %), and fire, whose frequency rises steeply with the oxygen, moves the two thresholds that separate forest from grassland in the seasonal climates: at 30 % the seasonal forests burn into savanna, at 15 % the forest takes the savanna. Animals: large active bodies need oxygen; the productivity a large herbivore needs rises as the aerobic scope falls (none below 10 %), and above 27 % the giant arthropods of the Carboniferous get their own mark on the Megafauna layer. Oil: an anoxic sea preserves the organic matter, so the source rock scales with Earth's oxygen over the planet's. People: the oxygen partial pressure (oxygen times air pressure) shifts Earth's habitation heights by the scale height; on Earth people live fully up to 5,000 m and not above 6,500; at 12 % oxygen the ceiling drops to 1,800 m, and the Thin air preset (0.3 bar) has no people at all, which is what the physics says. The air term multiplies the habitability and the city-site score, and the dispersal cannot cross the ceiling.

**Carbon.** Growth rises with the logarithm of the greenhouse parameter, +28 % per doubling as in the free-air CO2 enrichment experiments, floored at half; through the growth it reaches the richness and megafauna of the fauna and the food of the civilization. The climate warms at the same time, as before.

**The crust.** The iron abundance multiplies the iron potential, the metals abundance the copper, gold and uranium potentials, before the deposits are drawn; the draw does not change, so a richer planet carries a superset of a poorer planet's deposits. What these dials do not do: change the climate (oxygen is not a greenhouse gas; the pressure stays its own parameter), the relief, or the soil (volcanic ash is fertile for its phosphorus, potassium and calcium, not its iron).
`;

/** Render the markdown subset above to HTML. */
export function renderModel(text: string = MODEL_TEXT): string {
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string): string =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = text.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flushParagraph = (): void => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushTable = (): void => {
    if (table.length) {
      const [head, ...rows] = table;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    }
    table = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushTable();
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flushAll();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (line.startsWith('- ')) {
      flushParagraph();
      flushTable();
      list.push(line.slice(2));
      continue;
    }
    if (line.startsWith('|')) {
      flushParagraph();
      flushList();
      // The separator row under a table's header: only pipes, dashes, colons and spaces.
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      table.push(line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim()));
      continue;
    }
    flushList();
    flushTable();
    paragraph.push(line);
  }
  flushAll();
  return out.join('\n');
}
