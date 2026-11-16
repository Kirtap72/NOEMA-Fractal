import { BOX_FLOATS, packBoxCut } from "./boxCut";
import { FDISP_FLOATS } from "./fractalDisplacement";
import {defaultReflections,packReflections} from "./reflections";
import type {TransportSettings} from './transmission';
import type {ReflectionSettings,ReflectionBudget} from "./reflections";
import { focusDistance } from './cameraOptics';
import type { SceneCamera } from './camera';
import { LOOP_FLOATS, MAX_TOTAL_PARAMETERS } from "./formula/chain";
import { DETAIL_FLOATS, packRenderDetails } from "./renderDetails";
import type { CutoutSettings, DetailSettings } from "./renderDetails";
import type { CameraBasis } from "./camera";
import { COLOR_FLOATS } from "./gradient";
import { ENV_FLOATS, defaultEnvironment, packEnvironment } from "./environment";
import type { EnvironmentSettings } from "./environment";
import { DEFAULT_FOG, packFog } from "./fog";
import { MATERIAL_FLOATS, defaultMaterial, packMaterial } from "./material";
import type { MaterialSettings } from "./material";
import type { FogSettings } from "./fog";
import { DEFAULT_AMBIENT, defaultLights, LIGHT_FLOATS, packLights } from "./lights";
import type { AmbientSettings, LightSettings } from "./lights";
import { DEFAULT_QUALITY } from "./renderSetup";
import type { QualitySettings } from "./renderSetup";

/** Camera and screen: 5 vec4, then one vec4 for the tile being drawn. Formula parameters: 32 vec4 (up to 128 numbers). Then colour settings and colour table. */
export const TILE_OFFSET = 20;
export const PARAM_OFFSET = 24;
export const MAX_PARAM_VALUES = MAX_TOTAL_PARAMETERS;
export const COLOR_OFFSET = PARAM_OFFSET + MAX_PARAM_VALUES;
/** After the colour table: two more vec4: how carefully rays are marched, then the sample offset inside the pixel. */
export const MARCH_OFFSET = COLOR_OFFSET + COLOR_FLOATS;
/** Then the fog: two more vec4. */
export const FOG_OFFSET = MARCH_OFFSET + 8;
/** Then the ambient light and the lights: LIGHT_FLOATS numbers. */
export const LIGHTS_OFFSET = FOG_OFFSET + 8;
/** Then one vec4: x = 1 for the "pixel" precision mode, y = hit threshold in pixels, z = normal step in pixels, w = debug view. */
export const PREC_OFFSET = LIGHTS_OFFSET + LIGHT_FLOATS;
/** Then the Julia constant (xyz, and w = 1 when Julia mode is on), then the interpolation weights of up to 8 steps. */
export const JULIA_OFFSET = PREC_OFFSET + 4;
export const CHAINW_OFFSET = JULIA_OFFSET + 4;
/** Then the run-time loop block (SHADER-UNIFORMS-08): rounds, total iterations and the iterations of up to 8 steps. All zero = the numbers compiled into the shader. */
export const LOOPS_OFFSET = CHAINW_OFFSET + 8;
/** Then the environment: one vec4 (kind, exposure, rotation, background) and nine vec4 of the diffuse light. */
export const ENV_OFFSET = LOOPS_OFFSET + LOOP_FLOATS;
/** Then the material: MATERIAL_FLOATS numbers (see material.ts). */
export const MATERIAL_OFFSET = ENV_OFFSET + ENV_FLOATS;
export const DETAILS_OFFSET = MATERIAL_OFFSET + MATERIAL_FLOATS;
export const OPTICS_OFFSET = DETAILS_OFFSET + DETAIL_FLOATS;
export const REFLECTION_OFFSET = OPTICS_OFFSET + 8;
export const TRANSPORT_OFFSET = REFLECTION_OFFSET + 8;
export const NORMAL_FILM_OFFSET = TRANSPORT_OFFSET + 4;
export const CAMERA_SAMPLING_OFFSET = NORMAL_FILM_OFFSET + 4;
export const DISPLAY_OFFSET = CAMERA_SAMPLING_OFFSET + 4;
/** Two vec4 of values that are read at run time so that moving a slider never rebuilds the shader: orbit influence + secondary reflection gain, then the orbit diffuse colour. */
export const TUNE_OFFSET = DISPLAY_OFFSET + 4;
export const BOX_OFFSET = TUNE_OFFSET + 8;
/** Then the fractal displacement layers (FDISP_FLOATS numbers, see fractalDisplacement.ts); all zero = no displacement. */
export const FDISP_OFFSET = BOX_OFFSET + BOX_FLOATS;
export const UNIFORM_FLOATS = FDISP_OFFSET + FDISP_FLOATS;

/** What the chain needs at run time: weights per step (interpolation) and the Julia constant. */
export interface ChainUniforms {
  weights: readonly number[];
  /** x, y, z of the constant, and 1 when Julia mode is on. */
  julia: readonly [number, number, number, number];
  /** See chainLoopUniforms. Left out: zeros, so the shader uses the counts it was compiled with. */
  loops?: readonly number[];
}
export const PLAIN_CHAIN: ChainUniforms = { weights: [], julia: [0, 0, 0, 0] };

/** What the picture shows instead of the normal colours, to find out why a picture goes wrong. */
export const DEBUG_VIEWS = ["off", "steps", "exhausted", "raw", "measure"] as const;
export type DebugView = (typeof DEBUG_VIEWS)[number];

/** Packs camera, screen size, formula parameter values and colour data into the layout the shader expects. */
export function packUniforms(
  basis: CameraBasis,
  width: number,
  height: number,
  fovDegrees = 50,
  params: readonly number[] = [],
  color: ArrayLike<number> | undefined = undefined,
  /** Pixel offset of the part (tile) being drawn inside the whole image; width and height are those of the whole image. */
  tile: readonly [number, number] = [0, 0],
  out = new Float32Array(UNIFORM_FLOATS),
  /** How carefully rays are marched (see QualitySettings). */
  quality: Pick<QualitySettings, "hit_precision" | "step_factor" | "max_steps" | "max_distance" | "normal_epsilon" | "shadow_steps" | "precision_mode" | "hit_pixels" | "normal_pixels"> = DEFAULT_QUALITY,
  /** Where inside the pixel to look, in pixels from the centre. */
  jitter: readonly [number, number] = [0, 0],
  /** Fog (see fog.ts). Left out: no fog. */
  fog: FogSettings = DEFAULT_FOG,
  /** The lights. Left out: the one light and the ambient light that scenes had before version 9. `limit` keeps only that many of the strongest lights (the preview does). */
  lighting: { lights: readonly LightSettings[]; ambient: AmbientSettings; limit: number | null } = { lights: defaultLights(), ambient: DEFAULT_AMBIENT, limit: null },
  /** A debug view instead of the normal picture (see DEBUG_VIEWS). */
  debugView: DebugView = "off",
  /** Interpolation weights and the Julia constant. Left out: weights 1 and no Julia mode. */
  chain: ChainUniforms = PLAIN_CHAIN,
  /** The environment and the nine diffuse light coefficients of its picture. Left out: the gradient sky. */
  environment: { settings: EnvironmentSettings; sh: Float32Array | null } = { settings: defaultEnvironment(), sh: null },
  /** The material and the last mip level of the environment picture. Left out: the default material. */
  material: { settings: MaterialSettings; maxLod: number } = { settings: defaultMaterial(), maxLod: 0 },
  /** Temporary renderer feature mask. Zero is the unchanged final-quality path. */
  viewportMask = 0,
  rendering?: { cutout: CutoutSettings; details: DetailSettings },
  optics?: { camera: SceneCamera; sample: readonly [number,number] },
  reflections?: {settings:ReflectionSettings;budget?:ReflectionBudget;seed:number;sample:number},
  transport?:{settings:TransportSettings;maxBounces?:number},
  normalFilm:readonly [number,number,number,number]=[0,0,0,0],
): Float32Array {
  out.set([...basis.position, 0], 0);
  out.set([...basis.right, 0], 4);
  out.set([...basis.up, 0], 8);
  out.set([...basis.forward, 0], 12);
  out.set([width, height, Math.tan((fovDegrees * Math.PI) / 360), viewportMask], 16);
  out.set([tile[0], tile[1], 0, 0], TILE_OFFSET);
  out.fill(0, PARAM_OFFSET, COLOR_OFFSET);
  out.set(params.slice(0, MAX_PARAM_VALUES), PARAM_OFFSET);
  if (color) out.set(Array.prototype.slice.call(color, 0, COLOR_FLOATS), COLOR_OFFSET);
  out.set([quality.hit_precision, quality.step_factor, quality.max_steps, quality.max_distance], MARCH_OFFSET);
  out.set([jitter[0], jitter[1], quality.normal_epsilon, quality.shadow_steps], MARCH_OFFSET + 4);
  out.set(packFog(fog), FOG_OFFSET);
  out.set(packLights(lighting.lights, lighting.ambient, lighting.limit), LIGHTS_OFFSET);
  out.set([quality.precision_mode === "pixel" ? 1 : 0, quality.hit_pixels, quality.normal_pixels, DEBUG_VIEWS.indexOf(debugView)], PREC_OFFSET);
  out.set(chain.julia, JULIA_OFFSET);
  for (let i = 0; i < 8; i++) out[CHAINW_OFFSET + i] = chain.weights[i] ?? 1;
  for (let i = 0; i < LOOP_FLOATS; i++) out[LOOPS_OFFSET + i] = chain.loops?.[i] ?? 0;
  out.set(packEnvironment(environment.settings, environment.sh), ENV_OFFSET);
  out.set(packMaterial(material.settings, material.maxLod), MATERIAL_OFFSET);
  out.set(packRenderDetails(rendering?.cutout, rendering?.details), DETAILS_OFFSET);
  const camera=optics?.camera;
  out.set([camera?.projection==='orthographic'?(camera.ortho_height??4):0, camera?.dof?.enabled && camera.projection!=='orthographic' ? camera.dof.aperture_radius:0, camera?focusDistance(camera):1,0],OPTICS_OFFSET);
  out.set([...(optics?.sample??[0,0]),0,0],OPTICS_OFFSET+4);
  out.set(packReflections(reflections?.settings??defaultReflections(),reflections?.budget,reflections?.seed??0,reflections?.sample??0),REFLECTION_OFFSET);
  out.set([transport?.settings.enabled?1:0,Math.min(transport?.settings.maxBounces??0,transport?.maxBounces??8),0,0],TRANSPORT_OFFSET);
  // ARTISTIC-LIGHTING-02: the artistic light controls ride in slots that no shader read before (all zero = off).
  const look = rendering?.details?.sculpt;
  if (look?.enabled) {
    out[OPTICS_OFFSET + 3] = look.spec_filter ?? 0; out[OPTICS_OFFSET + 6] = look.spec_pixels ?? 3;
    out[TRANSPORT_OFFSET + 2] = look.indirect_occlusion ?? 0;
  }
  out.set(packBoxCut(rendering?.cutout.box), BOX_OFFSET);
  out.set(normalFilm,NORMAL_FILM_OFFSET);
  out.fill(0,CAMERA_SAMPLING_OFFSET,CAMERA_SAMPLING_OFFSET+4);
  out.set([1,1,0,0,1,1,1,0],TUNE_OFFSET); // neutral: full orbit influence, full gain; the engine writes the scene's own values
  return out;
}
