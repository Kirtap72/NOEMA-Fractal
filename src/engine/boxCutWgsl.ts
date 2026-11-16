/** Applied last: legacy shader adapters retain their anchors and absent-box shaders stay identical. */
export function integrateBoxCutShader(shader: string): string {
  // The box block is written after the tune block (BOX_OFFSET in uniforms.ts), so its members must come after tuneColor; before that was fixed they sat right after
  // display and read the tune numbers as planes, which left the box cut without effect in the ordinary renderer. Shaders without the tune block keep the old place.
  const members = '\n  boxPlanes : array<vec4f, 6>,\n  boxFlags : vec4f,';
  shader = /tuneColor\s*:\s*vec4f,/.test(shader) ? shader.replace(/(tuneColor\s*:\s*vec4f,[^\n]*)/, (m) => m + members) : shader.replace(/(\s+display\s*:\s*vec4f,)/, '$1' + members);
  shader = shader.replace(/any\(u\.clipFlags\.xyz\s*>\s*vec3f\(0\.5\)\)/g, '(any(u.clipFlags.xyz > vec3f(0.5)) || u.boxFlags.x > 0.5)');
  shader = shader.replace('  return vec2f(near, far);', `  if (u.boxFlags.x > 0.5) {
    for (var i = 0u; i < 6u; i++) {
      let plane = u.boxPlanes[i];
      let d = dot(plane.xyz, origin) - plane.w;
      let slope = dot(plane.xyz, dir);
      if (abs(slope) < 1e-8) { if (d > 0.0) { return vec2f(1.0, 0.0); } }
      else if (slope > 0.0) { far = min(far, -d / slope); }
      else { near = max(near, -d / slope); }
    }
  }
  return vec2f(near, far);`);
  shader = shader.replace('fn retained(p : vec3f) -> bool {', `fn retained(p : vec3f) -> bool {
  if (u.boxFlags.x > 0.5) {
    for (var i = 0u; i < 6u; i++) { if (dot(u.boxPlanes[i].xyz, p) > u.boxPlanes[i].w) { return false; } }
  }`);
  return shader;
}
