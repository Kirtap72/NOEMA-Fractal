import type { KernelState, PreparedKernel } from "./kernels";
import type { V4 } from "./primitives";
import {
  applyMatrix,
  commutativeProduct,
  hamiltonProduct,
  compareSwapFold,
  OCTAHEDRON_PAIRS,
  stereographicChart,
  inverseStereographicChart,
  radialFoldFactor,
  mengerFold,
  nearestEven,
  maskedPasses,
} from "./primitives";

/** Equations from the ten numbered authoritative NewFormulas/batch-02 specifications.
 * One call only: the shared host owns count, scheduling, bailout and DE finalization. */
export function stepBatch02Kernel(
  { id, p, matrices }: PreparedKernel,
  s: KernelState,
): void {
  const [x, y, z, w] = s.v,
    [cx, cy, cz] = s.c;
  if (
    ![...s.v, ...s.c, ...Object.values(p), s.derivative, s.varyScale].every(
      Number.isFinite,
    )
  ) {
    s.invalid = true;
    return;
  }
  const on = (key: string) => nearestEven(p[key]!) !== 0;
  switch (id) {
    case "beth-2422": {
      const squares = s.v.map((a) => a * a);
      s.v = s.v.map((u, i) => {
        const [a, b, d] = squares.filter((_, j) => j !== i) as [
          number,
          number,
          number,
        ];
        return (
          2.5 *
            u *
            (3 * u ** 4 +
              7 * (a * a + b * b + d * d) -
              10 * u * u * (a + b + d) -
              6 * (a * b + b * d + d * a)) +
          s.c[i]!
        );
      }) as V4;
      s.v[3] += p.w_add!;
      break;
    }
    case "ides-formula":
      s.v = [
        p.x_mul! * x * x - p.xsub_mul! * (y * y + z * z) + cx,
        p.y_mul! * x * y * z + cy,
        p.z_mul! * z * z - p.zsub_mul! * (x * x + y * y) + cz,
        w,
      ];
      break;
    case "aex-octo":
      s.v = [
        p.xz_mul! * x * z + cx,
        p.sq_mul! * (z * z - x * x) + cy,
        y + cz,
        w,
      ];
      break;
    case "lambda-4dc": {
      const square = commutativeProduct(s.v, s.v),
        k = [p.dx!, p.dy!, p.dz!, p.dw!];
      s.v = commutativeProduct(k.map((a, i) => a - square[i]!) as V4, s.c);
      break;
    }
    case "barnsley-4dnc": {
      const k: V4 = [p.dx!, p.dy!, p.dz!, p.dw!],
        c: V4 = [...s.c];
      const tent = on("tent_mode"),
        active = x >= (tent ? Math.hypot(...k) / 2 : p.thresold!);
      const u: V4 = tent
        ? active
          ? [
              2 * (k[0] - x),
              2 * (k[1] - y),
              2 * (k[2] - z),
              2 * (k[3] - w + p.w_add!),
            ]
          : [2 * x, 2 * y, 2 * z, 2 * w + p.w_add!]
        : ([x, y, z, w + p.w_add!].map(
            (a, i) => a + (active ? -k[i]! : k[i]!),
          ) as V4);
      if (active) {
        if (on("conj_mode")) c[1] = -c[1];
        if (on("flip_mode")) [c[0], c[1]] = [c[1], c[0]];
      }
      s.v = hamiltonProduct(u, c);
      break;
    }
    case "kalisets-1": {
      const den = x * x + y * y + z * z + p.fix!;
      if (den === 0) {
        s.invalid = true;
        return;
      }
      const m = p.scale! / den;
      s.v = [
        m * Math.abs(x) + cx,
        m * Math.abs(y) + cy,
        m * Math.abs(z) + cz,
        w,
      ];
      break;
    }
    case "menger-hyper": {
      const scale = p.scale!;
      if (scale === 0) {
        s.invalid = true;
        return;
      }
      let u = [x, y, z].map(Math.abs);
      const norm2 = (v: number[]) => v.reduce((a, b) => a + b * b, 0);
      const lo = p.min_radius! * p.cent_rad_mul!,
        hi = p.max_radius! * p.cent_rad_mul!;
      let m = radialFoldFactor(norm2(u), lo, hi, false);
      if (!Number.isFinite(m)) {
        s.invalid = true;
        return;
      }
      u = u.map((a) => m * a).sort((a, b) => b - a);
      const center = [p.x_inv!, p.y_inv!, p.z_inv!];
      u = u.map((a, i) => a + center[i]!);
      m = radialFoldFactor(norm2(u), p.min_radius!, p.max_radius!, true);
      if (!Number.isFinite(m)) {
        s.invalid = true;
        return;
      }
      u = u.map((a, i) => m * a - center[i]!);
      if (on("fold_again")) u.sort((a, b) => b - a);
      s.v = [
        ...mengerFold(u, scale, [p.cscale_x!, p.cscale_y!, p.cscale_z!]),
        w,
      ] as V4;
      // Legacy estimate deliberately omits both inversion factors.
      s.derivative *= scale;
      break;
    }
    case "octahedron-4": {
      const u = compareSwapFold(s.v.map(Math.abs), OCTAHEDRON_PAIRS);
      const rotated = applyMatrix(matrices[0]!, [u[2]!, u[0]!, u[1]!, u[3]!]);
      s.v = rotated.map(
        (a, i) => p.scale! * a - (p.scale! - 1) * p[`cscale_${"xyzw"[i]}`]!,
      ) as V4;
      s.derivative *= p.scale!;
      break;
    }
    case "tglad-dihed": {
      let xyz = [x, y, z],
        sentinel = false;
      for (let outer = 0; outer < maskedPasses(p.log2_power!); outer++) {
        const rr = xyz.reduce((a, b) => a + b * b, 0);
        if (rr >= 1e10) {
          sentinel = true;
          break;
        }
        let radius = Math.sqrt(rr);
        const chart = stereographicChart(xyz[0]!, xyz[1]!, xyz[2]!, true);
        if (!chart) {
          s.invalid = true;
          return;
        }
        let [u, t] = chart;
        for (let inner = 0; inner < maskedPasses(p.log2_map_power!); inner++) {
          const h = u * u + t * t;
          if (h >= 1e10) {
            sentinel = true;
            break;
          }
          const nx = u * (h - 1) * (h * h + 2 * h + 4 * t * t + 1),
            ny = -t * (h + 1) * (h - 2 * u - 1) * (h + 2 * u - 1);
          const den = ((h - 2 * t + 1) * (h + 2 * t + 1)) ** 2;
          if (den === 0) {
            s.invalid = true;
            return;
          }
          [u, t] = [(nx * 2) / den, (ny * 2) / den];
          radius *= radius;
        }
        if (sentinel) break;
        const inverse = inverseStereographicChart(u, t, radius, 1);
        if (!inverse) {
          s.invalid = true;
          return;
        }
        xyz = inverse;
      }
      s.v = sentinel
        ? [1e10, 1e10, 1e10, w]
        : [xyz[0]! + cx, xyz[1]! + cy, xyz[2]! + cz, w];
      break;
    }
    case "scherk-fs": {
      const scale = p.scale!,
        apply = on("apply_scale_add");
      if (!apply && scale === 0) {
        s.invalid = true;
        return;
      }
      const u = [
        scale * x + p.x_add!,
        scale * y + p.y_add!,
        scale * z + p.z_add!,
      ];
      const [a, b, c] = applyMatrix(matrices[0]!, u) as [
        number,
        number,
        number,
      ];
      const cosineX = Math.cos(a),
        cosineY = Math.cos(b);
      if (cosineX === 0 || cosineY === 0) {
        s.invalid = true;
        return;
      }
      const logarithm = Math.log2(Math.abs(cosineX / cosineY));
      if (!Number.isFinite(logarithm)) {
        s.invalid = true;
        return;
      }
      const d = Math.max(
        p.saddle_strength! * p.log_base! * logarithm - c,
        Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) - 1.5,
      );
      s.fieldValue = apply ? d : d / scale;
      if (apply) {
        s.v = [...u, w] as V4;
        s.varyScale *= scale;
      }
      break;
    }
    default:
      throw new Error(`Not a batch 02 kernel: ${id}`);
  }
  if (![...s.v, s.derivative, s.fieldValue, s.varyScale].every(Number.isFinite))
    s.invalid = true;
}
