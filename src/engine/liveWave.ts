// Live LookDev 2 (LIVE-ARCH-19, see docs/rendering/LIVE_ARCH_19.md): a "wavefront" Live renderer. The picture is NOT drawn by one big shader that contains the
// formula many times (which is what makes a heavy scene take 25-70 s to build). Instead:
//   - the TRACE kernel is the only shader that contains the formula, and it calls the formula in exactly ONE place (a small state machine marches the ray, then
//     takes the four normal samples and the occlusion samples through the same call). It turns a list of rays into a list of hits. It is rebuilt only when the
//     formula changes, in a fraction of a second.
//   - the SHADE kernels (make camera rays, light the hits and ask for shadow / reflection rays, add up the picture) contain no formula at all. They are built
//     once and never again. Lights, materials, colours, objects, texture, displacement, shadows on/off and the number of reflection bounces are all data.
// The lighting here is a simpler one than the final renderer's: this is a working view, not final quality. It reads the engine's own uniform block, so the
// scene's lights, material, colours and formula parameters are the same numbers the final renderer gets.
import { buildDistanceShader, MATERIAL_FUNCTIONS } from './shader';
import { surfaceWgsl, DETAIL_OBJECT_TRANSFORM } from './surfaceDetailWgsl';
import { integrateProceduralDetail } from './proceduralDetailWgsl';
import { displacementActive, displacementRequested, packDisplacement, withDisplacementImages } from './displacement';
import { integrateMaterialTextures } from './materialTexturesWgsl';
import { createSurfaceAtlas } from './surfaceTextures';
import type { SurfaceAtlas } from './surfaceTextures';
import { SURFACE_SLOTS, packProceduralSurfaceDetails, surfaceDetailActive, surfaceImages, surfaceMaterials } from './surfaceDetail';
import { PBR_BUFFER_RECORDS, PBR_RECORD_FLOATS, packMaterialTextures } from './materialTextures';
import { packRampTail, rampTextureTable } from './rampTextures';
import { effectiveMaterial } from './materialRampApply';
import { lensSample } from './cameraOptics';
import { doubleSingleField, dsDefinition } from './geometryDoubleSingle';
import { KERNEL_PRIMITIVES_WGSL } from './formula/kernelWgsl';
import { floorAt } from './precisionFloor';
import { packUniforms, UNIFORM_FLOATS, DISPLAY_OFFSET, MARCH_OFFSET, OPTICS_OFFSET, FDISP_OFFSET, TUNE_OFFSET } from './uniforms';
import { diffuseOrbitRequest } from './diffuseOrbit';
import { fractalDisplacementActive, packFractalDisplacement } from './fractalDisplacement';
import { addDisplacementUniforms, displaceFormula } from './fractalDisplacementWgsl';
import { cameraBasis } from './camera';
import { LUT_SIZE } from './gradient';
import { primitiveInverse } from './primitives';
import type { SceneHit, ScenePrimitive } from './primitives';
import { resolveScene, toChainSteps } from './scene';
import type { ResolvedScene, Scene } from './scene';
import { generateChain } from './formula/chain';
import { buildMipChain, toHalfRgba } from './radiance';
import type { HdrImage } from './radiance';
import { irradianceCoefficients } from './environment';
import type { Formula } from './formula/types';

const UNIFORMS = buildDistanceShader('').split('@group(0) @binding(1)')[0]!; // the engine's own uniform block, unchanged
/** The trace kernel's block: the same, with the room for the fractal displacement layers (the shading kernels never read them, so they keep the shorter one). */
// the box-cut block of the engine's block is real here (the filler of addDisplacementUniforms is renamed), so the trace kernel can clip against it
const TRACE_UNIFORMS = addDisplacementUniforms(UNIFORMS).replace('boxPad : array<vec4f, 7>,', 'boxPlanes : array<vec4f, 6>,\n  boxFlags : vec4f,');
/** Open clipping (clip planes and the box cut): the stretch of each ray that is kept, and whether a point is kept. Same rules as the final renderer's clipInterval / retained. */
const CLIP_WGSL = `
fn lvClipOn() -> bool { return any(u.clipFlags.xyz > vec3f(0.5)) || u.boxFlags.x > 0.5; }
fn lvClipPlane(plane : vec4f, o : vec3f, d : vec3f, iv : vec2f) -> vec2f {
  var near = iv.x; var far = iv.y;
  let dist = dot(plane.xyz, o) - plane.w; let slope = dot(plane.xyz, d);
  if (abs(slope) < 1e-8) { if (dist > 0.0) { return vec2f(1.0, 0.0); } }
  else if (slope > 0.0) { far = min(far, -dist / slope); } else { near = max(near, -dist / slope); }
  return vec2f(near, far);
}
fn lvClipInterval(o : vec3f, d : vec3f, maximum : f32) -> vec2f {
  var iv = vec2f(0.0, maximum);
  for (var i = 0; i < 3; i++) { if (u.clipFlags[u32(i)] > 0.5) { iv = lvClipPlane(u.planes[u32(i)], o, d, iv); } }
  if (u.boxFlags.x > 0.5) { for (var i = 0; i < 6; i++) { iv = lvClipPlane(u.boxPlanes[i], o, d, iv); } }
  return iv;
}
fn lvRetained(p : vec3f) -> bool {
  for (var i = 0; i < 3; i++) { if (u.clipFlags[u32(i)] > 0.5 && dot(u.planes[u32(i)].xyz, p) > u.planes[u32(i)].w) { return false; } }
  if (u.boxFlags.x > 0.5) { for (var i = 0; i < 6; i++) { if (dot(u.boxPlanes[i].xyz, p) > u.boxPlanes[i].w) { return false; } } }
  return true;
}
`;
const STRUCTS = /* wgsl */ `
struct LvRay { o : vec3f, tmax : f32, d : vec3f, kind : f32, x : vec4f };   // kind: 0 none, 1 camera, 2 shadow, 3 reflection; x = (distance travelled before, shadow softness k)
struct LvHit { n : vec3f, t : f32, m : vec2f, obj : f32, vis : f32 };       // t < 0: nothing hit; m = (iterations 0-1, orbit trap); obj = object number or -1; vis = shadow light (shadow ray) or open-ness 0-1 (occlusion)
struct LvLive { a : vec4f, b : vec4f, c : vec4f, d : vec4f, e : vec4f, f : vec4f };               // a = (rays, width, height, frame) b = (bounce, -, shadows on, most bounces) c = (displacement, its scale, texture strength, its scale) d = (objects, reflection steps, jitter)
// Thread t of a band: which entry of the ray lists it works on (the band of pixels, once for each region: camera or mirror rays, then the two shadow rays).
fn lvIndex(t : u32) -> u32 { let bc = u32(lvLive.e.y); return (t / bc) * u32(lvLive.e.z) + u32(lvLive.e.x) + t % bc; }
fn lvPixel(t : f32) -> f32 { if (u.cameraEffects.x > 0.0) { return u.cameraEffects.x / u.view.y; } return t * 2.0 * u.view.z / u.view.y; }
// The smallest hit threshold 32-bit numbers can still tell apart at p (the final renderer's floor); u.tile.w scales it (the scene's precision_floor, 0 = unscaled).
fn lvFloor(p : vec3f) -> f32 { return 2.0e-6 * (1.0 + length(p)) * select(1.0, u.tile.w, u.tile.w > 0.0); }
fn lvHitThreshold(t : f32, p : vec3f) -> f32 { if (u.prec.x > 0.5) { return max(u.prec.y * lvPixel(t), lvFloor(p)); } return u.march.x * (1.0 + t); }
fn lvNormalStep(t : f32, p : vec3f) -> f32 { if (u.prec.x > 0.5) { return max(u.prec.z * lvPixel(t), lvFloor(p)); } return u.extra.z; }
`;
/** Rows of 4 numbers per object: (type, position), (half size, roughness), (colour, metallic), (emission, reflectivity), then the three rows of the turn back into the object's own axes. */
export const OBJECT_ROWS = 9; // row 7: transmission, index of refraction, absorption density; row 8: absorption colour (glass)

/**
 * What the trace kernels know about objects: their shapes, and the material's displacement of a sphere or a plane (the final renderer's rule: geometryDistance in
 * displacementWgsl.ts). The height maps are the picture atlas, the numbers (strength, reference, scale) come from a buffer; nothing here depends on the formula.
 */
const TRACE_SURFACE_WGSL = /* wgsl */ `
@group(0) @binding(12) var lvAtlas : texture_2d_array<f32>;
@group(0) @binding(13) var lvAtlasSamp : sampler;
struct LvDisplacement { map : vec4f, limits : vec4f, transform : vec4f };
@group(0) @binding(16) var<storage, read> lvDisplacements : array<LvDisplacement, 32>;
fn lvChart(axis : i32, sgn : f32) -> mat3x3f {
  if (axis == 0) { return mat3x3f(vec3f(0, 0, -sgn), vec3f(0, 1, 0), vec3f(sgn, 0, 0)); }
  if (axis == 1) { return mat3x3f(vec3f(1, 0, 0), vec3f(0, 0, -sgn), vec3f(0, sgn, 0)); }
  return mat3x3f(vec3f(sgn, 0, 0), vec3f(0, 1, 0), vec3f(0, 0, sgn));
}
fn lvHeightAt(d : LvDisplacement, uv : vec2f) -> f32 {
  let c = cos(d.transform.y); let s = sin(d.transform.y);
  let coord = vec2f(c * uv.x - s * uv.y, s * uv.x + c * uv.y) * d.transform.x + d.transform.zw;
  return textureSampleLevel(lvAtlas, lvAtlasSamp, coord * vec2f(1, -1), i32(d.map.y), 0.0).r;
}
fn lvDisplacedField(q : vec3f, d : LvDisplacement) -> f32 {
  var base = q.y; var height = 0.0;
  if (d.limits.w == 1.0) {
    let radius = length(q); base = radius - 1.0; var n = vec3f(0, 1, 0); if (radius > 1e-12) { n = q / radius; }
    var w = n * n * n * n; w /= w.x + w.y + w.z;
    for (var k = 0; k < 3; k++) { let chart = lvChart(k, select(-1.0, 1.0, n[k] >= 0.0)); height += w[k] * lvHeightAt(d, vec2f(dot(n, chart[0]), dot(n, chart[1]))); }
  } else { height = lvHeightAt(d, vec2f(q.x, -q.z)); }
  return base - d.map.z * (height - d.map.w);
}
fn lvDisplacedDistance(q : vec3f, d : LvDisplacement) -> f32 {
  let f = lvDisplacedField(q, d); var distance = abs(f) / d.limits.x;
  if (d.limits.w == 1.0 && length(q) < 1.0 - d.map.z) { distance = 1.0 - d.map.z - length(q); }
  return select(distance, -distance, f < 0.0 && d.limits.w == 1.0) * d.limits.z;
}
// The distance to object j at the point q (in the object's own axes); kind 0 sphere, 1 box, 2 plane; b = its size.
fn lvShape(j : i32, kind : f32, q : vec3f, b : vec3f) -> f32 {
  let rec = lvDisplacements[j];
  if (rec.map.x > 0.5 && kind != 1.0) { return lvDisplacedDistance(q / b, rec); }
  if (kind < 0.5) { return (length(q / b) - 1.0) * min(b.x, min(b.y, b.z)); }   // a sphere, or a stretched one (a safe under-estimate)
  if (kind < 1.5) { let e = abs(q) - b; return length(max(e, vec3f(0.0))) + min(max(e.x, max(e.y, e.z)), 0.0); }
  return q.y;
}
`;

/** The only shader with the formula in it. One call site. */
export function traceKernel(formulaCode: string): string {
  const core = formulaCode.includes('fn formulaCoreAtThreshold(') ? 'formulaCoreAtThreshold(p, thr)' : 'formulaCore(p)';
  return /* wgsl */ `${TRACE_UNIFORMS}${STRUCTS}
@group(0) @binding(1) var<storage, read> lvRays : array<LvRay>;
@group(0) @binding(2) var<storage, read_write> lvHits : array<LvHit>;
@group(0) @binding(3) var<uniform> lvLive : LvLive;
@group(0) @binding(4) var<storage, read> lvPrims : array<vec4f>;
@group(0) @binding(5) var lvTex : texture_2d<f32>;
@group(0) @binding(6) var lvSamp : sampler;
${TRACE_SURFACE_WGSL}
${CLIP_WGSL}
${displaceFormula(formulaCode)}

fn lvHeight(p : vec3f) -> f32 {
  var w = abs(normalize(p + vec3f(1e-6))); w = w * w * w * w; w = w / (w.x + w.y + w.z);
  let s = lvLive.c.y;
  return w.x * textureSampleLevel(lvTex, lvSamp, p.yz * s, 0.0).r + w.y * textureSampleLevel(lvTex, lvSamp, p.zx * s, 0.0).r + w.z * textureSampleLevel(lvTex, lvSamp, p.xy * s, 0.0).r;
}
// The whole scene's distance at p: the fractal (with displacement when its amount is above 0) and the objects, which are rows of a buffer.
fn lvScene(p : vec3f, thr : f32, unsignedField : bool, inside : f32, shadowRay : bool) -> vec4f {
  let core = ${core};
  var d = select(core.x, abs(core.x), unsignedField); var obj = -1.0; // marching and occlusion with a cut: the field is unsigned (a cut shows its inside); the normal taps keep the sign
  let amp = lvLive.c.x;
  if (amp > 0.0) { if (d < 3.0 * amp) { d = (d - amp * lvHeight(p)) * 0.6; } else { d = d - amp; } }
  let count = i32(lvLive.d.x);
  for (var j = 0; j < count; j++) {
    let a = lvPrims[j * ${OBJECT_ROWS}]; let b = lvPrims[j * ${OBJECT_ROWS} + 1];
    let w = p - a.yzw;
    let q = vec3f(dot(lvPrims[j * ${OBJECT_ROWS} + 4].xyz, w), dot(lvPrims[j * ${OBJECT_ROWS} + 5].xyz, w), dot(lvPrims[j * ${OBJECT_ROWS} + 6].xyz, w));
    if (shadowRay && lvPrims[j * ${OBJECT_ROWS} + 7].x > 0.0) { continue; } // light passes through glass (it is not dimmed)
    var od = lvShape(j, a.x, q, b.xyz);
    if (f32(j) + 1.0 == inside) { od = -od; } // a ray inside a glass object looks for the way out: the distance to the surface from inside
    if (od < d) { d = od; obj = f32(j); }
  }
  let scale = select(f32(FORMULA_ITERATIONS), u.loops[0].y, u.loops[0].y > 0.5);
  return vec4f(d, core.y / max(scale, 1.0), core.z, obj);
}

@compute @workgroup_size(64)
fn trace(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(lvLive.a.x)) { return; }
  let i = lvIndex(id.x);
  let ray = lvRays[i];
  var hit : LvHit; hit.t = -1.0; hit.vis = 1.0; hit.obj = -1.0;
  if (ray.kind < 0.5) { lvHits[i] = hit; return; }
  let shadow = ray.kind > 1.5 && ray.kind < 2.5;
  var most = i32(u.march.z);
  if (shadow) { most = i32(u.extra.w); } else if (ray.kind > 2.5) { most = i32(lvLive.d.y); }
  let tet = array<vec3f, 4>(vec3f(1.0, -1.0, -1.0), vec3f(-1.0, -1.0, 1.0), vec3f(-1.0, 1.0, -1.0), vec3f(1.0, 1.0, 1.0));
  let clipped = lvClipOn(); var iv = vec2f(0.0, ray.tmax);
  if (clipped) { iv = lvClipInterval(ray.o, ray.d, ray.tmax); if (iv.x > iv.y) { lvHits[i] = hit; return; } } // nothing of this ray is kept
  let tend = min(ray.tmax, iv.y); var esc = false;
  var phase = 0; var t = iv.x; var steps = 0; var res = 1.0;
  var p = ray.o; var thr = lvHitThreshold(ray.x.x, p); var hp = p; var eps = 0.0; var grad = vec3f(0.0); var found = vec4f(0.0);
  var nrm = vec3f(0.0); var occ = 0.0; let reach = u.ao.y * 0.25;
  for (var k = 0; k < most + 9; k++) {
    if (phase == 0) { p = ray.o + ray.d * t; thr = lvHitThreshold(ray.x.x + t, p); } else if (phase < 5) { p = hp + tet[phase - 1] * eps; } else { p = hp + nrm * (reach * f32(phase - 4)); }
    let r = lvScene(p, thr, clipped && (phase == 0 || phase > 4), ray.x.z, shadow);           // the one and only place the formula is called
    if (phase == 0) {
      steps++;
      let spent = steps >= most;
      // a ray that enters through a cut starts inside the solid, where an unsigned field reads zero: walk on to the first point outside it (as the final renderer does)
      if (steps == 1 && iv.x > 0.0 && clipped && r.w < 0.0 && r.x >= 0.0 && r.x < thr) { esc = true; }
      if (esc) {
        if (r.x > thr) { esc = false; if (!(r.x < 1e18)) { break; } if (shadow) { res = 0.0; break; } found = r; hp = p; eps = lvNormalStep(ray.x.x + t, p); phase = 1; continue; }
        t += max(thr * 2.0, lvNormalStep(ray.x.x + t, p)); if (t > tend || spent) { break; } continue;
      }
      if (r.x < thr || (spent && !shadow && r.x < 40.0 * thr)) {
        if (shadow) { res = 0.0; break; }
        found = r; hp = p; eps = lvNormalStep(ray.x.x + t, p); phase = 1; continue;
      }
      if (shadow) { res = min(res, ray.x.y * r.x / max(t, 1e-6)); }
      t += r.x * u.march.y;
      if (t > tend || spent) { break; }
    } else if (phase < 5) {
      grad += tet[phase - 1] * r.x; phase++;
      if (phase > 4) {
        nrm = normalize(grad + vec3f(1e-30)); if (dot(nrm, ray.d) > 0.0) { nrm = -nrm; }
        if (u.ao.x <= 0.0 || reach <= 0.0) { phase = 9; break; }
      }
    } else {
      // occlusion: how much closer the surface is than free space would be, at four points along the normal (same call site)
      let far = reach * f32(phase - 4);
      if (!clipped || lvRetained(p)) { occ += clamp((far - r.x) / far, 0.0, 1.0); } phase++; // a probe in the cut-away part counts as free
      if (phase > 8) { break; }
    }
  }
  if (shadow) { hit.vis = clamp(res, 0.0, 1.0); }
  else if (phase > 4) { hit.t = t; hit.n = nrm; hit.m = found.yz; hit.obj = found.w; hit.vis = clamp(1.0 - u.ao.x * occ * 0.4, 0.0, 1.0); }
  lvHits[i] = hit;
}
`;
}

/** The formula code of the deep kernel for a scene, or why the scene has none: only formulas with a hand-written double-single version (geometryDsRegistry.ts) qualify. */
export function liveDeep(resolved: ResolvedScene, floatCode: string): { ok: true; code: string; iterations: number } | { ok: false; reason: string } {
  if (fractalDisplacementActive(resolved.scene.fractalDisplacement)) return { ok: false, reason: 'Displacement of the fractal is only drawn with ordinary precision (not the deep mode).' };
  if (resolved.scene.cutout?.box || resolved.scene.cutout?.planes?.length) return { ok: false, reason: 'Clipping is only drawn with ordinary precision (not the deep mode).' };
  if (hasLiveGlass(resolved.scene)) return { ok: false, reason: 'Glass is only drawn with ordinary precision (not the deep mode).' };
  try {
    const ds = doubleSingleField(dsDefinition(resolved, true), 'fma', true);
    const iterations = resolved.chain.reduce((sum, step) => sum + step.iterations, 0) * Math.max(1, resolved.rounds);
    return { ok: true, code: traceKernelDeep(ds, floatCode), iterations };
  } catch (e) { return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 200) }; }
}
/**
 * The trace kernel with the formula in double-single arithmetic. Camera rays start at the camera position given as two numbers (the uniform's high part and lvLive.f.xyz),
 * and every point is the sum of that and a small offset along the ray: the offset is tiny when the camera is close to the surface, so it keeps its 24 bits, while the
 * position as a whole keeps about 48. That is what lets the camera get far closer to a surface than 32-bit numbers allow. The hit threshold has no floor of its own here.
 */
export function traceKernelDeep(dsCode: string, floatCode: string): string {
  const core = floatCode.includes('fn formulaCoreAtThreshold(') ? 'formulaCoreAtThreshold(p, thr)' : 'formulaCore(p)';
  const header = STRUCTS.replace(/fn lvFloor\(p : vec3f\) -> f32 \{[^}]*\}/, 'fn lvFloor(p : vec3f) -> f32 { return 1.0e-13; }');
  return /* wgsl */ `${UNIFORMS}${header}
@group(0) @binding(1) var<storage, read> lvRays : array<LvRay>;
@group(0) @binding(2) var<storage, read_write> lvHits : array<LvHit>;
@group(0) @binding(3) var<uniform> lvLive : LvLive;
@group(0) @binding(4) var<storage, read> lvPrims : array<vec4f>;
@group(0) @binding(5) var lvTex : texture_2d<f32>;
@group(0) @binding(6) var lvSamp : sampler;
${TRACE_SURFACE_WGSL}
// the ordinary formula too, for one thing only: the colour measures (iterations, orbit trap) at the point that was hit, which do not need many digits
${floatCode}
${dsCode}
fn lvMeasures(p : vec3f, thr : f32) -> vec2f {
  let core = ${core};
  let scale = select(f32(FORMULA_ITERATIONS), u.loops[0].y, u.loops[0].y > 0.5);
  return vec2f(core.y / max(scale, 1.0), core.z);
}
fn lvAdd(a : DSP, v : vec3f) -> DSP { return DSP(dsA(a.x, vec2f(v.x, 0.0)), dsA(a.y, vec2f(v.y, 0.0)), dsA(a.z, vec2f(v.z, 0.0))); }
fn lvSceneDs(pd : DSP) -> vec4f {
  let r = geoDS(pd);
  var d = r.d.x + r.d.y; var obj = -1.0;
  let p = vec3f(pd.x.x, pd.y.x, pd.z.x);
  let count = i32(lvLive.d.x);
  for (var j = 0; j < count; j++) {
    let a = lvPrims[j * ${OBJECT_ROWS}]; let b = lvPrims[j * ${OBJECT_ROWS} + 1];
    let w = p - a.yzw;
    let q = vec3f(dot(lvPrims[j * ${OBJECT_ROWS} + 4].xyz, w), dot(lvPrims[j * ${OBJECT_ROWS} + 5].xyz, w), dot(lvPrims[j * ${OBJECT_ROWS} + 6].xyz, w));
    let od = lvShape(j, a.x, q, b.xyz);
    if (od < d) { d = od; obj = f32(j); }
  }
  return vec4f(d, r.core.y / max(lvLive.f.w, 1.0), r.core.z, obj);
}

@compute @workgroup_size(64)
fn trace(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(lvLive.a.x)) { return; }
  let i = lvIndex(id.x);
  let ray = lvRays[i];
  var hit : LvHit; hit.t = -1.0; hit.vis = 1.0; hit.obj = -1.0;
  if (ray.kind < 0.5) { lvHits[i] = hit; return; }
  let shadow = ray.kind > 1.5 && ray.kind < 2.5;
  var most = i32(u.march.z);
  if (shadow) { most = i32(u.extra.w); } else if (ray.kind > 2.5) { most = i32(lvLive.d.y); }
  let tet = array<vec3f, 4>(vec3f(1.0, -1.0, -1.0), vec3f(-1.0, -1.0, 1.0), vec3f(-1.0, 1.0, -1.0), vec3f(1.0, 1.0, 1.0));
  // camera rays start at the exact camera position (high part from the ray, low part from lvLive.f); other rays start at a hit point, known to 32 bits only
  let low = select(vec3f(0.0), lvLive.f.xyz, ray.kind < 1.5);
  let origin = DSP(vec2f(ray.o.x, low.x), vec2f(ray.o.y, low.y), vec2f(ray.o.z, low.z));
  var phase = 0; var t = 0.0; var steps = 0; var res = 1.0;
  var pd = origin; var hp = origin; var p = ray.o; var thr = lvHitThreshold(ray.x.x, p); var eps = 0.0; var grad = vec3f(0.0); var found = vec4f(0.0);
  var nrm = vec3f(0.0); var occ = 0.0; let reach = u.ao.y * 0.25;
  for (var k = 0; k < most + 9; k++) {
    if (phase == 0) { pd = lvAdd(origin, ray.d * t); thr = lvHitThreshold(ray.x.x + t, ray.o + ray.d * t); }
    else if (phase < 5) { pd = lvAdd(hp, tet[phase - 1] * eps); }
    else { pd = lvAdd(hp, nrm * (reach * f32(phase - 4))); }
    let r = lvSceneDs(pd);
    if (phase == 0) {
      steps++;
      let spent = steps >= most;
      if (r.x < thr || (spent && !shadow && r.x < 40.0 * thr)) {
        if (shadow) { res = 0.0; break; }
        let here = ray.o + ray.d * t + low; let measures = lvMeasures(here, thr);
        found = vec4f(r.x, measures.x, measures.y, r.w); hp = pd; eps = lvNormalStep(ray.x.x + t, ray.o + ray.d * t); phase = 1; continue;
      }
      if (shadow) { res = min(res, ray.x.y * r.x / max(t, 1e-6)); }
      t += r.x * u.march.y;
      if (t > ray.tmax || spent) { break; }
    } else if (phase < 5) {
      grad += tet[phase - 1] * r.x; phase++;
      if (phase > 4) {
        nrm = normalize(grad + vec3f(1e-30)); if (dot(nrm, ray.d) > 0.0) { nrm = -nrm; }
        if (u.ao.x <= 0.0 || reach <= 0.0) { phase = 9; break; }
      }
    } else {
      let far = reach * f32(phase - 4);
      occ += clamp((far - r.x) / far, 0.0, 1.0); phase++;
      if (phase > 8) { break; }
    }
  }
  if (shadow) { hit.vis = clamp(res, 0.0, 1.0); }
  else if (phase > 4) { hit.t = t; hit.n = nrm; hit.m = found.yz; hit.obj = found.w; hit.vis = clamp(1.0 - u.ao.x * occ * 0.4, 0.0, 1.0); }
  lvHits[i] = hit;
}
`;
}

/** No formula in here: built once. Everything it needs comes from buffers. The material, texture and gradient-material functions are the final renderer's own (shader.ts, surfaceDetailWgsl.ts, materialTexturesWgsl.ts), so the same rules decide what a surface looks like. */
const SHADE_SOURCE = /* wgsl */ `${UNIFORMS}${STRUCTS}
struct LvPath { thr : vec3f, alive : f32, rad : vec3f, tc : f32, p0 : vec3f, f0 : f32, p1 : vec3f, f1 : f32, med : vec4f };   // med: (index of the glass object the ray is inside + 1 or 0, its absorption per unit of distance)
struct LvMat { base : vec3f, metallic : f32, rough : f32, refl : f32, emission : vec3f };
// The final renderer's surface-detail and texture code reads the object that was hit from primitiveStore (rows of its inverse matrix) and surfaceIndex; here that store holds only the one object being shaded.
struct LvPrimLite { inverse : array<vec4f, 3>, identity : vec4f };
struct LvStoreLite { objects : array<LvPrimLite, 32> };
var<private> primitiveStore : LvStoreLite;
var<private> surfaceIndex : i32 = -1;
@group(0) @binding(1) var<storage, read_write> lvRays : array<LvRay>;
@group(0) @binding(2) var<storage, read> lvHits : array<LvHit>;
@group(0) @binding(3) var<uniform> lvLive : LvLive;
@group(0) @binding(4) var<storage, read> lvPrims : array<vec4f>;
@group(0) @binding(5) var tex : texture_2d<f32>;
@group(0) @binding(6) var samp : sampler;
@group(0) @binding(7) var<storage, read_write> lvPaths : array<LvPath>;
@group(0) @binding(8) var<storage, read_write> lvSum : array<vec4f>;
@group(0) @binding(9) var lvOut : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(17) var<storage, read_write> lvGuide : array<vec4f>;   // what the first surface of each pixel is (distance, normal): the denoise filter keeps edges with it
@group(0) @binding(10) var envTex : texture_2d<f32>;
@group(0) @binding(11) var envSamp : sampler;

${MATERIAL_FUNCTIONS}
fn pixelSize(t : f32) -> f32 { return lvPixel(t); }
fn precisionFloor(p : vec3f) -> f32 { return lvFloor(p); }
fn lvSky(d : vec3f) -> vec3f { return skyGradient(d); }
// What the colour measure says about a surface point. core = (distance, iterations as a share of the most, orbit trap); the cavity measure is read from the occlusion.
fn measureValue(which : i32, core : vec3f, p : vec3f, n : vec3f, steps : i32) -> f32 {
  var m = 0.0;
  if (which == 0) { m = core.y; }
  else if (which == 1) { m = core.z * 0.5; }
  else if (which == 2) { m = 0.5 + 0.5 * n.y; }
  else if (which == 3) { m = min(f32(steps) / 120.0, 1.0); }
  else { m = length(p) * 0.5; }
  return m;
}
fn gradientColor(x : f32) -> vec3f {
  var t = x;
  if (u.color.w > 0.5) { let m = t - 2.0 * floor(t * 0.5); t = 1.0 - abs(1.0 - m); } else { t = fract(t); }
  let f = clamp(t, 0.0, 1.0) * ${LUT_SIZE - 1}.0; let i = u32(floor(f)); let j = min(i + 1u, ${LUT_SIZE - 1}u);
  return mix(u.lut[i].rgb, u.lut[j].rgb, f - floor(f));
}
// The colour picture of the Colour tab (strength, scale and mapping from the scene), in linear light.
fn textureColor(p : vec3f, n : vec3f) -> vec3f {
  let s = u.texture.y;
  var c = vec3f(0.0);
  if (u.texture.z > 0.5) {
    let r = max(length(p), 0.000001);
    let uv = vec2f(atan2(p.z, p.x) / 6.2831853 + 0.5, acos(clamp(p.y / r, -1.0, 1.0)) / 3.1415927);
    c = textureSampleLevel(tex, samp, uv * s, 0.0).rgb;
  } else {
    var w = pow(abs(n), vec3f(4.0));
    w = w / (w.x + w.y + w.z);
    c = textureSampleLevel(tex, samp, p.yz * s, 0.0).rgb * w.x + textureSampleLevel(tex, samp, p.xz * s, 0.0).rgb * w.y + textureSampleLevel(tex, samp, p.xy * s, 0.0).rgb * w.z;
  }
  return pow(c, vec3f(2.2));
}
fn surfaceBaseColorWith(core : vec3f, p : vec3f, n : vec3f, steps : i32) -> vec3f {
  let m = measureValue(i32(u.color.x + 0.5), core, p, n, steps);
  var base = gradientColor(m * u.color.y + u.color.z);
  if (u.texture.x > 0.0) { base = mix(base, textureColor(p, n), u.texture.x); }
  return base;
}
// The fractal's surface: colour (gradient, picture, texture maps), metallic, roughness, reflectivity and emission, with the maps and the gradient's materials applied.
// Object j of the buffer becomes the object being shaded: its inverse matrix (turn, size, position) and its type, and its surface slot (its place among all objects).
fn lvLoadObject(j : i32) {
  let k = j * ${OBJECT_ROWS}; let a = lvPrims[k]; let b = lvPrims[k + 1]; let r0 = lvPrims[k + 4]; let r1 = lvPrims[k + 5]; let r2 = lvPrims[k + 6];
  let slot = i32(r0.w);
  primitiveStore.objects[slot].inverse[0] = vec4f(r0.xyz / b.x, -dot(r0.xyz, a.yzw) / b.x);
  primitiveStore.objects[slot].inverse[1] = vec4f(r1.xyz / b.y, -dot(r1.xyz, a.yzw) / b.y);
  primitiveStore.objects[slot].inverse[2] = vec4f(r2.xyz / b.z, -dot(r2.xyz, a.yzw) / b.z);
  primitiveStore.objects[slot].identity = vec4f(1.0, a.x, 0.0, 0.0);
  surfaceIndex = slot;
}
// Match the primary diffuse orbit control; keep the original base for metallic/specular reflection.
fn lvDiffuseColor(core : vec3f, p : vec3f, n : vec3f, steps : i32) -> vec3f {
  let m = measureValue(i32(u.color.x + 0.5), core, p, n, steps);
  var base = mix(u.tuneColor.xyz, gradientColor(m * u.color.y + u.color.z), u.tune.x);
  if (u.texture.x > 0.0) { base = mix(base, textureColor(p, n), u.texture.x); }
  return pbrBase(base * materialData(0u).rgb);
}
fn lvFractalMaterial(core : vec3f, p : vec3f, n : vec3f, steps : i32) -> LvMat {
  var m : LvMat;
  m.base = surfaceBaseColorWith(core, p, n, steps)*materialData(0u).rgb;
  m.metallic = matValue(0, core, p, n, steps);
  m.rough = matValue(1, core, p, n, steps);
  m.refl = matValue(2, core, p, n, steps);
  m.emission = materialEmission();
  return m;
}
// The environment picture's diffuse light, read like the final renderer reads it (same uniforms).
fn lvEnvUv(d : vec3f) -> vec2f { let az = atan2(d.x, -d.z) - u.env.z; return vec2f(az / 6.283185307 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.141592654); }
fn lvEnvDiffuse(n : vec3f) -> vec3f {
  let c = cos(-u.env.z); let s = sin(-u.env.z);
  let m = vec3f(n.x * c - n.z * s, n.y, n.z * c + n.x * s);
  let e = u.envsh[0].rgb + u.envsh[1].rgb * m.x + u.envsh[2].rgb * m.y + u.envsh[3].rgb * m.z
    + u.envsh[4].rgb * (m.x * m.y) + u.envsh[5].rgb * (m.y * m.z) + u.envsh[6].rgb * (m.x * m.z)
    + u.envsh[7].rgb * (m.x * m.x - m.y * m.y) + u.envsh[8].rgb * (m.z * m.z);
  return max(e, vec3f(0.0)) * (u.env.y / 3.141592654);
}
// What a ray that hits nothing sees: the picture when it is set to be seen, otherwise the gradient sky.
fn lvBackground(d : vec3f) -> vec3f {
  if (u.env.x > 0.5 && u.env.w > 0.5) { return textureSampleLevel(envTex, envSamp, lvEnvUv(d), 0.0).rgb * u.env.y; }
  return skyGradient(d);
}
fn lvRand(s : ptr<function, u32>) -> f32 { *s = *s * 747796405u + 2891336453u; let w = ((*s >> ((*s >> 28u) + 4u)) ^ *s) * 277803737u; return f32((w >> 22u) ^ w) / 4294967296.0; }

@compute @workgroup_size(64)
fn gen(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(lvLive.a.x)) { return; }
  let i = lvIndex(id.x); let n = u32(lvLive.e.z);
  let w = u32(lvLive.a.y);
  let px = vec2f(f32(i % w), f32(i / w)) + vec2f(0.5) + lvLive.d.zw;
  let ndc = px / lvLive.a.yz * 2.0 - vec2f(1.0);
  // the camera exactly as the final renderer sets it up: perspective, orthographic, and a thin lens for depth of field (the lens point changes with every sample)
  let across = u.right.xyz * (ndc.x * lvLive.a.y / lvLive.a.z) - u.up.xyz * ndc.y;
  var origin = u.camPos.xyz;
  var dir = normalize(u.forward.xyz + across * u.view.z);
  if (u.cameraEffects.x > 0.0) {
    origin += across * (u.cameraEffects.x * 0.5);
    dir = u.forward.xyz;
  } else if (u.cameraEffects.y > 0.0 && any(u.lensSample.xy != vec2f(0.0))) {
    let focus = origin + dir * u.cameraEffects.z / max(0.000001, dot(dir, u.forward.xyz));
    origin += (u.right.xyz * u.lensSample.x + u.up.xyz * u.lensSample.y) * u.cameraEffects.y;
    dir = normalize(focus - origin);
  }
  lvRays[i] = LvRay(origin, u.march.w, dir, 1.0, vec4f(0.0));
  lvRays[i + n].kind = 0.0; lvRays[i + 2u * n].kind = 0.0;
  lvPaths[i] = LvPath(vec3f(1.0), 1.0, vec3f(0.0), 0.0, vec3f(0.0), 0.0, vec3f(0.0), 0.0, vec4f(0.0));
}

@compute @workgroup_size(64)
fn shade(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(lvLive.a.x)) { return; }
  let i = lvIndex(id.x); let count = u32(lvLive.e.z);
  var path = lvPaths[i];
  // the shadow rays asked for last time have come back: the light they stood for is now added, dimmed by what was in the way
  path.rad += path.p0 * lvHits[i + count].vis + path.p1 * lvHits[i + 2u * count].vis;
  path.p0 = vec3f(0.0); path.p1 = vec3f(0.0);
  lvRays[i + count].kind = 0.0; lvRays[i + 2u * count].kind = 0.0;
  if (path.alive > 0.5) {
    let ray = lvRays[i]; let h = lvHits[i];
    if (lvLive.b.x < 0.5) { path.f0 = select(h.t, -1.0, h.t < 0.0); lvGuide[i] = select(vec4f(h.t, h.n), vec4f(-1.0, 0.0, 0.0, 0.0), h.t < 0.0); } // how far the first surface is (the fog needs it) and what it is (the denoise filter needs it)
    if (h.t < 0.0) { path.rad += path.thr * select(lvBackground(ray.d), environmentSpecular(ray.d, path.f1), lvLive.b.x > 0.5); path.alive = 0.0; lvRays[i].kind = 0.0; }
    else {
      let p = ray.o + ray.d * h.t; let tc = path.tc + h.t;
      if (path.med.x > 0.5) { path.thr *= exp(-path.med.yzw * h.t); } // inside glass the light is dimmed by the distance travelled (Beer-Lambert)
      var geometric = h.n; if (dot(geometric, ray.d) > 0.0) { geometric = -geometric; }
      var n = geometric;
      let view = -ray.d;
      var m : LvMat; m.base = vec3f(0.8); m.rough = 1.0;
      var openness = h.vis;
      var trans = 0.0; var ior = 1.5; var sigma = vec3f(0.0);
      if (h.obj > -0.5) {
        let k = i32(h.obj) * ${OBJECT_ROWS}; let b = lvPrims[k + 1]; let c = lvPrims[k + 2]; let e = lvPrims[k + 3];
        m.base = c.rgb; m.metallic = c.w; m.rough = b.w; m.refl = e.w; m.emission = e.rgb;
        // the object's own maps (colour, roughness, metal, occlusion, emission), bump and normal maps and procedural detail, with the final renderer's code
        lvLoadObject(i32(h.obj));
        let glass = lvPrims[k + 7]; let tint = lvPrims[k + 8]; trans = glass.x; ior = glass.y; sigma = -log(max(tint.rgb, vec3f(1e-6))) * glass.z;
        n = surfaceShadingNormal(p, geometric, geometric, view, tc, false);
        m.base = pbrBase(m.base); m.metallic = pbrScalar(2u, m.metallic); m.rough = pbrScalar(1u, m.rough); m.emission = pbrEmission(m.emission);
        openness = h.vis * pbrAO();
      } else {
        // the fractal: bump and normal maps change the shading normal, texture maps and gradient materials the colour, metal, roughness and occlusion
        let core = vec3f(0.0, h.m.x, h.m.y);
        let steps = i32((1.0 - h.vis) * 120.0);
        n = surfaceShadingNormal(p, geometric, geometric, view, tc, false);
        m = lvFractalMaterial(core, p, n, steps);
        openness = h.vis * pbrAO();
      }
      let rough = clamp(m.rough, 0.03, 1.0); let alpha = rough * rough;
      var diffuseBase = m.base;
      if (h.obj < -0.5 && lvLive.b.x < 0.5 && u.tune.x < 1.0) {
        diffuseBase = lvDiffuseColor(vec3f(0.0, h.m.x, h.m.y), p, n, i32((1.0 - h.vis) * 120.0));
      }
      let f0 = mix(vec3f(0.04), m.base, m.metallic); let diffuseColor = diffuseBase * (1.0 - m.metallic) * (1.0 - trans);
      var light = (u.ambient.rgb * openness) * diffuseColor + m.emission;
      if (u.env.x > 0.5) { light += lvEnvDiffuse(n) * openness * diffuseColor; }
      let hitThr = lvHitThreshold(tc, p);
      var slot = 0;
      let lightCount = i32(u.ambient.w);
      for (var l = 0; l < lightCount; l++) {
        let a = u.lights[l * 4]; let b = u.lights[l * 4 + 1]; let c = u.lights[l * 4 + 2]; let d = u.lights[l * 4 + 3];
        var toLight = -b.xyz; var weaken = 1.0; var tmax = u.march.w;
        if (a.w > 0.5) { let v = a.xyz - p; let dist = length(v); toLight = v / max(dist, 1e-6); weaken = 1.0 / max(dist * dist, 1e-4); tmax = dist; if (a.w > 1.5) { weaken *= smoothstep(d.x, d.y, dot(-toLight, b.xyz)); } }
        let nl = max(dot(n, toLight), 0.0);
        if (nl <= 0.0 || weaken <= 0.0 || dot(geometric, toLight) <= 0.0) { continue; }
        let hv = normalize(view + toLight); let nh = max(dot(n, hv), 0.0); let vh = max(dot(view, hv), 0.0); let nv = max(dot(n, view), 1e-4);
        let fres = f0 + (vec3f(1.0) - f0) * pow(1.0 - vh, 5.0);
        let part = path.thr * c.rgb * (weaken * nl) * (diffuseColor * mix(1.0, openness, 0.6) + fres * (3.141592654 * ggxD(nh, alpha) * smithV(nv, nl, alpha)));
        if (b.w > 0.5 && lvLive.b.z > 0.5 && slot < 2) {
          let ks = select(1e9, c.w, b.w > 1.5);
          lvRays[i + count * u32(slot + 1)] = LvRay(p + geometric * (6.0 * hitThr), tmax, toLight, 2.0, vec4f(tc, ks, 0.0, 0.0));
          if (slot == 0) { path.p0 = part; } else { path.p1 = part; }
          slot++;
        } else { path.rad += part; }
      }
      path.rad += path.thr * light;
      // the mirror part: a new ray for the next round, or the environment when the bounces are used up
      let nv = max(dot(n, view), 1e-4);
      let ks = (f0 + (vec3f(1.0) - f0) * pow(1.0 - nv, 5.0)) * max(m.refl, m.metallic);
      var seed = (i * 9781u + u32(lvLive.a.w) * 6271u + u32(lvLive.b.x) * 26699u) | 1u;
      let z = lvRand(&seed) * 2.0 - 1.0; let ang = lvRand(&seed) * 6.2831853; let rr = sqrt(max(0.0, 1.0 - z * z));
      var dir = normalize(reflect(ray.d, n) + vec3f(rr * cos(ang), rr * sin(ang), z) * (alpha * 0.95));
      if (dot(dir, geometric) < 0.0) { dir = reflect(dir, geometric); }
      if (trans > 0.0 && lvLive.b.x < lvLive.b.w - 0.5) {
        // glass: the ray is either mirrored or bent into (or out of) the object, chosen by the Fresnel reflectance, so the picture averages to the right mix
        let inside = path.med.x > 0.5; let eta = select(1.0 / ior, ior, inside); let cosi = clamp(dot(geometric, view), 0.0, 1.0);
        let k = 1.0 - eta * eta * (1.0 - cosi * cosi); let fg = pow((ior - 1.0) / (ior + 1.0), 2.0);
        let fres = select(fg + (1.0 - fg) * pow(1.0 - cosi, 5.0), 1.0, k < 0.0);
        var gdir : vec3f; var origin : vec3f; var medium = path.med;
        if (lvRand(&seed) < fres) { gdir = reflect(ray.d, geometric); origin = p + geometric * (6.0 * hitThr); }
        else {
          gdir = normalize(eta * ray.d + (eta * cosi - sqrt(max(k, 0.0))) * geometric); origin = p - geometric * (6.0 * hitThr);
          medium = select(vec4f(h.obj + 1.0, sigma), vec4f(0.0), inside);
        }
        let jittered = normalize(gdir + vec3f(rr * cos(ang), rr * sin(ang), z) * (alpha * 0.95));
        if (dot(jittered, geometric) * dot(gdir, geometric) > 0.0) { gdir = jittered; } // frosted glass: only a little scatter, never to the wrong side
        path.med = medium; path.tc = tc; path.f1 = rough;
        lvRays[i] = LvRay(origin, u.march.w, gdir, 3.0, vec4f(tc, 0.0, medium.x, 0.0));
      } else if (max(ks.x, max(ks.y, ks.z)) > 0.01 && lvLive.b.x < lvLive.b.w - 0.5) {
        path.thr *= ks; path.tc = tc; path.f1 = rough;
        lvRays[i] = LvRay(p + geometric * (6.0 * hitThr), u.march.w, dir, 3.0, vec4f(tc, 0.0, 0.0, 0.0));
      } else {
        path.rad += path.thr * ks * environmentSpecular(dir, rough);
        path.alive = 0.0; lvRays[i].kind = 0.0;
      }
    }
  }
  lvPaths[i] = path;
}

fn lvDisplay(radiance : vec3f) -> vec3f {
  var c = max(radiance, vec3f(0.0)) * exp2(u.display.x);
  if (u.display.y > 1.5) { c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); } else if (u.display.y > 0.5) { c = c / (vec3f(1.0) + c); }
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  if (u.display.z > 0.5) { c = select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308)); } else { c = pow(c, vec3f(1.0 / 2.2)); }
  return c;
}
// Noise reduction (the scene's Brusreducering): a 5x5 joint bilateral filter over the samples so far, guided by the first surface's distance and normal and by the colour itself, so edges, silhouettes and bright highlights stay. It filters less the more samples the picture has.
@compute @workgroup_size(64)
fn denoise(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(lvLive.a.x)) { return; }
  let i = lvIndex(id.x); let w = i32(lvLive.a.y); let h = i32(lvLive.a.z); let x = i32(i) % w; let y = i32(i) / w;
  let g = lvGuide[i]; let centre = lvSum[i];
  if (g.x < 0.0 || centre.w < 0.5) { return; }
  let cc = centre.rgb / centre.w; let sigma = max(lvPixel(g.x) * 1.5, 1e-6);
  var acc = vec3f(0.0); var total = 0.0;
  for (var dy = -2; dy <= 2; dy++) { for (var dx = -2; dx <= 2; dx++) {
    let j = u32(clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)); let q = lvGuide[j];
    if (q.x < 0.0) { continue; }
    let nd = dot(g.yzw, q.yzw); let dz = abs(g.x - q.x);
    if (nd < 0.9 || dz > sigma * 4.0) { continue; }
    let sj = lvSum[j]; if (sj.w < 0.5) { continue; }
    let c = sj.rgb / sj.w; let diff = (c - cc) / max(1.0, max(max(c.r, max(c.g, c.b)), max(cc.r, max(cc.g, cc.b))));
    let weight = exp(-f32(dx * dx + dy * dy) / 4.0 - dz * dz / (sigma * sigma) - (1.0 - nd) * 30.0 - dot(diff, diff) / 0.35);
    acc += c * weight; total += weight;
  } }
  let blend = clamp(1.0 - centre.w / 24.0, 0.25, 0.85);
  textureStore(lvOut, vec2i(x, y), vec4f(lvDisplay(mix(cc, acc / max(total, 1e-8), blend)), 1.0));
}

@compute @workgroup_size(64)
fn resolve(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(lvLive.a.x)) { return; }
  let i = lvIndex(id.x); let n = u32(lvLive.e.z);
  let path = lvPaths[i];
  var rad = min(path.rad + path.p0 * lvHits[i + n].vis + path.p1 * lvHits[i + 2u * n].vis, vec3f(6.0)); // a single very bright sample (a small strong light in a picture) would show as a firefly: the preview is kept calm
  if (u.fog.x > 0.0) {
    // fog by the distance of the first surface, as in the final renderer (u.fog: density, start, squared form, whether the sky is fogged too)
    var amount = 0.0;
    if (path.f0 < 0.0) { amount = select(0.0, 1.0, u.fog.w > 0.5); }
    else { let x = max(path.f0 - u.fog.y, 0.0) * u.fog.x; amount = 1.0 - exp(select(-x, -(x * x), u.fog.z > 0.5)); }
    rad = mix(rad, u.fogColor.rgb, amount);
  }
  var sum = vec4f(rad, 1.0);
  if (lvLive.a.w > 0.5) { sum += lvSum[i]; }
  lvSum[i] = sum;
  let c = lvDisplay(sum.rgb / sum.w);
  let w = u32(lvLive.a.y);
  textureStore(lvOut, vec2i(i32(i % w), i32(i / w)), vec4f(c, 1.0));
}
`;
/** The shading kernels with the final renderer's procedural detail, surface maps and gradient materials added (proceduralDetailWgsl.ts, surfaceDetailWgsl.ts, materialTexturesWgsl.ts). */
const PROCEDURAL = integrateProceduralDetail(SHADE_SOURCE, surfaceWgsl.replace('DETAIL_SLOT', 'u32(surfaceIndex + 1)').replace('DETAIL_OBJECT_TRANSFORM', DETAIL_OBJECT_TRANSFORM));
export const SHADE_KERNELS = integrateMaterialTextures(PROCEDURAL.shader + '\n' + PROCEDURAL.surface, true, true);

export interface LiveState { shadows: boolean; bounces: number; displacement: number; displacementScale: number; texture: number; textureScale: number; }
export const MAX_BOUNCES = 4, MAX_OBJECTS = 32;
/**
 * The scale of the Float32 floor (see precisionFloor.ts) when the scene does not set one. The floor only decides when the pixel is smaller than it: in a deep zoom.
 * A quarter of the final renderer's floor lets the camera get about four times closer to a surface before 32-bit numbers can no longer tell it from noise.
 */
export const DEFAULT_FLOOR_SCALE = 0.25;
const number = (x: unknown, fallback: number): number => typeof x === 'number' && Number.isFinite(x) ? x : fallback;
const colour = (c: unknown, fallback: number[]): number[] => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((k) => Math.pow(parseInt(c.slice(k, k + 2), 16) / 255, 2.2)) : Array.isArray(c) && c.length >= 3 ? c.slice(0, 3).map((v) => number(v, 0)) : fallback;

/** The objects of a scene as rows of numbers (see OBJECT_ROWS). An object whose material is "scene" takes the fractal's metallic, roughness and reflectivity numbers. */
export function packLiveObjects(scene: Pick<Scene, 'primitives' | 'material'> & Partial<Pick<Scene, 'transport' | 'cutout'>>): { data: Float32Array; count: number } {
  const all = scene.primitives ?? [], list = all.filter((p) => p.enabled !== false).slice(0, MAX_OBJECTS), data = new Float32Array(OBJECT_ROWS * 4 * MAX_OBJECTS);
  const sceneMaterial = scene.material as unknown as Record<string, unknown>;
  list.forEach((p: ScenePrimitive, i) => {
    const own = p.material === 'scene' ? undefined : p.material as unknown as Record<string, unknown>, m = own ?? sceneMaterial ?? {};
    const emission = colour(m.emissionColor, [0, 0, 0]), strength = number(m.emissionStrength, 0);
    const turn = primitiveInverse({ ...p, scale: [1, 1, 1] }).map((row) => row.slice(0, 3)); // rotation only: the size is applied in the distance itself
    data.set([['sphere', 'box', 'plane'].indexOf(p.type), ...p.position,
      ...p.scale, number(m.roughness, 0.5),
      ...colour(own?.baseColor ?? p.color, [0.65, 0.65, 0.65]), number(m.metallic, 0),
      emission[0]! * strength, emission[1]! * strength, emission[2]! * strength, number(m.reflectivity, 0),
      ...turn[0]!, all.indexOf(p), ...turn[1]!, 0, ...turn[2]!, 0], i * OBJECT_ROWS * 4);
    // glass, as in the final renderer: only with the transport switched on, for closed shapes (not planes) that are not fully metal, and not while clip planes are open
    const glass = !!scene.transport?.enabled && !scene.cutout?.planes?.some((q) => q.enabled) && p.type !== 'plane' && number(m.transmission, 0) > 0 && number(m.metallic, 0) < 1;
    const absorption = colour(m.absorptionColor, [1, 1, 1]);
    data.set([glass ? number(m.transmission, 0) : 0, number(m.ior, 1.5), number(m.absorptionDensity, 0), 0, ...absorption, 0], i * OBJECT_ROWS * 4 + 28);
  });
  return { data, count: list.length };
}
/** True when some object of the scene is drawn as glass (the deep kernel has no refraction and steps aside). */
export function hasLiveGlass(scene: Pick<Scene, 'primitives' | 'material'> & Partial<Pick<Scene, 'transport' | 'cutout'>>): boolean {
  const { data, count } = packLiveObjects(scene);
  for (let j = 0; j < count; j++) if (data[j * OBJECT_ROWS * 4 + 28]! > 0) return true;
  return false;
}

/** What the scene asks for that Live LookDev 2 does not draw (yet): said in the picture's label, so nobody takes the picture for the whole truth. */
export function liveUnsupported(scene: Scene): string[] {
  const out: string[] = [];
  // displacement is geometry of own spheres and planes (not of the fractal), exactly as in the final renderer; a request that finds no such object changes nothing there either
  if (!displacementActive(scene) && [scene.material, ...(scene.primitives ?? []).map((p) => p.material === 'scene' ? scene.material : p.material)].some(displacementRequested)) out.push('displacement only applies to own spheres and planes');
  if (scene.transport?.enabled && (scene.primitives ?? []).some((p) => p.enabled !== false && p.type === 'plane' && (p.material === 'scene' ? scene.material : p.material).transmission)) out.push('planes as glass are not drawn');
  return out;
}
/** How near the surface (in floors) the deep kernel is wanted: built from FLOORS_BUILD, used from FLOORS_USE, dropped again beyond FLOORS_DROP (so it does not flicker between the two). */
export const DEEP_FLOORS_BUILD = 60, DEEP_FLOORS_USE = 12, DEEP_FLOORS_DROP = 40;
/** The floor of the ordinary kernel at a surface point, as set for this scene. */
export function floatFloor(position: readonly number[], quality: Pick<Scene['render']['quality'], 'precision_floor'>): number { return floorAt(position) * (quality.precision_floor ?? DEFAULT_FLOOR_SCALE); }
/** True when even double-single numbers (about 14 digits, 4e-14 at the scale 1) can no longer tell the surface from noise. */
export function atDeepLimit(distance: number, position: readonly number[]): boolean { return distance < 60 * 4e-14 * (1 + Math.hypot(position[0]!, position[1]!, position[2]!)); }
/** True when the camera is so close to the surface that 32-bit numbers can no longer tell the surface from noise (the floor of precisionFloor.ts): the picture stops changing there. */
export function atPrecisionLimit(distance: number, position: readonly number[], quality: Pick<Scene['render']['quality'], 'precision_floor'>): boolean {
  return distance < 2.5 * floorAt(position) * (quality.precision_floor ?? DEFAULT_FLOOR_SCALE);
}

export type LiveFormula = { ok: true; resolved: ResolvedScene; wgsl: string } | { ok: false; errors: string[] };
/** The formula code of a scene (the text that decides whether the trace kernel must be rebuilt) and the scene matched with its formulas. */
export function liveFormula(scene: Scene, formulas: readonly Formula[]): LiveFormula {
  const resolved = resolveScene(scene, formulas); if (!resolved.ok) return { ok: false, errors: resolved.errors };
  const code = generateChain(toChainSteps(resolved), resolved.rounds, { mode: resolved.mode, execution: resolved.execution, dynamicLoops: resolved.dynamicLoops });
  if (!code.ok) return { ok: false, errors: code.errors };
  if (/@binding\(/.test(code.wgsl)) return { ok: false, errors: ['The formula uses its own picture data (field maps), which Create does not support yet.'] };
  return { ok: true, resolved, wgsl: code.wgsl };
}

export class LiveWave {
  private rays!: GPUBuffer; private hits!: GPUBuffer; private paths!: GPUBuffer; private sum!: GPUBuffer; private prims!: GPUBuffer; private uni!: GPUBuffer; private out!: GPUTexture; private read!: GPUBuffer;
  private lives: GPUBuffer[] = []; private texture?: GPUTexture; private sampler!: GPUSampler;
  private guide!: GPUBuffer; private denoisePipe!: GPUComputePipeline; denoiseOn = false; private pickLive!: GPUBuffer; private pickRead!: GPUBuffer; private pickGroup?: GPUBindGroup;
  private displacementBuffer!: GPUBuffer; private surfaceBuffer!: GPUBuffer; private pbrBuffer!: GPUBuffer; private surfaceSampler!: GPUSampler; private atlas?: SurfaceAtlas; private dummyAtlas!: GPUTexture; private atlasKey = ''; private surfaceCount = 0;
  private env?: GPUTexture; private envSampler!: GPUSampler; private envSh: Float32Array | null = null; private envMaxLod = 0;
  private traceLayout!: GPUBindGroupLayout; private shadeLayout!: GPUBindGroupLayout;
  private genPipe!: GPUComputePipeline; private shadePipe!: GPUComputePipeline; private resolvePipe!: GPUComputePipeline; private tracePipe?: GPUComputePipeline;
  private shadeGroups: GPUBindGroup[] = []; private traceGroups: GPUBindGroup[] = [];
  private uniforms = new Float32Array(UNIFORM_FLOATS); private objects = 0;
  /** How many samples the picture on screen holds. Any change of the scene starts again at 0. */
  frame = 0; traceBuilds = 0; shadeBuilds = 0; shadeBuildMs = 0; n = 0;
  /** The size being drawn now; `resize` changes it up to the size given at the start, without building or allocating anything. */
  width: number; height: number;
  state: LiveState = { shadows: true, bounces: 1, displacement: 0, displacementScale: 1, texture: 0, textureScale: 1 };
  constructor(readonly device: GPUDevice, readonly maxWidth: number, readonly maxHeight: number) { this.width = maxWidth; this.height = maxHeight; }

  /** Built once per session: everything except the formula. */
  async init() {
    const d = this.device, n = this.maxWidth * this.maxHeight; this.n = n;
    const S = GPUBufferUsage.STORAGE;
    this.rays = d.createBuffer({ size: 48 * 3 * n, usage: S | GPUBufferUsage.COPY_DST }); this.hits = d.createBuffer({ size: 32 * 3 * n, usage: S | GPUBufferUsage.COPY_SRC });
    this.pickLive = d.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); this.pickRead = d.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.paths = d.createBuffer({ size: 80 * n, usage: S }); this.guide = d.createBuffer({ size: 16 * n, usage: S }); this.sum = d.createBuffer({ size: 16 * n, usage: S });
    this.prims = d.createBuffer({ size: OBJECT_ROWS * 16 * MAX_OBJECTS, usage: S | GPUBufferUsage.COPY_DST });
    this.uni = d.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    for (let i = 0; i < MAX_BOUNCES + 3; i++) this.lives.push(d.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.out = d.createTexture({ size: [this.maxWidth, this.maxHeight], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
    this.read = d.createBuffer({ size: Math.ceil(this.maxWidth * 4 / 256) * 256 * this.maxHeight, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.sampler = d.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' });
    this.envSampler = d.createSampler({ addressModeU: 'repeat', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.env = this.makeEnvTexture(null);
    this.surfaceBuffer = d.createBuffer({ size: SURFACE_SLOTS * 24 * 4, usage: S | GPUBufferUsage.COPY_DST }); this.displacementBuffer = d.createBuffer({ size: 32 * 12 * 4, usage: S | GPUBufferUsage.COPY_DST }); this.pbrBuffer = d.createBuffer({ size: PBR_BUFFER_RECORDS * PBR_RECORD_FLOATS * 4, usage: S | GPUBufferUsage.COPY_DST });
    this.surfaceSampler = d.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.dummyAtlas = d.createTexture({ size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }); d.queue.writeTexture({ texture: this.dummyAtlas }, new Uint8Array([128, 128, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    const C = GPUShaderStage.COMPUTE;
    const common: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 3, visibility: C, buffer: { type: 'uniform' } }, { binding: 4, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 5, visibility: C, texture: {} }, { binding: 6, visibility: C, sampler: {} }];
    this.traceLayout = d.createBindGroupLayout({ entries: [...common, { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 12, visibility: C, texture: { viewDimension: '2d-array' } }, { binding: 13, visibility: C, sampler: {} }, { binding: 16, visibility: C, buffer: { type: 'read-only-storage' } }] });
    this.shadeLayout = d.createBindGroupLayout({ entries: [...common, { binding: 1, visibility: C, buffer: { type: 'storage' } }, { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 7, visibility: C, buffer: { type: 'storage' } }, { binding: 8, visibility: C, buffer: { type: 'storage' } }, { binding: 9, visibility: C, storageTexture: { format: 'rgba8unorm', access: 'write-only' } }, { binding: 10, visibility: C, texture: {} }, { binding: 11, visibility: C, sampler: {} },
      { binding: 12, visibility: C, texture: { viewDimension: '2d-array' } }, { binding: 13, visibility: C, sampler: {} }, { binding: 14, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 15, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 17, visibility: C, buffer: { type: 'storage' } }] });
    const t = performance.now();
    const module = d.createShaderModule({ code: SHADE_KERNELS });
    const compiled = await module.getCompilationInfo(); const problems = compiled.messages.filter((m) => m.type === 'error');
    if (problems.length) throw Error('The shading kernel of Live LookDev 2 did not compile: ' + problems.slice(0, 4).map((m) => 'line ' + m.lineNum + ': ' + m.message).join(' | ').slice(0, 900));
    const layout = d.createPipelineLayout({ bindGroupLayouts: [this.shadeLayout] });
    const pipes = await Promise.all(['gen', 'shade', 'resolve', 'denoise'].map((entryPoint) => d.createComputePipelineAsync({ layout, compute: { module, entryPoint } })));
    this.genPipe = pipes[0]!; this.shadePipe = pipes[1]!; this.resolvePipe = pipes[2]!; this.denoisePipe = pipes[3]!;
    this.shadeBuildMs = Math.round(performance.now() - t); this.shadeBuilds++;
    this.setTexture(new Uint8Array([255, 255, 255, 255]), 1);
  }
  resize(width: number, height: number) {
    width = Math.max(8, Math.min(this.maxWidth, Math.round(width))); height = Math.max(8, Math.min(this.maxHeight, Math.round(height)));
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height; this.n = width * height; this.frame = 0;
    this.uniforms[16] = width; this.uniforms[17] = height; // the picture size inside the engine's uniform block (the pixel size of a hit follows it)
    this.device.queue.writeBuffer(this.uni, 0, this.uniforms as Float32Array<ArrayBuffer>);
  }
  destroy() { for (const b of [this.rays, this.hits, this.paths, this.sum, this.prims, this.uni, this.read, this.pickLive, this.pickRead, ...this.lives]) b?.destroy(); this.out?.destroy(); this.texture?.destroy(); this.env?.destroy(); this.atlas?.texture.destroy(); this.dummyAtlas?.destroy(); this.displacementBuffer?.destroy(); this.surfaceBuffer?.destroy(); this.pbrBuffer?.destroy(); this.tracePipe = undefined; }
  private makeEnvTexture(image: HdrImage | null): GPUTexture {
    const chain = image ? buildMipChain(image) : [{ width: 1, height: 1, data: new Float32Array(3) }];
    this.envMaxLod = chain.length - 1;
    const t = this.device.createTexture({ size: [chain[0]!.width, chain[0]!.height], mipLevelCount: chain.length, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    chain.forEach((level, i) => this.device.queue.writeTexture({ texture: t, mipLevel: i }, toHalfRgba(level) as Uint16Array<ArrayBuffer>, { bytesPerRow: level.width * 8 }, [level.width, level.height]));
    return t;
  }
  /** The environment picture (HDRI) as data: a texture upload and nine light numbers, no shader build. null goes back to the gradient sky. */
  setEnvironment(image: HdrImage | null) {
    const old = this.env;
    this.env = this.makeEnvTexture(image); this.envSh = image ? irradianceCoefficients(image) : null;
    this.groups(); old?.destroy(); this.frame = 0;
  }
  /** A picture used both as colour and as height: swapping it is a texture upload, not a shader build. */
  setTexture(rgba: Uint8Array, size: number) { this.setColorTexture({ width: size, height: size, data: rgba }); }
  /** The scene's colour picture (the Colour tab), or null for none. Strength, scale and mapping come with the scene's numbers. */
  setColorTexture(image: { width: number; height: number; data: Uint8Array } | null) {
    const picture = image ?? { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };
    this.texture?.destroy();
    this.texture = this.device.createTexture({ size: [picture.width, picture.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: this.texture }, picture.data as Uint8Array<ArrayBuffer>, { bytesPerRow: picture.width * 4 }, [picture.width, picture.height]);
    this.groups(); this.frame = 0;
  }
  /**
   * The texture maps and surface maps of the scene's materials (and of the gradient's textured materials) as one picture atlas, built with the final renderer's own
   * code. Only the pictures are prepared here (decoding takes a moment); numbers about them are written by setScene. Nothing here builds a shader.
   * Returns warnings (for example when pictures were reduced to fit).
   */
  async prepareSurfaces(scene: Scene): Promise<string[]> {
    const materials = surfaceMaterials(scene), geometry = displacementActive(scene), active = geometry || materials.some(surfaceDetailActive);
    const images = active ? (geometry ? withDisplacementImages(scene, surfaceImages(materials)) : surfaceImages(materials)) : [];
    const key = geometry + JSON.stringify(images.map((i) => [i.colorSpace, i.data.length, i.data.slice(-64), i.data.slice(0, 64)]));
    if (key === this.atlasKey) return this.atlas?.warnings ?? [];
    const fresh = images.length ? await createSurfaceAtlas(this.device, images, geometry) : undefined;
    const old = this.atlas; this.atlas = fresh; this.atlasKey = key; this.groups(); old?.texture.destroy(); this.frame = 0;
    return fresh?.warnings ?? [];
  }
  private groups() {
    const d = this.device, view = this.texture!.createView();
    const common = (live: GPUBuffer): GPUBindGroupEntry[] => [{ binding: 0, resource: { buffer: this.uni } }, { binding: 1, resource: { buffer: this.rays } }, { binding: 2, resource: { buffer: this.hits } }, { binding: 3, resource: { buffer: live } }, { binding: 4, resource: { buffer: this.prims } }, { binding: 5, resource: view }, { binding: 6, resource: this.sampler }];
    // the trace kernels also read the height maps of displaced objects (atlas, sampler, the numbers about them)
    const traceExtra: GPUBindGroupEntry[] = [{ binding: 12, resource: (this.atlas?.texture ?? this.dummyAtlas).createView({ dimension: '2d-array' }) }, { binding: 13, resource: this.surfaceSampler }, { binding: 16, resource: { buffer: this.displacementBuffer } }];
    this.pickGroup = d.createBindGroup({ layout: this.traceLayout, entries: [...common(this.pickLive), ...traceExtra] });
    this.traceGroups = [this.lives[0]!, this.lives[1]!].map((live) => d.createBindGroup({ layout: this.traceLayout, entries: [...common(live), ...traceExtra] }));
    this.shadeGroups = this.lives.slice(2).map((live) => d.createBindGroup({ layout: this.shadeLayout, entries: [...common(live), { binding: 7, resource: { buffer: this.paths } }, { binding: 8, resource: { buffer: this.sum } }, { binding: 9, resource: this.out.createView() }, { binding: 10, resource: this.env!.createView() }, { binding: 11, resource: this.envSampler },
      { binding: 12, resource: (this.atlas?.texture ?? this.dummyAtlas).createView({ dimension: '2d-array' }) }, { binding: 13, resource: this.surfaceSampler }, { binding: 14, resource: { buffer: this.surfaceBuffer } }, { binding: 15, resource: { buffer: this.pbrBuffer } }, { binding: 17, resource: { buffer: this.guide } }] }));
  }
  get hasFormula() { return !!this.tracePipe; }
  get hasDeep() { return !!this.deepPipe; }
  /** Builds the deep kernel (see traceKernelDeep). Takes seconds: call it in the background and switch `deepOn` when it is ready. Returns the build time in milliseconds. */
  async setDeepFormula(code: string, iterations: number): Promise<number> {
    const d = this.device, t = performance.now();
    d.pushErrorScope('validation');
    const pipe = await d.createComputePipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.traceLayout] }), compute: { module: d.createShaderModule({ code }), entryPoint: 'trace' } }).catch(() => null);
    const e = await d.popErrorScope(); if (e || !pipe) throw Error((e?.message ?? 'The deep kernel could not be built.').slice(0, 600));
    this.deepPipe = pipe; this.deepIterations = iterations; this.deepBuilds++; this.frame = 0;
    return Math.round(performance.now() - t);
  }
  /** The only build a change of formula needs. The old kernel keeps drawing until the new one is ready. Returns the build time in milliseconds. */
  async setFormula(formulaCode: string): Promise<number> {
    const d = this.device, t = performance.now();
    d.pushErrorScope('validation');
    const pipe = await d.createComputePipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.traceLayout] }), compute: { module: d.createShaderModule({ code: traceKernel(formulaCode) }), entryPoint: 'trace' } }).catch(() => null);
    const e = await d.popErrorScope(); if (e || !pipe) throw Error((e?.message ?? 'The trace kernel could not be built.').slice(0, 600));
    this.tracePipe = pipe; this.traceBuilds++; this.frame = 0;
    return Math.round(performance.now() - t);
  }
  /** Everything else about the scene: numbers written into buffers. */
  setScene(resolved: ResolvedScene, quality: Scene['render']['quality']) {
    const s = resolved.scene, u = this.uniforms; u.fill(0); this.denoiseOn = !!s.denoise?.enabled;
    packUniforms(cameraBasis(s.camera), this.width, this.height, s.camera.fov_degrees, resolved.parameterValues, resolved.colorData, [0, 0], u, { ...quality, step_factor: quality.step_factor * resolved.stepFactor }, [0, 0], s.fog,
      { lights: s.lights, ambient: s.ambient, limit: null }, 'off', { weights: resolved.chainWeights, julia: resolved.julia, loops: resolved.loops }, { settings: s.environment, sh: this.envSh }, { settings: effectiveMaterial(s.color, s.material), maxLod: this.envMaxLod }, 0, { cutout: s.cutout, details: s.details }, { camera: s.camera, sample: [0, 0] });
    u[23] = quality.precision_floor ?? DEFAULT_FLOOR_SCALE; // tile.w: the scale of the Float32 floor
    this.cameraLo = [0, 1, 2].map((k) => s.camera.position[k]! - Math.fround(s.camera.position[k]!)) as [number, number, number];
    const disp = s.display ?? { exposure: 0, toneMapping: 'linear', transfer: 'legacy-gamma' };
    u.set([disp.exposure, ['linear', 'reinhard', 'filmic'].indexOf(disp.toneMapping), disp.transfer === 'srgb' ? 1 : 0, 0], DISPLAY_OFFSET);
    const orbit=s.transport?.enabled?undefined:diffuseOrbitRequest(s.material);
    u.set([orbit?.influence??1,1,0,0,...(orbit?.color??[1,1,1]),0],TUNE_OFFSET);
    u.set(packFractalDisplacement(s.fractalDisplacement), FDISP_OFFSET); // the displacement layers: numbers, so editing them builds nothing
    this.device.queue.writeBuffer(this.uni, 0, u as Float32Array<ArrayBuffer>);
    const packed = packLiveObjects(s);
    this.device.queue.writeBuffer(this.prims, 0, packed.data as Float32Array<ArrayBuffer>); this.objects = packed.count; this.frame = 0;
    // the numbers about the maps (which picture, how strong, how large), always written: a record without a map says "none" (layer -1)
    const materials = surfaceMaterials(s), images = this.atlas?.images ?? [], side = this.atlas?.side ?? 1;
    this.device.queue.writeBuffer(this.surfaceBuffer, 0, packProceduralSurfaceDetails(materials, images, side) as Float32Array<ArrayBuffer>);
    // the displacement of each object, in the order of the objects the kernels see (disabled ones are left out); all zero (off) when there is none
    const shown = (s.primitives ?? []).filter((p) => p.enabled !== false).slice(0, MAX_OBJECTS);
    this.device.queue.writeBuffer(this.displacementBuffer, 0, (this.atlas?.displacement && this.atlas.heightBounds ? packDisplacement({ ...s, primitives: shown }, images, this.atlas.heightBounds) : new Float32Array(32 * 12)) as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(this.pbrBuffer, 0, packMaterialTextures(materials, images, packRampTail(rampTextureTable(s.color.gradient.stops, s.primitives?.length ?? 0))) as Float32Array<ArrayBuffer>);
  }
  /**
   * The surface under a point of the picture (fx, fy in 0-1 across the picture), found with the trace kernel that is already built: one ray, no new shader.
   * The engine's own surface picking builds a heavy shader with the whole formula in it, which can take half a minute on a heavy fractal. `exclude` leaves
   * one object out (the one being moved). The scene's own objects are put back in the same queue order, so a picture drawn next never sees the change.
   */
  async pick(resolved: ResolvedScene, quality: Scene['render']['quality'], fx: number, fy: number, exclude?: string): Promise<SceneHit | null> {
    if (!this.tracePipe || !this.pickGroup) return null;
    const d = this.device, scene = resolved.scene, list = (scene.primitives ?? []).map((p) => p.id === exclude ? { ...p, enabled: false } : p);
    const shown = list.filter((p) => p.enabled !== false).slice(0, MAX_OBJECTS);
    this.setScene({ ...resolved, scene: { ...scene, primitives: list } }, quality);
    const u = this.uniforms, ndcX = Math.min(1, Math.max(0, fx)) * 2 - 1, ndcY = Math.min(1, Math.max(0, fy)) * 2 - 1, tanHalf = u[18]!;
    const dir = [0, 1, 2].map((k) => u[12 + k]! + u[4 + k]! * (ndcX * tanHalf * this.width / this.height) - u[8 + k]! * (ndcY * tanHalf)), length = Math.hypot(...dir);
    const unit = dir.map((v) => v / length), high = [u[0]!, u[1]!, u[2]!], origin = high.map((v, k) => v + this.cameraLo[k]!); // the exact camera position: the high part and what did not fit in 32 bits
    d.queue.writeBuffer(this.rays, 0, new Float32Array([...high, u[MARCH_OFFSET + 3]!, ...unit, 1, 0, 0, 0, 0]));
    d.queue.writeBuffer(this.pickLive, 0, new Float32Array([1, this.width, this.height, 0, 0, 0, 0, 0, this.state.displacement, this.state.displacementScale, 0, 0, this.objects, 160, 0, 0, 0, 1, this.n, 1, this.cameraLo[0]!, this.cameraLo[1]!, this.cameraLo[2]!, this.deepIterations]));
    const enc = d.createCommandEncoder(), pass = enc.beginComputePass(); pass.setPipeline(this.deepOn && this.deepPipe ? this.deepPipe : this.tracePipe); pass.setBindGroup(0, this.pickGroup); pass.dispatchWorkgroups(1); pass.end();
    enc.copyBufferToBuffer(this.hits, 0, this.pickRead, 0, 32); d.queue.submit([enc.finish()]);
    this.setScene(resolved, quality); // the real scene again, queued right behind the pick
    await this.pickRead.mapAsync(GPUMapMode.READ); const v = new Float32Array(this.pickRead.getMappedRange().slice(0)); this.pickRead.unmap();
    if (!(v[3]! >= 0)) return null;
    const object = v[6]! > -0.5 ? shown[Math.round(v[6]!)] : undefined;
    return { hit: true, distance: v[3]!, position: [origin[0]! + unit[0]! * v[3]!, origin[1]! + unit[1]! * v[3]!, origin[2]! + unit[2]! * v[3]!], normal: [v[0]!, v[1]!, v[2]!], objectType: object?.type ?? 'fractal', objectId: object?.id ?? 'fractal', materialId: object && object.material !== 'scene' ? object.id : 'scene' };
  }
  setState(change: Partial<LiveState>) { Object.assign(this.state, change); this.frame = 0; }

  /** The camera position's part that does not fit in 32 bits (the position is the sum of the uniform's high part and this), and the deep kernel. */
  cameraLo: [number, number, number] = [0, 0, 0]; private deepPipe?: GPUComputePipeline; deepOn = false; deepIterations = 1; deepBuilds = 0;
  /** How long the last whole picture took (decides how many bands the next one is cut into). */
  lastDrawMs = 0;
  /**
   * One more sample of the whole picture, drawn in bands of about `bandMs` each so that it can be given up between two bands: `signal` aborted returns -1 quickly (a
   * picture of 300 ms used to block the next camera move for that long). Returns the time the picture took in milliseconds.
   * A band is the same pipeline on a slice of the pixels; every pixel keeps its own sample count, so a picture given up half way costs nothing but the work done.
   */
  async draw(signal?: AbortSignal, bandMs = 40): Promise<number> {
    if (!this.tracePipe) throw Error('no formula yet');
    const d = this.device, n = this.n, s = this.state, t = performance.now();
    const jx = this.frame ? ((this.frame * 0.754877666) % 1) - 0.5 : 0, jy = this.frame ? ((this.frame * 0.569840291) % 1) - 0.5 : 0;
    const bounces = Math.max(0, Math.min(MAX_BOUNCES, Math.round(s.bounces)));
    const lens = lensSample(this.frame); // the first sample is sharp, the others look through other points of the lens: the blur builds up as samples are added
    d.queue.writeBuffer(this.uni, (OPTICS_OFFSET + 4) * 4, new Float32Array([lens[0], lens[1], 0, 0]));
    const bands = n < 40000 ? 1 : Math.max(1, Math.min(24, Math.ceil(this.lastDrawMs / bandMs)));
    const per = Math.ceil(n / bands);
    for (let band = 0; band < bands; band++) {
      const base = band * per, count = Math.min(per, n - base); if (count <= 0) break;
      const live = (threads: number, bounce: number, regions: number) => new Float32Array([threads, this.width, this.height, this.frame, bounce, 0, s.shadows ? 1 : 0, bounces, s.displacement, s.displacementScale, s.texture, s.textureScale, this.objects, 160, jx, jy, base, count, n, regions, this.cameraLo[0]!, this.cameraLo[1]!, this.cameraLo[2]!, this.deepIterations]);
      d.queue.writeBuffer(this.lives[0]!, 0, live(count, 0, 1)); d.queue.writeBuffer(this.lives[1]!, 0, live(3 * count, 0, 3));
      for (let b = 0; b <= MAX_BOUNCES; b++) d.queue.writeBuffer(this.lives[2 + b]!, 0, live(count, b, 1));
      const trace = this.deepOn && this.deepPipe ? this.deepPipe : this.tracePipe!;
    const enc = d.createCommandEncoder(), groups = Math.ceil(count / 64);
      const run = (pipe: GPUComputePipeline, group: GPUBindGroup, threads: number) => { const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(threads / 64)); pass.end(); };
      run(this.genPipe, this.shadeGroups[0]!, count);
      run(trace, this.traceGroups[0]!, count);
      for (let b = 0; b <= bounces; b++) { run(this.shadePipe, this.shadeGroups[b]!, count); run(trace, this.traceGroups[1]!, 3 * count); }
      run(this.resolvePipe, this.shadeGroups[0]!, count);
      void groups;
      d.queue.submit([enc.finish()]);
      await d.queue.onSubmittedWorkDone();
      if (signal?.aborted) return -1;
    }
    if (this.denoiseOn) {
      const full = new Float32Array([n, this.width, this.height, this.frame, 0, 0, s.shadows ? 1 : 0, bounces, s.displacement, s.displacementScale, s.texture, s.textureScale, this.objects, 160, jx, jy, 0, n, n, 1, this.cameraLo[0]!, this.cameraLo[1]!, this.cameraLo[2]!, this.deepIterations]);
      d.queue.writeBuffer(this.lives[2]!, 0, full);
      const enc = d.createCommandEncoder(), pass = enc.beginComputePass(); pass.setPipeline(this.denoisePipe); pass.setBindGroup(0, this.shadeGroups[0]!); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
      d.queue.submit([enc.finish()]); await d.queue.onSubmittedWorkDone();
    }
    this.frame++;
    this.lastDrawMs = +(performance.now() - t).toFixed(1);
    return this.lastDrawMs;
  }
  /** The picture so far: RGBA, 8 bits per channel, top row first, at the size being drawn now. */
  async picture(): Promise<Uint8Array> {
    const d = this.device, row = Math.ceil(this.width * 4 / 256) * 256, enc = d.createCommandEncoder(), bytes = row * this.height;
    enc.copyTextureToBuffer({ texture: this.out }, { buffer: this.read, bytesPerRow: row }, [this.width, this.height]); d.queue.submit([enc.finish()]);
    await this.read.mapAsync(GPUMapMode.READ, 0, bytes); const a = new Uint8Array(this.read.getMappedRange(0, bytes).slice(0)); this.read.unmap();
    const out = new Uint8Array(this.width * this.height * 4); for (let y = 0; y < this.height; y++) out.set(a.subarray(y * row, y * row + this.width * 4), y * this.width * 4); return out;
  }
}

/** How many bounces a picture follows: the reflection bounces of the scene, and with glass (transport on) enough to go in and out of it. */
export function liveBounces(scene: Scene): number {
  const reflect = scene.reflections?.enabled ? scene.reflections.maxReflectionBounces ?? 1 : 0;
  const glass = hasLiveGlass(scene) ? scene.transport?.maxBounces ?? 4 : 0;
  return Math.min(MAX_BOUNCES, Math.max(reflect, glass));
}
