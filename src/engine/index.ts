export {defaultDisplacement,displacementUnsupported,displacementActive} from './displacement';
export type {DisplacementSettings} from './displacement';
export {createFractalSampler,samplingGrid,DEFAULT_EXPORT_LIMITS} from './geometrySampling';
export type {GeometrySampler,GeometryBounds,FieldSemantics,FieldBatch,SamplingOptions,GeometryDiagnostics} from './geometrySampling';
export {extractAdaptiveMesh,meshTopology,simplifySmoothEdges} from './adaptiveMesh';
export type {MeshExportResult} from './adaptiveMesh';
export {primitiveMesh} from './primitiveMesh';
export {sampleSurfacePoints,pointsToPly} from './pointCloud';
export type {SurfacePoints,PointSamplingOptions} from './pointCloud';
export {exportVolume,volumeEstimate} from './volumeExport';
export type {VolumeMetadata,VolumeMode} from './volumeExport';
export {constructGaussians,gaussiansToPly} from './gaussianExport';
export type {GaussianOptions,GaussianSet} from './gaussianExport';
export {defaultProceduralDetail,PROCEDURAL_PATTERNS,PROCEDURAL_LIMITS} from './proceduralDetail';
export type {ProceduralDetailSettings,ProceduralPattern} from './proceduralDetail';
export {withProceduralDetail} from './surfaceDetail';
export {defaultSurfaceDetail,readSurfaceDetail} from './surfaceDetail';
export type {SurfaceDetailSettings,SurfaceMap,SurfaceImage} from './surfaceDetail';
export {defaultReflections,REFLECTION_LIMITS,reflectIncoming,reflectionBias,sampleReflection,traceSecondary,DEFAULT_DIFFUSE_GI,defaultDiffuseGi,readDiffuseGi} from "./reflections";
export type {ReflectionSettings,ReflectionBudget,SecondaryHit,DiffuseGiSettings} from "./reflections";
/** The public face of the engine. Everything outside src/engine/ should import from here. */
export * from './cameraFlight';
export { createEngine } from "./engine";
export { FinalPreviewController, PreviewAccumulator, previewSize, previewDetails } from './finalPreview';
export type { FinalPreviewPass } from './finalPreview';
export { profilePreview } from './previewProfile';
export type { PreviewProfileRow } from './previewProfile';
export type { RenderTiming } from './engine';
export { defaultClipPlane, defaultCutout, defaultDetails, MAX_CLIP_PLANES, clipRay, renderDetailsCostKey } from "./renderDetails";
export type { ClipPlane, CutoutSettings, DetailSettings, OcclusionSettings } from "./renderDetails";
export { ViewportQualityController, VIEWPORT_MODES, FULL_VIEWPORT_FEATURES, NAVIGATE_FEATURES, viewportFeatureMask } from './viewportQuality';
export type { ViewportFeatures, ViewportMode, ViewportState, ViewportPlan } from './viewportQuality';
export type { DistanceGrid, Engine, EngineOptions, ImageBuffer, LayerBuffers, Region, RenderBand, RenderOptions, RenderProgress, SceneResult } from "./engine";
export { MAX_GRID_POINTS } from "./engine";
export { encodeExr, depthChannels, normalChannels } from "./exr";
export type { ExrChannel } from "./exr";
export { cameraBasis } from "./camera";
export { cameraFov, cameraRay, defaultDof, focusDistance, fovFromLens, lensFromFov, sensorDimension, lensSample } from './cameraOptics';
export type { CameraLens, DepthOfField } from './cameraOptics';
export { defaultComposition, frameRect } from './composition';
export type { CompositionSettings } from './composition';
export type { CameraBasis, SceneCamera, Vec3 } from "./camera";
export {
  SCENE_SCHEMA_VERSION,
  collectCredits,
  createDefaultScene,
  migrateScene,
  parseScene,
  defaultStep,
  resolveScene,
  serializeScene,
  withColor,
  MAX_CHAIN_STEPS,
  MAX_STEP_ITERATIONS,
  MAX_TOTAL_ITERATIONS,
} from "./scene";
export {
  addStep,
  moveStep,
  removeStep,
  setStepFormula,
  withRounds,
  withChainMode,
  withJulia,
  withStepSchedule,
  withStepWeight,
  withStepFactor,
  withStepIterations,
  withStepParameter,
} from "./sceneEdit";
export { CHAIN_MODES, MAX_ROUNDS, MAX_TOTAL_PARAMETERS, MAX_WEIGHTED_STEPS, generateChain } from "./formula/chain";
export type { ChainMode } from "./formula/chain";
export { SceneSwitcher } from "./sceneSwitcher";
export type { ChainStepData, CreditEntry, FractalContent, JuliaSettings, Scene, SceneParseResult } from "./scene";
export { WEIGHT_LIMITS } from "./scene";
export { MAX_DURATION_SECONDS, MAX_FPS, MAX_KEYFRAMES, SPEED_MODES, defaultAnimation, readAnimation } from "./animation";
export type { Animation, AnimationKeyframe, SpeedMode } from "./animation";
export {
  ADAPTIVE_MAX_DISTANCE,
  ADAPTIVE_MIN_DISTANCE,
  TIMING_SAMPLES,
  captureKeyframe,
  computeTiming,
  evaluateAnimation,
  frameCount,
  frameTimes,
  removeKeyframe,
  retimeForFixedSpeed,
  segmentLengths,
  setKeyframe,
  timingKey,
  warpFraction,
  withAnimationSettings,
} from "./animationPlayback";
export type { DistanceFn, Timing } from "./animationPlayback";
export { downsampleBox } from "./image";
export {
  DEFAULT_COLOR,
  DEFAULT_GRADIENT,
  MAX_TEXTURE_DATA_LENGTH,
  MEASURES,
  TEXTURE_MAPPINGS,
  WRAP_MODES,
  buildGradientLibrary,
  gradientAt,
  parseGradientFile,
} from "./gradient";
export type { ColorSettings, Gradient, GradientFile, GradientLibrary, GradientStop, Measure, TextureMapping, TextureSettings, WrapMode } from "./gradient";
export { buildLibrary } from "./formula/library";
export type { Library, LibraryProblem } from "./formula/library";
export { parseFormula } from "./formula/parse";
export type { Formula, Parameter, FormulaCatalog, FormulaCategory } from "./formula/types";
export { FORMULA_CATEGORIES } from "./formula/types";
export { formulaCatalog } from "./formula/catalog";
export { KERNELS, prepareKernel, freshKernelState, stepKernel } from './formula/kernels';
export type { KernelId, KernelState, KernelInfo, PreparedKernel, KernelParameters, DistanceMethod } from './formula/kernels';
export { compileMappedFieldOrbit, groupCallOrder } from './formula/groupExecution';
export type { MappedFieldExecution, BoundedSequenceExecution, ChainExecution, ChainGroup } from './formula/groupExecution';
export { compileKernelOrbit } from './formula/kernelChain';
export type { KernelOrbitResult } from './formula/kernelChain';
export { hamiltonProduct, commutativeProduct, compareSwapFold, radialFoldFactor, mengerFold, stereographicChart, inverseStereographicChart, rotation3, rotation4, applyMatrix } from './formula/primitives';
export type { V4, Matrix } from './formula/primitives';
export { bilinearProduct, quaternionSine, difsAffine, directionAngle } from './formula/primitives';
export { ESSENTIALS_KERNEL_IDS } from './formula/essentialsMetadata';
export { boxFold, sphereFactor, triplexProduct, multiplyUnsigned32 } from './formula/essentialsKernels';
export { authorLines, creditHeadline, hasUnverifiedCredits, sourceLines, UNVERIFIED_LABEL, displayCreditName } from "./credits";
export type { CreditLine } from "./credits";
export { extractSurface, meshVolume } from "./mesh";
export type { GridSpec, Mesh } from "./mesh";
export { cameraToGlb, cameraTrackToJson, creditLines, meshToGlb, meshToObjParts, meshToPly } from "./meshExport";
export { quaternionFromAxes, rotateByQuaternion, sampleCameraTrack } from "./cameraPath";
export type { CameraTrack } from "./cameraPath";
export type { GlbOptions } from "./meshExport";
export {
  DEFAULT_QUALITY,
  DEFAULT_RENDER_SETUP,
  PRECISION_MODES,
  QUALITY_LIMITS,
  defaultQuality,
  readQuality,
  sampleJitter,
  suggestedHitPrecision,
  withQuality,
  FORMAT_PRESETS,
  FOV_AXES,
  MAX_ASPECT,
  MAX_LONG_SIDE,
  MAX_PIXELS,
  MIN_LONG_SIDE,
  checkOutputSize,
  defaultRenderSetup,
  formatAspect,
  outputSize,
  outputCost,
  testRenderSetup,
  readRenderSetup,
  verticalFovDegrees,
  PREVIEW_SCALES,
  PREVIEW_LIGHT_SAMPLES,
  planScaledPreview,
} from "./renderSetup";
export { imageTiles, safeTileSize, DEFAULT_TILE_SIZE } from './renderTiles';
export type { RenderTile } from './renderTiles';
export { previewDof, circleOfConfusion } from './previewDof';
export type { FormatPreset, FovAxis, PrecisionMode, QualitySettings, RenderFormat, RenderSetup, PreviewScale, PreviewLightSamples, ScaledPreviewPlan } from "./renderSetup";
export { DEFAULT_FOG, FOG_LIMITS, FOG_MODES, blendFog, defaultFog, fogAmount, packFog, readFog, withFogChanges } from "./fog";
export type { FogMode, FogSettings } from "./fog";
export { RELATIVE_FOG_LIMITS, RELATIVE_FOG_PRESETS, SUBJECT_MIN_DISTANCE, cameraTargetDistance, fogFromRelative, fogOnSubject, relativeFromFog, subjectReference } from "./subjectScale";
export type { FogFromRelative, RelativeFog, SubjectReference, SubjectSource } from "./subjectScale";
export { DEPTH_FOG_LIMITS, DEPTH_FOG_PRESETS, depthFogFromFog, depthRangeOf, effectiveSpan, fogAcrossDepth, fogFromDepth } from "./fogDepth";
export type { DepthFog, DepthFogPreset, DepthRange, FogFromDepth } from "./fogDepth";
export { fitAll, formulaFit } from "./formulaFit";
export type { Fit, FitEdit } from "./formulaFit";
export {
  AMBIENT_LIMITS,
  DEFAULT_AMBIENT,
  DEFAULT_LIGHT,
  LIGHT_LIMITS,
  LIGHT_TYPES,
  MAX_LIGHTS,
  SHADOW_MODES,
  activeLights,
  anglesFromDirection,
  blendAmbient,
  blendLight,
  blendLights,
  cloneLights,
  defaultAmbient,
  defaultLight,
  defaultLights,
  directionFromAngles,
  packLights,
  readAmbient,
  readLight,
  readLights,
  shadowK,
  CANDIDATE_B_LIGHTING_PRESET,
  LIGHTING_PRESETS,
  applyLightingPreset,
} from "./lights";
export type { AmbientSettings, LightSettings, LightType, ShadowMode, LightingPreset } from "./lights";
export { PREVIEW_LIGHT_LIMIT } from "./engine";
export { DEBUG_VIEWS } from "./uniforms";
export type { DebugView } from "./uniforms";
export {
  CHAIN_STYLES,
  ENDING_FRACTALS,
  FOLDS,
  HIT_RANGE,
  HYBRID_FRACTALS,
  LEFT_OUT,
  LOOK_DISTANCES,
  SCALERS,
  SHAPES,
  WARPS,
  generateRandomChain,
  lookAtChain,
  tryRandomChain,
} from "./randomChain";
export type { ChainStyle, Look, RandomChain } from "./randomChain";
export {
  MAX_PRESETS,
  MAX_PRESET_NAME,
  PRESET_FILE_VERSION,
  RATING_RANGE,
  createPreset,
  mergePresets,
  parsePresets,
  presetsToJson,
  sortPresets,
  withFreshCredits,
  withPresetName,
  withPresetRating,
} from "./presets";
export type { Preset, PresetFile, PresetOrigin, PresetParseResult } from "./presets";
export {
  ENV_FLOATS,
  ENV_INTENSITY_LIMITS,
  MAX_ENV_DATA_LENGTH,
  MAX_ENV_TEXT,
  defaultEnvironment,
  diffuseLight,
  directionToMap,
  environmentColor,
  irradiance,
  irradianceCoefficients,
  mapDirection,
  packEnvironment,
  readEnvironment,
  turnAroundVertical,
} from "./environment";
export type { EnvironmentSettings, GradientEnvironment, HdriEnvironment } from "./environment";
export {
  HDR_DATA_ADDRESS,
  MAX_ENV_HEIGHT,
  MAX_ENV_WIDTH,
  RadianceError,
  dataAddressToImage,
  decodeRgbe,
  encodeRgbe,
  floatToHalf,
  imageToDataAddress,
  prepareEnvironmentImage,
  shrink,
  toHalfRgba,
} from "./radiance";
export type { HdrImage } from "./radiance";
export { attemptSeed } from "./randomChain";
export { FILTER_LIMITS, MEASURES_VERSION, createFormulaRecord, inspectFormula, parseFormulaRecord, recordMatches, withRecordRating, withThumbnailMeasures } from "./formulaFilter";
export type { FilterMeasures, FilterResult, FormulaRecord, RejectReason } from "./formulaFilter";
export { THUMBNAIL_LIMITS, isCopyOf, judgeStructure, measureThumbnail, thumbnailAgreement } from "./thumbnailMeasures";
export type { ThumbnailLayers, ThumbnailMeasures } from "./thumbnailMeasures";
export { COLLECTION_VERSION, MAX_COLLECTION_FORMULAS, choiceOf, collectionToJson, parseCollection } from "./formulaCollection";
export type { ChoiceEvent, FormulaCollection, ReadFormula, SavedFormula } from "./formulaCollection";
export {
  CURVE_TABLE_SIZE,
  DEFAULT_MATERIAL,
  MATERIAL_FLOATS,
  MATERIAL_PROPERTIES,
  MATERIAL_SOURCES,
  MAX_CURVE_POINTS,
  MIN_ROUGHNESS,
  alphaOf,
  baseReflectance,
  curveTable,
  defaultMaterial,
  directSpecular,
  environmentFresnel,
  environmentLod,
  ggxD,
  isDefaultMaterial,
  materialIsActive,
  packMaterial,
  propertyValue,
  readMaterial,
  reflectDirection,
  sampleCurve,
  schlick,
  skyGradient,
  skyReflection,
  smithV,
  tableValue,
  withMaterialChanges,
  wrapMeasure,
} from "./material";
export type { CurvePoint, DrivenProperty, MaterialProperty, MaterialPropertyName, MaterialSettings, MaterialSource } from "./material";
export { buildMipChain } from "./radiance";

export * from './primitives';
export {defaultDenoise,readDenoise,DENOISE_RADIUS,denoiseWeight} from './denoise';
export type {DenoiseSettings,DenoiseTiming} from './denoise';
export {resolveMaterial,dielectricF0,MATERIAL_PRESETS} from './material';
export type {CanonicalMaterial} from './material';

export {defaultTransport,readTransport,hasTransmissionVolumes,snell,dielectricFresnel,beerLambert,airMedium,crossMedium} from './transmission';
export type {TransportSettings,OpticalMedium} from './transmission';

export {defaultDisplay,readDisplay,displayValue,displayRgba,halfToFloat} from './display';
export type {DisplaySettings} from './display';

export {ExrStreamWriter} from './exr';
export type {ExrStreamOptions,ExrChannelLayout} from './exr';
export {exportContent} from './sceneExport';
export type {ContentExportOptions,ExportSink,ExportStatus,SceneBundleManifest,ExportMode,FractalRepresentation} from './sceneExport';

export * from './propertyAnimation';
export * from './animationIdentity';

export * from './discoveryCatalog';
export * from './discoveryCandidates';
export * from './discoveryQueue';

export * from './synthesizedFormula';
export * from './synthesizedScene';
export * from './discoveryLibrary';
export { DOF_LIMITS, DOF_SAMPLE_FLOOR, RELATIVE_DOF_MAX, RELATIVE_DOF_PRESETS, apertureFromRelative, axialDistance, backgroundBlurPixels, dofGeometry, dofSampled, effectiveCameraSamples, focusAtPoint, relativeAperture, relativeFromSlider, sharpRange, sliderFromRelative, withRelativeAperture } from "./focusScale";
export type { ApertureFromRelative, DofGeometry, Film, FocusRejection, FocusResult } from "./focusScale";
export { DEFAULT_TARGET_ILLUMINATION, FALLOFF_FLOOR, ILLUMINATION_LIMITS, ILLUMINATION_PRESETS, MIN_LIGHT_DISTANCE, anchorReading, distanceBetween, falloff, fitSpotToTarget, formatLightValue, illuminationAt, illuminationFromSlider, intensityForIllumination, newSubjectLight, resolveAnchor, setAnchoredIllumination, sliderFromIllumination } from "./lightScale";
export type { FitAnchor, FitRejection, IntensityFit, SpotFit } from "./lightScale";
export { LIGHT_RIGS, applyRig, planRig, rigLightDirection, rigSourceDirection, sourceSeenFromCamera } from "./lightRigs";
export type { LightRig, RigApplied, RigLightTemplate, RigMode, RigOptions, RigPlan, RigRefusal } from "./lightRigs";
export { applyLook, captureLook, createLookRecord, lookContents, lookHas, readLookBackup, readLookRecord } from "./looks";
export type { CaptureChoice, CaptureResult, LookApplied, LookBackup, LookFog, LookParts, LookPayload, LookRecord, LookRefusal, LookRig } from "./looks";
export { classifyLookBackup, describeLookImport, lookBackupIds, updateLook } from "./looks";
export type { LookImportPlan, LookUpdated, UpdateChoice } from "./looks";
// MATERIAL-GRADIENT-01
export {MAX_MATERIAL_STOPS,hasMaterialStops,rampActive,segmentBlend,locateRamp,rampColorAt,rampTintAt,rampScalarAt,readStopMaterial,materialStopCount} from './materialRamp';
export type {StopMaterial,RampFields} from './materialRamp';
export {effectiveMaterial,snapshotStopMaterial,notBlendedFeatures,materialBaseline} from './materialRampApply';
export {MAX_TEXTURED_MATERIALS,BLENDABLE_MAP_CHANNELS,texturedEntries,isTexturedStop,stopImageMaps,entryWeightsAt} from './materialRamp';
export {rampTextureTable,packRampTail} from './rampTextures';

export { GEOMETRY_LEVELS, ANTIALIAS_LEVELS, SHADOW_LEVELS, QUALITY_PRESETS, qualityValues, describeQuality } from "./qualityLevels";
export type { GeometryLevel, AntialiasLevel, ShadowLevel, QualityChoice } from "./qualityLevels";
export { renderAdaptive, scoreTiles, flagTiles, probeUncertainty, DEFAULT_ADAPTIVE } from "./adaptiveRender";
export type { AdaptiveSettings, AdaptiveReport } from "./adaptiveRender";

export { progressivePlan, mergeAverages, renderProgressive } from "./progressiveRender";
export type { ProgressStage, ProgressFrame, ProgressTarget } from "./progressiveRender";
export { floorAt, floorBinding, probeFloor, probeFloorRegion, floorAdviceText, FLOOR_BASE } from "./precisionFloor";
export * from "./detailView";
export type { FloorReport } from "./precisionFloor";
export { compositeRegion, grownRect, regionWeight } from "./regionComposite";
export type { Rect as RegionRect, Composite } from "./regionComposite";

export { surfaceLookActive } from "./surfaceLook";
export { defaultSculpt } from "./renderDetails";
export type { SculptSettings } from "./renderDetails";
