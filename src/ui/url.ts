import { EARTH, PARAM_SPECS, validateParams, type PlanetParams } from '../sim/params.ts';

/** Parameters as a URL hash, for sharing a planet: every value is in the hash, so a link rebuilds the same world. */
export function paramsToHash(params: PlanetParams): string {
  const query = new URLSearchParams();
  for (const spec of PARAM_SPECS) query.set(spec.key, String(params[spec.key]));
  return `#${query.toString()}`;
}

/** Parameters from a URL hash; missing or malformed values fall back to Earth. Returns null for an empty hash. */
export function paramsFromHash(hash: string): PlanetParams | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return null;
  const query = new URLSearchParams(text);
  const params = { ...EARTH };
  let any = false;
  for (const spec of PARAM_SPECS) {
    const raw = query.get(spec.key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) {
      params[spec.key] = value;
      any = true;
    }
  }
  return any ? validateParams(params) : null;
}
