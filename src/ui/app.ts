import { LAYERS, layerById } from '../render/layers.ts';
import { MapView } from '../render/map.ts';
import { paintThumbnail } from '../render/thumbnail.ts';
import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { CURRENT_MILESTONE, EARTH, PARAM_SPECS, PRESETS, type PlanetParams } from '../sim/params.ts';
import type { World } from '../sim/pipeline.ts';
import { SimClient } from '../worker/client.ts';
import { explainCell, sampleName } from './explain.ts';
import { paramsFromHash, paramsToHash } from './url.ts';

/** Full builds kept for the gallery (each holds a few tens of megabytes of fields). */
const GALLERY_SIZE = 8;
/** Delay after the last parameter edit before the automatic preview starts. */
const PREVIEW_DEBOUNCE_MS = 500;

interface GalleryEntry {
  world: World;
  canvas: HTMLCanvasElement;
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
          <button id="build" class="primary" title="Full resolution; the result joins the gallery">Build planet</button>
          <button id="variation" title="Keep the parameters, draw a new seed">New variation</button>
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
        <div class="row">
          <button id="exportPng" title="Current layer as PNG">Export PNG</button>
          <button id="exportJson" title="Parameters and statistics as JSON">Export JSON</button>
          <button id="copyLink" title="The URL hash holds the parameters; share it to rebuild this planet">Copy link</button>
        </div>
        <h2>Statistics</h2>
        <table id="stats" class="stats"></table>
        <h2>Explain</h2>
        <div id="inspector" class="inspector">Click the map to see why a cell is what it is.</div>
      </aside>
      <main class="center">
        <div class="map"><canvas id="map"></canvas></div>
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
  const autoPreview = q<HTMLInputElement>('#autoPreview');
  const progress = q<HTMLProgressElement>('#progress');
  const status = q<HTMLDivElement>('#status');
  const layerSelect = q<HTMLSelectElement>('#layer');
  const sampleRow = q<HTMLDivElement>('#sampleRow');
  const sampleInput = q<HTMLInputElement>('#sample');
  const sampleLabel = q<HTMLSpanElement>('#sampleLabel');
  const exportPngButton = q<HTMLButtonElement>('#exportPng');
  const exportJsonButton = q<HTMLButtonElement>('#exportJson');
  const copyLinkButton = q<HTMLButtonElement>('#copyLink');
  const statsTable = q<HTMLTableElement>('#stats');
  const inspector = q<HTMLDivElement>('#inspector');
  const gallery = q<HTMLDivElement>('#gallery');
  const inputs = new Map<keyof PlanetParams, HTMLInputElement>();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-key]')) {
    inputs.set(input.dataset.key as keyof PlanetParams, input);
  }

  const map = new MapView(q<HTMLCanvasElement>('#map'));
  const client = new SimClient();
  let world: World | null = null;
  let building = false;
  let queued: 'preview' | 'full' | null = null;
  let selectedCell = -1;
  let sample = ANNUAL;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
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
  const renderStats = (w: World): void => {
    const s = w.stats;
    const k = s.koppen;
    const rows: [string, string][] = [
      ['Grid level', `${w.level} (${w.n.toLocaleString()} cells)${w.preview ? ', preview' : ''}`],
      ['Tectonic steps', `${w.steps}`],
      ['Active plates', `${s.activePlates} of ${w.plates.length}`],
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
    statsTable.innerHTML = rows.map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('');
  };

  const renderInspector = (cell: number): void => {
    if (!world) return;
    selectedCell = cell;
    inspector.innerHTML = explainCell(world, cell, sample)
      .map((section) => `<div class="section"><div class="section-title">${section.title}</div>${section.lines.map((l) => `<div>${l}</div>`).join('')}</div>`)
      .join('');
  };

  const showWorld = (w: World): void => {
    world = w;
    selectedCell = -1;
    map.setWorld(w);
    renderStats(w);
    inspector.textContent = 'Click the map to see why a cell is what it is.';
  };

  const addToGallery = (w: World): void => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    paintThumbnail(w, canvas);
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.title = 'Click to restore this planet';
    const caption = document.createElement('div');
    caption.className = 'gallery-caption';
    caption.textContent = `seed ${w.params.seed} · ocean ${(w.stats.oceanFraction * 100).toFixed(0)} % · ${w.stats.meanTemperature.toFixed(0)} °C · ${w.stats.continents} continents`;
    item.append(canvas, caption);
    item.addEventListener('click', () => {
      setParams(w.params);
      location.hash = paramsToHash(w.params);
      showWorld(w);
      status.textContent = `restored seed ${w.params.seed} from the gallery`;
    });
    entries.push({ world: w, canvas });
    gallery.prepend(item);
    while (entries.length > GALLERY_SIZE) {
      entries.shift();
      gallery.lastElementChild?.remove();
    }
  };

  const runBuild = async (mode: 'preview' | 'full'): Promise<void> => {
    if (building) {
      // A full build always wins over a pending preview.
      queued = queued === 'full' ? 'full' : mode;
      return;
    }
    building = true;
    buildButton.disabled = true;
    variationButton.disabled = true;
    progress.value = 0;
    status.textContent = mode === 'preview' ? 'preview' : 'starting';
    try {
      const params = readParams();
      if (mode === 'full') location.hash = paramsToHash(params);
      const result = await client.build(params, (stage, fraction) => {
        progress.value = fraction;
        status.textContent = `${mode === 'preview' ? 'preview: ' : ''}${stage}`;
      }, mode === 'preview' ? { coarser: 1 } : {});
      showWorld(result.world);
      if (mode === 'full') addToGallery(result.world);
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

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    if (preset) {
      setParams(preset.params);
      schedulePreview();
    }
  });
  for (const input of inputs.values()) input.addEventListener('input', schedulePreview);
  buildButton.addEventListener('click', () => void runBuild('full'));
  variationButton.addEventListener('click', () => {
    const seedInput = inputs.get('seed');
    if (seedInput) seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    void runBuild('full');
  });
  layerSelect.addEventListener('change', () => {
    map.setLayer(layerSelect.value);
    sampleRow.classList.toggle('hidden', !layerById(layerSelect.value).seasonal);
  });
  sampleInput.addEventListener('input', () => {
    sample = Number(sampleInput.value);
    sampleLabel.textContent = sampleName(sample);
    map.setSample(sample);
    if (selectedCell >= 0) renderInspector(selectedCell);
  });
  exportPngButton.addEventListener('click', () => {
    if (!world) return;
    const w = world;
    void map.toPng().then((blob) => download(blob, `geografia-${w.params.seed}-${layerSelect.value}.png`));
  });
  exportJsonButton.addEventListener('click', () => {
    if (!world) return;
    const payload = { params: world.params, level: world.level, preview: world.preview, seaLevel: world.seaLevel, stats: world.stats, lakes: world.lakes.length, basins: world.basins.length };
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `geografia-${world.params.seed}.json`);
  });
  copyLinkButton.addEventListener('click', () => {
    location.hash = paramsToHash(readParams());
    void navigator.clipboard?.writeText(location.href).then(
      () => { status.textContent = 'link copied'; },
      () => { status.textContent = 'link is in the address bar'; },
    );
  });
  map.onCellClick(renderInspector);

  const initial = paramsFromHash(location.hash);
  setParams(initial ?? EARTH);
  if (initial) {
    const preset = PRESETS.find((p) => PARAM_SPECS.every((s) => p.params[s.key] === initial[s.key]));
    if (preset) presetSelect.value = preset.name;
  }
  void runBuild('full');
}
