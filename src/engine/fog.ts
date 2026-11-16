/**
 * Fog: colour that is mixed into the picture the further away a surface is. Added in scene version 8.
 * The mixing amount is the textbook (Beer-Lambert) exponential fog: 1 - exp(-density * (distance - start)),
 * or with the squared form 1 - exp(-(density * (distance - start))^2), which stays clear nearby and then closes in
 * faster. "Allmän matematik (lärobok)". The mixing is done in linear light, before the picture colour is encoded.
 */

export const FOG_MODES = ["exponential", "exponential_squared"] as const;
export type FogMode = (typeof FOG_MODES)[number];

export interface FogSettings {
  enabled: boolean;
  /** "#rrggbb", as seen on screen (sRGB). */
  color: string;
  /** Per unit of distance, 0 or more. Larger = thicker fog. */
  density: number;
  /** Distance from the camera where the fog begins. */
  start: number;
  mode: FogMode;
  /** Whether the sky (rays that hit nothing) is fogged too: it then becomes the fog colour. */
  affects_sky: boolean;
}

export const FOG_LIMITS = { density: [0, 100_000_000], start: [0, 1000] } as const;

export const DEFAULT_FOG: FogSettings = { enabled: false, color: "#9db4cc", density: 0.15, start: 0, mode: "exponential", affects_sky: false };

export function defaultFog(): FogSettings {
  return { ...DEFAULT_FOG };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Reads and checks a fog block. Missing fields get the defaults; no block at all means fog off. */
export function readFog(raw: unknown, where: string, errors: string[]): FogSettings | undefined {
  if (raw === undefined) return defaultFog();
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const before = errors.length;
  const out = defaultFog();
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    else errors.push(`${where}.enabled must be true or false`);
  }
  if (raw.affects_sky !== undefined) {
    if (typeof raw.affects_sky === "boolean") out.affects_sky = raw.affects_sky;
    else errors.push(`${where}.affects_sky must be true or false`);
  }
  if (raw.color !== undefined) {
    if (typeof raw.color === "string" && HEX.test(raw.color)) out.color = raw.color.toLowerCase();
    else errors.push(`${where}.color must be a colour like "#9db4cc"`);
  }
  for (const key of ["density", "start"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    const [lo, hi] = FOG_LIMITS[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) errors.push(`${where}.${key} must be a number from ${lo} to ${hi}`);
    else out[key] = v;
  }
  if (raw.mode !== undefined) {
    if (typeof raw.mode === "string" && (FOG_MODES as readonly string[]).includes(raw.mode)) out.mode = raw.mode as FogMode;
    else errors.push(`${where}.mode must be "exponential" or "exponential_squared"`);
  }
  return errors.length > before ? undefined : out;
}

/** How much of the fog colour is mixed in at `distance`: 0 = none, 1 = only fog. Off gives 0. */
export function fogAmount(fog: FogSettings, distance: number): number {
  if (!fog.enabled) return 0;
  const x = Math.max(distance - fog.start, 0) * fog.density;
  return 1 - Math.exp(fog.mode === "exponential_squared" ? -(x * x) : -x);
}

/** The first number of the packed form: 0 when off, so the shader needs no separate switch. */
export const FOG_FLOATS = 8;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/**
 * The fog as the shader reads it: two vec4. First: the fog colour in linear light and a spare. Second: density
 * (0 when the fog is off, which makes the mixing amount exactly 0), start, mode (0 or 1), and 1 if the sky is fogged.
 */
export function packFog(fog: FogSettings, out = new Float32Array(FOG_FLOATS)): Float32Array {
  const [r, g, b] = rgb(fog.color);
  out.set([r ** 2.2, g ** 2.2, b ** 2.2, 0]);
  out.set([fog.enabled ? fog.density : 0, fog.start, fog.mode === "exponential_squared" ? 1 : 0, fog.affects_sky ? 1 : 0], 4);
  return out;
}

const hex = (c: [number, number, number]): string =>
  "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

/**
 * Fog between two keyframes at fraction f (0 to 1). Colour, density and start blend. A fog that is off counts as
 * zero density in the colour it will have, so fading in or out is smooth. Mode and sky choice switch halfway.
 */
export function blendFog(a: FogSettings, b: FogSettings, f: number): FogSettings {
  if (!a.enabled && !b.enabled) return f >= 0.5 ? b : a;
  const ca = a.enabled ? rgb(a.color) : rgb(b.color);
  const cb = b.enabled ? rgb(b.color) : rgb(a.color);
  const da = a.enabled ? a.density : 0;
  const db = b.enabled ? b.density : 0;
  const to = f >= 0.5 ? b : a;
  const mix = (x: number, y: number): number => x + (y - x) * f;
  return {
    enabled: true,
    color: hex([mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2])]),
    density: mix(da, db),
    start: mix(a.enabled ? a.start : b.start, b.enabled ? b.start : a.start),
    mode: to.mode,
    affects_sky: to.affects_sky,
  };
}

/** The fog with some values changed. */
export function withFogChanges(fog: FogSettings, changes: Partial<FogSettings>): FogSettings {
  return { ...fog, ...changes };
}
