/**
 * The sculpting shader (SURFACE-LIGHTING-01), added to the picture shader only for scenes that switch it on (see surfaceLook.ts).
 * It changes how much light reaches a surface point and from where, never where the surface is: the geometry, the normal and the colour
 * are untouched. Everything is applied as exact text replacements on named anchors so that a scene without it keeps its shader byte for byte.
 *
 *  - farVisibility: a second, wider ambient-occlusion pass (u.artContrast.y strength, .z radius) over the same cosine-weighted hemisphere probes
 *    as the near AO, plus the bent normal: the average direction of the probes that found open space. It carries the large forms.
 *  - bent environment (u.artContrast.w): the environment's diffuse light is read in the bent-normal direction, so cavities lose the sky light
 *    that cannot reach them and open ridges keep it (the standard "bent normal" ambient lighting).
 *  - contact shadows (light mode 3): a soft shadow that only looks `contact_length` of the picture height towards the light (u.clipFlags.w),
 *    cheap because the march stops early, and resolution independent because the length is a share of the frame at that depth.
 * Probe pattern after Alex Evans (distance-field AO, as presented by Inigo Quilez); soft penumbra after Inigo Quilez. Own implementation.
 */
const FAR_VISIBILITY = /* wgsl */ `
// SURFACE-LIGHTING-01: wide AO and bent normal. xyz = the direction the point is open towards (the normal when unused), w = visibility.
fn farVisibility(p : vec3f, n : vec3f, epsilon : f32) -> vec4f {
  let strength = u.artContrast.y;
  if ((strength <= 0.0 && u.artContrast.w < 0.5) || (i32(u.view.w) & 2) != 0) { return vec4f(n, 1.0); }
  let tangent = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let bitangent = cross(n, tangent);
  let count = clamp(i32(u.ao.z), 4, 16);
  var blocked = 0.0; var total = 0.0; var open = vec3f(0.0);
  for (var i = 0; i < count; i++) {
    let fraction = (f32(i) + 1.0) / f32(count);
    let angle = f32(i) * 2.39996323 + 0.7;
    let cosine = sqrt(max(0.08, 1.0 - fraction * 0.92));
    let direction = n * cosine + sqrt(1.0 - cosine * cosine) * (tangent * cos(angle) + bitangent * sin(angle));
    let distance = max(u.artContrast.z * (0.35 + 0.65 * fract(f32(i) * 0.61803399)), epsilon * 4.0);
    let q = p + n * epsilon * 2.0 + direction * distance;
    let expected = epsilon * 2.0 + distance * dot(direction, n);
    let weight = 1.0 - 0.5 * fraction;
    var occlusion = 0.0;
    if (retained(q)) {
      let raw = formulaDistance(q);
      let d = select(max(raw, 0.0), abs(raw), any(u.clipFlags.xyz > vec3f(0.5)));
      occlusion = clamp((expected - d) / expected, 0.0, 1.0);
    }
    blocked += occlusion * weight;
    open += direction * ((1.0 - occlusion) * weight);
    total += weight;
  }
  let visibility = max(0.15, exp(-3.0 * strength * blocked / max(total, 1e-6)));
  var bent = n;
  if (u.artContrast.w > 0.5 && dot(open, open) > 1e-8) { bent = normalize(mix(n, normalize(open), 0.75)); }
  return vec4f(bent, visibility);
}
`;

/**
 * ARTISTIC-LIGHTING-02: two optional, independent artistic controls (all zero = off, and then the picture is the one scene 45 gave).
 *  - calm specular (u.cameraEffects.w strength, u.lensSample.z footprint in pixels): one extra normal is read at a coarser footprint. Where it
 *    disagrees with the fine normal (1 - dot is the variance), the roughness grows (Toksvig-style: the energy is spread, not removed), so one-pixel
 *    glints on dense ornament become a soft sheen while smooth areas (fine = coarse) keep their sharp reflections.
 *  - indirect occlusion (u.transport.z): occlusion of the ambient light, the environment light and the environment reflection gets stronger than the
 *    occlusion of the direct light, so cavities are not filled by light that cannot reach them (the occlusion is raised to 1 + the setting).
 * Toksvig 2005 (normal variance to roughness); the rest is own work.
 */
const ARTISTIC_LIGHT = /* wgsl */ `
var<private> lookVisibility : f32 = 1.0; // the occlusion of the last lighting() call, read by the specular occlusion

fn filteredRoughness(p : vec3f, n : vec3f, t : f32, rough : f32) -> f32 {
  let strength = u.cameraEffects.w;
  if (strength <= 0.0 || (i32(u.view.w) & 2) != 0) { return rough; }
  let wide = max(max(u.lensSample.z, 0.5) * pixelSize(t), normalStep(t, p) * 2.0);
  let coarse = sceneNormal(p, wide);
  let variance = select(0.0, clamp(1.0 - dot(n, coarse), 0.0, 1.0), dot(coarse, coarse) > 0.5);
  let alpha = rough * rough;
  return sqrt(sqrt(min(alpha * alpha + strength * 2.0 * variance, 1.0)));
}

fn specularVisibility(visibility : f32) -> f32 {
  let k = u.transport.z;
  if (k <= 0.0) { return 1.0; }
  return pow(visibility, min(k, 2.0));
}
`;

// `geo` is the normal the occlusion probes and the shadow origin use: the shading normal, or the geometric normal when surface detail is on
// (surfaceDetailWgsl.ts rewrites those two places before this transform runs). `pbr` is the extra factor material textures put on the indirect
// light (an occlusion map), empty otherwise.
const lightingHead = (geo: string, pbr: string): string => `  let ao = detailVisibility(p, ${geo}, u.ao, hitThreshold(tc, p));
  var sum = u.ambient.rgb * ao${pbr};
  if (u.env.x > 0.5) { sum = sum + envDiffuse(n) * ao${pbr}; }`;
const lightingHeadNew = (geo: string, pbr: string): string => `  let hitNear = hitThreshold(tc, p);
  let near = detailVisibility(p, ${geo}, u.ao, hitNear);
  let far = farVisibility(p, ${geo}, hitNear);
  let ao = near * far.w;
  lookVisibility = ao;
  let indirect = select(ao, pow(ao, 1.0 + u.transport.z), u.transport.z > 0.0);
  var sum = u.ambient.rgb * indirect${pbr};
  if (u.env.x > 0.5) { sum = sum + envDiffuse(select(n, far.xyz, u.artContrast.w > 0.5)) * indirect${pbr}; }`;
const shadowCall = (geo: string): string => `      shadow = shadowAmount(p + ${geo} * (6.0 * hit), toLight, tmax, c.w, b.w, hit);`;
const shadowCallNew = (geo: string): string => `      var reach = tmax;
      if (b.w > 2.5) { reach = min(tmax, select(0.04, u.clipFlags.w, u.clipFlags.w > 0.0) * pixelSize(tc) * u.view.y); }
      shadow = shadowAmount(p + ${geo} * (6.0 * hit), toLight, reach, c.w, b.w, hit);`;

/** Adds the sculpting functions and switches `lighting` to them. Throws when an anchor is missing (a changed shader must not silently lose the effect). */
export function integrateSurfaceLookShader(wgsl: string): string {
  const marker = "// How much light reaches the point: 1 = all, 0 = none.";
  if (wgsl.split(marker).length !== 2) throw Error("The sculpting shader insertion point changed");
  let out = wgsl.replace(marker, FAR_VISIBILITY + ARTISTIC_LIGHT + marker), changed = 0;
  // A shader may hold the lighting function more than once (for example one per ray kind); every copy gets the same change.
  for (const geo of ["n", "detailGeometric"]) {
    for (const pbr of ["", " * pbrAO()"]) if (out.includes(lightingHead(geo, pbr))) { out = out.split(lightingHead(geo, pbr)).join(lightingHeadNew(geo, pbr)); changed++; }
    if (out.includes(shadowCall(geo))) out = out.split(shadowCall(geo)).join(shadowCallNew(geo));
  }
  if (changed === 0) throw Error("The sculpting shader anchor changed: the head of the lighting function");
  if (!out.includes("var reach = tmax;")) throw Error("The sculpting shader anchor changed: the shadow call");
  // The material branch of the picture shader: a rougher surface where the normal is restless, and the occlusion of the environment reflection.
  const roughLine = /^( +)let rough = clamp\((.*), ([0-9.]+), 1\.0\);$/m;
  if (!roughLine.test(out) || !out.includes("+ environment * occ") || !out.includes("let primarySpecular = specAcc;")) throw Error("The artistic-light shader anchor changed: the material branch");
  return out
    .replace(roughLine, "$1let rough = filteredRoughness(p, n, t, clamp($2, $3, 1.0));")
    .replace("+ environment * occ", "+ environment * specularVisibility(primaryVisibility) * occ")
    .replace("let primarySpecular = specAcc;", "let primaryVisibility = lookVisibility; // the occlusion of the primary point (traced reflections call lighting() again)\n    let primarySpecular = specAcc;");
}
