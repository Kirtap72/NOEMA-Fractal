import {wholePickFilm} from './pickFilm';
import {diffuseOrbitRequest} from './diffuseOrbit';
import {integrateDiffuseBounce} from './diffuseBounce';
import {independentReflectionShader,readReflectionSampleCount,reflectionLabProblem,MAX_REFLECTION_CAMERA_ID} from './independentReflectionLab';
import type {ReflectionSampleCount} from './independentReflectionLab';
import {rayBatchCapacity} from './rayBatchLab';
import {geometryQualityRequest} from './geometryQualityLab';
import {readGeometryDetail,geometryDiagnostics,GEOMETRY_PASS_STEPS,GEOMETRY_STATE_BYTES} from './adaptiveGeometry';
import type {GeometryDetailSettings,GeometryDiagnostics} from './adaptiveGeometry';
import {doubleSingleField,dsDefinition,dsCompileKey} from './geometryDoubleSingle';
import {resolvedGeometryReasons} from './geometryEligibility';
import {geometryField} from './geometryRecovery';
import type {GeometryRecoveryExperiment} from './geometryRecovery';
import {generateMappedFieldChain} from './formula/groupExecution';
import {displacementActive,displacementWarnings,packDisplacement,withDisplacementImages} from './displacement';
import {fractalDisplacementActive,packFractalDisplacement} from './fractalDisplacement';
import {normalFilmData} from './surfaceNormal';
import type {ReferenceFilm} from './surfaceNormal';
import {texturedEntries} from './materialRamp';
import {materialTexturesActive,packMaterialTextures,PBR_BUFFER_RECORDS} from './materialTextures';
import {packRampTail,rampTextureTable} from './rampTextures';
import {effectiveMaterial} from './materialRampApply';
import {proceduralDetailActive} from './proceduralDetail';
import {SURFACE_SLOTS,surfaceBlocksGeometry,surfaceDetailActive,surfaceMaterials,surfaceImages,packSurfaceDetails,packProceduralSurfaceDetails} from './surfaceDetail';
import {createSurfaceAtlas} from './surfaceTextures';
import type {SurfaceAtlas} from './surfaceTextures';
import {defaultDisplay,displayRgba,halfToFloat} from './display';
import type {DisplaySettings} from './display';
import {packPrimitives} from './primitives';
import {packSecondaryGeometry} from './secondaryGeometry';
import type {SecondaryGeometry} from './secondaryGeometry';
import {hasTransmissionVolumes,transportWarnings} from './transmission';
import type {SceneHit} from './primitives';
import {GpuDenoiser,DENOISE_RADIUS} from './denoise';
import type {DenoiseTiming} from './denoise';
import {packFieldDescriptors,fieldMapRgba} from './fieldMaps';
import { cameraFov, lensSample } from './cameraOptics';
import {CAMERA_SAMPLE_LIMIT} from './cameraSampling';
import { safeTileSize } from './renderTiles';
import { cameraBasis } from "./camera";
import { irradianceCoefficients } from "./environment";
import { buildMipChain, toHalfRgba } from "./radiance";
import type { HdrImage } from "./radiance";
import type { Formula } from "./formula/types";
import { generateChain } from "./formula/chain";
import { resolveScene, toChainSteps } from "./scene";
import type { ResolvedScene, Scene } from "./scene";
import type { Vec3 } from "./camera";
import { SceneSwitcher, sceneKeyInUse } from "./sceneSwitcher";
import { warmupEligible } from "./shaderWarmup";
import { GEOMETRY_CACHE_READ_STAGE, geometryCacheShader } from "./geometryCacheWgsl";
import { surfaceLookActive } from "./surfaceLook";
import { buildColorShader, buildDistanceShader, buildGridShader, buildShader } from "./shader";
import { checkOutputSize, DEFAULT_QUALITY, QUALITY_LIMITS, sampleJitter, verticalFovDegrees,outputSize } from "./renderSetup";
import type { QualitySettings } from "./renderSetup";
import { packUniforms, UNIFORM_FLOATS, DISPLAY_OFFSET, CAMERA_SAMPLING_OFFSET, TUNE_OFFSET, FDISP_OFFSET } from "./uniforms";
import { ADAPTIVE_FLOATS, packTileMask } from "./adaptiveMask";
import { tileFlagged } from "./adaptiveMask";
import type { TileMask } from "./adaptiveMask";
import type { DebugView } from "./uniforms";
import { FULL_VIEWPORT_FEATURES, viewportFeatureMask } from './viewportQuality';
import type { ViewportFeatures } from './viewportQuality';
import type { DetailSettings } from './renderDetails';
import {packLinearLighting} from './lights';
import type {LinearLighting} from './lights';
import {LIGHTS_OFFSET} from './uniforms';

/**
 * The engine: draws a scene with WebGPU. It knows nothing about the page it
 * lives in (no document, no window). Give it a canvas to draw on screen, or
 * none to draw only into memory with renderToBuffer.
 */
export interface EngineOptions {
  /**
   * LOOKDEV-05: always compile the sculpting shader (wide occlusion, bent light, contact shadows), so switching a look on or off never changes the
   * shader and never costs a rebuild (about a minute on the heaviest fractals). The sculpting code is gated by numbers in the uniform buffer and
   * returns the plain values when they are zero, so a scene that does not use it draws the same picture. Float32 picture path only.
   */
  lookReady?: boolean;
  /**
   * INTERACTIVE-LOOKDEV-06: compile ONE picture shader that always holds the sculpting code, writes what the march found to the second target
   * and can read it back (see geometryCacheWgsl.ts), and allow `cachedFrame`. Offscreen opaque scenes only; the on-screen Interactive LookDev uses its own engine with it.
   */
  geometryCache?: boolean;
  /**
   * LIVE-LOOKDEV-17: always compile the object code (spheres, boxes, planes), with zero objects when the scene has none. Objects are data in a storage buffer (type, position,
   * size, material), so adding, moving or removing one then never changes the shader and never costs a rebuild. Without it the shader changes when the FIRST object is added.
   */
  liveObjects?: boolean;
  /** LOOKDEV-05: compile the on-screen pipeline and the offscreen pipeline together (see compileNow). The artist application turns it on. */
  parallelPipelines?: boolean;
  /** LOOKDEV-05: told when the picture shader of a scene starts and ends compiling, so the application can say what it waits for (and measure it). */
  onCompile?(info: { phase: "start" | "end"; key: string; ms?: number; ok?: boolean }): void;
  /** Compile the picture shader so that whole tiles can be skipped (RenderOptions.refine). The artist application leaves this off; research tools turn it on. */
  tileMask?: boolean;
  /** QUALITY LAB 02 immutable opt-in; only verified offscreen GEO5 single-bounce scenes. */
  qaReflectionSamples?:ReflectionSampleCount;
  /** PERF-01B research only; host bands and all solver/shader inputs stay unchanged. */
  qaRayBatchCapacity?:number;
  /** Opt-in GEO5 candidate, offscreen only; normal preview stays on its original engine. */
  geometryDetail?:GeometryDetailSettings;
  /** Bounded GEO8 continuation experiment, default GEO5 slice unchanged. */
  geometryPassSteps?:number;
  /** Isolated offscreen diagnostics only; never serialized or used by the app. */
  qaShaderTransform?:(shader:string)=>string;
  /** Isolated GEO2 candidate only. No scene migration, storage or artist UI path. */
  qaGeometry?: GeometryRecoveryExperiment;
  /** Internal QA-only immutable shader choice; not serialized and never enabled by the application UI. */
  qaPrimaryHitCoefficient?: 0.5 | 0.25 | 0.125;
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  onGpuReady?(info:GPUAdapterInfo):void;
  onDeviceLost?(info:GPUDeviceLostInfo):void;
}

export interface SceneResult {
  errors: string[];
  warnings: string[];
  /** True when a newer scene was set while this one was waiting; nothing was changed by this call. */
  superseded?: boolean;
}

/** A part of the whole picture, in pixels counted from the top left of the whole picture. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a render has come. */
export interface RenderProgress {
  /** 0 to 1, by the amount of work (pixels times samples) done. */
  fraction: number;
  rowsDone: number;
  rowsTotal: number;
  elapsedSeconds: number;
}

export interface RenderOptions {
  /** QA safety observer after each completed GPU pass, before the next submission. Requires onTiming. */
  qaOnPassTiming?:(gpuMs:number)=>void;
  /** PERF-01B independent inner batch capacity; not saved in scenes or exposed by normal UI. */
  qaRayBatchCapacity?:number;
  /**
   * Selective refinement: after the ordinary samples, draw `samples` more passes with the quality values in `quality`, only inside the flagged tiles
   * of `mask` (other pixels leave the shader at once and cost nothing). Inside a flagged tile the refined picture REPLACES the ordinary one.
   */
  refine?: { mask: TileMask; quality: Partial<QualitySettings>; samples: number; /** Draw only the refinement; the base picture is then left empty (the caller already has it). */ only?: boolean };
  /** QA only: add the samples of a band on the CPU (the old way) instead of on the GPU. The pictures are identical; only the time differs. */
  qaLegacyReadback?:boolean;
  /** Called per continuation pass, including unresolved rays at the technical limit. */
  onGeometry?(diagnostics:GeometryDiagnostics,state:Float32Array):void;
  /** Target film for primary normal detail and hit accuracy. Defaults to full width/height, never the ROI. */
  referenceFilm?:ReferenceFilm;
  /** Scene-linear input for one offscreen render; saved scene and preview stay intact. */
  lighting?: LinearLighting;
  /** Optional postprocess override; preview accumulates raw samples before invoking denoiseBuffer. */
  denoise?:boolean;
  onDenoiseTiming?(timing:DenoiseTiming):void;
  /** Explicit temporary offscreen/preview costs. Omitted is the unchanged full export path. */
  features?: ViewportFeatures;
  details?: DetailSettings;
  /** Global sample index for incremental previews; never reset the lens/jitter sequence between batches. */
  sampleOffset?: number;
  /** Diagnostic early-exit stages: 1 march, 2 normals, 3 lighting, 4 shadows, 5 AO/cavity, 6 reflections, 7 fog. */
  profileStage?: number;
  onTiming?(timing: RenderTiming): void;
  /** Explicit pinhole evaluation for depth-based preview; does not mutate the saved camera. */
  dofMode?: 'physical' | 'off';
  /** Maximum internal tile edge, constrained by actual GPU limits. Default 1024. */
  tileSize?: number;
  /** Explicit aperture-sample floor for a low-cost still preview. Final rendering uses at least 16 when DOF is on. */
  dofSamples?: number;
  /**
   * About how many pixels to draw per band. Left out, the engine measures how long a band takes and adjusts the size,
   * so that no single job keeps the graphics card busy for long (which the system would otherwise cancel).
   * Given, the bands have exactly this size.
   */
  tilePixels?: number;
  /** Draw only this part of the picture (the picture is still framed as the whole width x height). */
  region?: Region;
  /** Quality values to use instead of the scene's own (only the ones given). */
  quality?: Partial<QualitySettings>;
  /** Stops the render between two jobs. The promise then fails with an error named "AbortError". */
  signal?: AbortSignal;
  /** Called after every finished job. */
  onProgress?(progress: RenderProgress): void;
  /** Draw a debug view instead of the normal picture (see DEBUG_VIEWS). */
  debugView?: DebugView;
}

export interface RenderTiming {
  gpuMs: number;
  gpuClock: 'timestamp' | 'fenced-wall';
  readbackMs: number;
  accumulationMs: number;
  wallMs: number;
}

/** A finished horizontal band of the picture (final colours, all samples averaged). */
export interface RenderBand {
  /** First row of the band, counted from the top of the drawn region. */
  y: number;
  rows: number;
  /** Width of the drawn region. */
  width: number;
  /** RGBA, 8 bits per channel, rows * width * 4 values. */
  color: Uint8Array;
  /** Scene-linear RGBA beauty, before display transform. */
  linear?:Float32Array;
  display?:DisplaySettings;
  /** With layers: distance along the ray (-1 where nothing is hit) and normals, taken from the sample at the pixel centre. */
  depth?: Float32Array;
  normal?: Float32Array;
}

/** A regular grid of points. */
export interface DistanceGrid {
  origin: Vec3;
  /** Distance between neighbouring points along each axis. */
  step: Vec3;
  /** Number of points along each axis. */
  size: [number, number, number];
}

/** The most grid points that fit in one go (more is split into slabs), and in total. */
export const MAX_GRID_POINTS = 2 ** 27;
const GRID_SLAB_POINTS = 4_000_000;
/** Progressive re-shading shows its picture at the latest this many milliseconds after the previous one, however few samples are done (a heavy scene must not leave the old picture up). */
export const SLOW_PRESENT_MS = 250;

/** Colour, depth and normals of one rendering. Pixels are stored row by row, the top row first. */
export interface LayerBuffers {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel. */
  color: Uint8Array;
  /** Scene-linear RGBA beauty, before display transform. */
  linear?:Float32Array;
  display?:DisplaySettings;
  /** One number per pixel: the distance along the viewing ray from the camera to the surface, or -1 where no surface is hit. */
  depth: Float32Array;
  /** Three numbers per pixel (x, y, z): the surface normal as a unit vector in world coordinates, or 0, 0, 0 where no surface is hit. */
  normal: Float32Array;
}

export interface ImageBuffer {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, top row first. */
  data: Uint8Array;
  linear?:Float32Array;
  display?:DisplaySettings;
}

export interface Engine {
  /** Actual chain shader builds, for bounded preview diagnostics (not pipeline count or VRAM). */
  readonly shaderCompilations:number;
  denoiseBuffer(layers:LayerBuffers,options?:{signal?:AbortSignal;onTiming?:(t:DenoiseTiming)=>void;frameWidth?:number;frameHeight?:number;tileSize?:number}):Promise<ImageBuffer>;
  /** Exact pinhole camera ray through continuous image coordinates; host serializes against rendering. */
  pickSurface(width:number,height:number,x:number,y:number,excludeId?:string):Promise<SceneHit|null>;
  /** Sets the formulas scenes can refer to. */
  setFormulas(formulas: readonly Formula[]): void;
  /**
   * Makes `scene` the current scene. If its chain of formulas is already
   * compiled it takes effect at once (so it is cheap to call while dragging a
   * slider). Otherwise the shader is compiled first and the promise resolves
   * when done. The newest call always wins: while a compile runs, later calls
   * are remembered and an older call resolves with `superseded: true`.
   * If compiling fails, the previous scene stays in use and errors are returned.
   */
  setScene(scene: Scene,inputs?:{secondaryGeometry?:SecondaryGeometry}): Promise<SceneResult>;
  /** LOOKDEV-05B: true when the picture shader `scene` needs is in use or remembered, so setScene would not have to compile. Always false for scenes the on-screen engine cannot prepare. */
  isReady(scene: Scene): boolean;
  /**
   * INTERACTIVE-LOOKDEV-06 (needs `geometryCache`): one picture at one sample and the pixel centre. `write` draws it with the whole
   * shader and keeps what the march found; `read` draws it again from that kept result, with whatever lights and material the scene has now,
   * without marching. Returns the picture in linear light and the time of the graphics card work.
   */
  cachedFrame(width: number, height: number, mode: "write" | "read", options?: { quality?: Partial<QualitySettings>; referenceFilm?: ReferenceFilm }): Promise<{ linear: Float32Array; rgba: Uint8Array; gpuMs: number }>;
  /**
   * PROGRESSIVE-GEOCACHE (needs `geometryCache`): a picture made of many samples per pixel where the surface of EACH sample is kept.
   * `progressiveBegin` starts a picture of this size (`samples` is the sample count the quality is meant for; it must be the same as the ordinary renderer's
   * `samples_per_pixel` for the result to equal an ordinary picture). `progressiveAdd` draws the next samples with the whole shader and the CURRENT light and keeps what
   * the march found. `progressiveReshade` draws all kept samples again with the scene's light as it is NOW, without marching, and returns the average; the
   * picture is then as clean as the samples kept, not one sample. Adding after a reshade continues from the kept samples. Same sample order and the same 32-bit sum
   * as the ordinary renderer, so the result is the ordinary picture byte for byte.
   */
  progressiveBegin(width: number, height: number, options: { samples: number; quality?: Partial<QualitySettings>; referenceFilm?: ReferenceFilm }): void;
  progressiveAdd(count: number, options?: { signal?: AbortSignal }): Promise<{ count: number; gpuMs: number }>;
  progressiveReshade(options?: { every?: number; signal?: AbortSignal; present?: (p: { rgba: Uint8Array; done: number; total: number; gpuMs: number }) => void }): Promise<{ count: number; gpuMs: number; rgba: Uint8Array; linear: Float32Array }>;
  /** The kept samples of the current progressive picture, or null when none was begun. */
  progressiveInfo(): { width: number; height: number; kept: number; samples: number } | null;
  progressivePicture(): Promise<{ count: number; rgba: Uint8Array; linear: Float32Array }>;
  progressiveEnd(): void;
  /** Graphics memory the kept surfaces use, in bytes. */
  progressiveBytes(): number;
  /**
   * LOOKDEV-05B: builds the picture shader `scene` needs in the background WITHOUT making it the current scene; setScene takes it at once afterwards.
   * On-screen engine and ordinary fractal scenes only (see shaderWarmup.ts); anything else answers with an error and does nothing. Waits its turn behind other compiles.
   */
  prepareScene(scene: Scene): Promise<{ errors: string[] }>;
  /**
   * Sets the picture used for the texture of the surface (see TextureSettings in the scene). RGBA, 8 bits per channel.
   * The engine itself does not read pictures from the scene; whoever opens a scene turns the data address into pixels
   * and gives them here. Null removes the picture.
   */
  setTextureImage(image: ImageBuffer | null): void;
  /**
   * Sets the picture of the environment (see EnvironmentSettings in the scene): linear light, up to 1024 x 512, as the
   * map is kept in a scene. The engine works out the diffuse light of the picture once, here. Null removes the picture.
   */
  setEnvironmentImage(image: HdrImage | null): void;
  /** Sets the drawing size of the canvas in pixels. */
  resize(width: number, height: number): void;
  /** Draws the current scene on the canvas. */
  render(): void;
  /** Waits for submitted GPU work; viewport hosts use this to avoid queuing stale frames. */
  waitForPreview(): Promise<void>;
  /**
   * Draws the current scene at the given size into memory and returns the pixels.
   * Large images are drawn in horizontal bands (tiles) one after the other, so a heavy
   * image does not keep the graphics card busy for so long that the system gives up on it.
   */
  renderToBuffer(width: number, height: number, options?: RenderOptions): Promise<ImageBuffer>;
  /**
   * Draws the picture band by band and hands each finished band to `onBand` (also the depth and normals if
   * `layers` is true), without ever keeping the whole picture in memory. Meant for very large pictures that are
   * written straight to a file. Uses the scene's quality (samples per pixel, hit precision, ...) unless
   * `options.quality` says otherwise. The samples of a pixel are placed by a fixed pattern (see sampleJitter),
   * so the same scene, size and seed always give the same picture.
   */
  renderStream(width: number, height: number, options: RenderOptions, layers: boolean, onBand: (band: RenderBand) => void | Promise<void>): Promise<void>;
  /**
   * Quality used when drawing on the canvas (the live preview). Left alone, the preview uses the plain defaults,
   * so fine settings meant for a final picture do not slow the preview down. Null goes back to the defaults.
   */
  setPreviewQuality(quality: Partial<QualitySettings> | null): void;
  /** Temporary viewport effect costs; never used by offscreen/final rendering. */
  setPreviewFeatures(features: ViewportFeatures): void;
  /** Shows a debug view in the live preview instead of the normal picture ("off" goes back). */
  setDebugView(view: DebugView): void;
  /**
   * The distance to the surface at every point of a regular grid (positive outside, negative inside).
   * Used to make meshes. The formulas of the scene must already be in use (see distanceAt).
   * The value of point (i, j, k) is at index i + nx * (j + ny * k) and lies at origin + (i, j, k) * step.
   */
  distanceGrid(scene: Scene, grid: DistanceGrid): Promise<Float32Array>;
  /**
   * Like renderToBuffer, but also returns the depth and the normals of the surface from the same pass,
   * so all layers always fit each other exactly.
   */
  renderLayersToBuffer(width: number, height: number, options?: RenderOptions): Promise<LayerBuffers>;
  /**
   * Distance to the surface of the scene shape at many points (positive outside).
   * The formula chain of the scene must already be in use (set it with setScene first).
   * Parameter values are taken from the scene given here.
   */
  distanceAt(scene: Scene, points: readonly Vec3[]): Promise<Float32Array>;
  /**
   * The colour of the surface (gradient and texture of the scene, before lighting) at many points, three numbers
   * (red, green, blue, linear light from 0 to 1) per point. `positions` and `normals` hold x, y, z per point.
   * Used for vertex colours in meshes. The measure "cavity" needs a viewing ray and has none here, so it gives
   * the lowest colour of the gradient. The formulas must already be in use (see distanceAt).
   */
  colorsAt(scene: Scene, positions: Float32Array, normals: Float32Array): Promise<Float32Array>;
  destroy(): void;
}

interface Pipe {
  materialTextures?:boolean;
  gradientTextures?:boolean;
  surface?:SurfaceAtlas;
  primitives?:boolean;
  fieldBuffer?:GPUBuffer;
  fieldTexture?:GPUTexture;
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
}

/** A white 1 x 1 picture, used when no texture is set, so the shader always has something to read. */
const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);

interface Compiled {
  primaryPrimitives?:boolean;
  externalGeometry?:boolean;
  proceduralDetail?:boolean;
  materialTextures?:boolean;
  gradientTextures?:boolean;
  displacement?:boolean;
  fractalDisplacement?:boolean;
  boxCut?:boolean;
  /** True when the picture shader can skip tiles (see adaptiveMask.ts). */
  masked?:boolean;
  /** True when the picture shader reads the Float32 floor scale (the scene's render.quality.precision_floor is below 1). */
  floorScaled?:boolean;
  surface?:SurfaceAtlas;
  pick?:GPUComputePipeline;
  multi?:Compiled;
  primitives?:boolean;
  fieldBuffer?:GPUBuffer;
  fieldTexture?:GPUTexture;
  module: GPUShaderModule;
  pipes: Map<GPUTextureFormat, Pipe>;
  /** The generated formula code, for the distance measuring shader. */
  code: string;
  distance?: { pipeline: GPUComputePipeline; bindGroupLayout: GPUBindGroupLayout };
  layers?: Pipe;
  /** PROGRESSIVE-REFLECT-14: the layer pipeline while it is being built (also in the background), so a second request waits for it instead of building it twice. */
  layersPending?: Promise<Pipe>;
  grid?: { pipeline: GPUComputePipeline; bindGroupLayout: GPUBindGroupLayout };
  colors?: { pipeline: GPUComputePipeline; bindGroupLayout: GPUBindGroupLayout };
}

/** The live preview draws at most this many lights (the strongest); pictures and films draw all of them. */
export const PREVIEW_LIGHT_LIMIT = 3;

/** Divides the sum by the sample count in place and reports whether every value was finite. A small function of its own, so it is compiled for speed. */
function scaleFinite(values: Float32Array, samples: number): boolean {
  let ok = true;
  for (let i = 0; i < values.length; i++) { const v = values[i]!; if (v - v !== 0) ok = false; values[i] = v / samples; }
  return ok;
}
const OFFSCREEN_FORMAT: GPUTextureFormat = "rgba16float";
const DATA_FORMAT: GPUTextureFormat = "rgba32float";

export async function createEngine(options: EngineOptions = {}): Promise<Engine> {
  if(options.qaShaderTransform&&options.canvas)throw Error('Diagnostic shader requires offscreen engine');
  const transformDiagnostic=(code:string)=>options.qaShaderTransform?.(code)??code;
  const reflectionSamples=readReflectionSampleCount(options.qaReflectionSamples??1);
  if(reflectionSamples>1&&(options.canvas||!options.geometryDetail?.enabled||options.qaGeometry?.nativeMb3d))throw Error('Independent reflection candidate requires ordinary offscreen GEO5');
  const nativeGeometry=!!options.qaGeometry?.nativeMb3d;
  const geometryDetail=options.geometryDetail?.enabled?readGeometryDetail(options.geometryDetail):undefined;
  if(geometryDetail){
    if(options.canvas||(options.qaGeometry&&!options.qaGeometry.nativeMb3d))throw Error('Geometry Detail candidate requires its own offscreen engine');
    options={...options,qaGeometry:options.qaGeometry??geometryQualityRequest({detailLevel:geometryDetail.detailLevel,stepMultiplier:geometryDetail.stepMultiplier,maxQueries:640})};
  }
  if (typeof navigator === "undefined" || !navigator.gpu) throw new Error("WebGPU is not available here.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Found no graphics card for WebGPU.");
  const timestampSupported = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({requiredFeatures: timestampSupported ? ['timestamp-query'] : []});
  options.onGpuReady?.(adapter.info);
  void device.lost.then(info=>{if(info.reason!=='destroyed')options.onDeviceLost?.(info);});

  const canvas = options.canvas;
  const context = canvas ? (canvas.getContext("webgpu") as GPUCanvasContext | null) : null;
  if (canvas && !context) throw new Error("Could not start WebGPU on the drawing surface.");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context?.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  const buffer = device.createBuffer({
    size: (UNIFORM_FLOATS + ADAPTIVE_FLOATS) * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniforms = new Float32Array(UNIFORM_FLOATS + ADAPTIVE_FLOATS);
  const defaultRayBatchCapacity=options.qaRayBatchCapacity;
  rayBatchCapacity(defaultRayBatchCapacity);
  const geometryPassSteps=options.geometryPassSteps??GEOMETRY_PASS_STEPS;
  const liveObjects=!!options.liveObjects&&!geometryDetail&&!options.qaGeometry&&!options.qaShaderTransform;
  const lookReadyShader=!!options.lookReady&&!geometryDetail&&!options.qaGeometry&&!options.qaShaderTransform;
  const geoCache=!!options.geometryCache&&!geometryDetail&&!options.qaGeometry&&!options.qaShaderTransform&&!options.tileMask&&!!options.canvas===false;
  let geoCacheTexture: GPUTexture | undefined; let geoCacheSize: [number, number] = [0, 0];
  if(!Number.isInteger(geometryPassSteps)||geometryPassSteps<1||geometryPassSteps>4096)throw Error('Invalid continuation slice');
  let geoState=geometryDetail?device.createBuffer({size:64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}):undefined;
  const geoControl=geometryDetail?device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}):undefined;
  let geoCapacity=64;
  function geometryCapacity(bytes:number){
    if(!geoState||bytes<=geoCapacity)return;
    geoState.destroy();geoState=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});geoCapacity=bytes;
  }
  const primitiveBuffer=device.createBuffer({size:packPrimitives([]).byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const secondaryInputs=new WeakMap<ResolvedScene,SecondaryGeometry>();
  const denoiser=new GpuDenoiser(device);
  const pbrBuffer=device.createBuffer({size:PBR_BUFFER_RECORDS*20*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const displacementBuffer=device.createBuffer({size:32*12*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const surfaceBuffer=device.createBuffer({size:SURFACE_SLOTS*24*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const surfaceSampler=device.createSampler({addressModeU:"repeat",addressModeV:"repeat",magFilter:"linear",minFilter:"linear",mipmapFilter:"linear"});
  const preparedSurfaces=new WeakMap<ResolvedScene,SurfaceAtlas>();
  const surfaceAtlases=new Set<SurfaceAtlas>();
  const pendingAtlases=new Map<string,Promise<SurfaceAtlas>>();
  let sceneRequest=0,pendingScenes=0;

  const sampler = device.createSampler({ addressModeU: "repeat", addressModeV: "repeat", magFilter: "linear", minFilter: "linear" });
  let texture = makeTexture(1, 1, WHITE_PIXEL);
  // The environment map wraps around in u and stops at the poles in v.
  const envSampler = device.createSampler({ addressModeU: "repeat", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
  /** The last mip level of the environment picture (0 without a picture): a rougher surface sees a blurrier level. */
  let envMaxLod = 0;
  let envTexture = makeEnvTexture(null);
  /** The nine diffuse light coefficients of the environment picture (null: no picture). */
  let envSh: Float32Array | null = null;

  function makeEnvTexture(image: HdrImage | null): GPUTexture {
    const chain = image ? buildMipChain(image) : [{ width: 1, height: 1, data: new Float32Array(3) }];
    envMaxLod = chain.length - 1;
    const t = device.createTexture({ size: [chain[0]!.width, chain[0]!.height], mipLevelCount: chain.length, format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    chain.forEach((level, i) => {
      device.queue.writeTexture({ texture: t, mipLevel: i }, toHalfRgba(level) as Uint16Array<ArrayBuffer>, { bytesPerRow: level.width * 8 }, [level.width, level.height]);
    });
    return t;
  }

  function makeTexture(width: number, height: number, pixels: Uint8Array): GPUTexture {
    const t = device.createTexture({ size: [width, height], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, pixels as Uint8Array<ArrayBuffer>, { bytesPerRow: width * 4 }, [width, height]);
    return t;
  }

  /** The things every picture pipeline reads: the numbers, the texture and how to sample it. */

  // PROGRESSIVE-GEOCACHE: one kept surface per sample, a running 32-bit sum on the card (the very accumulation the ordinary renderer uses).
  interface ProgressiveState { width: number; height: number; samples: number; quality: QualitySettings; referenceFilm?: ReferenceFilm; textures: GPUTexture[]; count: number; color: GPUTexture; data: GPUTexture; sum: GPUBuffer; read: GPUBuffer; params: GPUBuffer }
  let prog: ProgressiveState | undefined;
  function progressiveEndNow(): void {
    if (!prog) return;
    for (const t of prog.textures) t.destroy();
    prog.color.destroy(); prog.data.destroy(); prog.sum.destroy(); prog.read.destroy(); prog.params.destroy();
    prog = undefined; geoCacheTexture = undefined; geoCacheSize = [0, 0];
  }
  /** Draws sample k (write: whole shader, keep the surface; read: from the kept surface) and adds it to the sum. Not awaited: the queue keeps the order. */
  function progressiveDraw(pipe: Pipe, k: number, mode: "write" | "read", first: boolean): void {
    const st = prog!;
    writeUniforms(st.width, st.height, 0, 0, st.quality, sampleJitter(k, st.quality.seed), null, "off", FULL_VIEWPORT_FEATURES, lensSample(k, st.quality.seed), false, undefined, mode === "read" ? GEOMETRY_CACHE_READ_STAGE : 0, k, true, undefined, st.referenceFilm);
    geoCacheTexture = mode === "read" ? st.textures[k] : undefined;     // the shader reads binding 20 only in read mode; a placeholder is bound otherwise
    const bindGroup = device.createBindGroup({ layout: pipe.pipeline.getBindGroupLayout(0), entries: bindEntries(pipe.fieldBuffer, pipe.fieldTexture, pipe.primitives, pipe.surface) });
    geoCacheTexture = undefined;
    if (mode === "write" && !st.textures[k]) st.textures[k] = device.createTexture({ size: [st.width, st.height], format: DATA_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const draw = device.createCommandEncoder();
    const pass = draw.beginRenderPass({ colorAttachments: [st.color, st.data].map((t) => ({ view: t.createView(), loadOp: "clear" as const, storeOp: "store" as const, clearValue: { r: 0, g: 0, b: 0, a: 1 } })) });
    pass.setPipeline(pipe.pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
    if (mode === "write") draw.copyTextureToTexture({ texture: st.data }, { texture: st.textures[k]! }, [st.width, st.height]);
    device.queue.submit([draw.finish()]);
    device.queue.writeBuffer(st.params, 0, new Uint32Array([st.width, st.height, first ? 1 : 0, 0]));
    const add = device.createCommandEncoder(), compute = add.beginComputePass();
    compute.setPipeline(accumulatePipe());
    compute.setBindGroup(0, device.createBindGroup({ layout: accumulatePipe().getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: st.params } }, { binding: 1, resource: st.color.createView() }, { binding: 2, resource: { buffer: st.sum } }] }));
    compute.dispatchWorkgroups(Math.ceil(st.width / 8), Math.ceil(st.height / 8)); compute.end();
    device.queue.submit([add.finish()]);
  }
  /** The average of the first `n` samples as the ordinary renderer forms it: the 32-bit sum divided by n, then the scene's tone curve. */
  async function progressiveRead(n: number): Promise<{ rgba: Uint8Array; linear: Float32Array }> {
    const st = prog!;
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(st.sum, 0, st.read, 0, st.width * st.height * 16); device.queue.submit([encoder.finish()]);
    await st.read.mapAsync(GPUMapMode.READ);
    const linear = new Float32Array(st.read.getMappedRange().slice(0)); st.read.unmap();
    if (!scaleFinite(linear, n)) throw Error("Radiance exceeds the finite RGBA16Float range (65504); reduce physical light/emission intensity.");
    return { rgba: displayRgba(linear, active!.scene.display ?? defaultDisplay()), linear };
  }
  let geoCachePlaceholderTexture: GPUTexture | undefined;
  function geoCachePlaceholder(): GPUTexture { return geoCachePlaceholderTexture ??= device.createTexture({ size: [1, 1], format: DATA_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING }); }
  function bindEntries(fieldBuffer?:GPUBuffer,fieldTexture?:GPUTexture,primitives=false,surface?:SurfaceAtlas): GPUBindGroupEntry[] {
    return [
      { binding: 0, resource: { buffer } },
      ...(geoState&&geoControl?[{binding:18,resource:{buffer:geoState}},{binding:19,resource:{buffer:geoControl}}]:[]),
      ...(surface?.displacement?[{binding:16,resource:{buffer:displacementBuffer}}]:[]),
      ...(surface?.materialTextures?[{binding:15,resource:{buffer:pbrBuffer}}]:[]),
      ...(surface?[{binding:12,resource:surface.texture.createView({dimension:"2d-array"})},{binding:13,resource:surfaceSampler},{binding:14,resource:{buffer:surfaceBuffer}}]:[]),
      ...(primitives?[{binding:10,resource:{buffer:primitiveBuffer}}]:[]),
      ...(fieldBuffer&&fieldTexture?[{binding:8,resource:fieldTexture.createView({dimension:"2d-array"})},{binding:9,resource:{buffer:fieldBuffer}}]:[]),
      ...(geoCache?[{binding:20,resource:(geoCacheTexture??geoCachePlaceholder()).createView()}]:[]),
      { binding: 3, resource: texture.createView() },
      { binding: 4, resource: sampler },
      { binding: 6, resource: envTexture.createView() },
      { binding: 7, resource: envSampler },
    ];
  }

  let formulas: readonly Formula[] = [];
  let active: ResolvedScene | null = null;
  const fieldBuffers=new Set<GPUBuffer>();
  const fieldTextures=new Set<GPUTexture>();
  // Error scopes of the graphics card form a stack, so compiles must not overlap.
  let compileQueue: Promise<unknown> = Promise.resolve();

  function makePipe(module: GPUShaderModule, format: GPUTextureFormat, fieldBuffer?:GPUBuffer,fieldTexture?:GPUTexture,primitives=false,surface?:SurfaceAtlas): Pipe {
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindEntries(fieldBuffer,fieldTexture,primitives,surface) });
    return { pipeline, bindGroup,fieldBuffer,fieldTexture,primitives,surface };
  }

  /** True when the picture shader holds the sculpting code: the scene uses it, or the engine is look-ready (LOOKDEV-05). */
  const lookShader=(scene:Scene):boolean=>lookReadyShader||geoCache||surfaceLookActive(scene);
  let shaderCompilations=0;
  async function compileNow(resolved: ResolvedScene): Promise<{ errors: string[]; result?: Compiled }> {
    const startedAt = performance.now();
    options.onCompile?.({ phase: "start", key: resolved.key.slice(-90) });
    const done = await compileNowInner(resolved);
    options.onCompile?.({ phase: "end", key: resolved.key.slice(-90), ms: Math.round(performance.now() - startedAt), ok: !!done.result });
    return done;
  }
  async function compileNowInner(resolved: ResolvedScene): Promise<{ errors: string[]; result?: Compiled }> {
    shaderCompilations++;
    const primaryPrimitives=!!resolved.scene.primitives?.length||liveObjects,externalGeometry=!!secondaryInputs.get(resolved)?.objects.length,primitives=primaryPrimitives||externalGeometry;
    const surface=preparedSurfaces.get(resolved);
    const proceduralDetail=surfaceMaterials(resolved.scene).some(proceduralDetailActive);
    const boxCut=!!resolved.scene.cutout.box;
    const displacement=displacementActive(resolved.scene);
    const fractalDisplacement=fractalDisplacementActive(resolved.scene.fractalDisplacement)&&!options.qaGeometry;
    const materialTextures=surfaceMaterials(resolved.scene).some(materialTexturesActive);
    const gradientTextures=materialTextures&&texturedEntries(resolved.scene.color.gradient.stops).length>0;
    const code = generateChain(toChainSteps(resolved), resolved.rounds, { mode: resolved.mode, execution: resolved.execution, dynamicLoops: resolved.dynamicLoops });
    if (!code.ok) return { errors: code.errors };
    if(options.qaGeometry){
      // Fail closed even for direct engine callers: this solver would otherwise silently omit the displaced field.
      if(fractalDisplacementActive(resolved.scene.fractalDisplacement))return {errors:['Displacement on the fractal is not supported with Geometry Detail. Turn off Geometry Detail to keep the displaced shape in the final picture.']};
      if(resolved.execution?.kind!=='mapped-field'||primitives||(surface&&surfaceMaterials(resolved.scene).some(m=>surfaceBlocksGeometry(m,'normal-bump')||surfaceBlocksGeometry(m,'procedural')))||boxCut||displacement||resolved.scene.transport?.enabled)return {errors:['GEO2 candidate requires an unmodified mapped-field surface without primitive, displacement, box or transport composition'+(()=>{const why=resolvedGeometryReasons(resolved);return why.length?' | Reason: '+why.map(x=>x.text).join(' '):'';})()]};
      const full=generateMappedFieldChain(toChainSteps(resolved),resolved.rounds,resolved.mode,resolved.execution,{allFieldIterations:true});
      if(!full.ok)return {errors:full.errors};
      code.wgsl=geometryField(code.wgsl,full.wgsl,options.qaGeometry,options.qaGeometry.ds?doubleSingleField(dsDefinition(resolved,options.qaGeometry.sourceParameters),options.qaGeometry.dsProduct,options.qaGeometry.sourceParameters,options.qaGeometry.nativeMb3d?.bailoutRadius):undefined);
    }
    let fieldBuffer:GPUBuffer|undefined,fieldTexture:GPUTexture|undefined;
    if(code.wgsl.includes('var<storage,read> formulaFields')){
      const maps=(resolved.scene.formulaFields??[]).filter(m=>m.rgb8);
      const width=Math.max(1,...maps.map(m=>m.width!)),height=Math.max(1,...maps.map(m=>m.height!)),layers=Math.max(1,maps.length);
      if(width>device.limits.maxTextureDimension2D||height>device.limits.maxTextureDimension2D||layers>device.limits.maxTextureArrayLayers)return {errors:[`Formula field texture ${width} x ${height} x ${layers} exceeds GPU texture limits. Original maps are never resized automatically.`]};
      device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
      const data=packFieldDescriptors(maps);fieldBuffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});fieldBuffers.add(fieldBuffer);device.queue.writeBuffer(fieldBuffer,0,data as Float32Array<ArrayBuffer>);
      fieldTexture=device.createTexture({size:[width,height,layers],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});fieldTextures.add(fieldTexture);
      maps.forEach((m,i)=>device.queue.writeTexture({texture:fieldTexture!,origin:[0,0,i]},fieldMapRgba(m) as Uint8Array<ArrayBuffer>,{bytesPerRow:m.width!*4},[m.width!,m.height!]));
      const validation=await device.popErrorScope(),memory=await device.popErrorScope();if(validation||memory){fieldBuffer.destroy();fieldTexture.destroy();return {errors:[(validation??memory)!.message]};}
    }
    device.pushErrorScope("validation");
    // One fragment interface for both colour-only and colour/depth/normal targets avoids a second cold shader compile.
    const baseShader = independentReflectionShader(buildShader(code.wgsl,{tileMask:!!options.tileMask,floorScale:(resolved.scene.render.quality.precision_floor??1)<1,surfaceLook:lookShader(resolved.scene),qaPrimaryHitCoefficient:options.qaPrimaryHitCoefficient,qaGeometry:options.qaGeometry,geometryContinuation:!!geometryDetail,diffuseOrbit:resolved.scene.transport?.enabled||options.qaGeometry?.nativeMb3d?undefined:diffuseOrbitRequest(resolved.scene.material),secondaryRadianceGain:resolved.scene.transport?.enabled?1:resolved.scene.reflections.secondary_radiance_gain??1,layers:true,primitives:primaryPrimitives,secondaryGeometry:externalGeometry,multiBounce:false,surfaceDetail:!!surface,proceduralDetail,materialTextures,gradientTextures,boxCut,displacement,fractalDisplacement}),resolved.scene.reflections.enabled?reflectionSamples:1);
    const giShader = resolved.scene.diffuseGi?.enabled&&!resolved.scene.transport?.enabled&&!options.qaGeometry?.nativeMb3d&&!options.qaShaderTransform?integrateDiffuseBounce(baseShader,{view:'combined'}):baseShader;
    const module = device.createShaderModule({ code: geoCache ? geometryCacheShader(giShader) : transformDiagnostic(giShader) });
    const pipes = new Map<GPUTextureFormat, Pipe>();
    const format = context ? canvasFormat : OFFSCREEN_FORMAT;
    const compiled: Compiled = { module, pipes, code: code.wgsl,fieldBuffer,fieldTexture,primitives,primaryPrimitives,externalGeometry,surface,proceduralDetail,materialTextures,gradientTextures,boxCut,displacement,fractalDisplacement,masked:giShader.includes('tileBits'),floorScaled:(resolved.scene.render.quality.precision_floor??1)<1 };
    try {
      const create = (target: GPUTextureFormat, shaderModule: GPUShaderModule = module): Promise<GPURenderPipeline> => device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs" },
        fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format: target }] },
        primitive: { topology: "triangle-list" },
      });
      // LOOKDEV-05: an on-screen engine also needs the offscreen pipeline (LookDev, stills), and with reflections the multi-bounce one. Each pipeline of this
      // shader costs 35-60 s on a heavy fractal the first time; asking for all of them at once lets the driver build them side by side instead of one
      // after the other (cold start of reference scene: about 120 s in a row, about 45 s together).
      const wanted: GPUTextureFormat[] = options.parallelPipelines && context && format !== OFFSCREEN_FORMAT ? [format, OFFSCREEN_FORMAT] : [format];
      const together = !!options.parallelPipelines && !!context && !geometryDetail && !options.qaShaderTransform && needsMulti(FULL_VIEWPORT_FEATURES, resolved.scene);
      // The extra variant gets its own error scope: if it fails, the scene still works and the variant is built later, on demand, as before.
      let multi: Compiled | undefined, multiBuilt: Promise<GPURenderPipeline | null> = Promise.resolve(null), multiProblem: Promise<GPUError | null> = Promise.resolve(null);
      if (together) {
        device.pushErrorScope("validation");
        try { multi = makeMulti(compiled, resolved.scene); multiBuilt = create(OFFSCREEN_FORMAT, multi.module).catch(() => null); } catch { multi = undefined; }
        multiProblem = device.popErrorScope();
      }
      // The pipeline that writes colour and the depth/normal layer too is what a first LookDev picture starts with: it is built with the others.
      const createLayers = (shaderModule: GPUShaderModule): Promise<GPURenderPipeline | null> => device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs" },
        fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format: OFFSCREEN_FORMAT }, { format: DATA_FORMAT }] },
        primitive: { topology: "triangle-list" },
      }).catch(() => null);
      const layersBuilt = options.parallelPipelines && context ? createLayers(module) : Promise.resolve(null);
      const multiLayersBuilt = multi ? createLayers(multi.module) : Promise.resolve(null);
      const [built, multiPipeline, layersPipeline, multiLayersPipeline] = await Promise.all([Promise.all(wanted.map((target) => create(target))), multiBuilt, layersBuilt, multiLayersBuilt]);
      const layered = (pipeline: GPURenderPipeline): Pipe => ({ pipeline, bindGroup: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindEntries(fieldBuffer,fieldTexture,primitives,surface) }),fieldBuffer,fieldTexture,primitives,surface });
      if (layersPipeline) compiled.layers = layered(layersPipeline);
      wanted.forEach((target, i) => pipes.set(target, {
        pipeline: built[i]!,
        bindGroup: device.createBindGroup({ layout: built[i]!.getBindGroupLayout(0), entries: bindEntries(fieldBuffer,fieldTexture,primitives,surface) }),fieldBuffer,fieldTexture,primitives,surface,
      }));
      if (multi && multiPipeline && !(await multiProblem)) {
        multi.pipes.set(OFFSCREEN_FORMAT, { pipeline: multiPipeline, bindGroup: device.createBindGroup({ layout: multiPipeline.getBindGroupLayout(0), entries: bindEntries(fieldBuffer,fieldTexture,primitives,surface) }),fieldBuffer,fieldTexture,primitives,surface });
        if (multiLayersPipeline) multi.layers = layered(multiLayersPipeline);
        compiled.multi = multi;
      }
    } catch (error) {
      await device.popErrorScope();
      const details=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error').map(m=>`rad ${m.lineNum}: ${m.message}`);
      return { errors: [...details,error instanceof Error ? error.message : String(error)] };
    }
    const info = await module.getCompilationInfo();
    const problem = await device.popErrorScope();
    const errors = info.messages.filter((m) => m.type === "error").map((m) => `rad ${m.lineNum}: ${m.message}`);
    if (problem && errors.length === 0) errors.push(problem.message);
    return errors.length > 0 ? { errors } : { errors, result: compiled };
  }

  /** The options that change the shader text, appended to the scene's own key (one place, so the key never depends on who asks). */
  function finishKey(resolved:ResolvedScene,scene:Scene):void {
    if(reflectionSamples>1)resolved.key+='|independent-reflections:'+(scene.reflections.enabled?reflectionSamples:1);
    // Only WHETHER the gain / orbit mix is in the shader is part of the key; their values are uniforms (moving the slider must not rebuild the shader).
    resolved.key+='|secondary-radiance-gain:'+((scene.transport?.enabled?1:scene.reflections.secondary_radiance_gain??1)===1?'off':'uniform');
    resolved.key+='|diffuse-orbit:'+(scene.transport?.enabled||options.qaGeometry?.nativeMb3d||!diffuseOrbitRequest(scene.material)?'off':'uniform');
    if(scene.diffuseGi?.enabled)resolved.key+='|diffuse-gi:1';
    // Whether the fractal is displaced is part of the key; the layers themselves are uniforms (editing them never rebuilds the shader).
    if(fractalDisplacementActive(scene.fractalDisplacement)&&!options.qaGeometry)resolved.key+='|fractal-displacement';
    // The scene key says "surface-look" only for scenes that use it. A look-ready engine compiles the code for every scene, so that word is dropped from the key.
    // Live objects: the key must not say whether there are objects, because the shader always has the object code.
    if(liveObjects)resolved.key=resolved.key.replace(',"scene-primitives"','')+'|live-objects';
    if(lookReadyShader||geoCache)resolved.key=resolved.key.replace(/,"surface-look"\]/,']')+(geoCache?'|geo-cache':'|look-ready');
  }

  function compile(resolved: ResolvedScene, stale: () => boolean = () => false): Promise<{ errors: string[]; result?: Compiled }> {
    // A compile that is still waiting in the queue while the user has asked for another shader is not run (no result, no errors: the request is superseded).
    const run = compileQueue.then(() => (stale() ? Promise.resolve({ errors: [] as string[] }) : compileNow(resolved)));
    compileQueue = run.catch(() => undefined);
    return run;
  }

  // LOOKDEV-05: the on-screen engine remembers one more finished shader (the plain and the look variant of the open scene), so going back and forth, or
  // switching to a variant built in advance (prepareScene), is instant. Only shaders that own nothing tied to one scene are remembered.
  const switcher = new SceneSwitcher<ResolvedScene, Compiled>((_key, resolved, stale) => compile(resolved, stale), {
    keep: options.parallelPipelines ? 1 : 0,
    keepable: (c) => !c.fieldBuffer && !c.fieldTexture && !c.surface && !c.primitives && !c.primaryPrimitives && !c.externalGeometry && !c.boxCut && !c.displacement && !c.materialTextures && !c.proceduralDetail,
  });

  function needsMulti(features:ViewportFeatures=FULL_VIEWPORT_FEATURES,scene:Scene|undefined=active?.scene):boolean {
    const settings=scene?.reflections;
    const allowed=features.secondaryReflections!==false&&features.reflections!==false&&features.material!==false;
    return allowed&&((!!settings?.enabled&&Math.min(settings.maxReflectionBounces,features.reflectionBudget?.maxBounces??settings.maxReflectionBounces)>1)||!!(scene?.transport?.enabled&&hasTransmissionVolumes(scene)));
  }
  /** Opaque coarse preview uses the fast variant; glass needs the asynchronously compiled transport variant. Resources are shared. */
  /** LOOKDEV-05: the multi-bounce variant of a compiled scene shader, built for `scene` (which is not necessarily the active scene yet). */
  function makeMulti(base:Compiled,scene:Scene):Compiled {
    const rawMulti=buildShader(base.code,{tileMask:!!options.tileMask,floorScale:(scene.render.quality.precision_floor??1)<1,surfaceLook:lookShader(scene),qaPrimaryHitCoefficient:options.qaPrimaryHitCoefficient,qaGeometry:options.qaGeometry,geometryContinuation:!!geometryDetail,layers:true,primitives:base.primaryPrimitives??base.primitives,secondaryGeometry:base.externalGeometry,multiBounce:true,diffuseOrbit:scene.transport?.enabled||options.qaGeometry?.nativeMb3d?undefined:diffuseOrbitRequest(scene.material),secondaryRadianceGain:scene.transport?.enabled?1:scene.reflections.secondary_radiance_gain??1,surfaceDetail:!!base.surface,proceduralDetail:base.proceduralDetail,boxCut:base.boxCut,displacement:base.displacement,fractalDisplacement:base.fractalDisplacement,materialTextures:base.materialTextures,gradientTextures:base.gradientTextures});
    const multiCode=scene.diffuseGi?.enabled&&!scene.transport?.enabled&&!options.qaGeometry?.nativeMb3d&&!options.qaShaderTransform?integrateDiffuseBounce(rawMulti,{view:'combined'}):rawMulti;
    return {module:device.createShaderModule({code:geoCache?geometryCacheShader(multiCode):multiCode}),pipes:new Map(),code:base.code,primitives:base.primitives,primaryPrimitives:base.primaryPrimitives,externalGeometry:base.externalGeometry,fieldBuffer:base.fieldBuffer,fieldTexture:base.fieldTexture,surface:base.surface,proceduralDetail:base.proceduralDetail,boxCut:base.boxCut,displacement:base.displacement,fractalDisplacement:base.fractalDisplacement,materialTextures:base.materialTextures,gradientTextures:base.gradientTextures,masked:multiCode.includes('tileBits'),floorScaled:base.floorScaled};
  }
  function compiledFor(multi=false):Compiled {
    const base=switcher.current;if(!base)throw Error('No scene has been set.');
    if(!multi)return base;
    if(options.qaShaderTransform)throw Error('Diagnostic shader transform is validated only for opaque offscreen rendering');
    return base.multi??=makeMulti(base,active!.scene);
  }
  function refreshImageBindings():void {
    const base=switcher.current;
    for(const compiled of [base,base?.multi]){
      if(!compiled)continue;
      for(const pipe of [...compiled.pipes.values(),...(compiled.layers?[compiled.layers]:[])]){
        pipe.bindGroup=device.createBindGroup({layout:pipe.pipeline.getBindGroupLayout(0),entries:bindEntries(pipe.fieldBuffer,pipe.fieldTexture,pipe.primitives,pipe.surface)});
      }
    }
  }
  function pipeFor(format: GPUTextureFormat,multi=false): Pipe {
    const compiled = compiledFor(multi);
    if (!compiled) throw new Error("No scene has been set.");
    let pipe = compiled.pipes.get(format);
    if (!pipe) {
      pipe = makePipe(compiled.module, format,compiled.fieldBuffer,compiled.fieldTexture,compiled.primitives,compiled.surface);
      compiled.pipes.set(format, pipe);
    }
    return pipe;
  }

  /** Cold offscreen compilation must not synchronously lock UI input before the first coarse image. */
  async function offscreenPipe(multi=false): Promise<Pipe> {
    const compiled = compiledFor(multi);
    if (!compiled) throw Error("No scene has been set.");
    const cached = compiled.pipes.get(OFFSCREEN_FORMAT);
    if (cached) return cached;
    const pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: compiled.module, entryPoint: "vs" },
      fragment: {
        module: compiled.module,
        entryPoint: "fs",
        targets: [{ format: OFFSCREEN_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    const pipe = {
      pipeline,fieldBuffer:compiled.fieldBuffer,fieldTexture:compiled.fieldTexture,primitives:compiled.primitives,surface:compiled.surface,
      bindGroup: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: bindEntries(compiled.fieldBuffer,compiled.fieldTexture,compiled.primitives,compiled.surface),
      }),
    };
    compiled.pipes.set(OFFSCREEN_FORMAT, pipe);
    return pipe;
  }
  let previewQuality: QualitySettings = { ...DEFAULT_QUALITY };
  let previewFeatures = {...FULL_VIEWPORT_FEATURES};
  /** The live preview draws only the strongest lights, unless asked for full quality. */
  let previewLightLimit: number | null = PREVIEW_LIGHT_LIMIT;
  let previewDebugView: DebugView = "off";
  /** True when the preview was asked to use the scene's own detail values. */
  let previewQualityFromScene = false;

  function writeUniforms(
    width: number,
    height: number,
    tileX = 0,
    tileY = 0,
    quality: QualitySettings = previewQuality,
    jitter: readonly [number, number] = [0, 0],
    lightLimit: number | null = previewLightLimit,
    debugView: DebugView = previewDebugView,
    features: ViewportFeatures = FULL_VIEWPORT_FEATURES,
    aperture: readonly [number,number] = [0,0],
    dofEnabled = true,
    details?: DetailSettings,
    profileStage = 0,
    sampleIndex = 0,
    hdrOutput = false,
    lightingOverride?: Float32Array,
    referenceFilm:ReferenceFilm={width,height},
  ): void {
    const a = active!;
    if(switcher.current?.materialTextures)device.queue.writeBuffer(pbrBuffer,0,packMaterialTextures(surfaceMaterials(a.scene),switcher.current.surface!.images,packRampTail(rampTextureTable(a.scene.color.gradient.stops,a.scene.primitives?.length??0))) as Float32Array<ArrayBuffer>);
    const surface=switcher.current?.surface;if(surface?.displacement)device.queue.writeBuffer(displacementBuffer,0,packDisplacement(a.scene,surface.images,surface.heightBounds!) as Float32Array<ArrayBuffer>);if(surface)device.queue.writeBuffer(surfaceBuffer,0,(switcher.current?.proceduralDetail?packProceduralSurfaceDetails:packSurfaceDetails)(surfaceMaterials(a.scene),surface.images,surface.side) as Float32Array<ArrayBuffer>);
    // The formulas' own safety margins multiply the global step factor. The preview keeps its cheap defaults, but
    // follows the scene's choice of precision mode, so thresholds there follow the preview's own pixel size.
    const own = a.scene.render.quality;
    const cheapPreview = quality === previewQuality && !previewQualityFromScene;
    const stepFactor = quality.step_factor * a.stepFactor;
    const used: QualitySettings = {
      ...quality,
      ...(cheapPreview ? { precision_mode: own.precision_mode, hit_pixels: own.hit_pixels, normal_pixels: own.normal_pixels,normal_policy:own.normal_policy,hit_policy:own.hit_policy,...(own.precision_floor!==undefined?{precision_floor:own.precision_floor}:{}) } : {}),
      step_factor: stepFactor,
      // Shorter steps need more of them to reach as far: the preview gets more steps in the same proportion
      // (pictures use the scene's own number of steps, which the user sets).
      ...(cheapPreview && stepFactor < quality.step_factor ? { max_steps: Math.min(QUALITY_LIMITS.max_steps[1], Math.ceil((quality.max_steps * quality.step_factor) / stepFactor)) } : {}),
    };
    packUniforms(
      cameraBasis(a.scene.camera),
      width,
      height,
      verticalFovDegrees(cameraFov(a.scene.camera,a.scene.render.fov_axis,width,height), a.scene.render.fov_axis, width, height),
      a.parameterValues,
      a.colorData,
      [tileX, tileY],
      uniforms,
      used,
      jitter,
      a.scene.fog,
      { lights: a.scene.lights, ambient: a.scene.ambient, limit: lightLimit },
      debugView,
      { weights: a.chainWeights, julia: a.julia, loops: a.loops },
      { settings: a.scene.environment, sh: envSh },
      { settings: effectiveMaterial(a.scene.color, a.scene.material), maxLod: envMaxLod }, // MATERIAL-GRADIENT-01: same object when no Material stop
      viewportFeatureMask(features),
      { cutout: a.scene.cutout, details: details ?? a.scene.details },
      { camera:a.scene.camera, sample:dofEnabled ? aperture : [0,0] },
      { settings:reflectionSamples>1&&a.scene.reflections.enabled?{...a.scene.reflections,samples:reflectionSamples}:a.scene.reflections,budget:features.reflectionBudget,seed:quality.seed,sample:sampleIndex },
      {settings:{enabled:!!a.scene.transport?.enabled&&hasTransmissionVolumes(a.scene)&&(profileStage===0||profileStage===GEOMETRY_CACHE_READ_STAGE),maxBounces:a.scene.transport?.maxBounces??6},maxBounces:features.maxTransportBounces},
      normalFilmData(a.scene.camera,{...a.scene.render,quality:used},referenceFilm,features.filmNormals!==false,features.filmHits!==false),
    );
    if(lightingOverride)uniforms.set(lightingOverride,LIGHTS_OFFSET);
    if(quality.camera_sampling==='stratified')uniforms.set([1,quality.seed&65535,quality.seed>>>16,sampleIndex],CAMERA_SAMPLING_OFFSET);
    const d=a.scene.display??defaultDisplay();uniforms.set([d.exposure,['linear','reinhard','filmic'].indexOf(d.toneMapping),d.transfer==='srgb'?1:0,hdrOutput?1:0],DISPLAY_OFFSET);
    uniforms.set(packFractalDisplacement(switcher.current?.fractalDisplacement?a.scene.fractalDisplacement:undefined),FDISP_OFFSET);
    {const orbit=diffuseOrbitRequest(a.scene.material);uniforms.set([orbit?.influence??1,a.scene.transport?.enabled?1:a.scene.reflections.secondary_radiance_gain??1,0,0,...(orbit?.color??[1,1,1]),0],TUNE_OFFSET);}
    uniforms[22] = profileStage; // reserved tile.z; zero preserves final output
    uniforms[23] = used.precision_floor ?? 0; // tile.w: the scale of the Float32 floor (0 = the legacy floor)
    packTileMask(activeMask, uniforms);
    const external=secondaryInputs.get(a);
    if(a.scene.primitives?.length||external?.objects.length||liveObjects)device.queue.writeBuffer(primitiveBuffer,0,(external?packSecondaryGeometry(a.scene.primitives??[],external):packPrimitives(a.scene.primitives??[])) as Float32Array<ArrayBuffer>);
    device.queue.writeBuffer(buffer, 0, uniforms as Float32Array<ArrayBuffer>);
  }

  /** Set only while the refinement passes of one band are drawn. */
  let activeMask: TileMask | null = null;

  function draw(views: GPUTextureView[], pipe: Pipe, encoder: GPUCommandEncoder, query?: GPUQuerySet, load=false, slot=0): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: views.map((view) => ({ view, loadOp: load ? "load" as const : "clear" as const, storeOp: "store" as const, clearValue: { r: 0, g: 0, b: 0, a: 1 } })),
      ...(query ? {timestampWrites:{querySet:query,beginningOfPassWriteIndex:2*slot,endOfPassWriteIndex:2*slot+1}} : {}),
    });
    pass.setPipeline(pipe.pipeline);
    pass.setBindGroup(0, geometryDetail?device.createBindGroup({layout:pipe.pipeline.getBindGroupLayout(0),entries:bindEntries(pipe.fieldBuffer,pipe.fieldTexture,pipe.primitives,pipe.surface)}):pipe.bindGroup);
    pass.draw(3);
    pass.end();
  }

  /** The pipeline that writes colour and the depth/normal layer in one pass. Compiled the first time it is needed. */
  async function layerPipe(multi=false, background=false): Promise<Pipe> {
    const compiled = compiledFor(multi);
    if (!compiled) throw new Error("No scene has been set.");
    if (compiled.layers) return compiled.layers;
    if (compiled.layersPending) return compiled.layersPending;
    // A background build runs beside the queue (it must never hold up the pipelines the picture needs now) and so has no error scope of its own:
    // a failed pipeline rejects the promise, which is all it needs.
    const build = async () => {
      if (!background) device.pushErrorScope("validation");
      const module = compiled.module;
      const pipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: OFFSCREEN_FORMAT }, { format: DATA_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindEntries(compiled.fieldBuffer,compiled.fieldTexture,compiled.primitives,compiled.surface) });
      const problem = background ? null : await device.popErrorScope();
      // The module was already validated by pipeline creation. Re-requesting
      // compilation info for a shared module can stall Chromium/Dawn drivers.
      const errors = problem ? [problem.message] : [];
      return { errors, pipe: { pipeline, bindGroup,fieldBuffer:compiled.fieldBuffer,fieldTexture:compiled.fieldTexture,primitives:compiled.primitives,surface:compiled.surface } as Pipe };
    };
    const job = background ? build() : compileQueue.then(build);
    if (!background) compileQueue = job.catch(() => undefined);
    const pending = job.then((made) => {
      if (made.errors.length > 0) throw new Error(made.errors.join("; "));
      compiled.layers = made.pipe;
      return made.pipe;
    });
    compiled.layersPending = pending;
    pending.catch(() => { if (compiled.layersPending === pending) compiled.layersPending = undefined; });
    return pending;
  }
  /**
   * PROGRESSIVE-REFLECT-14: raising the reflection bounces from 1 to 2 or more switches to the multi-bounce shader, which takes 35-50 s to build the first time on a
   * heavy fractal. While the artist works with reflections on, that shader is built in the background, so the switch finds it ready.
   */
  function warmMultiBounceInBackground(): void {
    if (!geoCache || !active?.scene.reflections.enabled || options.qaShaderTransform || needsMulti()) return;
    const base = switcher.current;
    if (!base || base.multi?.layers || base.multi?.layersPending) return;
    void layerPipe(true, true).catch(() => undefined);
  }

  /** The work of one job should take about this long: short enough for the system not to give up on the graphics card. */
  const TARGET_JOB_SECONDS = 0.25;
  const FIRST_BAND_PIXELS = 262_144;
  const MAX_BAND_PIXELS = 4_000_000;
  const MIN_BAND_PIXELS = 16_384;

  function abortError(): Error {
    const e = new Error("The render was cancelled.");
    e.name = "AbortError";
    return e;
  }

  /**
   * Adds one finished sample (the rgba16float target of a band) to a float32 sum kept on the GPU. Reading each sample back and adding
   * it in JavaScript cost about 340 ms per 1600x900 sample against 35 ms of drawing; now only the final sum is read, once.
   */
  let accumulatePipeline: GPUComputePipeline | undefined;
  function accumulatePipe(): GPUComputePipeline {
    return accumulatePipeline ??= device.createComputePipeline({
      layout: "auto",
      compute: { entryPoint: "cs", module: device.createShaderModule({ code: /* wgsl */ `
struct Params { width : u32, rows : u32, first : u32, pad : u32 }
@group(0) @binding(0) var<uniform> p : Params;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> acc : array<vec4f>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= p.width || id.y >= p.rows) { return; }
  let i = id.y * p.width + id.x;
  let v = textureLoad(src, vec2u(id.x, id.y), 0);
  if (p.first == 1u) { acc[i] = v; } else { acc[i] = acc[i] + v; }
}` }) },
    });
  }

  /**
   * Draws the picture in horizontal bands. Every band is drawn once per sample (each time a little differently placed
   * inside the pixel), the samples are averaged in linear light, and the finished band is handed on.
   */
  async function renderRegionBands(
    width: number,
    height: number,
    options: RenderOptions,
    withLayers: boolean,
    onBand: (band: RenderBand) => void | Promise<void>,
  ): Promise<void> {
    if (!active || !switcher.current) throw new Error("No scene has been set.");
    if(options.qaOnPassTiming&&!options.onTiming)throw Error('Per-pass safety requires timestamp timing');
    if(geometryDetail){
      withLayers=true;
      if(options.dofMode!=='off'&&active.scene.camera.dof?.enabled)throw Error('GEO5 candidate uses pinhole geometry; turn off DOF for the native crop');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error("width and height must be whole numbers, 1 or more");
    }
    const maxSide = device.limits.maxTextureDimension2D;
    const region = options.region ?? { x: 0, y: 0, width, height };
    if (region.width > maxSide) throw Error("Internal tile width exceeds the GPU texture limit");
    const fields = [region.x, region.y, region.width, region.height];
    if (!fields.every(Number.isInteger) || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x + region.width > width || region.y + region.height > height) {
      throw new Error("the region must be whole numbers and lie inside the picture");
    }
    const quality: QualitySettings = { ...active.scene.render.quality, ...(options.quality ?? {}),...(geometryDetail?{step_factor:geometryDetail.stepMultiplier,max_steps:Math.min(geometryPassSteps,options.quality?.max_steps??active.scene.render.quality.max_steps)}:{}) };
    if ((quality.precision_floor ?? 1) < 1 && !geometryDetail && !compiledFor(needsMulti(options.features ?? FULL_VIEWPORT_FEATURES)).floorScaled) throw Error('A lowered precision floor must be part of the scene (render.quality.precision_floor): the picture shader is compiled for it.');
    const lightingOverride = options.lighting ? packLinearLighting(options.lighting) : undefined;
    const sampleOffset = options.sampleOffset ?? 0;
    if (!Number.isSafeInteger(sampleOffset) || sampleOffset < 0) throw Error('sampleOffset must be a nonnegative integer');
    if(reflectionSamples>1&&sampleOffset+quality.samples_per_pixel-1>MAX_REFLECTION_CAMERA_ID)throw Error('Independent reflection camera identity exceeds exact lab range');
    if (options.profileStage !== undefined && (!Number.isInteger(options.profileStage) || options.profileStage < 0 || options.profileStage > 7)) throw Error('profileStage must be 0–7');
    if(options.dofSamples!==undefined&&(!Number.isInteger(options.dofSamples)||options.dofSamples<1||options.dofSamples>64))throw Error('dofSamples must be 1–64');
    const hasDof=options.dofMode!=='off' && active!.scene.camera.dof?.enabled && active!.scene.camera.projection!=='orthographic' && options.debugView!=='raw';
    const samples = Math.max(1, Math.floor(quality.samples_per_pixel),hasDof?(options.dofSamples??16):1);
    if(quality.camera_sampling==='stratified'&&sampleOffset+samples>CAMERA_SAMPLE_LIMIT)throw Error('Stratified camera sampling requires global indices below 2^24');

    if(reflectionSamples>1&&options.features?.reflectionBudget)throw Error('Independent reflection lab does not override viewport budgets');
    const multi=needsMulti(options.features??FULL_VIEWPORT_FEATURES);
    const layerPipeNow = withLayers ? await layerPipe(multi) : null;
    // A pinhole depth pass needs only the layer pipeline. Compile the color-only
    // pipeline lazily, after this first complete image can already be presented.
    const plainPipe = !layerPipeNow || samples > 1 ? await offscreenPipe(multi) : null;
    const outW = region.width;
    const colorRow = Math.ceil((outW * 8) / 256) * 256; // copies must be padded to 256 bytes per row
    const dataRow = Math.ceil((outW * 16) / 256) * 256;
    const fixedBand = options.tilePixels !== undefined;
    let bandPixels = geometryDetail?Math.min(rayBatchCapacity(options.qaRayBatchCapacity??defaultRayBatchCapacity),options.tilePixels??Infinity):fixedBand ? Math.max(1, options.tilePixels!) : FIRST_BAND_PIXELS;
    const started = performance.now();
    const totalWork = outW * region.height * samples;
    let doneWork = 0;

    for (let y0 = 0; y0 < region.height; ) {
      const rows = Math.min(maxSide, Math.floor(device.limits.maxBufferSize / Math.max(colorRow,dataRow)), Math.max(1, Math.floor(bandPixels / outW)), region.height - y0);
      const geoBytes=outW*rows*GEOMETRY_STATE_BYTES;
      if(geometryDetail)geometryCapacity(geoBytes);
      const geoRead=geometryDetail?device.createBuffer({size:geoBytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}):undefined;
      const colorTexture = device.createTexture({ size: [outW, rows], format: OFFSCREEN_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
      const legacy = options.qaLegacyReadback === true;
      const accBuffer = legacy ? undefined : device.createBuffer({ size: outW * rows * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const accRead = legacy ? undefined : device.createBuffer({ size: outW * rows * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const accParams = legacy ? undefined : device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const refine = options.refine, onlyRefine = refine?.only === true;
      if (refine) {
        if (legacy) throw Error('Selective refinement uses the GPU sum.');
        if (!compiledFor(multi).masked) throw Error('Selective refinement needs an engine created with tileMask: true, and a scene whose shader can skip tiles.');
        if (geometryDetail) throw Error('Selective refinement is for the standard Float32 path; Geometry Detail keeps its own passes.');
      }
      const refBuffer = refine ? device.createBuffer({ size: outW * rows * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }) : undefined;
      const refRead = refine ? device.createBuffer({ size: outW * rows * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : undefined;
      const dataTexture = withLayers
        ? device.createTexture({ size: [outW, rows], format: DATA_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
        : null;
      const colorRead = legacy ? device.createBuffer({ size: colorRow * rows, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : undefined;
      const dataRead = withLayers ? device.createBuffer({ size: dataRow * rows, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
      const linear = new Float32Array(outW * rows * 4);
      const sum = linear; // the colours added up in linear light
      const depth = withLayers ? new Float32Array(outW * rows) : undefined;
      const normal = withLayers ? new Float32Array(outW * rows * 3) : undefined;
      let slowest = 0;
      const query = options.onTiming && timestampSupported ? device.createQuerySet({type:'timestamp',count:2}) : undefined;
      const queryResolve = query ? device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}) : undefined;
      const queryRead = query ? device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}) : undefined;
      // Several samples are queued behind each other and waited for once: the waiting, not the drawing, was most of the time of a 16-sample picture.
      const MAX_BATCH = 16;
      const batchQuery = options.onTiming && timestampSupported ? device.createQuerySet({type:'timestamp',count:2*MAX_BATCH}) : undefined;
      const batchResolve = batchQuery ? device.createBuffer({size:8*2*MAX_BATCH,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}) : undefined;
      const batchRead = batchQuery ? device.createBuffer({size:8*2*MAX_BATCH,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}) : undefined;
      let batchSize = 1;
      /** Draws `count` samples (numbers start .. start+count-1) with `quality`, adds each to `target` on the GPU, and waits once. Returns the GPU time of each pass. */
      async function passBatch(p: { quality: QualitySettings; start: number; count: number; target: GPUBuffer; copyTo?: GPUBuffer; mask: TileMask | null }): Promise<number[]> {
        const pipe = plainPipe ?? await offscreenPipe(multi);
        for (let i = 0; i < p.count; i++) {
          if (options.signal?.aborted) throw abortError();
          const index = p.start + i;
          activeMask = p.mask;
          try { writeUniforms(width, height, region.x, region.y + y0, p.quality, sampleJitter(index + sampleOffset, p.quality.seed), null, options.debugView ?? "off", options.features ?? FULL_VIEWPORT_FEATURES, lensSample(index + sampleOffset, p.quality.seed), options.dofMode !== 'off', options.details, options.profileStage, index + sampleOffset, true, lightingOverride, options.referenceFilm); }
          finally { activeMask = null; }
          const encoder = device.createCommandEncoder();
          draw([colorTexture.createView()], pipe, encoder, batchQuery, false, i);
          device.queue.submit([encoder.finish()]);
          device.queue.writeBuffer(accParams!, 0, new Uint32Array([outW, rows, index === 0 ? 1 : 0, 0]));
          const add = device.createCommandEncoder(), pass = add.beginComputePass();
          pass.setPipeline(accumulatePipe());
          pass.setBindGroup(0, device.createBindGroup({ layout: accumulatePipe().getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: accParams! } }, { binding: 1, resource: colorTexture.createView() }, { binding: 2, resource: { buffer: p.target } }] }));
          pass.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(rows / 8)); pass.end();
          if (i === p.count - 1 && p.copyTo) add.copyBufferToBuffer(p.target, 0, p.copyTo, 0, outW * rows * 16);
          if (i === p.count - 1 && batchQuery && batchResolve && batchRead) { add.resolveQuerySet(batchQuery, 0, 2 * p.count, batchResolve, 0); add.copyBufferToBuffer(batchResolve, 0, batchRead, 0, 16 * p.count); }
          device.queue.submit([add.finish()]);
        }
        await device.queue.onSubmittedWorkDone();
        const times: number[] = [];
        if (batchQuery && batchRead) {
          await batchRead.mapAsync(GPUMapMode.READ, 0, 16 * p.count);
          const t = new BigUint64Array(batchRead.getMappedRange(0, 16 * p.count).slice(0));
          batchRead.unmap();
          for (let i = 0; i < p.count; i++) times.push(Number(t[2 * i + 1]! - t[2 * i]!) / 1e6);
        }
        return times;
      }
      try {
        const batchable = !legacy && !geometryDetail && !options.qaOnPassTiming;
        for (let k = 0; k < (onlyRefine ? 0 : samples); k++) {
          if (options.signal?.aborted) throw abortError();
          if (batchable && k >= 1) {
            const count = Math.min(batchSize, samples - k), started = performance.now();
            const times = await passBatch({ quality, start: k, count, target: accBuffer!, ...(k + count === samples ? { copyTo: accRead! } : {}), mask: null });
            const wall = performance.now() - started;
            slowest = Math.max(slowest, wall / 1000 / count);
            batchSize = Math.max(1, Math.min(MAX_BATCH, Math.floor(150 / Math.max(2, wall / count))));
            times.forEach((gpuMs) => options.onTiming?.({ gpuMs, gpuClock: 'timestamp', readbackMs: 0, accumulationMs: 0, wallMs: wall / count }));
            doneWork += outW * rows * count;
            options.onProgress?.({ fraction: doneWork / totalWork, rowsDone: y0 + Math.floor((rows * (k + count)) / samples), rowsTotal: region.height, elapsedSeconds: (performance.now() - started) / 1000 });
            k += count - 1;
            continue;
          }
          const first = k === 0 && layerPipeNow !== null;
          if(geometryDetail){const clear=device.createCommandEncoder();clear.clearBuffer(geoState!);device.queue.submit([clear.finish()]);} // depth and normals come from the sample at the pixel centre
          const t0 = performance.now();
          writeUniforms(width, height, region.x, region.y + y0, quality, sampleJitter(k + sampleOffset, quality.seed), null, options.debugView ?? "off", options.features ?? FULL_VIEWPORT_FEATURES, lensSample(k + sampleOffset,quality.seed), options.dofMode!=='off', options.details, options.profileStage,k+sampleOffset,true,lightingOverride,options.referenceFilm);
          let gpuMs = 0;
          const passCount=geometryDetail?Math.ceil(geometryDetail.maxSteps/geometryPassSteps):1;
          for(let gp=0;gp<passCount;gp++){
          if(options.signal?.aborted)throw abortError();
          if(geometryDetail)device.queue.writeBuffer(geoControl!,0,new Uint32Array([outW,Math.min(geometryPassSteps,geometryDetail.maxSteps-gp*geometryPassSteps),gp,0]));
          const passStart=performance.now();
          const encoder = device.createCommandEncoder();
          draw(first && dataTexture ? [colorTexture.createView(), dataTexture.createView()] : [colorTexture.createView()], first ? layerPipeNow! : plainPipe!, encoder, query,gp>0);
          if (colorRead) encoder.copyTextureToBuffer({ texture: colorTexture }, { buffer: colorRead, bytesPerRow: colorRow }, [outW, rows]);
          if (first && dataTexture && dataRead) {
            encoder.copyTextureToBuffer({ texture: dataTexture }, { buffer: dataRead, bytesPerRow: dataRow }, [outW, rows]);
          }
          if (query && queryResolve && queryRead) {
            encoder.resolveQuerySet(query,0,2,queryResolve,0);
            encoder.copyBufferToBuffer(queryResolve,0,queryRead,0,16);
          }
          if(geometryDetail)encoder.copyBufferToBuffer(geoState!,0,geoRead!,0,geoBytes);
          device.queue.submit([encoder.finish()]);
          if (options.onTiming) {
            await device.queue.onSubmittedWorkDone();
            let passGpuMs = performance.now() - passStart;
            if (queryRead) {
              await queryRead.mapAsync(GPUMapMode.READ);
              const times = new BigUint64Array(queryRead.getMappedRange());
              passGpuMs = Number(times[1]! - times[0]!) / 1e6;
              queryRead.unmap();
            }
            gpuMs+=passGpuMs;
            options.qaOnPassTiming?.(passGpuMs);
          }
          if(geometryDetail){
            await geoRead!.mapAsync(GPUMapMode.READ);
            const state=new Float32Array(geoRead!.getMappedRange()).slice();geoRead!.unmap();
            const diagnostics={...geometryDiagnostics(state,gp+1),cameraPrecision:(nativeGeometry?'native-split':'float32-input') as 'native-split'|'float32-input',tile:{x:region.x,y:region.y+y0,width:outW,height:rows},sampleIndex:k};
            options.onGeometry?.(diagnostics,state);
            if(diagnostics.pending===0)break;
            // Browser input/cancel gets a turn between bounded GPU submissions.
            await new Promise(resolve=>setTimeout(resolve,0));
          }
          }
          const readStarted = performance.now();
          let accumulationMs = 0;
          if (colorRead) {
            await colorRead.mapAsync(GPUMapMode.READ); // waits until this job is finished
            slowest = Math.max(slowest, (performance.now() - t0) / 1000);
            const padded = new Uint16Array(colorRead.getMappedRange());
            const accumulationStarted = performance.now();
            for(let y=0;y<rows;y++)for(let x=0;x<outW;x++)for(let c=0;c<4;c++){
              const v=halfToFloat(padded[y*colorRow/2+x*4+c]!);
              if(!Number.isFinite(v))throw Error('Radiance exceeds the finite RGBA16Float range (65504); reduce physical light/emission intensity.');
              sum[(y*outW+x)*4+c]=sum[(y*outW+x)*4+c]!+v;
            }
            colorRead.unmap();
            accumulationMs = performance.now() - accumulationStarted;
          } else {
            // The sum stays on the graphics card. Waiting for the work to finish keeps every job short and measured, as before.
            device.queue.writeBuffer(accParams!, 0, new Uint32Array([outW, rows, k === 0 ? 1 : 0, 0]));
            const add = device.createCommandEncoder(), pass = add.beginComputePass();
            pass.setPipeline(accumulatePipe());
            pass.setBindGroup(0, device.createBindGroup({ layout: accumulatePipe().getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: accParams! } }, { binding: 1, resource: colorTexture.createView() }, { binding: 2, resource: { buffer: accBuffer! } }] }));
            pass.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(rows / 8)); pass.end();
            if (k === samples - 1) add.copyBufferToBuffer(accBuffer!, 0, accRead!, 0, outW * rows * 16);
            device.queue.submit([add.finish()]);
            await device.queue.onSubmittedWorkDone();
            slowest = Math.max(slowest, (performance.now() - t0) / 1000);
          }
          if (first && dataRead && depth && normal) {
            await dataRead.mapAsync(GPUMapMode.READ);
            const dataCopyStarted = performance.now();
            const values = new Float32Array(dataRead.getMappedRange());
            const stride = dataRow / 4;
            for (let y = 0; y < rows; y++) {
              for (let x = 0; x < outW; x++) {
                const from = y * stride + x * 4;
                const to = y * outW + x;
                depth[to] = values[from]!;
                normal[to * 3] = values[from + 1]!;
                normal[to * 3 + 1] = values[from + 2]!;
                normal[to * 3 + 2] = values[from + 3]!;
              }
            }
            dataRead.unmap();
            accumulationMs += performance.now() - dataCopyStarted;
          }
          options.onTiming?.({gpuMs,gpuClock:query?'timestamp':'fenced-wall',readbackMs:Math.max(0,performance.now()-readStarted-accumulationMs),accumulationMs,wallMs:performance.now()-t0});
          if (k === 0) batchSize = Math.max(1, Math.min(MAX_BATCH, Math.floor(150 / Math.max(2, performance.now() - t0))));
          doneWork += outW * rows;
          options.onProgress?.({
            fraction: doneWork / totalWork,
            rowsDone: y0 + Math.floor((rows * (k + 1)) / samples),
            rowsTotal: region.height,
            elapsedSeconds: (performance.now() - started) / 1000,
          });
        }
        if (refine && refBuffer && refRead && accParams) {
          const refined: QualitySettings = { ...quality, ...refine.quality };
          const refinedSamples = Math.max(1, Math.floor(refine.samples));
          for (let r = 0; r < refinedSamples; ) {
            const count = Math.min(batchSize, refinedSamples - r), started = performance.now();
            const times = await passBatch({ quality: refined, start: r, count, target: refBuffer, ...(r + count === refinedSamples ? { copyTo: refRead } : {}), mask: refine.mask });
            const wall = performance.now() - started;
            slowest = Math.max(slowest, wall / 1000 / count);
            batchSize = Math.max(1, Math.min(MAX_BATCH, Math.floor(150 / Math.max(2, wall / count))));
            times.forEach((gpuMs) => { options.qaOnPassTiming?.(gpuMs); options.onTiming?.({ gpuMs, gpuClock: 'timestamp', readbackMs: 0, accumulationMs: 0, wallMs: wall / count, refinement: true } as RenderTiming); });
            r += count;
          }
        }
        if (accRead && !onlyRefine) {
          await accRead.mapAsync(GPUMapMode.READ);
          sum.set(new Float32Array(accRead.getMappedRange())); accRead.unmap();
        }
        if (accRead && !onlyRefine) { if (!scaleFinite(linear, samples)) throw Error('Radiance exceeds the finite RGBA16Float range (65504); reduce physical light/emission intensity.'); }
        else for(let i=0;i<linear.length;i++)linear[i]=linear[i]!/samples;
        if (refine && refRead) {
          await refRead.mapAsync(GPUMapMode.READ);
          const refined = new Float32Array(refRead.getMappedRange()), n = Math.max(1, Math.floor(refine.samples)); let bad = false;
          const tile = refine.mask.tile;
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < outW; ) {
              // Walk whole flagged runs of one tile row, not single pixels.
              const filmX = region.x + x, spanEnd = Math.min(outW, x + (tile - (filmX % tile)));
              if (tileFlagged(refine.mask, filmX, region.y + y0 + y)) {
                for (let o = (y * outW + x) * 4, end = (y * outW + spanEnd) * 4; o < end; o++) { const v = refined[o]!; if (v - v !== 0) bad = true; linear[o] = v / n; }
              }
              x = spanEnd;
            }
          }
          refRead.unmap();
          if (bad) throw Error('Radiance exceeds the finite RGBA16Float range (65504); reduce physical light/emission intensity.');
        }
      } finally {
        accBuffer?.destroy(); accRead?.destroy(); accParams?.destroy(); refBuffer?.destroy(); refRead?.destroy(); batchQuery?.destroy(); batchResolve?.destroy(); batchRead?.destroy();
        geoRead?.destroy();
        colorTexture.destroy();
        dataTexture?.destroy();
        colorRead?.destroy();
        dataRead?.destroy();
        query?.destroy();queryResolve?.destroy();queryRead?.destroy();
      }
      await onBand({ y: y0, rows, width: outW, color:onlyRefine?new Uint8Array(linear.length):displayRgba(linear,options.debugView&&options.debugView!=="off"||options.profileStage?defaultDisplay():active.scene.display), linear, display:active.scene.display, ...(depth ? { depth } : {}), ...(normal ? { normal } : {}) });
      y0 += rows;
      if (!fixedBand && !geometryDetail) {
        // One job (one sample of one band) should take about TARGET_JOB_SECONDS: grow or shrink the next band to match.
        const factor = Math.min(2, Math.max(0.5, TARGET_JOB_SECONDS / Math.max(slowest, 0.001)));
        bandPixels = Math.min(MAX_BAND_PIXELS, Math.max(MIN_BAND_PIXELS, Math.round(bandPixels * factor)));
      }
    }
  }

  /** Bounded GPU tiles assembled into row bands for incremental encoders. No full-frame GPU target. */
  async function renderBands(
    width: number,
    height: number,
    options: RenderOptions,
    withLayers: boolean,
    onBand: (band: RenderBand) => void | Promise<void>,
  ): Promise<void> {
    const problem = checkOutputSize(width, height);
    if (problem) throw Error(problem);
    const region = options.region ?? { x: 0, y: 0, width, height };
    if (
      ![region.x, region.y, region.width, region.height].every(
        Number.isSafeInteger,
      ) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width < 1 ||
      region.height < 1 ||
      region.x + region.width > width ||
      region.y + region.height > height
    )
      throw Error(
        "the region must be whole numbers and lie inside the picture",
      );
    if (
      options.tilePixels !== undefined &&
      (!Number.isSafeInteger(options.tilePixels) || options.tilePixels < 1)
    )
      throw Error("tilePixels must be a positive integer");
    const edge = safeTileSize(
      options.tileSize,
      device.limits.maxTextureDimension2D,
      device.limits.maxBufferSize,
    );
    const maxBandPixels = Math.min(
      MAX_BAND_PIXELS,
      Math.floor((32 * 2 ** 20) / (withLayers ? 36 : 20)),
    );
    let bandPixels = Math.min(
      options.tilePixels ?? FIRST_BAND_PIXELS,
      maxBandPixels,
    );
    const samples = Math.max(
      options.quality?.samples_per_pixel ??
        active?.scene.render.quality.samples_per_pixel ??
        1,
      options.dofMode !== "off" && active?.scene.camera.dof?.enabled
        ? (options.dofSamples ?? 16)
        : 1,
    );
    const started = performance.now();
    let done = 0;
    for (let y = 0; y < region.height; ) {
      if (options.signal?.aborted) throw abortError();
      const rows = Math.min(
          edge,
          Math.max(1, Math.floor(bandPixels / region.width)),
          region.height - y,
        ),
        color = new Uint8Array(region.width * rows * 4),
        linear = new Float32Array(region.width * rows * 4);
      const depth = withLayers
          ? new Float32Array(region.width * rows)
          : undefined,
        normal = withLayers
          ? new Float32Array(region.width * rows * 3)
          : undefined;
      let slowest = 0;
      for (let x = 0; x < region.width; x += edge) {
        const tileWidth = Math.min(edge, region.width - x),
          tilePixels = tileWidth * rows;
        const tileStarted = performance.now();
        await renderRegionBands(
          width,
          height,
          {
            ...options,
            region: {
              x: region.x + x,
              y: region.y + y,
              width: tileWidth,
              height: rows,
            },
            onProgress: (p) =>
              options.onProgress?.({
                fraction:
                  (done + p.fraction * tilePixels) /
                  (region.width * region.height),
                rowsDone:
                  x + tileWidth === region.width && p.fraction === 1
                    ? y + rows
                    : y,
                rowsTotal: region.height,
                elapsedSeconds: (performance.now() - started) / 1000,
              }),
          },
          withLayers,
          (band) => {
            for (let r = 0; r < band.rows; r++) {
              const destination = (band.y + r) * region.width + x;
              color.set(
                band.color.subarray(r * tileWidth * 4, (r + 1) * tileWidth * 4),
                destination * 4,
              );
              linear.set(band.linear!.subarray(r*tileWidth*4,(r+1)*tileWidth*4),destination*4);
              if (depth && band.depth)
                depth.set(
                  band.depth.subarray(r * tileWidth, (r + 1) * tileWidth),
                  destination,
                );
              if (normal && band.normal)
                normal.set(
                  band.normal.subarray(
                    r * tileWidth * 3,
                    (r + 1) * tileWidth * 3,
                  ),
                  destination * 3,
                );
            }
          },
        );
        slowest = Math.max(
          slowest,
          (performance.now() - tileStarted) / 1000 / samples,
        );
        done += tilePixels;
      }
      if (options.signal?.aborted) throw abortError();
      await onBand({
        y,
        rows,
        width: region.width,
        color, linear, display:active?.scene.display,
        ...(depth ? { depth } : {}),
        ...(normal ? { normal } : {}),
      });
      y += rows;
      if (options.tilePixels === undefined)
        bandPixels = Math.min(
          maxBandPixels,
          Math.max(
            MIN_BAND_PIXELS,
            Math.round(
              bandPixels *
                Math.min(
                  2,
                  Math.max(0.5, TARGET_JOB_SECONDS / Math.max(slowest, 0.001)),
                ),
            ),
          ),
        );
    }
  }

  /** Draws the image and collects all pixels in memory. */
  async function renderRawTiled(
    width: number,
    height: number,
    options: RenderOptions,
    withLayers: boolean,
  ): Promise<{ width: number; height: number; color: Uint8Array; linear:Float32Array; display?:DisplaySettings; depth?: Float32Array; normal?: Float32Array }> {
    const problem=checkOutputSize(width,height);if(problem)throw Error(problem);
    const outW = options.region?.width ?? width;
    const outH = options.region?.height ?? height;
    if (outW * outH * (withLayers ? 36 : 20) > 1.9e9) throw new Error("The image is too large to keep in memory. Use renderStream and write it to a file.");
    const color = new Uint8Array(outW * outH * 4);
    const linear=new Float32Array(outW*outH*4);
    const depth = withLayers ? new Float32Array(outW * outH) : undefined;
    const normal = withLayers ? new Float32Array(outW * outH * 3) : undefined;
    await renderBands(width, height, options, withLayers, (band) => {
      color.set(band.color, band.y * outW * 4);
      linear.set(band.linear!,band.y*outW*4);
      if (depth && band.depth) depth.set(band.depth, band.y * outW);
      if (normal && band.normal) normal.set(band.normal, band.y * outW * 3);
    });
    return { width: outW, height: outH, color, linear, display:active?.scene.display, ...(depth ? { depth } : {}), ...(normal ? { normal } : {}) };
  }

  function shouldDenoise(options:RenderOptions):boolean {
    return (options.denoise??active?.scene.denoise?.enabled??false)&&(!options.debugView||options.debugView==='off')&&!options.profileStage&&options.features?.material!==false&&options.features?.secondaryReflections!==false;
  }
  async function filterLayers(layers:LayerBuffers,width:number,height:number,signal?:AbortSignal,onTiming?:(t:DenoiseTiming)=>void,tileSize?:number):Promise<ImageBuffer>{
    if(!active)throw Error('No scene has been set.');const scene=active.scene,c=scene.camera;
    const vertical=verticalFovDegrees(cameraFov(c,scene.render.fov_axis,width,height),scene.render.fov_axis,width,height);
    return denoiser.filter(layers,c.projection==='orthographic'?0:2*Math.tan(vertical*Math.PI/360)/height,c.projection==='orthographic'?(c.ortho_height??4)/height:0,signal,onTiming,tileSize);
  }
  /** Each bounded output band renders a two-pixel halo in global image coordinates. Tile/region boundaries are invisible. */
  async function renderOutputBands(width:number,height:number,options:RenderOptions,withLayers:boolean,onBand:(band:RenderBand)=>void|Promise<void>):Promise<void>{
    if(!shouldDenoise(options)){await renderBands(width,height,options,withLayers,onBand);return;}
    const problem=checkOutputSize(width,height);if(problem)throw Error(problem);
    const region=options.region??{x:0,y:0,width,height};
    if(![region.x,region.y,region.width,region.height].every(Number.isSafeInteger)||region.width<1||region.height<1||region.x<0||region.y<0||region.x+region.width>width||region.y+region.height>height)throw Error('Invalid denoise region');
    if(options.tilePixels!==undefined&&(!Number.isSafeInteger(options.tilePixels)||options.tilePixels<1))throw Error('tilePixels must be a positive integer');
    const bandRows=Math.max(1,Math.min(512,Math.floor(Math.min(options.tilePixels??262144,1_000_000)/region.width))),started=performance.now();
    for(let y=0;y<region.height;y+=bandRows){
      if(options.signal?.aborted)throw abortError();const rows=Math.min(bandRows,region.height-y),r=DENOISE_RADIUS;
      const x0=Math.max(0,region.x-r),y0=Math.max(0,region.y+y-r),x1=Math.min(width,region.x+region.width+r),y1=Math.min(height,region.y+y+rows+r);
      const raw=await renderRawTiled(width,height,{...options,denoise:false,region:{x:x0,y:y0,width:x1-x0,height:y1-y0},onProgress:p=>options.onProgress?.({fraction:(y+p.fraction*rows*.99)/region.height,rowsDone:y,rowsTotal:region.height,elapsedSeconds:(performance.now()-started)/1000})},true);
      const filtered=await filterLayers(raw as LayerBuffers,width,height,options.signal,options.onDenoiseTiming,options.tileSize);
      const color=new Uint8Array(region.width*rows*4),linear=new Float32Array(region.width*rows*4),depth=withLayers?new Float32Array(region.width*rows):undefined,normal=withLayers?new Float32Array(region.width*rows*3):undefined;
      for(let j=0;j<rows;j++){const from=(region.y+y-y0+j)*raw.width+region.x-x0,to=j*region.width;color.set(filtered.data.subarray(from*4,(from+region.width)*4),to*4);linear.set(filtered.linear!.subarray(from*4,(from+region.width)*4),to*4);depth?.set(raw.depth!.subarray(from,from+region.width),to);normal?.set(raw.normal!.subarray(from*3,(from+region.width)*3),to*3);}
      if(options.signal?.aborted)throw abortError();await onBand({y,rows,width:region.width,color,linear,display:active?.scene.display,...(depth?{depth,normal}: {})});
      options.onProgress?.({fraction:(y+rows)/region.height,rowsDone:y+rows,rowsTotal:region.height,elapsedSeconds:(performance.now()-started)/1000});
    }
  }
  async function renderTiled(width:number,height:number,options:RenderOptions,withLayers:boolean){
    if(!shouldDenoise(options))return renderRawTiled(width,height,options,withLayers);
    const outW=options.region?.width??width,outH=options.region?.height??height;
    const problem=checkOutputSize(width,height);if(problem)throw Error(problem);
    if(outW*outH*(withLayers?36:20)>1.9e9)throw Error('The image is too large to keep in memory. Use renderStream.');
    const color=new Uint8Array(outW*outH*4),linear=new Float32Array(outW*outH*4),depth=withLayers?new Float32Array(outW*outH):undefined,normal=withLayers?new Float32Array(outW*outH*3):undefined;
    await renderOutputBands(width,height,options,withLayers,band=>{color.set(band.color,band.y*outW*4);linear.set(band.linear!,band.y*outW*4);depth?.set(band.depth!,band.y*outW);normal?.set(band.normal!,band.y*outW*3);});
    return {width:outW,height:outH,color,linear,display:active?.scene.display,depth,normal};
  }

  return {
    async denoiseBuffer(layers,options={}){return filterLayers(layers,options.frameWidth??layers.width,options.frameHeight??layers.height,options.signal,options.onTiming,options.tileSize);},
    get shaderCompilations(){return shaderCompilations;},
    async pickSurface(rawWidth,rawHeight,rawX,rawY,excludeId) {
      if(!active||!switcher.current)throw Error('No scene has been set.');
      if(![rawWidth,rawHeight,rawX,rawY].every(Number.isFinite)||rawWidth<=0||rawHeight<=0||rawX<0||rawY<0||rawX>rawWidth||rawY>rawHeight)throw Error('Invalid pick coordinates');
      const {width,height,x,y}=wholePickFilm(rawWidth,rawHeight,rawX,rawY);
      const compiled=switcher.current,scene=active.scene;
      if(!compiled.pick){
        const job=compileQueue.then(async()=>{
          const module=device.createShaderModule({code:buildShader(compiled.code,{primitives:true,multiBounce:false,boxCut:compiled.boxCut,displacement:compiled.displacement,fractalDisplacement:compiled.fractalDisplacement,surfaceDetail:compiled.displacement})+`
@group(0) @binding(11) var<storage,read_write> pickResult:array<vec4f>;
@compute @workgroup_size(1) fn pickSurfaceCs(){
 let res=u.view.xy;let ndc=vec2f(2.0*u.tile.x-res.x,res.y-2.0*u.tile.y)/res.y;
 var origin=u.camPos.xyz;var dir=normalize(u.forward.xyz+(u.right.xyz*ndc.x+u.up.xyz*ndc.y)*u.view.z);
 if(u.cameraEffects.x>0.0){origin+=(u.right.xyz*ndc.x+u.up.xyz*ndc.y)*u.cameraEffects.x*0.5;dir=u.forward.xyz;}
 let h=queryScene(origin,dir,0);
 pickResult[0]=vec4f(h.position,h.distance);pickResult[1]=vec4f(select(h.normal,-h.normal,dot(h.normal,dir)>0.0),h.epsilon);
 pickResult[2]=vec4f(f32(h.objectType),f32(h.objectId),f32(h.materialId),select(0.0,1.0,h.hit));
}`});
          return device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'pickSurfaceCs'}});
        });compileQueue=job.catch(()=>undefined);compiled.pick=await job;
      }
      writeUniforms(width,height,x,y,scene.render.quality,[0,0],null,'off',FULL_VIEWPORT_FEATURES,[0,0],false);
      device.queue.writeBuffer(primitiveBuffer,0,packPrimitives((scene.primitives??[]).map(p=>p.id===excludeId?{...p,enabled:false}:p)) as Float32Array<ArrayBuffer>);
      const out=device.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try {
        const entries=bindEntries(compiled.fieldBuffer,compiled.fieldTexture,true,compiled.displacement?compiled.surface:undefined).filter(e=>(compiled.displacement?[0,8,9,10,12,13,16]:[0,8,9,10]).includes(e.binding));
        const group=device.createBindGroup({layout:compiled.pick.getBindGroupLayout(0),entries:[...entries,{binding:11,resource:{buffer:out}}]});
        const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(compiled.pick);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(out,0,read,0,48);device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);const v=new Float32Array(read.getMappedRange()).slice();read.unmap();
        if(v[11]!==1)return null;const object=scene.primitives?.[v[9]!-1];
        return {hit:true,distance:v[3]!,position:[v[0]!,v[1]!,v[2]!],normal:[v[4]!,v[5]!,v[6]!],objectType:object?.type??'fractal',objectId:object?.id??'fractal',materialId:v[10]===0?'scene':object?.id??'scene'};
      }finally{out.destroy();read.destroy();device.queue.writeBuffer(primitiveBuffer,0,packPrimitives(scene.primitives??[]) as Float32Array<ArrayBuffer>);}
    },
    setFormulas(list) {
      formulas = list;
      switcher.forgetKept(); // an edited formula keeps its id, so a shader built before the edit must not come back
    },

    setTextureImage(image) {
      if (image) {
        const maxSide = device.limits.maxTextureDimension2D;
        if (image.width < 1 || image.height < 1 || image.width > maxSide || image.height > maxSide) {
          throw new Error(`The texture must be from 1 to ${maxSide} pixels on each side`);
        }
        if (image.data.length !== image.width * image.height * 4) throw new Error("the texture needs 4 numbers per pixel (RGBA)");
      }
      const old = texture;
      texture = image ? makeTexture(image.width, image.height, image.data) : makeTexture(1, 1, WHITE_PIXEL);
      // Pipelines made earlier point at the old picture: give them the new one.
      refreshImageBindings();
      old.destroy();
    },

    setEnvironmentImage(image) {
      if (image) {
        const maxSide = device.limits.maxTextureDimension2D;
        if (image.width < 1 || image.height < 1 || image.width > maxSide || image.height > maxSide) {
          throw new Error(`The environment picture must be from 1 to ${maxSide} pixels on each side`);
        }
        if (image.data.length !== image.width * image.height * 3) throw new Error("the environment picture needs 3 numbers per pixel (RGB)");
      }
      const old = envTexture;
      envTexture = makeEnvTexture(image);
      envSh = image ? irradianceCoefficients(image) : null;
      refreshImageBindings();
      old.destroy();
    },


    progressiveBegin(width, height, opts) {
      if (!geoCache) throw Error("progressive geometry cache needs the research option geometryCache on an offscreen engine");
      if (!active || !switcher.current) throw Error("No scene has been set.");
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw Error("width and height must be whole numbers, 1 or more");
      if (!Number.isInteger(opts.samples) || opts.samples < 1 || opts.samples > 64) throw Error("samples must be 1-64");
      progressiveEndNow();
      const make = (usage: number, size: number) => device.createBuffer({ size, usage });
      prog = {
        width, height, samples: opts.samples, quality: { ...active.scene.render.quality, ...(opts.quality ?? {}), samples_per_pixel: opts.samples } as QualitySettings, referenceFilm: opts.referenceFilm,
        textures: [], count: 0,
        color: device.createTexture({ size: [width, height], format: OFFSCREEN_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }),
        data: device.createTexture({ size: [width, height], format: DATA_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
        sum: make(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, width * height * 16),
        read: make(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, width * height * 16),
        params: make(GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 16),
      };
    },

    async progressiveAdd(count, opts = {}) {
      const st = prog; if (!st) throw Error("progressiveBegin first");
      if (opts.signal?.aborted) throw abortError();
      if (!Number.isInteger(count) || count < 1 || st.count + count > st.samples) throw Error("count must fit in the samples the picture was begun with");
      const pipe = await layerPipe(needsMulti());
      warmMultiBounceInBackground();
      const started = performance.now();
      for (let i = 0; i < count; i++) progressiveDraw(pipe, st.count + i, "write", st.count + i === 0);
      await device.queue.onSubmittedWorkDone();
      st.count += count;
      return { count: st.count, gpuMs: performance.now() - started };
    },

    async progressiveReshade(opts = {}) {
      const st = prog; if (!st) throw Error("progressiveBegin first");
      if (st.count < 1) throw Error("no samples are kept yet");
      const pipe = await layerPipe(needsMulti());
      const started = performance.now();
      const every = Math.max(1, Math.min(st.count, Math.floor(opts.every ?? st.count)));
      let done = 0, presented = 0, lastPresentAt = started, last: { rgba: Uint8Array; linear: Float32Array } | undefined;
      while (done < st.count) {
        if (opts.signal?.aborted) throw abortError();
        // With a heavy scene (reflections, objects, textures) one sample can take a second or more. A batch of `every` samples then
        // kept the old picture on screen for many seconds and could not be cancelled while it ran. When someone is watching, one sample
        // is drawn at a time: the next change can interrupt between samples, and the picture is shown as soon as it is either
        // `every` samples further or `SLOW_PRESENT_MS` have passed since the last one, whichever comes first.
        const upTo = opts.present ? done + 1 : st.count;
        for (let k = done; k < upTo; k++) progressiveDraw(pipe, k, "read", k === 0);
        await device.queue.onSubmittedWorkDone();
        done = upTo;
        const now = performance.now();
        const due = done === st.count || done - presented >= every || now - lastPresentAt >= SLOW_PRESENT_MS;
        if (done === st.count || (opts.present && due)) {
          last = await progressiveRead(done);
          presented = done; lastPresentAt = performance.now();
          opts.present?.({ rgba: last.rgba, done, total: st.count, gpuMs: performance.now() - started });
        }
      }
      return { count: st.count, gpuMs: performance.now() - started, rgba: last!.rgba, linear: last!.linear };
    },

    async progressivePicture() {
      const st = prog; if (!st || st.count < 1) throw Error("no samples are kept yet");
      const r = await progressiveRead(st.count);
      return { count: st.count, rgba: r.rgba, linear: r.linear };
    },

    progressiveEnd() { progressiveEndNow(); },
    progressiveInfo() { return prog ? { width: prog.width, height: prog.height, kept: prog.count, samples: prog.samples } : null; },
    progressiveBytes() { return prog ? prog.textures.length * prog.width * prog.height * 16 + prog.width * prog.height * (16 + 16 + 8) : 0; },

    async cachedFrame(width, height, mode, opts = {}) {
      if (!geoCache) throw Error("cachedFrame needs the research option geometryCache on an offscreen engine");
      if (!active || !switcher.current) throw Error("No scene has been set.");
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw Error("width and height must be whole numbers, 1 or more");
      const pipe = await layerPipe(needsMulti());
      const quality: QualitySettings = { ...active.scene.render.quality, ...(opts.quality ?? {}), samples_per_pixel: 1 };
      if (mode === "read" && (!geoCacheTexture || geoCacheSize[0] !== width || geoCacheSize[1] !== height)) throw Error("There is no cached geometry of this size: draw a frame in write mode first");
      if (mode === "write" && (!geoCacheTexture || geoCacheSize[0] !== width || geoCacheSize[1] !== height)) {
        geoCacheTexture?.destroy();
        geoCacheTexture = device.createTexture({ size: [width, height], format: DATA_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        geoCacheSize = [width, height];
        // The pipelines' ready-made bind groups still point at the texture just destroyed; an ordinary render through them (draw()) would then
        // sample a dead texture and give a different picture than a fresh engine. Rebuild them against the new one.
        refreshImageBindings();
      }
      // Same sample, same pixel position as the first sample of an ordinary one-sample picture, so write equals that picture.
      writeUniforms(width, height, 0, 0, quality, sampleJitter(0, quality.seed), null, "off", FULL_VIEWPORT_FEATURES, lensSample(0, quality.seed), false, undefined, mode === "read" ? GEOMETRY_CACHE_READ_STAGE : 0, 0, true, undefined, opts.referenceFilm);
      const bindGroup = device.createBindGroup({ layout: pipe.pipeline.getBindGroupLayout(0), entries: bindEntries(pipe.fieldBuffer, pipe.fieldTexture, pipe.primitives, pipe.surface) });
      const color = device.createTexture({ size: [width, height], format: OFFSCREEN_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const data = device.createTexture({ size: [width, height], format: DATA_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const row = Math.ceil((width * 8) / 256) * 256;
      const readBuffer = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [color, data].map((t) => ({ view: t.createView(), loadOp: "clear" as const, storeOp: "store" as const, clearValue: { r: 0, g: 0, b: 0, a: 1 } })) });
        pass.setPipeline(pipe.pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
        if (mode === "write") encoder.copyTextureToTexture({ texture: data }, { texture: geoCacheTexture! }, [width, height]);
        encoder.copyTextureToBuffer({ texture: color }, { buffer: readBuffer, bytesPerRow: row }, [width, height]);
        const started = performance.now();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        const gpuMs = performance.now() - started;
        await readBuffer.mapAsync(GPUMapMode.READ);
        const half = new Uint16Array(readBuffer.getMappedRange());
        const linear = new Float32Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) linear[(y * width + x) * 4 + c] = halfToFloat(half[(y * row) / 2 + x * 4 + c]!);
        readBuffer.unmap();
        // The same conversion the final renderer applies to its linear picture, so an interactive picture and a final one are comparable byte for byte.
        return { linear, rgba: displayRgba(linear, active.scene.display ?? defaultDisplay()), gpuMs };
      } finally { color.destroy(); data.destroy(); readBuffer.destroy(); }
    },

    isReady(scene) {
      if(!options.parallelPipelines||geometryDetail||options.qaGeometry||options.qaShaderTransform||options.tileMask||reflectionSamples>1||!warmupEligible(scene))return false;
      const resolved = resolveScene(scene, formulas);
      if (!resolved.ok) return false;
      finishKey(resolved,scene);
      return switcher.has(resolved.key);
    },

    async prepareScene(scene) {
      if(!options.parallelPipelines||geometryDetail||options.qaGeometry||options.qaShaderTransform||options.tileMask||reflectionSamples>1)return {errors:['prepareScene is only for the on-screen engine']};
      if(!warmupEligible(scene))return {errors:['The scene needs extra resources; its shader is built when it is used.']};
      const resolved = resolveScene(scene, formulas);
      if (!resolved.ok) return { errors: resolved.errors };
      finishKey(resolved,scene);
      try { return (await switcher.prepare(resolved.key, resolved)) ? {errors:[]} : {errors:['The shader could not be prepared.']}; }
      catch (error) { return {errors:[error instanceof Error ? error.message : String(error)]}; }
    },

    async setScene(scene,inputs) {
      if(reflectionSamples>1){const problem=reflectionLabProblem(scene);if(problem)return {errors:[problem],warnings:[]};}
      const request=++sceneRequest;
      switcher.invalidatePending();
      const resolved = resolveScene(scene, formulas);
      if (!resolved.ok) return { errors: resolved.errors, warnings: [] };
      if(inputs?.secondaryGeometry){
        try{packSecondaryGeometry(scene.primitives??[],inputs.secondaryGeometry);}catch(error){return {errors:[String(error)],warnings:[]};}
      }
      if(inputs?.secondaryGeometry?.objects.length){
        if(scene.transport?.enabled&&hasTransmissionVolumes(scene))return {errors:['Secondary geometry with transmission transport is unsupported'],warnings:[]};
        secondaryInputs.set(resolved,structuredClone(inputs.secondaryGeometry));resolved.key+='|secondary-geometry';
      }
      finishKey(resolved,scene);
      pendingScenes++;
      try {
        if(options.qaGeometry?.ds)resolved.key+=dsCompileKey(resolved,options.qaGeometry.sourceParameters);
        let surface:SurfaceAtlas|undefined;
        const materials=surfaceMaterials(scene);
        const geometry=displacementActive(scene);
        if(geometry||materials.some(surfaceDetailActive)){
          const images=geometry?withDisplacementImages(scene,surfaceImages(materials)):surfaceImages(materials);const pbr=materials.some(materialTexturesActive);
          const matching=[...surfaceAtlases].find(a=>!!a.materialTextures===pbr&&!!a.displacement===geometry&&a.images.length===images.length&&a.images.every((t,i)=>t.data===images[i]!.data&&t.colorSpace===images[i]!.colorSpace));
          if(matching)surface=matching;
          else {
            const key=JSON.stringify([pbr,geometry,images.map(i=>[i.colorSpace,i.data])]);
            let loading=pendingAtlases.get(key);
            if(!loading){const preparation=compileQueue.then(()=>createSurfaceAtlas(device,images,geometry));compileQueue=preparation.catch(()=>undefined);loading=preparation.then(a=>{surfaceAtlases.add(a);return a;}).finally(()=>pendingAtlases.delete(key));pendingAtlases.set(key,loading);}
            surface=await loading;
          }
          surface.materialTextures=pbr;
          preparedSurfaces.set(resolved,surface);
        }
        if(request!==sceneRequest)return {errors:[],warnings:[],superseded:true};
        const outcome = await switcher.apply(resolved.key, resolved);
        if (outcome.kind === "superseded"||request!==sceneRequest) return { errors: [], warnings: [], superseded: true };
        if (outcome.kind === "failed") return { errors: outcome.errors, warnings: resolved.warnings };
        active = resolved;
        const base=switcher.current!;
        for(const compiled of [base,base.multi])if(compiled){compiled.surface=surface;for(const pipe of [...compiled.pipes.values(),...(compiled.layers?[compiled.layers]:[])])pipe.surface=surface;}
        refreshImageBindings();
        return { errors: [], warnings: [...resolved.warnings,...transportWarnings(scene),...displacementWarnings(scene),...(surface?.warnings??[])] };
      }catch(error){return {errors:[error instanceof Error?error.message:String(error)],warnings:resolved.warnings};}
      finally {
        pendingScenes--;
        const settledQueue=compileQueue;
        void settledQueue.then(async()=>{
          await device.queue.onSubmittedWorkDone();
          if(compileQueue!==settledQueue||pendingScenes>0)return;
          const keep=switcher.current;
          for(const b of fieldBuffers)if(b!==keep?.fieldBuffer){b.destroy();fieldBuffers.delete(b);}
          for(const t of fieldTextures)if(t!==keep?.fieldTexture){t.destroy();fieldTextures.delete(t);}
          for(const a of surfaceAtlases)if(a!==keep?.surface){a.texture.destroy();surfaceAtlases.delete(a);}
        }).catch(()=>undefined);
      }
    },

    resize(width, height) {
      if (!canvas) throw new Error("This engine has no canvas. Use renderToBuffer.");
      canvas.width = width;
      canvas.height = height;
    },

    render() {
      if (!canvas || !context || !active || !switcher.current) return;
      writeUniforms(canvas.width, canvas.height, 0, 0, previewQuality, [0,0], previewLightLimit, previewDebugView, previewFeatures,[0,0],true,undefined,0,0,false,undefined,outputSize(active!.scene.render,canvas.width/canvas.height));
      const encoder = device.createCommandEncoder();
      draw([context.getCurrentTexture().createView()], pipeFor(canvasFormat,needsMulti(previewFeatures)), encoder);
      device.queue.submit([encoder.finish()]);
    },

    async waitForPreview() { await device.queue.onSubmittedWorkDone(); },
    setPreviewFeatures(features) { previewFeatures = {...features}; },

    async renderToBuffer(width, height, options = {}) {
      const r = await renderTiled(width, height, options, false);
      return { width: r.width, height: r.height, data: r.color, linear:r.linear, display:r.display };
    },

    async renderLayersToBuffer(width, height, options = {}) {
      const r = await renderTiled(width, height, options, true);
      return { width: r.width, height: r.height, color: r.color, linear:r.linear, display:r.display, depth: r.depth!, normal: r.normal! };
    },

    async renderStream(width, height, options, layers, onBand) {
      await renderOutputBands(width, height, options, layers, onBand);
    },

    setPreviewQuality(quality) {
      previewQuality = { ...DEFAULT_QUALITY, ...(quality ?? {}) };
      previewLightLimit = quality ? null : PREVIEW_LIGHT_LIMIT;
      previewQualityFromScene = quality !== null;
    },

    setDebugView(view) {
      previewDebugView = view;
    },

    async distanceGrid(scene, grid) {
      const [nx, ny, nz] = grid.size;
      if (![nx, ny, nz].every((n) => Number.isInteger(n) && n >= 2)) throw new Error("the grid needs at least 2 points along each axis");
      if (nx * ny * nz > MAX_GRID_POINTS) throw new Error(`the grid has too many points (at most ${MAX_GRID_POINTS})`);
      if (![...grid.origin, ...grid.step].every(Number.isFinite) || grid.step.some((s) => !(s > 0))) throw new Error("origin and step must be numbers, and step above 0");
      const resolved = resolveScene(scene, formulas);
      if (!resolved.ok) throw new Error(resolved.errors.join("; "));
      const compiled = switcher.current;
      if (!compiled || !sceneKeyInUse(switcher.currentKey, resolved.key)) {
        throw new Error("The formulas of the scene are not in use yet. Call setScene first and wait for it.");
      }
      packUniforms(cameraBasis(resolved.scene.camera), 1, 1, resolved.scene.camera.fov_degrees, resolved.parameterValues, resolved.colorData, [0, 0], uniforms, undefined, undefined, undefined, undefined, undefined, { weights: resolved.chainWeights, julia: resolved.julia, loops: resolved.loops });
      device.queue.writeBuffer(buffer, 0, uniforms as Float32Array<ArrayBuffer>);

      if (!compiled.grid) {
        const job = compileQueue.then(async () => {
          device.pushErrorScope("validation");
          const module = device.createShaderModule({ code: buildGridShader(compiled.code) });
          const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "cs" } });
          const info = await module.getCompilationInfo();
          const problem = await device.popErrorScope();
          const errors = info.messages.filter((m) => m.type === "error").map((m) => `rad ${m.lineNum}: ${m.message}`);
          if (problem && errors.length === 0) errors.push(problem.message);
          return { errors, pipeline };
        });
        compileQueue = job.catch(() => undefined);
        const made = await job;
        if (made.errors.length > 0) throw new Error(made.errors.join("; "));
        compiled.grid = { pipeline: made.pipeline, bindGroupLayout: made.pipeline.getBindGroupLayout(0) };
      }

      const layersPerSlab = Math.max(1, Math.min(nz, Math.floor(GRID_SLAB_POINTS / (nx * ny))));
      const gridBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const outBuffer = device.createBuffer({ size: nx * ny * layersPerSlab * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: nx * ny * layersPerSlab * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const result = new Float32Array(nx * ny * nz);
      try {
        const bindGroup = device.createBindGroup({
          layout: compiled.grid.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: { buffer: gridBuffer } },
            { binding: 2, resource: { buffer: outBuffer } },
            ...(compiled.fieldBuffer&&compiled.fieldTexture?[{binding:8,resource:compiled.fieldTexture.createView({dimension:"2d-array"})},{binding:9,resource:{buffer:compiled.fieldBuffer}}]:[]),
          ],
        });
        for (let z0 = 0; z0 < nz; z0 += layersPerSlab) {
          const layers = Math.min(layersPerSlab, nz - z0);
          const params = new ArrayBuffer(48);
          new Float32Array(params, 0, 8).set([...grid.origin, 0, ...grid.step, 0]);
          new Uint32Array(params, 32, 4).set([nx, ny, layers, z0]);
          device.queue.writeBuffer(gridBuffer, 0, params);
          const count = nx * ny * layers;
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(compiled.grid.pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(count / 64));
          pass.end();
          encoder.copyBufferToBuffer(outBuffer, 0, readback, 0, count * 4);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ); // one slab at a time keeps each job short
          result.set(new Float32Array(readback.getMappedRange(), 0, count), z0 * nx * ny);
          readback.unmap();
        }
        return result;
      } finally {
        gridBuffer.destroy();
        outBuffer.destroy();
        readback.destroy();
      }
    },

    async distanceAt(scene, points) {
      const resolved = resolveScene(scene, formulas);
      if (!resolved.ok) throw new Error(resolved.errors.join("; "));
      const compiled = switcher.current;
      if (!compiled || !sceneKeyInUse(switcher.currentKey, resolved.key)) {
        throw new Error("The formulas of the scene are not in use yet. Call setScene first and wait for it.");
      }
      if (points.length === 0) return new Float32Array(0);

      // Measure with the parameter values of the given scene (the camera does not matter).
      packUniforms(cameraBasis(resolved.scene.camera), 1, 1, resolved.scene.camera.fov_degrees, resolved.parameterValues, resolved.colorData, [0, 0], uniforms, undefined, undefined, undefined, undefined, undefined, { weights: resolved.chainWeights, julia: resolved.julia, loops: resolved.loops });
      device.queue.writeBuffer(buffer, 0, uniforms as Float32Array<ArrayBuffer>);

      if (!compiled.distance) {
        const job = compileQueue.then(async () => {
          device.pushErrorScope("validation");
          const module = device.createShaderModule({ code: buildDistanceShader(compiled.code) });
          const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "cs" } });
          const info = await module.getCompilationInfo();
          const problem = await device.popErrorScope();
          const errors = info.messages.filter((m) => m.type === "error").map((m) => `rad ${m.lineNum}: ${m.message}`);
          if (problem && errors.length === 0) errors.push(problem.message);
          return { errors, pipeline };
        });
        compileQueue = job.catch(() => undefined);
        const made = await job;
        if (made.errors.length > 0) throw new Error(made.errors.join("; "));
        compiled.distance = { pipeline: made.pipeline, bindGroupLayout: made.pipeline.getBindGroupLayout(0) };
      }

      const count = points.length;
      const input = new Float32Array(count * 4);
      points.forEach((p, i) => input.set([p[0], p[1], p[2], 0], i * 4));
      const pointsBuffer = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const outBuffer = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readback = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        device.queue.writeBuffer(pointsBuffer, 0, input);
        const bindGroup = device.createBindGroup({
          layout: compiled.distance.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: { buffer: pointsBuffer } },
            { binding: 2, resource: { buffer: outBuffer } },
            ...(compiled.fieldBuffer&&compiled.fieldTexture?[{binding:8,resource:compiled.fieldTexture.createView({dimension:"2d-array"})},{binding:9,resource:{buffer:compiled.fieldBuffer}}]:[]),
          ],
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(compiled.distance.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / 64));
        pass.end();
        encoder.copyBufferToBuffer(outBuffer, 0, readback, 0, count * 4);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(readback.getMappedRange().slice(0));
        readback.unmap();
        return result;
      } finally {
        pointsBuffer.destroy();
        outBuffer.destroy();
        readback.destroy();
      }
    },

    async colorsAt(scene, positions, normals) {
      if (positions.length !== normals.length || positions.length % 3 !== 0) throw new Error("positions and normals must have three numbers per point");
      const resolved = resolveScene(scene, formulas);
      if (!resolved.ok) throw new Error(resolved.errors.join("; "));
      const compiled = switcher.current;
      if (!compiled || !sceneKeyInUse(switcher.currentKey, resolved.key)) {
        throw new Error("The formulas of the scene are not in use yet. Call setScene first and wait for it.");
      }
      const total = positions.length / 3;
      const result = new Float32Array(total * 3);
      if (total === 0) return result;
      packUniforms(cameraBasis(resolved.scene.camera), 1, 1, resolved.scene.camera.fov_degrees, resolved.parameterValues, resolved.colorData, [0, 0], uniforms, undefined, undefined, undefined, undefined, undefined, { weights: resolved.chainWeights, julia: resolved.julia, loops: resolved.loops });
      device.queue.writeBuffer(buffer, 0, uniforms as Float32Array<ArrayBuffer>);

      if (!compiled.colors) {
        const job = compileQueue.then(async () => {
          device.pushErrorScope("validation");
          const module = device.createShaderModule({ code: buildColorShader(compiled.code) });
          const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "cs" } });
          const info = await module.getCompilationInfo();
          const problem = await device.popErrorScope();
          const errors = info.messages.filter((m) => m.type === "error").map((m) => `rad ${m.lineNum}: ${m.message}`);
          if (problem && errors.length === 0) errors.push(problem.message);
          return { errors, pipeline };
        });
        compileQueue = job.catch(() => undefined);
        const made = await job;
        if (made.errors.length > 0) throw new Error(made.errors.join("; "));
        compiled.colors = { pipeline: made.pipeline, bindGroupLayout: made.pipeline.getBindGroupLayout(0) };
      }

      // Chunks keep each buffer and each job at a reasonable size.
      const CHUNK = 1 << 20;
      for (let from = 0; from < total; from += CHUNK) {
        const count = Math.min(CHUNK, total - from);
        const pointData = new Float32Array(count * 4);
        const normalData = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
          pointData.set(positions.subarray((from + i) * 3, (from + i) * 3 + 3), i * 4);
          normalData.set(normals.subarray((from + i) * 3, (from + i) * 3 + 3), i * 4);
        }
        const pointsBuffer = device.createBuffer({ size: pointData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const normalsBuffer = device.createBuffer({ size: normalData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const outBuffer = device.createBuffer({ size: count * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const readback = device.createBuffer({ size: count * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
          device.queue.writeBuffer(pointsBuffer, 0, pointData);
          device.queue.writeBuffer(normalsBuffer, 0, normalData);
          const bindGroup = device.createBindGroup({
            layout: compiled.colors.bindGroupLayout,
            entries: [...bindEntries(compiled.fieldBuffer,compiled.fieldTexture), { binding: 1, resource: { buffer: pointsBuffer } }, { binding: 2, resource: { buffer: normalsBuffer } }, { binding: 5, resource: { buffer: outBuffer } }],
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(compiled.colors.pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(count / 64));
          pass.end();
          encoder.copyBufferToBuffer(outBuffer, 0, readback, 0, count * 16);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const rgba = new Float32Array(readback.getMappedRange());
          for (let i = 0; i < count; i++) result.set(rgba.subarray(i * 4, i * 4 + 3), (from + i) * 3);
          readback.unmap();
        } finally {
          pointsBuffer.destroy();
          normalsBuffer.destroy();
          outBuffer.destroy();
          readback.destroy();
        }
      }
      return result;
    },

    destroy() {
      geoState?.destroy();geoControl?.destroy();
      displacementBuffer.destroy();surfaceBuffer.destroy();pbrBuffer.destroy();
      for(const a of surfaceAtlases)a.texture.destroy();
      primitiveBuffer.destroy();
      buffer.destroy();
      for(const b of fieldBuffers)b.destroy();
      for(const t of fieldTextures)t.destroy();
      device.destroy();
    },
  };
}
