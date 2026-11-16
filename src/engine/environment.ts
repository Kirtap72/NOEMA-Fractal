import { HDR_DATA_ADDRESS } from "./radiance";
import type { HdrImage } from "./radiance";

/**
 * The environment (scene version 12): what is seen behind the shape and what lights it from all sides.
 *
 * "gradient" is the sky that was built into the shader before, so old scenes look exactly as they did. "hdri" is a
 * picture of linear light, an equirectangular map (twice as wide as high), embedded in the scene as a small copy
 * (at most 1024 x 512) so that the scene carries everything it needs. It is shown as the background and lights the
 * surface with its diffuse light. The map is read like this: the middle of the picture is the direction the default
 * camera looks along (negative z), the top is straight up (y), and the picture runs around the vertical axis with
 * increasing azimuth towards positive x.
 *
 * The diffuse light uses nine spherical harmonics coefficients, as in Ramamoorthi and Hanrahan, "An Efficient
 * Representation for Irradiance Environment Maps", SIGGRAPH 2001: for a smooth lighting environment a quadratic
 * polynomial in the surface normal gives the light that reaches a diffuse surface to within a few per cent. The
 * constants below are written from the paper's description (not copied from any code) and are checked in the tests
 * against a numerical integration of the definition. Source details are unverified (see LICENSING.md).
 */

export interface GradientEnvironment {
  kind: "gradient";
}

export interface HdriEnvironment {
  kind: "hdri";
  /** The picture as a data address (see radiance.ts). */
  data: string;
  /** A name to show, for example the file name. */
  name?: string;
  /** Who made the picture, as far as the user knows. */
  author?: string;
  /** Where the picture comes from: a link or a reference. Required (LICENSING.md section 9). */
  source: string;
  /** The licence of the picture, for example "CC0 1.0". Required. */
  license: string;
  /** Turns the picture around the vertical axis, in degrees. */
  rotation_degrees: number;
  /** A factor on the light of the picture (exposure). */
  intensity: number;
  /** Whether the picture is seen behind the shape. If not, the gradient sky is seen, but the light still comes from the picture. */
  background_visible: boolean;
}

export type EnvironmentSettings = GradientEnvironment | HdriEnvironment;

/** The longest data address accepted: a flat 1024 x 512 picture is about 2.8 million characters. */
export const MAX_ENV_DATA_LENGTH = 3_200_000;
export const ENV_INTENSITY_LIMITS = [0, 100] as const;
export const MAX_ENV_TEXT = 500;

export function defaultEnvironment(): EnvironmentSettings {
  return { kind: "gradient" };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Reads and checks an environment block. No block means the gradient sky. */
export function readEnvironment(raw: unknown, where: string, errors: string[]): EnvironmentSettings | undefined {
  if (raw === undefined) return defaultEnvironment();
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  if (raw.kind === "gradient") return { kind: "gradient" };
  if (raw.kind !== "hdri") return void errors.push(`${where}.kind must be "gradient" or "hdri"`);
  const before = errors.length;
  if (typeof raw.data !== "string" || raw.data.length > MAX_ENV_DATA_LENGTH || !HDR_DATA_ADDRESS.test(raw.data)) {
    errors.push(`${where}.data must be a Radiance .hdr picture as a data address (data:image/vnd.radiance;base64,...), at most ${MAX_ENV_DATA_LENGTH} characters`);
  }
  for (const key of ["source", "license"] as const) {
    const v = raw[key];
    if (typeof v !== "string" || v.trim().length === 0 || v.length > MAX_ENV_TEXT) errors.push(`${where}.${key} is required: say where the picture comes from and under which licence (LICENSING.md section 9)`);
  }
  for (const key of ["name", "author"] as const) {
    const v = raw[key];
    if (v !== undefined && (typeof v !== "string" || v.length > MAX_ENV_TEXT)) errors.push(`${where}.${key} must be a text of at most ${MAX_ENV_TEXT} characters`);
  }
  const rotation = raw.rotation_degrees === undefined ? 0 : raw.rotation_degrees;
  if (typeof rotation !== "number" || !Number.isFinite(rotation) || Math.abs(rotation) > 36000) errors.push(`${where}.rotation_degrees must be a number from -36000 to 36000`);
  const intensity = raw.intensity === undefined ? 1 : raw.intensity;
  if (typeof intensity !== "number" || !Number.isFinite(intensity) || intensity < ENV_INTENSITY_LIMITS[0] || intensity > ENV_INTENSITY_LIMITS[1]) {
    errors.push(`${where}.intensity must be a number from ${ENV_INTENSITY_LIMITS[0]} to ${ENV_INTENSITY_LIMITS[1]}`);
  }
  const background = raw.background_visible === undefined ? true : raw.background_visible;
  if (typeof background !== "boolean") errors.push(`${where}.background_visible must be true or false`);
  if (errors.length > before) return undefined;
  return {
    kind: "hdri",
    data: raw.data as string,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(typeof raw.author === "string" && raw.author.length > 0 ? { author: raw.author } : {}),
    source: (raw.source as string).trim(),
    license: (raw.license as string).trim(),
    rotation_degrees: rotation as number,
    intensity: intensity as number,
    background_visible: background as boolean,
  };
}

// ---- directions on the map

/** The direction (unit vector) that the pixel at (u, v), each from 0 to 1, looks at. u runs around, v runs from the top (0) to the bottom (1). */
export function mapDirection(u: number, v: number): [number, number, number] {
  const azimuth = (u - 0.5) * 2 * Math.PI;
  const theta = v * Math.PI;
  return [Math.sin(theta) * Math.sin(azimuth), Math.cos(theta), -Math.sin(theta) * Math.cos(azimuth)];
}

/** The place on the map (u and v from 0 to 1) that a direction looks at: the opposite of mapDirection. */
export function directionToMap(d: readonly [number, number, number]): [number, number] {
  const len = Math.hypot(d[0], d[1], d[2]);
  const azimuth = Math.atan2(d[0], -d[2]);
  return [azimuth / (2 * Math.PI) + 0.5, Math.acos(Math.max(-1, Math.min(1, d[1] / len))) / Math.PI];
}

/** Turns a direction around the vertical axis by `degrees`, in the sense in which the picture is turned. */
export function turnAroundVertical(d: readonly [number, number, number], degrees: number): [number, number, number] {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // azimuth + a, where the azimuth is atan2(x, -z)
  return [d[0] * c + -d[2] * s, d[1], d[2] * c + d[0] * s];
}

/** The picture's colour in a direction (nearest pixel; the shader interpolates, this is for tests and tools). */
export function environmentColor(image: HdrImage, d: readonly [number, number, number], rotationDegrees = 0): [number, number, number] {
  // The picture is turned by +rotation, so the lookup direction is turned back by -rotation.
  const [u, v] = directionToMap(turnAroundVertical(d, -rotationDegrees));
  const x = Math.min(image.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * image.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)));
  const i = (y * image.width + x) * 3;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
}

// ---- diffuse light from nine coefficients

/** Constants of the quadratic form of the irradiance (Ramamoorthi and Hanrahan 2001, written from the paper's description). */
const C1 = 0.429043;
const C2 = 0.511664;
const C3 = 0.743125;
const C4 = 0.886227;
const C5 = 0.247708;
/** Values of the real spherical harmonics (l up to 2). */
const Y00 = 0.282095;
const Y1 = 0.488603;
const Y2A = 1.092548;
const Y20 = 0.315392;
const Y22 = 0.546274;

/** Nine vec4 of the irradiance polynomial, rgb in each (w unused). */
export const ENV_SH_FLOATS = 36;

/**
 * Projects a map onto the nine coefficients and returns them in the form the shader evaluates: see `diffuseLight`.
 * Every pixel counts with its solid angle (the area it covers on the sphere).
 */
export function irradianceCoefficients(image: HdrImage): Float32Array {
  // L[l,m] for 9 terms, three channels each.
  const L = new Float64Array(27);
  // The areas of the pixels on the sphere, scaled to add up to exactly 4 pi (the midpoint rule is a little off), so that
  // a picture of one colour gives exactly that colour as light.
  let total = 0;
  for (let y = 0; y < image.height; y++) total += Math.sin(((y + 0.5) / image.height) * Math.PI) * image.width;
  const areaScale = (4 * Math.PI) / total;
  for (let y = 0; y < image.height; y++) {
    const theta = ((y + 0.5) / image.height) * Math.PI;
    const solidAngle = Math.sin(theta) * areaScale;
    for (let x = 0; x < image.width; x++) {
      const [dx, dy, dz] = mapDirection((x + 0.5) / image.width, (y + 0.5) / image.height);
      const basis = [Y00, Y1 * dy, Y1 * dz, Y1 * dx, Y2A * dx * dy, Y2A * dy * dz, Y20 * (3 * dz * dz - 1), Y2A * dx * dz, Y22 * (dx * dx - dy * dy)];
      const i = (y * image.width + x) * 3;
      for (let k = 0; k < 9; k++) {
        const w = basis[k]! * solidAngle;
        L[k * 3] = L[k * 3]! + image.data[i]! * w;
        L[k * 3 + 1] = L[k * 3 + 1]! + image.data[i + 1]! * w;
        L[k * 3 + 2] = L[k * 3 + 2]! + image.data[i + 2]! * w;
      }
    }
  }
  // Order: 0 = L00, 1 = L1-1 (y), 2 = L10 (z), 3 = L11 (x), 4 = L2-2 (xy), 5 = L2-1 (yz), 6 = L20, 7 = L21 (xz), 8 = L22.
  const l = (k: number, c: number): number => L[k * 3 + c]!;
  const out = new Float32Array(ENV_SH_FLOATS);
  for (let c = 0; c < 3; c++) {
    out[0 * 4 + c] = C4 * l(0, c) - C5 * l(6, c);
    out[1 * 4 + c] = 2 * C2 * l(3, c); // x
    out[2 * 4 + c] = 2 * C2 * l(1, c); // y
    out[3 * 4 + c] = 2 * C2 * l(2, c); // z
    out[4 * 4 + c] = 2 * C1 * l(4, c); // x y
    out[5 * 4 + c] = 2 * C1 * l(5, c); // y z
    out[6 * 4 + c] = 2 * C1 * l(7, c); // x z
    out[7 * 4 + c] = C1 * l(8, c); // x x - y y
    out[8 * 4 + c] = C3 * l(6, c); // z z
  }
  return out;
}

/**
 * The irradiance (the light that reaches a diffuse surface, as an integral over the half sphere weighted by the
 * cosine) for a surface with the unit normal n. Divided by pi it is the colour of a white diffuse surface.
 * This is exactly what the shader computes.
 */
export function irradiance(sh: ArrayLike<number>, n: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = n;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] =
      sh[c]! +
      sh[4 + c]! * x +
      sh[8 + c]! * y +
      sh[12 + c]! * z +
      sh[16 + c]! * x * y +
      sh[20 + c]! * y * z +
      sh[24 + c]! * x * z +
      sh[28 + c]! * (x * x - y * y) +
      sh[32 + c]! * z * z;
  }
  return out;
}

/** The light of a white diffuse surface with normal n (irradiance / pi), with the picture turned by `rotationDegrees` and the exposure applied. Never below 0. */
export function diffuseLight(sh: ArrayLike<number>, n: readonly [number, number, number], rotationDegrees = 0, intensity = 1): [number, number, number] {
  const e = irradiance(sh, turnAroundVertical(n, -rotationDegrees));
  return e.map((v) => (Math.max(v, 0) / Math.PI) * intensity) as [number, number, number];
}

/** What the shader reads about the environment: one vec4 (kind, intensity, rotation in radians, background) then nine vec4. */
export const ENV_FLOATS = 4 + ENV_SH_FLOATS;

/** The first number is 1 only for an environment picture that is loaded, so the shader needs no separate switch. */
export function packEnvironment(env: EnvironmentSettings, sh: Float32Array | null, out = new Float32Array(ENV_FLOATS)): Float32Array {
  out.fill(0);
  if (env.kind !== "hdri" || !sh) return out;
  out.set([1, env.intensity, (env.rotation_degrees * Math.PI) / 180, env.background_visible ? 1 : 0], 0);
  out.set(sh, 4);
  return out;
}
