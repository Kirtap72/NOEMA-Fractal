/**
 * Surface looks (SURFACE-LIGHTING-01): a few finished lighting set-ups for sculptural pictures.
 *
 * A surface look writes ordinary scene values in one step (undoable like any edit): the lights, the ambient light, the occlusion and
 * contact-shadow settings, the tone curve and, where it matters, the material response. It never touches the formulas, the parameters, the
 * camera, the colours or the quality settings: it changes how light reaches the surface, never where the surface is.
 *
 * The distances of occlusion and contact shadows are given in PIXELS of the final picture and converted to scene units with the size of one
 * pixel at the subject, so a look behaves the same in a deep zoom and in a wide view, and at any resolution of the final picture.
 */
import { cameraBasis } from "./camera";
import { defaultAmbient, defaultLight } from "./lights";
import type { LightSettings, ShadowMode } from "./lights";
import { rigLightDirection } from "./lightRigs";
import type { MaterialSettings } from "./material";
import { defaultSculpt } from "./renderDetails";
import type { DetailSettings } from "./renderDetails";
import { displayValue } from "./display";
import type { DisplaySettings } from "./display";
import type { Scene } from "./scene";

export interface LookLight { role: string; name: string; azimuth: number; elevation: number; color: string; intensity: number; shadows: ShadowMode; softness?: number }

export interface SurfaceLook {
  id: string;
  name: string;
  /** One or two sentences in Swedish for the artist: what it is for, what it changes. */
  description: string;
  lights: readonly LookLight[];
  ambient: { color: string; intensity: number };
  /** Distances in pixels of the final picture. */
  ao: { strength: number; pixels: number; samples: number };
  cavity: { strength: number; pixels: number; samples: number; contrast: number };
  sculpt: { far_strength: number; far_pixels: number; bent_environment: boolean; contact_length: number; spec_filter?: number; spec_pixels?: number; indirect_occlusion?: number };
  display: DisplaySettings;
  /** Only the response of the surface to light; the colours are the artist's own. */
  material?: Partial<Pick<MaterialSettings, "metallic" | "roughness" | "reflectivity">>;
}

const L = (role: string, name: string, azimuth: number, elevation: number, color: string, intensity: number, shadows: ShadowMode = "none", softness = 0.3): LookLight => ({ role, name, azimuth, elevation, color, intensity, shadows, softness });

export const SURFACE_LOOKS: readonly SurfaceLook[] = [
  {
    id: "neutral",
    name: "Neutral detail review",
    description: "White main light obliquely from above and a weak cool fill light, moderate occlusion and short contact shadows. Shows the shape without colour mood; good for judging geometry and material.",
    lights: [L("key", "Look · Main light", 35, 40, "#ffffff", 1.1, "contact"), L("fill", "Look · Fill", -55, 10, "#e6edff", 0.3)],
    ambient: { color: "#ffffff", intensity: 0.1 },
    ao: { strength: 0.6, pixels: 30, samples: 6 },
    cavity: { strength: 0.25, pixels: 5, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.35, far_pixels: 200, bent_environment: true, contact_length: 0.03 },
    display: { exposure: 0, toneMapping: "linear", transfer: "legacy-gamma" },
  },
  {
    id: "sculpt",
    name: "Sculpture",
    description: "Low side light that puts shadows in every recess, cool fill light and a weak rim light from behind. Deep cavities, clear large shapes and soft filmic toning.",
    lights: [L("key", "Look · Side light", 58, 38, "#ffe8cc", 1.9, "contact"), L("fill", "Look · Fill", -75, 8, "#b8c8ff", 0.35), L("rim", "Look · Rim", 165, 25, "#ffffff", 0.45)],
    ambient: { color: "#c7d3ee", intensity: 0.24 },
    ao: { strength: 0.65, pixels: 40, samples: 8 },
    cavity: { strength: 0.35, pixels: 6, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.5, far_pixels: 300, bent_environment: true, contact_length: 0.05, spec_filter: 2, spec_pixels: 4, indirect_occlusion: 0.3 },
    display: { exposure: 0.5, toneMapping: "filmic", transfer: "srgb" },
  },
  {
    id: "harmony",
    name: "Harmonic sculpture",
    description: "A clear main light, a much weaker cool fill light and a little ambient light, so that shadows and cavities may be dark and large shapes read before the detail. Small glitter in dense ornamentation is softened (smooth surfaces keep their sharp reflections) and indirect light is not let into deep nooks.",
    lights: [L("key", "Look · Main light", 50, 42, "#ffe9d2", 2.1, "contact"), L("fill", "Look · Fill", -80, 12, "#c3d0f5", 0.18), L("rim", "Look · Rim", 170, 28, "#fff4e6", 0.4)],
    ambient: { color: "#c7d3ee", intensity: 0.16 },
    ao: { strength: 0.7, pixels: 40, samples: 8 },
    cavity: { strength: 0.35, pixels: 6, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.7, far_pixels: 600, bent_environment: true, contact_length: 0.05, spec_filter: 2.5, spec_pixels: 4, indirect_occlusion: 0.35 },
    display: { exposure: 0.05, toneMapping: "filmic", transfer: "srgb" },
  },
  {
    id: "mb-classic",
    name: "Mandelbulb Classic",
    description: "The classic Mandelbulb light: a single clear light obliquely from above left with sharp shadows, a weak cool fill from the front and dark, occlusion-driven nooks. More shadow separation and richer tones than even light, with the details intact.",
    lights: [L("key", "Look · Main light", -38, 48, "#fff0dc", 1.7, "contact"), L("fill", "Look · Fill", 32, 6, "#dfe6ff", 0.32)],
    ambient: { color: "#ffffff", intensity: 0.12 },
    ao: { strength: 0.8, pixels: 40, samples: 8 },
    cavity: { strength: 0.3, pixels: 6, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.4, far_pixels: 250, bent_environment: true, contact_length: 0.05, spec_filter: 1.5, spec_pixels: 3, indirect_occlusion: 0.2 },
    display: { exposure: -0.1, toneMapping: "filmic", transfer: "srgb" },
  },
  {
    id: "dramatic",
    name: "Dramatic sculpture",
    description: "Low, warm side light that almost grazes the surface, a barely noticeable fill light and a strong rim light from behind. Large shapes are lit against deep shadows; cavities may be black while the detail is carried by the edges.",
    lights: [L("key", "Look · Side light", 76, 20, "#ffd9ac", 2.7, "contact"), L("fill", "Look · Fill", -90, 2, "#9fb0e0", 0.13), L("rim", "Look · Rim", 158, 36, "#fff6ea", 0.9)],
    ambient: { color: "#b9c6e6", intensity: 0.11 },
    ao: { strength: 0.75, pixels: 40, samples: 8 },
    cavity: { strength: 0.35, pixels: 6, samples: 6, contrast: 1.1 },
    sculpt: { far_strength: 0.8, far_pixels: 500, bent_environment: true, contact_length: 0.06, spec_filter: 2, spec_pixels: 4, indirect_occlusion: 0.4 },
    display: { exposure: 0.6, toneMapping: "filmic", transfer: "srgb" },
  },
  {
    id: "cinematic",
    name: "High-contrast cinematic",
    description: "Warm orange main light against cool blue-green shadow and a cool rim light: colour contrast between light and shadow, as in a film grade. Rich tonal separation without the surfaces burning out.",
    lights: [L("key", "Look · Warm light", 62, 30, "#ffb878", 2.0, "contact"), L("fill", "Look · Cool fill", -70, 15, "#5fa8c0", 0.45), L("rim", "Look · Rim", 150, 30, "#dfeeff", 0.7)],
    ambient: { color: "#6f9bb0", intensity: 0.14 },
    ao: { strength: 0.7, pixels: 40, samples: 8 },
    cavity: { strength: 0.3, pixels: 6, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.6, far_pixels: 400, bent_environment: true, contact_length: 0.05, spec_filter: 2, spec_pixels: 4, indirect_occlusion: 0.35 },
    display: { exposure: 0.55, toneMapping: "filmic", transfer: "srgb" },
  },
  {
    id: "chiaroscuro",
    name: "Chiaroscuro",
    description: "A single strong main light obliquely from above left with real shadows that reach over the whole shape (not only contact shadows), almost no fill and a little ambient light. What the light does not reach may become genuinely dark while the lit edges and fine ornaments keep their detail. The light is moved, the picture is not darkened.",
    lights: [L("key", "Look · Main light", -38, 48, "#fff0dc", 2.4, "soft", 0.2), L("fill", "Look · Fill", 32, 6, "#dfe6ff", 0.11)],
    ambient: { color: "#ffffff", intensity: 0.054 },
    ao: { strength: 0.8, pixels: 40, samples: 8 },
    cavity: { strength: 0.3, pixels: 6, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.4, far_pixels: 250, bent_environment: true, contact_length: 0.05, spec_filter: 1.5, spec_pixels: 3, indirect_occlusion: 0.8 },
    display: { exposure: 0.0, toneMapping: "filmic", transfer: "srgb" },
  },
  {
    id: "golden",
    name: "Golden hour",
    description: "Warm low sunlight from the side, cool sky in the shadows and a warm rim light. Colour contrast between light and shadow; gives a rich, painterly mood.",
    lights: [L("key", "Look · Sol", 55, 28, "#ffb470", 1.6, "contact"), L("fill", "Look · Sky", -65, 22, "#6f90da", 0.45), L("rim", "Look · Rim", 150, 30, "#ffd8a8", 0.6)],
    ambient: { color: "#8fa6d0", intensity: 0.22 },
    ao: { strength: 0.65, pixels: 40, samples: 8 },
    cavity: { strength: 0.3, pixels: 6, samples: 6, contrast: 1 },
    sculpt: { far_strength: 0.45, far_pixels: 300, bent_environment: true, contact_length: 0.05, spec_filter: 2, spec_pixels: 4, indirect_occlusion: 0.3 },
    display: { exposure: 0.4, toneMapping: "filmic", transfer: "srgb" },
    material: { roughness: 0.4 },
  },
  {
    id: "moonlight",
    name: "Moonlight",
    description: "Cold, dark and dramatic: a blue side light, a strong white rim light and almost no fill. Low key that lets bright edges and deep shadows carry the shape.",
    lights: [L("key", "Look · Moonlight", -58, 40, "#a9c4ff", 2.2, "contact"), L("fill", "Look · Fill", -15, 10, "#6b86c9", 0.35), L("rim", "Look · Rim", 150, 20, "#ffffff", 1.0)],
    ambient: { color: "#6b7fb0", intensity: 0.22 },
    ao: { strength: 0.7, pixels: 40, samples: 8 },
    cavity: { strength: 0.35, pixels: 6, samples: 6, contrast: 1.1 },
    sculpt: { far_strength: 0.5, far_pixels: 300, bent_environment: true, contact_length: 0.06, spec_filter: 2, spec_pixels: 4, indirect_occlusion: 0.3 },
    display: { exposure: 0.6, toneMapping: "filmic", transfer: "srgb" },
    material: { roughness: 0.35, reflectivity: 0.35 },
  },
];

/** The size of one pixel of the final picture at the subject (scene units). */
export function pixelFootprint(scene: Pick<Scene, "camera">, subjectDistance: number, filmHeight: number): number {
  const cam = scene.camera;
  const worldHeight = cam.projection === "orthographic" && cam.ortho_height ? cam.ortho_height : 2 * Math.tan((cam.fov_degrees * Math.PI) / 360) * subjectDistance;
  return worldHeight / Math.max(1, filmHeight);
}

export interface LookContext { subjectDistance: number; filmHeight: number }

const lookLightId = (look: SurfaceLook, light: LookLight): string => `look-${look.id}-${light.role}`;

/** The look written into a copy of the scene. Only lights, ambient, details, display and (optionally) material response change. */
export function applySurfaceLook(scene: Scene, lookId: string, context: LookContext): Scene {
  const look = SURFACE_LOOKS.find((l) => l.id === lookId);
  if (!look) throw Error(`Unknown look "${lookId}"`);
  if (!(context.subjectDistance > 0) || !(context.filmHeight > 0)) throw Error("The distance of the subject and the height of the picture must be positive");
  const px = pixelFootprint(scene, context.subjectDistance, context.filmHeight);
  const basis = cameraBasis(scene.camera);
  const lights: LightSettings[] = look.lights.map((t) => ({
    ...defaultLight(),
    id: lookLightId(look, t), name: t.name, type: "directional", enabled: true, color: t.color, intensity: t.intensity,
    direction: rigLightDirection(basis, t.azimuth, t.elevation), shadows: t.shadows, shadow_softness: t.softness ?? 0.3,
  }));
  // Spot and point lights the artist placed stay; every directional light is replaced by the look's.
  const kept = scene.lights.filter((l) => l.type !== "directional");
  const ambient = { ...defaultAmbient(), color: look.ambient.color, intensity: look.ambient.intensity };
  const details: DetailSettings = {
    ...scene.details,
    ao: { enabled: true, strength: look.ao.strength, radius: look.ao.pixels * px, samples: look.ao.samples },
    cavity: { enabled: true, strength: look.cavity.strength, radius: look.cavity.pixels * px, samples: look.cavity.samples, contrast: look.cavity.contrast },
    sculpt: { ...defaultSculpt(), enabled: true, far_strength: look.sculpt.far_strength, far_radius: look.sculpt.far_pixels * px, bent_environment: look.sculpt.bent_environment, contact_length: look.sculpt.contact_length,
      // Calm reflections and indirect occlusion (ARTISTIC-LIGHTING-02). The footprint is in pixels of the final picture, read as pixels by the shader.
      spec_filter: look.sculpt.spec_filter ?? 0, spec_pixels: look.sculpt.spec_pixels ?? 3, indirect_occlusion: look.sculpt.indirect_occlusion ?? 0 },
  };
  return {
    ...scene,
    lights: [...kept, ...lights].slice(0, 8),
    ambient,
    details,
    display: { ...look.display },
    ...(look.material ? { material: { ...scene.material, ...look.material } } : {}),
  };
}

/** Null when a look can be applied, otherwise a sentence in Swedish saying why not (an animation drives a directional light that would go away). */
export function planSurfaceLook(scene: Scene, lookId: string): string | null {
  const look = SURFACE_LOOKS.find((l) => l.id === lookId);
  if (!look) return `Unknown look "${lookId}". No change.`;
  const keep = new Set(look.lights.map((t) => lookLightId(look, t)));
  const animated = new Set<string>();
  for (const track of scene.cameraFlight?.tracks.slice(1) ?? []) if (track.target.kind === "light") animated.add(track.target.objectId);
  const blocked = scene.lights.find((l) => l.type === "directional" && l.id !== undefined && animated.has(l.id) && !keep.has(l.id));
  if (blocked) return `The light "${blocked.name ?? blocked.id}" is controlled by an animation and would be removed. Remove the animation track first. No lights have been changed.`;
  if (!(Number.isFinite(scene.camera.position[0]) && Number.isFinite(scene.camera.target[0]))) return "The camera is invalid. No change.";
  return null;
}

/**
 * The exposure (in stops) that gives a picture the brightness an artist usually wants, measured on the pixels that hit the surface only
 * (the sky does not count). `linear` is a scene-linear RGBA picture, `depth` has one number per pixel (negative = no surface).
 * The median of the surface's luminance is mapped through the scene's own tone curve; because that curve only ever rises, the exposure
 * is found by bisection on the median alone. Clamped to a range that cannot turn a picture black or white.
 */
export function fitExposure(linear: Float32Array, depth: Float32Array, display: DisplaySettings, targetMedian = 70): { exposure: number; median: number; hits: number } {
  const luma: number[] = [];
  for (let i = 0; i < depth.length; i++) if (depth[i]! > 0) luma.push(0.2126 * linear[i * 4]! + 0.7152 * linear[i * 4 + 1]! + 0.0722 * linear[i * 4 + 2]!);
  if (luma.length < 16) return { exposure: display.exposure, median: NaN, hits: luma.length };
  luma.sort((a, b) => a - b);
  const median = luma[Math.floor(luma.length / 2)]!;
  const shown = (e: number): number => 255 * displayValue(median, { ...display, exposure: e });
  let lo = -8, hi = 8;
  if (shown(hi) < targetMedian) return { exposure: hi, median, hits: luma.length };
  if (shown(lo) > targetMedian) return { exposure: lo, median, hits: luma.length };
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (shown(mid) < targetMedian) lo = mid; else hi = mid; }
  return { exposure: Math.round(((lo + hi) / 2) * 20) / 20, median, hits: luma.length };
}
