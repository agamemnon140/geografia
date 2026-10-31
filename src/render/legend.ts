import { ramp } from './colors.ts';
import type { Layer } from './layers.ts';
import type { World } from '../sim/pipeline.ts';

/** Render a layer's legend into a container: a gradient bar with ticks, color swatches, or plain lines; with a world, the legend for that world when the layer has one (M27). */
export function renderLegend(layer: Layer, container: HTMLElement, world: World | null = null): void {
  container.innerHTML = '';
  const legend = layer.legendFor && world ? layer.legendFor(world) : layer.legend;
  if (!legend) return;
  if (legend.kind === 'ramp') {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 12;
    canvas.className = 'legend-bar';
    const ctx = canvas.getContext('2d');
    const lo = legend.stops[0][0];
    const hi = legend.stops[legend.stops.length - 1][0];
    if (ctx) {
      const image = ctx.createImageData(canvas.width, canvas.height);
      for (let x = 0; x < canvas.width; x++) {
        const [r, g, b] = ramp(legend.stops, lo + ((hi - lo) * x) / (canvas.width - 1));
        for (let y = 0; y < canvas.height; y++) {
          const o = (y * canvas.width + x) * 4;
          image.data[o] = r;
          image.data[o + 1] = g;
          image.data[o + 2] = b;
          image.data[o + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }
    const ticks = document.createElement('div');
    ticks.className = 'legend-ticks';
    const mid = legend.stops[Math.floor(legend.stops.length / 2)][0];
    for (const v of [lo, mid, hi]) {
      const tick = document.createElement('span');
      tick.textContent = formatTick(v);
      ticks.append(tick);
    }
    const unit = document.createElement('div');
    unit.className = 'legend-unit';
    unit.textContent = legend.unit;
    container.append(canvas, ticks, unit);
  } else if (legend.kind === 'categories') {
    for (const item of legend.items) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      for (const color of item.colors ?? [item.color]) {
        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        swatch.style.background = `rgb(${color.map((c) => Math.round(c)).join(',')})`;
        row.append(swatch);
      }
      const label = document.createElement('span');
      label.textContent = item.label;
      row.append(label);
      container.append(row);
    }
  } else {
    for (const line of legend.items) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.textContent = line;
      container.append(row);
    }
  }
  if (legend.kind !== 'text' && legend.lines) {
    for (const line of legend.lines) {
      const row = document.createElement('div');
      row.className = 'legend-unit';
      row.textContent = line;
      container.append(row);
    }
  }
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `${v}`;
}
