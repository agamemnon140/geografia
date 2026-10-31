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

The planet is a subdivided icosahedron: 40,962 cells of about 112 km for an Earth-sized planet (level 6), 163,842 cells of 55 km with the Fine grid option (level 7). Fields live on the cells; the renderer interpolates them per pixel. One tectonic step is one million years, and the default history of 200 steps is the time since Pangea began to break. Every constant written "per cell" means a reference cell of 112 km, converted to the grid in use, so the fine grid gives the same planet in kilometers, only sharper.

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

The boreal belt runs 5 to 9 C too cold, so tundra replaces taiga; the subtropical deserts are too cool (clear skies are not in the balance); permanent sea ice is overestimated; planets with their land clustered in one hemisphere come out one to three degrees colder and more arid than Earth; plate boundaries are jagged at the cell scale; a few dozen one-cell suture spikes remain after collisions; the past greenhouse (the Cretaceous had several times today's CO2) is not applied to the Earth's history, so its past climates come out cooler than they were; the reconstructions are at one degree and infer coastlines and bathymetry.

## 8. Why it is built this way

- **Crust as parcels in plate frames.** A rigid rotation of a lattice onto itself cannot be exact; storing crust in the plate's own frame and treating the world map as a view keeps mass conserved and lets plates move for hundreds of steps without smearing.
- **One step is a million years and a cell is 112 km.** Plates move a third of a cell per step (3 cm per year), so the loop needs no sub-stepping, and the 200-step default is Earth's time since Pangea's breakup. Constants in reference cells make the fine grid the same planet.
- **A Pangea start rather than noise.** Noise blobs gave every plate a round continent of similar size; a triple junction of straight rifts gave convex wedges. Earth's shapes come from a history: complementary coastlines, uneven splits, gulfs from failed rifts, seaways closed by collisions, arcs that dock. The initial condition only provides the supercontinent and its first rift; the rest is simulated.
- **Slab pull and break-off.** Without a force toward trenches, continents never reassemble; with pull that never stops, every seaway closes. Pull that dies when a continent reaches the trench reassembles continents and leaves Mediterraneans.
- **Small plates.** Twelve large plates cannot make Europe or Central America; marginal seas behind rolling-back arcs, peninsulas hinged at one end and captured slivers are what dissect coasts.
- **Energy balance instead of prescribed temperatures.** A climate solved from absorbed sunlight and outgoing radiation responds to insolation, greenhouse, pressure, albedo and geography, so the parameters mean something and a snowball or a hothouse emerges rather than being drawn.
- **Low platforms and Budyko runoff.** Where the surface lies within 200 m of the sea, small differences decide land from water, which is where intricate coasts come from; rivers that only flow where rain exceeds evaporation keep deserts dry.
- **Calibration against the real Earth.** Every link is run on the measured relief, and the numbers above are the honest residue: the places where the model is still wrong are listed, not hidden.
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
