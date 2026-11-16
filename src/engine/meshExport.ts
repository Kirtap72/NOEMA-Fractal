import type { CameraTrack } from "./cameraPath";
import type { Mesh } from "./mesh";

/**
 * Writers for open mesh formats: glTF 2.0 (binary, .glb), Wavefront OBJ and Stanford PLY.
 * All three get the credits of the formulas as text, so the authors follow the file.
 * The coordinates are the engine's own: right-handed with Y up, which is what glTF uses.
 * Blender and Unreal use other axes; that conversion is done when importing (see ARCHITECTURE.md 8.3).
 */

const encoder = new TextEncoder();

/** One line of text for each name and source, for example "mandelbulb: Daniel White (unverified)". */
export function creditLines(entries: readonly { formula: string; text: string; status: string }[]): string[] {
  return entries.map((e) => `${e.formula}: ${e.text} (${e.status === "verified" ? "verified" : "unverified"})`);
}

const oneLine = (text: string): string => text.replace(/[\r\n]+/g, " ");

/** Linear light to the 0-255 value a screen (sRGB) and OBJ/PLY viewers expect. */
export function linearToSrgb8(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

// ---- OBJ

/** A Wavefront OBJ file, as text parts that can be joined or put straight in a Blob. */
export function meshToObjParts(mesh: Mesh, comments: readonly string[] = []): string[] {
  const parts: string[] = ["# Fraktalmotorn mesh\n"];
  if (mesh.colors) parts.push("# vertex colours: v x y z r g b (sRGB, 0 to 1)\n");
  for (const c of comments) parts.push(`# ${oneLine(c)}\n`);
  const n = mesh.positions.length / 3;
  const P = mesh.positions;
  const N = mesh.normals;
  const C = mesh.colors;
  const CHUNK = 20000;
  for (let from = 0; from < n; from += CHUNK) {
    const lines: string[] = [];
    for (let i = from; i < Math.min(n, from + CHUNK); i++) {
      const colour = C ? ` ${linearToSrgb8(C[i * 3]!) / 255} ${linearToSrgb8(C[i * 3 + 1]!) / 255} ${linearToSrgb8(C[i * 3 + 2]!) / 255}` : "";
      lines.push(`v ${P[i * 3]} ${P[i * 3 + 1]} ${P[i * 3 + 2]}${colour}`);
    }
    parts.push(lines.join("\n") + "\n");
  }
  for (let from = 0; from < n; from += CHUNK) {
    const lines: string[] = [];
    for (let i = from; i < Math.min(n, from + CHUNK); i++) lines.push(`vn ${N[i * 3]} ${N[i * 3 + 1]} ${N[i * 3 + 2]}`);
    parts.push(lines.join("\n") + "\n");
  }
  const I = mesh.indices;
  const triangles = I.length / 3;
  for (let from = 0; from < triangles; from += CHUNK) {
    const lines: string[] = [];
    for (let t = from; t < Math.min(triangles, from + CHUNK); t++) {
      const a = I[t * 3]! + 1; // OBJ counts from 1
      const b = I[t * 3 + 1]! + 1;
      const c = I[t * 3 + 2]! + 1;
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    parts.push(lines.join("\n") + "\n");
  }
  return parts;
}

// ---- PLY

/** A binary little-endian Stanford PLY file: vertices with normals, triangles as lists of three. */
export function meshToPly(mesh: Mesh, comments: readonly string[] = []): Uint8Array {
  const vertices = mesh.positions.length / 3;
  const triangles = mesh.indices.length / 3;
  const C = mesh.colors;
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    "comment Fraktalmotorn mesh\n" +
    comments.map((c) => `comment ${oneLine(c)}\n`).join("") +
    `element vertex ${vertices}\n` +
    "property float x\nproperty float y\nproperty float z\n" +
    "property float nx\nproperty float ny\nproperty float nz\n" +
    (C ? "property uchar red\nproperty uchar green\nproperty uchar blue\n" : "") +
    `element face ${triangles}\n` +
    "property list uchar int vertex_indices\n" +
    "end_header\n";
  const head = encoder.encode(header);
  const out = new Uint8Array(head.length + vertices * (C ? 27 : 24) + triangles * 13);
  out.set(head, 0);
  const view = new DataView(out.buffer);
  let o = head.length;
  for (let i = 0; i < vertices; i++) {
    for (let k = 0; k < 3; k++, o += 4) view.setFloat32(o, mesh.positions[i * 3 + k]!, true);
    for (let k = 0; k < 3; k++, o += 4) view.setFloat32(o, mesh.normals[i * 3 + k]!, true);
    if (C) for (let k = 0; k < 3; k++) view.setUint8(o++, linearToSrgb8(C[i * 3 + k]!));
  }
  for (let t = 0; t < triangles; t++) {
    view.setUint8(o++, 3);
    for (let k = 0; k < 3; k++, o += 4) view.setInt32(o, mesh.indices[t * 3 + k]!, true);
  }
  return out;
}

// ---- glTF (GLB)

export interface GlbOptions {
  metallic?: number;
  roughness?: number;
  objectId?: string;
  extras?: Record<string, unknown>;
  name?: string;
  /** Credits and notes, stored in the file's `asset.extras` (a place the format reserves for extra data). */
  credits?: readonly string[];
  /** Base colour, red, green, blue from 0 to 1. */
  color?: [number, number, number];
  /** A camera that moves along the animation, added to the file (Blender and other programs can import it). */
  camera?: CameraTrack;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/**
 * A binary glTF 2.0 file (.glb) with a mesh (positions, normals, 32-bit triangle indices and a plain material),
 * a camera that moves along the animation, or both. The file layout: a 12 byte header, a JSON chunk describing
 * the data, and a binary chunk with the data itself.
 */
function buildGlb(mesh: Mesh | null, options: GlbOptions): Uint8Array {
  const camera = options.camera ?? null;
  if (!mesh && !camera) throw new Error("there is nothing to write: give a mesh or a camera");
  const vertices = mesh ? mesh.positions.length / 3 : 0;
  const indexCount = mesh ? mesh.indices.length : 0;
  if (mesh && (vertices === 0 || indexCount === 0)) throw new Error("the mesh is empty");
  if (camera && camera.times.length === 0) throw new Error("the camera path has no frames");

  const buffers: { data: Float32Array | Uint32Array; target?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const views: Record<string, unknown>[] = [];
  let offset = 0;
  const addView = (data: Float32Array | Uint32Array, target?: number): number => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, ...(target ? { target } : {}) });
    buffers.push({ data, ...(target ? { target } : {}) });
    offset += data.byteLength;
    return views.length - 1;
  };

  const nodes: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const cameras: Record<string, unknown>[] = [];
  const animations: Record<string, unknown>[] = [];
  let materials: Record<string, unknown>[] | undefined;

  if (mesh) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices; i++) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.positions[i * 3 + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
    }
    const [r, g, b] = options.color ?? [0.8, 0.7, 0.6];
    const position = accessors.push({ bufferView: addView(mesh.positions, 34962), componentType: 5126, count: vertices, type: "VEC3", min, max }) - 1;
    const normal = accessors.push({ bufferView: addView(mesh.normals, 34962), componentType: 5126, count: vertices, type: "VEC3" }) - 1;
    const indices = accessors.push({ bufferView: addView(mesh.indices, 34963), componentType: 5125, count: indexCount, type: "SCALAR" }) - 1;
    const attributes: Record<string, number> = { POSITION: position, NORMAL: normal };
    if (mesh.colors) {
      if (mesh.colors.length !== mesh.positions.length) throw new Error("the mesh needs one colour per vertex");
      attributes.COLOR_0 = accessors.push({ bufferView: addView(mesh.colors, 34962), componentType: 5126, count: vertices, type: "VEC3" }) - 1;
    }
    meshes.push({ name: options.name ?? "fractal", primitives: [{ attributes, indices, material: 0, mode: 4 }] });
    materials = [{ name: "surface", pbrMetallicRoughness: { baseColorFactor: mesh.colors && !options.color ? [1, 1, 1, 1] : [r, g, b, 1], metallicFactor: options.metallic ?? 0, roughnessFactor: options.roughness ?? 0.8 } }];
    nodes.push({ mesh: 0, name: options.name ?? "fractal", extras: { objectId: options.objectId ?? options.name ?? 'fractal', ...options.extras } });
  }

  if (camera) {
    const n = camera.times.length;
    const times = Float32Array.from(camera.times);
    const timeAccessor = accessors.push({ bufferView: addView(times), componentType: 5126, count: n, type: "SCALAR", min: [times[0]], max: [times[n - 1]] }) - 1;
    const moveAccessor = accessors.push({ bufferView: addView(camera.positions), componentType: 5126, count: n, type: "VEC3" }) - 1;
    const turnAccessor = accessors.push({ bufferView: addView(camera.rotations), componentType: 5126, count: n, type: "VEC4" }) - 1;
    cameras.push({ name: "camera", type: "perspective", perspective: { yfov: camera.yfov, aspectRatio: camera.aspect, znear: 0.01, zfar: 1000 } });
    const cameraNode = nodes.push({
      name: "camera",
      camera: 0,
      translation: Array.from(camera.positions.slice(0, 3)),
      rotation: Array.from(camera.rotations.slice(0, 4)),
    }) - 1;
    animations.push({
      name: "camera path",
      samplers: [
        { input: timeAccessor, output: moveAccessor, interpolation: "LINEAR" },
        { input: timeAccessor, output: turnAccessor, interpolation: "LINEAR" },
      ],
      channels: [
        { sampler: 0, target: { node: cameraNode, path: "translation" } },
        { sampler: 1, target: { node: cameraNode, path: "rotation" } },
      ],
    });
  }

  const notes = [
    ...(options.credits ?? []),
    ...(camera ? [`camera: ${camera.fps} frames per second${camera.fovChanges ? "; the field of view changes in the animation but glTF cannot animate it, so the first value is used" : ""}`] : []),
  ];
  const json = {
    asset: { version: "2.0", generator: "Fraktalmotorn", ...(notes.length > 0 ? { extras: { credits: notes } } : {}) },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    ...(meshes.length > 0 ? { meshes } : {}),
    ...(materials ? { materials } : {}),
    ...(cameras.length > 0 ? { cameras } : {}),
    ...(animations.length > 0 ? { animations } : {}),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadded = pad4(jsonBytes.length);
  const binPadded = pad4(offset);
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded); // JSON is padded with spaces
  const binStart = 20 + jsonPadded;
  view.setUint32(binStart, binPadded, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  let o = binStart + 8;
  for (const { data } of buffers) {
    const isFloat = data instanceof Float32Array;
    for (let i = 0; i < data.length; i++, o += 4) {
      if (isFloat) view.setFloat32(o, data[i]!, true);
      else view.setUint32(o, data[i]!, true);
    }
  }
  return out;
}

/** A GLB file with the mesh, and the animated camera too if `options.camera` is given. */
export function meshToGlb(mesh: Mesh, options: GlbOptions = {}): Uint8Array {
  return buildGlb(mesh, options);
}

/** A GLB file with only the animated camera (no shape), for programs that already have the shape. */
export function cameraToGlb(options: GlbOptions & { camera: CameraTrack }): Uint8Array {
  return buildGlb(null, options);
}

// ---- camera path as plain data, for scripts

/** The camera path as JSON text with one entry per frame. Easy to read from a Blender or Unreal script. */
export function cameraTrackToJson(
  track: CameraTrack,
  extra: { units: string; target?: readonly (readonly number[])[]; credits?: readonly string[] },
): string {
  const frames = track.times.map((t, i) => ({
    frame: i,
    time_seconds: t,
    position: Array.from(track.positions.slice(i * 3, i * 3 + 3)),
    rotation_quaternion_xyzw: Array.from(track.rotations.slice(i * 4, i * 4 + 4)),
  }));
  return JSON.stringify(
    {
      format: "fraktalmotorn-camera-path",
      version: 1,
      coordinate_system: "right-handed, Y up. The camera looks along its own -Z axis with +Y up (as in glTF).",
      units: extra.units,
      fps: track.fps,
      vertical_fov_degrees: (track.yfov * 180) / Math.PI,
      aspect_ratio: track.aspect,
      field_of_view_changes: track.fovChanges,
      credits: extra.credits ?? [],
      frames,
    },
    null,
    2,
  ) + "\n";
}
