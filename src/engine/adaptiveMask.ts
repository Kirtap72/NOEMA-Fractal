/**
 * Tile masks for selective refinement (INTELLIGENT-RENDERING-01).
 *
 * A refinement pass draws the whole picture, but every pixel in a tile that is not flagged leaves the shader at once (`discard`),
 * so its march, normals, shadows and shading cost nothing. Which tiles are flagged is sent in the uniform block as a bit per tile.
 * The mask lives after all other uniform members, so shaders and uniform data of ordinary renders are unchanged when it is off.
 */
import { BOX_FLOATS } from "./boxCut";
import { FDISP_FLOATS } from "./fractalDisplacement";
import { UNIFORM_FLOATS } from "./uniforms";

/** 1024 words of 32 bits: at most 32 768 tiles (a 4K picture in 16-pixel tiles still fits). */
export const MASK_WORDS = 1024;
export const MAX_MASK_TILES = MASK_WORDS * 32;
/** Where the mask starts in the uniform buffer (in floats): `tileMask` (4 floats) then the bits. */
export const ADAPTIVE_OFFSET = UNIFORM_FLOATS;
export const ADAPTIVE_FLOATS = 4 + MASK_WORDS;

const FS_ANCHOR = /fn fs\(@builtin\(position\) frag : vec4f\) -> FragOut \{\n  var out : FragOut;/;

/** Adds the mask members to the end of the uniform struct and the early exit to the picture shader. Shaders without the usual `fs` are returned unchanged. */
export function integrateAdaptiveMaskShader(shader: string): string {
  if (!FS_ANCHOR.test(shader) || shader.includes("tileBits")) return shader;
  // The box-cut block sits between the display block and the mask; keep the offsets right when that variant is not in use.
  const pad = (/boxPlanes\s*:|boxPad\s*:/.test(shader) ? "" : `  boxPad : array<vec4f, ${BOX_FLOATS / 4}>,\n`) + (/\bfdisp\s*:/.test(shader) ? "" : `  fdispPad : array<vec4f, ${FDISP_FLOATS / 4}>,\n`);
  const members = `${pad}  tileMask : vec4f, // x = 1 when only flagged tiles are drawn, y = tile size in pixels, z = tiles per row, w = unused\n  tileBits : array<vec4u, ${MASK_WORDS / 4}>,`;
  const withStruct = shader.replace(/(struct Uniforms \{[\s\S]*?)(\n\};)/, `$1\n${members}$2`);
  return withStruct.replace(FS_ANCHOR, (head) => `${head}
  if (u.tileMask.x > 0.5) {
    let tileSize = u32(u.tileMask.y);
    let index = (u32(frag.y + u.tile.y) / tileSize) * u32(u.tileMask.z) + u32(frag.x + u.tile.x) / tileSize;
    let word = u.tileBits[index >> 7u][(index >> 5u) & 3u];
    if (((word >> (index & 31u)) & 1u) == 0u) { discard; }
  }`);
}

export interface TileMask {
  /** Tile size in pixels, counted from the top left of the WHOLE picture. */
  tile: number;
  /** Tiles per row of the whole picture. */
  cols: number;
  /** One byte per tile (0 = skipped, 1 = drawn), row by row. */
  flags: Uint8Array;
}

/** The numbers written after the ordinary uniforms. A null mask turns the early exit off. */
export function packTileMask(mask: TileMask | null, into: Float32Array): void {
  const words = new Uint32Array(into.buffer, into.byteOffset + (ADAPTIVE_OFFSET + 4) * 4, MASK_WORDS);
  words.fill(0);
  if (!mask) { into.fill(0, ADAPTIVE_OFFSET, ADAPTIVE_OFFSET + 4); return; }
  if (mask.flags.length > MAX_MASK_TILES) throw Error(`A refinement mask holds at most ${MAX_MASK_TILES} tiles; use larger tiles.`);
  into.set([1, mask.tile, mask.cols, 0], ADAPTIVE_OFFSET);
  for (let i = 0; i < mask.flags.length; i++) if (mask.flags[i]) words[i >> 5] = (words[i >> 5]! | (1 << (i & 31))) >>> 0;
}

/** Is the pixel (x, y) of the whole picture inside a flagged tile? Used when the refined and the base pictures are put together. */
export const tileFlagged = (mask: TileMask, x: number, y: number): boolean => mask.flags[Math.floor(y / mask.tile) * mask.cols + Math.floor(x / mask.tile)] === 1;
