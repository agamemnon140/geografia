/** Per-world summary statistics (DESIGN 3.6). Grows with each milestone. */
export interface WorldStats {
  oceanFraction: number;
  landFraction: number;
  minElevation: number;
  maxElevation: number;
  meanLandElevation: number;
  meanOceanDepth: number;
  totalAreaKm2: number;
}

export function computeStats(elevation: Float64Array, areaKm2: Float64Array, seaLevel: number): WorldStats {
  let total = 0;
  let ocean = 0;
  let min = Infinity;
  let max = -Infinity;
  let landSum = 0;
  let oceanSum = 0;
  for (let i = 0; i < elevation.length; i++) {
    const e = elevation[i];
    const a = areaKm2[i];
    total += a;
    if (e < min) min = e;
    if (e > max) max = e;
    if (e < seaLevel) {
      ocean += a;
      oceanSum += a * (seaLevel - e);
    } else {
      landSum += a * (e - seaLevel);
    }
  }
  const land = total - ocean;
  return {
    oceanFraction: ocean / total,
    landFraction: land / total,
    minElevation: min - seaLevel,
    maxElevation: max - seaLevel,
    meanLandElevation: land > 0 ? landSum / land : 0,
    meanOceanDepth: ocean > 0 ? oceanSum / ocean : 0,
    totalAreaKm2: total,
  };
}
