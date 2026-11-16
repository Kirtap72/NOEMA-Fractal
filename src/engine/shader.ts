import { integrateSurfaceLookShader } from "./surfaceLookWgsl";
import {secondaryRadianceGainShader} from './secondaryRadianceGain';
import {diffuseOrbitShader} from './diffuseOrbit';
import {adaptiveGeometryShader,adaptiveNativeGeometryShader} from './adaptiveGeometry';
import {geometryShader} from './geometryRecovery';
import { integrateBoxCutShader } from "./boxCutWgsl";
import { integrateAdaptiveMaskShader } from "./adaptiveMask";
import {integrateDisplacementShader} from './displacementWgsl';
import { applyFractalDisplacement } from './fractalDisplacementWgsl';
import {integrateSurfaceDetailShader} from './surfaceDetailWgsl';
import {integrateMaterialTextures} from './materialTexturesWgsl';
import {displayWgsl} from './display';
import {integratePrimitiveShader} from './primitiveWgsl';
import {integrateSecondaryGeometryShader} from './secondaryGeometryWgsl';
import { MAX_PARAM_VALUES } from "./uniforms";
import { LUT_SIZE } from "./gradient";
import { MIN_ROUGHNESS } from "./material";
import { secondaryRayWgsl } from "./secondaryRayWgsl";
import {cameraSamplingWgsl} from './cameraSampling';

/**
 * Ray marching shader (WGSL). The shape comes from a formula: its generated
 * code defines `formulaCore(pos)`, `formulaDistance(pos)` and `FORMULA_ITERATIONS`.
 * The colour comes from a gradient, chosen by a measure of how the surface behaves.
 */

const UNIFORMS = /* wgsl */ `
struct Uniforms {
  camPos : vec4f,
  right : vec4f,
  up : vec4f,
  forward : vec4f,
  view : vec4f, // x,y = whole resolution, z = tan(fov/2), w = temporary viewport effect mask (0 in final output)
  tile : vec4f, // x,y = where the part being drawn starts inside the whole image
  params : array<vec4f, ${MAX_PARAM_VALUES / 4}>, // formula parameters of all chain steps, 4 per slot
  color : vec4f, // x = measure, y = cycles, z = offset, w = 1 for mirror, 0 for repeat
  texture : vec4f, // x = strength (0 = no texture), y = scale, z = 1 for spherical mapping, 0 for triplanar
  lut : array<vec4f, ${LUT_SIZE}>, // the gradient as a table of colours (linear light)
  march : vec4f, // x = hit precision, y = step factor, z = most steps, w = furthest distance
  extra : vec4f, // x,y = where inside the pixel to look (pixels from the centre), z = size of the step used for the normal, w = most steps of a shadow ray
  fogColor : vec4f, // rgb = fog colour in linear light
  fog : vec4f, // x = density (0 = no fog), y = start distance, z = 1 for the squared form, w = 1 if the sky is fogged too
  ambient : vec4f, // rgb = ambient light (colour times intensity, linear light), w = number of lights
  lights : array<vec4f, 32>, // 8 lights, 4 vec4 each: position and type, direction and shadow mode, colour times intensity and shadow factor k, cone angles
  prec : vec4f, // x = 1 when the hit threshold and normal step follow the pixel size, y = hit threshold in pixels, z = normal step in pixels, w = debug view (0 off, 1 steps as a heat map, 2 mark rays that ran out of steps, 3 raw numbers for measuring)
  julia : vec4f, // xyz = the Julia constant, w = 1 when Julia mode is on (the constant then replaces the point in the iteration)
  chainw : array<vec4f, 2>, // interpolation weights of up to 8 chain steps
  loops : array<vec4f, 3>, // run-time loop counts of a plain chain: (rounds, total iterations), then the iterations of up to 8 steps; 0 = the compiled-in numbers
  env : vec4f, // x = 1 when an environment picture is used, y = exposure, z = rotation in radians, w = 1 when it is the background
  envsh : array<vec4f, 9>, // the diffuse light of the environment picture as a polynomial in the surface normal (see environment.ts)
  mata : vec4f, // x = 1 when the material adds anything (metal or reflection), y = last mip level of the environment picture
  matp : array<vec4f, 30>, // metallic, roughness, reflectivity: 10 vec4 each: (constant, driven by, cycles, offset), (mirror), 8 vec4 of a table of 32 values (see material.ts)
  matdata : array<vec4f,4>, // base/transmission, IOR/density, absorption, emission
  planes : array<vec4f, 3>,
  clipFlags : vec4f,
  ao : vec4f, // strength (zero disables probes), world radius, sample count, enabled (replaces legacy step shading)
  cavity : vec4f,
  edgeSoftening : vec4f,
  artContrast : vec4f,
  cameraEffects : vec4f, // orthographic height (zero is perspective), aperture radius, focus plane distance
  lensSample : vec4f,
  reflection : vec4f, // enabled, independent step/distance/threshold budgets
  reflectionSampling : vec4f, // samples, seed, global AA/lens sample index, effective bounce limit
  transport : vec4f, // enabled closed-volume transport, global secondary-query budget
  normalFilm : vec4f, // opt-in primary shading: enabled, perspective pixel per distance, orthographic pixel, reserved
  cameraSampling : vec4f, // enabled, exact low/high 16-bit seed, global camera sample index
  display : vec4f, // EV, tone map, transfer, linear offscreen flag
  tune : vec4f, // x = orbit colour influence, y = secondary reflection radiance gain (values that used to be baked into the shader text: a slider must not rebuild the shader)
  tuneColor : vec4f, // rgb = diffuse colour of the orbit mix (linear light)
};
@group(0) @binding(0) var<uniform> u : Uniforms;
`;

const TEXTURE_BINDINGS = /* wgsl */ `
@group(0) @binding(3) var tex : texture_2d<f32>;
@group(0) @binding(4) var samp : sampler;
`;

const ENV_BINDINGS = /* wgsl */ `
@group(0) @binding(6) var envTex : texture_2d<f32>;
@group(0) @binding(7) var envSamp : sampler;
`;

// The environment picture: where a direction lands on the map (azimuth around the vertical axis, with the middle of the
// map at negative z; from the top of the map at straight up), the picture's colour there, and its diffuse light.
const ENV_FUNCTIONS = /* wgsl */ `
fn envBackground(d : vec3f) -> vec3f {
  let az = atan2(d.x, -d.z) - u.env.z;
  let uv = vec2f(az / 6.283185307 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.141592654);
  return textureSampleLevel(envTex, envSamp, uv, 0.0).rgb * u.env.y;
}

// The light on a white diffuse surface with normal n: the irradiance polynomial divided by pi, times the exposure.
fn envDiffuse(n : vec3f) -> vec3f {
  let c = cos(-u.env.z);
  let s = sin(-u.env.z);
  let m = vec3f(n.x * c - n.z * s, n.y, n.z * c + n.x * s);
  let e = u.envsh[0].rgb + u.envsh[1].rgb * m.x + u.envsh[2].rgb * m.y + u.envsh[3].rgb * m.z
    + u.envsh[4].rgb * (m.x * m.y) + u.envsh[5].rgb * (m.y * m.z) + u.envsh[6].rgb * (m.x * m.z)
    + u.envsh[7].rgb * (m.x * m.x - m.y * m.y) + u.envsh[8].rgb * (m.z * m.z);
  return max(e, vec3f(0.0)) * (u.env.y / 3.141592654);
}
`;

// ---- material (see material.ts): the reflection model and the properties that follow a measure of the surface.
export const MATERIAL_FUNCTIONS = /* wgsl */ `
fn materialData(k:u32)->vec4f{return u.matdata[k];}
fn materialF0()->f32{let ior=materialData(1u).x;if(ior==1.5){return 0.04;}return pow((ior-1.0)/(ior+1.0),2.0);}
fn materialEmission()->vec3f{let e=materialData(3u);return e.rgb*e.w;}
var<private> specAcc : vec3f;      // the specular light of the lights, summed while the lights are worked through
var<private> matF0 : vec3f;        // the reflectance at normal incidence
var<private> matAlpha : f32;       // roughness squared
var<private> viewDir : vec3f;      // from the surface towards the camera

fn ggxD(nh : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.141592654 * d * d);
}

fn smithV(nv : f32, nl : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
  let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 0.000000001);
}

fn skyGradient(d : vec3f) -> vec3f {
  return mix(vec3f(0.08, 0.10, 0.16), vec3f(0.25, 0.30, 0.40), 0.5 + 0.5 * d.y);
}

// The light the environment sends along the direction r to a surface of the given roughness: the picture (a blurrier mip
// level for a rougher surface) or, without a picture, the gradient sky blended towards its average.
fn environmentSpecular(r : vec3f, rough : f32) -> vec3f {
  if (u.env.x > 0.5) {
    let az = atan2(r.x, -r.z) - u.env.z;
    let uv = vec2f(az / 6.283185307 + 0.5, acos(clamp(r.y, -1.0, 1.0)) / 3.141592654);
    return textureSampleLevel(envTex, envSamp, uv, rough * u.mata.y).rgb * u.env.y;
  }
  return mix(skyGradient(r), skyGradient(vec3f(0.0)), rough * rough);
}

// One property of the material at a point: its number, or its curve at the (wrapped) measure.
fn matValue(k : i32, core : vec3f, p : vec3f, n : vec3f, steps : i32) -> f32 {
  let base = u32(k * 10);
  let head = u.matp[base];
  if (head.y < -0.5) { return head.x; }
  var which = i32(head.y + 0.5);
  if (which == 5) { which = i32(u.color.x + 0.5); }
  var t = measureValue(which, core, p, n, steps) * head.z + head.w;
  if (u.matp[base + 1u].x > 0.5) {
    let m = t - 2.0 * floor(t * 0.5);
    t = 1.0 - abs(1.0 - m);
  } else {
    t = fract(t);
  }
  let f = clamp(t, 0.0, 1.0) * 31.0;
  let i = u32(floor(f));
  let j = min(i + 1u, 31u);
  let a = u.matp[base + 2u + (i >> 2u)][i & 3u];
  let b = u.matp[base + 2u + (j >> 2u)][j & 3u];
  return mix(a, b, f - floor(f));
}
`;

/** Computes distances at many points on the graphics card (used to time the camera by the distance to the surface). */
export function buildDistanceShader(formulaCode: string): string {
  return /* wgsl */ `${UNIFORMS}
@group(0) @binding(1) var<storage, read> points : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> distances : array<f32>;

${formulaCode}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&points)) { return; }
  // u.color.x is read only so that the uniform buffer is always part of the layout
  distances[id.x] = formulaDistance(points[id.x].xyz) + 0.0 * u.color.x;
}
`;
}

/**
 * Computes the distance at every point of a regular grid, one slab of the grid at a time (used for mesh export).
 * The grid parameters: origin, step (distance between points along each axis), and the number of points as
 * (nx, ny, number of layers in this slab, index of the first layer of this slab).
 */
export function buildGridShader(formulaCode: string): string {
  return /* wgsl */ `${UNIFORMS}
struct Grid {
  origin : vec4f,
  step : vec4f,
  dims : vec4u,
};
@group(0) @binding(1) var<uniform> grid : Grid;
@group(0) @binding(2) var<storage, read_write> values : array<f32>;

${formulaCode}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id : vec3u) {
  let count = grid.dims.x * grid.dims.y * grid.dims.z;
  if (id.x >= count) { return; }
  let i = id.x % grid.dims.x;
  let j = (id.x / grid.dims.x) % grid.dims.y;
  let k = id.x / (grid.dims.x * grid.dims.y) + grid.dims.w;
  let p = grid.origin.xyz + vec3f(f32(i), f32(j), f32(k)) * grid.step.xyz;
  // u.color.x is read only so that the uniform buffer is always part of the layout
  values[id.x] = formulaDistance(p) + 0.0 * u.color.x;
}
`;
}

const COLOR_FUNCTIONS = /* wgsl */ `
// Colour from the gradient. x is the measure after cycles and offset are applied.
fn gradientColor(x : f32) -> vec3f {
  var t = x;
  if (u.color.w > 0.5) {
    let m = t - 2.0 * floor(t * 0.5);
    t = 1.0 - abs(1.0 - m); // mirror: 0 -> 1 -> 0 -> 1 ...
  } else {
    t = fract(t);
  }
  let f = clamp(t, 0.0, 1.0) * ${LUT_SIZE - 1}.0;
  let i = u32(floor(f));
  let j = min(i + 1u, ${LUT_SIZE - 1}u);
  return mix(u.lut[i].rgb, u.lut[j].rgb, f - floor(f));
}

// The picture colour at point p on the surface with normal n, in linear light.
fn textureColor(p : vec3f, n : vec3f) -> vec3f {
  let s = u.texture.y;
  var c = vec3f(0.0);
  if (u.texture.z > 0.5) {
    // Spherical: longitude and latitude around the centre, like a map on a globe.
    let r = max(length(p), 0.000001);
    let uv = vec2f(atan2(p.z, p.x) / 6.2831853 + 0.5, acos(clamp(p.y / r, -1.0, 1.0)) / 3.1415927);
    c = textureSampleLevel(tex, samp, uv * s, 0.0).rgb;
  } else {
    // Triplanar: project the picture along each axis and blend by how much the surface faces that way.
    var w = pow(abs(n), vec3f(4.0));
    w = w / (w.x + w.y + w.z);
    c = textureSampleLevel(tex, samp, p.yz * s, 0.0).rgb * w.x
      + textureSampleLevel(tex, samp, p.xz * s, 0.0).rgb * w.y
      + textureSampleLevel(tex, samp, p.xy * s, 0.0).rgb * w.z;
  }
  return pow(c, vec3f(2.2)); // the picture is stored as it looks on screen; the lighting works in linear light
}

// How much of the fog colour is mixed in at distance d: 1 - exp(-density * (d - start)), or squared. 0 when there is no fog.
fn fogAmount(d : f32) -> f32 {
  let x = max(d - u.fog.y, 0.0) * u.fog.x;
  return 1.0 - exp(select(-x, -(x * x), u.fog.z > 0.5));
}

// Open clipping: intersect retained half spaces. No artificial cut surface enters the formula DE.
fn clipInterval(origin : vec3f, dir : vec3f, maximum : f32) -> vec2f {
  if (!any(u.clipFlags.xyz > vec3f(0.5))) { return vec2f(0.0, maximum); }
  var near = 0.0; var far = maximum;
  for (var i = 0; i < 3; i++) {
    if (u.clipFlags[u32(i)] < 0.5) { continue; }
    let plane = u.planes[u32(i)];
    let d = dot(plane.xyz, origin) - plane.w;
    let slope = dot(plane.xyz, dir);
    if (abs(slope) < 1e-8) { if (d > 0.0) { return vec2f(1.0, 0.0); } }
    else if (slope > 0.0) { far = min(far, -d / slope); }
    else { near = max(near, -d / slope); }
  }
  return vec2f(near, far);
}
fn retained(p : vec3f) -> bool {
  for (var i = 0; i < 3; i++) {
    if (u.clipFlags[u32(i)] > 0.5 && dot(u.planes[u32(i)].xyz, p) > u.planes[u32(i)].w) { return false; }
  }
  return true;
}
// Broad cosine-weighted hemisphere probes: contact/form separation, not a march-step heuristic.
// Empty clipped samples contribute no occlusion; a tangent plane stays neutral.
fn detailVisibility(p : vec3f, n : vec3f, settings : vec4f, epsilon : f32) -> f32 {
  if (settings.x <= 0.0 || (i32(u.view.w) & 2) != 0) { return 1.0; }
  let tangent = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let bitangent = cross(n, tangent);
  let count = i32(settings.z);
  var blocked = 0.0; var total = 0.0;
  for (var i = 0; i < count; i++) {
    let fraction = (f32(i) + 1.0) / f32(count);
    let angle = f32(i) * 2.39996323;
    let cosine = sqrt(max(0.08, 1.0 - fraction * 0.92));
    let direction = n * cosine + sqrt(1.0 - cosine * cosine) * (tangent * cos(angle) + bitangent * sin(angle));
    let distance = max(settings.y * (0.35 + 0.65 * fract(f32(i) * 0.61803399)), epsilon * 4.0);
    let q = p + n * epsilon * 2.0 + direction * distance;
    let expected = epsilon * 2.0 + distance * dot(direction, n);
    let weight = 1.0 - 0.5 * fraction;
    if (retained(q)) {
      let raw = formulaDistance(q);
      let d = select(max(raw, 0.0), abs(raw), any(u.clipFlags.xyz > vec3f(0.5)));
      blocked += clamp((expected - d) / expected, 0.0, 1.0) * weight;
    }
    total += weight;
  }
  return max(0.15, exp(-3.0 * settings.x * blocked / max(total, 1e-6)));
}
// Local curvature contrast. Unlike AO this samples a tangent ring at one small scale,
// compares with the centre field, and lifts convex rims as well as darkening recesses.
fn cavityResponse(p : vec3f, n : vec3f, settings : vec4f, epsilon : f32) -> f32 {
  if (settings.x <= 0.0 || (i32(u.view.w) & 2) != 0) { return 1.0; }
  let tangent = normalize(cross(n, select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(n.y)>0.9)));
  let bitangent = cross(n,tangent);
  let radius = max(settings.y, epsilon * 6.0);
  let height = max(radius * 0.15, epsilon * 2.0);
  let center = p + n * height;
  let clipped = any(u.clipFlags.xyz > vec3f(0.5));
  let rawCenter = formulaDistance(center);
  let reference = select(rawCenter, abs(rawCenter), clipped);
  var curvature = 0.0;
  let count = i32(settings.z);
  for (var i=0; i<count; i++) {
    let angle = 6.283185307 * (f32(i)+0.5) / f32(count);
    let q = center + radius * (tangent*cos(angle)+bitangent*sin(angle));
    if (retained(q)) {
      let raw = formulaDistance(q);
      let d = select(raw, abs(raw), clipped);
      // Ignore domain-miss sentinels: a missing neighbour is empty, not a bright rim.
      if (abs(d) < 1e18 && abs(reference) < 1e18) {
        curvature += clamp((d-reference) / max(radius*0.35, epsilon*4.0), -1.0, 1.0);
      }
    }
  }
  let contrast = u.artContrast.x;
  return clamp(1.0 + settings.x * contrast * 2.5 * curvature / f32(count), max(0.2, 1.0-0.55*contrast), min(2.0, 1.0+0.4*contrast));
}

// How much light reaches the point: 1 = all, 0 = none. The ray runs from the surface towards the light. Soft shadows:
// the smallest value of k * distance-to-surface / travelled-so-far along the ray (Inigo Quilez, distance fields).
fn shadowAmount(origin : vec3f, dir : vec3f, tmax : f32, k : f32, mode : f32, hit : f32) -> f32 {
  var res = 1.0;
  let interval = clipInterval(origin, dir, tmax);
  if (interval.x > interval.y) { return 1.0; }
  var t = max(hit * 2.0, interval.x);
  var escapeUnsignedInterior = false;
  let steps = i32(u.extra.w);
  for (var i = 0; i < steps; i++) {
    if (t >= interval.y) { break; }
    let raw = formulaDistance(origin + dir * t);
    let h = select(raw, abs(raw), any(u.clipFlags.xyz > vec3f(0.5)));
    if (i == 0 && any(u.clipFlags.xyz > vec3f(0.5)) && raw >= 0.0 && raw < hit) { escapeUnsignedInterior = true; }
    if (escapeUnsignedInterior) {
      if (h <= hit) { t += hit * 2.0; continue; }
      escapeUnsignedInterior = false;
    }
    if (h < hit) { return 0.0; }
    if (mode > 1.5) { res = min(res, k * h / t); }
    t += h * u.march.y;
  }
  return clamp(res, 0.0, 1.0);
}

// The light that reaches a surface point p with normal n (linear light), from the ambient light and every light.
// tc is how far the point is from the camera (the precision of hits grows with it).
fn lighting(p : vec3f, n : vec3f, tc : f32) -> vec3f {
  let ao = detailVisibility(p, n, u.ao, hitThreshold(tc, p));
  var sum = u.ambient.rgb * ao;
  if (u.env.x > 0.5) { sum = sum + envDiffuse(n) * ao; }
  let count = i32(u.ambient.w);
  let hit = hitThreshold(tc, p);
  for (var i = 0; i < count; i++) {
    let a = u.lights[i * 4];
    let b = u.lights[i * 4 + 1];
    let c = u.lights[i * 4 + 2];
    let d = u.lights[i * 4 + 3];
    var toLight = -b.xyz; // the direction arrives normalised
    var weaken = 1.0;
    var tmax = u.march.w;
    if (a.w > 0.5) {
      // Point and spot lights: the direction and the distance to the light, and the inverse-square law.
      let v = a.xyz - p;
      let dist = length(v);
      toLight = v / max(dist, 0.000001);
      weaken = 1.0 / max(dist * dist, 0.0001);
      tmax = dist;
      if (a.w > 1.5) {
        // Spot: full light inside the inner cone, none outside the outer cone.
        weaken = weaken * smoothstep(d.x, d.y, dot(-toLight, b.xyz));
      }
    }
    let diffuse = max(dot(n, toLight), 0.0);
    var shadow = 1.0;
    if (b.w > 0.5 && diffuse > 0.0 && weaken > 0.0 && (i32(u.view.w) & 1) == 0) {
      shadow = shadowAmount(p + n * (6.0 * hit), toLight, tmax, c.w, b.w, hit);
    }
    // Artistic contact visibility influences part of direct diffuse too, so sun-lit forms separate.
    // Specular stays physically independent; the floor prevents featureless black recesses.
    sum = sum + c.rgb * (diffuse * weaken * shadow * mix(1.0, ao, 0.6));
    if (u.mata.x > 0.5 && diffuse > 0.0 && (i32(u.view.w) & 4) == 0) {
      // Specular light (material): BRDF times cosine times pi times the light, with the same shadow and weakening.
      let h = normalize(viewDir + toLight);
      let nh = max(dot(n, h), 0.0);
      let vh = max(dot(viewDir, h), 0.0);
      let nv = max(dot(n, viewDir), 0.0001);
      let fresnel = matF0 + (vec3f(1.0) - matF0) * pow(1.0 - vh, 5.0);
      specAcc = specAcc + c.rgb * (3.141592654 * weaken * shadow * diffuse * ggxD(nh, matAlpha) * smithV(nv, diffuse, matAlpha)) * fresnel;
    }
  }
  return sum;
}

// The size of one pixel at distance t: the vertical angle of one pixel times the distance.
fn pixelSize(t : f32) -> f32 {
  if(u.cameraEffects.x>0.0){return u.cameraEffects.x/u.view.y;}
  return t * 2.0 * u.view.z / u.view.y;
}

// The smallest threshold that 32-bit numbers can still tell apart at point p: about 16 steps between neighbouring
// 32-bit numbers (measured: the distance estimate itself is good to about 3e-8 near the scale 1).
fn precisionFloor(p : vec3f) -> f32 {
  return 2.0e-6 * (1.0 + length(p));
}

// How close to the surface a ray at distance t (at point p) counts as a hit.
fn hitThreshold(t : f32, p : vec3f) -> f32 {
  if (u.prec.x > 0.5) { return max(u.prec.y * pixelSize(t), precisionFloor(p)); }
  return u.march.x * (1.0 + t);
}

// Primary-only opt-in cap. Model evaluation receives this same tolerance; step scaling never scales acceptance.
fn primaryHitThreshold(t : f32, p : vec3f) -> f32 {
  if (u.normalFilm.w < 0.5) { return hitThreshold(t, p); }
  let pixel = select(t * u.normalFilm.y, u.normalFilm.z, u.cameraEffects.x > 0.0);
  return max(precisionFloor(p), min(hitThreshold(t, p), 0.5 * pixel));
}

// The step used to find the surface direction at distance t (at point p).
fn normalStep(t : f32, p : vec3f) -> f32 {
  if (u.prec.x > 0.5) { return max(u.prec.z * pixelSize(t), precisionFloor(p)); }
  return u.extra.z;
}

// Only primary surface shading uses the target-film cap. Keep the legacy helper for marching and secondary rays.
fn primaryNormalStep(t : f32, p : vec3f) -> f32 {
  if (u.normalFilm.x < 0.5) { return normalStep(t, p); }
  let pixel = select(t * u.normalFilm.y, u.normalFilm.z, u.cameraEffects.x > 0.0);
  let saved = select(u.extra.z, u.prec.z * pixel, u.prec.x > 0.5);
  return max(precisionFloor(p), min(saved, pixel));
}

// A heat map from blue (few) through green and yellow to red (many), for x from 0 to 1.
fn heat(x : f32) -> vec3f {
  let c = clamp(x, 0.0, 1.0) * 4.0;
  return clamp(vec3f(min(c - 1.5, 4.5 - c), min(c - 0.5, 3.5 - c), min(c + 0.5, 2.5 - c)), vec3f(0.0), vec3f(1.0));
}

// The most iterations a point can get, for scaling the "iterations" measure. A plain chain sends it at run time (so changing a count needs no new shader);
// every other chain leaves the uniform at 0 and uses the constant its generated code defines.
fn iterationScale() -> f32 {
  return select(FORMULA_ITERATIONS, u.loops[0].y, u.loops[0].y > 0.5);
}

// The colour of the surface before lighting, in linear light: gradient (chosen measure) mixed with the texture.
// steps is how many steps the viewing ray needed (used by the cavity measure; 0 when there is no ray).
fn measureValue(which : i32, core : vec3f, p : vec3f, n : vec3f, steps : i32) -> f32 {
  var m = 0.0;
  if (which == 0) { m = core.y / iterationScale(); }            // iterations: how long the point stays
  else if (which == 1) { m = core.z * 0.5; }                      // orbit trap: closest pass to the centre
  else if (which == 2) { m = 0.5 + 0.5 * n.y; }                   // slope: how much the surface faces up
  else if (which == 3) { m = min(f32(steps) / 120.0, 1.0); }      // cavity: how deep in a crevice
  else { m = length(p) * 0.5; }                                   // radius: distance from the centre
  return m;
}

// The colour with the formula's core (distance, iterations, orbit trap) already worked out.
fn surfaceBaseColorWith(core : vec3f, p : vec3f, n : vec3f, steps : i32) -> vec3f {
  let m = measureValue(i32(u.color.x + 0.5), core, p, n, steps);
  var base = gradientColor(m * u.color.y + u.color.z);
  if (u.texture.x > 0.0) { base = mix(base, textureColor(p, n), u.texture.x); }
  return base;
}

fn surfaceBaseColor(p : vec3f, n : vec3f, steps : i32) -> vec3f {
  return surfaceBaseColorWith(formulaCore(p), p, n, steps); // (distance, iterations, orbit trap)
}

`;

export interface ShaderOptions {
  diffuseOrbit?:import('./diffuseOrbit').DiffuseOrbit;
  geometryContinuation?:boolean;
  qaGeometry?: import('./geometryRecovery').GeometryRecoveryExperiment;
  /** Internal GEO1 diagnostic only; never read from a scene or artist control. */
  qaPrimaryHitCoefficient?: 0.5 | 0.25 | 0.125;
  displacement?:boolean;
  /** Fractal displacement (scene version 49): the formula's distance becomes the displaced field and the layers are read from the uniform block (fractalDisplacementWgsl.ts). */
  fractalDisplacement?: boolean;
  boxCut?: boolean;
  /** INTELLIGENT-RENDERING-02: reads the artist's Float32 floor scale (precision_floor). Off: the shader text is exactly what it was. */
  floorScale?: boolean;
  /** SURFACE-LIGHTING-01: wide AO, bent environment light and contact shadows (see surfaceLookWgsl.ts). Off: the shader text is exactly what it was. */
  surfaceLook?: boolean;
  /** INTELLIGENT-RENDERING-01: lets whole tiles skip the picture shader (selective refinement). Off: the shader is exactly what it was. */
  tileMask?: boolean;
  surfaceDetail?:boolean;
  materialTextures?:boolean;
  /** MATERIAL-GRADIENT-02: the colour gradient has textured material stops (adds the blending functions to the PBR shader code). */
  gradientTextures?:boolean;
  proceduralDetail?:boolean;
  /**
   * Also write a second image with depth and normals (see the layers below).
   * Used for rendering to memory; the picture on screen does not need it.
   */
  layers?: boolean;
  primitives?: boolean;
  secondaryGeometry?:boolean;
  /** Omit the multi-bounce kernel for cheap/first-frame pipelines; field and shading remain identical. */
  multiBounce?: boolean;
  secondaryRadianceGain?:number;
}

/**
 * The picture shader.
 *
 * Output 0 is the colour image. With `layers`, output 1 holds, per pixel (as four decimal numbers):
 * - x: depth = the distance along the viewing ray from the camera to the surface (-1 where no surface is hit)
 * - y, z, w: the normal of the surface, as a unit vector in world coordinates (0, 0, 0 where no surface is hit)
 */
export function buildShader(formulaCode: string, options: ShaderOptions = {}): string {
  if (options.qaPrimaryHitCoefficient !== undefined && ![0.5, 0.25, 0.125].includes(options.qaPrimaryHitCoefficient)) throw Error('Invalid QA primary-hit coefficient');
  const layers = options.layers === true;
  const rawShader = /* wgsl */ `${UNIFORMS}${TEXTURE_BINDINGS}${ENV_BINDINGS}${ENV_FUNCTIONS}${MATERIAL_FUNCTIONS}${displayWgsl}${cameraSamplingWgsl}
struct FragOut {
  @location(0) color : vec4f,${layers ? "\n  @location(1) data : vec4f," : ""}
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  // One big triangle that covers the whole screen.
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

${formulaCode}
${COLOR_FUNCTIONS}
// SHADER-STARTUP: ONE place that calls the formula. The tetrahedron (4 samples) and the central differences (6 samples) used to be written out call after call:
// ten copies of the whole unrolled formula in the compiled program, about 4 s of build time each on a heavy fractal (measured on reference scene: 81 s for the shader,
// 10 s with a single copy). Both are the same sum, the samples weighted by their own offset, formed in the same order as before, so the normal is the same number.
// The count is written so that the compiler cannot know it (view.w >> 30 is always 0): it keeps this a loop and builds the formula once.
fn sceneNormal(p : vec3f, step : f32) -> vec3f {
  let tetrahedron = (i32(u.view.w) & 16) != 0;
  let count = select(6, 4, tetrahedron) + (i32(u.view.w) >> 30);
  var tetra = array<vec3f, 4>(vec3f(1.0, -1.0, -1.0), vec3f(-1.0, -1.0, 1.0), vec3f(-1.0, 1.0, -1.0), vec3f(1.0, 1.0, 1.0));
  var sum = vec3f(0.0);
  for (var k = 0; k < count; k++) {
    // sample offset: tetrahedron a, b, c, d; central differences +x -x +y -y +z -z (each sample goes into its own axis with its own sign: f(p + e) - f(p - e))
    var o = vec3f(0.0);
    var axis = 0;
    var sign = 1.0;
    if (tetrahedron) {
      o = tetra[k];
    } else {
      axis = k >> 1;
      sign = select(-1.0, 1.0, (k & 1) == 0);
      o[axis] = sign;
    }
    let f = formulaDistance(p + o * step);
    if (tetrahedron) { sum = sum + o * f; } else { sum[axis] = sum[axis] + sign * f; }
  }
  return normalize(sum);
}

// Shading-only bevel: blend nearby field normals, retaining the original ray hit and output normal.
// Tangent samples remain at the fine normal step, rather than globally blurring the field.
fn softenedNormal(p : vec3f, fine : vec3f, step : f32) -> vec3f {
  if (u.edgeSoftening.x <= 0.0 || (i32(u.view.w) & 2) != 0) { return fine; }
  let radius = u.edgeSoftening.y;
  if (radius <= step) { return fine; }
  let tangent = normalize(cross(fine, select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(fine.y)>0.9)));
  let bitangent = cross(fine,tangent);
  var total = fine * 2.0; var weight = 2.0;
  for (var i=0; i<4; i++) {
    let angle = (f32(i)+0.5)*1.570796327;
    let q = p + radius * (tangent*cos(angle)+bitangent*sin(angle));
    let field = formulaDistance(q);
    // Missing/clipped neighbours and tiny disconnected features must not bend the shading normal.
    if (!retained(q) || abs(field) >= radius * 0.75) { continue; }
    let neighbour = sceneNormal(q, step);
    let agreement = dot(fine,neighbour);
    if (!(agreement >= 0.0)) { continue; } // also excludes NaN and opposing faces
    let w = select(1.0, 0.35 + 0.65 * smoothstep(0.0,0.8,agreement), u.edgeSoftening.z > 0.5);
    total += neighbour*w; weight += w;
  }
  return normalize(mix(fine,normalize(total/weight),u.edgeSoftening.x));
}

${secondaryRayWgsl(formulaCode.includes('fn formulaCoreAtThreshold('),options.multiBounce!==false)}
@fragment
fn fs(@builtin(position) frag : vec4f) -> FragOut {
  var out : FragOut;
  let res = u.view.xy;
  let p0 = frag.xy + u.tile.xy + cameraPixelJitter(frag.xy + u.tile.xy);
  let transportPixel = select(p0-u.extra.xy,frag.xy+u.tile.xy,u.cameraSampling.x>0.5);
  let ndc = vec2f(2.0 * p0.x - res.x, res.y - 2.0 * p0.y) / res.y;
  var origin = u.camPos.xyz;
  var dir = normalize(u.forward.xyz + (u.right.xyz * ndc.x + u.up.xyz * ndc.y) * u.view.z);
  if(u.cameraEffects.x > 0.0){
    origin += (u.right.xyz*ndc.x+u.up.xyz*ndc.y)*(u.cameraEffects.x*0.5);
    dir = u.forward.xyz;
  } else if(u.cameraEffects.y > 0.0 && any(u.lensSample.xy!=vec2f(0.0)) && (i32(u.view.w)&8)==0 && u.prec.w!=3.0){
    let focus = origin + dir * u.cameraEffects.z / max(0.000001,dot(dir,u.forward.xyz));
    origin += (u.right.xyz*u.lensSample.x+u.up.xyz*u.lensSample.y)*u.cameraEffects.y;
    dir = normalize(focus-origin);
  }

  let interval = clipInterval(origin, dir, u.march.w);
  let clipped = any(u.clipFlags.xyz > vec3f(0.5));
  var t = interval.x;
  var hit = false;
  var escapeUnsignedInterior = false;
  var previousInterior = t;
  var steps = 0;
  let maxSteps = i32(u.march.z);
  for (var i = 0; i < maxSteps; i++) {
    if (t > interval.y) { break; }
    steps = i;
    let q = origin + dir * t;
    let d = ${formulaCode.includes('fn formulaCoreAtThreshold(') ? 'formulaCoreAtThreshold(q, primaryHitThreshold(t, q)).x' : 'formulaDistance(q)'};
    let surfaceDistance = select(d, abs(d), clipped);
    let threshold = primaryHitThreshold(t, q);
    // Unsigned fields can report zero throughout their interior. The cut entry is never a synthetic cap:
    // seek their first exterior sample within the existing march budget instead of accepting the plane.
    if (i == 0 && interval.x > 0.0 && clipped && d >= 0.0 && d < threshold) { escapeUnsignedInterior = true; }
    if (escapeUnsignedInterior) {
      if (d > threshold) {
        // A zero plateau can end at a domain-miss sentinel rather than a surface. Never shade that jump.
        if (!(d < 1e18)) { t = interval.y + 1.0; break; }
        var lo = previousInterior; var hi = t;
        for (var j = 0; j < 8; j++) {
          let mid = (lo+hi)*0.5;
          let sample = formulaDistance(origin+dir*mid);
          if (sample > threshold) { hi = mid; } else { lo = mid; }
        }
        t = hi; hit = true; break;
      }
      previousInterior = t;
      t += max(threshold * 2.0, normalStep(t, q));
      continue;
    }
    // Accept a hit sooner the closer we are, and be gentler than the estimate says.
    if (surfaceDistance < threshold) { hit = true; break; }
    t += surfaceDistance * u.march.y;
    if (t > interval.y) { break; }
  }

  // A ray that neither hit the surface nor left the scene ran out of steps: its colour is a guess.
  let exhausted = !hit && t <= interval.y;
  let profileStage = i32(u.tile.z);
  if (profileStage == 1) {
    out.color = vec4f(vec3f(select(0.0, 0.5, hit)), 1.0);
    ${layers ? "out.data = vec4f(select(-1.0, t, hit), 0.0, 0.0, 0.0);" : ""}
    return out;
  }
  let debugView = i32(u.prec.w + 0.5);
  if (debugView > 0 && debugView != 4) { // 4 is "measure": it runs the normal shading path below and returns where the gradient measure is known
    let used = f32(steps + 1) / u.march.z; // share of the allowed steps that the ray used
    var c = vec3f(1.0, 0.0, 1.0); // magenta: ran out of steps
    if (debugView == 1) {
      if (!exhausted) { c = heat(used) * select(0.35, 1.0, hit); } // misses are drawn darker
    } else if (debugView == 2) {
      if (!exhausted) { c = vec3f(select(0.12, 0.6, hit)); } // grey: hit, dark: missed on purpose
    } else {
      // raw: red = share of steps used, green = 0 missed, 0.5 hit, 1 ran out of steps (read back for measuring)
      c = vec3f(used, select(select(0.0, 0.5, hit), 1.0, exhausted), 0.0);
    }
    out.color = vec4f(select(select(pow(c, vec3f(1.0 / 2.2)), c, debugView == 3), select(c,pow(c,vec3f(2.2)),debugView==3), u.display.w>0.5), 1.0);
    ${layers ? "out.data = vec4f(select(-1.0, t, hit), 0.0, 0.0, 0.0);" : ""}
    return out;
  }

  var sky = mix(vec3f(0.08, 0.10, 0.16), vec3f(0.25, 0.30, 0.40), 0.5 + 0.5 * dir.y);
  if (u.env.x > 0.5 && u.env.w > 0.5) { sky = max(envBackground(dir), vec3f(0.0)); }
  if (!hit) {
    // Rays that hit nothing are infinitely far away: a fogged sky becomes the fog colour (when there is fog).
    let skyColor = select(sky, u.fogColor.rgb, u.fog.w > 0.5 && u.fog.x > 0.0 && (i32(u.view.w) & 64) == 0);
    out.color = vec4f(displayColor(skyColor), 1.0);
    ${layers ? "out.data = vec4f(-1.0, 0.0, 0.0, 0.0);" : ""}
    return out;
  }

  let p = origin + dir * t;
  let outward = sceneNormal(p, primaryNormalStep(t, p));
  // An open cut can expose the reverse side of a signed surface. Shade that side toward the viewer.
  let rawNormal = select(outward, -outward, clipped && dot(outward, dir) > 0.0);
  let n = softenedNormal(p, rawNormal, primaryNormalStep(t, p));
  if (profileStage == 2) {
    out.color = vec4f(select(n*0.5+0.5,pow(n*0.5+0.5,vec3f(2.2)),u.display.w>0.5), 1.0);
    ${layers ? "out.data = vec4f(t, rawNormal);" : ""}
    return out;
  }
  // Cheap shading of crevices: the more steps a ray needed, the darker.
  let occlusion = select(1.0 - clamp(f32(steps) / u.march.z, 0.0, 1.0) * 1.6, 1.0, (i32(u.view.w) & 2) != 0 || u.ao.w > 0.5 || u.cavity.w > 0.5);

  let core = formulaCore(p);
  if (debugView == 4) {
    // "measure" (ARTIST-WORKFLOW 05): not a picture. The very numbers the gradient is looked up with for this surface point, from the code that shades it
    // (same normal, same core, same march steps for the cavity measure): the measure, the gradient coordinate (measure * cycles + offset, before the
    // wrap) and which measure it is. They travel in the data layer (in place of the normal), so a click on the picture can say exactly which part of
    // the gradient that surface uses. No extra formula call: the core above is reused.
    let mWhich = i32(u.color.x + 0.5);
    let mValue = measureValue(mWhich, core, p, n, steps);
    out.color = vec4f(0.0, 0.0, 0.0, 1.0);
    ${layers ? "out.data = vec4f(t, mValue, mValue * u.color.y + u.color.z, f32(mWhich));" : ""}
    return out;
  }
  let base = surfaceBaseColorWith(core, p, n, steps)*materialData(0u).rgb;

  var lit : vec3f;
  if ((i32(u.view.w) & 8) != 0) {
    // A camera headlight keeps the same surface/colour while avoiding secondary rays and material work.
    lit = base * (0.25 + 0.75 * max(dot(n, -dir), 0.0));
  } else if (u.mata.x > 0.5 && (i32(u.view.w) & 4) == 0) {
    // A material that adds metal or reflection (material.ts): the diffuse part shrinks with metal, a specular part is added.
    viewDir = -dir;
    let metal = clamp(matValue(0, core, p, n, steps), 0.0, 1.0);
    let rough = clamp(matValue(1, core, p, n, steps), ${MIN_ROUGHNESS}, 1.0);
    let refl = clamp(matValue(2, core, p, n, steps), 0.0, 1.0);
    matF0 = mix(vec3f(materialF0()), base, metal);
    matAlpha = rough * rough;
    specAcc = vec3f(0.0);
    let light = lighting(p, n, t);
    let primarySpecular = specAcc; // terminal lighting has its own accumulators
    let occ = clamp(occlusion, 0.15, 1.0);
    let nv = clamp(dot(n, viewDir), 0.0, 1.0);
    let fresnel = matF0 + (max(vec3f(1.0 - rough), matF0) - matF0) * pow(1.0 - nv, 5.0);
    var environment = vec3f(0.0);
    if ((i32(u.view.w) & 32) == 0) {
      if(u.reflection.x>0.5&&u.reflectionSampling.w>0.5&&(i32(u.view.w)&128)==0&&max(refl,metal)>0.0){
        var reflectionNormal=select(rawNormal,-rawNormal,dot(rawNormal,dir)>0.0);
        if(!(dot(reflectionNormal,reflectionNormal)>0.5)){reflectionNormal=-dir;}
        environment=tracedReflection(p,reflectionNormal,dir,t,clamp(matValue(1,core,p,n,steps),0.0,1.0),matF0,transportPixel);
      }else{environment = fresnel * environmentSpecular(reflect(dir, n), rough);}
    }
    lit = base * (1.0 - metal) * light * occ + max(refl, metal) * (primarySpecular + environment * occ);
  } else {
    lit = base * lighting(p, n, t) * clamp(occlusion, 0.15, 1.0);
  }
  lit *= cavityResponse(p, n, u.cavity, hitThreshold(t, p));
  lit += materialEmission();
  let fog = select(fogAmount(t), 0.0, (i32(u.view.w) & 64) != 0);
  let color = mix(lit, u.fogColor.rgb, fog); // fog is mixed in linear light, after the lighting
  out.color = vec4f(displayColor(color), 1.0);
  ${layers ? "out.data = vec4f(t, rawNormal.x, rawNormal.y, rawNormal.z);" : ""}
  return out;
}
`;
  const shader=secondaryRadianceGainShader(rawShader,options.secondaryRadianceGain??1);
  const objects=options.secondaryGeometry?integrateSecondaryGeometryShader(shader,formulaCode.includes("fn formulaCoreAtThreshold("),!!options.primitives):options.primitives ? integratePrimitiveShader(shader,formulaCode.includes("fn formulaCoreAtThreshold("),options.multiBounce!==false) : shader;
  const detailed=options.surfaceDetail||options.materialTextures?integrateSurfaceDetailShader(objects,options.primitives||options.secondaryGeometry,options.proceduralDetail):objects;
  const textured=options.materialTextures?integrateMaterialTextures(detailed,!!(options.primitives||options.secondaryGeometry),!!options.gradientTextures):detailed;
  const displaced=options.displacement?integrateDisplacementShader(textured):textured;
  const geometry = options.qaGeometry ? geometryShader(displaced,options.qaGeometry) : displaced;
  const continued=options.geometryContinuation?(options.qaGeometry?.nativeMb3d?adaptiveNativeGeometryShader(geometry):adaptiveGeometryShader(geometry)):geometry;
  const plainLight = diffuseOrbitShader(options.boxCut ? integrateBoxCutShader(continued) : continued,options.diffuseOrbit);
  const unscaled = options.surfaceLook ? integrateSurfaceLookShader(plainLight) : plainLight;
  // The artist's floor scale (render.quality.precision_floor, passed in u.tile.w; zero = the floor of earlier scenes) applies to the Float32 picture shader.
  // Geometry Detail shaders keep their frozen text: they do their own double-single hit logic and are never given the scale.
  const floorLine = '  return 2.0e-6 * (1.0 + length(p));';
  const result = !options.floorScale || options.geometryContinuation || options.qaGeometry || !unscaled.includes(floorLine)
    ? unscaled
    : unscaled.replace(floorLine, '  return 2.0e-6 * (1.0 + length(p)) * select(1.0, u.tile.w, u.tile.w > 0.0);');
  // Ungated and explicit control arms retain the original shader bytes. Only the primary helper changes.
  // The fractal displacement goes in last but before the tile mask, so that the uniform block keeps its order (box cut, displacement, tile mask).
  const finish = (text: string) => { const shown = options.fractalDisplacement ? applyFractalDisplacement(text) : text; return options.tileMask ? integrateAdaptiveMaskShader(shown) : shown; };
  if (options.qaPrimaryHitCoefficient === undefined || options.qaPrimaryHitCoefficient === 0.5) return finish(result);
  const anchor = 'min(hitThreshold(t, p), 0.5 * pixel)';
  if (result.split(anchor).length !== 2) throw Error('QA primary-hit anchor changed');
  const hit = result.replace(anchor, `min(hitThreshold(t, p), ${options.qaPrimaryHitCoefficient} * pixel)`);
  return finish(hit);
}

/**
 * Computes the surface colour (before lighting, linear light) at many points with given normals.
 * Used for mesh export, so the vertex colours match the colours of the picture.
 */
export function buildColorShader(formulaCode: string): string {
  return /* wgsl */ `${UNIFORMS}${TEXTURE_BINDINGS}${ENV_BINDINGS}${ENV_FUNCTIONS}${MATERIAL_FUNCTIONS}${displayWgsl}
@group(0) @binding(1) var<storage, read> points : array<vec4f>;
@group(0) @binding(2) var<storage, read> normals : array<vec4f>;
@group(0) @binding(5) var<storage, read_write> colors : array<vec4f>;

${formulaCode}
${COLOR_FUNCTIONS}
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&points)) { return; }
  // The environment picture is read (and multiplied by 0) only so that it is part of the layout shared with the picture shader.
  let unused = textureSampleLevel(envTex, envSamp, vec2f(0.5, 0.5), 0.0).rgb * 0.0;
  colors[id.x] = vec4f(surfaceBaseColor(points[id.x].xyz, normals[id.x].xyz, 0) + unused, 1.0);
}
`;
}
