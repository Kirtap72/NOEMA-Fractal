/**
 * MATERIAL-GRADIENT-02: what the shader needs to blend the PBR maps of textured gradient stops.
 *
 * The images and the per-material texture scale travel through the existing surface machinery (`surfaceMaterials` appends one virtual
 * material per distinct textured stop material, see surfaceDetail.ts). This file adds the part that is new: how much of each of those
 * materials is present at each point of the gradient (a 32-node table with the same linear interpolation, wrapping, cycles and offset as the
 * V1 scalar curves), and the scalar values the textured materials contribute. They are written after the surface records in the same
 * storage buffer, so no binding changes.
 *
 * Layout of the tail (float32, after the PBR records of the 37 surface slots; 8 records of 20 floats = 40 vec4):
 *   vec4 0        : (number of entries K, slot of entry 0, 0, 0)
 *   vec4 1 + e    : (metallic, roughness, reflectivity, 0) of entry e, e < 4
 *   vec4 5 + e*8+n: the weights of entry e at nodes 4n..4n+3  (n < 8, so 32 nodes)
 */
import { MAX_TEXTURED_MATERIALS, entryWeightsAt, texturedEntries } from "./materialRamp";
import type { RampStop } from "./materialRamp";
import { SURFACE_SLOTS } from "./surfaceDetail";

export const GRADIENT_WEIGHT_NODES = 32;
export const PBR_RECORD_FLOATS_TAIL = 20;
/** The first record of the gradient tail (the shader uses the same number). */
export const PBR_GRAD_TAIL = SURFACE_SLOTS;
export const PBR_GRAD_TAIL_RECORDS = 8;
/** Total number of PBR records in the buffer: surface slots plus the tail. */
export const PBR_TOTAL_RECORDS = PBR_GRAD_TAIL + PBR_GRAD_TAIL_RECORDS;

export interface RampTextureTable {
  /** Slot of the first textured entry: 1 + number of primitives. */
  baseSlot: number;
  entries: { metallic: number; roughness: number; reflectivity: number; weights: Float32Array }[];
}

/** The table for a gradient, or undefined when no active stop brings image maps (then nothing about the shader or the buffers changes). */
export function rampTextureTable(stops: readonly RampStop[], primitiveCount: number): RampTextureTable | undefined {
  const entries = texturedEntries(stops);
  if (!entries.length) return undefined;
  if (entries.length > MAX_TEXTURED_MATERIALS) throw new Error(`At most ${MAX_TEXTURED_MATERIALS} different textured materials per gradient.`);
  const nodes = Array.from({ length: GRADIENT_WEIGHT_NODES }, (_, i) => entryWeightsAt(stops, entries, i / (GRADIENT_WEIGHT_NODES - 1)));
  return {
    baseSlot: 1 + primitiveCount,
    entries: entries.map((e, k) => ({
      metallic: e.material.metallic, roughness: e.material.roughness, reflectivity: e.material.reflectivity,
      weights: Float32Array.from(nodes.map((n) => n[k]!)),
    })),
  };
}

/** The tail records as floats (PBR_GRAD_TAIL_RECORDS * 20). All zero (K = 0) when there is no table. */
export function packRampTail(table: RampTextureTable | undefined): Float32Array {
  const out = new Float32Array(PBR_GRAD_TAIL_RECORDS * PBR_RECORD_FLOATS_TAIL);
  if (!table) return out;
  out[0] = table.entries.length; out[1] = table.baseSlot;
  table.entries.forEach((e, k) => {
    out.set([e.metallic, e.roughness, e.reflectivity, 0], (1 + k) * 4);
    out.set(e.weights, (5 + k * 8) * 4);
  });
  return out;
}
