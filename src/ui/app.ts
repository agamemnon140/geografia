import { LAYERS, layerById, precipitationAt, temperatureAt, windAt } from '../render/layers.ts';
import { MapView } from '../render/map.ts';
import { ANNUAL, SAMPLES } from '../sim/climate/insolation.ts';
import { Grid, cellAreasKm2 } from '../sim/grid/grid.ts';
import { CURRENT_MILESTONE, EARTH, PARAM_SPECS, PRESETS, type PlanetParams } from '../sim/params.ts';
import type { World } from '../sim/pipeline.ts';
import { BOUNDARY_NAMES } from '../sim/tectonics/simulation.ts';
import { SimClient } from '../worker/client.ts';

const RAD = 180 / Math.PI;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sampleName(sample: number): string {
  return sample >= ANNUAL ? 'annual' : MONTHS[sample];
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
          <button id="build" class="primary">Build planet</button>
          <button id="variation" title="Keep the parameters, draw a new seed">New variation</button>
        </div>
        <progress id="progress" max="1" value="0"></progress>
        <div id="status" class="status"></div>
        <h2>Layer</h2>
        <select id="layer">${layerOptions}</select>
        <div id="sampleRow" class="row hidden">
          <label>Month <input type="range" id="sample" min="0" max="${SAMPLES}" step="1" value="${ANNUAL}" /></label>
          <span id="sampleLabel" class="unit">annual</span>
        </div>
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
  const sampleRow = q<HTMLDivElement>('#sampleRow');
  const sampleInput = q<HTMLInputElement>('#sample');
  const sampleLabel = q<HTMLSpanElement>('#sampleLabel');
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
  let selectedCell = -1;
  let sample = ANNUAL;

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
      ['Tectonic steps', `${w.steps}`],
      ['Active plates', `${s.activePlates} of ${w.plates.length}`],
      ['Ocean', `${(s.oceanFraction * 100).toFixed(1)} %`],
      ['Land', `${(s.landFraction * 100).toFixed(1)} %`],
      ['Continental crust', `${(s.continentalFraction * 100).toFixed(1)} %`],
      ['Highest point', `${s.maxElevation.toFixed(0)} m`],
      ['Deepest point', `${s.minElevation.toFixed(0)} m`],
      ['Mean land elevation', `${s.meanLandElevation.toFixed(0)} m`],
      ['Mean ocean depth', `${s.meanOceanDepth.toFixed(0)} m`],
      ['Thickest crust', `${s.maxThickness.toFixed(0)} km`],
      ['Surface area', `${(s.totalAreaKm2 / 1e6).toFixed(1)} million km²`],
      ['Land precipitation', `${s.meanLandPrecipitation.toFixed(0)} mm/yr`],
      ['Lakes', `${s.lakeCount} (${s.endorheicLakeCount} closed basins)`],
      ['Lake area', `${(s.lakeFraction * 100).toFixed(2)} % of land`],
      ['Land in closed basins', `${(s.endorheicLandFraction * 100).toFixed(1)} %`],
      ['Longest river', `${s.longestRiverKm.toFixed(0)} km`],
      ['Largest river', `${s.largestRiverKm3.toFixed(0)} km³/yr`],
      ['Mean temperature', `${s.meanTemperature.toFixed(1)} °C`],
      ['Equator / poles', `${s.equatorTemperature.toFixed(1)} / ${s.poleTemperature.toFixed(1)} °C`],
      ['Seasonal range 40–60°', `land ${s.landSeasonalRange.toFixed(0)}, ocean ${s.oceanSeasonalRange.toFixed(0)} °C`],
      ['Circulation cells', `${s.circulationCells} per hemisphere`],
      ['Hadley cell edge', `${s.hadleyEdgeDeg.toFixed(0)}°`],
      ['Precipitation', `${s.meanPrecipitation.toFixed(0)} mm/yr (evaporation ${s.meanEvaporation.toFixed(0)})`],
      ['Desert', `${(s.desertFraction * 100).toFixed(1)} % of land`],
      ['Wettest cell', `${s.wettestMm.toFixed(0)} mm/yr`],
      ['Ocean basins', `${s.oceanBasins}`],
      ['Strongest current', `${s.strongestCurrent.toFixed(2)} m/s`],
      ['Current anomalies', `${s.warmestCurrentAnomaly.toFixed(1)} / ${s.coldestCurrentAnomaly.toFixed(1)} °C`],
    ];
    statsTable.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  };

  const renderInspector = (cell: number): void => {
    if (!world) return;
    selectedCell = cell;
    const grid = Grid.get(world.level);
    let coldest = Infinity;
    let warmest = -Infinity;
    for (let s = 0; s < SAMPLES; s++) {
      const t = temperatureAt(world, cell, s);
      if (t < coldest) coldest = t;
      if (t > warmest) warmest = t;
    }
    const [u, v] = windAt(world, cell, sample);
    const bearing = ((Math.atan2(u, v) * RAD) + 360) % 360;
    let driest = Infinity;
    let wettest = -Infinity;
    for (let s = 0; s < SAMPLES; s++) {
      const p = precipitationAt(world, cell, s);
      if (p < driest) driest = p;
      if (p > wettest) wettest = p;
    }
    const cu = world.currentU[cell];
    const cv = world.currentV[cell];
    const currentLine = world.basin[cell] >= 0
      ? `current     ${Math.hypot(cu, cv).toFixed(2)} m/s toward ${(((Math.atan2(cu, cv) * RAD) + 360) % 360).toFixed(0)}°, basin #${world.basin[cell]}, carries ${world.sstAnomaly[cell] >= 0 ? '+' : ''}${world.sstAnomaly[cell].toFixed(1)} °C`
      : `sea effect  ${world.sstAnomaly[cell] >= 0 ? '+' : ''}${world.sstAnomaly[cell].toFixed(1)} °C from nearby currents`;
    const area = cellAreasKm2(grid, world.radiusKm)[cell];
    const rel = world.elevation[cell] - world.seaLevel;
    const orogeny = world.orogenyStep[cell];
    const lakeId = world.lake[cell];
    const mouthLake = world.lake[world.mouth[cell]];
    let drainsTo: string;
    if (rel < 0) drainsTo = 'is ocean';
    else if (mouthLake >= 0) drainsTo = `lake #${mouthLake}${world.lakes[mouthLake].endorheic ? ' (closed basin)' : ''}`;
    else if (world.downstream[cell] < 0 && lakeId < 0) drainsTo = 'nowhere (pit)';
    else drainsTo = 'ocean';
    const lakeLine = lakeId >= 0
      ? `lake        #${lakeId}, ${(world.waterLevel[cell] - world.elevation[cell]).toFixed(0)} m deep, surface ${(world.waterLevel[cell] - world.seaLevel).toFixed(0)} m${world.lakes[lakeId].endorheic ? ', closed basin' : ''}`
      : null;
    const lines = [
      `cell        ${cell}`,
      `lat/lon     ${(grid.lat[cell] * RAD).toFixed(2)}°, ${(grid.lon[cell] * RAD).toFixed(2)}°`,
      `elevation   ${rel.toFixed(0)} m ${rel < 0 ? '(ocean)' : '(land)'}`,
      `area        ${area.toFixed(0)} km²`,
      `plate       ${world.plate[cell]}`,
      `boundary    ${BOUNDARY_NAMES[world.boundary[cell]]}`,
      `crust       ${world.crustType[cell] === 1 ? 'continental' : 'oceanic'}, ${world.thickness[cell].toFixed(1)} km`,
      `crust age   ${world.crustAge[cell].toFixed(0)} steps`,
      `volcanic    ${world.volcanic[cell].toFixed(2)} km`,
      `sediment    ${world.sediment[cell].toFixed(2)} km`,
      `orogeny     ${orogeny >= 0 ? `step ${orogeny} (${world.steps - orogeny} steps ago)` : 'none'}`,
      `eroded      ${world.eroded[cell].toFixed(0)} m of surface`,
      `precip      ${world.precipitation[cell].toFixed(0)} mm/yr annual, ${driest.toFixed(0)} to ${wettest.toFixed(0)} over the year`,
      `            orographic ${world.precipitationOrographic[cell].toFixed(0)}, convergence ${world.precipitationConvergence[cell].toFixed(0)}, evaporation ${world.evaporation[cell].toFixed(0)} mm/yr`,
      `discharge   ${world.discharge[cell].toFixed(1)} km³/yr`,
      `river path  ${world.riverLength[cell].toFixed(0)} km from the farthest source`,
      `drains to   ${drainsTo}`,
    ];
    if (lakeLine) lines.push(lakeLine);
    lines.push(
      `insolation  ${world.insolationAnnual[cell].toFixed(0)} W/m² annual mean`,
      `temperature ${world.temperatureAnnual[cell].toFixed(1)} °C annual, ${coldest.toFixed(1)} to ${warmest.toFixed(1)} °C over the year`,
      `continental ${(world.continentality[cell] * 100).toFixed(0)} %`,
      `wind        ${sampleName(sample)}: ${Math.hypot(u, v).toFixed(1)} m/s toward ${bearing.toFixed(0)}° (east ${u.toFixed(1)}, north ${v.toFixed(1)})`,
      currentLine,
    );
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
      selectedCell = -1;
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
  map.onCellClick(renderInspector);

  setParams(EARTH);
  void runBuild();
}
