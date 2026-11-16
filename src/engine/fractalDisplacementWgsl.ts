/**
 * The shader side of the fractal displacement (see fractalDisplacement.ts for what the numbers mean).
 *
 * `displaceFormula(code)` takes the formula code of a picture or trace shader (the functions formulaCoreAtThreshold, formulaCore and formulaDistance) and renames the
 * originals to base*, then adds new functions with the old names that return the displaced field. Everything that already calls the formula (marching, normals,
 * shadows, occlusion, reflections, picking) therefore sees the new shape without being changed. The layers are read from the uniform block (member `fdisp`), so a
 * shader with displacement is the same shader whatever the layers are: editing a layer never builds anything.
 *
 * The layer noise is mirrored on the CPU in fractalDisplacementCpu.ts (used for tests and for measuring the steepness the marcher has to be careful with).
 */
import { FDISP_FLOATS } from './fractalDisplacement';
import { BOX_FLOATS } from './boxCut';

/** Hash, noise patterns, masks and the field. Needs the uniform block `u` with the member `fdisp`, and FORMULA_ITERATIONS from the formula code. */
export const FRACTAL_DISPLACEMENT_WGSL = /* wgsl */ `
fn fdHash(c : vec3i, seed : u32) -> u32 {
  var h = (bitcast<u32>(c.x) * 0x8da6b343u) ^ (bitcast<u32>(c.y) * 0xd8163841u) ^ (bitcast<u32>(c.z) * 0xcb1ab31fu) ^ (seed * 0x9e3779b9u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du; h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}
fn fdQuintic(f : vec3f) -> vec3f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
fn fdGradient(h : u32, d : vec3f) -> f32 {
  let g = vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) * (1.0 / 127.5) - vec3f(1.0);
  return dot(g, d);
}
// Smooth gradient noise, about -1 to 1.
fn fdPerlin(p : vec3f, seed : u32) -> f32 {
  let b = floor(p); let i = vec3i(b); let f = p - b; let w = fdQuintic(f);
  let n000 = fdGradient(fdHash(i, seed), f);
  let n100 = fdGradient(fdHash(i + vec3i(1, 0, 0), seed), f - vec3f(1, 0, 0));
  let n010 = fdGradient(fdHash(i + vec3i(0, 1, 0), seed), f - vec3f(0, 1, 0));
  let n110 = fdGradient(fdHash(i + vec3i(1, 1, 0), seed), f - vec3f(1, 1, 0));
  let n001 = fdGradient(fdHash(i + vec3i(0, 0, 1), seed), f - vec3f(0, 0, 1));
  let n101 = fdGradient(fdHash(i + vec3i(1, 0, 1), seed), f - vec3f(1, 0, 1));
  let n011 = fdGradient(fdHash(i + vec3i(0, 1, 1), seed), f - vec3f(0, 1, 1));
  let n111 = fdGradient(fdHash(i + vec3i(1, 1, 1), seed), f - vec3f(1, 1, 1));
  let v = mix(mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y), mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y), w.z);
  return clamp(v, -1.0, 1.0);
}
// Smooth value noise (blobbier and cheaper than gradient noise), -1 to 1.
fn fdValueAt(c : vec3i, seed : u32) -> f32 { return f32(fdHash(c, seed) >> 8u) * (2.0 / 16777216.0) - 1.0; }
fn fdValue(p : vec3f, seed : u32) -> f32 {
  let b = floor(p); let i = vec3i(b); let w = fdQuintic(p - b);
  return mix(mix(mix(fdValueAt(i, seed), fdValueAt(i + vec3i(1, 0, 0), seed), w.x), mix(fdValueAt(i + vec3i(0, 1, 0), seed), fdValueAt(i + vec3i(1, 1, 0), seed), w.x), w.y),
             mix(mix(fdValueAt(i + vec3i(0, 0, 1), seed), fdValueAt(i + vec3i(1, 0, 1), seed), w.x), mix(fdValueAt(i + vec3i(0, 1, 1), seed), fdValueAt(i + vec3i(1, 1, 1), seed), w.x), w.y), w.z);
}
// Cellular noise: the distances to the nearest and the second nearest of the feature points (one per cell, in cell units).
fn fdCell(p : vec3f, seed : u32) -> vec2f {
  let b = floor(p); let i = vec3i(b); let f = p - b;
  var d1 = 9.0; var d2 = 9.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3i(x, y, z); let h = fdHash(i + o, seed);
    let jitter = vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) * (0.9 / 1023.0) + vec3f(0.05);
    let d = length(vec3f(o) + jitter - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  } } }
  return vec2f(d1, d2);
}
fn fdSmooth(t : f32) -> f32 { let c = clamp(t, 0.0, 1.0); return c * c * (3.0 - 2.0 * c); }
// One octave of a pattern, -1 to 1. pattern: 0 organic, 1 ridged, 2 billow, 3 pores, 4 cracks, 5 erosion (ridged), 6 grain.
fn fdOctave(pattern : i32, q : vec3f, seed : u32) -> f32 {
  if (pattern == 0) { return fdPerlin(q, seed); }
  if (pattern == 1 || pattern == 5) { return 1.0 - 2.0 * abs(fdPerlin(q, seed)); }
  if (pattern == 2) { return 2.0 * abs(fdPerlin(q, seed)) - 1.0; }
  if (pattern == 3) { return 1.0 - 2.0 * fdSmooth(fdCell(q, seed).x / 0.5); }
  if (pattern == 4) { let c = fdCell(q, seed); return 1.0 - 2.0 * fdSmooth((c.y - c.x) / 0.4); }
  return fdValue(q, seed);
}
// The layer's pattern: its octaves added up and divided by their total weight, so the result stays within -1 to 1.
fn fdPattern(pattern : i32, p : vec3f, octaves : i32, lacunarity : f32, persistence : f32, seed : u32) -> f32 {
  var sum = 0.0; var norm = 0.0; var amp = 1.0; var freq = 1.0; var weight = 1.0;
  for (var k = 0; k < octaves; k++) {
    let q = p * freq + vec3f(17.13, 31.71, 9.37) * f32(k);
    let v = fdOctave(pattern, q, seed);
    sum += amp * weight * v; norm += amp;
    if (pattern == 5) { weight = 0.5 + 0.5 * v; } // erosion: later octaves only grow where this one is high, like water cutting in along the ridges
    amp *= persistence; freq *= lacunarity;
  }
  return sum / max(norm, 1e-6);
}
fn fdWindow(v : f32, low : f32, high : f32, soft : f32) -> f32 {
  let s = max(soft, 1e-9);
  return fdSmooth((v - (low - s)) / s) * (1.0 - fdSmooth((v - high) / s));
}
// How far all layers together move the surface at pos (positive = outwards). core = (distance, iterations, orbit trap) of the formula, used by the masks that measure the fractal.
fn fdHeight(pos : vec3f, core : vec3f) -> f32 {
  let count = i32(u.fdisp[0].x);
  let scale = max(select(FORMULA_ITERATIONS, u.loops[0].y, u.loops[0].y > 0.5), 1.0);
  var total = 0.0;
  for (var i = 0; i < count; i++) {
    let a = u.fdisp[1 + 4 * i]; let b = u.fdisp[2 + 4 * i]; let c = u.fdisp[3 + 4 * i]; let e = u.fdisp[4 + 4 * i];
    var mask = 1.0;
    let kind = i32(c.x + 0.5);
    if (kind > 0) {
      var m = 0.0;
      if (kind == 1) { m = core.z * 0.5; } else if (kind == 2) { m = core.y / scale; } else if (kind == 3) { m = pos.y; } else if (kind == 4) { m = length(pos); } else if (kind == 5) { m = pos.x; } else { m = pos.z; }
      mask = fdWindow(m, c.y, c.z, c.w);
      if (e.w > 0.5) { mask = 1.0 - mask; }
    }
    if (mask <= 0.0) { continue; }
    let v = fdPattern(i32(a.x + 0.5) - 1, (pos + e.xyz) * a.z, i32(a.w + 0.5), b.x, b.y, u32(b.z));
    let blend = i32(b.w + 0.5);
    var shaped = v;
    if (blend == 1) { shaped = -(0.5 + 0.5 * v); } else if (blend == 2) { shaped = 0.5 + 0.5 * v; }
    total += a.y * mask * shaped;
  }
  return total;
}
// The displaced field from the formula's own distance d. Far from the surface the layers cannot reach, so d only moves by the largest amount A and nothing is evaluated.
fn fdField(pos : vec3f, d : f32, core : vec3f) -> f32 {
  let reach = u.fdisp[0].y;
  if (d > 2.0 * reach) { return d - reach; }
  if (d < -2.0 * reach) { return d + reach; }
  return (d - fdHeight(pos, core)) * u.fdisp[0].z;
}
`;

const FORMULA_NAMES = ['formulaCoreAtThreshold', 'formulaCore', 'formulaDistance'];
/** Renames the formula's functions to base* and adds the displacing ones under the old names. Code without a formula (or without the three functions) comes back as it was. */
export function displaceFormula(code: string): string {
  if (code.includes('fn baseFormulaCore(') || !code.includes('fn formulaCore(') || !code.includes('fn formulaDistance(')) return code;
  // Only the three definitions (and the calls between them) are renamed; every other place that calls the formula keeps its name and so gets the displaced one.
  let out = code;
  for (const name of FORMULA_NAMES) {
    const start = out.indexOf(`fn ${name}(`);
    if (start < 0) continue;
    const open = out.indexOf('{', start);
    let depth = 0, end = open;
    for (; end < out.length; end++) { if (out[end] === '{') depth++; else if (out[end] === '}' && --depth === 0) break; }
    let definition = out.slice(start, end + 1);
    for (const other of FORMULA_NAMES) definition = definition.replace(new RegExp(`\\b${other}\\b`, 'g'), 'base' + other[0]!.toUpperCase() + other.slice(1));
    out = out.slice(0, start) + definition + out.slice(end + 1);
  }
  const threshold = code.includes('fn formulaCoreAtThreshold(');
  return `${out}
${FRACTAL_DISPLACEMENT_WGSL}
${threshold ? `fn formulaCoreAtThreshold(pos : vec3f, threshold : f32) -> vec3f {
  let core = baseFormulaCoreAtThreshold(pos, threshold);
  if (u.fdisp[0].w < 0.5) { return core; }
  return vec3f(fdField(pos, core.x, core), core.y, core.z);
}` : ''}
fn formulaCore(pos : vec3f) -> vec3f {
  let core = baseFormulaCore(pos);
  if (u.fdisp[0].w < 0.5) { return core; }
  return vec3f(fdField(pos, core.x, core), core.y, core.z);
}
fn formulaDistance(pos : vec3f) -> f32 {
  if (u.fdisp[0].w < 0.5) { return baseFormulaDistance(pos); }
  if (u.fdisp[0].w > 1.5) { return formulaCore(pos).x; }
  let d = baseFormulaDistance(pos);
  return fdField(pos, d, vec3f(d, 0.0, 0.0)); // no mask measures the fractal, so the cheaper distance-only call is enough
}
`;
}

/** Adds the member fdisp to the uniform block (after the box-cut block, which only some shaders have), and the filler for the box-cut block when the shader has none. */
export function addDisplacementUniforms(shader: string): string {
  if (/\bfdisp\s*:/.test(shader)) return shader;
  const pad = /boxPlanes\s*:|boxPad\s*:/.test(shader) ? '' : `  boxPad : array<vec4f, ${BOX_FLOATS / 4}>,\n`;
  return shader.replace(/(struct Uniforms \{[\s\S]*?)(\n\};)/, `$1\n${pad}  fdisp : array<vec4f, ${FDISP_FLOATS / 4}>,$2`);
}

/** A whole shader (picture, pick, multi-sample, trace) with the displacement: the uniform member and the displacing formula functions. */
export function applyFractalDisplacement(shader: string): string {
  return displaceFormula(addDisplacementUniforms(shader));
}
