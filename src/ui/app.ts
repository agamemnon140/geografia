import { GlobeView } from '../render/globe.ts';
import { LAYERS, cellColors, layerById, paintCells } from '../render/layers.ts';
import { renderLegend } from '../render/legend.ts';
import { MapView } from '../render/map.ts';
import { equirectRaster } from '../render/raster.ts';
import { paintThumbnail } from '../render/thumbnail.ts';
import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { Grid } from '../sim/grid/grid.ts';
import { CURRENT_MILESTONE, EARTH, PARAM_SPECS, PRESETS, type PlanetParams } from '../sim/params.ts';
import type { World } from '../sim/pipeline.ts';
import type { WorldStats } from '../sim/stats.ts';
import { SimClient } from '../worker/client.ts';
import { explainCell, sampleName } from './explain.ts';
import { paramsFromHash, paramsToHash } from './url.ts';

/** Full builds kept for the gallery (each holds a few tens of megabytes of fields). */
const GALLERY_SIZE = 6;
/** Delay after the last parameter edit before the automatic preview starts. */
const PREVIEW_DEBOUNCE_MS = 500;
/** Timeline keyframes requested per full build; fewer on the largest grids to bound memory. */
const KEYFRAMES = 8;
const KEYFRAMES_LARGE_GRID = 4;
/** Milliseconds per keyframe when the history plays. */
const PLAY_INTERVAL_MS = 900;
/** Frame size and columns of the exported history strip. */
const STRIP_FRAME_W = 480;
const STRIP_FRAME_H = 240;
const STRIP_COLUMNS = 3;

type ViewId = 'map' | 'globe' | 'compare';

/** A full build: its final world and, for the most recent one, the timeline keyframes (oldest first). */
interface GalleryEntry {
  world: World;
  keyframes: World[];
  element: HTMLElement;
}

function template(): string {
  const presetOptions = PRESETS.map((p) => `<option value="${p.name}">${p.name}</option>`).join('');
  const layerOptions = LAYERS.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
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
        </div>
        <progress id="progress" max="1" value="0"></progress>
        <div id="status" class="status"></div>
        <h2>Layer</h2>
        <select id="layer">${layerOptions}</select>
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
            <button data-view="globe" title="Drag to turn, click to inspect">Globe</button>
            <button data-view="compare" title="Two steps or two planets side by side">Compare</button>
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
  const progress = q<HTMLProgressElement>('#progress');
  const status = q<HTMLDivElement>('#status');
  const layerSelect = q<HTMLSelectElement>('#layer');
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
  const statRows = (w: World): [string, string][] => {
    const s: WorldStats = w.stats;
    const k = s.koppen;
    return [
      ['Grid level', `${w.level} (${w.n.toLocaleString()} cells)${w.preview ? ', preview' : ''}${w.reference ? `, relief from ${w.reference}` : ''}`],
      ['Tectonic step', w.reference ? 'measured relief, no tectonic history' : `${w.steps} of ${w.params.tectonicAge}`],
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
    const a = statRows(world);
    const b = view === 'compare' && compareWorld ? statRows(compareWorld) : null;
    const head = b ? `<tr><th></th><th>A</th><th>B</th></tr>` : '';
    statsTable.innerHTML = head + a
      .map(([key, value], i) => `<tr><td>${key}</td><td>${value}</td>${b ? `<td>${b[i][1]}</td>` : ''}</tr>`)
      .join('');
    eventsBox.textContent = eventsText(world);
  };

  const renderInspector = (cell: number, w: World = world as World, pane = ''): void => {
    if (!w) return;
    selectedCell = cell;
    const sections = explainCell(w, cell, sample);
    if (pane) sections[0].title = `${pane}: ${sections[0].title}`;
    inspector.innerHTML = sections
      .map((section) => `<div class="section"><div class="section-title">${section.title}</div>${section.lines.map((l) => `<div>${l}</div>`).join('')}</div>`)
      .join('');
  };

  const worldTitle = (w: World): string =>
    w.reference ? `real Earth (${w.reference})` : `seed ${w.params.seed}, step ${w.steps} of ${w.params.tectonicAge}${w.preview ? ' (preview)' : ''}`;

  /** Paint `world` into the views that are on screen; the others catch up when shown. */
  const paintViews = (): void => {
    if (!world) return;
    for (const id of ['map', 'globe', 'compare'] as ViewId[]) stale.add(id);
    refreshVisibleViews();
  };

  const refreshVisibleViews = (): void => {
    if (!world) return;
    if (view === 'map' && stale.has('map')) {
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
      current.keyframes.forEach((k, i) => options.push(`<option value="k:${i}">this planet, step ${k.steps}</option>`));
      options.push(`<option value="k:final">this planet, final (step ${current.world.steps})</option>`);
    }
    entries.forEach((e, i) => {
      if (e === current) return;
      options.push(`<option value="g:${i}">${e.world.reference ? 'real Earth' : `seed ${e.world.params.seed}, final (step ${e.world.steps})`}</option>`);
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
    stageMap.classList.toggle('hidden', id !== 'map');
    stageGlobe.classList.toggle('hidden', id !== 'globe');
    stageCompare.classList.toggle('hidden', id !== 'compare');
    compareControls.classList.toggle('hidden', id !== 'compare');
    viewHint.textContent = id === 'globe'
      ? 'drag to turn, click to inspect'
      : id === 'compare'
        ? 'A follows the history slider; pick B on the right; wheel zooms both panes together'
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
    timelineLabel.textContent = `step ${shown.steps} of ${shown.params.tectonicAge} (about ${shown.steps} million years)`;
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
      location.hash = paramsToHash(w.params);
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
      if (mode === 'full') location.hash = paramsToHash(params);
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
      }, mode === 'preview' ? { coarser: 1 } : { keyframes: levelIsLarge(params) ? KEYFRAMES_LARGE_GRID : KEYFRAMES });
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
  /** The real Earth: fetch the shipped relief once, build it in the worker, add it to the gallery. */
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
      const result = await client.buildEarth(earthBytes.slice(0), {
        onProgress: (stage, fraction) => {
          progress.value = fraction;
          status.textContent = `real Earth: ${stage}`;
        },
      });
      current = addToGallery(result.world);
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
    const layer = layerById(layerSelect.value);
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
      ctx.fillText(`step ${w.steps} of ${w.params.tectonicAge} · ${layer.name}${layer.seasonal ? ` (${sampleName(sample)})` : ''}`, x + 6, y + STRIP_FRAME_H + 15);
    });
    sheet.toBlob((blob) => {
      if (blob) download(blob, `geografia-${current?.world.params.seed}-history-${layer.id}.png`);
    }, 'image/png');
  };

  const applyLayer = (): void => {
    const id = layerSelect.value;
    map.setLayer(id);
    globe.setLayer(id);
    mapA.setLayer(id);
    mapB.setLayer(id);
    sampleRow.classList.toggle('hidden', !layerById(id).seasonal);
    renderLegend(layerById(id), legendBox);
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
  layerSelect.addEventListener('change', applyLayer);
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
    void source.toPng().then((blob) => download(blob, `geografia-${w.params.seed}-step${w.steps}-${layerSelect.value}-${view}.png`));
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
    location.hash = paramsToHash(readParams());
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

  applyLayer();
  const initial = paramsFromHash(location.hash);
  setParams(initial ?? EARTH);
  if (initial) {
    const preset = PRESETS.find((p) => PARAM_SPECS.every((s) => p.params[s.key] === initial[s.key]));
    if (preset) presetSelect.value = preset.name;
  }
  void runBuild('full');
}
