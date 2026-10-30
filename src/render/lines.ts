import type { RGB } from './colors.ts';

/**
 * Anti-aliased thick segment on an RGBA buffer: a disc is stamped every half
 * pixel along the segment, with coverage falling off over the last pixel of
 * its radius. Used for rivers, so the browser and the command-line renderer
 * draw the same lines.
 */
export function strokeSegment(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  color: RGB,
): void {
  const radius = Math.max(0.5, thickness / 2);
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(length / 0.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampDisc(rgba, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
  }
}

function stampDisc(rgba: Uint8ClampedArray, width: number, height: number, cx: number, cy: number, radius: number, color: RGB): void {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - dist));
      if (coverage <= 0) continue;
      const o = (y * width + x) * 4;
      rgba[o] = rgba[o] + (color[0] - rgba[o]) * coverage;
      rgba[o + 1] = rgba[o + 1] + (color[1] - rgba[o + 1]) * coverage;
      rgba[o + 2] = rgba[o + 2] + (color[2] - rgba[o + 2]) * coverage;
    }
  }
}
