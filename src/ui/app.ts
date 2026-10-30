import { LAYERS } from '../render/layers.ts';
import { MapView } from '../render/map.ts';
import { Grid, cellAreasKm2 } from '../sim/grid/grid.ts';
import { CURRENT_MILESTONE, EARTH, PARAM_SPECS, PRESETS, type PlanetParams } from '../sim/params.ts';
import type { World } from '../sim/pipeline.ts';
import { SimClient } from '../worker/client.ts';

const RAD = 180 / Math.PI;

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
          <button id="build" class="primary">Build planet</button>
          <button id="variation" title="Keep the parameters, draw a new seed">New variation</button>
        </div>
        <progress id="progress" max="1" value="0"></progress>
        <div id="status" class="status"></div>
        <h2>Layer</h2>
        <select id="layer">${layerOptions}</select>
        <h2>Statistics</h2>
        <table id="stats" class="stats"></table>
        <h2>Cell</h2>
        <div id="inspector" class="inspector">Click the map to inspect a cell.</div>
      </aside>
      <main class="map"><canvas id="map"></canvas></main>
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
  const progress = q<HTMLProgressElement>('#progress');
  const status = q<HTMLDivElement>('#status');
  const layerSelect = q<HTMLSelectElement>('#layer');
  const statsTable = q<HTMLTableElement>('#stats');
  const inspector = q<HTMLDivElement>('#inspector');
  const inputs = new Map<keyof PlanetParams, HTMLInputElement>();
  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-key]')) {
    inputs.set(input.dataset.key as keyof PlanetParams, input);
  }

  const map = new MapView(q<HTMLCanvasElement>('#map'));
  const client = new SimClient();
  let world: World | null = null;
  let building = false;

  const setParams = (p: PlanetParams): void => {
    for (const [key, input] of inputs) input.value = String(p[key]);
  };
  const readParams = (): PlanetParams => {
    const p = { ...EARTH };
    for (const [key, input] of inputs) p[key] = Number(input.value);
    return p;
  };

  const renderStats = (w: World): void => {
    const s = w.stats;
    const rows: [string, string][] = [
      ['Grid level', `${w.level} (${w.n.toLocaleString()} cells)`],
      ['Ocean', `${(s.oceanFraction * 100).toFixed(1)} %`],
      ['Land', `${(s.landFraction * 100).toFixed(1)} %`],
      ['Highest point', `${s.maxElevation.toFixed(0)} m`],
      ['Deepest point', `${s.minElevation.toFixed(0)} m`],
      ['Mean land elevation', `${s.meanLandElevation.toFixed(0)} m`],
      ['Mean ocean depth', `${s.meanOceanDepth.toFixed(0)} m`],
      ['Surface area', `${(s.totalAreaKm2 / 1e6).toFixed(1)} million km²`],
    ];
    statsTable.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  };

  const renderInspector = (cell: number): void => {
    if (!world) return;
    const grid = Grid.get(world.level);
    const area = cellAreasKm2(grid, world.radiusKm)[cell];
    const rel = world.elevation[cell] - world.seaLevel;
    const lines = [
      `cell       ${cell}`,
      `lat/lon    ${(grid.lat[cell] * RAD).toFixed(2)}°, ${(grid.lon[cell] * RAD).toFixed(2)}°`,
      `elevation  ${rel.toFixed(0)} m ${rel < 0 ? '(ocean)' : '(land)'}`,
      `area       ${area.toFixed(0)} km²`,
      `neighbors  ${grid.degree(cell)}`,
    ];
    inspector.textContent = lines.join('\n');
  };

  const runBuild = async (): Promise<void> => {
    if (building) return;
    building = true;
    buildButton.disabled = true;
    variationButton.disabled = true;
    progress.value = 0;
    status.textContent = 'starting';
    try {
      const params = readParams();
      const result = await client.build(params, (stage, fraction) => {
        progress.value = fraction;
        status.textContent = stage;
      });
      world = result.world;
      map.setWorld(world);
      renderStats(world);
      inspector.textContent = 'Click the map to inspect a cell.';
      status.textContent = `built in ${(result.elapsedMs / 1000).toFixed(2)} s`;
    } catch (err) {
      status.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      building = false;
      buildButton.disabled = false;
      variationButton.disabled = false;
    }
  };

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    if (preset) setParams(preset.params);
  });
  buildButton.addEventListener('click', () => void runBuild());
  variationButton.addEventListener('click', () => {
    const seedInput = inputs.get('seed');
    if (seedInput) seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    void runBuild();
  });
  layerSelect.addEventListener('change', () => map.setLayer(layerSelect.value));
  map.onCellClick(renderInspector);

  setParams(EARTH);
  void runBuild();
}
