import type { KernelState, PreparedKernel } from "./kernels";
import type { V4 } from "./primitives";
import {
  applyMatrix,
  bilinearProduct,
  quaternionSine,
  difsAffine,
  directionAngle,
  nearestEven,
} from "./primitives";

/** One call from the ten authoritative batch-03 specifications; host accounting is separate. */
export function stepBatch03Kernel(
  { id, p, matrices }: PreparedKernel,
  s: KernelState,
): void {
  if (
    ![...s.v, ...s.c, ...Object.values(p), s.varyScale, s.derivative].every(
      Number.isFinite,
    )
  ) {
    s.invalid = true;
    return;
  }
  const [x, y, z, w] = s.v,
    [cx, cy, cz, cw] = s.c;
  const on = (key: string) => nearestEven(p[key]!) !== 0;
  switch (id) {
    case "faehrten":
      s.v = [
        x * (p.y_multiplier! * y + p.z_multiplier! * z) + cx,
        y * y + p.squares_multiplier! * (x * x + z * z) + p.twist! * x * z + cy,
        z * z + p.squares_multiplier! * (x * x + y * y) + p.twist! * x * y + cz,
        w,
      ];
      break;
    case "mandel-4d-bic":
      s.v = [
        x * x - y * y + cx,
        2 * x * y + cy,
        z * z - w * w + cz,
        2 * z * w + cw + p.w_add!,
      ];
      break;
    case "hyperd-1": {
      let n = nearestEven(p.int_power!);
      if (n < 1 || n > 16) n = 2;
      let accumulator: V4 = [x, y, z, w + p.w_add!];
      for (let k = 0; k < Math.max(1, n - 1); k++)
        accumulator = bilinearProduct(
          s.v,
          accumulator,
          p.zw_mul!,
          p.yw_mul!,
          p.yz_mul!,
        );
      s.v = accumulator.map((a, i) => a + s.c[i]!) as V4;
      break;
    }
    case "makin-4d-p2a": {
      const a = x * x + y * y,
        b = z * z + w * w;
      if (a === 0 && b === 0) {
        s.invalid = true;
        return;
      }
      const k = b < a ? 1 - b / a : a / b - 1;
      s.v = [
        (b < a ? x * x - y * y : z * z - w * w) * k + cx,
        (b < a ? 2 * x * y : 2 * z * w) * k + cy,
        2 * (x * z - y * w) + cz,
        2 * (x * w + y * z) + cw + p.w_add!,
      ];
      break;
    }
    case "sin-4d-plus": {
      const next = quaternionSine(
        [x + p.px!, y + p.py!, z + p.pz!, w + p.pw!],
        p.a!,
      );
      if (!next) {
        s.invalid = true;
        return;
      }
      s.v = next;
      break;
    }
    case "riemann-2": {
      const rotated = applyMatrix(matrices[0]!, [x, y, z]);
      const r = Math.sqrt(rotated.reduce((a, b) => a + b * b, 0));
      if (r === 0) {
        s.invalid = true;
        return;
      }
      const [X, Y, Z] = rotated.map((a) => (a * p.scale!) / r) as [
        number,
        number,
        number,
      ];
      const d = 1 - X,
        f = d > p.smallest_value! ? 1 / d : 1;
      const s0 = Z * f,
        t0 = Y * f,
        exponent = p.rpow! * (1 + s0 * s0 + t0 * t0);
      const a = Math.abs(
        Math.abs(Math.sin(3.1415926535898 * s0 + p.s_shift!)) + p.sin_add_fold!,
      );
      const b = Math.abs(
        Math.abs(Math.sin(3.1415926535898 * t0 + p.t_shift!)) + p.sin_add_fold!,
      );
      const radius = Math.pow(r, exponent) + p.r_shift!,
        h = 2 / (1 + a * a + b * b);
      s.v = [radius * (1 - h) + p.x_shift!, radius * b * h, radius * a * h, w];
      break;
    }
    case "torus-ellip-ifs":
    case "klein-bagel-ifs":
    case "helix-ifs": {
      const scale = p.scale!,
        apply = on("apply_scale_add");
      if (scale === 0) {
        s.invalid = true;
        return;
      }
      const affine = difsAffine(
        s.v,
        scale,
        [p.x_add!, p.y_add!, p.z_add!],
        apply,
        s.varyScale,
      );
      const [X, Y, Z] = affine.q as [number, number, number];
      let field: number;
      if (id === "torus-ellip-ifs") {
        const rho = on("boxy_xy")
          ? Math.max(Math.abs(X), Math.abs(Y))
          : Math.sqrt(X * X + Y * Y);
        const q = rho - p.radius_1!;
        field =
          (on("boxy_z")
            ? Math.max(Math.abs(q), Math.abs(Z))
            : Math.sqrt(q * q + Z * Z)) -
          p.radius_2! +
          X * p.elliptic!;
      } else if (id === "klein-bagel-ifs") {
        const theta = 0.5 * nearestEven(p.mobius!) * directionAngle(X, Y),
          sn = Math.sin(theta),
          cs = Math.cos(theta);
        const xa = X * p.aspect_ratio!,
          rho = on("boxy_xy")
            ? Math.max(Math.abs(xa), Math.abs(Y))
            : Math.sqrt(xa * xa + Y * Y);
        const q = rho - p.radius_1!,
          u = q * sn - Z * cs,
          h = q * cs + Z * sn;
        field = 0.5 * Math.sqrt(Math.abs(h ** 4 - h * h + u * u)) - p.radius_2!;
      } else {
        const coord = nearestEven(p.coord!),
          [axis, a, b] =
            coord === 0 ? [X, Y, Z] : coord === 1 ? [Y, X, Z] : [Z, Y, X];
        const count = ((nearestEven(p.helix_count!) - 1) & 15) + 1;
        const delta = count <= 2 ? Math.PI : (2 * Math.PI) / count;
        let angle = axis! * p.helix_stretch!;
        field = 10000;
        for (let k = 0; k < count; k++) {
          const da = a! - p.diameter_2! * Math.cos(angle),
            db = b! - p.diameter_1! * Math.sin(angle);
          field = Math.min(field, Math.sqrt(da * da + db * db));
          angle += delta;
        }
        field -= p.string_radius!;
      }
      s.v = affine.v;
      s.varyScale = affine.varyScale;
      s.fieldValue = apply ? field : field / scale;
      break;
    }
    case "hopalong": {
      const t = p.beta! * x - p.gamma! * z + p.delta!,
        h = Math.sqrt(Math.abs(t));
      s.v = [
        y + (t > 0 ? h : -h),
        (p.alpha! - x) * p.strength!,
        z + (p.alpha! * y - p.beta! * x) * p.epsilon!,
        w,
      ];
      break;
    }
    default:
      throw new Error(`Not a batch 03 kernel: ${id}`);
  }
  if (![...s.v, s.fieldValue, s.varyScale, s.derivative].every(Number.isFinite))
    s.invalid = true;
}
