/**
 * Geometry cache experiment (LOOKDEV-GEOCACHE, research only, never part of a normal shader).
 *
 * The picture shader spends about 86 % of its time finding the surface (the march along each ray) and the rest on normals and lighting
 * (docs/rendering/rq-01). At a fixed camera the surface does not change when the light does, so the march result can be kept and the light
 * recomputed from it. Two small text changes to the ordinary shader make that possible:
 *
 *  WRITE (profile stage 0, the ordinary picture): the second render target, which normally holds depth and normal, holds what the march found:
 *        x = distance along the ray (-1 = no surface), y = number of steps used, z = 1 when a surface was hit.
 *  READ  (profile stage 8): the march loop is skipped and the same three numbers are read from a texture (binding 20) instead.
 *
 * The normal at the hit is then recomputed by the ordinary code from the hit point (a few distance evaluations), and everything after the march
 * (colour, normal, shadows, occlusion, material, fog, tone curve) is the very same code. So a READ picture of unchanged geometry equals the picture
 * the full shader draws, bit for bit; the test of that is the point of the experiment.
 *
 * Exact text replacements on named anchors: a changed shader makes this throw instead of silently drawing something else.
 */
const BINDING_ANCHOR = "@group(0) @binding(7) var envSamp : sampler;";
const LOOP_ANCHOR = "  for (var i = 0; i < maxSteps; i++) {";
const AFTER_LOOP_ANCHOR = "  // A ray that neither hit the surface nor left the scene ran out of steps: its colour is a guess.";
const DATA_HIT = "out.data = vec4f(t, rawNormal.x, rawNormal.y, rawNormal.z);";
const DATA_SKY = "out.data = vec4f(-1.0, 0.0, 0.0, 0.0);";

/** Profile stage that means "read the march result from the cache". 0-7 are the existing profile stages. */
export const GEOMETRY_CACHE_READ_STAGE = 8;

/**
 * Scenes with own objects replace the whole primary march by one scene query (integratePrimitiveShader), so the loop anchors above do not
 * exist there. The cache then keeps the result of that query instead: distance, steps, which object was hit and, for objects, the exact
 * surface normal (octahedral, two floats, error about 1e-7). A fractal hit recomputes its normal from the hit point as before.
 * Layout of the data target: x = distance (-1 = no surface), y = steps + 65536 * (index + 2) (0 part = no surface), zw = packed object normal.
 */
const SCENE_ANCHOR = "  let sceneHit=queryScene(origin,dir,0);";
const SCENE_CACHE_WGSL = /* wgsl */ `
fn cacheOct(n:vec3f)->vec2f{let s=abs(n.x)+abs(n.y)+abs(n.z);var e=n.xy/max(s,1e-20);if(n.z<0.0){e=(vec2f(1.0)-abs(e.yx))*select(vec2f(-1.0),vec2f(1.0),e>=vec2f(0.0));}return e;}
fn cacheUnoct(e:vec2f)->vec3f{var v=vec3f(e.x,e.y,1.0-abs(e.x)-abs(e.y));if(v.z<0.0){let x=(vec2f(1.0)-abs(v.yx))*select(vec2f(-1.0),vec2f(1.0),v.xy>=vec2f(0.0));v.x=x.x;v.y=x.y;}return normalize(v);}
fn packSceneHit(h:SceneHit)->vec4f{
 let steps=f32(clamp(h.steps,0,65535));
 if(!h.hit){return vec4f(-1.0,steps,0.0,0.0);}
 let e=select(vec2f(0.0),cacheOct(h.normal),h.index>=0);
 return vec4f(h.distance,steps+65536.0*f32(h.index+2),e.x,e.y);
}
fn cachedSceneHit(origin:vec3f,dir:vec3f,c:vec4f)->SceneHit{
 let k=floor(c.y/65536.0);let steps=i32(c.y-k*65536.0);
 if(k<0.5){var miss=emptySceneHit(-1.0);miss.steps=steps;return miss;}
 let index=i32(k)-2;let t=c.x;let p=origin+dir*t;
 if(index<0){return SceneHit(p,t,sceneNormal(p,primaryNormalStep(t,p)),primaryHitThreshold(t,p),steps,true,false,0,0,0,-1);}
 let o=primitiveStore.objects[u32(index)];
 return SceneHit(p,t,cacheUnoct(c.zw),precisionFloor(p),steps,true,false,i32(o.identity.y),i32(o.identity.z),i32(o.identity.w),index);
}
`;

function sceneGeometryCacheShader(wgsl: string): string {
  for (const anchor of [BINDING_ANCHOR, SCENE_ANCHOR, DATA_HIT, DATA_SKY]) {
    if (wgsl.split(anchor).length !== 2) throw Error(`The geometry cache anchor is missing or not unique: ${anchor.slice(0, 50)}`);
  }
  return wgsl
    .replace(BINDING_ANCHOR, `${BINDING_ANCHOR}
@group(0) @binding(20) var gbuf : texture_2d<f32>;`)
    .replace(SCENE_ANCHOR, `  var sceneHit = emptySceneHit(u.march.w);
  if (u.tile.z > 7.5) { sceneHit = cachedSceneHit(origin, dir, textureLoad(gbuf, vec2i(frag.xy), 0)); }
  else { sceneHit = queryScene(origin, dir, 0); }`)
    .replace(DATA_HIT, "out.data = packSceneHit(sceneHit);")
    .replace(DATA_SKY, "out.data = packSceneHit(sceneHit);")
    + SCENE_CACHE_WGSL;
}

export function geometryCacheShader(wgsl: string): string {
  if (wgsl.includes(SCENE_ANCHOR)) return sceneGeometryCacheShader(wgsl);
  for (const anchor of [BINDING_ANCHOR, LOOP_ANCHOR, AFTER_LOOP_ANCHOR, DATA_HIT, DATA_SKY]) {
    if (wgsl.split(anchor).length !== 2) throw Error(`The geometry cache anchor is missing or not unique: ${anchor.slice(0, 50)}`);
  }
  return wgsl
    .replace(BINDING_ANCHOR, `${BINDING_ANCHOR}\n@group(0) @binding(20) var gbuf : texture_2d<f32>;`)
    .replace(LOOP_ANCHOR, "  for (var i = 0; i < select(maxSteps, 0, u.tile.z > 7.5); i++) {")
    .replace(AFTER_LOOP_ANCHOR, `  if (u.tile.z > 7.5) {
    let cached = textureLoad(gbuf, vec2i(frag.xy), 0);
    t = cached.x; steps = i32(cached.y); hit = cached.z > 0.5;
  }
${AFTER_LOOP_ANCHOR}`)
    .replace(DATA_HIT, "out.data = vec4f(t, f32(steps), 1.0, 0.0);")
    .replace(DATA_SKY, "out.data = vec4f(-1.0, f32(steps), 0.0, 0.0);");
}
