import { readSceneCamera } from "../../engine/camera";
import type { SceneCamera, Vec3 } from "../../engine/camera";
import { MAX_ASPECT } from "../../engine/renderSetup";
import type { RenderFormat } from "../../engine/renderSetup";
import type { CompatibilityField } from "./adapter";
import type { JsonValue, NeutralMb3dPreset } from "./types";

export interface Mb3dCameraPreview {
  summary: CompatibilityField;
  fields: CompatibilityField[];
  camera: SceneCamera | null;
  format: RenderFormat | null;
}
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const vector = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every(finite);
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length) as Vec3;
};
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Camera-only conversion. Source equations and coordinate conventions: docs/mb3d-import/CAMERA.md.
 * Never treats dXmid/dYmid/dZmid as the eye, or Euler/4D angles as a navigation matrix. */
export function previewMb3dCamera(
  neutral: NeutralMb3dPreset,
): Mb3dCameraPreview {
  const v = neutral.cameraView,
    fields: CompatibilityField[] = [];
  const row = (
    name: string,
    state: CompatibilityField["state"],
    reason: string,
    value: JsonValue,
    target?: string,
  ) => {
    fields.push({
      path: `cameraView.${name}`,
      state,
      reason,
      value,
      ...(target ? { target } : {}),
    });
  };
  const stop = (reason: string): Mb3dCameraPreview => ({
    summary: {
      path: "cameraView",
      state: "UNSUPPORTED",
      reason: `${reason} The current camera and picture format are kept.`,
      value: v,
    },
    fields,
    camera: null,
    format: null,
  });
  if (neutral.source.mandId < 17 || neutral.source.mandId > 44)
    return stop(
      "The view format lacks a reviewed modern matrix/quaternion mapping.",
    );
  if (!vector(v.fractalCenter))
    return stop("The view centre must contain three finite values.");
  row(
    "fractalCenter",
    "EXACT",
    "Stored MB3D view centre; not the XYZ of the camera.",
    v.fractalCenter,
  );
  const depth = v.depthRange;
  if (
    !Array.isArray(depth) ||
    depth.length !== 2 ||
    !depth.every(finite) ||
    depth[1]! <= depth[0]!
  )
    return stop("Depth start/end must be finite and ordered.");
  row(
    "depthRange.0",
    "COMPATIBLE_ADAPTER",
    "dZstart − dZmid moves the camera along the forward axis of the basis.",
    depth[0]!,
    "camera.position",
  );
  row(
    "depthRange.1",
    "UNSUPPORTED",
    "dZend is the closing depth plane of MB3D. The ray limit of the engine is not changed.",
    depth[1]!,
  );
  row(
    "rotation4D",
    "UNSUPPORTED",
    "4D fractal rotation is not the orientation of the camera; this assignment changes no formula/4D values.",
    v.rotation4D ?? null,
  );
  const width = v.width,
    height = v.height,
    zoom = v.zoom,
    fov = v.fovYDegrees;
  if (
    !finite(width) ||
    !finite(height) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !finite(zoom) ||
    zoom <= 0 ||
    !finite(fov) ||
    fov < 10 ||
    fov > 120
  )
    return stop(
      "Invalid size/zoom or a field of view outside the 10–120 degrees of the engine; no values are clipped.",
    );
  const step = 2.1345 / (zoom * width);
  if (!finite(step) || step <= 0)
    return stop("The navigation scale cannot be represented.");
  row(
    "zoom",
    "COMPATIBLE_ADAPTER",
    "Navigation step = 2.1345 / (dZoom × Width). Matrix rows are normalised separately.",
    zoom,
    "camera.position",
  );
  row(
    "fovYDegrees",
    "EXACT",
    "Vertical field of view in degrees, without clamping.",
    fov,
    "camera.fov_degrees",
  );
  const stereo = v.stereo;
  if (
    !stereo ||
    typeof stereo !== "object" ||
    Array.isArray(stereo) ||
    stereo.bStereoMode !== 0
  )
    return stop(
      "Stereo/off-axis/orthographic stereo view has no camera adapter.",
    );
  row("stereo", "EXACT", "Monoskopisk vy.", 0);
  // These are view-mode flags already preserved by the neutral parser, not postprocess imports.
  if (!finite(neutral.postprocess.bCalc3D) || neutral.postprocess.bCalc3D <= 0)
    return stop("2D/slice views cannot be expressed with this perspective camera.");
  if (
    neutral.postprocess.TilingOptions !== undefined &&
    neutral.postprocess.TilingOptions !== 0
  )
    return stop("Tiling/cut-out needs a separate off-axis adapter.");
  const optic = v.projectionCode;
  if (optic !== 0 && optic !== 1)
    return stop("Panorama or unknown optics lack support.");
  row(
    "projectionCode",
    optic === 1 ? "COMPATIBLE_ADAPTER" : "UNSUPPORTED",
    optic === 1
      ? "Planar MB3D optics correspond to the ray directions and target of the perspective."
      : "Older angle optics: target, centre direction and vertical field of view are transferred. The ray distribution outside the centre is not reproduced by the perspective optics of the engine.",
    optic,
  );
  let basis: Vec3[];
  if (
    v.basisEncoding === "scaled-matrix" &&
    Array.isArray(v.storedBasis) &&
    v.storedBasis.length === 3 &&
    v.storedBasis.every(vector)
  ) {
    basis = v.storedBasis;
  } else if (
    v.basisEncoding === "quaternion-in-matrix-record" &&
    neutral.source.mandId === 44 &&
    Array.isArray(v.storedBasis) &&
    v.storedBasis.length === 3 &&
    v.storedBasis.every((row) => Array.isArray(row) && row.length === 3) &&
    v.storedBasis.flat().slice(0, 4).every(finite)
  ) {
    const [x, y, z, w] = v.storedBasis.flat().slice(0, 4) as [
      number,
      number,
      number,
      number,
    ];
    // x/y/z/w, stored across the first four doubles. Native constructs rows before row normalization;
    // normalizing a non-unit quaternion here would change the source behavior.
    basis = [
      [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
      [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
      [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
    ];
  } else
    return stop(
      "Missing/unreviewed navigation representation; no axes are guessed.",
    );
  if (basis.some((axis) => !axis.every(finite) || !(Math.hypot(...axis) > 0)))
    return stop("The navigation basis is singular.");
  const axes = basis.map(unit),
    [right, down, forward] = axes as [Vec3, Vec3, Vec3];
  if (
    Math.abs(dot(right, down)) > 1e-6 ||
    Math.abs(dot(right, forward)) > 1e-6 ||
    Math.abs(dot(down, forward)) > 1e-6 ||
    Math.abs(dot(cross(right, down), forward) - 1) > 1e-6
  )
    return stop(
      "A sheared/reflected basis cannot be expressed with the orthonormal camera of the engine.",
    );
  row(
    "basisEncoding",
    "EXACT",
    "Lagrad navigeringsrepresentation, inte 4D-/Euler-fraktalrotation.",
    v.basisEncoding!,
  );
  row(
    "storedBasis",
    "COMPATIBLE_ADAPTER",
    "Normalised rows: image right, image down, forward. The up of the engine = −image down; the formula coordinates of the world are not changed.",
    v.storedBasis!,
    "camera.up / target",
  );
  const half = (fov * Math.PI) / 360;
  const viewPlaneOffset =
    (step * height * 0.5 * Math.cos(half)) / Math.max(0.01, Math.sin(half));
  const offset = depth[0]! - v.fractalCenter[2] - viewPlaneOffset;
  const position = v.fractalCenter.map(
    (c, i) => c + offset * forward[i]!,
  ) as Vec3;
  // Use the original center as orbit target when it lies ahead; do not reverse orientation for a depth plane behind the eye.
  const focus = offset < -1e-9 ? -offset : Math.max(viewPlaneOffset, 1);
  const camera: SceneCamera = {
    position,
    target: position.map((c, i) => c + focus * forward[i]!) as Vec3,
    up: down.map((x) => -x) as Vec3,
    fov_degrees: fov,
  };
  const errors: string[] = [];
  readSceneCamera(camera, "camera", errors);
  if (errors.length) return stop(errors.join(" "));
  const gcd = (a: number, b: number): number => {
    while (b) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    return a;
  };
  const divisor = gcd(width, height),
    ratio: [number, number] = [width / divisor, height / divisor];
  let format: RenderFormat | null = null;
  if (
    ratio.every((n) => n <= 1000) &&
    width / height <= MAX_ASPECT &&
    height / width <= MAX_ASPECT
  ) {
    format = { preset: "custom", ratio };
    row(
      "size",
      "COMPATIBLE_ADAPTER",
      "The picture proportions of the original; the current export resolution and quality are kept.",
      [width, height],
      "render.format",
    );
  } else
    row(
      "size",
      "UNSUPPORTED",
      "The proportions of the original are outside the format limits of the engine; the current picture format is kept.",
      [width, height],
    );
  return {
    summary: {
      path: "cameraView",
      state: "COMPATIBLE_ADAPTER",
      reason:
        optic === 1
          ? "Camera, orientation and planar field of view are converted to the existing perspective camera."
          : "Camera, orientation and vertical field of view are converted; older angle optics have an explicit ray limitation.",
      value: camera as unknown as JsonValue,
      target: "camera",
    },
    fields,
    camera,
    format,
  };
}
