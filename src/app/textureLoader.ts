import { MAX_TEXTURE_DATA_LENGTH } from "../engine";
import type { ImageBuffer } from "../engine";

/** Pictures are shrunk to at most this many pixels on the longest side, so the scene file stays a reasonable size. */
export const MAX_TEXTURE_SIDE = 1024;
const MAX_FILE_BYTES = 25_000_000;

function drawToCanvas(bitmap: ImageBitmap, scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function pixels(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): ImageBuffer {
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength) };
}

/**
 * Reads a PNG or JPEG file chosen by the user: shrinks it if it is large, and returns the picture both as a
 * data address (to store in the scene) and as pixels (to give to the engine).
 */
export async function fileToTexture(file: File): Promise<{ name: string; data: string; image: ImageBuffer }> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") throw new Error("Only PNG and JPEG pictures can be used as a texture.");
  if (file.size > MAX_FILE_BYTES) throw new Error("The picture is too large (at most 25 MB).");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_TEXTURE_SIDE / Math.max(bitmap.width, bitmap.height));
    const { canvas, ctx } = drawToCanvas(bitmap, scale);
    const data = canvas.toDataURL(file.type, 0.92); // photographs stay JPEG, graphics stay PNG
    if (data.length > MAX_TEXTURE_DATA_LENGTH) throw new Error("The picture became too large even after downscaling. Try a smaller picture.");
    return { name: file.name.slice(0, 100), data, image: pixels(ctx, canvas) };
  } finally {
    bitmap.close();
  }
}

/** Turns a data address from a scene into pixels. */
export async function dataUriToImage(data: string): Promise<ImageBuffer> {
  const blob = await (await fetch(data)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const { canvas, ctx } = drawToCanvas(bitmap, 1);
    return pixels(ctx, canvas);
  } finally {
    bitmap.close();
  }
}
