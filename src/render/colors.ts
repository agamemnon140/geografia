export type RGB = [number, number, number];

export type Stop = [number, RGB];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear color ramp over sorted stops; clamps outside the range. */
export function ramp(stops: Stop[], v: number): RGB {
  if (v <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = (v - v0) / (v1 - v0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
  }
  return last[1];
}

const BATHYMETRY: Stop[] = [
  [-8000, [6, 12, 40]],
  [-5000, [12, 28, 80]],
  [-3000, [20, 52, 120]],
  [-1500, [36, 86, 160]],
  [-300, [70, 130, 200]],
  [0, [120, 180, 225]],
];

const HYPSOMETRY: Stop[] = [
  [0, [58, 120, 64]],
  [200, [96, 150, 72]],
  [600, [150, 170, 90]],
  [1200, [190, 165, 100]],
  [2200, [160, 120, 80]],
  [3200, [130, 105, 95]],
  [4500, [200, 200, 200]],
  [6500, [255, 255, 255]],
];

/** Linear blend of two colors; t = 0 gives a, t = 1 gives b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Classic hypsometric tint for elevation relative to sea level (meters). */
export function hypsometric(relativeElevation: number): RGB {
  return relativeElevation < 0 ? ramp(BATHYMETRY, relativeElevation) : ramp(HYPSOMETRY, relativeElevation);
}

/** Distinct, deterministic color per cell id, for grid debugging. */
export function cellDebugColor(id: number): RGB {
  let h = (id + 1) * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  const hue = (h % 360) / 360;
  const sat = 0.45;
  const val = 0.55 + ((h >>> 9) % 40) / 100;
  return hsv(hue, sat, val);
}

function hsv(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}
