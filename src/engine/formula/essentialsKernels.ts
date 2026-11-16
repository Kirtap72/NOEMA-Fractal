/** Independent equations from NewFormulas/essentials-40, before host bookkeeping. */
import { ESSENTIALS_DEFINITIONS } from "./essentialsMetadata";
import { stepKernel } from "./kernels";
import type {
  PreparedKernel,
  KernelState,
  KernelParameters,
  KernelId,
} from "./kernels";
import {
  applyMatrix,
  rotation3,
  rotation4,
  goldenReflections,
  nearestEven,
  directionAngle,
} from "./primitives";
import type { Matrix, V4 } from "./primitives";

export const sourceKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/^(?=\d)/, "p_");
export function prepareEssentialsMatrices(
  id: KernelId,
  p: KernelParameters,
): Matrix[] {
  const definition = ESSENTIALS_DEFINITIONS.find((d) => d.id === id)!;
  return definition.rotations.map((r) =>
    r.dimension === 4
      ? rotation4(
          ["yz", "xz", "xy", "xw", "yw", "zw"].map(
            (a) => p[r.prefix + "_" + a]!,
          ),
        )
      : rotation3(["x", "y", "z"].map((a) => p[r.prefix + "_" + a]!)),
  );
}
export const boxFold = (t: number, f: number) =>
  Math.abs(t + f) - Math.abs(t - f) - t;
export const sphereFactor = (
  rr: number,
  low: number,
  scale: number,
  innerScale = scale,
) => (rr < low ? innerScale / low : rr < 1 ? scale / rr : scale);
export function triplexProduct(
  a: readonly number[],
  b: readonly number[],
): number[] {
  const [x, y, z] = a as [number, number, number],
    [X, Y, Z] = b as [number, number, number];
  const rho = Math.hypot(x, y),
    RHO = Math.hypot(X, Y);
  if (rho * RHO === 0) return [-z * Z, z * Z, rho * Z + RHO * z];
  const f = 1 - (z * Z) / (rho * RHO);
  return [(x * X - y * Y) * f, (y * X + x * Y) * f, rho * Z + RHO * z];
}
const dot = (v: readonly number[]) => v.reduce((s, t) => s + t * t, 0);
const transpose = (m: Matrix) => m[0]!.map((_, i) => m.map((row) => row[i]!));
const smoothAbs = (t: number, s: number) =>
  s >= 0
    ? Math.sqrt(t * t + Math.abs(s))
    : Math.abs(t) ** 3 / (t * t + Math.abs(s));
const fastPow = (t: number, p: number) => (p <= 1 ? t : t ** p);
export function updateVaryScale(
  s: KernelState,
  scale: number,
  vary: number,
): number {
  if (s.firstIteration <= 0) {
    s.firstIteration++;
    s.first = s.firstIteration > 0;
    s.varyScale = scale;
  }
  s.varyScale += vary * (Math.abs(s.varyScale) - 1);
  return s.varyScale;
}
/** Exact low/high words of unsigned multiplication, including wrap. */
export function multiplyUnsigned32(a: number, b: number): [number, number] {
  const result = BigInt(a >>> 0) * BigInt(b >>> 0);
  return [Number(result & 0xffffffffn), Number(result >> 32n)];
}

export function stepEssentialsKernel(
  { id, p, matrices }: PreparedKernel,
  s: KernelState,
): void {
  const P = (label: string) => p[sourceKey(label)]!;
  let [x, y, z, w] = s.v;
  const [cx, cy, cz, cw] = s.c;
  const c = s.c,
    abs = Math.abs,
    sqrt = Math.sqrt,
    sin = Math.sin,
    cos = Math.cos;
  const vec = (suffix: string, axes = "XYZ") =>
    [...axes].map((a) => P(a + " " + suffix));
  const mul = (i: number, v: readonly number[]) => applyMatrix(matrices[i]!, v);
  const low = () => Math.max(1e-40, P("Min R")) ** 2;
  const vary = () => updateVaryScale(s, P("Scale"), P("Scale vary"));
  const xyz = (v: readonly number[]) => {
    [x, y, z] = v as [number, number, number];
  };
  try {
    switch (id) {
      case "mb3d-folding1":
        xyz([x, y, z].map((t) => boxFold(t, P("R fold"))));
        break;
      case "mb3d-folding2": {
        const f = P("R fold");
        xyz([x, y, z].map((t) => t + abs(t - 2 * f) - abs(t - f) - f));
        break;
      }
      case "mb3d-rotate":
        xyz(mul(0, [x, y, z]));
        break;
      case "mb3d-rotate4d":
        [x, y, z, w] = mul(0, [x, y, z, w]) as V4;
        break;
      case "mb3d-rotatedfolding":
      case "mb3d-rotatedabs": {
        const u = mul(0, [x, y, z]);
        u[0] =
          id === "mb3d-rotatedfolding"
            ? boxFold(u[0]!, P("Fold of x"))
            : abs(u[0]! + P("AddX")) - P("SubX");
        xyz(applyMatrix(transpose(matrices[0]!), u));
        break;
      }
      case "mb3d-scaling":
        [x, y, z, w] = s.v.map((t) => P("Scale") * t) as V4;
        break;
      case "mb3d-scalingplus":
        [x, y, z, w] = s.v.map((t, i) => t * P("xyzw"[i] + " scale")) as V4;
        break;
      case "mb3d-translate":
        xyz([x, y, z].map((t, i) => t + vec("add")[i]!));
        break;
      case "mb3d-addc":
        xyz(
          [x, y, z].map(
            (t, i) => t + c[i]! * P("C" + "xyz"[i] + " multiplier"),
          ),
        );
        break;
      case "mb3d-partlyjulia":
        for (let i = 0; i < 3; i++) {
          const a = "XYZ"[i]!,
            q = s.originalPoint[i]!;
          if (q > P(a + " above") || q <= P(a + " below"))
            s.c[i] = q + P(a + " add");
        }
        break;
      case "mb3d-partlyjuliar": {
        const centre = vec("Center"),
          seed = vec("Seed"),
          [X, Y, Z] = [x, y, z].map((t, i) => t - centre[i]!) as [
            number,
            number,
            number,
          ],
          shape = nearestEven(P("Shape"));
        if (
          !(P("R Max") > 0) ||
          P("Speed (max 1)") < 0 ||
          P("Speed (max 1)") > 1
        )
          throw Error();
        const metric =
          shape === 1
            ? Math.max(abs(X), abs(Y), abs(Z))
            : shape === 2
              ? sqrt((X * X + Y * Y) / (Z * Z))
              : shape === 3
                ? Math.hypot(X, Y)
                : shape === -2
                  ? Z > 0
                    ? Math.hypot(X, Y) / Z
                    : P("R Max")
                  : shape === 4
                    ? Math.max(abs(X), abs(Y)) / abs(Z)
                    : shape === -4
                      ? Z > 0
                        ? Math.max(abs(X), abs(Y)) / abs(Z)
                        : P("R Max")
                      : Math.hypot(X, Y, Z);
        const R = metric / P("R Max");
        if (!Number.isFinite(R)) throw Error();
        let rc = 0;
        if (nearestEven(P("Inside mode")) === 1) {
          if (R < 1) {
            let t = R - P("Speed (max 1)");
            if (t > 0) {
              t /= 1 - P("Speed (max 1)");
              s.c = [
                ...c.map((q, i) => (i < 3 ? t * q + (1 - t) * seed[i]! : q)),
              ] as V4;
              rc = P("Recenter") * (1 - t);
            } else {
              s.c = [...seed, cw] as V4;
              rc = P("Recenter");
            }
          }
        } else if (R >= 1) s.c = [...seed, cw] as V4;
        else {
          let t = R - P("Speed (max 1)");
          if (t > 0) {
            t /= 1 - P("Speed (max 1)");
            s.c = c.map((q, i) =>
              i < 3
                ? (1 - t) * (q - P("Recenter") * centre[i]!) + t * seed[i]!
                : q,
            ) as V4;
            rc = P("Recenter") * (1 - t);
          } else {
            s.c = c.map((q, i) =>
              i < 3 ? q - P("Recenter") * centre[i]! : q,
            ) as V4;
            rc = P("Recenter");
          }
        }
        xyz([x, y, z].map((q, i) => q - rc * centre[i]!));
        break;
      }
      case "mb3d-sphereinv": {
        const centre = vec("center"),
          u = [x, y, z].map((t, i) => t + centre[i]!),
          radius = abs(P("Radius")) >= 1e-40 ? P("Radius") : 1e-40,
          q = dot(u) / radius,
          mode = nearestEven(P("FoldMode (1 or 2)")),
          rad = P("Rad2");
        if (!(mode !== 0 && q > 1)) {
          const m =
            q < rad
              ? mode === 2
                ? 1 / (2 * rad - q)
                : 1 / Math.max(1e-40, rad)
              : 1 / q;
          xyz(u.map((q, i) => m * q - centre[i]!));
        }
        break;
      }
      case "mb3d-amazingbox":
      case "mb3d-amazingbox2":
      case "mb3d-amazing-surf":
      case "mb3d-aboxvaryscale":
      case "mb3d-aboxmodkali":
      case "mb3d-asurfmod1":
      case "mb3d-aboxvaryscale4d": {
        const scale = P("Scale"),
          f = id === "mb3d-amazingbox" ? 1 : P("Fold");
        let u: number[],
          rr: number,
          m: number,
          k = scale;
        if (
          [
            "mb3d-amazing-surf",
            "mb3d-aboxvaryscale",
            "mb3d-asurfmod1",
            "mb3d-aboxvaryscale4d",
          ].includes(id)
        )
          k = vary();
        if (id === "mb3d-amazingbox2") {
          const a = (P("FoldX, XZ angle") * Math.PI) / 180,
            b = (P("FoldX, XY angle") * Math.PI) / 180;
          let X = x * cos(a) - z * sin(a),
            Z = x * sin(a) + z * cos(a),
            Y = X * sin(b) + y * cos(b);
          X = boxFold(X * cos(b) - y * sin(b), f);
          X = (X * cos(b) - Y * sin(b)) * cos(a) - Z * sin(a);
          const centre = [P("Inv xC"), P("Inv yC"), P("Inv zC")];
          u = [
            X + centre[0]!,
            boxFold(y, f) + centre[1]!,
            boxFold(z, f) + centre[2]!,
          ];
          rr =
            dot(u) / (abs(P("Inv Radius")) >= 1e-40 ? P("Inv Radius") : 1e-40);
          m = sphereFactor(rr, low(), scale);
          xyz(
            mul(
              0,
              u.map((t, i) => m * t - scale * centre[i]!),
            ).map((t, i) => t + c[i]!),
          );
          w *= m;
          break;
        }
        if (id === "mb3d-aboxmodkali")
          u = [P("X add") - abs(x), P("Y add") - abs(y), P("Z add") - abs(z)];
        else if (id === "mb3d-asurfmod1")
          u = [
            f - abs(abs(x + P("FoldXMod")) - f) - abs(P("FoldXMod")),
            f - abs(abs(y + P("FoldYMod")) - f) - abs(P("FoldYMod")),
            z,
          ];
        else if (id === "mb3d-aboxvaryscale")
          u = [x, y, z].map((t) =>
            t >= f ? 2 * f - t : t < -f ? -2 * f - t : t,
          );
        else
          u = (id === "mb3d-aboxvaryscale4d" ? [x, y, z, w] : [x, y, z]).map(
            (t, i) =>
              id === "mb3d-amazing-surf" && i === 2 ? t : boxFold(t, f),
          );
        rr =
          id === "mb3d-amazing-surf"
            ? u[0]! ** 2 +
              u[1]! ** 2 +
              (nearestEven(P("Sphere or Cylinder")) === 0 ? u[2]! ** 2 : 0)
            : dot(u);
        if (id === "mb3d-aboxvaryscale" || id === "mb3d-aboxvaryscale4d") {
          rr **=
            id === "mb3d-aboxvaryscale4d"
              ? Math.fround(P("R power"))
              : P("R power");
          if(!Number.isFinite(rr))throw Error('Undefined norm power');
        }
        if (id === "mb3d-asurfmod1") rr *= P("1/Radius");
        m = sphereFactor(
          rr,
          low(),
          k,
          id === "mb3d-aboxvaryscale4d" ? k : scale,
        );
        if (id === "mb3d-aboxvaryscale4d") {
          [x, y, z, w] = u.map((t, i) => m * t + c[i]!) as V4;
          w += P("W add");
          s.derivative *= m;
          break;
        }
        if (id === "mb3d-amazingbox") xyz(u.map((t) => m * t));
        else if (id === "mb3d-amazing-surf")
          xyz(
            mul(
              0,
              u.map((t, i) => m * t + c[i]!),
            ),
          );
        else if (id === "mb3d-asurfmod1") {
          const [Z, Y, X] = mul(
            0,
            [...u].reverse().map((t) => m * t),
          );
          xyz([X! + cy, Y! + cx, Z! + cz]);
        } else xyz(u.map((t, i) => m * t + c[i]!));
        w = m * (id === "mb3d-aboxmodkali" ? abs(w) : w);
        break;
      }
      case "mb3d-aboxsmoothfold": {
        const power = nearestEven(P("Sharpness (Integer 2+)")),
          bp = nearestEven(P("Sh. of BallFold (Int 3+)"));
        if (power < 0 || bp < 0) throw Error();
        const u = [x, y, z].map((t) => {
          const q = abs(t),
            rp = P("Fix (BoxFold)") * fastPow(q, power);
          return (
            ((t >= 0 ? 1 : -1) * (q + rp * (2 * P("Fold") - q))) / (1 + rp)
          );
        });
        const k = vary(),
          l = low();
        let r = 1;
        if (l < 0.99) {
          const mid = (1 + l) / 2,
            half = (1 - l) / 2,
            d = dot(u) - mid,
            t = abs(d) / half,
            rp =
              P("Fix (BallFold)") *
              fastPow(bp & 1 ? sqrt(t) : t, bp & 1 ? bp : Math.floor(bp / 2));
          r = mid + ((d >= 0 ? 1 : -1) * half * (rp + t)) / (rp + 1);
        }
        const m = k / r;
        xyz(u.map((t, i) => m * t + c[i]!));
        w *= m;
        break;
      }
      case "mb3d-menger3":
      case "mb3d-mengersmt": {
        let u: number[];
        const k = P("Scale"),
          d = k - 1;
        if (id === "mb3d-menger3") {
          u = mul(0, [x, y, z].map(abs)).sort((a, b) => b - a);
          u = mul(1, u);
          xyz([
            k * u[0]! - P("CScale X") * d,
            k * u[1]! - P("CScale Y") * d,
            k * u[2]!,
          ]);
          if (z >= 0.5 * P("CScale Z") * d) z -= P("CScale Z") * d;
        } else {
          if (k === 0) throw Error();
          const L = P("LSmoothing (+-)"),
            E = P("ESmoothing (+-)");
          u = [x, y, z].map((t) => smoothAbs(t, L));
          for (const [a, b] of [
            [0, 1],
            [0, 2],
            [1, 2],
          ]) {
            const t = 0.5 * (u[a!]! - u[b!]! - smoothAbs(u[a!]! - u[b!]!, E));
            u[a!]! -= t;
            u[b!]! += t;
          }
          u = mul(0, u);
          const q = (P("CScale Z") * d) / k;
          xyz([
            k * u[0]! - P("CScale X") * d,
            k * u[1]! - P("CScale Y") * d,
            k * (q - smoothAbs(u[2]! - q, L)),
          ]);
        }
        w *= k;
        break;
      }
      case "mb3d-dodecahedronifs": {
        const previous = s.derivative;
        s.derivative = w;
        stepKernel({ id: "icosahedron-ifs", p, matrices }, s);
        w = s.derivative;
        s.derivative = previous;
        xyz(s.v);
        break;
      }
      case "mb3d-foldingicosa":
        xyz(goldenReflections(mul(0, [x, y, z]).map(abs)));
        break;
      case "mb3d-foldingtetra3d": {
        const u = [x, y, z],
          first = nearestEven(P("Fold 1st half")),
          second = nearestEven(P("Fold 2nd half"));
        for (const [a, b] of [
          [0, 1],
          [0, 2],
          [1, 2],
        ])
          if (first !== 0 && u[a!]! + u[b!]! <= 0)
            [u[a!], u[b!]] = [-u[b!]!, -u[a!]!];
        for (const [a, b] of [
          [0, 1],
          [0, 2],
          [1, 2],
        ])
          if ((first === 0 || second !== 0) && u[a!]! - u[b!]! <= 0)
            [u[a!], u[b!]] = [u[b!]!, u[a!]!];
        xyz(u);
        break;
      }
      case "mb3d-generalquat": {
        const u = [x * x - y * y, 2 * x * y, 2 * x * z, 2 * x * w],
          terms = [y * z, y * z, z * z, y * w, y * w, z * w, z * w, w * w],
          names = [
            "IJ yz",
            "JI yz",
            "JJ zz",
            "IK yw",
            "KI yw",
            "JK zw",
            "KJ zw",
            "KK ww",
          ];
        names.forEach((key, i) => {
          const sel = nearestEven(P(key));
          u[(abs(sel) - 1) & 3]! += (sel > 0 ? 1 : -1) * terms[i]!;
        });
        [x, y, z, w] = u.map((t, i) => t + c[i]!) as V4;
        break;
      }
      case "mb3d-commquat":
        [x, y, z, w] = [
          P("X mul") * (x * x - y * y - 2 * z * w) + cx,
          P("Y mul") * (2 * x * y + z * z - w * w) + cy,
          P("Z mul") * (2 * x * z - 2 * y * w) + cz,
          P("W mul") * (2 * x * w + 2 * y * z) + P("W add") + cw,
        ];
        break;
      case "mb3d-benesi1pow2": {
        const rho = sqrt(y * y + z * z);
        if (rho === 0) throw Error();
        const k = (2 * x) / rho;
        xyz([
          x * x - y * y - z * z + cx,
          abs(cy) - abs(k * (y * y - z * z)),
          abs(cz) - abs(2 * k * y * z),
        ]);
        break;
      }
      case "mb3d-beth1522": {
        const comp = (u: number, v: number, t: number, C: number) =>
          C -
          0.15625 *
            u *
            (20.65247584249853 * v ** 4 -
              10.652475842498529 * t ** 4 -
              2 *
                (30 * v * v * t * t -
                  (-10.652475842498529 * v * v + 20.65247584249853 * t * t) *
                    u *
                    u +
                  u ** 4));
        xyz([comp(x, y, z, cx), comp(y, z, x, cy), comp(z, x, y, cz)]);
        break;
      }
      case "mb3d-magvsxyzabs3": {
        const r = sqrt(x * x + y * y + z * z);
        xyz(
          [x, y, z].map((t, i) => {
            const base = P("Axiom 2") * t * t + r * r;
            if (!(base > 0)) throw Error();
            return (
              (t < 0 ? 1 : -1) *
                base ** (P("Power") / 2) *
                cos(
                  P("Power") *
                    directionAngle(r, P("Power") * P("Axiom 1") * abs(t)) +
                    P("CosShift"),
                ) +
              c[i]! * P(["CosShift", "CxM", "CyM"][i]!)
            );
          }),
        );
        break;
      }
      case "mb3d-ikenagabulb": {
        const a = ["a-x", "a-y", "a-z"].map(P),
          b = ["b-x", "b-y", "b-z"].map(P),
          v = [x, y, z],
          rr = x * x + y * y,
          f = rr !== 0 ? 1 - (3 * z * z) / rr : 0,
          v3 = [
            x * (x * x - 3 * y * y) * f,
            y * (3 * x * x - y * y) * f,
            z * (3 * rr - z * z),
          ],
          q = triplexProduct(v, a),
          vAC = triplexProduct(q, c),
          rho = Math.hypot(q[0]!, q[1]!),
          RHO = Math.hypot(cx, cy);
        if (rho * RHO !== 0)
          vAC[1] = (cx * q[1]! + q[2]! * cy) * (1 - (q[2]! * cz) / (rho * RHO));
        const vB = triplexProduct(v, b);
        xyz([
          v3[0]! + vAC[0]! - vB[0]! - cx,
          v3[1]! + vAC[1]! - vB[1]! - cy,
          v3[2]! + vAC[2]!,
        ]);
        break;
      }
      case "mb3d-mobiustpx": {
        const v = [x, y, z],
          a = ["a-x", "a-y", "a-z"].map(P),
          b = ["b-x", "b-y", "b-z"].map(P),
          C = ["c-x", "c-y", "c-z"].map(P),
          d = ["d-x", "d-y", "d-z"].map(P),
          den = triplexProduct(v, C).map((t, i) => t + d[i]!),
          norm = dot(den);
        if (norm <= 1e-90) {
          xyz([1e90, 1e90, 1e90]);
          break;
        }
        const num = triplexProduct(v, a).map((t, i) => t + b[i]!),
          rho = Math.hypot(num[0]!, num[1]!),
          RHO = Math.hypot(den[0]!, den[1]!);
        if (rho * RHO === 0) {
          x = num[2]! * den[2]!;
          y = -x;
        } else {
          const f = (1 + (num[2]! * den[2]!) / (rho * RHO)) / norm;
          x = (num[0]! * den[0]! + num[1]! * den[1]!) * f;
          y = (den[0]! * num[1]! - num[0]! * den[1]!) * f;
        }
        z = (RHO * num[2]! - rho * den[2]!) / norm;
        break;
      }
      case "mb3d-tetrafolding-pow2": {
        const R = matrices[0]!.map((row) => [...row]);
        let u = [x, y, z];
        const fold = (mul: number) => {
          const a = applyMatrix(R, u);
          a[0] =
            (nearestEven(P("Tglad folding")) === 1
              ? boxFold(a[0]!, P("Fold"))
              : P("Fold") - abs(a[0]! - P("Fold"))) * mul;
          u = applyMatrix(transpose(R), a);
        };
        fold(P("Z mul 2"));
        const A = [
            [0, 2],
            [1, 2],
            [2, 0],
            [2, 1],
          ],
          B = [
            [0, 1],
            [1, 2],
            [1, 0],
            [2, 1],
          ],
          C = [
            [0, 2],
            [0, 1],
            [2, 0],
            [1, 0],
          ],
          mode = nearestEven(P("Modes (0 to 3)")),
          seq =
            mode === 0
              ? [A, B, A]
              : mode === 1
                ? [B, A, B]
                : mode === 2
                  ? [C, B, C]
                  : [B, C, B];
        for (const flips of seq) {
          for (const [i, j] of flips) R[i!]![j!]! *= -1;
          fold(1);
        }
        const [X, Y, Z] = u as [number, number, number],
          rr = X * X + Y * Y + P("HRadius");
        if (rr < 0) xyz([0, 0, 0]);
        else if (rr === 0) xyz(c);
        else {
          const f = P("ZRadius") - (Z * Z) / rr;
          xyz([
            (X * X - Y * Y) * P("X mul") * f + cx,
            X * Y * P("Y mul") * f + cy,
            Z * sqrt(rr) * P("Z mul") + cz,
          ]);
        }
        break;
      }
      case "mb3d-polyfoldifs": {
        const [X, Y, Z] = mul(
            0,
            [x, y, z].map((q, i) => q + P("Add " + "XYZ"[i])),
          ) as [number, number, number],
          n = nearestEven(P("PolyFold Order"));
        if (n === 0) throw Error();
        const k = nearestEven(
            (P("Atan2 fixer") - directionAngle(Y, X)) * 0.159154943 * n,
          ),
          a = (k / n) * 6.283185307;
        xyz([X * cos(a) - Y * sin(a), X * sin(a) + Y * cos(a), Z]);
        break;
      }
      case "mb3d-polyfolding":
      case "mb3d-ngon":
      case "mb3d-ngon2": {
        const n = P("Order");
        if (n === 0) throw Error();
        const X = x + P("Shift x"),
          Y = y + P("Shift y"),
          t =
            ((directionAngle(Y, X) +
              (P("Shift (deg)") + P("Skew (deg)")) * 0.017453293) /
              6.283185307) *
            n,
          k = nearestEven(t),
          a = (-k / n) * 6.283185307 + P("Shift (deg)") * 0.017453293;
        if (id === "mb3d-polyfolding") {
          const Xout = y * sin(a) - x * cos(a);
          y = x * sin(a) + y * cos(a);
          x = Xout;
        } else if (id === "mb3d-ngon") {
          x = Y * sin(a) - X * cos(a) - P("Shift x");
          y =
            ((nearestEven(P("No yfold")) === 0
              ? (k & 1) === 0
                ? -(t - k)
                : t - k
              : t) /
              n) *
              6.283185307 -
            P("Shift y");
        } else {
          x =
            (k & 1) === 0
              ? -(Y * cos(a) + X * sin(a))
              : Y * cos(a) + X * sin(a);
          x -= P("Shift x");
          y = (Math.hypot(X, Y) / n) * 6.283185307 - P("Shift y");
        }
        break;
      }
      case "mb3d-bstellahedron-f-sphere": {
        const angle = (a: number, n: number) => {
          if (!(n > 0)) throw Error();
          const h = Math.PI / n;
          return abs(a - Math.max(0, Math.ceil((a - h) / (2 * h))) * 2 * h);
        };
        const factor = (a: number, n: number, shift: number) =>
          (cos(Math.PI / (2 * n)) * cos(a - shift)) /
          cos(Math.PI / (2 * n) - shift);
        let k = factor(
          angle(abs(directionAngle(z, y)), P("Sides")),
          P("Sides"),
          P("StellAngle"),
        );
        y *= k;
        z *= k;
        k = factor(
          angle(abs(directionAngle(Math.hypot(y, z), x)), P("Sides2")),
          P("Sides2"),
          P("StellAngle2"),
        );
        x *= k;
        y *= k;
        z *= k;
        break;
      }
      case "mb3d-boxtiling":
        [x, y, z, w] = s.v.map((t, i) => {
          const size = P("xyzw"[i] + " size");
          return size === 0 ? t : t - nearestEven(t / size) * size;
        }) as V4;
        break;
      case "mb3d-gencwarp": {
        const old = c.slice(0, 3),
          [X, Y, Z] = mul(0, old) as [number, number, number],
          pairs = [
            [X, Y],
            [X, Z],
            [Y, X],
            [Y, Z],
            [Z, X],
            [Z, Y],
            [X, Math.hypot(Y, Z)],
            [Y, Math.hypot(X, Z)],
            [Z, Math.hypot(X, Y)],
            [Math.hypot(Y, Z), X],
            [Math.hypot(X, Z), Y],
            [Math.hypot(X, Y), Z],
            [X, Math.max(abs(Y), abs(Z))],
            [Y, Math.max(abs(X), abs(Z))],
            [Z, Math.max(abs(X), abs(Y))],
            [Math.max(abs(Y), abs(Z)), X],
            [Math.max(abs(X), abs(Z)), Y],
            [Math.max(abs(X), abs(Y)), Z],
            [X, abs(Y)],
            [Y, abs(X)],
            [Z, abs(Y)],
            [abs(Y), X],
            [abs(X), Y],
            [abs(X), Z],
          ];
        const thidx = nearestEven(P("Th(args 0-23)")),
          phidx = nearestEven(P("Ph(args 0-23)")),
          recipe = nearestEven(P("Recipe 0-2"));
        if (
          thidx < 0 ||
          thidx > 23 ||
          phidx < 0 ||
          phidx > 23 ||
          recipe < 0 ||
          recipe > 2
        )
          throw Error();
        const th =
            directionAngle(pairs[thidx]![0]!, pairs[thidx]![1]!) *
            P("Theta-AnglePow"),
          ph =
            directionAngle(pairs[phidx]![0]!, pairs[phidx]![1]!) *
            P("Phi-AnglePow"),
          r = Math.hypot(X, Y, Z);
        let u =
          recipe === 0
            ? [r * cos(th) * cos(ph), r * sin(th) * cos(ph), r * sin(ph)]
            : recipe === 1
              ? [r * cos(th) * sin(ph), r * sin(th) * sin(ph), r * cos(ph)]
              : [r * cos(th) * cos(ph), r * sin(th), r * cos(th) * sin(ph)];
        let t = P("Strength (0 to 1)");
        u = u.map((q, i) => (1 - t) * old[i]! + t * q);
        t = P("Xyz-Strength (0 to 1)");
        s.c = [...u.map((q, i) => (1 - t) * q + t * s.v[i]!), cw] as V4;
        break;
      }
      case "mb3d-randcubesifs": {
        const scale = P("Scale");
        if (scale === 0) throw Error();
        const k = -6.86656e-6,
          u = [x, y, z].map((t, i) => scale * t + P("XYZ"[i] + " add"));
        if (nearestEven(P("Apply scale+add")) !== 0) {
          xyz(u);
          s.varyScale *= scale;
        }
        let [X, Y, Z] = u as [number, number, number];
        const ix = nearestEven(X),
          iy = nearestEven(Y);
        if (
          ix < -2147483648 ||
          ix > 2147483647 ||
          iy < -2147483648 ||
          iy > 2147483647
        )
          throw Error();
        X = abs(X - ix);
        Y = abs(Y - iy);
        const uu = (ix ^ 0x9d81) >>> 0,
          vv = (iy ^ 0xb641) >>> 0,
          [lo, hi] = multiplyUnsigned32(uu, vv),
          raw = ~lo >>> 0;
        let B = ((raw & 0x5a5a) ^ (hi | 0x5a5a)) >>> 0,
          A = ((uu & 0x5a5a) ^ (vv | 0x5a5a)) >>> 0;
        const hash = (t: number, r: number) => {
          const q = (Math.imul((t - nearestEven(r)) >>> 0, t) + raw) >>> 0;
          return ((q >>> 8) ^ (q << 8)) & 0xffff;
        };
        A = hash(A, P("RandomizerX"));
        B = hash(B, P("RandomizerY"));
        const H = ((A >>> 6) ^ (B << 6)) & 0xffff,
          F = (A & 0xaaaa) ^ (B & 0x5555);
        Z -= F * k * P("ZFlight");
        const dz = abs(Z) + H * k * P("ZMaxSz");
        s.free[0] = H * 1.5e-5;
        const vx = P("XVtn (0-1)"),
          vy = P("YVtn (0-1)"),
          shape = nearestEven(P(A & 0x40 ? "ShapeType 2" : "ShapeType 1")),
          ax = A * k * vx + (1 - vx) * -0.45,
          by = B * k * vy + (1 - vy) * -0.45;
        let d: number;
        if (shape === 1)
          d = Math.max(dz, Math.hypot(X, Y) + ax - B * k * vy * abs(Z));
        else if (shape === 2)
          d = Math.max(
            dz,
            sqrt(X * X + Y * Y - Z * Z * A * -1.37331e-5 * vx) + by,
          );
        else if (shape === 3)
          d = Math.max(
            dz,
            Math.max(X - A * k * vx * abs(Z), Y - B * k * vy * abs(Z)) - 0.45,
          );
        else if (shape === 4) {
          if (A >= B) [X, Y] = [Y, X];
          const q = Z - H * k * P("ZMaxSz"),
            t = ((q - abs(q)) * -0.45) ** 2;
          d = Math.max(Z, X + ax, sqrt(t + Y * Y) + by);
        } else if (shape === 5) {
          if (A >= B) {
            [X, Y] = [Y, X];
            [A, B] = [B, A];
          }
          const fa = Math.fround(abs(A * -3.1e-6 * vx)),
            fb = Math.fround(B * -1.03e-5 * vy),
            q = Z - H * k * P("ZMaxSz"),
            t = ((q - abs(q)) * -0.45) ** 2;
          d = Math.max(
            Z,
            sqrt(t + Y * Y + X * X + fa * fb * fb) + sqrt(sqrt(t + X * X)) * fb,
          );
        } else if (shape === 6) {
          const fb = Math.fround(B * -1.03e-5 * vy),
            jraw = ax - fb,
            j = Math.fround(jraw),
            terms = [X + jraw, Y + j, dz + j];
          d =
            sqrt(
              terms.reduce((sum, t) => sum + ((t + abs(t)) * -0.45) ** 2, 0),
            ) + fb;
        } else d = Math.max(dz, X + ax, Y + by);
        if (nearestEven(P("Apply scale+add")) === 0) d /= scale;
        s.fieldValue = d;
        break;
      }
      default:
        throw new Error("Unsupported Essentials kernel " + id);
    }
    const next: V4 = [x, y, z, w];
    if (
      ![
        ...next,
        ...s.c,
        s.varyScale,
        s.derivative,
        s.fieldValue,
        ...s.free,
      ].every(Number.isFinite)
    ) {
      s.invalid = true;
      return;
    }
    s.v = next;
  } catch {
    s.invalid = true;
  }
}
