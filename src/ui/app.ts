import { GlobeView } from '../render/globe.ts';
import { renderModel } from './model.ts';
import { cellColors, layerById, layersOfGroup, paintCells, type LayerGroup } from '../render/layers.ts';
import { renderLegend } from '../render/legend.ts';
import { MapView } from '../render/map.ts';
import { equirectRaster } from '../render/raster.ts';
import { paintThumbnail } from '../render/thumbnail.ts';
import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { Grid } from '../sim/grid/grid.ts';
import { CURRENT_MILESTONE, EARTH, PARAM_SPECS, PRESETS, type PlanetParams } from '../sim/params.ts';
import type { World } from '../sim/pipeline.ts';
import { VEG_BOREAL, VEG_DESERT, VEG_MEDITERRANEAN, VEG_RAINFOREST, VEG_SAVANNA, VEG_SCRUB, VEG_SEASONAL, VEG_STEPPE, VEG_TEMPERATE, VEG_TEMPERATE_RAIN } from '../sim/biosphere/flora.ts';
import { MINERALS, MINERAL_NAMES } from '../sim/resources/minerals.ts';
import { LAIR_CODES, LAIR_COUNT, LAIR_SPACING_KM, MONSTERS, PEOPLES } from '../sim/fantasy/fantasy.ts';
import type { WorldStats } from '../sim/stats.ts';
import { SimClient } from '../worker/client.ts';
import { explainCell, sampleName } from './explain.ts';
import { paramsFromHash, paramsToHash } from './url.ts';

/** Full builds kept for the gallery (each holds a few tens of megabytes of fields). */
const GALLERY_SIZE = 6;
/** Delay after the last parameter edit before the automatic preview starts. */
const PREVIEW_DEBOUNCE_MS = 500;
/** localStorage key of the "Beyond geography" toggle. */
const BEYOND_KEY = 'geografia.beyond';
/** The "Fantasy" toggle (M28), independent of the one above: the sandbox rules' layers, explain section and statistics rows. */
const FANTASY_KEY = 'geografia.fantasy';
/** The groups of the second dropdown and the toggle that shows each. */
const GROUPS: { group: LayerGroup; label: string; toggle: 'beyond' | 'fantasy' }[] = [
  { group: 'resources', label: 'Resources', toggle: 'beyond' },
  { group: 'life', label: 'Life', toggle: 'beyond' },
  { group: 'civilization', label: 'Civilization', toggle: 'beyond' },
  { group: 'fantasy', label: 'Fantasy (sandbox rules)', toggle: 'fantasy' },
];
/** Timeline keyframes: one every KEYFRAME_INTERVAL_MA million years, at most KEYFRAMES per full build (fewer on the largest grids to bound memory); the interval widens when the age needs more (M25). */
const KEYFRAME_INTERVAL_MA = 25;
const KEYFRAMES = 8;
const KEYFRAMES_LARGE_GRID = 4;
/** Milliseconds per keyframe when the history plays. */
const PLAY_INTERVAL_MS = 900;
/** Frame size and columns of the exported history strip. */
const STRIP_FRAME_W = 480;
const STRIP_FRAME_H = 240;
const STRIP_COLUMNS = 3;

type ViewId = 'map' | 'equalEarth' | 'globe' | 'compare' | 'model';

/** A full build: its final world and, for the most recent one, the timeline keyframes (oldest first). */
interface GalleryEntry {
  world: World;
  keyframes: World[];
  element: HTMLElement;
}

function template(): string {
  const presetOptions = PRESETS.map((p) => `<option value="${p.name}">${p.name}</option>`).join('');
  const layerOptions = layersOfGroup('geography').map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
  // The optgroups beyond geography are filled at runtime from the toggles (renderGroupOptions).
  const beyondOptions = '<option value="">— the geography layer above —</option>';
  const paramRows = PARAM_SPECS.map((s) => {
    const inactive = s.wiredIn > CURRENT_MILESTONE;
    const cls = inactive ? 'inactive' : '';
    const title = inactive ? `Takes effect from milestone M${s.wiredIn}. ${s.help}` : s.help;
    return `
      <span class="name ${cls}" title="${title}">${s.label}</span>
      <input type="number" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" ${inactive ? 'disabled' : ''} title="${title}" />
      <span class="unit ${cls}">${s.unit}</span>`;
  }).join('');
  return `
    <div class="layout">
      <aside class="panel">
        <h1>geografia</h1>
        <div class="row">
          <label>Preset <select id="preset">${presetOptions}</select></label>
        </div>
        <h2>Parameters</h2>
        <div class="params">${paramRows}</div>
        <div class="row">
          <button id="build" class="primary" title="Full resolution with its history; the result joins the gallery">Build planet</button>
          <button id="variation" title="Keep the parameters, draw a new seed">New variation</button>
        </div>
        <div class="row">
          <button id="realEarth" title="The real relief (NOAA ETOPO5) with the simulator's own rivers, climate and biomes, for comparison">Real Earth</button>
        </div>
        <div class="row">
          <label class="check"><input type="checkbox" id="autoPreview" checked /> Preview on change (coarser grid, under 2 s)</label>
          <label class="check"><input type="checkbox" id="fineGrid" /> Fine grid for full builds (cells of 55 km, four times as many; several times slower)</label>
        </div>
        <progress id="progress" max="1" value="0"></progress>
        <div id="status" class="status"></div>
        <h2>Layer</h2>
        <select id="layer">${layerOptions}</select>
        <label class="check"><input type="checkbox" id="beyond" /> Beyond geography: resources, life, civilization</label>
        <label class="check"><input type="checkbox" id="fantasy" /> Fantasy (sandbox rules): peoples and monsters</label>
        <select id="layerBeyond" class="hidden" title="Layers beyond the geography and the fantasy rules; choosing one here shows it instead of the layer above">${beyondOptions}</select>
        <div id="sampleRow" class="row hidden">
          <label>Month <input type="range" id="sample" min="0" max="${SAMPLES}" step="1" value="${ANNUAL}" /></label>
          <span id="sampleLabel" class="unit">annual</span>
        </div>
        <div id="legend" class="legend"></div>
        <div class="row">
          <button id="exportPng" title="The view on screen as PNG">Export PNG</button>
          <button id="exportJson" title="Parameters and statistics as JSON">Export JSON</button>
          <button id="copyLink" title="The URL hash holds the parameters; share it to rebuild this planet">Copy link</button>
        </div>
        <h2>Statistics</h2>
        <table id="stats" class="stats"></table>
        <div id="events" class="inspector"></div>
        <h2>Explain</h2>
        <div id="inspector" class="inspector">Click the map to see why a cell is what it is.</div>
      </aside>
      <main class="center">
        <div class="viewbar">
          <div class="views">
            <button data-view="map" class="active" title="Equirectangular map">Map</button>
            <button data-view="equalEarth" title="Equal Earth projection: equal-area, the whole world at once">Equal Earth</button>
            <button data-view="globe" title="Drag to turn, click to inspect">Globe</button>
            <button data-view="compare" title="Two steps or two planets side by side">Compare</button>
            <button data-view="model" title="The physics and the rationale of the simulator">Model</button>
          </div>
          <label id="compareControls" class="compare-controls hidden">B: <select id="compareSelect"></select></label>
          <span id="viewHint" class="hint"></span>
        </div>
        <div class="stage">
          <div id="stageMap" class="pane"><canvas id="map"></canvas></div>
          <div id="stageGlobe" class="pane hidden"><canvas id="globe"></canvas></div>
          <div id="stageCompare" class="pane compare hidden">
            <div class="compare-pane"><div id="titleA" class="pane-title">A</div><canvas id="mapA"></canvas></div>
            <div class="compare-pane"><div id="titleB" class="pane-title">B</div><canvas id="mapB"></canvas></div>
          </div>
          <div id="stageModel" class="pane model hidden"><article class="model-text">${renderModel()}</article></div>
        </div>
        <div id="timelineRow" class="timeline hidden">
          <button id="play" title="Play the history">Play</button>
          <input type="range" id="timeline" min="0" max="0" step="1" value="0" />
          <span id="timelineLabel" class="label"></span>
          <button id="exportFrames" title="Every keyframe of the current layer in one PNG strip">Export history</button>
        </div>
        <div id="gallery" class="gallery"></div>
      </main>
    </div>`;
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = template();
  const q = <T extends Element>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element ${selector}`);
    return el;
  };
  const presetSelect = q<HTMLSelectElement>('#preset');
  const buildButton = q<HTMLButtonElement>('#build');
  const variationButton = q<HTMLButtonElement>('#variation');
  const realEarthButton = q<HTMLButtonElement>('#realEarth');
  const autoPreview = q<HTMLInputElement>('#autoPreview');
  const fineGrid = q<HTMLInputElement>('#fineGrid');
  const progress = q<HTMLProgressElement>('#progress');
  const status = q<HTMLDivElement>('#status');
  const layerSelect = q<HTMLSelectElement>('#layer');
  const beyondCheck = q<HTMLInputElement>('#beyond');
  const fantasyCheck = q<HTMLInputElement>('#fantasy');
  const layerBeyond = q<HTMLSelectElement>('#layerBeyond');
  const sampleRow = q<HTMLDivElement>('#sampleRow');
  const sampleInput = q<HTMLInputElement>('#sample');
  const sampleLabel = q<HTMLSpanElement>('#sampleLabel');
  const legendBox = q<HTMLDivElement>('#legend');
  const exportPngButton = q<HTMLButtonElement>('#exportPng');
  const exportJsonButton = q<HTMLButtonElement>('#exportJson');
  const copyLinkButton = q<HTMLButtonElement>('#copyLink');
  const statsTable = q<HTMLTableElement>('#stats');
  const eventsBox = q<HTMLDivElement>('#events');
  const inspector = q<HTMLDivElement>('#inspector');
  const viewButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.views button'));
  const compareControls = q<HTMLLabelElement>('#compareControls');
  const compareSelect = q<HTMLSelectElement>('#compareSelect');
  const viewHint = q<HTMLSpanElement>('#viewHint');
  const stageMap = q<HTMLDivElement>('#stageMap');
  const stageGlobe = q<HTMLDivElement>('#stageGlobe');
  const stageCompare = q<HTMLDivElement>('#stageCompare');
  const stageModel = q<HTMLDivElement>('#stageModel');
  const titleA = q<HTMLDivElement>('#titleA');
  const titleB = q<HTMLDivElement>('#titleB');
  const timelineRow = q<HTMLDivElement>('#timelineRow');
  const timeline = q<HTMLInputElement>('#timeline');
  const timelineLabel = q<HTMLSpanElement>('#timelineLabel');
  const playButton = q<HTMLButtonElement>('#play');
  const exportFramesButton = q<HTMLButtonElement>('#exportFrames');
  const gallery = q<HTMLDivElement>('#gallery');
  const inputs = new Map<keyof PlanetParams, HTMLInputElement>();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-key]')) {
    inputs.set(input.dataset.key as keyof PlanetParams, input);
  }

  const map = new MapView(q<HTMLCanvasElement>('#map'));
  const globe = new GlobeView(q<HTMLCanvasElement>('#globe'));
  const mapA = new MapView(q<HTMLCanvasElement>('#mapA'));
  const mapB = new MapView(q<HTMLCanvasElement>('#mapB'));
  const client = new SimClient();
  /** The world on screen (a final world, a preview, or a keyframe). */
  let world: World | null = null;
  /** The world in pane B of the compare view. */
  let compareWorld: World | null = null;
  /** The gallery entry whose timeline is on the slider. */
  let current: GalleryEntry | null = null;
  let view: ViewId = 'map';
  /** Views whose canvas does not show `world` yet. */
  const stale = new Set<ViewId>();
  let building = false;
  let queued: 'preview' | 'full' | null = null;
  let selectedCell = -1;
  let sample = ANNUAL;
  /** The "Beyond geography" toggle (M21): off, the app shows geography only. Remembered per browser and in the link. */
  let beyond = localStorage.getItem(BEYOND_KEY) === '1' || new URLSearchParams(location.hash.slice(1)).get('beyond') === '1';
  /** The "Fantasy" toggle (M28), on its own. */
  let fantasy = localStorage.getItem(FANTASY_KEY) === '1' || new URLSearchParams(location.hash.slice(1)).get('fantasy') === '1';
  /** Whether a layer group (or explain section) is on: geography always, fantasy by its toggle, the rest by the beyond toggle. */
  const groupEnabled = (g?: LayerGroup): boolean => !g || g === 'geography' || (g === 'fantasy' ? fantasy : beyond);
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  /** The history slider stays on the final world while keyframes arrive, until the user moves it. */
  let followLatest = true;
  const entries: GalleryEntry[] = [];

  const setParams = (p: PlanetParams): void => {
    for (const [key, input] of inputs) input.value = String(p[key]);
  };
  const readParams = (): PlanetParams => {
    const p = { ...EARTH };
    for (const [key, input] of inputs) p[key] = Number(input.value);
    return p;
  };

  const pct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)} %`;
  /** The parameters as a link, with the toggle when it is on. */
  const linkHash = (p: PlanetParams): string => paramsToHash(p) + (beyond ? '&beyond=1' : '') + (fantasy ? '&fantasy=1' : '');
  /** The layer on screen: the one beyond geography when chosen, else the geography one. */
  const activeLayerId = (): string => (layerBeyond.value && groupEnabled(layerById(layerBeyond.value).group) ? layerBeyond.value : layerSelect.value);
  const forestShare = (v: number[]): number => v[VEG_BOREAL] + v[VEG_TEMPERATE] + v[VEG_TEMPERATE_RAIN] + v[VEG_MEDITERRANEAN] + v[VEG_SEASONAL] + v[VEG_RAINFOREST];
  const grassShare = (v: number[]): number => v[VEG_STEPPE] + v[VEG_SAVANNA];
  const dryShare = (v: number[]): number => v[VEG_SCRUB] + v[VEG_DESERT];
  /** The realms of a world, largest first: each lineage's share of the land and the landmass holding most of it (M27). */
  const realmList = (w: World): string => {
    const ranks = w.landmassAreas.map((a, id) => [a, id] as const).sort((p, q) => q[0] - p[0]).map(([, id]) => id);
    const rankOf = (id: number): string => {
      const r = ranks.indexOf(id) + 1;
      return r === 1 ? 'the largest landmass' : r === 2 ? 'the 2nd landmass' : r === 3 ? 'the 3rd landmass' : `the ${r}th landmass`;
    };
    return w.stats.realmShares
      .map((share, k) => ({ share, k }))
      .filter(({ share }) => share >= 0.005)
      .sort((a, b) => b.share - a.share)
      .map(({ share, k }) => `${w.lineageNames[k]} ${pct(share, 0)} of the land${w.stats.realmMainLandmass[k] >= 0 ? ` (mostly ${rankOf(w.stats.realmMainLandmass[k])})` : ''}`)
      .join(', ');
  };
  /** Rows shown only beyond geography. */
  const beyondRows = (w: World): [string, string][] => [
    ['Deposits', w.reference && w.stats.depositCounts.every((c) => c === 0)
      ? 'not available for the measured relief (no tectonic history, no shipped data)'
      : MINERALS.map((m, k) => `${MINERAL_NAMES[m]} ${w.stats.depositCounts[k]}`).join(', ')],
    ['Primary production', `${w.stats.landNppGtC.toFixed(0)} Gt C/yr on land; forest ${pct(forestShare(w.stats.vegetationShares), 0)}, grassland ${pct(grassShare(w.stats.vegetationShares), 0)}, desert and scrub ${pct(dryShare(w.stats.vegetationShares), 0)}`],
    ['Faunal realms', `${w.stats.realmCount} above a million km²${w.reference ? ' (by present connectivity: no history)' : ''}: ${realmList(w)}; mean endemism ${w.stats.meanEndemism.toFixed(2)}`],
    ['Candidate cities', w.cities.slice(0, 5).map((c, k) => `#${k + 1} site ${c.score.toFixed(2)} (habitability ${w.habitability[c.cell].toFixed(2)})`).join(', ') + ` (${w.stats.cityCount} on the city-site layer, ranked by the site score, not by habitability)`],
    ['Human dispersal', `${w.stats.landmassesReached} of ${w.stats.landmassesTotal} landmasses above 100,000 km² reached; the farthest ${w.stats.dispersalMaxKa.toFixed(0)} thousand years after the origin`],
  ];
  /** Rows shown with the fantasy toggle (M28). */
  const fantasyRows = (w: World): [string, string][] => [
    ['Fantasy peoples', PEOPLES.map((name, k) => `${name} ${pct(w.stats.fantasyShares[k], 0)}${name === 'merfolk' ? ' of the sea' : ''}`).join(', ') + ' of the land (sandbox rules: the dominant people above 0.3)'],
    ['Monster lairs', MONSTERS.map((name, m) => `${name} ${w.stats.lairCounts[m]}`).join(', ') + ` (up to ${LAIR_COUNT} each, ${LAIR_SPACING_KM.toLocaleString()} km apart; the best ${w.lairs.length ? `${LAIR_CODES[w.lairs[0].monster]}1 at ${w.lairs[0].score.toFixed(2)}` : 'none'})`],
  ];
  const statRows = (w: World): [string, string][] => {
    const s: WorldStats = w.stats;
    const k = s.koppen;
    return [
      ['Grid level', `${w.level} (${w.n.toLocaleString()} cells)${w.preview ? ', preview' : ''}${w.reference ? `, relief from ${w.reference}` : ''}`],
      ['Age since Pangea', w.reference ? 'measured relief, no tectonic history' : `${w.steps} of ${w.params.tectonicAge} million years (one tectonic step per million years)`],
      ['Active plates', `${s.activePlates} of ${w.plates.length} ever (${w.params.plateCount} at the start)`],
      ['Plate events', `${w.events.filter((e) => e.type === 'rift').length} rifts (${w.events.filter((e) => e.type === 'fail').length} failed), ${w.events.filter((e) => e.type === 'merge').length} mergers, ${w.events.filter((e) => e.type === 'rollback').length} back-arc basins, ${w.events.filter((e) => e.type === 'capture').length} coastal slivers`],
      ['Ocean / land', `${pct(s.oceanFraction)} / ${pct(s.landFraction)}`],
      ['Continents', `${s.continents} (largest ${(s.largestLandmassKm2 / 1e6).toFixed(1)} million km²), ${s.islands} islands`],
      ['Continental crust', pct(s.continentalFraction)],
      ['Highest / deepest', `${s.maxElevation.toFixed(0)} / ${s.minElevation.toFixed(0)} m`],
      ['Mean land elevation', `${s.meanLandElevation.toFixed(0)} m`],
      ['Mean ocean depth', `${s.meanOceanDepth.toFixed(0)} m`],
      ['Sea level change', `${(w.seaLevel - w.loopSeaLevel).toFixed(0)} m from ice (${(w.iceVolumeKm3 / 1e6).toFixed(1)} million km³ locked)`],
      ['Mean temperature', `${s.meanTemperature.toFixed(1)} °C (equator ${s.equatorTemperature.toFixed(0)}, poles ${s.poleTemperature.toFixed(0)})`],
      ['Seasonal range 40–60°', `land ${s.landSeasonalRange.toFixed(0)}, ocean ${s.oceanSeasonalRange.toFixed(0)} °C`],
      ['Circulation', `${s.circulationCells} cells per hemisphere, Hadley edge ${s.hadleyEdgeDeg.toFixed(0)}°`],
      ['Precipitation', `${s.meanPrecipitation.toFixed(0)} mm/yr, land ${s.meanLandPrecipitation.toFixed(0)}`],
      ['Clouds and sunshine', `${pct(s.meanCloudFraction, 0)} of the sky; land gets ${s.meanLandSunshineHours.toFixed(0)} h/yr of sun; clouds reflect ${(-s.cloudShortwaveForcing).toFixed(0)} and trap ${s.cloudLongwaveForcing.toFixed(0)} W/m²`],
      ['Desert', `${pct(s.desertFraction)} of land`],
      ['Ice sheets', `${pct(s.iceSheetFraction)} of land`],
      ['Sea ice', `${pct(s.permanentSeaIceFraction)} of ocean all year, ${pct(s.seasonalSeaIceFraction)} seasonal`],
      ['Koppen A/B/C/D/E', `${pct(k.A, 0)} / ${pct(k.B, 0)} / ${pct(k.C, 0)} / ${pct(k.D, 0)} / ${pct(k.E, 0)}`],
      ['Lakes', `${s.lakeCount} (${s.endorheicLakeCount} closed), ${pct(s.lakeFraction, 2)} of land`],
      ['Longest river', `${s.longestRiverKm.toFixed(0)} km`],
      ['Largest river', `${s.largestRiverKm3.toFixed(0)} km³/yr`],
      ['Ocean basins', `${s.oceanBasins}, strongest current ${s.strongestCurrent.toFixed(2)} m/s`],
      ['Current anomalies', `${s.warmestCurrentAnomaly.toFixed(1)} / ${s.coldestCurrentAnomaly.toFixed(1)} °C`],
    ];
  };

  const eventsText = (w: World): string => w.events
    .map((e) => e.type === 'rift' ? `step ${e.step}: plate ${e.plate} rifted from plate ${e.other}`
      : e.type === 'fail' ? `step ${e.step}: the rift failed, plate ${e.plate} welded back onto plate ${e.other}`
      : e.type === 'rollback' ? `step ${e.step}: a back-arc basin opened off plate ${e.other}; its arc became plate ${e.plate}`
      : e.type === 'capture' ? `step ${e.step}: plate ${e.plate} captured a sliver of plate ${e.other}'s coast`
      : `step ${e.step}: plate ${e.plate} merged into plate ${e.other}`)
    .join('\n');

  const renderStats = (): void => {
    if (!world) return;
    const rows = (w: World): [string, string][] => statRows(w).concat(beyond ? beyondRows(w) : [], fantasy ? fantasyRows(w) : []);
    const a = rows(world);
    const b = view === 'compare' && compareWorld ? rows(compareWorld) : null;
    const head = b ? `<tr><th></th><th>A</th><th>B</th></tr>` : '';
    statsTable.innerHTML = head + a
      .map(([key, value], i) => `<tr><td>${key}</td><td>${value}</td>${b ? `<td>${b[i][1]}</td>` : ''}</tr>`)
      .join('');
    eventsBox.textContent = eventsText(world);
  };

  const renderInspector = (cell: number, w: World = world as World, pane = ''): void => {
    if (!w) return;
    selectedCell = cell;
    const sections = explainCell(w, cell, sample).filter((s) => groupEnabled(s.group));
    if (pane) sections[0].title = `${pane}: ${sections[0].title}`;
    inspector.innerHTML = sections
      .map((section) => `<div class="section"><div class="section-title">${section.title}</div>${section.lines.map((l) => `<div>${l}</div>`).join('')}</div>`)
      .join('');
  };

  /** Where a world stands in time: million years since Pangea began to break, or, for the real Earth, million years ago. */
  const ageLabel = (w: World): string =>
    w.reference
      ? w.steps >= w.params.tectonicAge
        ? `the present (${w.reference})`
        : `${w.params.tectonicAge - w.steps} million years ago (${w.reference})`
      : `${w.steps} of ${w.params.tectonicAge} million years since Pangea began to break`;

  const worldTitle = (w: World): string =>
    w.reference
      ? w.steps >= w.params.tectonicAge
        ? `real Earth (${w.reference})`
        : `the Earth ${w.params.tectonicAge - w.steps} million years ago (${w.reference})`
      : `seed ${w.params.seed}, ${w.steps} of ${w.params.tectonicAge} million years since Pangea${w.preview ? ' (preview)' : ''}`;

  /** Paint `world` into the views that are on screen; the others catch up when shown. */
  const paintViews = (): void => {
    if (!world) return;
    for (const id of ['map', 'globe', 'compare'] as ViewId[]) stale.add(id);
    refreshVisibleViews();
  };

  const refreshVisibleViews = (): void => {
    if (!world) return;
    if ((view === 'map' || view === 'equalEarth') && stale.has('map')) {
      map.setWorld(world);
      stale.delete('map');
    } else if (view === 'globe' && stale.has('globe')) {
      globe.setWorld(world);
      stale.delete('globe');
    } else if (view === 'compare') {
      if (stale.has('compare')) {
        mapA.setWorld(world);
        stale.delete('compare');
      }
      titleA.textContent = `A: ${worldTitle(world)}`;
      if (compareWorld) {
        mapB.setWorld(compareWorld);
        titleB.textContent = `B: ${worldTitle(compareWorld)}`;
      } else {
        titleB.textContent = 'B: choose a step or a planet';
      }
    }
  };

  const showWorld = (w: World): void => {
    world = w;
    paintViews();
    renderLegend(layerById(activeLayerId()), legendBox, w);
    renderStats();
    if (selectedCell >= 0 && selectedCell < w.n) renderInspector(selectedCell);
    else {
      selectedCell = -1;
      inspector.textContent = 'Click the map to see why a cell is what it is.';
    }
  };

  /** Options for pane B: the current build's keyframes and final state, then other gallery planets. */
  const renderCompareOptions = (): void => {
    const options: string[] = [];
    if (current) {
      current.keyframes.forEach((k, i) => options.push(`<option value="k:${i}">${k.reference ? `the Earth, ${k.params.tectonicAge - k.steps} million years ago` : `this planet, ${k.steps} million years after Pangea`}</option>`));
      options.push(`<option value="k:final">this planet, final (${current.world.steps} million years)</option>`);
    }
    entries.forEach((e, i) => {
      if (e === current) return;
      options.push(`<option value="g:${i}">${e.world.reference ? 'real Earth' : `seed ${e.world.params.seed}, final (${e.world.steps} million years)`}</option>`);
    });
    const previous = compareSelect.value;
    compareSelect.innerHTML = options.join('');
    if (options.length === 0) {
      compareWorld = null;
      return;
    }
    if (Array.from(compareSelect.options).some((o) => o.value === previous)) compareSelect.value = previous;
    else compareSelect.value = current ? 'k:final' : compareSelect.options[0].value;
    applyCompareChoice();
  };

  const applyCompareChoice = (): void => {
    const value = compareSelect.value;
    if (value.startsWith('k:') && current) {
      compareWorld = value === 'k:final' ? current.world : current.keyframes[Number(value.slice(2))] ?? current.world;
    } else if (value.startsWith('g:')) {
      compareWorld = entries[Number(value.slice(2))]?.world ?? null;
    } else {
      compareWorld = null;
    }
    if (view === 'compare') {
      refreshVisibleViews();
      renderStats();
    }
  };

  const setView = (id: ViewId): void => {
    view = id;
    for (const b of viewButtons) b.classList.toggle('active', b.dataset.view === id);
    stageMap.classList.toggle('hidden', id !== 'map' && id !== 'equalEarth');
    stageGlobe.classList.toggle('hidden', id !== 'globe');
    stageCompare.classList.toggle('hidden', id !== 'compare');
    stageModel.classList.toggle('hidden', id !== 'model');
    compareControls.classList.toggle('hidden', id !== 'compare');
    map.setProjection(id === 'equalEarth' ? 'equalEarth' : 'equirect');
    viewHint.textContent = id === 'globe'
      ? 'drag to turn, click to inspect'
      : id === 'compare'
        ? 'A follows the history slider; pick B on the right; wheel zooms both panes together'
        : id === 'equalEarth'
          ? 'equal-area: sizes compare truly; drag turns the central meridian, wheel zooms, double-click resets'
          : id === 'model'
            ? 'how the simulator works and why; the full specification is docs/DESIGN.md in the repository'
            : 'wheel zooms around the cursor, drag pans, double-click shows the whole world';
    refreshVisibleViews();
    renderStats();
  };

  /** Timeline positions: the keyframes that have arrived, then the final world last. */
  const renderTimeline = (): void => {
    if (!current || current.keyframes.length === 0) {
      timelineRow.classList.add('hidden');
      return;
    }
    const total = current.keyframes.length;
    timelineRow.classList.remove('hidden');
    timeline.max = String(total);
    const position = Number(timeline.value);
    const shown = position >= total ? current.world : current.keyframes[position];
    timelineLabel.textContent = ageLabel(shown);
  };

  const showTimelinePosition = (): void => {
    if (!current) return;
    const total = current.keyframes.length;
    const position = Number(timeline.value);
    showWorld(position >= total ? current.world : current.keyframes[position]);
    renderTimeline();
  };

  const stopPlaying = (): void => {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    playButton.textContent = 'Play';
  };

  const togglePlaying = (): void => {
    if (playTimer) {
      stopPlaying();
      return;
    }
    if (!current || current.keyframes.length === 0) return;
    followLatest = false;
    playButton.textContent = 'Pause';
    if (Number(timeline.value) >= current.keyframes.length) timeline.value = '0';
    showTimelinePosition();
    playTimer = setInterval(() => {
      if (!current) return stopPlaying();
      const next = Number(timeline.value) + 1;
      if (next > current.keyframes.length) return stopPlaying();
      timeline.value = String(next);
      showTimelinePosition();
    }, PLAY_INTERVAL_MS);
  };

  const addToGallery = (w: World): GalleryEntry => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    paintThumbnail(w, canvas);
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.title = 'Click to restore this planet';
    const caption = document.createElement('div');
    caption.className = 'gallery-caption';
    caption.textContent = `${w.reference ? 'real Earth' : `seed ${w.params.seed}`} · ocean ${(w.stats.oceanFraction * 100).toFixed(0)} % · ${w.stats.meanTemperature.toFixed(0)} °C · ${w.stats.continents} continents`;
    item.append(canvas, caption);
    const entry: GalleryEntry = { world: w, keyframes: [], element: item };
    item.addEventListener('click', () => {
      stopPlaying();
      setParams(w.params);
      location.hash = linkHash(w.params);
      current = entry;
      timeline.value = String(entry.keyframes.length);
      showWorld(w);
      renderTimeline();
      renderCompareOptions();
      status.textContent = `restored seed ${w.params.seed} from the gallery${entry.keyframes.length ? '' : ' (history kept only for the latest build)'}`;
    });
    // Only the latest build keeps its history in memory.
    for (const e of entries) e.keyframes = [];
    entries.push(entry);
    gallery.prepend(item);
    while (entries.length > GALLERY_SIZE) {
      const dropped = entries.shift();
      dropped?.element.remove();
    }
    return entry;
  };

  const levelIsLarge = (p: PlanetParams): boolean => p.radiusKm > 1.3 * EARTH.radiusKm;

  const runBuild = async (mode: 'preview' | 'full'): Promise<void> => {
    if (building) {
      // A full build always wins over a pending preview.
      queued = queued === 'full' ? 'full' : mode;
      return;
    }
    building = true;
    stopPlaying();
    buildButton.disabled = true;
    variationButton.disabled = true;
    progress.value = 0;
    status.textContent = mode === 'preview' ? 'preview' : 'starting';
    try {
      const params = readParams();
      if (mode === 'full') location.hash = linkHash(params);
      let entry: GalleryEntry | null = null;
      const result = await client.build(params, {
        onProgress: (stage, fraction) => {
          progress.value = fraction;
          status.textContent = `${mode === 'preview' ? 'preview: ' : ''}${stage}`;
        },
        onKeyframe: (keyframe, index, total) => {
          if (!entry) return;
          entry.keyframes.push(keyframe);
          if (current === entry) {
            // Raise the range before moving the knob, or the browser clamps it to the old maximum.
            timeline.max = String(entry.keyframes.length);
            if (followLatest) timeline.value = String(entry.keyframes.length);
            renderTimeline();
            renderCompareOptions();
          }
          status.textContent = `history ${index + 1} of ${total}`;
        },
        onHistory: (elapsedMs) => {
          status.textContent = `history ready in ${(elapsedMs / 1000).toFixed(1)} s; drag the slider under the map or press Play`;
        },
      }, mode === 'preview'
        ? { coarser: 1 }
        : { keyframeInterval: KEYFRAME_INTERVAL_MA, keyframes: levelIsLarge(params) || fineGrid.checked ? KEYFRAMES_LARGE_GRID : KEYFRAMES, coarser: fineGrid.checked ? -1 : 0 });
      if (mode === 'full') {
        entry = addToGallery(result.world);
        current = entry;
        followLatest = true;
        timeline.max = '0';
        timeline.value = '0';
      } else {
        current = null;
      }
      selectedCell = -1;
      showWorld(result.world);
      renderTimeline();
      renderCompareOptions();
      status.textContent = `${mode === 'preview' ? 'preview' : 'built'} in ${(result.elapsedMs / 1000).toFixed(2)} s`;
    } catch (err) {
      status.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      building = false;
      buildButton.disabled = false;
      variationButton.disabled = false;
      if (queued) {
        const next = queued;
        queued = null;
        void runBuild(next);
      }
    }
  };

  let earthBytes: ArrayBuffer | null = null;
  let earthHistoryBytes: ArrayBuffer | null = null;
  /** Measured deposits (M21), shipped only when someone converted the USGS data; absent is normal. */
  let earthMineralBytes: ArrayBuffer | null = null;
  let earthMineralsChecked = false;
  /** The real Earth: fetch the shipped relief and its past once, build them in the worker, add the result to the gallery. */
  const runEarth = async (): Promise<void> => {
    if (building) return;
    building = true;
    stopPlaying();
    buildButton.disabled = true;
    variationButton.disabled = true;
    realEarthButton.disabled = true;
    progress.value = 0;
    status.textContent = 'loading the real relief';
    try {
      if (!earthBytes) {
        const response = await fetch(`${import.meta.env.BASE_URL}data/earth-elevation-05deg.i16`);
        if (!response.ok) throw new Error(`relief file: HTTP ${response.status}`);
        earthBytes = await response.arrayBuffer();
      }
      if (!earthHistoryBytes) {
        status.textContent = 'loading the real past (PALEOMAP reconstructions)';
        const response = await fetch(`${import.meta.env.BASE_URL}data/earth-history-1deg.i16`);
        if (response.ok) earthHistoryBytes = await response.arrayBuffer();
      }
      if (!earthMineralsChecked) {
        earthMineralsChecked = true;
        const response = await fetch(`${import.meta.env.BASE_URL}data/earth-minerals-1deg.u8`);
        if (response.ok && response.headers.get('content-type')?.includes('octet-stream')) earthMineralBytes = await response.arrayBuffer();
      }
      let entry: GalleryEntry | null = null;
      const result = await client.buildEarth(earthBytes.slice(0), {
        onProgress: (stage, fraction) => {
          progress.value = fraction;
          status.textContent = `real Earth: ${stage}`;
        },
        onKeyframe: (keyframe, index, total) => {
          if (!entry) return;
          entry.keyframes.push(keyframe);
          if (current === entry) {
            timeline.max = String(entry.keyframes.length);
            if (followLatest) timeline.value = String(entry.keyframes.length);
            renderTimeline();
            renderCompareOptions();
          }
          status.textContent = `the real past: ${index + 1} of ${total} reconstructions`;
        },
        onHistory: (elapsedMs) => {
          if (entry && entry.keyframes.length > 0) {
            status.textContent = `the real past ready in ${(elapsedMs / 1000).toFixed(1)} s; drag the slider from 200 million years ago to today`;
          }
        },
      }, earthHistoryBytes ? earthHistoryBytes.slice(0) : undefined, earthMineralBytes ? earthMineralBytes.slice(0) : undefined);
      entry = addToGallery(result.world);
      current = entry;
      followLatest = true;
      timeline.value = '0';
      selectedCell = -1;
      showWorld(result.world);
      renderTimeline();
      renderCompareOptions();
      status.textContent = `real Earth in ${(result.elapsedMs / 1000).toFixed(2)} s; compare it with a simulated planet in the Compare view`;
    } catch (err) {
      status.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      building = false;
      buildButton.disabled = false;
      variationButton.disabled = false;
      realEarthButton.disabled = false;
    }
  };

  const schedulePreview = (): void => {
    if (!autoPreview.checked) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void runBuild('preview'), PREVIEW_DEBOUNCE_MS);
  };

  const download = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Every keyframe and the final state of the current build, painted with the current layer into one PNG grid. */
  const exportHistoryStrip = (): void => {
    if (!current) return;
    const frames = [...current.keyframes, current.world];
    const layer = layerById(activeLayerId());
    const columns = Math.min(STRIP_COLUMNS, frames.length);
    const rows = Math.ceil(frames.length / columns);
    const captionH = 22;
    const sheet = document.createElement('canvas');
    sheet.width = columns * STRIP_FRAME_W;
    sheet.height = rows * (STRIP_FRAME_H + captionH);
    const ctx = sheet.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    const image = ctx.createImageData(STRIP_FRAME_W, STRIP_FRAME_H);
    frames.forEach((w, i) => {
      const raster = equirectRaster(Grid.get(w.level), STRIP_FRAME_W, STRIP_FRAME_H);
      paintCells(cellColors(w, layer, sample), raster.cell, image.data);
      const x = (i % columns) * STRIP_FRAME_W;
      const y = Math.floor(i / columns) * (STRIP_FRAME_H + captionH);
      ctx.putImageData(image, x, y);
      ctx.fillStyle = '#e6e6e6';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`${ageLabel(w)} · ${layer.name}${layer.seasonal ? ` (${sampleName(sample)})` : ''}`, x + 6, y + STRIP_FRAME_H + 15);
    });
    sheet.toBlob((blob) => {
      if (blob) download(blob, `geografia-${current?.world.params.seed}-history-${layer.id}.png`);
    }, 'image/png');
  };

  const applyLayer = (): void => {
    const id = activeLayerId();
    map.setLayer(id);
    globe.setLayer(id);
    mapA.setLayer(id);
    mapB.setLayer(id);
    sampleRow.classList.toggle('hidden', !layerById(id).seasonal);
    renderLegend(layerById(id), legendBox, world);
  };

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    if (preset) {
      setParams(preset.params);
      schedulePreview();
    }
  });
  for (const input of inputs.values()) input.addEventListener('input', schedulePreview);
  buildButton.addEventListener('click', () => void runBuild('full'));
  realEarthButton.addEventListener('click', () => void runEarth());
  variationButton.addEventListener('click', () => {
    const seedInput = inputs.get('seed');
    if (seedInput) seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    void runBuild('full');
  });
  layerSelect.addEventListener('change', () => {
    // A geography pick takes the screen back from the layer beyond.
    layerBeyond.value = '';
    applyLayer();
  });
  layerBeyond.addEventListener('change', applyLayer);
  /** The optgroups of the second dropdown: only the groups whose toggle is on (M28); a pick in a group that went off is dropped. */
  const renderGroupOptions = (): void => {
    const picked = layerBeyond.value;
    layerBeyond.innerHTML = '<option value="">— the geography layer above —</option>' + GROUPS
      .filter(({ group, toggle }) => (toggle === 'beyond' ? beyond : fantasy) && layersOfGroup(group).length > 0)
      .map(({ group, label }) => `<optgroup label="${label}">${layersOfGroup(group).map((l) => `<option value="${l.id}">${l.name}</option>`).join('')}</optgroup>`)
      .join('');
    layerBeyond.value = picked && groupEnabled(layerById(picked).group) ? picked : '';
  };
  /** Both toggles at once: the dropdown shows when either is on, each gates its own groups, both are remembered and travel in the link. */
  const applyGroupToggles = (): void => {
    beyondCheck.checked = beyond;
    fantasyCheck.checked = fantasy;
    layerBeyond.classList.toggle('hidden', !(beyond || fantasy));
    localStorage.setItem(BEYOND_KEY, beyond ? '1' : '0');
    localStorage.setItem(FANTASY_KEY, fantasy ? '1' : '0');
    renderGroupOptions();
    applyLayer();
    renderStats();
    if (selectedCell >= 0 && world) renderInspector(selectedCell);
    if (location.hash) location.hash = linkHash(readParams());
  };
  beyondCheck.addEventListener('change', () => {
    beyond = beyondCheck.checked;
    applyGroupToggles();
  });
  fantasyCheck.addEventListener('change', () => {
    fantasy = fantasyCheck.checked;
    applyGroupToggles();
  });
  sampleInput.addEventListener('input', () => {
    sample = Number(sampleInput.value);
    sampleLabel.textContent = sampleName(sample);
    map.setSample(sample);
    globe.setSample(sample);
    mapA.setSample(sample);
    mapB.setSample(sample);
    if (selectedCell >= 0) renderInspector(selectedCell);
  });
  for (const b of viewButtons) b.addEventListener('click', () => setView(b.dataset.view as ViewId));
  compareSelect.addEventListener('change', applyCompareChoice);
  timeline.addEventListener('input', () => {
    stopPlaying();
    followLatest = false;
    showTimelinePosition();
  });
  playButton.addEventListener('click', togglePlaying);
  exportFramesButton.addEventListener('click', exportHistoryStrip);
  exportPngButton.addEventListener('click', () => {
    if (!world) return;
    const w = world;
    const source = view === 'globe' ? globe : view === 'compare' ? mapA : map;
    void source.toPng().then((blob) => download(blob, `geografia-${w.params.seed}-step${w.steps}-${activeLayerId()}-${view}.png`));
  });
  exportJsonButton.addEventListener('click', () => {
    if (!world) return;
    const payload = {
      params: world.params, level: world.level, preview: world.preview, step: world.steps, seaLevel: world.seaLevel,
      stats: world.stats, events: world.events, lakes: world.lakes.length, basins: world.basins.length,
    };
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `geografia-${world.params.seed}-step${world.steps}.json`);
  });
  copyLinkButton.addEventListener('click', () => {
    location.hash = linkHash(readParams());
    void navigator.clipboard?.writeText(location.href).then(
      () => { status.textContent = 'link copied'; },
      () => { status.textContent = 'link is in the address bar'; },
    );
  });
  map.onCellClick((cell) => renderInspector(cell));
  globe.onCellClick((cell) => renderInspector(cell));
  mapA.onCellClick((cell) => renderInspector(cell, world as World, 'A'));
  // The two panes of the Compare view share one window.
  mapA.onViewChange((v) => mapB.setView(v, false));
  mapB.onViewChange((v) => mapA.setView(v, false));
  mapB.onCellClick((cell) => {
    if (compareWorld) renderInspector(cell, compareWorld, 'B');
  });

  applyGroupToggles();
  const initial = paramsFromHash(location.hash);
  setParams(initial ?? EARTH);
  if (initial) {
    const preset = PRESETS.find((p) => PARAM_SPECS.every((s) => p.params[s.key] === initial[s.key]));
    if (preset) presetSelect.value = preset.name;
  }
  void runBuild('full');
}
