import {readGeometryDetail} from './adaptiveGeometry';
import type {GeometryDetailSettings} from './adaptiveGeometry';
import {displacementActive} from './displacement';
import {materialTexturesActive} from './materialTextures';
import {readSynthesizedDefinition,synthesizedLibrary,SYNTHESIS_PREFIX} from './synthesizedFormula';
import type {SynthesizedDefinition} from './synthesizedFormula';
import {withAnimationIdentities,validAnimationId} from './animationIdentity';
import {mathematicalTrackDiagnostics} from './propertyAnimation';
import {proceduralDetailActive} from './proceduralDetail';
import {surfaceDetailActive,surfaceMaterials} from './surfaceDetail';
import {texturedEntries} from './materialRamp';
import {defaultDisplay,readDisplay} from './display';
import {readFractalDisplacement} from './fractalDisplacement';
import type {FractalDisplacement} from './fractalDisplacement';
import type {DisplaySettings} from './display';
import {readPrimitives} from './primitives';
import {defaultTransport,readTransport} from './transmission';
import type {TransportSettings} from './transmission';
import {defaultDenoise,readDenoise} from './denoise';
import type {DenoiseSettings} from './denoise';
import type {ScenePrimitive} from './primitives';
import {defaultReflections,readReflections,readDiffuseGi} from "./reflections";
import type {ReflectionSettings,DiffuseGiSettings} from "./reflections";
import {fieldMapErrors,fieldResourcesKey} from './fieldMaps';
import type {FieldMap} from './fieldMaps';
import {KERNELS} from './formula/kernels';
import { readComposition } from './composition';
import type { CompositionSettings } from './composition';
import { groupExecutionErrors, chainExecutionErrors } from "./formula/groupExecution";
import type { ChainExecution } from "./formula/groupExecution";
import { defaultAnimation, readAnimation } from "./animation";
import { defaultCutout, defaultDetails, readCutout, readDetails } from "./renderDetails";
import { surfaceLookActive } from "./surfaceLook";
import type { CutoutSettings, DetailSettings } from "./renderDetails";
import type { Animation } from "./animation";
import {readCameraFlight} from './cameraFlight';
import type {CameraFlight} from './cameraFlight';
import { readSceneCamera } from "./camera";
import type { SceneCamera } from "./camera";
import { kernelChainTotalIterations } from "./formula/kernelChain";
import { chainLoopUniforms, CHAIN_MODES, MAX_ROUNDS, MAX_TOTAL_PARAMETERS, MAX_WEIGHTED_STEPS } from "./formula/chain";
import type { ChainMode } from "./formula/chain";
import type { StepFormula } from "./formula/chain";
import type { Formula } from "./formula/types";
import { DEFAULT_COLOR, packColor, readColorSettings } from "./gradient";
import type { ColorSettings } from "./gradient";
import { defaultEnvironment, readEnvironment } from "./environment";
import type { EnvironmentSettings } from "./environment";
import { defaultFog, readFog } from "./fog";
import { defaultMaterial, readMaterial } from "./material";
import type { MaterialSettings } from "./material";
import { defaultAmbient, defaultLights, readAmbient, readLights } from "./lights";
import type { AmbientSettings, LightSettings } from "./lights";
import type { FogSettings } from "./fog";
import { defaultRenderSetup, readRenderSetup } from "./renderSetup";
import type { RenderSetup } from "./renderSetup";

/** The newest scene format this engine understands. */
export const SCENE_SCHEMA_VERSION = 49;

export const MAX_CHAIN_STEPS = 8;
export const MAX_STEP_ITERATIONS = 64;
/** Upper limit of rounds x iterations, so a scene cannot freeze the graphics card. */
export const MAX_TOTAL_ITERATIONS = 256;
/** Limits of the per-formula step factor. */
export const STEP_FACTOR_LIMITS = [0.05, 1] as const;

/** One step of a chain: a formula, run for some iterations, with its own parameter values. */
export interface ChainStepData {
  /** Persistent formula-instance identity, assigned once at migration/edit time. */
  id?:string;
  /** The id of a formula file. */
  formula: string;
  /** Left out: the formula's own default. */
  iterations?: number;
  /** Values by parameter name. Missing ones use the formula's default. */
  parameters: Record<string, number>;
  /**
   * Safety margin for this formula (version 10): the march steps are multiplied by the smallest factor in the chain
   * (and by the global step factor). Below 1 for formulas whose distance estimate is too optimistic. Left out: 1.
   */
  step_factor?: number;
  /** "alternate" mode (version 11): run on every n-th round. Left out: 1. */
  every?: number;
  /** "alternate" mode (version 11): the first round the step runs on, counted from 0. Left out: 0. */
  start?: number;
  /** "interpolate" mode (version 11): the weight of this step in the blend. Left out: 1. */
  weight?: number;
}

/** Julia mode (version 11): a fixed constant is added in every iteration instead of the point itself. */
export interface JuliaSettings {
  enabled: boolean;
  c: [number, number, number];
}

/** Limits of the weight of a step in "interpolate" mode. */
export const WEIGHT_LIMITS = [0, 10] as const;

export interface FractalContent {
  id?:string;
  type: "fractal";
  /** Formulas run one after the other, in this order. */
  chain: ChainStepData[];
  /** How many times the whole chain is repeated. */
  rounds: number;
  /** How the steps are combined (version 11). Left out: "sequence". */
  mode?: ChainMode;
  /** Julia mode (version 11). Left out: off. */
  julia?: JuliaSettings;
  /** Version 14: bounded map/field groups; absent retains ordinary chain behavior. */
  execution?: ChainExecution;
}

export interface CreditEntry {
  formula: string;
  kind: "author" | "source";
  text: string;
  url?: string;
  status: "verified" | "unverified";
}

export interface Scene {
  /** Full validated mathematical data; compiled by the native expression path on reopen. */
  discoveredFormulas?:SynthesizedDefinition[];
  diffuseGi?:DiffuseGiSettings;
  denoise?:DenoiseSettings;
  transport?:TransportSettings;
  display?:DisplaySettings;
  /** Geometric displacement of the fractal's own surface by layered noise with masks (fractalDisplacement.ts). Absent = none. */
  fractalDisplacement?:FractalDisplacement;
  reflections: ReflectionSettings;
  primitives?: ScenePrimitive[];
  formulaFields?: FieldMap[];
  composition?: CompositionSettings;
  schema_version: number;
  /** Opt-in GEO5 candidate settings. Absent keeps the legacy solver. */
  geometryDetail?:GeometryDetailSettings;
  /** A label for exports, for example "meter". The engine itself has no unit. */
  units: string;
  camera: SceneCamera;
  /** Keyframes along a timeline: camera, parameters and colour. Added in version 4. */
  animation: Animation;
  /** Optional camera-only Animation 2.0 clip. Absent/disabled never affects a still scene. */
  cameraFlight?:CameraFlight;
  /** How the surface is coloured: gradient, measure and mapping. Added in version 2. */
  color: ColorSettings;
  /** Light sources (0 to 8) and the ambient light. Added in version 9. */
  lights: LightSettings[];
  ambient: AmbientSettings;
  /** Fog: colour mixed in with distance. Added in version 8. */
  fog: FogSettings;
  /** What is seen behind the shape and what lights it from all sides: the gradient sky, or an embedded HDRI picture. Added in version 12. */
  environment: EnvironmentSettings;
  /** Metal, roughness and reflectivity of the surface, each a number or driven by a measure. Added in version 13. */
  material: MaterialSettings;
  cutout: CutoutSettings;
  details: DetailSettings;
  /** Image format, size and field of view direction (version 6), and detail controls (version 7). */
  render: RenderSetup;
  /** What is drawn. Unknown types are kept out with a warning. */
  content: FractalContent[];
  /** Filled in when a scene is saved, so credits travel with the file. */
  credits?: CreditEntry[];
}

export type SceneParseResult = { ok: true; scene: Scene; warnings: string[] } | { ok: false; errors: string[] };

const KNOWN_KEYS = new Set(["diffuseGi","geometryDetail","discoveredFormulas","cameraFlight", "display", "transport", "denoise", "primitives", "reflections", "formulaFields", "composition", "schema_version", "units", "camera", "animation", "color", "fog", "environment", "material", "cutout", "details", "lights", "ambient", "render", "content", "credits"]);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isWhole = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

/**
 * Moves an older scene to the newest version, one step at a time. Add a step
 * (and a test) every time the scene format changes.
 */
export function migrateScene(raw: Obj): { ok: true; scene: Obj; warnings: string[] } | { ok: false; error: string } {
  const v = raw.schema_version;
  if (!Number.isInteger(v)) return { ok: false, error: "schema_version is required (a whole number)" };
  if ((v as number) > SCENE_SCHEMA_VERSION) {
    return { ok: false, error: `scene version ${v} is newer than this engine supports (${SCENE_SCHEMA_VERSION})` };
  }
  if ((v as number) < 1) return { ok: false, error: `unknown scene version ${v}` };
  let scene = raw;
  const warnings: string[] = [];
  // Version 1 -> 2: colour settings were added. Old scenes get the default colouring.
  if (scene.schema_version === 1) {
    scene = { ...scene, schema_version: 2, color: structuredClone(DEFAULT_COLOR) };
  }
  // Version 2 -> 3: one formula became a chain of steps. The old formula is a chain of one step.
  if (scene.schema_version === 2) {
    const content = Array.isArray(scene.content)
      ? scene.content.map((c: unknown) => {
          if (!isObj(c) || c.type !== "fractal" || c.chain !== undefined || typeof c.formula !== "string") return c;
          const { formula, parameters, ...rest } = c;
          return { ...rest, chain: [{ formula, ...(parameters !== undefined ? { parameters } : {}) }] };
        })
      : scene.content;
    scene = { ...scene, schema_version: 3, content };
  }
  // Version 3 -> 4: the reserved camera paths became a real animation. The first path becomes the
  // keyframes (each with the scene's current parameters and colour); the rest is dropped with a warning.
  if (scene.schema_version === 3) {
    const { camera_paths, ...rest } = scene;
    const animation = defaultAnimation() as unknown as Obj;
    const paths = Array.isArray(camera_paths) ? camera_paths : [];
    const first = paths[0];
    if (paths.length > 1) warnings.push("only the first camera path was kept when updating the scene to version 4");
    if (isObj(first) && Array.isArray(first.keyframes) && first.keyframes.length > 0) {
      const content = Array.isArray(rest.content) ? rest.content : [];
      const fractal = content.find((c: unknown) => isObj(c) && c.type === "fractal");
      const chain = isObj(fractal) && Array.isArray(fractal.chain) ? fractal.chain : [];
      const steps = chain.map((c: unknown) => ({ parameters: isObj(c) && isObj(c.parameters) ? { ...c.parameters } : {} }));
      const keyframes = first.keyframes.map((k: unknown) =>
        isObj(k) ? { time_seconds: k.time_seconds, camera: k.camera, steps, color: rest.color } : k,
      );
      const last = keyframes.reduce((m: number, k: unknown) => (isObj(k) && typeof k.time_seconds === "number" ? Math.max(m, k.time_seconds) : m), 0);
      Object.assign(animation, { keyframes, duration_seconds: Math.max(10, last) });
    }
    scene = { ...rest, schema_version: 4, animation };
  }
  // Version 4 -> 5: colour settings may have a texture. Nothing has to change in an old scene.
  if (scene.schema_version === 4) scene = { ...scene, schema_version: 5 };
  // Version 5 -> 6: image format and size were added. Old scenes follow the window and measure the field of view
  // vertically, which is exactly how they were drawn before.
  if (scene.schema_version === 5) scene = { ...scene, schema_version: 6, render: defaultRenderSetup() };
  // Version 6 -> 7: the render block may have a quality block (samples, precision, steps, ...). Left out means the
  // values that used to be built into the shader, so old scenes are drawn exactly as before.
  if (scene.schema_version === 6) scene = { ...scene, schema_version: 7 };
  // Version 7 -> 8: fog was added. Old scenes get fog that is switched off, so they look exactly as before.
  if (scene.schema_version === 7) scene = { ...scene, schema_version: 8, fog: defaultFog() };
  // Version 8 -> 9: lights and an ambient light were added. Old scenes get the one light and the ambient light that
  // used to be built into the shader, so they look exactly as before.
  if (scene.schema_version === 8) scene = { ...scene, schema_version: 9, lights: defaultLights(), ambient: defaultAmbient() };
  // Version 9 -> 10: a step factor per formula and the "pixel" precision mode were added. Both are optional, and left
  // out they mean exactly what scenes had before.
  if (scene.schema_version === 9) scene = { ...scene, schema_version: 10 };
  // Version 10 -> 11: chain modes (alternate, interpolate) and Julia mode were added. All optional: left out they mean
  // the plain sequence without Julia mode, exactly what scenes had before.
  if (scene.schema_version === 10) scene = { ...scene, schema_version: 11 };
  // Version 11 -> 12: an environment (gradient sky or an HDRI picture) was added. Old scenes get the gradient sky that
  // was built into the shader, so they look exactly as before.
  if (scene.schema_version === 11) scene = { ...scene, schema_version: 12, environment: defaultEnvironment() };
  // Version 12 -> 13: a material (metal, roughness, reflectivity) was added. Old scenes get the matt material with no
  // metal and no reflection, which adds nothing, so they look exactly as before.
  if (scene.schema_version === 12) scene = { ...scene, schema_version: 13, material: defaultMaterial() };
  if (scene.schema_version === 13) scene = { ...scene, schema_version: 14 };
  if (scene.schema_version === 14) scene = { ...scene, schema_version: 15, cutout: scene.cutout ?? defaultCutout(), details: scene.details ?? defaultDetails() };
  if (scene.schema_version === 15) {
    const details = scene.details as Record<string, unknown> | undefined;
    scene = { ...scene, schema_version: 16, details: details ? { ...details, edge_softening: details.edge_softening ?? defaultDetails().edge_softening, cavity: { ...(details.cavity as Record<string, unknown>), contrast: (details.cavity as Record<string, unknown>)?.contrast ?? 1 } } : defaultDetails() };
  }
  if(scene.schema_version===16)scene={...scene,schema_version:17};
  if(scene.schema_version===17)scene={...scene,schema_version:18};
  if(scene.schema_version===18)scene={...scene,schema_version:19,reflections:defaultReflections()};
  if(scene.schema_version===19)scene={...scene,schema_version:20,primitives:[]};
  if(scene.schema_version===20)scene={...scene,schema_version:21,reflections:isObj(scene.reflections)?{...scene.reflections,maxReflectionBounces:1}:scene.reflections};
  if(scene.schema_version===21)scene={...scene,schema_version:22};
  if(scene.schema_version===22)scene={...scene,schema_version:23,denoise:defaultDenoise()};
  // Material v1: absent extension fields resolve to neutral values, preserving all old curves and colours.
  if(scene.schema_version===23)scene={...scene,schema_version:24};
  if(scene.schema_version===24)scene={...scene,schema_version:25,transport:defaultTransport()};
  if(scene.schema_version===25)scene={...scene,schema_version:26,display:defaultDisplay()};
  if(scene.schema_version===26)scene={...scene,schema_version:27};
  if(scene.schema_version===27)scene={...scene,schema_version:28};
  // Camera-flight v1 is optional. Migration never enables animation or changes a still camera.
  if(scene.schema_version===28)scene={...scene,schema_version:29};
  if(scene.schema_version===29)scene={...scene,schema_version:30};
  if(scene.schema_version===30)scene={...scene,schema_version:31};
  // Independent DE groups are opt-in; older scenes retain all authored values.
  if(scene.schema_version===31)scene={...scene,schema_version:32};
  // M2A texture sets are optional: preserve every legacy field and appearance.
  if(scene.schema_version===32)scene={...scene,schema_version:33};
  // Box Cut is opt-in: no box is inserted into existing scenes.
  if(scene.schema_version===33)scene={...scene,schema_version:34};
  // M2B is optional; no deformation is inserted into legacy scenes.
  if(scene.schema_version===34)scene={...scene,schema_version:35};
  // Stable appearance IDs are assigned by the validated identity normalizer, with no artistic changes.
  if(scene.schema_version===35)scene={...scene,schema_version:36};
  // Optional primary normal policy; absence keeps legacy arithmetic and existing preset payloads intact.
  if(scene.schema_version===36)scene={...scene,schema_version:37};
  if(scene.schema_version===37)scene={...scene,schema_version:38};
  if(scene.schema_version===38)scene={...scene,schema_version:39};
  if(scene.schema_version===39)scene={...scene,schema_version:40};
  if(scene.schema_version===40)scene={...scene,schema_version:41};
  // Material Gradient is optional (stop.material / stop.transition); migration never adds or changes a stop, so older gradients stay identical.
  if(scene.schema_version===41)scene={...scene,schema_version:42};
  // MATERIAL-GRADIENT-02: stop materials may carry PBR maps and a texture scale, stops may carry a softness; all optional, so migration changes nothing.
  if(scene.schema_version===42)scene={...scene,schema_version:43};
  // The Float32 floor scale (render.quality.precision_floor) is optional; absent keeps the floor every earlier scene had.
  if(scene.schema_version===43)scene={...scene,schema_version:44};
  // SURFACE-LIGHTING-01: details.sculpt and the "contact" shadow mode are optional; absent keeps every earlier look.
  if(scene.schema_version===44)scene={...scene,schema_version:45};
  // ARTISTIC-LIGHTING-02: details.sculpt may carry spec_filter, spec_pixels, indirect_occlusion, form_light and form_pixels; all optional (absent = off).
  if(scene.schema_version===45)scene={...scene,schema_version:46};
  // Independent field operations min/max/smooth-min are opt-in; existing executions keep max-inverted-second untouched.
  if(scene.schema_version===46)scene={...scene,schema_version:47};
  // ARTIST-WORKFLOW 02: the fog density limit grew from 100 to 1e6 (genuine full fog in very small scenes). Every earlier fog is still valid and unchanged.
  if(scene.schema_version===47)scene={...scene,schema_version:48};
  // Fractal displacement (fractalDisplacement) is optional: absent = the fractal's own surface, so migration changes nothing.
  if(scene.schema_version===48)scene={...scene,schema_version:49};
  return { ok: true, scene, warnings };
}

function readChain(raw: unknown, where: string, errors: string[]): ChainStepData[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CHAIN_STEPS) {
    errors.push(`${where} must be a list of 1 to ${MAX_CHAIN_STEPS} steps`);
    return undefined;
  }
  const before = errors.length;
  const steps: ChainStepData[] = [];
  raw.forEach((s: unknown, i: number) => {
    const w = `${where}[${i}]`;
    if (!isObj(s) || typeof s.formula !== "string" || s.formula.length === 0) return void errors.push(`${w}.formula is required`);
    if (s.iterations !== undefined && !isWhole(s.iterations, 1, MAX_STEP_ITERATIONS)) {
      errors.push(`${w}.iterations must be a whole number from 1 to ${MAX_STEP_ITERATIONS}`);
    }
    if(s.id!==undefined&&!validAnimationId(s.id))errors.push(w+'.id must be a valid persistent identity');
    const parameters: Record<string, number> = {};
    if (s.parameters !== undefined) {
      if (!isObj(s.parameters)) return void errors.push(`${w}.parameters must be a mapping`);
      for (const [name, value] of Object.entries(s.parameters)) {
        if (isNum(value)) parameters[name] = value;
        else errors.push(`${w}.parameters.${name} must be a number`);
      }
    }
    if (s.step_factor !== undefined && !(isNum(s.step_factor) && s.step_factor >= STEP_FACTOR_LIMITS[0] && s.step_factor <= STEP_FACTOR_LIMITS[1])) {
      errors.push(`${w}.step_factor must be a number from ${STEP_FACTOR_LIMITS[0]} to ${STEP_FACTOR_LIMITS[1]}`);
    }
    if (s.every !== undefined && !isWhole(s.every, 1, MAX_ROUNDS)) errors.push(`${w}.every must be a whole number from 1 to ${MAX_ROUNDS}`);
    if (s.start !== undefined && !isWhole(s.start, 0, MAX_ROUNDS - 1)) errors.push(`${w}.start must be a whole number from 0 to ${MAX_ROUNDS - 1}`);
    if (s.weight !== undefined && !(isNum(s.weight) && s.weight >= WEIGHT_LIMITS[0] && s.weight <= WEIGHT_LIMITS[1])) {
      errors.push(`${w}.weight must be a number from ${WEIGHT_LIMITS[0]} to ${WEIGHT_LIMITS[1]}`);
    }
    steps.push({
      formula: s.formula,
      ...(s.id!==undefined?{id:s.id as string}:{}),
      ...(s.iterations !== undefined ? { iterations: s.iterations as number } : {}),
      parameters,
      ...(isNum(s.step_factor) ? { step_factor: s.step_factor } : {}),
      ...(isWhole(s.every, 1, MAX_ROUNDS) ? { every: s.every as number } : {}),
      ...(isWhole(s.start, 0, MAX_ROUNDS - 1) ? { start: s.start as number } : {}),
      ...(isNum(s.weight) ? { weight: s.weight } : {}),
    });
  });
  return errors.length > before ? undefined : steps;
}

/** Reads the Julia settings of a fractal. Left out: undefined (off). */
function readJulia(raw: unknown, where: string, errors: string[]): JuliaSettings | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) return void errors.push(`${where} must be an object`);
  const enabled = raw.enabled === undefined ? false : raw.enabled;
  if (typeof enabled !== "boolean") errors.push(`${where}.enabled must be true or false`);
  const cc = raw.c === undefined ? [0, 0, 0] : raw.c;
  const ok = Array.isArray(cc) && cc.length === 3 && cc.every((n) => isNum(n) && Math.abs(n) <= 1000);
  if (!ok) errors.push(`${where}.c must be three numbers (from -1000 to 1000)`);
  if (typeof enabled !== "boolean" || !ok) return undefined;
  return { enabled, c: [cc[0], cc[1], cc[2]] as [number, number, number] };
}

/** Reads and checks a scene (JSON text or an already parsed object). All problems are reported together. */
export function parseScene(input: string | unknown): SceneParseResult {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }
  if (!isObj(doc)) return { ok: false, errors: ["a scene must be a JSON object"] };

  const migrated = migrateScene(doc);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };
  const raw = migrated.scene;

  const errors: string[] = [];
  const warnings: string[] = [...migrated.warnings];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`unknown field "${key}" was ignored`);
  }

  const units = raw.units === undefined ? "unit" : raw.units;
  if (typeof units !== "string" || units.length === 0) errors.push("units must be a text");

  const cam = readSceneCamera(raw.camera, "camera", errors);
  const color = readColorSettings(raw.color, "color", errors);

  const animation = readAnimation(raw.animation, "animation", errors);
  const cameraFlight=raw.cameraFlight===undefined?undefined:readCameraFlight(raw.cameraFlight,'cameraFlight',errors);
  const render = readRenderSetup(raw.render, "render", errors);
  let geometryDetail:GeometryDetailSettings|undefined;
  if(raw.geometryDetail!==undefined){try{geometryDetail=readGeometryDetail(raw.geometryDetail);}catch(e){errors.push(String(e));}}
  const fog = readFog(raw.fog, "fog", errors);
  const environment = readEnvironment(raw.environment, "environment", errors);
  const material = readMaterial(raw.material, "material", errors);
  const cutout = readCutout(raw.cutout, errors);
  const details = readDetails(raw.details, errors);
  const lights = readLights(raw.lights, "lights", errors);
  const ambient = readAmbient(raw.ambient, "ambient", errors);

  let discoveredFormulas:SynthesizedDefinition[]|undefined;
  if(raw.discoveredFormulas!==undefined){try{if(!Array.isArray(raw.discoveredFormulas)||raw.discoveredFormulas.length>32)throw Error('At most 32 embedded mathematical definitions');discoveredFormulas=raw.discoveredFormulas.map(readSynthesizedDefinition);if(new Set(discoveredFormulas.map(d=>d.id)).size!==discoveredFormulas.length)throw Error('Duplicate embedded mathematical identities');}catch(e){errors.push(String((e as Error).message));}}
  const content: FractalContent[] = [];
  if (!Array.isArray(raw.content)) errors.push("content must be a list");
  else {
    raw.content.forEach((c: unknown, i: number) => {
      const where = `content[${i}]`;
      if (!isObj(c) || typeof c.type !== "string") return void errors.push(`${where}: needs a type`);
      if (c.type !== "fractal") {
        return void warnings.push(`${where}: content type "${c.type}" is not supported and was ignored`);
      }
      if(c.id!==undefined&&!validAnimationId(c.id))errors.push(where+'.id must be a valid persistent identity');
      const chain = readChain(c.chain, `${where}.chain`, errors);
      const rounds = c.rounds === undefined ? 1 : c.rounds;
      if (!isWhole(rounds, 1, MAX_ROUNDS)) errors.push(`${where}.rounds must be a whole number from 1 to ${MAX_ROUNDS}`);
      const mode = c.mode === undefined ? undefined : c.mode;
      if (mode !== undefined && !(typeof mode === "string" && (CHAIN_MODES as readonly string[]).includes(mode))) {
        errors.push(`${where}.mode must be one of: ${CHAIN_MODES.join(", ")}`);
      }
      if (mode === "interpolate" && chain && chain.length > MAX_WEIGHTED_STEPS) errors.push(`${where}: interpolation takes at most ${MAX_WEIGHTED_STEPS} steps`);
      if(c.execution !== undefined) errors.push(...groupExecutionErrors(c.execution,chain?.length??0).map(e=>`${where}.execution: ${e}`));
      const julia = readJulia(c.julia, `${where}.julia`, errors);
      if (chain && isWhole(rounds, 1, MAX_ROUNDS)) {
        content.push({
          type: "fractal",
          ...(c.id!==undefined?{id:c.id as string}:{}),
          chain,
          rounds,
          ...(typeof mode === "string" && (CHAIN_MODES as readonly string[]).includes(mode) && mode !== "sequence" ? { mode: mode as ChainMode } : {}),
          ...(julia ? { julia } : {}),
          ...(c.execution!==undefined && !groupExecutionErrors(c.execution,chain.length).length ? {execution:structuredClone(c.execution) as ChainExecution} : {}),
        });
      }
    });
  }

  if(content.some(c=>c.chain.some(step=>step.formula.startsWith(SYNTHESIS_PREFIX)&&!discoveredFormulas?.some(d=>d.id===step.formula))))errors.push('A discovered formula needs its full embedded AST; no substitute is allowed');
  if(cameraFlight&&cameraFlight.version>=2&&cameraFlight.tracks.some(t=>t.kind==='property'&&(t.target.kind==='julia'||t.target.kind==='formula-parameter'))&&content.some(c=>!c.id||c.chain.some(s=>!s.id)))errors.push('Mathematical clips in scene 30 require stored content/step IDs; missing IDs cannot be guessed for a bound track');
  if(cameraFlight?.version===3){for(const t of cameraFlight.tracks.slice(1)){const target=t.target;if(target.kind==='light'&&lights?.some(l=>!l.id)||target.kind==='gradient-stop'&&color?.gradient.stops.some(s=>!s.id))errors.push('Appearance-bound clips require stored light/stop IDs; missing identities cannot be guessed');}}
  const identities=content.flatMap(c=>[c.id,...c.chain.map(s=>s.id)]).filter((id):id is string=>!!id);
  if(new Set(identities).size!==identities.length)errors.push('Content/step identities must be globally unique');
  if (animation && content[0]) {
    const n = content[0].chain.length;
    animation.keyframes.forEach((k, i) => {
      if (k.steps.length !== n) errors.push(`animation.keyframes[${i}].steps has ${k.steps.length} entries but the chain has ${n} steps`);
    });
  }

  const primitives=readPrimitives(raw.primitives,errors);
  const reflections=readReflections(raw.reflections,errors);
  const diffuseGi=readDiffuseGi(raw.diffuseGi,errors);
  const denoise=readDenoise(raw.denoise,errors);
  const transport=readTransport(raw.transport,errors);
  const display=readDisplay(raw.display,errors);
  const fractalDisplacement=readFractalDisplacement(raw.fractalDisplacement,'fractalDisplacement',errors);
  const composition=readComposition(raw.composition,errors);
  if(raw.formulaFields!==undefined)errors.push(...fieldMapErrors(raw.formulaFields));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    scene: withAnimationIdentities({
      schema_version: SCENE_SCHEMA_VERSION,
      ...(geometryDetail?{geometryDetail}:{}),
      ...(discoveredFormulas?{discoveredFormulas}:{}),
      ...(raw.formulaFields!==undefined?{formulaFields:structuredClone(raw.formulaFields) as FieldMap[]}:{}),
      units: units as string,
      camera: cam!,
      ...(composition?{composition}:{}),
      animation: animation!,
      ...(cameraFlight?{cameraFlight}:{}),
      color: color!,
      fog: fog!,
      environment: environment!,
      material: material!,
      reflections,
      ...(raw.diffuseGi!==undefined?{diffuseGi}:{}),
      denoise,
      transport,
      display,
      ...(fractalDisplacement?{fractalDisplacement}:{}),
      primitives,
      cutout: cutout!,
      details: details!,
      lights: lights!,
      ambient: ambient!,
      render: render!,
      content,
    }),
  };
}

/** A starting step for a formula: its own default iterations and parameter values. */
export function defaultStep(formula: Formula): ChainStepData {
  return {
    formula: formula.id,
    iterations: formula.iterations,
    parameters: Object.fromEntries(formula.parameters.map((p) => [p.name, p.default])),
  };
}

/** A starting scene for a formula: a chain of one step and a camera looking at the origin. */
export function createDefaultScene(formula: Formula): Scene {
  const d = formula.cameraDistance ?? 4;
  const yaw = 0.6;
  const pitch = 0.35;
  return {
    schema_version: SCENE_SCHEMA_VERSION,
    units: "unit",
    camera: {
      position: [d * Math.cos(pitch) * Math.sin(yaw), d * Math.sin(pitch), d * Math.cos(pitch) * Math.cos(yaw)],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov_degrees: 50,
    },
    animation: defaultAnimation(),
    color: structuredClone(DEFAULT_COLOR),
    fog: defaultFog(),
    environment: defaultEnvironment(),
    material: defaultMaterial(),
    reflections: defaultReflections(),
    denoise: defaultDenoise(),
    transport: defaultTransport(),
    display: defaultDisplay(),
    primitives: [],
    cutout: defaultCutout(),
    details: defaultDetails(),
    lights: defaultLights(),
    ambient: defaultAmbient(),
    render: defaultRenderSetup(),
    content: [{ type: "fractal", chain: [defaultStep(formula)], rounds: 1 }],
  };
}

export interface ResolvedStep {
  formula: Formula;
  iterations: number;
  /** One value per parameter of this step's formula, in the formula's order. */
  parameterValues: number[];
}

export interface ResolvedScene {
  scene: Scene;
  chain: ResolvedStep[];
  rounds: number;
  /** All steps' parameter values after each other, in the order of the shader's parameter slots. */
  parameterValues: number[];
  /** Same key = same shader. Parameter values are not part of it, so moving a slider needs no new shader. */
  key: string;
  /** Colour settings packed for the shader (settings and a table of colours). */
  colorData: Float32Array;
  /** True when rounds and iteration counts are read at run time (any chain without a grouped execution): they are then not part of `key`. See chainLoopUniforms. */
  dynamicLoops: boolean;
  /** The run-time loop block for the uniform buffer (rounds, total, iterations per step). */
  loops: number[];
  /** The smallest step factor of the chain's formulas (1 when none is set). Multiplies the global step factor. */
  stepFactor: number;
  /** How the chain combines its steps. */
  mode: ChainMode;
  execution?: ChainExecution;
  /** "interpolate": the weight of each step (1 when not set). */
  chainWeights: number[];
  /** The Julia constant and 1 when Julia mode is on (all 0 when off). */
  julia: [number, number, number, number];
  /** "alternate": when each step runs. */
  schedule: { every: number; start: number }[];
  warnings: string[];
}

export type ResolveResult = ({ ok: true } & ResolvedScene) | { ok: false; errors: string[] };

/** Matches a scene with the formulas it refers to, and fills in iterations and parameter values. */
export function resolveScene(scene: Scene, formulas: readonly Formula[]): ResolveResult {
  try{formulas=synthesizedLibrary(scene.discoveredFormulas,formulas);}catch(e){return {ok:false,errors:[(e as Error).message]};}
  const fractal = scene.content[0];
  if (!fractal) return { ok: false, errors: ["the scene has no fractal to draw"] };
  if(fractal.chain.some(s=>s.formula.startsWith(SYNTHESIS_PREFIX))&&(fractal.chain.length!==1||fractal.rounds!==1||fractal.execution||fractal.julia?.enabled||fractal.mode&&fractal.mode!=='sequence'||(fractal.chain[0]!.iterations??12)>16))return {ok:false,errors:['Synthesized AST MVP supports one formula, one round and at most 16 iterations; mixed chains and Julia are unsupported']};
  if(fractal.chain.some(s=>s.formula.startsWith(SYNTHESIS_PREFIX)&&!scene.discoveredFormulas?.some(d=>d.id===s.formula)))return {ok:false,errors:['Discovered source AST is missing; session formulas are not a substitute']};
  const primitiveErrors:string[]=[];readPrimitives(scene.primitives,primitiveErrors);if(primitiveErrors.length)return {ok:false,errors:primitiveErrors};
  const warnings: string[] = [];
  if (scene.content.length > 1) warnings.push("only the first content entry is drawn so far");

  const diagnostics=mathematicalTrackDiagnostics(scene,formulas);
  warnings.push(...diagnostics.warnings);
  const errors: string[] = [...diagnostics.errors];
  const chain: ResolvedStep[] = [];
  fractal.chain.forEach((s, i) => {
    const prefix = `step ${i + 1}`;
    const formula = formulas.find((f) => f.id === s.formula);
    if (!formula) return void errors.push(`${prefix}: formula "${s.formula}" was not found in the library`);
    const iterations = s.iterations ?? formula.iterations;
    if (!isWhole(iterations, 1, MAX_STEP_ITERATIONS)) {
      return void errors.push(`${prefix}: iterations must be a whole number from 1 to ${MAX_STEP_ITERATIONS}`);
    }
    const known = new Set(formula.parameters.map((p) => p.name));
    for (const name of Object.keys(s.parameters)) {
      if (!known.has(name)) warnings.push(`${prefix}: parameter "${name}" does not exist in ${formula.id} and was ignored`);
    }
    const parameterValues = formula.parameters.map((p) => {
      const value = s.parameters[p.name] ?? p.default;
      const clamped = Math.min(p.max, Math.max(p.min, value));
      if (clamped !== value) warnings.push(`${prefix}: parameter "${p.name}" was ${value}, limited to ${clamped}`);
      return clamped;
    });
    chain.push({ formula, iterations, parameterValues });
  });
  if (errors.length > 0) return { ok: false, errors };

  if (!isWhole(fractal.rounds, 1, MAX_ROUNDS)) return { ok: false, errors: [`rounds must be a whole number from 1 to ${MAX_ROUNDS}`] };
  if(scene.formulaFields!==undefined){const errors=fieldMapErrors(scene.formulaFields);if(errors.length)return {ok:false,errors};}
  const missing=chain.flatMap(s=>{const key=s.formula.kernel&&KERNELS[s.formula.kernel].fieldMapParameter;
    if(!key)return [];const id=s.parameterValues[s.formula.parameters.findIndex(p=>p.name===key)];
    return (s.formula.id==='mb3d-heightmapifs'&&Math.round(id!)===0)||scene.formulaFields?.some(m=>m.id===Math.round(id!)&&m.rgb8)?[]:[`Missing formula field resource ${id}`];});
  if(missing.length)return {ok:false,errors:missing};
  if(fractal.execution){const problems=chainExecutionErrors(chain.map((s,i)=>({...s,every:fractal.chain[i]!.every,start:fractal.chain[i]!.start})),fractal.rounds,fractal.mode??"sequence",fractal.execution);if(problems.length)return {ok:false,errors:problems};}
  const total = fractal.execution ? fractal.execution.groups.reduce((n,g)=>n+g.maxIterations,0) : fractal.rounds * chain.reduce((n, s) => n + s.iterations, 0);
  if (total > MAX_TOTAL_ITERATIONS) {
    return { ok: false, errors: [`the chain would run ${total} iterations; at most ${MAX_TOTAL_ITERATIONS} are allowed`] };
  }
  const parameterValues = chain.flatMap((s) => s.parameterValues);
  if (parameterValues.length > MAX_TOTAL_PARAMETERS) {
    return { ok: false, errors: [`the chain has ${parameterValues.length} parameters; at most ${MAX_TOTAL_PARAMETERS} fit`] };
  }

  const mode: ChainMode = fractal.mode ?? "sequence";
  const schedule = fractal.chain.map((s) => ({ every: s.every ?? 1, start: s.start ?? 0 }));
  // The mode and the schedule change the shader; weights and the Julia constant do not (they are read at run time).
  // SHADER-UNIFORMS-08: a plain chain (no kernel, no grouped execution) reads rounds and iteration counts from the uniform buffer, so they stay out of the key:
  // changing them reuses the same shader. Kernel chains and grouped executions still compile their counts in.
  const dynamicLoops = !fractal.execution && chain.length <= 8;
  const loopSteps = chain.map((s, i) => ({ iterations: s.iterations, every: fractal.chain[i]!.every, start: fractal.chain[i]!.start }));
  const loops = chainLoopUniforms(loopSteps, fractal.rounds, fractal.mode ?? "sequence");
  // Kernel chains count their iterations differently (helper steps do not count; interpolation counts rounds): the colour measure must stay the same.
  if (dynamicLoops && chain.every((s) => s.formula.kernel)) loops[1] = kernelChainTotalIterations(toChainSteps({ chain, schedule: fractal.chain.map((s) => ({ every: s.every ?? 1, start: s.start ?? 0 })) }) as never, fractal.rounds, fractal.mode ?? "sequence");
  const key = JSON.stringify([chain.map((s) => (dynamicLoops ? [s.formula.id] : [s.formula.id, s.iterations])), ...(dynamicLoops ? ["loops"] : [fractal.rounds]), ...(mode === "sequence" ? [] : [mode]), ...(mode === "alternate" ? [schedule] : []), ...(fractal.execution?[fractal.execution]:[]),...(scene.formulaFields?.length?[fieldResourcesKey(scene.formulaFields)]:[]),...(displacementActive(scene)?["geometric-displacement"]:[]),...(scene.cutout.box?["box-cut"]:[]),...(scene.primitives?.length?["scene-primitives"]:[]),...(surfaceMaterials(scene).some(surfaceDetailActive)?["surface-detail"]:[]),...(surfaceMaterials(scene).some(materialTexturesActive)?["pbr-textures"]:[]),...(texturedEntries(scene.color.gradient.stops).length?["gradient-textures"]:[]),...(surfaceMaterials(scene).some(proceduralDetailActive)?["procedural-detail"]:[]),...((scene.render.quality.precision_floor??1)<1?["float-floor-scale"]:[]),...(surfaceLookActive(scene)?["surface-look"]:[])]);
  const chainWeights = fractal.chain.map((s) => s.weight ?? 1);
  const j = fractal.julia;
  const julia: [number, number, number, number] = j && j.enabled ? [j.c[0], j.c[1], j.c[2], 1] : [0, 0, 0, 0];
  const stepFactor = fractal.chain.reduce((m, s) => Math.min(m, s.step_factor ?? 1), 1);
  return { ok: true, scene, chain, rounds: fractal.rounds, parameterValues, key, colorData: packColor(scene.color), dynamicLoops, loops, stepFactor, mode, ...(fractal.execution?{execution:fractal.execution}:{}), chainWeights, julia, schedule, warnings };
}

/** The chain as the shader generator wants it. */
export function toChainSteps(resolved: Pick<ResolvedScene, "chain"> & Partial<Pick<ResolvedScene, "schedule">>): { formula: StepFormula; iterations: number; every?: number; start?: number }[] {
  return resolved.chain.map((s, i) => ({ formula: s.formula, iterations: s.iterations, ...(resolved.schedule?.[i] ?? {}) }));
}

/** Lists the authors and sources of every formula the scene uses (each formula once). */
export function collectCredits(scene: Scene, formulas: readonly Formula[]): CreditEntry[] {
  formulas=synthesizedLibrary(scene.discoveredFormulas,formulas);
  const out: CreditEntry[] = [];
  const done = new Set<string>();
  for (const c of scene.content) {
    for (const step of c.chain) {
      const f = formulas.find((x) => x.id === step.formula);
      if (!f || done.has(f.id)) continue;
      done.add(f.id);
      for (const a of f.credits) {
        out.push({ formula: f.id, kind: "author", text: a.role ? `${a.name} – ${a.role}` : a.name, status: a.status });
      }
      for (const s of f.sources) {
        out.push({
          formula: f.id,
          kind: "source",
          text: s.url ?? s.reference ?? "",
          ...(s.url ? { url: s.url } : {}),
          status: s.status,
        });
      }
    }
  }
  const env = scene.environment;
  if (env.kind === "hdri") {
    // The environment picture is credited like a formula (LICENSING.md section 9). It is always marked unverified:
    // the program cannot check where a picture came from.
    const label = env.name ?? "environment picture";
    if (env.author) out.push({ formula: "environment", kind: "author", text: `${label}: ${env.author}`, status: "unverified" });
    out.push({ formula: "environment", kind: "source", text: `${label}: ${env.source}`, ...(/^https?:\/\//.test(env.source) ? { url: env.source } : {}), status: "unverified" });
    out.push({ formula: "environment", kind: "source", text: `${label}: licence ${env.license}`, status: "unverified" });
  }
  return out;
}

/** Scene as JSON text, with credits filled in. Never contains code, only data. */
export function serializeScene(scene: Scene, formulas: readonly Formula[]): string {
  const credits = collectCredits(scene, formulas);
  const out: Scene = { ...withAnimationIdentities(scene), ...(credits.length > 0 ? { credits } : {}) };
  return JSON.stringify(out, null, 2) + "\n";
}

/** Returns a copy of the scene with some colour settings changed. */
export function withColor(scene: Scene, changes: Partial<ColorSettings>): Scene {
  return { ...scene, color: { ...scene.color, ...changes } };
}
