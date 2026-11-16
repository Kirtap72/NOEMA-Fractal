import { checkOutputSize } from "./renderSetup";

export const DEFAULT_TILE_SIZE = 1024;
export interface RenderTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Global pixel origins keep projection, sample sequences and world-space effects independent of tiling. */
export function* imageTiles(
  width: number,
  height: number,
  tileSize = DEFAULT_TILE_SIZE,
): Generator<RenderTile> {
  const problem = checkOutputSize(width, height);
  if (problem) throw Error(problem);
  if (!Number.isSafeInteger(tileSize) || tileSize < 1)
    throw Error("tileSize must be a positive integer");
  for (let y = 0; y < height; y += tileSize)
    for (let x = 0; x < width; x += tileSize)
      yield {
        x,
        y,
        width: Math.min(tileSize, width - x),
        height: Math.min(tileSize, height - y),
      };
}

/** Texture dimension and readback-buffer limits apply to internal jobs, never to the artwork dimensions. */
export function safeTileSize(
  requested: number | undefined,
  maxTextureSide: number,
  maxBufferBytes: number,
): number {
  const size = requested ?? DEFAULT_TILE_SIZE;
  if (!Number.isSafeInteger(size) || size < 1)
    throw Error("tileSize must be a positive integer");
  return Math.max(
    1,
    Math.min(size, maxTextureSide, Math.floor(Math.sqrt(maxBufferBytes / 32))),
  );
}
