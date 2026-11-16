import {displayRgba} from './display';
import { cameraFov, focusDistance } from "./cameraOptics";
import type { SceneCamera } from "./camera";
import { verticalFovDegrees } from "./renderSetup";
import type { FovAxis } from "./renderSetup";
import type { LayerBuffers, ImageBuffer } from "./engine";

/** Thin-lens projected blur radius: a * focalPixels * |1/z - 1/focus|. z is axial, not ray-length depth. */
export function circleOfConfusion(
  axialDepth: number,
  focus: number,
  aperture: number,
  focalPixels: number,
): number {
  return (
    aperture *
    focalPixels *
    Math.abs((axialDepth > 0 ? 1 / axialDepth : 0) - 1 / focus)
  );
}

const linear = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** 2.2);
const gamma = Uint8Array.from({ length: 4097 }, (_, i) =>
  Math.round(255 * (i / 4096) ** (1 / 2.2)),
);
const taps = Array.from({ length: 16 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 16),
    a = i * 2.399963229728653;
  return [r * Math.cos(a), r * Math.sin(a)] as const;
});

/** Bounded, depth-aware preview gather. Focus pixels remain untouched; no camera or final quality mutation. */
export function previewDof(
  layers: LayerBuffers,
  camera: SceneCamera,
  axis: FovAxis,
  maxRadius = 20,
): ImageBuffer {
  const { width: w, height: h, color, depth } = layers;
  if (color.length !== w * h * 4 || depth.length !== w * h)
    throw Error("Preview DOF layer dimensions do not match");
  const hdr=layers.linear?.slice();
  const sample=(i:number)=>layers.linear?layers.linear[i]!:linear[color[i]!]!;
  const data = color.slice(),
    dof = camera.dof;
  if (
    !dof?.enabled ||
    dof.aperture_radius === 0 ||
    camera.projection === "orthographic"
  )
    return { width: w, height: h, data:hdr?displayRgba(hdr,layers.display):data, linear:hdr, display:layers.display };
  const focus = focusDistance(camera),
    tan = Math.tan(
      (verticalFovDegrees(cameraFov(camera, axis, w, h), axis, w, h) *
        Math.PI) /
        360,
    );
  const focalPixels = h / (2 * tan),
    z = new Float32Array(w * h),
    radius = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        px = (2 * (x + 0.5) - w) / h,
        py = (h - 2 * (y + 0.5)) / h;
      z[i] =
        depth[i]! > 0
          ? depth[i]! / Math.sqrt(1 + tan * tan * (px * px + py * py))
          : Infinity;
      radius[i] = Math.min(
        maxRadius,
        circleOfConfusion(z[i]!, focus, dof.aperture_radius, focalPixels),
      );
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        r = radius[i]!;
      if (r < 0.5) continue; // Preserve the selected focus plane exactly, including texture detail.
      const at = i * 4;
      let red = sample(at),
        green = sample(at+1),
        blue = sample(at+2),
        weight = 1;
      for (const [dx, dy] of taps) {
        const sx = Math.max(0, Math.min(w - 1, Math.round(x + dx * r))),
          sy = Math.max(0, Math.min(h - 1, Math.round(y + dy * r))),
          j = sy * w + sx;
        // Sharp foreground must not contaminate background blur; a foreground surface must not gather distant background.
        if (z[j]! < z[i]! && radius[j]! < 0.5) continue;
        if (
          Number.isFinite(z[i]!) &&
          z[i]! < focus &&
          z[j]! > z[i]! + Math.max(0.01 * focus, 0.05 * z[i]!)
        )
          continue;
        const p = j * 4;
        red += sample(p);
        green += sample(p+1);
        blue += sample(p+2);
        weight++;
      }
      if(hdr){hdr[at]=red/weight;hdr[at+1]=green/weight;hdr[at+2]=blue/weight;continue;}
      data[at] = gamma[Math.round((red / weight) * 4096)]!;
      data[at + 1] = gamma[Math.round((green / weight) * 4096)]!;
      data[at + 2] = gamma[Math.round((blue / weight) * 4096)]!;
    }
  return { width: w, height: h, data:hdr?displayRgba(hdr,layers.display):data, linear:hdr, display:layers.display };
}
