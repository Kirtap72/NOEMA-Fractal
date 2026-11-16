/** Mathematical primitives from the normalized batch-01 handoff in NewFormulas. */
export type V4 = [number, number, number, number];
export type Matrix = number[][];
export const PI = Math.PI;

export function rotation3(angles: readonly number[]): Matrix {
  const [sx, sy, sz] = angles.map((a) => Math.sin((a * PI) / 180));
  const [cx, cy, cz] = angles.map((a) => Math.cos((a * PI) / 180));
  return [
    [cy! * cz!, -cy! * sz!, sy!],
    [sx! * sy! * cz! + cx! * sz!, cx! * cz! - sx! * sy! * sz!, -sx! * cy!],
    [sx! * sz! - cx! * sy! * cz!, cx! * sy! * sz! + sx! * cz!, cx! * cy!],
  ].map((row) => row.map(Math.fround));
}

export const ROTATION_PLANES = [
  [1, 2],
  [0, 2],
  [0, 1],
  [0, 3],
  [1, 3],
  [2, 3],
] as const;
export const FOLD_PAIRS = [
  [0, 1],
  [0, 2],
  [1, 2],
  [0, 3],
  [1, 3],
  [2, 3],
] as const;

export function rotation4(angles: readonly number[]): Matrix {
  let r: Matrix = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => Number(i === j)),
  );
  ROTATION_PLANES.forEach(([a, b], k) => {
    const c = Math.fround(Math.cos((angles[k]! * PI) / 180));
    const s = Math.fround(Math.sin((angles[k]! * PI) / 180));
    const old = r.map((row) => [...row]);
    r[a] = old[a]!.map((v, j) => Math.fround(c * v - s * old[b]![j]!));
    r[b] = old[b]!.map((v, j) => Math.fround(s * old[a]![j]! + c * v));
  });
  return r;
}

export function applyMatrix(r: Matrix, v: readonly number[]): number[] {
  return r.map((row) => row.reduce((sum, a, j) => sum + a * v[j]!, 0));
}

export function quadrayLift([x, y, z]: readonly number[]): V4 {
  return [
    Math.abs(x! + y! + z!),
    Math.abs(-x! - y! + z!),
    Math.abs(-x! + y! - z!),
    Math.abs(x! - y! - z!),
  ];
}

export function quadraySquare([x, y, z, w]: V4): V4 {
  return [
    x * x - y * y + 2 * w * z,
    y * y - x * x + 2 * w * z,
    z * z - w * w + 2 * x * y,
    w * w - z * z + 2 * x * y,
  ];
}

export function pairReflections(input: V4): V4 {
  const v: V4 = [...input];
  for (const [a, b] of FOLD_PAIRS)
    if (v[a] + v[b] <= 0) [v[a], v[b]] = [-v[b], -v[a]];
  return v;
}

/** The literal stored decimal normal is deliberately not normalized again. */
export function goldenReflections(input: readonly number[]): number[] {
  let v = [...input];
  const n = [0.309016994374947, -0.5, -0.809016994374947];
  for (let pass = 0; pass < 3; pass++) {
    const d = v.reduce((s, x, i) => s + x * n[i]!, 0);
    if (d < 0) v = v.map((x, i) => x - 2 * d * n[i]!);
    v[1] = Math.abs(v[1]!);
    v[2] = Math.abs(v[2]!);
  }
  return v;
}

/** Nearest-even UI rounding, then the recovered three-bit pass count. */
export function maskedPasses(value: number): number {
  return Math.max(1, nearestEven(value) & 7);
}

export function nearestEven(value: number): number {
  const lo = Math.floor(value),
    fraction = value - lo;
  const rounded =
    fraction === 0.5 ? lo + (lo % 2 === 0 ? 0 : 1) : Math.round(value);
  return rounded;
}

/** Scalar-first Hamilton algebra, distinct from the commutative hypercomplex algebra. */
export function hamiltonProduct([x, y, z, w]: V4, [a, b, c, d]: V4): V4 {
  return [
    x * a - y * b - z * c - w * d,
    x * b + y * a + z * d - w * c,
    x * c - y * d + z * a + w * b,
    x * d + y * c - z * b + w * a,
  ];
}
export function commutativeProduct([x, y, z, w]: V4, [a, b, c, d]: V4): V4 {
  return [
    x * a - y * b - z * c + w * d,
    x * b + y * a - z * d - w * c,
    x * c + z * a - y * d - w * b,
    x * d + w * a + y * c + z * b,
  ];
}
export function compareSwapFold(
  input: readonly number[],
  pairs: readonly (readonly [number, number])[],
): number[] {
  const v = [...input];
  for (const [a, b] of pairs) if (v[a]! < v[b]!) [v[a], v[b]] = [v[b]!, v[a]!];
  return v;
}
export const OCTAHEDRON_PAIRS = [
  [0, 1],
  [0, 2],
  [1, 3],
  [0, 3],
  [2, 3],
] as const;

/** Literal recovered charts. Singular axes intentionally have no continuation. */
export function stereographicChart(
  x: number,
  y: number,
  z: number,
  dihedral: boolean,
): [number, number] | null {
  const r = Math.hypot(x, y, z);
  if (!(r > 0 && x !== 0 && 1 + z / r > 0)) return null;
  const q = (Math.hypot(x, y) - y) / x;
  const a = Math.sqrt((1 - z / r) / (1 + z / r)) / (1 + q * q);
  return dihedral ? [2 * a * q, a * (1 - q * q)] : [a * (q * q - 1), 2 * a * q];
}
export function inverseStereographicChart(
  u: number,
  t: number,
  radius: number,
  sign: number,
): number[] | null {
  if (u === 0) return null;
  const h = u * u + t * t,
    mag = Math.sqrt(h),
    q = (mag - t) / u,
    a = 1 / (1 + q * q),
    b = 2 / (1 + h);
  return [
    radius * 2 * q * a * b * mag,
    radius * (1 - q * q) * a * b * mag,
    sign * radius * (b - 1),
  ];
}
export function radialFoldFactor(
  rr: number,
  lo: number,
  hi: number,
  inclusive: boolean,
): number {
  return (inclusive ? rr >= hi : rr > hi) ? 1 : hi / Math.max(rr, lo);
}
export function mengerFold(
  u: readonly number[],
  s: number,
  a: readonly number[],
): number[] {
  const offset = (a[2]! * (s - 1)) / s;
  return [
    s * u[0]! - a[0]! * (s - 1),
    s * u[1]! - a[1]! * (s - 1),
    s * (offset - Math.abs(u[2]! - offset)),
  ];
}
/** Parameterized bilinear algebra from the authoritative hyperd_1 specification.
 * It is not assumed associative: callers keep the base fixed and recurse explicitly. */
export function bilinearProduct(
  base: V4,
  accumulator: V4,
  zw: number,
  yw: number,
  yz: number,
): V4 {
  const [x, y, z, w] = base,
    [a, b, d, e] = accumulator;
  return [
    x * a - y * b - z * d - w * e + (z * e + w * d) * zw,
    x * b + y * a,
    x * d + z * a + (y * e + w * b) * yw,
    x * e + w * a + (y * d + z * b) * yz,
  ];
}

/** Scalar-first quaternion sine. The supplied domain excludes the real axis. */
export function quaternionSine(v: V4, amplitude: number): V4 | null {
  const [x, y, z, w] = v,
    r = Math.sqrt(y * y + z * z + w * w);
  if (r === 0) return null;
  const f = (amplitude * Math.cos(x) * Math.sinh(r)) / r;
  return [amplitude * Math.sin(x) * Math.cosh(r), f * y, f * z, f * w];
}

/** Shared signed dIFS affine evaluation/commit rule; q is used even when not committed. */
export function difsAffine(
  v: V4,
  scale: number,
  offset: readonly number[],
  apply: boolean,
  varyScale: number,
) {
  const q = v.slice(0, 3).map((a, i) => scale * a + offset[i]!);
  return {
    q,
    v: (apply ? [...q, v[3]] : [...v]) as V4,
    varyScale: apply ? varyScale * scale : varyScale,
  };
}

/** Portable zero-direction convention, including signed zero. */
export function directionAngle(numerator: number, denominator: number): number {
  return numerator === 0 && denominator === 0
    ? 0
    : Math.atan2(numerator, denominator);
}
