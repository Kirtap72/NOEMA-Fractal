import {sameSurfacePickView} from './surfacePickView';
import {bindPanelUndo} from './panelUndo';
import {LiveWave,liveFormula,liveUnsupported,liveDeep,liveBounces,atPrecisionLimit,atDeepLimit,floatFloor,DEEP_FLOORS_BUILD,DEEP_FLOORS_USE,DEEP_FLOORS_DROP,MAX_BOUNCES as LIVE_MAX_BOUNCES} from '../engine/liveWave';
import type { DepthRange } from '../engine/fogDepth';
import {geometryUnavailable,qualityProfile,qualitySummary} from './qualityAuthority';
import {geometryEligibility,geometryReasonText} from '../engine/geometryEligibility';
import {applyFloat32Fallback,float32FallbackActive} from '../engine/floatFallback';
import {waitForRenderIdle} from './renderWait';
import {Geo8Artist,geo8Host,readGeo8Document} from './geo8Artist';
import {GeometryDetailPanel} from './geometryDetailPanel';
import type {Engine as GeometryEngine} from '../engine/engine';
import { BoxCutGizmo } from "./boxCutGizmo";
import {LookDevPreview} from './lookDevPreview';
import {ArtistLookbook} from './artistLookbook';
import {QualityLevelsPanel} from './qualityLevelsPanel';
import {probeUncertainty,probeFloor} from '../engine';
import {floorAdviceText} from '../engine/precisionFloor';

/** Says in words whether the Float32 floor (not the artist's settings) limits the detail of a picture. Empty when it does not. */
async function floorAdvice(engine:Parameters<typeof probeFloor>[0],scene:Scene,film:{width:number;height:number},signal?:AbortSignal,ignoreGd=false):Promise<string>{
  const q=scene.render.quality;
  if((scene.geometryDetail?.enabled&&!ignoreGd)||q.precision_mode!=='pixel')return '';
  try{
    const r=await probeFloor(engine,scene,film,q.hit_pixels,q.precision_floor??1,signal?{signal}:{});
    if(!r)return '';
    return floorAdviceText(r,q.precision_floor??1);
  }catch{return '';}
}
import {ProgressiveStill} from './progressiveStill';
import {DetailViewPanel} from './detailViewPanel';
import {DEFAULT_GEOMETRY_DETAIL} from '../engine/adaptiveGeometry';
import {compositeRegion,grownRect} from '../engine/regionComposite';
import {withFirstRenderQuality} from '../engine/artistStarter';
import {RenderBar} from './renderBar';
import {ArtistShell} from './artistShell';
import {starterScene} from '../engine/artistStarter';
import {ArtistRenderPreview} from './artistRenderPreview';
import {renderArtistPreview} from '../engine/artistPreview';
import {AnimationQueuePanel} from './animationQueuePanel';
import {captureAnimationSnapshot} from './animationSnapshot';
import {snapshotFormulas} from '../engine/animationOutput';
import {renderAnimationFrame} from './animationFrameOutput';
import {DiscoveryLibraryStore,libraryStorageError} from './discoveryLibraryStore';
import {FULL_VIEWPORT_FEATURES} from '../engine/viewportQuality';
import type {SynthesizedDefinition} from '../engine/synthesizedFormula';
import {FractalLibrary} from './fractalLibrary';
import {presetThumbnailSize} from './presetThumbnails';
import {synthesizedCandidateScene} from '../engine/synthesizedScene';
import {expressionSignature} from '../engine/synthesizedFormula';
import {applySynthesizedScene} from '../engine/synthesizedScene';
import {synthesizedLibrary} from '../engine/synthesizedFormula';
import {DiscoveryGallery} from './discoveryGallery';
import {VariationsPanel} from './variationsPanel';
import {ParameterLandscapePanel} from './parameterLandscape';
import {StepEffectPanel} from './stepEffectPanel';
import {MaterialPickPanel} from './materialPickPanel';
import {CutbookPanel} from './cutbookPanel';
import {RegionSelector} from './regionSelect';
import {AtlasPanel} from './atlasPanel';
import {measureMapOf, readMeasure} from '../engine/gradientPick';
import {aimPixel} from './lightAim';
import {RandomPanel} from './randomPanel';
import {applyVariation} from '../engine/variations';
import {applyDiscoveryCandidate} from '../engine/discoveryCandidates';
import {withAnimationIdentities,replacementGradientColor} from '../engine/animationIdentity';
import {availableBindings,bindingFor,evaluateMathematics,propertyTracks,targetKey,validBindingValue,setMathematicalValue,withMathematicalTrack,putPropertyKey,retimePropertyKey,mathematicalTrackDiagnostics} from '../engine/propertyAnimation';
import type {MathematicalValue} from '../engine/propertyAnimation';
import {createFractalSampler,createGpuFractalSampler} from '../engine/geometrySampling';
import {exportAdaptiveGaussians,estimateAdaptiveGaussians} from '../engine/adaptiveGaussians';
import {extractAdaptiveMesh} from '../engine/adaptiveMesh';
import {exportContent} from '../engine/sceneExport';
import {ZipWriter} from './zip';
import blenderHelper from '../../tools/export/import_blender.py?raw';
import vdbHelper from '../../tools/export/field_to_vdb.py?raw';
import {ExrStreamWriter} from '../engine/exr';
import {DisplayPanel} from './displayPanel';
import {PrimitivePanel} from './primitivePanel';
import { CameraPanel } from './cameraPanel';
import {CameraFlightPanel} from './cameraFlightPanel';
import {FlyCameraControl,flyLook} from './flyCamera';
import {CameraFlightClock,defaultCameraFlight,cameraKeys,captureCameraKey,putCameraKey,retimeCameraKey,setCameraSegmentSeconds,deleteCameraKey,changeCameraFlight,evaluateCameraAtTime,MAX_FLIGHT_SECONDS} from '../engine/cameraFlight';
import type {CameraFlight,CameraView} from '../engine/cameraFlight';
import { applyPreviewDof } from './dofPreview';
import { FinalPreviewController, previewSize } from '../engine/finalPreview';
import type { FinalPreviewPass } from '../engine/finalPreview';
import { profilePreview } from '../engine/previewProfile';
import type { RenderTiming,LayerBuffers } from '../engine/engine';
import { PreviewAccumulatorWorker } from './previewAccumulator';
import { PreviewDiagnostics } from './previewDiagnostics';
import { renderTileOutput } from './tileOutput';
import { createDownloadSink } from './output';
import { testRenderSetup, planScaledPreview } from '../engine/renderSetup';
import { applyLightingPreset } from '../engine/lights';
import { CompositionViewport, PanelVisibility } from './compositionViewport';
import { cameraFov, defaultDof } from '../engine/cameraOptics';
import { GradientEditor } from './gradientEditor';
import { gradientCssOf } from './gradientEditing';
import { createMaterialSource } from './materialGradientSource';
import { materialBaseline } from '../engine/materialRampApply';
import { NavigationPanel, dollyFactor, flyWheelTarget, pickFocus, pointFromDepth } from './navigation';
import { readNumber, setInputValue, installNumericRanges } from './numericRange';
import { installFineControl } from './fineControl';
import "./formulaChain.css";
import './cameraFlight.css';
import './settingsNavigator.css';
import { SettingsNavigator } from './settingsNavigator';
import { FormulaPreferences } from "./formulaPreferences";
import { attachSidebarResize } from "./sidebarResize";
import {
  authorLines,
  captureKeyframe,
  checkOutputSize,
  collectCredits,
  defaultQuality,
  renderDetailsCostKey,
  formatAspect,
  outputSize,
  suggestedHitPrecision,
  verticalFovDegrees,
  withQuality,
  createDefaultScene,
  defaultStep,
  creditLines,
  cameraToGlb,
  cameraTrackToJson,
  sampleCameraTrack,
  createEngine,
  depthChannels,
  encodeExr,
  creditHeadline,
  evaluateAnimation,
  extractSurface,
  frameTimes,
  hasUnverifiedCredits,
  MEASURES,
  meshToGlb,
  meshToObjParts,
  meshToPly,
  normalChannels,
  parseScene,
  removeKeyframe,
  retimeForFixedSpeed,
  serializeScene,
  setKeyframe,
  sourceLines,
  UNVERIFIED_LABEL,
  withAnimationSettings,
  withColor,
  withFogChanges,
  subjectReference,
  depthRangeOf,
  withRelativeAperture,
  anchorReading,
  applyRig,
  captureLook,
  newSubjectLight,
  setAnchoredIllumination,
  MAX_ENV_DATA_LENGTH,
  dataAddressToImage,
  decodeRgbe,
  imageToDataAddress,
  prepareEnvironmentImage,
  defaultLight,
  MAX_LIGHTS,
} from "../engine";
import type { ColorSettings, CreditLine, DebugView, Formula, Gradient, ImageBuffer, LightSettings, LightType, MaterialSettings, Measure, QualitySettings, Scene, Vec3 } from "../engine";
import { AnimationPanel } from "./animationPanel";
import { ChainPanel } from "./chainPanel";
import { loadLibrary } from "./formulaFiles";
import { FpsCounter } from "./fps";
import { loadGradients } from "./gradientFiles";
import { chooseGpuSupport, describeGpuSupport } from "./gpuSupport";
import {desktop,aiHost} from './desktop';
import {AppService} from './aiBridge/appService';
import {AiPanel} from './aiBridge/aiPanel';
import {AiChatPanel} from './aiBridge/aiChatPanel';
import {importPolyHavenMaterial} from './polyHavenImport';
import {openFeedbackDialog} from './feedbackDialog';
import {composeSideBySide,connectAiBridge,pngBase64} from './aiBridge/connect';
import {previewMetrics} from './aiBridge/imageMetrics';
import {parseRecord} from '../knowledge/experiments';
import type {ExperimentRecord} from '../knowledge/experiments';
import {lookDevRequest} from '../engine/lookDev';
import {MaterialStore} from './materialStore';
import { MeshPanel } from "./meshPanel";
import { OrbitCamera } from "./orbitCamera";
import { ClipPlaneGizmo } from "./clipPlaneGizmo";
import { Mb3dImportPanel } from "./mb3dImportPanel";
import { FormulaImportPanel } from "./formulaImportPanel";
import { frameFractalAsync, withFramedCamera } from "../engine/framing/frame";
import {FormulaStore} from "./formulaStore";
import {parseFormula} from "../engine/formula/parse";
import { canWriteToFolder, createFolderSink, createZipSink, encodeExrBlob, encodePng, openFileStream } from "./output";
import type { FileStream, FrameSink } from "./output";
import { ViewportQualityController } from '../engine';
import type { ViewportMode } from '../engine';
import { EnvironmentPanel } from "./environmentPanel";
import { FogPanel } from "./fogPanel";
import { FractalDisplacementPanel } from './fractalDisplacementPanel';
import { RenderDetailsPanel } from "./renderDetailsPanel";
import {ReflectionPanel} from "./reflectionPanel";
import {TransportPanel} from './transportPanel';
import { MaterialPanel } from "./materialPanel";
import { MaterialBrowser } from "./materialBrowser";
import { LightsPanel } from "./lightsPanel";
import { SurfaceAim } from "./lightAim";
import { FocusPick } from "./focusPick";
import { DofPanel } from "./dofPanel";
import { LightFitPanel } from "./lightFitPanel";
import { LightRigPanel } from "./lightRigPanel";
import { LookPanel } from "./lookPanel";
import { SurfaceLookPanel } from "./surfaceLookPanel";
import { LightDirectionPanel } from "./lightDirectionPanel";
import { applyLightDirection } from "../engine/lightDirection";
import { warmupEligible, withoutLookCode } from "../engine/shaderWarmup";
import { interactiveLimits, interactiveRefusal, PROGRESSIVE_SAMPLES, presentAfterAdd, progressiveAction, reshadeBatch, surfaceFingerprint } from "../engine/interactiveLookDev";
import { applySurfaceLook, fitExposure, planSurfaceLook, SURFACE_LOOKS } from "../engine/surfaceLooks";
import { qualityValues } from "../engine/qualityLevels";
import { defaultDisplay } from "../engine/display";
import { settlePendingInput } from "./pendingInput";
import { FormatPanel } from "./formatPanel";
import { RenderPanel } from "./renderPanel";
import { StillPanel } from "./stillPanel";
import { PngStreamWriter } from "./pngStream";
import { SceneSync } from "./sceneSync";
import { describeProgress, frameFileName, runSequence } from "./sequence";
import { dataUriToImage, fileToTexture } from "./textureLoader";
import { TimingManager } from "./timingManager";
import { VideoWriter } from "./video";

installNumericRanges(document.getElementById("controls")!);

const canvas = document.getElementById("view") as HTMLCanvasElement;
const fpsLabel = document.getElementById("fps") as HTMLDivElement;
const message = document.getElementById("message") as HTMLDivElement;
const chainBox = document.getElementById("chain") as HTMLDivElement;
const animationBox = document.getElementById("animation") as HTMLDivElement;
const formatBox = document.getElementById("format") as HTMLDivElement;
const lightsBox = document.getElementById("lights") as HTMLDivElement;
const fogBox = document.getElementById("fog") as HTMLDivElement;
const environmentBox = document.getElementById("environment") as HTMLDivElement;
const materialBox = document.getElementById("material") as HTMLDivElement;
const stillBox = document.getElementById("still") as HTMLDivElement;
const randomBox = document.getElementById("random") as HTMLDivElement;
const formulasBox = document.getElementById("formulas") as HTMLDivElement;
const renderBox = document.getElementById("render") as HTMLDivElement;
const meshBox = document.getElementById("mesh") as HTMLDivElement;
const creditBox = document.getElementById("credits") as HTMLDivElement;
const infoButton = document.getElementById("info") as HTMLButtonElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const openInput = document.getElementById("open") as HTMLInputElement;
const gradientSelect = document.getElementById("gradient") as HTMLSelectElement;
const gradientPreview = document.getElementById("gradient-preview") as HTMLDivElement;
const measureSelect = document.getElementById("measure") as HTMLSelectElement;
const cyclesInput = document.getElementById("cycles") as HTMLInputElement;
const cyclesValue = document.getElementById("cycles-value") as HTMLSpanElement;
const offsetInput = document.getElementById("offset") as HTMLInputElement;
const offsetValue = document.getElementById("offset-value") as HTMLSpanElement;
const wrapSelect = document.getElementById("wrap") as HTMLSelectElement;
const textureFile = document.getElementById("texture-file") as HTMLInputElement;
const textureName = document.getElementById("texture-name") as HTMLSpanElement;
const textureClear = document.getElementById("texture-clear") as HTMLButtonElement;
const textureMapping = document.getElementById("texture-mapping") as HTMLSelectElement;
const textureScale = document.getElementById("texture-scale") as HTMLInputElement;
const textureScaleValue = document.getElementById("texture-scale-value") as HTMLSpanElement;
const textureStrength = document.getElementById("texture-strength") as HTMLInputElement;
const textureStrengthValue = document.getElementById("texture-strength-value") as HTMLSpanElement;

const MEASURE_LABELS: Record<Measure, string> = {
  iterations: "Iteration count (how long the point stays)",
  orbit_trap: "Orbit trap (nearest to the centre)",
  slope: "Slope (surface versus up)",
  cavity: "Cavities (deep nooks)",
  radius: "Distance from the centre",
};
const SCENE_OPTION = "__scene__";

/** One rendered frame: the colour image and, if asked for, depth and normals at the same size. */
interface RenderedFrame {
  image: ImageBuffer;
  width?: number;
  height?: number;
  depth?: Float32Array;
  normal?: Float32Array;
}
/** The test render shows about this many frames per second of animation. */
const TEST_FRAMES_PER_SECOND = 5;
const TEST_WIDTH = 480;

function showMessage(text: string): void {
  message.textContent = text;
  message.hidden = false;
}
message.addEventListener("click", () => (message.hidden = true));

function addLine(parent: HTMLElement, line: CreditLine, prefix: string): void {
  const row = document.createElement("div");
  row.className = line.verified ? "line" : "line unverified";
  row.append(prefix);
  if (line.href) {
    const a = document.createElement("a");
    a.href = line.href; // only http(s) links get this far, checked when the file is read
    a.textContent = line.text;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    row.append(a);
  } else {
    row.append(line.text);
  }
  if (!line.verified) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = ` (${UNVERIFIED_LABEL})`;
    row.append(tag);
  }
  parent.append(row);
}

/** The credits box is closed until the user clicks the small "i" button at the bottom of the menu. */
let creditsOpen = false;

function setCreditsOpen(open: boolean): void {
  creditsOpen = open;
  creditBox.hidden = !open;
  infoButton.setAttribute("aria-expanded", String(open));
}
infoButton.addEventListener("click", () => setCreditsOpen(!creditsOpen));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && creditsOpen) setCreditsOpen(false);
});

/** Fills the credits box with who made each formula in the chain. Uses textContent only, never HTML from files. */
function showCredits(formulas: Formula[]): void {
  creditBox.replaceChildren();
  for (const f of formulas) {
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = creditHeadline(f);
    creditBox.append(title);
    for (const l of authorLines(f)) addLine(creditBox, l, "Author: ");
    for (const l of sourceLines(f)) addLine(creditBox, l, "Source: ");
  }
  if (formulas.some(hasUnverifiedCredits)) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent = "The details have not been checked and must not be published as fact.";
    creditBox.append(warn);
  }
  // The button turns orange while any name or link in use is still unchecked.
  infoButton.classList.toggle("needs-check", formulas.some(hasUnverifiedCredits));
}

async function start(): Promise<void> {
  const support = chooseGpuSupport({
    hasWebGpu: "gpu" in navigator,
    hasWebGl2: document.createElement("canvas").getContext("webgl2") !== null,
  });
  if (support !== "webgpu") {
    // The WebGL2 fallback is not built yet (planned, see ARCHITECTURE.md).
    showMessage(describeGpuSupport(support) + " This stage requires WebGPU.");
    return;
  }

  const library = loadLibrary();
  const gradientLib = loadGradients();
  const problems = [...library.problems, ...gradientLib.problems].map(
    (p) => `${p.file}:\n  - ${p.errors.join("\n  - ")}`,
  );
  if (library.formulas.length === 0) {
    showMessage(["No valid formulas were found in the formulas/ folder.", ...problems].join("\n"));
    return;
  }
  if (problems.length > 0) showMessage(["Some files were skipped:", ...problems].join("\n"));

  let gpuDescription='WebGPU is starting…',gpuLost=false;
  let queueAbort:AbortController|undefined,activeQueueId:string|undefined;
  let compiling = 0;
  const engine = await createEngine({ canvas,parallelPipelines:true,onCompile(info){const log=((window as unknown as {__compileLog?:unknown[]}).__compileLog??=[]);log.push({t:Math.round(performance.now()),engine:'main',...info});compiling+=info.phase==='start'?1:-1;lookDevCompiling?.(compiling>0);},onGpuReady(info){gpuDescription=`WebGPU: ${info.vendor} / ${info.architecture}${info.isFallbackAdapter?' (mjukvaruadapter)':''}`;canvas.dataset.gpuAdapter=gpuDescription;if(desktop&&info.isFallbackAdapter)throw Error('Desktop requires a hardware adapter; a software adapter was found.');},onDeviceLost(info){queueAbort?.abort();gpuLost=true;canvas.dataset.gpuLost='true';showMessage(`The graphics connection was lost: ${info.message}. Save the scene and open the app again. The library remains on disk.`);}});
  engine.setFormulas(library.formulas);
  const orbit = new OrbitCamera();
  const fps = new FpsCounter();
  const quality = new ViewportQualityController();
  const viewportMode = document.getElementById('viewport-mode') as HTMLSelectElement;
  viewportMode.addEventListener('change', () => {
    cancelDof();
    quality.setMode(viewportMode.value as ViewportMode);
    previewDetail = viewportMode.value === 'final';
    showRenderSetup?.();
    showLights?.();
  });
  let mainAuxBusy=false;
  const timing = new TimingManager(async(scene,points)=>{
    // Share the existing GPU fence with discovery; the legacy timing algorithm and exported values are unchanged.
    while(previewBusy||discoveryGpuActive||mainAuxBusy)await new Promise(resolve=>setTimeout(resolve,16));
    mainAuxBusy=true;try{return await engine.distanceAt(scene,points);}finally{mainAuxBusy=false;}
  });

  const startFormula = library.formulas.find((f) => f.id === "mandelbulb") ?? library.formulas[0]!;
  let initial = withFirstRenderQuality(createDefaultScene(startFormula)); // a new user's first final render is a reasonable one (Fin), not 1 sample
  const startGradient = gradientLib.gradients.find((g) => g.id === "ember") ?? gradientLib.gradients[0];
  if (startGradient) {
    initial = withColor(initial, { gradient: { id: startGradient.id, name: startGradient.name, stops: startGradient.stops } });
  }

  // Playback state
  let time = 0;
  let playing = false;
  let lastTick = 0;
  let rendering = false;
  let picking = false;
  let discoveryGpuActive=false;
  let lastPresentedScene:Scene|undefined;
  let lastPresentedAspect=0;
  const flightClock=new CameraFlightClock();
  let flightPanel:CameraFlightPanel|undefined,fly:FlyCameraControl|undefined;
  let flightTouched=0,motionPreview=false,mathematicsActive=false;
  const mathematicalDrafts=new Map<string,MathematicalValue>();
  let presentedView:CameraView|undefined,pendingCapture:{view:CameraView;time:number;id:string}|undefined;
  let cancelRender: (() => void) | null = null;

  // The scene the user wants is kept in `sync`; the engine follows it. Edits are never lost while a shader compiles.
  const sync = new SceneSync(engine, initial, {
    onRevert(errors) {
      showMessage(["The change could not be used and was rolled back:", ...errors].join("\n"));
      showAll();
    },
    onWarnings(warnings) {
      if (warnings.length > 0) showMessage(["Warning:", ...warnings].join("\n"));
    },
  },scene=>withAnimationIdentities(scene,kind=>kind+'-'+crypto.randomUUID()));
  const colorEdits = bindPanelUndo(document.getElementById('color') as HTMLDivElement, sync); // colour, gradient, cycles and offset: one focused edit is one Undo step

  /** The parameter landscape's refresh, set once the panel exists. */
  let landscapeUpdate: (() => void) | null = null;
  /** The cutbook's refresh, and its camera lock (the camera stays still while one clipping plane is explored). */
  let cutbookUpdate: (() => void) | null = null;
  let atlasUpdate: (() => void) | null = null;
  let cutbookLocked = false;
  function pause(...keepTrialOf: string[]): void {
    // Any other action, a render or an export ends a material trial first: a trial is never part of anything that is kept.
    // The viewport's own preview (ArtistRenderPreview) is the exception for a trial whose owner asks to be shown there: the parameter landscape
    // is looked at through exactly that preview, so the preview must not end it.
    if (sync.auditionOwner === undefined || !keepTrialOf.includes(sync.auditionOwner)) sync.clearAudition(true);
    playing = false;
    if(flightClock.playing)orbit.setFromSceneCamera(sync.scene.camera);
    flightClock.pause();
  }

  const discoveredSources=new Map<string,SynthesizedDefinition>();
  const formulaPreferences = new FormulaPreferences();
  attachSidebarResize(document.getElementById("controls")!, formulaPreferences);
  /** "Visa stegets verkan", set once its panel exists. */
  let stepEffect: StepEffectPanel | null = null;
  // Formula values and the chain's structure are undoable: one focused edit or drag is one Undo step (see panelUndo.ts).
  const chainEdits = bindPanelUndo(chainBox, sync);
  const chainPanel = new ChainPanel(chainBox, library.formulas, {
    explainStep: (index) => stepEffect?.open(index),
    shown: () => stepEffect?.update(),
    edit(change, kind) {
      const originalChange=change;
      change=base=>{const next=originalChange(base),ids=new Set(next.content.flatMap(c=>c.chain.map(step=>step.formula))),definitions=[...(next.discoveredFormulas??[])];for(const id of ids){const source=discoveredSources.get(id);if(source&&!definitions.some(d=>d.id===id))definitions.push(source);}const referenced=definitions.filter(d=>ids.has(d.id));return referenced.length?{...next,discoveredFormulas:referenced}:{...next,discoveredFormulas:undefined};};
      pause();
      if(mathematicsActive&&kind==='value'){
        const view=sync.view,edited=change(view);let authored=change(sync.scene);
        for(const track of propertyTracks(sync.scene.cameraFlight)){
          if(!track.enabled)continue;
          const before=bindingFor(view,library.formulas,track.target),after=bindingFor(edited,library.formulas,track.target);
          if(before&&after&&JSON.stringify(before.value)!==JSON.stringify(after.value)&&validBindingValue(after,after.value)){
            mathematicalDrafts.set(targetKey(track.target),structuredClone(after.value));
            const base=bindingFor(sync.scene,library.formulas,track.target);if(base)authored=setMathematicalValue(authored,track.target,base.value);
          }
        }
        sync.edit(()=>authored);refreshMathematics();
      }else {chainEdits.edit(change);mathematicalDrafts.clear();refreshMathematics();}
      if (kind === "structure") {
        showAll();
        scheduleTiming(); // keyframes follow the chain, so the timing may change
      } else chainPanel.update(sync.view);
      quality.touch(performance.now());
    },
    refused: (message) => showMessage(message),
  }, formulaPreferences);

  // ARTIST-WORKFLOW 04: "Visa stegets verkan". The same render-only audition as the parameter landscape (owner "stepeffect"); only Apply writes.
  // The panel is not a loose sibling of #chain (the settings groups move whole top-level panels and left such a sibling hidden in the Form tab): it is placed under the card of the chosen step, inside the chain list.
  const stepEffectRoot=document.createElement('div');
  stepEffect=new StepEffectPanel(stepEffectRoot,{
    scene:()=>sync.scene,formulas:()=>library.formulas,
    stepElement:index=>chainBox.querySelector<HTMLElement>(`[data-step-index="${index}"]`),notify:text=>showMessage(text),
    begin:(apply,onEnd)=>sync.setAudition(apply,onEnd,[],'stepeffect'),
    end:()=>sync.clearAudition(),
    touch:()=>{quality.touch(performance.now());},
    commit:change=>{pause();sync.editWithUndo(change);showAll();scheduleTiming();quality.touch(performance.now());},
    thumbnail:()=>captureThumbnail(160,'image/png',true),
    busy:()=>rendering||picking||discoveryGpuActive||gpuLost,
    undo:()=>{if(rendering||picking)return false;pause();const ok=sync.undo();if(ok){showAll();scheduleTiming();}quality.touch(performance.now());return ok;},
    canUndo:()=>sync.canUndo,
  });

  // MB3D import changes compatible fractal content and view in one reversible transaction.
  new Mb3dImportPanel(randomBox, {
    library: () => library.formulas,
    apply(change) {
      sync.editWithUndo(change);
      pause(); time = 0;
      showAll(); scheduleTiming(); quality.touch(performance.now());
    },
    undo() {
      if (!sync.undo()) return;
      pause(); time = 0;
      showAll(); scheduleTiming(); quality.touch(performance.now());
    },
    canUndo: () => sync.canUndo,
    onMessage: showMessage,
  });

  // Private library of converted .m3f formulas (FORMULA-IMPORTER-01): stays in this profile, never in the public library.
  new FormulaImportPanel(randomBox, {
    library: () => library.formulas,
    added(f) { if (!library.formulas.some(x => x.id === f.id)) library.formulas.push(f); engine.setFormulas(library.formulas); chainPanel.update(sync.scene); },
    removed(id) {
      if (JSON.stringify(sync.scene.content).includes(id)) { showMessage('The formula stays in the open scene and disappears only when the scene is replaced.'); }
      else { const i = library.formulas.findIndex(x => x.id === id); if (i >= 0) library.formulas.splice(i, 1); engine.setFormulas(library.formulas); chainPanel.update(sync.scene); }
    },
    onMessage: showMessage,
  });

  // ---- random formulas (ARCHITECTURE.md 8.21): a grid of new formulas; a picked one joins the library for this session
  const baseFormulaIds = new Set(library.formulas.map((f) => f.id));
  async function acquireDiscoveryGpu(signal:AbortSignal){
    if(rendering||picking)throw Error('The main renderer/surface search is busy.');
    while(discoveryGpuActive){if(signal.aborted)throw new DOMException('Cancelled','AbortError');await new Promise(resolve=>setTimeout(resolve,16));}
    discoveryGpuActive=true;canvas.dataset.auxGpuBusy='1';
    while(previewBusy||mainAuxBusy){if(signal.aborted){releaseDiscoveryGpu();throw new DOMException('Cancelled','AbortError');}await new Promise(resolve=>setTimeout(resolve,16));}
    if(signal.aborted){releaseDiscoveryGpu();throw new DOMException('Cancelled','AbortError');}
  }
  function releaseDiscoveryGpu(){discoveryGpuActive=false;canvas.dataset.auxGpuBusy='0';renderedKey='';}
  const fractalLibrary=new FractalLibrary(formulasBox,{
    // committedView, not view: a material or Look trial on screen must never be saved as a bildpreset (RC-FIX-01 B1).
    scene:()=>sync.committedView,formulas:()=>library.formulas,discoveryFormulas:()=>library.formulas.filter(f=>baseFormulaIds.has(f.id)),
    thumbnailSize:scene=>presetThumbnailSize(scene,canvas.clientWidth/Math.max(1,canvas.clientHeight)),
    async thumbnail(scene,request){
      const {signal,width,height,generation,sourceFingerprint}=request;
      if(request.quality){
        // ARTIST-UX-02 phase D, user-triggered "Rendera bättre förhandsbild…": the existing still renderer (same path as LookDev) on the
        // SAVED preset scene with its own Geometry Detail setting; only size and sample count come from the chosen budget.
        await acquireDiscoveryGpu(signal);
        try{
          signal.throwIfAborted();
          if(scene.geometryDetail?.enabled){const unavailable=geometryUnavailable(scene,library.formulas);if(unavailable)throw Error(unavailable);}
          await syncPictures(scene,true);signal.throwIfAborted();
          const renderer=await stillEngineFor(scene);
          const ready=await renderer.setScene(scene);signal.throwIfAborted();
          if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The scene of the preset was replaced during preparation.');
          const image=await renderer.renderToBuffer(width,height,{quality:{samples_per_pixel:Math.min(8,request.samples??4)},referenceFilm:{width,height},tilePixels:16384,signal,onProgress:p=>{if(!signal.aborted)request.progress?.(p.fraction);}});
          signal.throwIfAborted();
          if(image.width!==width||image.height!==height||image.data.length!==width*height*4||!image.data.some((v,i)=>i%4===3&&v>0))throw Error('The pixel transfer of the preview is incomplete.');
          const out=document.createElement('canvas');out.width=width;out.height=height;out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),width,height),0,0);
          return {png:out.toDataURL('image/png'),width,height,generation,sourceFingerprint};
        }finally{try{if(!gpuLost){const view=sync.view;await syncPictures(view);await engine.setScene(view);}}finally{releaseDiscoveryGpu();}}
      }
      await acquireDiscoveryGpu(signal);try{
        signal.throwIfAborted();await syncPictures(scene,true);signal.throwIfAborted();
        const set=await engine.setScene(scene);if(set.errors.length)throw Error(set.errors.join('; '));if(set.superseded)throw Error('The scene of the thumbnail was replaced before the rendering was finished.');signal.throwIfAborted();
        const details={...scene.details,ao:{...scene.details.ao,enabled:false},cavity:{...scene.details.cavity,enabled:false},...(scene.details.edge_softening?{edge_softening:{...scene.details.edge_softening,enabled:false}}:{})};
        const image=await engine.renderToBuffer(width,height,{quality:{samples_per_pixel:1,max_steps:144,shadow_steps:16,step_factor:.65,hit_precision:.0015,normal_epsilon:.0015,seed:0},denoise:false,details,dofMode:'off',tileSize:64,tilePixels:width*16,signal,features:{...FULL_VIEWPORT_FEATURES,shadows:false,occlusion:false,reflections:true,reflectionBudget:{maxSteps:32,samples:1,maxBounces:1},maxTransportBounces:0}});
        signal.throwIfAborted();if(image.width!==width||image.height!==height||image.data.length!==width*height*4||!image.data.some((v,i)=>i%4===3&&v>0))throw Error('The pixel transfer of the thumbnail is incomplete.');
        const thumb=document.createElement('canvas');thumb.width=width;thumb.height=height;thumb.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data),width,height),0,0);return {png:thumb.toDataURL('image/png'),width,height,generation,sourceFingerprint};
      }finally{try{const view=sync.view;await syncPictures(view);await engine.setScene(view);}finally{releaseDiscoveryGpu();}}
    },
    develop:definition=>discoveryGallery.developSource(definition),
    load(record){
      if(rendering||picking)throw Error('End the rendering/surface search before changing the scene.');
      const payload=record.payload;
      if(payload.kind==='preset'||payload.kind==='legacy-variation')sync.editWithUndo(()=>structuredClone(payload.scene));
      else if(payload.kind==='formula')sync.editWithUndo(base=>applySynthesizedScene(base,synthesizedCandidateScene(payload.definition),payload.definition,()=>crypto.randomUUID(),true));
      else {
        const parsed=parseFormula(payload.text);if(!parsed.ok)throw Error(parsed.errors.join('; '));const f=parsed.formula,known=library.formulas.find(x=>x.id===f.id);
        if(known&&expressionSignature(known)!==expressionSignature(f))throw Error('An older formula ID collides with other installed content.');
        if(!known)library.formulas.push(f);engine.setFormulas(library.formulas);
        sync.editWithUndo(base=>{if(base.animation.keyframes.length)throw Error('Legacy keys must be handled before the chain is replaced.');return {...base,camera:base.composition?.locked?base.camera:createDefaultScene(f).camera,content:[{id:crypto.randomUUID(),type:'fractal',chain:[{...defaultStep(f),id:crypto.randomUUID()}],rounds:1}]};});
      }
      pause();exitMathematics();flightClock.stop();mathematicalDrafts.clear();showAll();scheduleTiming();quality.touch(performance.now());
    },
    undo(){pause();exitMathematics();if(sync.undo())showAll();quality.touch(performance.now());},
  });
  // Legacy AST editing remains reachable from saved library entries, without its obsolete discovery entry point.
  const discoveryGallery=new DiscoveryGallery(document.createElement('div'),{
    library:()=>library.formulas.filter(f=>baseFormulaIds.has(f.id)),currentScene:()=>sync.scene,available:()=>!rendering&&!picking,
    saveFormula:(definition,thumbnail)=>fractalLibrary.saveFormula(definition,thumbnail).then(()=>{}).catch(e=>{throw Error(libraryStorageError(e));}),
    savePreset:(scene,thumbnail)=>fractalLibrary.savePreset(scene,thumbnail).then(()=>{}).catch(e=>{throw Error(libraryStorageError(e));}),
    beforePreview:acquireDiscoveryGpu,
    afterPreview:releaseDiscoveryGpu,
    apply(candidate,frameCamera){
      if(rendering||picking)throw Error('End the main rendering first.');
      sync.editWithUndo(base=>candidate.definition?applySynthesizedScene(base,candidate.scene,candidate.definition,()=>crypto.randomUUID(),frameCamera):applyDiscoveryCandidate(base,candidate.variation!,library.formulas.filter(f=>baseFormulaIds.has(f.id)),()=>crypto.randomUUID(),frameCamera));
      pause();exitMathematics();flightClock.stop();mathematicalDrafts.clear();showAll();scheduleTiming();quality.touch(performance.now());
    },
    undo(){pause();exitMathematics();if(sync.undo())showAll();quality.touch(performance.now());},
  });
  const variationsEntry=document.createElement('div');document.getElementById('controls')!.prepend(variationsEntry);
  const variationsPanel=new VariationsPanel(variationsEntry,{
    formulas:()=>library.formulas,current:()=>sync.scene,
    async capture(signal){
      pause();fly?.setActive(false);
      const deadline=performance.now()+90000;
      while(lastPresentedScene!==sync.view){signal.throwIfAborted();if(performance.now()>deadline)throw Error('The current scene has no finished viewport picture yet. Try again when it is shown.');await new Promise(resolve=>setTimeout(resolve,16));}
      await acquireDiscoveryGpu(signal);
      try{signal.throwIfAborted();if(!lastPresentedScene||lastPresentedScene!==sync.view)throw Error('The scene changed during the capture. Capture the current view again.');return {scene:lastPresentedScene,identity:sync.scene,aspect:canvas.clientWidth/Math.max(1,canvas.clientHeight),frame:'Captured moment · '+flightClock.time.toFixed(3)+' s'};}
      finally{releaseDiscoveryGpu();}
    },
    async render(scene,width,height,signal){
      await acquireDiscoveryGpu(signal);const started=performance.now();
      try{
        signal.throwIfAborted();await syncPictures(scene,true);const result=await engine.setScene(scene);signal.throwIfAborted();if(result.errors.length||result.superseded)throw Error(result.errors.join('; ')||'The scene was replaced.');
        const details={...scene.details,ao:{...scene.details.ao,enabled:false},cavity:{...scene.details.cavity,enabled:false},...(scene.details.edge_softening?{edge_softening:{...scene.details.edge_softening,enabled:false}}:{})};
        const layers=await engine.renderLayersToBuffer(width,height,{signal,quality:{samples_per_pixel:1,max_steps:192,shadow_steps:16,step_factor:.65,hit_precision:.001,normal_epsilon:.001,seed:0},details,dofMode:'off',tilePixels:width*16,features:{...FULL_VIEWPORT_FEATURES,shadows:false,occlusion:false,reflections:true,reflectionBudget:{maxSteps:24,samples:1,maxBounces:1},secondaryReflections:false,maxTransportBounces:0}});signal.throwIfAborted();
        const thumb=document.createElement('canvas');thumb.width=width;thumb.height=height;thumb.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(layers.color),width,height),0,0);
        let hits=0,nx=0,ny=0,nz=0,luma=0,luma2=0;for(let i=0;i<layers.depth.length;i++){if(layers.depth[i]!>=0){hits++;nx+=layers.normal[i*3]!;ny+=layers.normal[i*3+1]!;nz+=layers.normal[i*3+2]!;}const v=(layers.color[i*4]!+layers.color[i*4+1]!+layers.color[i*4+2]!)/(3*255);luma+=v;luma2+=v*v;}
        const signature:number[]=[];for(let y=0;y<12;y++)for(let x=0;x<16;x++){const i=Math.min(height-1,Math.floor((y+.5)*height/12))*width+Math.min(width-1,Math.floor((x+.5)*width/16));for(let c=0;c<3;c++)signature.push(layers.color[i*4+c]!/255);signature.push(layers.depth[i]!>=0?1:0);}
        return {url:thumb.toDataURL('image/png'),hitShare:hits/(width*height),signature,milliseconds:performance.now()-started,shaderModules:engine.shaderCompilations,colorSpread:Math.sqrt(Math.max(0,luma2/(width*height)-(luma/(width*height))**2)),normalSpread:hits?Math.max(0,1-Math.hypot(nx,ny,nz)/hits):0};
      }finally{try{const view=sync.view;await syncPictures(view);await engine.setScene(view);}finally{releaseDiscoveryGpu();}}
    },
    apply(source,candidate){if(rendering||picking)throw Error('End the main rendering first.');pause();sync.editWithUndo(base=>applyVariation(base,source,candidate,library.formulas));exitMathematics();flightClock.pause();mathematicalDrafts.clear();showAll();scheduleTiming();quality.touch(performance.now());},
    undo(){pause();exitMathematics();if(sync.undo())showAll();quality.touch(performance.now());},
    async save(scene,thumbnail,title,notes){const record=await fractalLibrary.savePreset(scene,thumbnail,title,notes);if(record.thumbnailState?.status!=='ready')throw Error('The scene was saved, but the thumbnail must be remade in the library.');return record.id;},
  });
  // ARTIST-WORKFLOW 03: the parameter landscape. Exploring is a render-only audition on top of the authored scene; only Apply writes (one undo step).
  const landscapeEntry=document.createElement('div');document.getElementById('controls')!.prepend(landscapeEntry);
  const landscapePanel=new ParameterLandscapePanel(landscapeEntry,{
    scene:()=>sync.scene,formulas:()=>library.formulas,
    begin:(apply,onEnd)=>sync.setAudition(apply,onEnd,[],'landscape'),
    end:()=>sync.clearAudition(),
    // Not pause(): pause() ends every render-only trial, including this one. Moving the point only asks the viewport to refresh.
    touch:()=>{quality.touch(performance.now());},
    hold:on=>quality.hold(on,performance.now()),
    commit:change=>{pause();sync.editWithUndo(change);showAll();quality.touch(performance.now());},
    thumbnail:()=>captureThumbnail(96,'image/webp',true),
    busy:()=>rendering||picking||discoveryGpuActive||gpuLost,
    undo:()=>{if(rendering||picking)return false;pause();const ok=sync.undo();if(ok)showAll();quality.touch(performance.now());return ok;},
    canUndo:()=>sync.canUndo,
    async save(scene,title,notes){const png=await captureThumbnail(224,'image/png',true);if(!png)throw Error('The engine is busy. Try again.');const record=await fractalLibrary.savePreset(scene,png,title,notes);return record.id;},
  });
  landscapeUpdate=()=>landscapePanel.update();
  // The independent random-chain tool predates discovery. Keep its generator and legacy preset data available.
  const randomDetails=document.createElement('details'),randomSummary=document.createElement('summary'),randomRoot=document.createElement('div');
  randomSummary.textContent='Randomise chain · separate generator';randomDetails.append(randomSummary,randomRoot);randomBox.append(randomDetails);
  new RandomPanel(randomRoot,library.formulas,{
    currentScene:()=>sync.scene,onMessage:showMessage,
    onApply(scene){if(rendering||picking||discoveryGpuActive){showMessage('Wait until the ongoing GPU work is finished.');return;}pause();sync.editWithUndo(()=>scene);exitMathematics();flightClock.stop();mathematicalDrafts.clear();showAll();scheduleTiming();quality.touch(performance.now());},
  });
  // Compatibility loading remains after retiring only the obsolete generator presentation.
  void new FormulaStore().listFormulas().then(saved=>{
    for(const record of saved){const parsed=parseFormula(record.text);if(parsed.ok&&!library.formulas.some(f=>f.id===parsed.formula.id))library.formulas.push(parsed.formula);}
    engine.setFormulas(library.formulas);chainPanel.update(sync.scene);
  }).catch(e=>showMessage('Older saved formulas could not be read: '+String(e)));

  // ---- animation: timeline, keyframes, playback
  let timingTimer: ReturnType<typeof setTimeout> | undefined;
  let timingNote = "";

  /** Measures the distance to the surface along the camera path (needs the graphics card), a moment after the last change. */
  function scheduleTiming(attempt = 0): void {
    clearTimeout(timingTimer);
    if (sync.scene.animation.keyframes.length < 2 || sync.scene.cameraFlight?.enabled && (cameraKeys(sync.scene.cameraFlight).length>0||propertyTracks(sync.scene.cameraFlight).some(t=>t.enabled&&t.keyframes.length>0))) {
      timingNote = "";
      return;
    }
    timingTimer = setTimeout(async () => {
      if (rendering || picking) return;
      if(discoveryGpuActive||previewBusy||mainAuxBusy){scheduleTiming(attempt);return;}
      try {
        mainAuxBusy=true;try{await sync.flush();}finally{mainAuxBusy=false;}
        await timing.refresh(sync.scene);
        timingNote = sync.scene.animation.speed_mode === "adaptive" ? "The camera speed is calculated from the distance to the surface." : "";
      } catch {
        if (attempt < 6) scheduleTiming(attempt + 1); // the shader may still be compiling
      }
    }, 400 + attempt * 300);
  }

  function applyTime(t: number): void {
    exitMathematics();
    time = Math.min(Math.max(0, t), sync.scene.animation.duration_seconds);
    // With fewer than two keyframes there is nothing to blend, and the scene must keep what the user just did.
    if (sync.scene.animation.keyframes.length >= 2) sync.edit((s) => evaluateAnimation(s, time, timing.timing));
    syncLive();
  }

  /** Shows the scene's fog in the fog panel. Set once the panel exists. */
  let showFog: (() => void) | null = null;
  let showFractalDisplacement: (() => void) | null = null;
  /** Shows the focus and depth-of-field panel (ARTIST-SCALE-02). Set once the panel exists. */
  let showDof: (() => void) | null = null;
  let showEnvironment: (() => void) | null = null;
  let showMaterial: (() => void) | null = null;
  /** Shows the scene's lights in the light panel. Set once the panel exists. */
  let showLights: (() => void) | null = null;
  /** ARTIST-SCALE-03: redraws the "Belysning vid målet" control. Set once it exists. */
  let showLightFit: (() => void) | null = null;
  /** ARTIST-LOOKS-02: redraws the lighting-rig section. Set once it exists. */
  let showLightRigs: (() => void) | null = null;
  /** ARTIST-LOOKS-03: refreshes the Looks section. Set once it exists. */
  let showLooks: (() => void) | null = null;

  /** A new light, placed so that it is useful: point and spot lights start at the camera, looking at the middle. */
  function newLight(type: LightType): LightSettings {
    // Strength follows the distance to what the camera looks at (the pivot), not to the world origin, and is never rounded
    // to a tenth: a small subject needs a strength like 0.0003. See lightScale.ts.
    return newSubjectLight(sync.scene.camera, type);
  }

  const lightEdits = bindPanelUndo(lightsBox, sync);
  const lightsPanel = new LightsPanel(lightsBox, {
    onLight(index, changes) {
      pause();
      lightEdits.edit((s) => ({ ...s, lights: s.lights.map((l, i) => (i === index ? { ...l, ...changes } : l)) }));
      showLights?.();
    },
    onAmbient(changes) {
      pause();
      lightEdits.edit((s) => ({ ...s, ambient: { ...s.ambient, ...changes } }));
      showLights?.();
    },
    onAdd(type) {
      pause();
      lightEdits.edit((s) => (s.lights.length >= MAX_LIGHTS ? s : { ...s, lights: [...s.lights, newLight(type)] }));
      showLights?.();
    },
    onRemove(index) {
      pause();
      lightEdits.edit((s) => ({ ...s, lights: s.lights.filter((_, i) => i !== index) }));
      showLights?.();
    },
    onAimSurface(index) { startSpotAim(index); },
    onAimFit(index) { startSpotAim(index, lightFitPanel.level); },
    onAim(index) {
      if(!startSpotAim(index))return;
      const r=spotAimRect();void spotAim.at(r.left+r.width/2,r.top+r.height/2);
    },
    onPreset(presetId) {
      pause();
      sync.editWithUndo((s) => applyLightingPreset(s, presetId));
      showLights?.();
      showEnvironment?.();
      showRenderSetup?.();
    },
  });
  showLights = (): void => { lightsPanel.update(sync.scene.lights, sync.scene.ambient, true); showLightFit?.(); showLightRigs?.(); showLooks?.(); }; // LookDev restores every selected light; NAV uses a temporary headlight.

  /** A surface distance measured in the picture centre. UI state only: never saved, never part of the scene. */
  let measuredSubject: { point: Vec3; scene: Scene } | null = null;
  /** Set once the pick machinery below exists. */
  let measureSubject: (() => void) | null = null;
  /** The visible depth of the picture (ARTIST-WORKFLOW 01), measured with a small depth grid. UI state only; valid while camera and geometry are unchanged. */
  let measuredDepth: { range: DepthRange; scene: Scene } | null = null;
  let measureDepth: (() => Promise<DepthRange | null>) | null = null;
  /** The measured point counts only while the geometry it was measured on is unchanged; the camera may move. */
  const measuredPoint = (): Vec3 | null => {
    const m = measuredSubject;
    if (!m) return null;
    return sameSurfacePickView({ ...m.scene, camera: sync.scene.camera }, sync.scene) ? m.point : null;
  };
  const fogEdits = bindPanelUndo(fogBox, sync); // one focused edit or drag of a fog value is one Undo step
  const fogPanel = new FogPanel(fogBox, {
    sceneToken: () => sync.scene,
    onChange(changes) {
      pause();
      fogEdits.edit((s) => ({ ...s, fog: withFogChanges(s.fog, changes) }));
      showFog?.();
    },
    relative: {
      reference: () => subjectReference(sync.scene.camera, measuredPoint()),
      // The first change of a gesture is the Undo step; the rest of the drag edits the same scene on top of it.
      onChange(changes, begin) {
        pause();
        const apply = (s: Scene): Scene => ({ ...s, fog: withFogChanges(s.fog, changes) });
        if (begin) sync.editWithUndo(apply);
        else sync.edit(apply);
        showFog?.();
      },
      onMeasure: () => measureSubject?.(),
      onUndo() {
        if (rendering || picking) return;
        pause();
        if (sync.undo()) showAll();
        showFog?.();
      },
      onRedo() {
        if (rendering || picking) return;
        pause();
        if (sync.redo()) showAll();
        showFog?.();
      },
      canUndo: () => sync.canUndo,
      canRedo: () => sync.canRedo,
    },
    depth: {
      // Unlike the subject point, the depth range depends on the camera too, so any change of view or geometry makes it stale.
      range: () => (measuredDepth && sameSurfacePickView(measuredDepth.scene, sync.scene) ? measuredDepth.range : null),
      measure: () => (measureDepth ? measureDepth() : Promise.resolve(null)),
    },
  });
  showFog =(): void => fogPanel.update(sync.scene.fog);

  // Displacement of the fractal itself: layers of noise with masks. Only numbers change, so nothing is rebuilt.
  const fractalDisplacementPanel = new FractalDisplacementPanel(document.getElementById('fractal-displacement') as HTMLDivElement, {
    reference: () => { const c = sync.scene.camera; return Math.max(1e-9, Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2])); },
    maskSpan(measure) {
      const c = sync.scene.camera, r = Math.max(1e-9, Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2])), span = 3 * r;
      const centre = measure === 'x' ? c.target[0] : measure === 'z' ? c.target[2] : measure === 'height' ? c.target[1] : 0;
      return measure === 'radius' ? [0, Math.hypot(...c.target) + span] : [centre - span, centre + span];
    },
    onChange(next, begin) {
      pause();
      const apply = (s: Scene): Scene => { const { fractalDisplacement: _old, ...rest } = s; return next.layers.length || next.enabled ? { ...rest, fractalDisplacement: next } : rest; };
      if (begin) sync.editWithUndo(apply); else sync.edit(apply);
    },
  });
  showFractalDisplacement = (): void => fractalDisplacementPanel.update(sync.scene.fractalDisplacement);
  showFractalDisplacement();

  const environmentEdits = bindPanelUndo(environmentBox, sync);
  const environmentPanel = new EnvironmentPanel(environmentBox, {
    async onPickFile(file) {
      try {
        if (file.size > 60_000_000) throw new Error("The file is too large (at most 60 MB).");
        const prepared = prepareEnvironmentImage(decodeRgbe(new Uint8Array(await file.arrayBuffer())));
        const data = imageToDataAddress(prepared);
        if (data.length > MAX_ENV_DATA_LENGTH) throw new Error("The picture became too large.");
        pause();
        const old = sync.scene.environment;
        sync.edit((s) => ({
          ...s,
          environment: {
            kind: "hdri",
            data,
            name: file.name.slice(0, 100),
            // Nothing is guessed: the user fills these in, and until then the credits say so.
            source: old.kind === "hdri" ? old.source : "Unknown (fill in)",
            license: old.kind === "hdri" ? old.license : "Unknown (fill in)",
            ...(old.kind === "hdri" && old.author ? { author: old.author } : {}),
            rotation_degrees: old.kind === "hdri" ? old.rotation_degrees : 0,
            intensity: old.kind === "hdri" ? old.intensity : 1,
            background_visible: old.kind === "hdri" ? old.background_visible : true,
          },
        }));
        showEnvironment?.();
      } catch (err) {
        showMessage(`The environment picture could not be used: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    onChange(changes) {
      pause();
      environmentEdits.edit((s) => (s.environment.kind === "hdri" ? { ...s, environment: { ...s.environment, ...changes } } : s));
      showEnvironment?.();
    },
    onClear() {
      pause();
      environmentEdits.edit((s) => ({ ...s, environment: { kind: "gradient" } }));
      showEnvironment?.();
    },
  });
  showEnvironment = (): void => environmentPanel.update(sync.scene.environment);

  let boxGesture = false, boxGestureEdited = false;
  const boxGizmo = new BoxCutGizmo(canvas, change => {
    if(rendering || picking) return;
    pause();
    if(!boxGesture || !boxGestureEdited)sync.editWithUndo(change);else sync.edit(change);
    boxGestureEdited=true;quality.touch(performance.now());renderDetailsPanel.update(sync.scene);boxGizmo.update(sync.view,!rendering);
  }, held => {boxGesture=held;boxGestureEdited=false;quality.hold(held,performance.now());});
  let clipGesture = false, clipGestureEdited = false; // one drag of a clip-plane handle is one Undo step
  const clipGizmo = new ClipPlaneGizmo(canvas, change => {
    if (rendering || picking) return;
    pause(); if (clipGesture && clipGestureEdited) sync.edit(change); else sync.editWithUndo(change);
    clipGestureEdited = true; quality.touch(performance.now()); renderDetailsPanel.update(sync.scene);
  }, held => { clipGesture = held; clipGestureEdited = false; quality.hold(held, performance.now()); });
  const detailEdits = bindPanelUndo(document.getElementById("cutout")!, sync);
  bindPanelUndo(document.getElementById("details")!, sync, detailEdits); // cut-out and detail values share one gesture
  const renderDetailsPanel = new RenderDetailsPanel(document.getElementById("cutout")!, document.getElementById("details")!, change => {
    pause(); detailEdits.edit(change); renderDetailsPanel.update(sync.scene);
  }, (index, visible) => { clipGizmo.update(sync.view, index, visible && !rendering); boxGizmo.update(sync.view,!rendering); }, {
    edit(change) {if(rendering||picking)return;pause();sync.editWithUndo(change);quality.touch(performance.now());renderDetailsPanel.update(sync.scene);},
    view() {return {scene:sync.view,width:canvas.clientWidth,height:canvas.clientHeight};},
    undo() {if(rendering||picking)return;pause();if(sync.undo())showAll();quality.touch(performance.now());},
    canUndo() {return sync.canUndo;},
  });

  const materialPanel = new MaterialPanel(materialBox, {
    onChange(name, value) {
      pause();
      sync.editWithUndo((s) => ({ ...s, material: { ...s.material, [name]: value } }));
      showMaterial?.();primitivePanel.update(sync.scene);
    },
    onPreset(material){pause();sync.editWithUndo(s=>({...s,material}));showMaterial?.();primitivePanel.update(sync.scene);},
    color:()=>sync.scene.color,
    onMaterialPreset(material,color){applyLibraryMaterial(material,color);},
    // ARTIST-LOOKS-01: the library can show a material as a render-only trial before it is applied.
    audition:{
      scene:()=>sync.scene,
      begin:(apply,onEnd)=>sync.setAudition(apply,onEnd,["material","color"],'material'),
      end:()=>sync.clearAudition(),
      commit:(material,color)=>applyLibraryMaterial(material,color),
      busy:()=>rendering||picking||discoveryGpuActive||gpuLost,
      undo:()=>{if(rendering||picking)return false;pause();const ok=sync.undo();if(ok)showAll();return ok;},
      canUndo:()=>sync.canUndo,
    },
  });
  function applyLibraryMaterial(material:MaterialSettings,color?:ColorSettings):void {pause();sync.editWithUndo(s=>({...s,material,...(color?{color:replacementGradientColor(s,color)}:{})}));showAll();}
  const primitivePanel=new PrimitivePanel(document.getElementById('primitives')!,edit=>{pause();sync.editWithUndo(edit);primitivePanel.update(sync.scene);},()=>{if(sync.undo())syncLive();},()=>sync.canUndo,{
    placementChanged(){canvas.style.cursor=primitivePanel.placementRequest?'crosshair':'';pause();},
    focus(p,frame){
      if(rendering||picking||sync.scene.composition?.locked)return;
      const c=sync.scene.camera,delta=c.position.map((v,i)=>v-c.target[i]!),length=Math.hypot(...delta);
      const extent=p.type==='plane'?Math.max(...p.scale):Math.hypot(...p.scale);
      const rect=canvas.getBoundingClientRect(),vf=verticalFovDegrees(cameraFov(c,sync.scene.render.fov_axis,rect.width,rect.height),sync.scene.render.fov_axis,rect.width,rect.height)*Math.PI/180;
      const halfAngle=Math.atan(Math.tan(vf/2)*Math.min(1,rect.width/rect.height));
      const distance=frame?extent*1.3/Math.sin(halfAngle):length;
      sync.editWithUndo(s=>({...s,camera:{...s.camera,target:[...p.position],position:p.position.map((v,i)=>v+delta[i]!*distance/Math.max(length,1e-9)) as [number,number,number],...(frame&&c.projection==='orthographic'?{ortho_height:extent*2.6/Math.min(1,rect.width/rect.height)}:{})}}));
      orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);quality.touch(performance.now());
      primitivePanel.update(sync.scene);
    },
  });
  primitivePanel.update(sync.scene);
  const reflectionPanel=new ReflectionPanel(materialBox,settings=>{pause();sync.editWithUndo(s=>({...s,reflections:settings}));showMaterial?.();primitivePanel.update(sync.scene);},enabled=>{pause();sync.editWithUndo(s=>({...s,denoise:{enabled}}));showMaterial?.();primitivePanel.update(sync.scene);},enabled=>{pause();sync.editWithUndo(s=>({...s,diffuseGi:{enabled}}));showMaterial?.();primitivePanel.update(sync.scene);});
  const displayPanel=new DisplayPanel(materialBox,display=>{pause();sync.editWithUndo(s=>({...s,display}));showMaterial?.();});
  const transportPanel=new TransportPanel(materialBox,transport=>{pause();sync.editWithUndo(s=>({...s,transport}));showMaterial?.();primitivePanel.update(sync.scene);});
  showMaterial = (): void => {displayPanel.update(sync.scene.display);materialPanel.update(sync.scene.material,'fractal',geo8Artist?.document?'Inactive in the locked GEO8/native profile; the surface calculation of the original is preserved.':sync.scene.transport?.enabled?'Inactive with separate geometric transport; the saved value is preserved.':undefined);reflectionPanel.update(sync.scene.reflections,sync.scene.denoise?.enabled,sync.scene.transport?.enabled,sync.scene.diffuseGi?.enabled);transportPanel.update(sync.scene.transport);};

  const animationPanel = new AnimationPanel(animationBox, {
    onSeek(t) {
      pause();
      applyTime(t);
    },
    onTogglePlay() {
      flightClock.pause();fly?.setActive(false);exitMathematics();
      if (sync.scene.animation.keyframes.length < 2) {
        showMessage("Set at least two keyframes to be able to play.");
        return;
      }
      playing = !playing;
      lastTick = performance.now();
      if (playing && time >= sync.scene.animation.duration_seconds) time = 0;
      if (playing) void timing.refresh(sync.scene).catch(() => undefined);
    },
    onRewind() {
      pause();
      applyTime(0);
    },
    onAddKeyframe() {
      pause();
      sync.edit((s) => setKeyframe(s, captureKeyframe(s, time)));
      scheduleTiming();
      syncLive();
    },
    onGoto(i) {
      pause();
      applyTime(sync.scene.animation.keyframes[i]?.time_seconds ?? 0);
    },
    onUpdate(i) {
      const k = sync.scene.animation.keyframes[i];
      if (!k) return;
      pause();
      sync.edit((s) => setKeyframe(s, captureKeyframe(s, k.time_seconds)));
      scheduleTiming();
    },
    onDelete(i) {
      pause();
      sync.edit((s) => removeKeyframe(s, i));
      scheduleTiming();
      syncLive();
    },
    onSettings(changes) {
      sync.edit((s) => withAnimationSettings(s, changes));
      scheduleTiming();
      syncLive();
    },
    onExportCamera(kind) {
      void runCameraExport(kind);
    },
    onFixedSpeed(speed) {
      pause();
      sync.edit((s) => retimeForFixedSpeed(s, speed));
      scheduleTiming();
      syncLive();
    },
  });

  const navigation = new NavigationPanel(document.getElementById('navigation')!, point => {
    if (rendering || picking || discoveryGpuActive || sync.scene.composition?.locked) return;
    if (Math.hypot(...point.map((v,i)=>v-sync.scene.camera.position[i]!)) === 0) { navigation.status.textContent = 'The focus and the camera must differ.'; return; }
    pause();
    sync.edit(s => ({ ...s, camera: { ...s.camera, target: [...point] } }));
    orbit.setFromSceneCamera(sync.scene.camera); navigation.update(sync.scene.camera); quality.touch(performance.now());
  });

  function refreshMathematics(){
    if(mathematicsActive&&sync.scene.cameraFlight?.enabled){const at=flightClock.time;sync.setEvaluation(base=>evaluateMathematics(base,at,library.formulas,mathematicalDrafts));}
    else sync.setEvaluation();
  }
  function exitMathematics(){mathematicsActive=false;mathematicalDrafts.clear();refreshMathematics();chainPanel.update(sync.scene);quality.touch(performance.now());flightUpdate();}
  function flightUpdate(){flightPanel?.update(sync.scene,flightClock,sync.view);}
  function flightEdit(edit:(clip:CameraFlight)=>CameraFlight){
    if(rendering||picking)return;pause();
    try{sync.editWithUndo(s=>({...s,cameraFlight:edit(s.cameraFlight??defaultCameraFlight())}));flightPanel?.setStatus('');refreshMathematics();flightUpdate();}
    catch(e){flightPanel?.setStatus(String(e instanceof Error?e.message:e));}
  }
  function hasMathematicalKeys(){return propertyTracks(sync.scene.cameraFlight).some(t=>t.enabled&&t.keyframes.length>0&&bindingFor(sync.scene,library.formulas,t.target));}
  function flightSeek(t:number){
    if(rendering||picking||sync.scene.composition?.locked&&!hasMathematicalKeys()){flightPanel?.setStatus('End the rendering or unlock the camera first.');return;}
    const clip=sync.scene.cameraFlight;flightClock.seek(t,clip?.duration_seconds??10);mathematicsActive=true;mathematicalDrafts.clear();
    const view=clip&&!sync.scene.composition?.locked?evaluateCameraAtTime(clip,flightClock.time,compositionViewport.aspect()):undefined;
    if(view){cancelDof();sync.edit(s=>({...s,camera:view.camera,render:{...s.render,fov_axis:view.fov_axis}}));orbit.setFromSceneCamera(view.camera);navigation.update(view.camera);flightTouched=performance.now();quality.touch(flightTouched);}
    refreshMathematics();chainPanel.update(sync.view);flightTouched=performance.now();quality.touch(flightTouched);flightUpdate();
  }
  function commitCameraCapture(){
    const p=pendingCapture;if(!p)return;
    const current={camera:sync.scene.camera,fov_axis:sync.scene.render.fov_axis};
    if(JSON.stringify(current)!==JSON.stringify(p.view)){pendingCapture=undefined;flightPanel?.setStatus('The view changed before the capture. Capture the new view again.');return;}
    if(JSON.stringify(presentedView)!==JSON.stringify(p.view))return;
    pendingCapture=undefined;flightEdit(clip=>putCameraKey(clip,captureCameraKey(p.view,p.time,p.id)));flightClock.seek(p.time,sync.scene.cameraFlight?.duration_seconds??10);flightPanel?.select(p.id);flightPanel?.setStatus('The shown camera view is captured.');flightUpdate();
  }
  flightPanel=new CameraFlightPanel(document.getElementById('camera-flight')!,{
    seek(t){pause();fly?.setActive(false);flightSeek(t);},
    play(){if(rendering||picking||sync.scene.composition?.locked&&!hasMathematicalKeys())return;const clip=sync.scene.cameraFlight;if(!clip?.enabled||!([clip.tracks[0].enabled!==false&&!sync.scene.composition?.locked?cameraKeys(clip):[],...propertyTracks(clip).filter(t=>t.enabled&&bindingFor(sync.scene,library.formulas,t.target)).map(t=>t.keyframes)].some(keys=>keys.length>=2)))return;pause();fly?.setActive(false);flightClock.play(performance.now(),clip.duration_seconds);flightSeek(flightClock.time);flightUpdate();},
    pause(){pause();flightUpdate();},stop(){pause();fly?.setActive(false);flightClock.stop();flightSeek(0);},
    capture(nextSeconds){
      if(rendering||picking)return;pause();fly?.setActive(false);
      const clip=sync.scene.cameraFlight??defaultCameraFlight(),last=cameraKeys(clip).at(-1);const at=nextSeconds===undefined?flightClock.time:(last?.time_seconds??0)+nextSeconds;
      if(!Number.isFinite(at)||at<0||at>MAX_FLIGHT_SECONDS){flightPanel?.setStatus('The travel time exceeds safe time arithmetic.');return;}
      pendingCapture={view:structuredClone({camera:sync.scene.camera,fov_axis:sync.scene.render.fov_axis}),time:at,id:crypto.randomUUID()};flightPanel?.setStatus('Capturing the current view when the preview is ready…');commitCameraCapture();
    },
    goto(id){pause();fly?.setActive(false);flightPanel?.select(id);const key=sync.scene.cameraFlight&&cameraKeys(sync.scene.cameraFlight).find(k=>k.id===id);if(key)flightSeek(key.time_seconds);},
    update(id){const key=sync.scene.cameraFlight&&cameraKeys(sync.scene.cameraFlight).find(k=>k.id===id);if(!key)return;pause();fly?.setActive(false);pendingCapture={view:structuredClone({camera:sync.scene.camera,fov_axis:sync.scene.render.fov_axis}),time:key.time_seconds,id};commitCameraCapture();},
    remove(id){flightEdit(clip=>deleteCameraKey(clip,id));},retime(id,t){flightEdit(clip=>retimeCameraKey(clip,id,t));flightSeek(t);},segment(id,t){flightEdit(clip=>setCameraSegmentSeconds(clip,id,t));},
    settings(changes){flightEdit(clip=>changeCameraFlight(clip,changes));flightClock.seek(flightClock.time,sync.scene.cameraFlight?.duration_seconds??10);chainPanel.update(sync.view);flightUpdate();},
    interpolation(mode){flightEdit(clip=>({...clip,tracks:[{...clip.tracks[0],interpolation:mode},...propertyTracks(clip)]}));},
    exit(){exitMathematics();},cameraEnabled(enabled){flightEdit(clip=>({...clip,version:Math.max(2,clip.version) as 2|3,tracks:[{...clip.tracks[0],enabled},...propertyTracks(clip)]}));},
    undo(){pause();pendingCapture=undefined;if(sync.undo()){mathematicalDrafts.clear();refreshMathematics();showAll();}},canUndo(){return sync.canUndo;},
  },library.formulas,{
    add(target){
      const binding=bindingFor(sync.view,library.formulas,target);if(!binding)return;
      flightEdit(clip=>withMathematicalTrack(clip,{id:crypto.randomUUID(),kind:'property',enabled:true,target,valueType:binding.valueType,interpolation:binding.valueType==='step'?'step':'smooth',keyframes:[]}));
    },
    value(id,value){if(rendering||picking)return;pause();const track=propertyTracks(sync.scene.cameraFlight).find(t=>t.id===id),binding=track&&bindingFor(sync.view,library.formulas,track.target);if(!track||!binding||!validBindingValue(binding,value)){flightPanel?.setStatus('The value is outside the allowed range of the parameter.');return;}mathematicsActive=true;mathematicalDrafts.set(targetKey(track.target),structuredClone(value));refreshMathematics();chainPanel.update(sync.view);flightTouched=performance.now();quality.touch(flightTouched);flightUpdate();},
    capture(id,keyId){
      pause();const track=propertyTracks(sync.scene.cameraFlight).find(t=>t.id===id),binding=track&&bindingFor(sync.view,library.formulas,track.target);if(!track||!binding)return;
      const old=keyId&&track.keyframes.find(k=>k.id===keyId);
      flightEdit(clip=>putPropertyKey(clip,id,{id:old?old.id:crypto.randomUUID(),time_seconds:old?old.time_seconds:Math.round(flightClock.time*1000)/1000,value:structuredClone(binding.value)}));mathematicsActive=true;mathematicalDrafts.clear();refreshMathematics();flightUpdate();
    },
    change(id,changes){mathematicalDrafts.clear();flightEdit(clip=>{const track=propertyTracks(clip).find(t=>t.id===id);return track?withMathematicalTrack(clip,{...track,...changes}):clip;});chainPanel.update(sync.view);},
    remove(id,keyId){flightEdit(clip=>{const track=propertyTracks(clip).find(t=>t.id===id);return keyId&&track?withMathematicalTrack(clip,{...track,keyframes:track.keyframes.filter(k=>k.id!==keyId)}):{...clip,tracks:[clip.tracks[0],...propertyTracks(clip).filter(t=>t.id!==id)]};});mathematicalDrafts.clear();refreshMathematics();},
    retime(id,keyId,time){flightEdit(clip=>retimePropertyKey(clip,id,keyId,time));flightSeek(time);},seek(t){pause();fly?.setActive(false);flightSeek(t);},
  });
  fly=new FlyCameraControl(document.getElementById('navigation')!,canvas,()=>{pause();orbit.setFromSceneCamera(sync.scene.camera);},()=>!rendering&&!picking&&!sync.scene.composition?.locked);

  const dofPreview = document.createElement("canvas");
  dofPreview.id = "dof-preview";
  dofPreview.hidden = true;
  dofPreview.setAttribute("aria-label", "Progressive framed preview");
  document.body.append(dofPreview);
  let previewAbort: AbortController | null = null;
  const finalPreview = new FinalPreviewController();
  const accumulator = new PreviewAccumulatorWorker();
  let previewGuides:LayerBuffers|null=null;
  let finalEpoch = "",
    accumulatorEpoch = "",
    firstPreviewMs: number | null = null,
    previewStarted = 0,
    lastFinalPass: FinalPreviewPass | null = null,
    profileRequested = false;
  const diagnostics = new PreviewDiagnostics(() => {
    if (quality.mode === "final" && !rendering) {
      profileRequested = true;
      renderedKey = "";
    }
  });
  const cancelDof = () => {
    dofPreview.hidden = true;
    profileRequested = false;
    previewAbort?.abort();
    accumulator.dispose();
    previewGuides=null;
    finalPreview.invalidate();
    diagnostics.invalidate();
  };
  const panelVisibility=new PanelVisibility(document.getElementById('controls')!,document.getElementById('panel-toggle') as HTMLButtonElement,()=>{cancelDof();applyFraming();showRenderSetup?.();quality.touch(performance.now());});
  const compositionViewport=new CompositionViewport(canvas,document.getElementById('controls')!,()=>panelVisibility.hidden,dofPreview,()=>document.getElementById('artist-bar')?.offsetHeight??0);
  // Camera postcards: a tiny picture (128 px wide, WebP) of the current view, made with the engine's own small-render query (the same one as the
  // depth measurement: a few thousand rays, no shader work). It changes nothing in the scene and returns null whenever the engine is busy.
  const captureThumbnail=async(width:number,mime:'image/webp'|'image/png',keepTrial=false):Promise<string|null>=>{
    if(rendering||picking||discoveryGpuActive||gpuLost)return null;
    picking=true;if(!keepTrial)pause(); // a landscape picture shows the trial that is being explored, so it must not end it
    const scene=sync.view;
    try{
      while(previewBusy)await new Promise(resolve=>setTimeout(resolve,16));
      if(scene!==sync.view||rendering)return null;
      await sync.flush();
      if(scene!==sync.view||rendering)return null;
      const height=Math.max(16,Math.round(width*canvas.height/Math.max(1,canvas.width)));
      const layers=await engine.renderLayersToBuffer(width,height,{quality:{samples_per_pixel:1}});
      if(scene!==sync.view||rendering)return null;
      const thumb=document.createElement('canvas');thumb.width=width;thumb.height=height;thumb.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(layers.color),width,height),0,0);
      const url=thumb.toDataURL(mime,0.7);
      return url.startsWith('data:'+mime)?url:null;
    }finally{picking=false;renderedKey='';quality.touch(performance.now());}
  };
  const postcardThumbnail=()=>captureThumbnail(128,'image/webp');
  const cameraEdits=bindPanelUndo(document.getElementById('camera-panel')!,sync);
  const cameraPanel=new CameraPanel(document.getElementById('camera-panel')!,change=>{if(rendering||picking)return;pause();cancelDof();cameraEdits.edit(change);orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);applyFraming();showRenderSetup?.();quality.touch(performance.now());},()=>{if(rendering||picking)return;pause();fly?.setActive(false);const formula=library.formulas.find(f=>f.id===sync.scene.content[0]?.chain[0]?.formula)??library.formulas[0]!;cameraEdits.edit(s=>({...s,camera:createDefaultScene(formula).camera}));orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);},{
    // Frame Fractal (VISUAL-RELIABILITY-01): a proposal from the engine's CPU marcher; the camera changes only on approval, as one undoable step.
    frame:()=>frameFractalAsync(sync.scene,library.formulas,{budgetMs:4000}),
    apply:proposal=>{if(rendering||picking)return;pause();sync.editWithUndo(s=>withFramedCamera(s,proposal));orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);applyFraming();showRenderSetup?.();quality.touch(performance.now());},
    undo:()=>{if(rendering||picking)return;pause();if(sync.undo()){orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);applyFraming();showRenderSetup?.();quality.touch(performance.now());}},
  },{thumbnail:postcardThumbnail});
  new ResizeObserver(()=>{applyFraming();quality.touch(performance.now());}).observe(document.getElementById('controls')!);
  document.getElementById('controls')!.addEventListener('input',cancelDof,{capture:true});
  document.getElementById('controls')!.addEventListener('change',cancelDof,{capture:true});

  // ---- colour panel: gradient, measure, cycles, offset, edges
  for (const g of gradientLib.gradients) gradientSelect.add(new Option(g.name, g.id));
  const gradientEditorRoot = document.createElement('div'); gradientPreview.after(gradientEditorRoot);
  const gradientEditor = new GradientEditor(gradientEditorRoot, g => changeColor({ gradient: g }), refreshUserGradients, active => quality.hold(active,performance.now()),
    // MATERIAL-GRADIENT-01: the same built-in and saved materials as the Material Browser; Colour stops use the scene's own surface values.
    createMaterialSource(desktop ? new MaterialStore() : undefined), () => materialBaseline(sync.scene.material),
    // Choosing a material is one reversible transaction (the same one-step history as presets, Looks and imports).
    { edit: g => { pause(); sync.editWithUndo(s => withColor(s, { gradient: g })); syncColorUI(); showAll(); quality.touch(performance.now()); },
      undo: () => { pause(); if (sync.undo()) showAll(); quality.touch(performance.now()); },
      redo: () => { pause(); if (sync.redo()) showAll(); quality.touch(performance.now()); },
      canUndo: () => sync.canUndo, canRedo: () => sync.canRedo });
  gradientEditor.loadMaterials();
  // The complete material library (built-in, saved, Poly Haven) as a chooser for the selected gradient stop (ARTIST-UI-FIX-01).
  gradientEditor.mountLibraryPicker((root, onPick, onOpen) => {
    new MaterialBrowser(root, () => sync.scene.material, () => {}, undefined, undefined, {
      buttonLabel: 'Choose from the material library…', heading: 'Choose a material for the colour stop', actionLabel: 'Use for the chosen colour stop',
      intro: 'Choose a built-in, saved or Poly Haven material. The whole material with its picture maps is copied into the colour stop and then works without a network. The scene only changes when you press the button, and it can be undone.',
      onPick, onOpen,
    });
  });
  // ARTIST-WORKFLOW 05: "Material från bilden". A click on the picture reads the renderer's own gradient numbers for that surface (the "measure" debug
  // view of the main shader); the edit is a render-only audition tied to the colour (owner "gradientpick"); only Apply writes, as one undo step.
  let materialPickClick: ((clientX: number, clientY: number) => void) | null = null;
  const materialPickRoot = document.createElement('div'); gradientEditorRoot.before(materialPickRoot);
  new MaterialPickPanel(materialPickRoot, {
    scene: () => sync.scene,
    arm(onClick) {
      if (rendering || picking || discoveryGpuActive || gpuLost) return { ok: false, reason: 'Wait until the ongoing work is finished and try again.' };
      if (spotAim.index !== null || spotAim.busy || focusPick.armed || focusPick.busy) return { ok: false, reason: 'End the light target or the focus pick first (Esc).' };
      if (sync.scene.geometryDetail?.enabled) return { ok: false, reason: 'Surface picking is not supported with Geometry Detail.' };
      if (spotAimView() === null) return { ok: false, reason: 'The preview has an older camera or geometry. Wait until the picture is updated.' };
      pause(); flightClock.pause(); fly?.setActive(false); primitivePanel.cancelPlacement();
      materialPickClick = onClick; canvas.style.cursor = 'crosshair';
      return { ok: true };
    },
    disarm() { materialPickClick = null; if (!focusPick.armed && spotAim.index === null) canvas.style.cursor = ''; },
    async sample(clientX, clientY) {
      if (rendering || picking || discoveryGpuActive || gpuLost) return { ok: false, reason: 'Wait until the ongoing work is finished.' };
      if (spotAimView() === null) return { ok: false, reason: 'The picture has changed since it was shown.' };
      const pixel = aimPixel(spotAimRect(), clientX, clientY);
      if (!pixel) return { ok: false, reason: 'Outside the picture area.' };
      picking = true; pause(); cancelDof();
      try {
        while (previewBusy || mainAuxBusy) await new Promise(resolve => setTimeout(resolve, 16));
        await sync.flush();
        if (gpuLost || rendering) throw Error('GPU not available');
        // One pixel of the real picture film, then a small map of the whole picture: the same pass, the same numbers as the shading.
        const x = Math.min(pixel.width - 1, Math.floor(pixel.x)), y = Math.min(pixel.height - 1, Math.floor(pixel.y));
        const one = await engine.renderLayersToBuffer(pixel.width, pixel.height, { region: { x, y, width: 1, height: 1 }, quality: { samples_per_pixel: 1 }, debugView: 'measure' });
        const raw = readMeasure(one);
        if (!raw) return { ok: false, reason: 'No surface was hit where you clicked.' };
        const mw = 96, mh = Math.max(8, Math.round(mw * pixel.height / pixel.width));
        const all = await engine.renderLayersToBuffer(mw, mh, { quality: { samples_per_pixel: 1 }, debugView: 'measure' });
        return { ok: true, raw, map: measureMapOf(all), at: { u: pixel.x / pixel.width, v: pixel.y / pixel.height } };
      } finally { picking = false; renderedKey = ''; quality.touch(performance.now()); }
    },
    begin: (apply, onEnd) => sync.setAudition(apply, onEnd, ['color'], 'gradientpick'),
    end: () => sync.clearAudition(),
    touch: () => { quality.touch(performance.now()); },
    commit: change => { pause(); sync.editWithUndo(change); syncColorUI(); showAll(); quality.touch(performance.now()); },
    highlight: hit => gradientEditor.setHit(hit),
    busy: () => rendering || picking || discoveryGpuActive || gpuLost,
    undo: () => { if (rendering || picking) return false; pause(); const ok = sync.undo(); if (ok) { syncColorUI(); showAll(); } quality.touch(performance.now()); return ok; },
    canUndo: () => sync.canUndo,
  });
  // ARTIST-WORKFLOW 06: "Undersök insidan". One open clipping plane moved through the fractal as a render-only audition tied to the cutout (owner "cutbook");
  // the camera is locked meanwhile; only Apply writes (one undo step). A plane is a uniform: moving it never recompiles a shader.
  const cutbookRoot = document.createElement('div'); document.getElementById('cutout')!.before(cutbookRoot);
  const cutbookPanel = new CutbookPanel(cutbookRoot, {
    scene: () => sync.scene,
    async samplePoints() {
      if (rendering || picking || discoveryGpuActive || gpuLost) return null;
      picking = true; pause(); cancelDof();
      try {
        while (previewBusy || mainAuxBusy) await new Promise(resolve => setTimeout(resolve, 16));
        await sync.flush();
        if (gpuLost || rendering) return null;
        const scene = sync.scene, cols = 64, rows = Math.max(8, Math.round(cols * canvas.height / Math.max(1, canvas.width)));
        const layers = await engine.renderLayersToBuffer(cols, rows, { quality: { samples_per_pixel: 1 }, debugView: 'raw' });
        const points: number[] = [];
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const p = pointFromDepth(scene.camera, scene.render.fov_axis, cols, rows, x + 0.5, y + 0.5, layers.depth[y * cols + x]!);
          if (p) points.push(p[0], p[1], p[2]);
        }
        return Float32Array.from(points);
      } finally { picking = false; renderedKey = ''; quality.touch(performance.now()); }
    },
    begin: (apply, onEnd) => sync.setAudition(apply, onEnd, ['cutout'], 'cutbook'),
    end: () => sync.clearAudition(),
    touch: () => { quality.touch(performance.now()); },
    lock: on => { cutbookLocked = on; if (on) { fly?.setActive(false); flightClock.pause(); } },
    commit: change => { pause(); sync.editWithUndo(change); showAll(); quality.touch(performance.now()); },
    thumbnail: () => captureThumbnail(96, 'image/webp', true),
    thumbnailPng: () => captureThumbnail(224, 'image/png', true),
    busy: () => rendering || picking || discoveryGpuActive || gpuLost,
    undo: () => { if (rendering || picking) return false; pause(); const ok = sync.undo(); if (ok) showAll(); quality.touch(performance.now()); return ok; },
    canUndo: () => sync.canUndo,
    async save(scene, title, notes) { const png = await captureThumbnail(224, 'image/png', true); if (!png) throw Error('The engine is busy. Try again.'); const record = await fractalLibrary.savePreset(scene, png, title, notes); return record.id; },
  });
  cutbookUpdate = () => cutbookPanel.update();
  // ARTIST-WORKFLOW 07: the Personal Discovery Atlas (Kamera tab, beside the camera postcards). Saving reads the scene and a small picture; "Gå dit" is one undo step.
  // Its own settings part ("Upptäcktsatlas") in the camera group, so a collapsed camera panel cannot hide it.
  const atlasRoot = document.createElement('div'); atlasRoot.id = 'atlas-panel'; atlasRoot.className = 'panel'; document.getElementById('camera-flight')!.after(atlasRoot);
  const atlasPanel = new AtlasPanel(atlasRoot, {
    scene: () => sync.scene,
    serialize: scene => serializeScene(scene, library.formulas),
    parse: text => { const parsed = parseScene(text); return parsed.ok ? parsed.scene : null; },
    thumbnail: width => captureThumbnail(width, 'image/webp', true),
    restore: scene => {
      if (rendering || picking || discoveryGpuActive || gpuLost || activeQueueId) return false;
      pause(); cancelDof(); sync.editWithUndo(() => scene);
      orbit.setFromSceneCamera(sync.scene.camera); navigation.update(sync.scene.camera); applyFraming(); showAll(); quality.touch(performance.now());
      return true;
    },
    undo: () => { if (rendering || picking) return false; pause(); const ok = sync.undo(); if (ok) { orbit.setFromSceneCamera(sync.scene.camera); navigation.update(sync.scene.camera); applyFraming(); showAll(); } quality.touch(performance.now()); return ok; },
    busy: () => rendering || picking || discoveryGpuActive || gpuLost || !!activeQueueId,
  });
  atlasUpdate = () => atlasPanel.refresh();
  function allGradients(): Gradient[] { return [...gradientLib.gradients, ...(gradientEditor.presets?.gradients ?? [])]; }
  function refreshUserGradients(): void {
    gradientSelect.querySelectorAll('option[data-user]').forEach(o=>o.remove());
    for (const g of gradientEditor.presets?.gradients ?? []) { const option=new Option('Egen: '+g.name,g.id); option.dataset.user='true'; gradientSelect.add(option); }
  }
  refreshUserGradients();
  for (const m of MEASURES) measureSelect.add(new Option(MEASURE_LABELS[m], m));

  function gradientCss(g: Gradient): string {
    // Colours were checked to be #rrggbb when the file or scene was read. With Material Gradient fields the bar shows the real blend.
    return gradientCssOf(g);
  }

  function syncColorUI(): void {
    const c = sync.scene.color;
    gradientSelect.querySelector(`option[value="${SCENE_OPTION}"]`)?.remove();
    const match = allGradients().find(
      (g) => g.id === c.gradient.id && JSON.stringify(g.stops) === JSON.stringify(c.gradient.stops),
    );
    if (match) gradientSelect.value = match.id!;
    else {
      gradientSelect.add(new Option(`${c.gradient.name ?? "Custom"} (from scene)`, SCENE_OPTION));
      gradientSelect.value = SCENE_OPTION;
    }
    gradientPreview.style.background = gradientCss(c.gradient);
    gradientEditor.update(c.gradient);
    measureSelect.value = c.measure;
    setInputValue(cyclesInput, c.cycles);
    cyclesValue.textContent = c.cycles.toFixed(2);
    setInputValue(offsetInput, c.offset);
    offsetValue.textContent = c.offset.toFixed(2);
    wrapSelect.value = c.wrap;
    const t = c.texture;
    textureName.textContent = t ? (t.name ?? "(picture)") : "none";
    for (const el of [textureClear, textureMapping, textureScale, textureStrength]) el.disabled = !t;
    if (t) {
      textureMapping.value = t.mapping;
      setInputValue(textureScale, t.scale);
      textureScaleValue.textContent = t.scale.toFixed(2);
      setInputValue(textureStrength, t.strength);
      textureStrengthValue.textContent = t.strength.toFixed(2);
    } else {
      textureScaleValue.textContent = "";
      textureStrengthValue.textContent = "";
    }
  }

  // ---- the texture picture: the scene holds it as a data address, the engine needs pixels
  let loadedTexture: string | undefined;
  let textureFailure:unknown;
  let textureWork: Promise<void> = Promise.resolve();

  /** Makes the engine use the picture with this data address (or none). Safe to call often; it only works when the picture changed. */
  function syncTexture(data: string | undefined): Promise<void> {
    if (data === loadedTexture) return textureWork;
    textureWork = textureWork.then(async () => {
      if (data === loadedTexture) return;
      try {
        engine.setTextureImage(data ? await dataUriToImage(data) : null);
        textureFailure=undefined;
      } catch (err) {
        textureFailure=err;
        engine.setTextureImage(null);
        showMessage(`The picture could not be read: ${err instanceof Error ? err.message : String(err)}`);
      }
      loadedTexture = data;
    });
    return textureWork;
  }

  // ---- the environment picture: the scene holds it as a data address, the engine needs numbers
  let loadedEnvironment: string | undefined;
  let environmentFailure:unknown;
  let environmentWork: Promise<void> = Promise.resolve();

  /** Makes the engine use the environment picture with this data address (or none). Only works when the picture changed. */
  function syncEnvironment(data: string | undefined): Promise<void> {
    if (data === loadedEnvironment) return environmentWork;
    environmentWork = environmentWork.then(async () => {
      if (data === loadedEnvironment) return;
      try {
        engine.setEnvironmentImage(data ? dataAddressToImage(data) : null);
        environmentFailure=undefined;
      } catch (err) {
        environmentFailure=err;
        engine.setEnvironmentImage(null);
        showMessage(`The environment picture could not be read: ${err instanceof Error ? err.message : String(err)}`);
      }
      loadedEnvironment = data;
    });
    return environmentWork;
  }

  /** Makes the engine use the pictures of a scene (texture and environment). */
  function syncPictures(scene: Scene,strict=false): Promise<void> {
    const texture=scene.color.texture?.data,environment=scene.environment.kind === "hdri" ? scene.environment.data : undefined;
    return Promise.all([syncTexture(texture),syncEnvironment(environment)]).then(()=>{if(strict&&(loadedTexture!==texture||loadedEnvironment!==environment||textureFailure||environmentFailure))throw Error('The texture/environment of the scene could not be prepared for the thumbnail.');});
  }

  const artistPreview=new ArtistRenderPreview(stillBox,{
    capture(){pause('landscape','stepeffect','gradientpick','cutbook');fly?.setActive(false);return {scene:sync.view,size:outputSize(sync.view.render,windowAspect()),timestamp:flightClock.time};},
    async render(scene,plan,control,roiOnly){
      cancelDof();await acquireDiscoveryGpu(control.signal);
      try{
        control.signal.throwIfAborted();let started=performance.now();await syncPictures(scene,true);control.prepared?.('resources',performance.now()-started);control.signal.throwIfAborted();
        started=performance.now();const ready=await engine.setScene(scene);control.prepared?.('scene',performance.now()-started);control.signal.throwIfAborted();
        if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The frozen scene was replaced.');
        await renderArtistPreview(engine,scene,plan,control,roiOnly);
      }finally{
        try{if(!gpuLost){await syncPictures(sync.view,true);await engine.setScene(sync.view);}}
        finally{releaseDiscoveryGpu();}
      }
    },
  });

  let lookDevCompiling:((on:boolean)=>void)|undefined;
  const lookDev=new LookDevPreview(stillBox,canvas,{
    modeChanged(mode){cancelDof();quality.setMode(mode==='fast'?'automatic':viewportMode.value as ViewportMode);viewportMode.disabled=mode!=='navigation';viewportMode.title=mode!=='navigation'?'Controlled by the chosen view mode. Choose Explore there to change the quality.':'';quality.touch(performance.now());},
    capture(){pause('landscape','stepeffect','gradientpick','cutbook');return {scene:sync.view,size:outputSize(sync.view.render,windowAspect())};},
    film(){return outputSize(sync.view.render,windowAspect());},
    render:(scene,size,options,preparing)=>renderLookPreview(scene,size,options,preparing,true),
    approximate:()=>lookApproximate,
    interactive:{refusal:scene=>interactiveRefusal(scene),run:(scene,width,signal,present)=>progressiveRun(scene,width,signal,present),release:()=>{interactiveShaded=undefined;interactiveKey='';interactiveEngine?.progressiveEnd();}},
    live:{run:(scene,width,signal,present)=>liveRun(scene,width,signal,present),release:()=>releaseLiveEngine()},
    live2:{refusal:scene=>{const result=liveFormula(scene,library.formulas);return result.ok?null:result.errors.join(' ');},run:(scene,width,signal,present)=>live2Run(scene,width,signal,present),release:()=>releaseLive2()},
  });
  lookDevCompiling=(on)=>lookDev.setCompiling(on);

  // ---- PROGRESSIVE-LOOKDEV-07: a picture of up to 16 samples on a dedicated engine (one shader that never changes with the light). The surface of every sample is kept.
  // A change of light, shadow, material or colour draws the kept samples again WITHOUT marching and shows the result from 4 samples on; samples are added while the
  // artist is idle. A new camera, size, formula or geometric parameter starts a new picture. The artist's own engine, scene and the final renderer are never touched.
  let interactiveEngine:GeometryEngine|undefined,interactiveKey='',interactiveTexture:string|undefined,interactiveSky:string|undefined,interactiveShaded:Scene|undefined;
  type ProgressivePresent={rgba:Uint8Array;width:number;height:number;samples:number;target:number;reshaded:boolean;fresh:boolean;gpuMs:number;limits:string[]};
  async function progressiveRun(scene:Scene,width:number,signal:AbortSignal,present:(p:ProgressivePresent)=>void):Promise<void>{
    const film=outputSize(scene.render,windowAspect());
    const request=lookDevRequest(scene,film,{width:width as 512,samples:1,geometry:'normal'},true);
    if(rendering||picking||gpuLost)throw Error('The main rendering is using the graphics card. Try again when it is finished.');
    signal.throwIfAborted();
    interactiveEngine??=await createEngine({geometryCache:true,onDeviceLost:()=>{interactiveEngine=undefined;interactiveKey='';interactiveShaded=undefined;}});
    const eng=interactiveEngine!;
    eng.setFormulas(library.formulas);
    // Only a changed picture is decoded again: the sky and the colour texture are bound resources, not part of the shader.
    const texture=scene.color.texture?.data??'',sky=scene.environment.kind==='hdri'?scene.environment.data??'':'';
    if(texture!==interactiveTexture){eng.setTextureImage(texture?await dataUriToImage(texture):null);interactiveTexture=texture;}
    if(sky!==interactiveSky){eng.setEnvironmentImage(sky?dataAddressToImage(sky):null);interactiveSky=sky;}
    signal.throwIfAborted();
    const ready=await eng.setScene(request.scene);signal.throwIfAborted();
    if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The scene was replaced.');
    const key=surfaceFingerprint(request.scene,request.size.width,film);
    const target=PROGRESSIVE_SAMPLES,limits=interactiveLimits(request.scene);
    const size=request.size,options={quality:request.options.quality as never,referenceFilm:request.options.referenceFilm};
    let emitted=false;
    const emit=(rgba:Uint8Array,samples:number,reshaded:boolean,fresh:boolean,gpuMs:number)=>{emitted=true;present({rgba,width:size.width,height:size.height,samples,target,reshaded,fresh,gpuMs,limits});};
    const info=eng.progressiveInfo();
    const sameSurface=key===interactiveKey&&!!info&&info.width===size.width&&info.height===size.height;
    let action=progressiveAction({sameSurface,shadedWithThisScene:interactiveShaded===scene,kept:info?.kept??0,target});
    if(action==='begin'){
      interactiveKey='';interactiveShaded=undefined;
      eng.progressiveBegin(size.width,size.height,{samples:target,...options});
      interactiveKey=key;interactiveShaded=scene;action='add';
    }
    const fresh=(eng.progressiveInfo()?.kept??0)===0;
    if(action==='reshade'){
      // The light, material or colour changed: the kept samples are drawn again with it, nothing is marched. Nothing is shown before 4 of them are done.
      interactiveShaded=undefined;                                         // until it has finished, the sum is a mixture
      await eng.progressiveReshade({every:reshadeBatch(info!.kept),signal,present:p=>emit(p.rgba,p.done,true,false,p.gpuMs)});
      interactiveShaded=scene;
      action='add';
    }
    // Samples are added while nothing else is asked for (the next change aborts this loop between two samples).
    while(action==='add'){
      const kept=eng.progressiveInfo()!.kept;
      if(kept>=target||signal.aborted)break;
      if(rendering||picking||gpuLost)break;
      const added=await eng.progressiveAdd(1,{signal});
      if(presentAfterAdd(added.count,target)){const picture=await eng.progressivePicture();emit(picture.rgba,added.count,false,fresh,added.gpuMs);}
    }
    // Nothing new to draw (for example when the mode is chosen again): still show the picture that belongs to the scene now, never what another mode left on the screen.
    const keptNow=eng.progressiveInfo()?.kept??0;
    if(!emitted&&keptNow>0&&!signal.aborted&&interactiveShaded===scene){const picture=await eng.progressivePicture();emit(picture.rgba,keptNow,false,false,0);}
  }
  // ---- LIVE-LOOKDEV-17 (trial): its own engine with `liveObjects`, so the shader is built once per formula chain and adding, moving or removing an object only writes data.
  // One small picture (one sample, no denoise) per change; the next change aborts the picture in flight. The window engine, Fast LookDev and the final renderer are never touched.
  let liveEngine:GeometryEngine|undefined,liveTexture:string|undefined,liveSky:string|undefined;
  function releaseLiveEngine(){try{liveEngine?.destroy();}catch{/* already gone */}liveEngine=undefined;liveTexture=undefined;liveSky=undefined;}
  async function liveRun(scene:Scene,width:number,signal:AbortSignal,present:(p:ProgressivePresent)=>void):Promise<void>{
    if(rendering||picking||gpuLost)throw Error('The main rendering is using the graphics card. Try again when it is finished.');
    const film=outputSize(scene.render,windowAspect());
    const request=lookDevRequest(scene,film,{width:width as 512,samples:1,geometry:'normal'},true);
    signal.throwIfAborted();
    liveEngine??=await createEngine({liveObjects:true,onCompile(info){((window as unknown as {__compileLog?:unknown[]}).__compileLog??=[]).push({t:Math.round(performance.now()),engine:'live',phase:info.phase,ms:info.ms,key:info.key});},onDeviceLost:()=>{liveEngine=undefined;liveTexture=undefined;liveSky=undefined;}});
    const eng=liveEngine!;
    eng.setFormulas(library.formulas);
    const texture=scene.color.texture?.data??'',sky=scene.environment.kind==='hdri'?scene.environment.data??'':'';
    if(texture!==liveTexture){eng.setTextureImage(texture?await dataUriToImage(texture):null);liveTexture=texture;}
    if(sky!==liveSky){eng.setEnvironmentImage(sky?dataAddressToImage(sky):null);liveSky=sky;}
    signal.throwIfAborted();
    const ready=await eng.setScene(request.scene);signal.throwIfAborted();
    if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The scene was replaced.');
    const started=performance.now();
    const picture=await eng.renderToBuffer(request.size.width,request.size.height,{...request.options,signal,quality:{...(request.options.quality??{}),samples_per_pixel:1}} as never);
    signal.throwIfAborted();
    present({rgba:new Uint8Array(picture.data.buffer,picture.data.byteOffset,picture.data.byteLength),width:request.size.width,height:request.size.height,samples:1,target:1,reshaded:false,fresh:true,gpuMs:performance.now()-started,limits:['1 sample','no denoise']});
  }
  // ---- LIVE-ARCH-19, Live LookDev 2: the wavefront renderer (engine/liveWave.ts) on its own graphics device. The formula sits in one small shader (rebuilt in a
  // fraction of a second when the formula changes); everything else is data. After a change the first picture is drawn at half size when a full one would take
  // long, then full-size samples are added while nothing changes. The window engine, Fast LookDev and the final renderer are never touched.
  let live2:{device:GPUDevice;wave:LiveWave;code:string;sky:string;texture:string;deepReady:string;deepBuilding:string;deepFailed:string;deepUse:boolean}|undefined,live2FullMs=0,live2CoarseLevel=0,live2CoarseChangedAt=0;
  /** Widths of the coarse picture as a share of the full one. It changes in these steps only, and rarely: a size that changes every picture looks like flicker. */
  const LIVE2_COARSE=[0.5,0.42,0.35,0.25,0.18];
  const LIVE2_SAMPLES=16,LIVE2_SAMPLES_DOF=32,LIVE2_SAMPLES_DEEP=6,LIVE2_QUICK_MS=90;
  const live2Log=(entry:Record<string,unknown>)=>{((window as unknown as {__compileLog?:unknown[]}).__compileLog??=[]).push({t:Math.round(performance.now()),engine:'live2',...entry});};
  function releaseLive2(){const gone=live2;live2=undefined;try{gone?.wave.destroy();gone?.device.destroy();}catch{/* already gone */}}
  /**
   * Finds the surface under a point of the picture. In Live LookDev 2 the renderer's own small trace kernel does it (no shader build); otherwise, and when that
   * kernel is not ready for the current scene, the window engine does it as before (its picking shader holds the whole formula and can take a long time to build).
   */
  async function pickSurface(width:number,height:number,x:number,y:number,excludeId?:string):Promise<import('../engine/primitives').SceneHit|null>{
    const own=live2;
    if(lookDev.isLive2&&own?.wave.hasFormula){
      const formula=liveFormula(sync.scene,library.formulas);
      if(formula.ok&&formula.wgsl===own.code)return own.wave.pick(formula.resolved,sync.scene.render.quality,x/width,y/height,excludeId);
    }
    return engine.pickSurface(width,height,x,y,excludeId);
  }
  async function live2Run(scene:Scene,width:number,signal:AbortSignal,present:(p:ProgressivePresent)=>void):Promise<void>{
    if(rendering||gpuLost)throw Error('The main rendering is using the graphics card. Try again when it is finished.');
    const film=outputSize(scene.render,windowAspect());
    const request=lookDevRequest(scene,film,{width:width as 512,samples:1,geometry:'normal'},true);
    const {width:w,height:h}=request.size;
    const formula=liveFormula(request.scene,library.formulas);
    if(!formula.ok)throw Error(formula.errors.join('; '));
    // The renderer is made once for a picture up to this size and keeps its shaders when the picture format changes (a wider or lower picture fits inside it);
    // only a bigger picture than ever before makes a new one. It is square at first, so ordinary changes of format never do.
    const capW=Math.max(w,live2?.wave.maxWidth??0),capH=Math.max(h,w,live2?.wave.maxHeight??0);
    if(!live2||live2.wave.maxWidth<w||live2.wave.maxHeight<h){
      releaseLive2();
      const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
      if(!adapter)throw Error('The graphics card could not be used (WebGPU is missing).');
      const device=await adapter.requestDevice();
      const wave=new LiveWave(device,capW,capH);await wave.init();
      const mine={device,wave,code:'',sky:'',texture:'',deepReady:'',deepBuilding:'',deepFailed:'',deepUse:false};live2=mine;live2FullMs=0;
      void device.lost.then(()=>{if(live2===mine)live2=undefined;});
      live2Log({phase:'end',key:'live2 permanent shading kernels',ms:wave.shadeBuildMs});
    }
    const own=live2!,wave=own.wave;signal.throwIfAborted();
    if(own.code!==formula.wgsl){wave.deepOn=false;own.deepUse=false;own.deepReady='';own.deepFailed='';const ms=await wave.setFormula(formula.wgsl);own.code=formula.wgsl;live2Log({phase:'end',key:'live2 trace kernel',ms});}
    const sky=request.scene.environment.kind==='hdri'?request.scene.environment.data??'':'';
    if(sky!==own.sky){wave.setEnvironment(sky?dataAddressToImage(sky):null);own.sky=sky;}
    // the scene's own textures: the colour picture of the Colour tab and the texture maps of the materials (a picture upload, never a shader build)
    const colourPicture=request.scene.color.texture?.data??'';
    if(colourPicture!==own.texture){wave.setColorTexture(colourPicture?await dataUriToImage(colourPicture):null);own.texture=colourPicture;}
    const atlasWarnings=await wave.prepareSurfaces(request.scene);
    signal.throwIfAborted();
    signal.throwIfAborted();
    const quality={...request.scene.render.quality,...(request.options.quality??{})} as Scene['render']['quality'];
    const reflections=request.scene.reflections;
    wave.setState({shadows:true,bounces:liveBounces(formula.resolved.scene)});
    let target=request.scene.camera.dof?.enabled?LIVE2_SAMPLES_DOF:LIVE2_SAMPLES; // a blur needs more samples to become smooth
    const limits=['simplified lighting',...(request.scene.denoise?.enabled?[]:['no denoise']),...liveUnsupported(request.scene),...atlasWarnings.map(()=>'textures reduced')];
    // Deep precision (double-single numbers) was used for the last picture: keep it while the formula and its numbers are the same one it was built for.
    wave.deepOn=false;
    if(own.deepUse){const kept=liveDeep(formula.resolved,formula.wgsl);if(kept.ok&&own.deepReady===kept.code){wave.deepOn=true;wave.setState({bounces:0});}}
    const show=async(samples:number,started:number,late=false)=>{const rgba=await wave.picture();if(signal.aborted&&!late)return;present({rgba,width:wave.width,height:wave.height,samples,target,reshaded:false,fresh:true,gpuMs:performance.now()-started,limits});};
    if(live2FullMs>LIVE2_QUICK_MS){
      // the answer to a change comes at once from a coarse picture (half the width, fewer pixels when that is still slow), the full picture follows
      const coarse=LIVE2_COARSE[live2CoarseLevel]!;
      wave.resize(Math.round(w*coarse),Math.round(h*coarse));wave.setScene(formula.resolved,quality);
      const started=performance.now(),coarseMs=await wave.draw();await show(1,started,true); // shown even if a newer change has arrived meanwhile (see the preview)
      {const now=performance.now();if(now-live2CoarseChangedAt>600){const lower=coarseMs>42&&live2CoarseLevel<LIVE2_COARSE.length-1,higher=coarseMs<22&&live2CoarseLevel>0;if(lower||higher){live2CoarseLevel+=lower?1:-1;live2CoarseChangedAt=now;}}}
      if(signal.aborted)return;
      // While the artist keeps moving (a camera drag, a slider) only coarse pictures are drawn; the full picture follows once things have been quiet for a moment
      // (and is drawn in bands that can be given up within about 40 ms, so a move that comes meanwhile is not kept waiting).
      for(let k=0;k<5&&!signal.aborted;k++)await new Promise(resolve=>setTimeout(resolve,16));
      if(signal.aborted)return;
    }
    wave.resize(w,h);wave.setScene(formula.resolved,quality);
    // too close for 32-bit numbers? Then the picture stops changing, and the label says why (the final renderer has the same limit)
    const centre=await wave.pick(formula.resolved,quality,0.5,0.5);
    if(centre){
      const floor=floatFloor(centre.position,quality),near=centre.distance<DEEP_FLOORS_BUILD*floor;
      let deepWanted=false,building=false,noDeep='';
      if(near){
        const deep=liveDeep(formula.resolved,formula.wgsl);
        if(!deep.ok)noDeep=deep.reason;
        else if(own.deepReady===deep.code)deepWanted=centre.distance<DEEP_FLOORS_USE*floor||(wave.deepOn&&centre.distance<DEEP_FLOORS_DROP*floor);
        else if(own.deepFailed===deep.code)noDeep='the kernel could not be built';
        else{
          building=true;
          if(own.deepBuilding!==deep.code){ // built in the background: the ordinary kernel goes on drawing meanwhile
            own.deepBuilding=deep.code;const code=deep.code;
            void wave.setDeepFormula(code,deep.iterations).then(ms=>{if(live2!==own)return;own.deepReady=code;own.deepBuilding='';live2Log({phase:'end',key:'live2 deep kernel',ms});lookDev.redraw();}).catch(()=>{if(live2!==own)return;own.deepFailed=code;own.deepBuilding='';});
          }
        }
      }
      own.deepUse=deepWanted;
      if(deepWanted!==wave.deepOn){wave.deepOn=deepWanted;wave.setState({bounces:deepWanted?0:liveBounces(formula.resolved.scene)});wave.setScene(formula.resolved,quality);}
      if(deepWanted){
        // double-single numbers cost about ten times as much: half the width (a quarter of the pixels) and fewer samples keep a picture to a second or two
        wave.resize(Math.round(w/2),Math.round(h/2));wave.setScene(formula.resolved,quality);target=Math.min(target,LIVE2_SAMPLES_DEEP);
        limits.push('deep precision (double)');if(atDeepLimit(centre.distance,centre.position))limits.push('precision limit reached (even with double precision)');}
      else if(building)limits.push(atPrecisionLimit(centre.distance,centre.position,quality)?'precision limit reached (32-bit numbers): deep precision is being built':'deep precision is being built');
      else if(noDeep&&atPrecisionLimit(centre.distance,centre.position,quality))limits.push('precision limit reached (32-bit numbers): '+(/Unsupported|requires|unvalidated/.test(noDeep)?'this formula lacks deep precision':noDeep));
      else if(atPrecisionLimit(centre.distance,centre.position,quality))limits.push('precision limit reached (32-bit numbers): back off a little');
    }
    for(let i=1;i<=target;i++){
      if(signal.aborted)return;
      const started=performance.now(),ms=await wave.draw(signal);
      if(ms<0||signal.aborted)return; // given up between two bands
      if(i===1)live2FullMs=ms;
      if(i<=4||i%2===0)await show(i,started);
      await new Promise(resolve=>setTimeout(resolve,0)); // let the window handle the artist's next change before another sample is drawn
    }
  }
  let lookApproximate=false;
  /** LOOKDEV-05B: while the exact picture shader is being built, LookDev draws the new light with the shader that is ready, says so, and redraws when the exact one is. */
  async function renderLookPreview(scene:Scene,size:{width:number;height:number},options:import('../engine/engine').RenderOptions,preparing:(text:string)=>void,allowApproximation=false){
      const lt=[performance.now()];
      cancelDof();await acquireDiscoveryGpu(options.signal!);lt.push(performance.now());
      lookApproximate=false;
      try{
        options.signal!.throwIfAborted();await syncPictures(scene,true);lt.push(performance.now());
        if(scene.geometryDetail?.enabled){const unavailable=geometryUnavailable(scene,library.formulas);if(unavailable)throw Error(unavailable);}
        const renderer=await stillEngineFor(scene);
        let drawn=scene;
        if(allowApproximation&&renderer===engine&&!engine.isReady(scene)){
          const rough=withoutLookCode(scene);
          if(rough!==scene&&engine.isReady(rough)){
            drawn=rough;lookApproximate=true;
            void engine.prepareScene(scene).then(r=>{if(!r.errors.length)lookDev.exactReady();});
          }
        }
        preparing(lookApproximate?'Drawing an approximation while the exact shader is built…':'Preparing / compiling the still-picture pipeline when needed…');
        const ready=await renderer.setScene(drawn);options.signal!.throwIfAborted();lt.push(performance.now());
        if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The scene was replaced.');
        preparing('Rendering still picture…');
        const picture=await renderer.renderToBuffer(size.width,size.height,options);lt.push(performance.now());
        return picture;
      }finally{
        try{
          if(!gpuLost){
            await syncPictures(sync.view,true);
            const view=sync.view;
            // The window engine goes back to the artist's scene. If that needs a shader that is not built yet, build it in the background instead of waiting for it here:
            // waiting held the graphics card and the finished picture for a minute.
            if(warmupEligible(view)&&!engine.isReady(view))void engine.prepareScene(view);
            else await engine.setScene(view);
          }
        }
        finally{releaseDiscoveryGpu();lt.push(performance.now());((window as unknown as {__compileLog?:unknown[]}).__compileLog??=[]).push({t:Math.round(performance.now()),engine:'look',phase:'look timing ms [lease,sync,setScene,render,restore] '+size.width+'px viewportFramesStarted='+(canvas.dataset.previewStarted??'0')+' busy='+(canvas.dataset.previewBusy??''),steps:lt.slice(1).map((v,i)=>Math.round(v-lt[i]!))});}
      }
    }
  new ResizeObserver(()=>{applyFraming();quality.touch(performance.now());}).observe(document.getElementById('preview-access')!);
  let lookbookApplied:Scene|undefined;
  const lookbook=new ArtistLookbook(document.getElementById('preview-access')!,{
    current:()=>sync.view,
    capture(){
      if(rendering||picking||gpuLost)throw Error('Wait until the ongoing work is finished.');
      if(sync.auditioning)throw Error('Finish or use your ongoing material/Look audition first.');
      pause();fly?.setActive(false);
      return {scene:sync.view,film:outputSize(sync.view.render,windowAspect())};
    },
    async render(scene,size,options){await lookDev.yieldToOutput();return renderLookPreview(scene,size,options,()=>{});},
    apply(lights){
      if(rendering||picking||discoveryGpuActive||gpuLost)throw Error('The renderer is busy. Try again when it is finished.');
      if(spotAim.index!==null||spotAim.busy||focusPick.armed||focusPick.busy)throw Error('End the light target or the focus pick first (Esc).');
      pause();sync.editWithUndo(s=>({...s,lights:structuredClone(lights)}));lookbookApplied=sync.scene;showAll();quality.touch(performance.now());
    },
    canUndo:()=>lookbookApplied===sync.scene&&sync.canUndo,
    undo(){if(rendering||picking||discoveryGpuActive||lookbookApplied!==sync.scene)return false;pause();const ok=sync.undo();if(ok){lookbookApplied=undefined;showAll();quality.touch(performance.now());}return ok;},
  });

  // ---- AI bridge (MCP-01). Optional and OFF until the artist switches it on in the "AI-brygga" panel.
  // The AI edits and previews separate DRAFTS freely; the live scene changes only through the artist's "Använd" (one reversible transaction).
  if (aiHost) {
    const memory = aiHost.knowledge;
    const aiService = new AppService({
      scene: () => sync.scene,
      formulas: () => library.formulas,
      materials: createMaterialSource(desktop ? new MaterialStore() : undefined),
      applyToLive(scene) { pause(); sync.editWithUndo(() => scene); showAll(); quality.touch(performance.now()); },
      // The same path as a LookDev still (lookDevRequest: 512 px, Geometry Detail off), on a draft scene, one at a time under the GPU lock.
      compose: composeSideBySide,
      persistence: aiHost.drafts,
      // Read-only window onto the artist's saved artworks. The service gets a COPY of a scene and can never write to the library.
      // Poly Haven for the AI: the same validated operations as the artist's tab, reachable only while the artist has allowed it for this session (the service checks).
      polyHaven: desktop?.polyHaven ? {
        async search(q) { const r = await desktop!.polyHaven!('page', { query: q.query, category: q.category, limit: q.limit }); return { total: r.total, items: r.items }; },
        async import(id, resolution) { const m = await importPolyHavenMaterial((op, ...a) => desktop!.polyHaven!(op, ...a), new MaterialStore(), id, resolution); return { materialId: m.materialId, title: m.title, status: m.status, source: m.source }; },
      } : undefined,
      artworks: {
        async list(query, offset, limit) {
          const store = new DiscoveryLibraryStore();
          const out: { id: string; title: string; type: string }[] = []; let total = 0;
          for (const type of ['preset', 'legacy-variation']) {
            const page = await store.page(query, type, 0, 1000);
            for (const m of page.entries) { if (total >= offset && out.length < limit) out.push({ id: m.id, title: m.title, type: m.type }); total++; }
          }
          return { total, items: out };
        },
        async scene(id) {
          const record = await new DiscoveryLibraryStore().get(id);
          const payload = record?.payload as { kind?: string; scene?: Scene } | undefined;
          if (!record || !payload || (payload.kind !== 'preset' && payload.kind !== 'legacy-variation') || !payload.scene) return null;
          return { scene: structuredClone(payload.scene), title: record.title };
        },
      },
      async render(scene, { samples, width, signal }) {
        const started = performance.now();
        const request = lookDevRequest(scene, outputSize(scene.render, windowAspect()), { width, samples, geometry: 'normal' });
        cancelDof(); await acquireDiscoveryGpu(signal);
        try {
          signal.throwIfAborted(); await syncPictures(request.scene, true);
          const renderer = await stillEngineFor(request.scene);
          const ready = await renderer.setScene(request.scene); signal.throwIfAborted();
          if (ready.errors.length || ready.superseded) throw Error(ready.errors.join('; ') || 'The scene was replaced.');
          const image = await renderer.renderToBuffer(request.size.width, request.size.height, { ...request.options, signal });
          return { base64: pngBase64(image), mime: 'image/png' as const, width: image.width, height: image.height, ms: performance.now() - started, metrics: previewMetrics(image.data, image.width, image.height) };
        } finally {
          try { if (!gpuLost) { await syncPictures(sync.view, true); await engine.setScene(sync.view); } } finally { releaseDiscoveryGpu(); }
        }
      },
      // FORMULA-EXPLORATION-01: the compact experiment memory (local file in the profile; records hold no pictures or conversation).
      knowledge: {
        async experiments() { const out: ExperimentRecord[] = []; for (const line of await memory.list()) { try { const r = parseRecord(JSON.parse(line)); if (r) out.push(r); } catch { /* skipped */ } } return out; },
        async record(r) { await memory.append(JSON.stringify(r)); },
      },
    });
    // "Skapa med AI" is its own tab (AI-studio) in the sidebar. The elements are created here and moved there by the artist shell, which only
    // shows or hides them, so switching tabs never rebuilds the chat, the previews or the approval step.
    const dock = document.createElement('aside');
    dock.id = 'ai-dock'; dock.hidden = true; dock.setAttribute('aria-label', 'AI-studio');
    const dockBody = document.createElement('div'); dockBody.className = 'ai-dock-body';
    dock.append(dockBody);
    document.body.append(dock);
    const chatRoot = document.createElement('div'); dockBody.append(chatRoot);
    // ARTIST-WORKFLOW 07: the artist drags a rectangle on the picture; the part under it is cut out as a small JPEG (one pass of the engine over just that
    // region, at most about 512 px on its long side) and goes along with the next message. Nothing is changed in the scene.
    const regionSelector = new RegionSelector();
    new AiChatPanel(chatRoot, aiHost, aiService, {
      async select() {
        if (rendering || picking || discoveryGpuActive || gpuLost) return { error: 'Wait until the ongoing work is finished.' };
        const view = spotAimView();
        if (view === null) return { error: sync.scene.geometryDetail?.enabled ? 'Region picking is not supported with Geometry Detail.' : 'The preview is older than the scene. Wait until the picture is updated.' };
        const region = await regionSelector.select(view);
        if (!region) return null;
        if (rendering || picking || discoveryGpuActive || gpuLost) return { error: 'Wait until the ongoing work is finished.' };
        picking = true; pause(); cancelDof();
        try {
          while (previewBusy || mainAuxBusy) await new Promise(resolve => setTimeout(resolve, 16));
          await sync.flush();
          if (gpuLost || rendering) return { error: 'GPU not available.' };
          const film = view.film ?? { width: canvas.width, height: canvas.height };
          const k = Math.min(1, 512 / Math.max((region.u1 - region.u0) * film.width, (region.v1 - region.v0) * film.height));
          const fw = Math.max(16, Math.round(film.width * k)), fh = Math.max(16, Math.round(film.height * k));
          const x = Math.min(fw - 4, Math.floor(region.u0 * fw)), y = Math.min(fh - 4, Math.floor(region.v0 * fh));
          const w = Math.max(4, Math.min(fw - x, Math.round((region.u1 - region.u0) * fw))), h = Math.max(4, Math.min(fh - y, Math.round((region.v1 - region.v0) * fh)));
          const layers = await engine.renderLayersToBuffer(fw, fh, { region: { x, y, width: w, height: h }, quality: { samples_per_pixel: 1 } });
          const cut = document.createElement('canvas'); cut.width = layers.width; cut.height = layers.height;
          cut.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(layers.color), layers.width, layers.height), 0, 0);
          const base64 = cut.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
          if (base64.length < 100) return { error: 'The area could not be read.' };
          return { region, crop: { mime: 'image/jpeg', base64 } };
        } finally { picking = false; renderedKey = ''; quality.touch(performance.now()); }
      },
    });
    const aiRoot = document.createElement('div'); dockBody.append(aiRoot);
    new AiPanel(aiRoot, aiService, aiHost);
    // Drafts saved by an earlier run come back first; nothing is applied (the artist decides in the panel).
    const host = aiHost;
    void aiService.restore().finally(() => connectAiBridge(host, aiService));
    addEventListener('beforeunload', () => { void aiService.flush(); });
  }

  function changeColor(changes: Partial<ColorSettings>): void {
    pause();
    colorEdits.edit((s) => withColor(s, changes));
    syncColorUI();
  }

  gradientSelect.addEventListener("change", () => {
    const g = allGradients().find((x) => x.id === gradientSelect.value);
    if (g) changeColor({ gradient: { id: g.id, name: g.name, stops: g.stops.map(({position,color})=>({position,color})) } });
  });
  measureSelect.addEventListener("change", () => changeColor({ measure: measureSelect.value as Measure }));
  wrapSelect.addEventListener("change", () => changeColor({ wrap: wrapSelect.value as ColorSettings["wrap"] }));
  cyclesInput.addEventListener("input", () => {
    pause();
    colorEdits.edit((s) => withColor(s, { cycles: readNumber(cyclesInput) }));
    cyclesValue.textContent = readNumber(cyclesInput).toFixed(2);
  });
  offsetInput.addEventListener("input", () => {
    pause();
    colorEdits.edit((s) => withColor(s, { offset: readNumber(offsetInput) }));
    offsetValue.textContent = readNumber(offsetInput).toFixed(2);
  });

  textureFile.addEventListener("change", async () => {
    const file = textureFile.files?.[0];
    textureFile.value = "";
    if (!file) return;
    try {
      const picked = await fileToTexture(file);
      pause();
      const old = sync.scene.color.texture;
      changeColor({
        texture: { name: picked.name, data: picked.data, mapping: old?.mapping ?? "triplanar", scale: old?.scale ?? 1, strength: old?.strength ?? 1 },
      });
    } catch (err) {
      showMessage(`The picture could not be used: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  textureClear.addEventListener("click", () => {
    pause();
    sync.edit((s) => {
      const { texture: _removed, ...rest } = s.color;
      return { ...s, color: rest };
    });
    syncColorUI();
  });
  const changeTexture = (changes: Partial<NonNullable<ColorSettings["texture"]>>): void => {
    const t = sync.scene.color.texture;
    if (!t) return;
    pause();
    colorEdits.edit((s) => withColor(s, { texture: { ...t, ...changes } }));
  };
  textureMapping.addEventListener("change", () => {
    changeTexture({ mapping: textureMapping.value === "spherical" ? "spherical" : "triplanar" });
  });
  textureScale.addEventListener("input", () => {
    textureScaleValue.textContent = readNumber(textureScale).toFixed(2);
    changeTexture({ scale: readNumber(textureScale) });
  });
  textureStrength.addEventListener("input", () => {
    textureStrengthValue.textContent = readNumber(textureStrength).toFixed(2);
    changeTexture({ strength: readNumber(textureStrength) });
  });

  /** Shows the scene's image format in the render panel. Set once the panel exists. */
  let showRenderSetup: (() => void) | null = null;
  /** Updates what changes while playing: chain values, colour, camera and the timeline. Does not rebuild anything. */
  function syncLive(): void {
    chainPanel.update(sync.view);
    syncColorUI();
    orbit.setFromSceneCamera(sync.scene.camera);
    navigation.update(sync.scene.camera);
    animationPanel.update(sync.scene, time, playing, timingNote);
    flightUpdate();
    showRenderSetup?.();
    showFog?.();
    showFractalDisplacement?.();
    showEnvironment?.();
    showMaterial?.();
    primitivePanel.update(sync.scene);
    renderDetailsPanel.update(sync.scene);
    showLights?.();
    primitivePanel.update(sync.scene);
  }

  /** Brings every part of the page in line with the scene. */
  function showAll(): void {
    landscapeUpdate?.();
    cutbookUpdate?.();
    atlasUpdate?.();
    for(const d of sync.scene.discoveredFormulas??[])discoveredSources.set(d.id,d);
    const combined=synthesizedLibrary(sync.scene.discoveredFormulas,library.formulas);for(const f of combined)if(!library.formulas.some(x=>x.id===f.id))library.formulas.push(f);engine.setFormulas(library.formulas);
    const used = new Set(sync.scene.content[0]?.chain.map((s) => s.formula));
    showCredits(library.formulas.filter((f) => used.has(f.id)));
    time = Math.min(time, sync.scene.animation.duration_seconds);
    flightClock.seek(flightClock.time,sync.scene.cameraFlight?.duration_seconds??10);
    applyFraming(); // an opened scene brings its own image format
    syncLive();
  }

  saveButton.addEventListener("click", async () => {
    const text = geo8Artist?.serialize(serializeScene(sync.scene, library.formulas))??serializeScene(sync.scene, library.formulas);
    if(desktop){try{const result=await desktop.saveScene(text);if(result.saved)showMessage('The scene is saved: '+result.saved);}catch(error){showMessage('The scene could not be saved: '+String(error));}return;}
    const blob = new Blob([text], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fraktal.scene.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  async function openSceneText(text:string,name:string) {
    if(activeQueueId){showMessage('Pause the render queue before changing the scene.');return;}
    settlePendingInput(); // a half-typed field commits to the scene it was typed in, not to the one being opened (B3)
    let envelope;try{envelope=geo8Host?readGeo8Document(JSON.parse(text)):undefined;}catch(e){showMessage(String(e));return;}
    const parsed = parseScene(envelope?envelope.scene:text);
    if(parsed.ok){const diagnostic=mathematicalTrackDiagnostics(parsed.scene,library.formulas);if(diagnostic.errors.length){showMessage(diagnostic.errors.join('\n'));return;}}
    if(!parsed.ok){showMessage([`${name} is not a valid scene:`,...parsed.errors].join('\n'));return;}
    geo8Artist?.setDocument(envelope);
    pause();time=0;mathematicsActive=false;mathematicalDrafts.clear();sync.setEvaluation();flightClock.stop();flightPanel?.reset();pendingCapture=undefined;fly?.setActive(false);
    sync.replace(parsed.scene);showAll(); // clears Undo/Redo of the previous scene (B2)scheduleTiming();if(parsed.warnings.length)showMessage(['Varning:',...parsed.warnings].join('\n'));
  }
  desktop?.onScene(data=>void openSceneText(data.text,data.name));
  const desktopHost=desktop;
  desktopHost?.onMenu(name=>{if(name==='feedback'){void openFeedbackDialog();return;}if(activeQueueId&&name!=='status'&&name!=='gpu-lost'){showMessage('Pause the render queue before other scene actions.');return;}const button=(title:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===title);if(name==='materials')button('Materialbibliotek…')?.click();else if(name==='save')saveButton.click();else if(name==='open')void desktopHost.openScene().then(data=>data&&openSceneText(data.text,data.name)).catch(e=>showMessage(String(e)));else if(name==='library')button('My fractals')?.click();else if(name==='import'||name==='export'){button('My fractals')?.click();button(name==='import'?'Import library':'Export library')?.click();}else if(name==='status')void desktopHost.info().then(info=>showMessage(`NOEMA Fractal ${info.version}\n${gpuDescription}\nLibrary: ${info.folder}\nWebGPU: ${info.features.webgpu}`));else if(name==='gpu-lost'){queueAbort?.abort();gpuLost=true;showMessage('The GPU process was interrupted. Save the scene and open the app again.');}});
  if(desktopHost){const label=openInput.closest('label');label?.addEventListener('click',event=>{event.preventDefault();void desktopHost.openScene().then(data=>data&&openSceneText(data.text,data.name)).catch(e=>showMessage(String(e)));});}
  openInput.addEventListener("change", async () => {
    const file = openInput.files?.[0];
    openInput.value = "";
    if (!file) return;
    await openSceneText(await file.text(),file.name);
  });

  // ---- image format: the preview shows exactly the framing of the final picture
  const windowAspect = (): number => compositionViewport.aspect();

  /** Sizes the drawing area to the chosen format (centred, with an outline), or to the whole window for "free". */
  function applyFraming(): void {
    compositionViewport.update(sync.scene);
    cameraPanel.update(sync.scene,windowAspect());
    showDof?.();
  }
  window.addEventListener("resize", () => {
    cancelDof();quality.touch(performance.now());
    applyFraming();
    showRenderSetup?.();
  });

  const formatPanel = new FormatPanel(formatBox, {
    onSetup(setup) {
      pause();
      // The panel only knows format, size and field of view; the detail values stay as they are.
      sync.edit((s) => ({ ...s, render: { ...setup, quality: s.render.quality } }));
      applyFraming();
      showRenderSetup?.();
    },
  });

  // ---- still picture mode: detail controls and the final render of one picture
  let previewDetail = false;
  /** The debug view of the preview and the cut-out. Not part of the scene. */
  let debugView: DebugView = "off";

  /** The size of the picture and the vertical field of view it is drawn with. */
  function pictureGeometry(scene: Scene): { width: number; height: number; verticalFov: number } {
    const { width, height } = outputSize(scene.render, windowAspect());
    return { width, height, verticalFov: verticalFovDegrees(cameraFov(scene.camera,scene.render.fov_axis,width,height), scene.render.fov_axis, width, height) };
  }

  /** Ready-made detail values. The hit precision follows the picture's height (see suggestedHitPrecision). */
  function presetValues(id: string): Partial<QualitySettings> | null {
    const g = pictureGeometry(sync.scene);
    const auto = suggestedHitPrecision(g.verticalFov, g.height);
    const round = (x: number): number => Math.max(1e-7, Number(x.toPrecision(2)));
    const fine = (hit: number, samples: number, step: number, steps: number, shadowSteps: number, hitPixels: number): Partial<QualitySettings> => ({
      samples_per_pixel: samples,
      shadow_steps: shadowSteps,
      precision_mode: "pixel",
      hit_pixels: hitPixels,
      normal_pixels: 1,
      hit_precision: round(hit),
      step_factor: step,
      max_steps: steps,
      normal_epsilon: round(hit * 2),
    });
    switch (id) {
      case "fast":
        return { ...defaultQuality(), seed: sync.scene.render.quality.seed };
      case "good":
        return fine(auto, 4, 0.75, 1000, 64, 0.5);
      case "high":
        return fine(auto * 0.5, 16, 0.5, 4000, 128, 0.25);
      case "extreme":
        return fine(auto * 0.25, 64, 0.3, 12000, 256, 0.1);
      default:
        return null;
    }
  }

  const stillEdits = bindPanelUndo(stillBox, sync);
  const stillPanel = new StillPanel(stillBox, {
    onQuality(changes) {
      pause();
      stillEdits.edit((s) => ({ ...s, render: withQuality(s.render, changes) }));
      showRenderSetup?.();
    },
    onAutoPrecision() {
      const g = pictureGeometry(sync.scene);
      const hit = suggestedHitPrecision(g.verticalFov, g.height);
      pause();
      sync.edit((s) => ({ ...s, render: withQuality(s.render, { hit_precision: hit, normal_epsilon: Math.max(1e-7, Number((hit * 2).toPrecision(2))) }) }));
      showRenderSetup?.();
      stillPanel.setStatus(`Hit precision is set to ${hit} for a picture that is ${g.height} pixels high.`);
    },
    onPreset(id) {
      const values = presetValues(id);
      if (!values) return;
      pause();
      stillEdits.edit((s) => ({ ...s, render: withQuality(s.render, values) }));
      showRenderSetup?.();
    },
    onPreviewDetail(on) {
      previewDetail = on;
      quality.setMode(on ? 'final' : 'automatic');
      viewportMode.value = quality.mode;
      showLights?.();
    },
    onDebugView(view) {
      debugView = view;
      engine.setDebugView(view);
    },
    onCropPreview: () => void runCropPreview(),
    onSelectiveGd: () => void runSelectiveGd(),
    onRender: () => void runStill(),
    onCancel: () => cancelRender?.(),
  });

  // INTELLIGENT-RENDERING-01: quality levels (geometry, antialiasing and shadows chosen separately, plus ready-made combinations).
  const qualityLevels = new QualityLevelsPanel({
    quality: () => sync.scene.render.quality,
    apply(values) { pause(); sync.editWithUndo((s) => ({ ...s, render: withQuality(s.render, values) })); showRenderSetup?.(); },
  });
  stillBox.prepend(qualityLevels.root);
  // INTELLIGENT-RENDERING-02: progressive stills (real renders of rising quality shown over the viewport; a change of camera or scene cancels).
  async function withProgressiveEngine<T>(scene:Scene,signal:AbortSignal,body:(engine:GeometryEngine)=>Promise<T>):Promise<T>{
    await lookDev.yieldToOutput();cancelDof();await acquireDiscoveryGpu(signal);
    try{
      signal.throwIfAborted();await syncPictures(scene,true);
      const plain=scene.geometryDetail?.enabled?{...scene,geometryDetail:{...scene.geometryDetail,enabled:false}}:scene;
      const ready=await engine.setScene(plain);signal.throwIfAborted();
      if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The scene was replaced.');
      return await body(engine);
    }finally{
      try{if(!gpuLost){await syncPictures(sync.view,true);await engine.setScene(sync.view);}}
      finally{releaseDiscoveryGpu();}
    }
  }
  const progressive=new ProgressiveStill({
    capture(){
      if(shellBusy())throw Error('Wait until the ongoing work is finished.');
      pause();fly?.setActive(false);
      return {scene:sync.view,film:outputSize(sync.view.render,windowAspect())};
    },
    withEngine:withProgressiveEngine,
    advise:(engine,scene,film,signal)=>floorAdvice(engine,scene,film,signal,true),
    current:()=>sync.view,
  },canvas);
  // DETAIL-LOOKDEV-03B: Detaljvy, any rectangle of the final picture at true 1:1 pixels, refined progressively; only the rectangle is drawn.
  const gdSceneOf=(scene:Scene):Scene=>({...scene,geometryDetail:{...DEFAULT_GEOMETRY_DETAIL,...(scene.geometryDetail??{}),enabled:true}});
  const detailView=new DetailViewPanel({
    capture(){
      if(shellBusy())throw Error('Wait until the ongoing work is finished.');
      pause();fly?.setActive(false);
      return {scene:sync.view,film:outputSize(sync.view.render,windowAspect())};
    },
    withEngine:withProgressiveEngine,
    current:()=>sync.view,
    filmOf:scene=>outputSize(scene.render,windowAspect()),
    gdUnavailable:scene=>geometryUnavailable(gdSceneOf(scene),library.formulas)??null,
    async drawGd(scene,rect,film,signal,onProgress){
      await lookDev.yieldToOutput();cancelDof();await acquireDiscoveryGpu(signal);
      try{
        signal.throwIfAborted();
        const gdScene=gdSceneOf(scene);await syncPictures(gdScene,true);
        const gd=await stillEngineFor(gdScene),ready=await gd.setScene(gdScene);
        if(ready.errors.length||ready.superseded)throw Error(ready.errors.join('; ')||'The scene was replaced.');
        return await gd.renderToBuffer(film.width,film.height,{region:rect,signal,referenceFilm:film,dofMode:'off',denoise:false,onProgress:p=>onProgress(p.fraction)});
      }finally{
        try{if(!gpuLost){await syncPictures(sync.view,true);await engine.setScene(sync.view);}}
        finally{releaseDiscoveryGpu();}
      }
    },
    busy:()=>rendering||picking,
  },canvas);
  qualityLevels.root.after(detailView.root);
  window.setInterval(()=>detailView.update(),500);
  const renderBar=new RenderBar({
    quality:()=>sync.scene.render.quality,
    applyPreset:id=>qualityLevels.applyPreset(id),
    progressive,actions:stillPanel.takeActions(),
    busy:()=>rendering||picking,
  });
  window.setInterval(()=>renderBar.update(),500);
  const geo8Artist=geo8Host?new Geo8Artist(stillBox,library.formulas,()=>showRenderSetup?.()):undefined;
  const geometryDetailPanel=new GeometryDetailPanel(stillPanel.geometryMount,settings=>{
    if(rendering||picking)return;
    pause();sync.editWithUndo(s=>({...s,geometryDetail:settings}));showRenderSetup?.();
  },()=>{
    // COMPAT-02 WP3: explicit, undoable; sets only Fin träff + Fin detalj and never geometryDetail.
    if(rendering||picking)return;
    pause();sync.editWithUndo(applyFloat32Fallback);showRenderSetup?.();
  });
  stillPanel.legacyGeometry.dataset.legacyGeometry='true';
  geometryDetailPanel.root.append(stillPanel.legacyGeometry);
  stillPanel.imageSection.prepend(formatBox);
  const appearanceQuality=document.createElement('details');appearanceQuality.innerHTML='<summary>Surface light and normal appearance</summary>';appearanceQuality.append(document.getElementById('details')!);stillPanel.imageSection.append(appearanceQuality);
  const nativeResolutionNote=document.createElement('p');nativeResolutionNote.id='quality-resolution-note';stillPanel.imageSection.prepend(nativeResolutionNote);
  let geometryEngine:GeometryEngine|undefined,geometryKey='';
  async function stillEngineFor(scene:Scene):Promise<GeometryEngine>{
    if(!scene.geometryDetail?.enabled)return engine;
    const key=JSON.stringify(scene.geometryDetail);
    if(key!==geometryKey){geometryEngine?.destroy();geometryEngine=undefined;geometryKey='';
      geometryEngine=await createEngine({geometryDetail:scene.geometryDetail,onCompile(info){((window as unknown as {__compileLog?:unknown[]}).__compileLog??=[]).push({t:Math.round(performance.now()),engine:'still',...info});}});geometryKey=key;
    }
    geometryEngine!.setFormulas(library.formulas);
    geometryEngine!.setTextureImage(scene.color.texture?.data?await dataUriToImage(scene.color.texture.data):null);
    geometryEngine!.setEnvironmentImage(scene.environment.kind==='hdri'&&scene.environment.data?dataAddressToImage(scene.environment.data):null);
    return geometryEngine!;
  }

  // ---- Animation 2.0 durable final output (legacy sequence remains separate below)
  const queuePanel=new AnimationQueuePanel(document.getElementById('camera-flight-workspace')!,desktop,
    ()=>captureAnimationSnapshot(sync.scene,library.formulas),()=>sync.scene,()=>outputSize(sync.scene.render,windowAspect()),
    runAnimationJob,async id=>{if(id===activeQueueId)queueAbort?.abort();else await desktop?.animationQueue?.('stop',id,'cancelled');await queuePanel.refresh();});
  async function runAnimationJob(id:string){
    if(!desktop?.animationQueue)return;
    if(rendering||picking||discoveryGpuActive||activeQueueId)throw Error('The renderer is busy.');
    if(gpuLost)throw Error('The graphics connection is lost. Open the app again and resume the job.');
    // Reserve the existing GPU gate before IPC/hash verification can yield to another preview/job.
    lookDev.leaveInteractiveForOutput();pause();fly?.setActive(false);rendering=true;activeQueueId=id;queuePanel.setActive(true);const abort=new AbortController();queueAbort=abort;cancelDof();
    // Reserve the shared auxiliary gate too: a pending adaptive legacy timing measurement
    // must not enter between frames and overwrite the final renderer's uniform buffers.
    discoveryGpuActive=true;canvas.dataset.auxGpuBusy='1';
    const controls=document.getElementById('controls')!;controls.inert=true;
    try{
      await waitForViewport(abort.signal);while(mainAuxBusy)await new Promise(r=>setTimeout(r,16));
      queuePanel.progress('Verifying the frozen scene and finished image files…');
      const {job,snapshot}=await desktop.animationQueue('start',id);engine.setFormulas(snapshotFormulas(snapshot));
      while(true){
        abort.signal.throwIfAborted();const next=await desktop.animationQueue('next',id);await queuePanel.refresh();
        if(next.n===undefined){queuePanel.progress(next.job.state==='complete'?'All frames are finished and verified.':'Paused after a safe frame. Resume when you want.');break;}
        const started=performance.now();
        await renderAnimationFrame(engine,snapshot,job.options,next.n,b=>desktop!.animationQueue!('write',next.token,b),s=>syncPictures(s,true),abort.signal,
          p=>queuePanel.progress(`Frame ${next.n} · ${Math.round(p.fraction*100)} % · full final quality · ${((performance.now()-started)/1000).toFixed(1)} s`));
        await desktop.animationQueue('finish',next.token);await queuePanel.refresh();
        // Give native controls a scheduling point between atomic frames.
        await new Promise(r=>setTimeout(r,0));
      }
    }catch(error){
      const state=gpuLost?'interrupted':abort.signal.aborted?'cancelled':'failed';
      await desktop.animationQueue('stop',id,state,String(error)).catch(()=>{});
      queuePanel.progress(`${state}: ${String(error)}. Finished image files are kept.`);
    }finally{
      try{engine.setFormulas(library.formulas);if(!gpuLost){await syncPictures(sync.view);await engine.setScene(sync.view);}}
      finally{releaseDiscoveryGpu();activeQueueId=undefined;queueAbort=undefined;rendering=false;queuePanel.setActive(false);controls.inert=false;renderedKey='';await queuePanel.refresh();}
    }
  }

  // ---- rendering a legacy image sequence
  const renderPanel = new RenderPanel(
    renderBox,
    {
      onTest: () => void runRender(true),
      onRender: () => void runRender(false),
      onCancel: () => cancelRender?.(),
    },
    canWriteToFolder(),
  );

  showRenderSetup = (): void => {
    cameraPanel.update(sync.scene,windowAspect());
    showDof?.();
    const r = sync.scene.render;
    formatPanel.showSetup(r, windowAspect());
    stillPanel.showQuality(r.quality);
    qualityLevels.update();
    const native=!!geo8Artist?.document,profile=qualityProfile(sync.scene,native);
    const eligibility=native?undefined:geometryEligibility(sync.scene,library.formulas),unsupported=eligibility?geometryReasonText(eligibility):undefined;
    stillPanel.setAuthority(profile,qualitySummary(sync.scene,profile)+(native?` Appearance: ${geo8Artist!.document!.appearance==='native-compatibility'?'MB3D Compatible':'NOEMA Artist (limited profile)'}.`:''),unsupported,sync.scene.lights.some(l=>l.enabled&&l.intensity>0&&l.shadows!=='none'),geo8Artist?.document?.appearance==='artist');
    geometryDetailPanel.setAuthority(profile,unsupported,eligibility?.reasons);
    geometryDetailPanel.setFallbackActive(float32FallbackActive(sync.scene));
    renderDetailsPanel.setQualityProfile(profile);
    formatBox.inert=native;
    formatPanel.setBusy(rendering||native);
    nativeResolutionNote.textContent=native?'Resolution locked to the original film 7000×3938. Cut-out and picture samples can be changed; the saved NOEMA resolution is not used by the native profile.':'The resolution is the target film for geometry and picture samples; a cut-out does not change the projection of the camera.';
    geometryDetailPanel.show(sync.scene.geometryDetail);
    geometryDetailPanel.nativeProfile(!!geo8Artist?.document);
    stillPanel.setPreviewDetail(previewDetail);
    const g = pictureGeometry(sync.scene);
    stillPanel.showInfo(native?'Still cut-out uses native Common 7000 × 3938. The responsive view shows the ordinary NOEMA camera.':`The view is currently drawn in the camera as a picture of ${g.width} × ${g.height} pixels.`);
    const dof=sync.scene.camera.dof?.enabled&&sync.scene.camera.projection!=='orthographic';
    renderPanel.showDetail(`${profile==='legacy'?'The film is drawn with the same detail values as the still picture:':'Animation uses older NOEMA quality, not Geometry Detail/native. Saved older values:'} ${dof?Math.max(16,r.quality.samples_per_pixel):r.quality.samples_per_pixel} samples per pixel, hit precision ${r.quality.hit_precision}. The test rendering uses ${dof?4:1} samples.`);
  };

  async function runRender(isTest: boolean): Promise<void> {
    if (rendering || picking || discoveryGpuActive) return;
    const parsed = renderPanel.settings();
    if (!parsed.ok) return renderPanel.setStatus(parsed.error);
    const settings = parsed.value;
    const base = sync.scene;
    if (base.animation.keyframes.length < 2) return renderPanel.setStatus("Set at least two keyframes first.");
    {
      // Check the size before anything is asked or started.
      const size = outputSize(isTest ? testRenderSetup(base.render, TEST_WIDTH) : base.render, windowAspect());
      const problem = checkOutputSize(size.width, size.height);
      if (problem) return renderPanel.setStatus(`The picture ${size.width} × ${size.height} is too large: ${problem}.`);
    }

    const wantVideo = settings.output === "video";
    // Ask for the folder first: the browser only allows it straight after a click. A video is simply downloaded.
    let sink: FrameSink | null = null;
    if (!wantVideo) {
      try {
        sink = settings.target === "folder" ? await createFolderSink() : createZipSink(isTest ? "test-bildsekvens.zip" : "bildsekvens.zip");
      } catch {
        return renderPanel.setStatus("No folder was chosen. The rendering did not start.");
      }
    }

    lookDev.leaveInteractiveForOutput();pause();
    rendering = true;
    renderPanel.setBusy(true);
    fpsLabel.textContent = "rendering …";
    const abort = new AbortController();
    cancelRender = () => abort.abort();

    // Preset sizes are even for video; exact manual sizes are kept and checked by the chosen encoder.
    const { width, height } = outputSize(isTest ? testRenderSetup(base.render, TEST_WIDTH) : base.render, windowAspect());
    const layerMode = wantVideo ? "none" : settings.layers;
    // A test render is quick: one sample per pixel. A real render uses the scene's detail values.
    const renderOptions = { signal:abort.signal, ...(isTest ? { quality: { samples_per_pixel: 1 }, dofSamples:4 } : {}) };
    const step = isTest ? Math.max(1, Math.round(base.animation.fps / TEST_FRAMES_PER_SECOND)) : settings.step;
    const prefix = isTest ? "test" : "frame";
    let activeVideo: VideoWriter | null = null;

    try {
      renderPanel.setStatus("Preparing …");
      await waitForViewport(abort.signal);
      await syncPictures(base);
      const ready = await engine.setScene(base);
      if (ready.errors.length > 0) throw new Error(ready.errors.join("; "));
      await timing.refresh(base);

      // With every n-th frame rendered the video plays n times faster per frame, so its length stays right.
      const video = wantVideo ? await VideoWriter.create({ width, height, fps: base.animation.fps / step, quality: settings.quality }) : null;
      activeVideo = video;
      const times = frameTimes(base.animation, step);
      renderPanel.setProgress(0, times.length);
      const result = await runSequence({
        times,
        signal: abort.signal,
        fileName: (n) => frameFileName(n, prefix),
        async renderFrame(t): Promise<RenderedFrame> {
          const frame = evaluateAnimation(base, t, timing.timing);
          await syncPictures(frame);
          const r = await engine.setScene(frame);
          if (r.errors.length > 0) throw new Error(r.errors.join("; "));
          if (layerMode === "none") return { image: await engine.renderToBuffer(width, height, renderOptions) };
          // Colour, depth and normals come from one job at the size of the output, so they fit each other exactly.
          // With several samples per pixel the colour is the average, while depth and normals come from the sample at
          // the pixel centre: an average of a surface and empty space would not be a real depth.
          const layers = await engine.renderLayersToBuffer(width, height, renderOptions);
          const colour: ImageBuffer = { width, height, data: layers.color };
          return {
            image: colour,
            width,
            height,
            depth: layers.depth,
            ...(layerMode === "depth+normal" ? { normal: layers.normal } : {}),
          };
        },
        encode: async (frame) => {
          if (video) {
            await video.add(frame.image);
            return new Blob();
          }
          return encodePng(frame.image);
        },
        async encodeExtras(frame, n) {
          const files: { name: string; data: Blob }[] = [];
          if (frame.depth && frame.width && frame.height) {
            files.push({
              name: frameFileName(n, `${prefix}_depth`).replace(".png", ".exr"),
              data: encodeExrBlob(encodeExr(frame.width, frame.height, depthChannels(frame.depth))),
            });
          }
          if (frame.normal && frame.width && frame.height) {
            files.push({
              name: frameFileName(n, `${prefix}_normal`).replace(".png", ".exr"),
              data: encodeExrBlob(encodeExr(frame.width, frame.height, normalChannels(frame.normal))),
            });
          }
          return files;
        },
        write: (name, data) => (sink ? sink.write(name, data) : Promise.resolve()),
        onProgress(p) {
          renderPanel.setProgress(p.done, p.total);
          renderPanel.setStatus(`${isTest ? "Testrendering" : "Rendering"} ${width}×${height}: ${describeProgress(p)}`);
        },
      });
      let where = "";
      if (video) {
        const blob = await video.finish();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = isTest ? "test-film.webm" : "film.webm";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
        where = `the video file ${link.download} (${(blob.size / 1e6).toFixed(1)} MB, ${(result.written / (base.animation.fps / step)).toFixed(1)} s)`;
      } else if (sink) {
        await sink.finish();
        where = sink.describe();
      }
      const seconds = (result.totalMs / 1000).toFixed(1);
      renderPanel.setStatus(
        `${result.aborted ? "Cancelled after" : "Done:"} ${result.written} frames (${width}×${height}) in ${seconds} s, saved in ${where}. ` +
          `Average ${result.written > 0 ? Math.round(result.totalMs / result.written) : 0} ms per frame.`,
      );
    } catch (err) {
      activeVideo?.cancel();
      renderPanel.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      rendering = false;
      cancelRender = null;
      renderPanel.setBusy(false);
      sync.edit((s) => s); // sends the working scene to the engine again
      showAll();
    }
  }

  // ---- still picture: check the detail on a cut-out, then render the whole picture

  /** Seconds as a short text: "42 s", "12 min", "3 h 20 min". */
  function duration(seconds: number): string {
    if (seconds < 10) return `${seconds.toFixed(1)} s`;
    if (seconds < 90) return `${Math.round(seconds)} s`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
    const h = Math.floor(seconds / 3600);
    return `${h} h ${Math.round((seconds - h * 3600) / 60)} min`;
  }

  /** The cut-out chosen in the panel, or a text saying what is wrong with it. */
  function cropRegion(size: { width: number; height: number }): { x: number; y: number; width: number; height: number } | string {
    const c = stillPanel.cropChoice();
    if (c.mode === "full") return { x: 0, y: 0, width: size.width, height: size.height };
    if (c.mode === "center") {
      const w = Math.min(c.size, size.width);
      const h = Math.min(c.size, size.height);
      return { x: Math.floor((size.width - w) / 2), y: Math.floor((size.height - h) / 2), width: w, height: h };
    }
    const fields = [c.x, c.y, c.width, c.height];
    if (!fields.every(Number.isInteger) || c.x < 0 || c.y < 0 || c.width < 1 || c.height < 1 || c.x + c.width > size.width || c.y + c.height > size.height) {
      return `The cut-out must be whole numbers and lie inside the picture (0 to ${size.width} in width and 0 to ${size.height} in height).`;
    }
    return { x: c.x, y: c.y, width: c.width, height: c.height };
  }

  /** Setting up and tearing down around a long render: the preview rests and the panels are locked. */
  function beginStill(): AbortController {
    progressive.clear();
    detailView.stop();
    lookDev.leaveInteractiveForOutput();pause();
    rendering = true;
    stillPanel.setBusy(true);
    geometryDetailPanel.busy(true);
    formatPanel.setBusy(true);
    fpsLabel.textContent = "rendering …";
    const abort = new AbortController();
    cancelRender = () => abort.abort();
    return abort;
  }
  async function waitForViewport(signal?:AbortSignal): Promise<void> {
    cancelDof();
    // Stop refinement, then finish the already submitted job before exports reuse its uniforms.
    await waitForRenderIdle(()=>previewBusy,signal);
  }
  function endStill(): void {
    rendering = false;
    cancelRender = null;
    stillPanel.setBusy(false);
    geometryDetailPanel.busy(false);
    formatPanel.setBusy(false);
    sync.edit((s) => s); // sends the working scene to the engine again
    showAll();
  }

  /** Draws only a cut-out of the picture, at the real resolution and with the chosen detail, and shows it. */
  /** INTELLIGENT-RENDERING-02: the whole picture at the scene's Float32 quality, with Geometry Detail only in the chosen rectangle (feathered join). */
  async function runSelectiveGd(): Promise<void> {
    await lookDev.yieldToOutput();
    if (rendering || picking || discoveryGpuActive) return;
    const base = sync.view, size = outputSize(base.render, windowAspect());
    const tooBig = checkOutputSize(size.width, size.height);
    if (tooBig) return stillPanel.setStatus(`The picture ${size.width} × ${size.height}: ${tooBig}`);
    if (!base.geometryDetail?.enabled) return stillPanel.setStatus("Switch Geometry Detail on first (further down); then it can be placed in a cut-out only.");
    const unavailable = geometryUnavailable(base, library.formulas);
    if (unavailable) return stillPanel.setStatus(unavailable);
    const region = cropRegion(size);
    if (typeof region === "string") return stillPanel.setStatus(region);
    if (region.width === size.width && region.height === size.height) return stillPanel.setStatus("Choose a cut-out under Inspect (middle or own); the whole picture with Geometry Detail is made with Render still picture.");
    if (size.width * size.height > 16_000_000) return stillPanel.setStatus("A whole picture with a cut-out is supported up to 16 million pixels (the whole picture is kept in memory).");
    let stream: FileStream | null = null;
    try { stream = await openFileStream("stillbild-gd-utsnitt.png", "image/png", ".png"); } catch { return stillPanel.setStatus("No file was chosen. The rendering did not start."); }
    const abort = beginStill(), started = performance.now(), margin = 24;
    let png: PngStreamWriter | null = null;
    try {
      stillPanel.setStatus("Preparing …");
      await waitForViewport(abort.signal);
      await syncPictures(base);
      // 1. The ordinary Float32 picture of the whole frame, with the quality the scene has (Geometry Detail switched off for this part).
      const plain = { ...base, geometryDetail: { ...base.geometryDetail!, enabled: false } };
      const ready = await engine.setScene(plain);
      if (ready.errors.length > 0) throw new Error(ready.errors.join("; "));
      const floatStarted = performance.now();
      const floatImage = await engine.renderToBuffer(size.width, size.height, { signal: abort.signal, referenceFilm: size, dofMode: "off", denoise: false, onProgress: (p) => { stillPanel.setProgress(p.fraction * 0.2); stillPanel.setStatus(`Drawing the whole picture with Float32 … ${Math.round(p.fraction * 100)} %`); } });
      const floatMs = performance.now() - floatStarted;
      // 2. Geometry Detail on the chosen rectangle plus a margin.
      const gdEngine = await stillEngineFor(base);
      const gdReady = await gdEngine.setScene(base);
      if (gdReady.errors.length > 0) throw new Error(gdReady.errors.join("; "));
      const rect = grownRect(region, margin, size.width, size.height), gdStarted = performance.now();
      const patch = await gdEngine.renderToBuffer(size.width, size.height, { region: rect, signal: abort.signal, referenceFilm: size, dofMode: "off", denoise: false, onGeometry: (d) => geometryDetailPanel.status(d),
        onProgress: (p) => { stillPanel.setProgress(0.2 + p.fraction * 0.75); stillPanel.setStatus(`Geometry Detail in the cut-out (${rect.width}×${rect.height}) … ${Math.round(p.fraction * 100)} %`); } });
      const gdMs = performance.now() - gdStarted;
      // 3. Put together and write.
      const result = compositeRegion({ width: size.width, height: size.height, linear: floatImage.linear!, data: floatImage.data, ...(floatImage.display ? { display: floatImage.display } : {}) }, patch.linear!, rect, region, margin);
      const credits = creditLines(collectCredits(base, library.formulas));
      png = await PngStreamWriter.create(size.width, size.height, (bytes) => stream!.write(bytes), { Software: "Fraktalmotorn", ...(credits.length > 0 ? { Description: credits.join(String.fromCharCode(10)) } : {}), Comment: `Picture ${size.width}x${size.height}. Float32 everywhere except Geometry Detail in the cut-out x ${region.x}, y ${region.y}, ${region.width}x${region.height} (soft edge ${margin} px).` });
      for (let y = 0; y < size.height; y += 64) { const rows = Math.min(64, size.height - y); await png.writeRows(result.data.subarray(y * size.width * 4, (y + rows) * size.width * 4), rows); }
      await png.finish(); await stream.close();
      stillPanel.setProgress(1);
      stillPanel.setStatus(`Done: ${size.width} × ${size.height} saved as ${stream.describe()}. Float32 ${duration(floatMs / 1000)} + Geometry Detail in the cut-out ${duration(gdMs / 1000)} (total ${duration((performance.now() - started) / 1000)}).`);
    } catch (err) {
      await png?.abort().catch(() => undefined);
      await stream?.abort().catch(() => undefined);
      const cancelled = abort.signal.aborted || (err instanceof Error && err.name === "AbortError");
      stillPanel.setStatus(cancelled ? "Cancelled. No file was saved." : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      endStill();
    }
  }

  async function runCropPreview(): Promise<void> {
    await lookDev.yieldToOutput();
    if (rendering || picking || discoveryGpuActive) return;
    const base = sync.view;
    const size = outputSize(base.render, windowAspect());
    const tooBig = checkOutputSize(size.width, size.height);
    if (tooBig) return stillPanel.setStatus(`The picture ${size.width} × ${size.height}: ${tooBig}`);
    const region = cropRegion(size);
    if (typeof region === "string") return stillPanel.setStatus(region);
    if (region.width * region.height > 16_000_000) {
      return stillPanel.setStatus("The cut-out is too large to show here (at most 16 million pixels). Use Render still picture for the whole picture.");
    }
    const abort = beginStill();
    try {
      stillPanel.setStatus("Preparing …");
      await waitForViewport(abort.signal);
      await syncPictures(base);
      if(geo8Artist?.supports(base)){
        const result=await geo8Artist.render(base,region,abort.signal,(text,f)=>{stillPanel.setStatus(text);stillPanel.setProgress(f);});
        stillPanel.showPreview(region.width,region.height,result.rgba);stillPanel.setProgress(1);
        stillPanel.setStatus(`GEO8 done: ${region.width}×${region.height}, ${result.samples} samples; ${result.unresolved} unresolved primary rays, ${result.visibilityUnresolved} unresolved visibility. Save the cut-out with the button under the picture.`);
        return;
      }
      const stillEngine=await stillEngineFor(base);
      const ready = await stillEngine.setScene(base);
      if (ready.errors.length > 0) throw new Error(ready.errors.join("; "));
      const previewChoice = stillPanel.previewChoice();
      const previewPlan = planScaledPreview(size, base.render.quality, {
        scale: previewChoice.scale,
        samplesPerPixel: previewChoice.samplesPerPixel,
        region,
      });
      const useScaledPlan = previewChoice.scale !== 1 || previewChoice.samplesPerPixel !== null;
      const t0 = performance.now();
      const image = await stillEngine.renderToBuffer(previewPlan.film.width, previewPlan.film.height, {
        region: previewPlan.region,
        ...(useScaledPlan ? { referenceFilm: previewPlan.referenceFilm, quality: previewPlan.quality } : {}),
        // The legacy heat map describes the guide pass, not the DS solver.
        debugView:base.geometryDetail?.enabled?'off':debugView,
        signal: abort.signal,
        onGeometry:d=>geometryDetailPanel.status(d),
        onProgress: (p) => {
          stillPanel.setProgress(p.fraction);
          stillPanel.setStatus(`Drawing the cut-out … ${Math.round(p.fraction * 100)} %`);
        },
      });
      const seconds = (performance.now() - t0) / 1000;
      stillPanel.showPreview(image.width, image.height, image.data);
      const share = (region.width * region.height) / (size.width * size.height);
      const scaleNote = useScaledPlan ? ` (${Math.round(previewPlan.scale * 100)} % linear scale, ${previewPlan.samplesPerPixel} samples)` : "";
      stillPanel.setStatus(
        `The cut-out ${image.width} × ${image.height}${scaleNote} took ${duration(seconds)}. ` +
          (share < 0.999
            ? `The whole picture (${size.width} × ${size.height}) would take about ${duration(seconds / share)}. This is a rough estimate: the time depends on where in the picture the cut-out lies and on how hard the graphics card is working.`
            : ""),
      );
    } catch (err) {
      const cancelled = abort.signal.aborted || (err instanceof Error && err.name === "AbortError");
      stillPanel.setStatus(cancelled ? "Cancelled." : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      endStill();
    }
  }

  /** Working-memory budget for contiguous depth/normal exports; tile files use bounded local layers. */
  const MAX_LAYER_BYTES = 512 * 2**20;

  /** Draws the whole picture, band by band, and streams the chosen image format. */
  async function runStill(): Promise<void> {
    if(discoveryGpuActive&&!lookDev.active)return stillPanel.setStatus("Wait until the preview or thumbnail is done.");
    if (rendering || picking) return;
    const base = sync.view; // currently visible camera and transient mathematics, at full still quality
    const size = outputSize(base.render, windowAspect());
    const tooBig = checkOutputSize(size.width, size.height);
    if (tooBig) return stillPanel.setStatus(`The picture ${size.width} × ${size.height}: ${tooBig}`);
    if(geo8Artist?.document)return stillPanel.setStatus('GEO8: choose a native cut-out and Inspect details → Save cut-out. A whole film/HDR/tiles are not verified in this candidate.');
    const layerMode = stillPanel.layerChoice();
    const tileOutput=stillPanel.tileOutput();
    const exrOutput = stillPanel.exrOutput(), exrPrecision = stillPanel.exrPrecision();
    if (!tileOutput && layerMode !== "none" && size.width * size.height * (layerMode==='depth'?4:16) > MAX_LAYER_BYTES) {
      return stillPanel.setStatus(
        `Continuous layers need more than 512 MiB of working memory. Choose \"PNG tiles + JSON\" for layers at this resolution, or \"Colour picture only\".`,
      );
    }

    // Ask where to save first: the browser only allows it straight after a click.
    let stream: FileStream | null = null;
    let sink: FrameSink | null = null;
    try {
      if (exrOutput) stream = await openFileStream("stillbild.exr", "image/x-exr", ".exr");
      else if(tileOutput)sink=canWriteToFolder()?await createFolderSink():createDownloadSink();
      else if (layerMode === "none") stream = await openFileStream("stillbild.png", "image/png", ".png");
      else sink = canWriteToFolder() ? await createFolderSink() : createZipSink("stillbild.zip");
    } catch {
      return stillPanel.setStatus("No file or folder was chosen. The rendering did not start.");
    }

    await lookDev.yieldToOutput();
    if(discoveryGpuActive){await stream?.abort();return stillPanel.setStatus("Wait until the running thumbnail is done.");}
    const abort = beginStill();
    const q = base.render.quality;
    const credits = creditLines(collectCredits(base, library.formulas));
    const parts: Uint8Array[] = [];
    let png: PngStreamWriter | null = null;
    const started = performance.now();
    try {
      stillPanel.setStatus("Preparing …");
      await waitForViewport(abort.signal);
      await syncPictures(base);
      const stillEngine=await stillEngineFor(base);
      const ready = await stillEngine.setScene(base);
      if (ready.errors.length > 0) throw new Error(ready.errors.join("; "));

      if (exrOutput) {
        const writer = await ExrStreamWriter.create(size.width, size.height, bytes => stream!.write(bytes), {
          precision: exrPrecision,
          metadata: {
            software: 'Fraktalmotorn 0.0.0', colorSpace: 'linear-sRGB',
            displayExposureEV: base.display?.exposure ?? 0, renderIdentifier: crypto.randomUUID(),
            ...(base.camera.lens ? {focalLength: base.camera.lens.focal_length_mm} : {}),
          },
        });
        await stillEngine.renderStream(size.width, size.height, {
          signal: abort.signal,
        onGeometry:d=>geometryDetailPanel.status(d),
          onProgress: p => {
            stillPanel.setProgress(p.fraction);
            stillPanel.setStatus(`Drawing linear HDR ${size.width} × ${size.height}: ${Math.round(p.fraction * 100)} %`);
          },
        }, false, async band => {
          if (!band.linear) throw Error('Renderer did not provide linear HDR beauty');
          await writer.writeRows(band.linear, band.rows);
        });
        writer.finish();
        await stream!.close();
        stillPanel.setProgress(1);
        stillPanel.setStatus(`Done: linear HDR OpenEXR ${exrPrecision === 'half' ? 'Half16' : 'Float32'}, ${size.width} × ${size.height}, saved as ${stream!.describe()}.`);
        return;
      }

      if(tileOutput){
        await renderTileOutput(stillEngine,base,library.formulas,size.width,size.height,sink!,layerMode,abort.signal,p=>{stillPanel.setProgress(p);stillPanel.setStatus(`Drawing tiles ${size.width} × ${size.height}: ${Math.round(p*100)} %`);});
        stillPanel.setStatus(`Done: tiles and tiles.json saved as ${sink!.describe()}.`);stillPanel.setProgress(1);return;
      }

      const write = stream ? (bytes: Uint8Array) => stream!.write(bytes) : (bytes: Uint8Array) => void parts.push(bytes.slice());
      png = await PngStreamWriter.create(size.width, size.height, write, {
        Software: "Fraktalmotorn",
        ...(credits.length > 0 ? { Description: credits.join("\n") } : {}),
        Comment:
          `Picture ${size.width}x${size.height}. ${qualitySummary(base,qualityProfile(base))} Saved older settings: ${q.samples_per_pixel} samples per pixel, hit precision ${q.hit_precision}, ` +
          `step factor ${q.step_factor}, max steps ${q.max_steps}, max distance ${q.max_distance}, normal step ${q.normal_epsilon}, shadow steps ${q.shadow_steps}, ` +
          `precision ${q.precision_mode === "pixel" ? `${q.hit_pixels} px / normal ${q.normal_pixels} px` : "fast"}, seed ${q.seed}.`,
      });
      const depth = layerMode !== "none" ? new Float32Array(size.width * size.height) : undefined;
      const normal = layerMode === "depth+normal" ? new Float32Array(size.width * size.height * 3) : undefined;

      await stillEngine.renderStream(
        size.width,
        size.height,
        {
          signal: abort.signal,
        onGeometry:d=>geometryDetailPanel.status(d),
          onProgress: (p) => {
            stillPanel.setProgress(p.fraction);
            const left = p.fraction > 0.02 ? ` About ${duration((p.elapsedSeconds * (1 - p.fraction)) / p.fraction)} remaining.` : "";
            stillPanel.setStatus(`Drawing ${size.width} × ${size.height}: ${Math.round(p.fraction * 100)} % (row ${p.rowsDone} of ${p.rowsTotal}). Elapsed time ${duration(p.elapsedSeconds)}.${left}`);
          },
        },
        layerMode !== "none",
        async (band) => {
          await png!.writeRows(band.color, band.rows);
          if (depth && band.depth) depth.set(band.depth, band.y * size.width);
          if (normal && band.normal) normal.set(band.normal, band.y * size.width * 3);
        },
      );
      await png.finish();
      let where: string;
      if (stream) {
        await stream.close();
        where = stream.describe();
      } else {
        await sink!.write("stillbild.png", new Blob(parts as Uint8Array<ArrayBuffer>[], { type: "image/png" }));
        if (depth) await sink!.write("stillbild_depth.exr", encodeExrBlob(encodeExr(size.width, size.height, depthChannels(depth))));
        if (normal) await sink!.write("stillbild_normal.exr", encodeExrBlob(encodeExr(size.width, size.height, normalChannels(normal))));
        await sink!.finish();
        where = sink!.describe();
      }
      // How certain was the geometry? A half-size march-only picture counts rays that ran out of steps (a few percent of the render's cost).
      let uncertaintyNote = '';
      try {
        if (!base.geometryDetail?.enabled && !abort.signal.aborted) {
          const u = await probeUncertainty(stillEngine, size.width, size.height, {}, { signal: abort.signal, referenceFilm: size });
          const pct = u.exhaustedShare * 100;
          uncertaintyNote = pct < 0.05 ? ' The geometry is safe: no rays ran out of steps.' : ` ${pct.toFixed(1)} % of the rays ran out of steps (${Math.round(u.tileShare * 100)} % of the tiles are affected); more steps or Geometry Detail can give more there.`;
        }
      } catch { /* the picture is already written; the note is only an extra */ }
      if (!abort.signal.aborted) uncertaintyNote += await floorAdvice(stillEngine, base, size, abort.signal);
      stillPanel.setProgress(1);
      stillPanel.setStatus(`Done: ${size.width} × ${size.height} in ${duration((performance.now() - started) / 1000)}, saved as ${where}.${uncertaintyNote}`);
    } catch (err) {
      await png?.abort().catch(() => undefined);
      await stream?.abort().catch(() => undefined);
      const cancelled = abort.signal.aborted || (err instanceof Error && err.name === "AbortError");
      stillPanel.setStatus(cancelled ? `Cancelled after ${duration((performance.now() - started) / 1000)}. ${tileOutput?'Tiles already written may exist; no complete manifest was delivered.':'No file was saved.'}` : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      endStill();
    }
  }

  // ---- exporting the camera path
  async function runCameraExport(kind: "glb" | "json"): Promise<void> {
    if (rendering || picking) return;
    const base = sync.scene;
    if (base.animation.keyframes.length < 2) return animationPanel.setExportStatus("Set at least two keyframes first.");
    pause();
    try {
      animationPanel.setExportStatus("Calculating the camera path …");
      await timing.refresh(base);
      const track = sampleCameraTrack(base, timing.timing,1,windowAspect());
      const credits = creditLines(collectCredits(base, library.formulas));
      const blob =
        kind === "glb"
          ? new Blob([cameraToGlb({ camera: track, credits }) as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" })
          : new Blob([cameraTrackToJson(track, { units: "scene units", credits })], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `kamerabana.${kind}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      animationPanel.setExportStatus(
        `Done: ${track.times.length} frames, ${track.fps} per second.` +
          (track.fovChanges && kind === "glb" ? " The field of view changes in the animation but glTF cannot animate it, so the first value is used." : ""),
      );
    } catch (err) {
      animationPanel.setExportStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- exporting the shape as a triangle mesh
  let exportAbort:AbortController|undefined;
  const meshPanel = new MeshPanel(meshBox, {
    onExport: () => void runMeshExport(),
    onCancel:()=>exportAbort?.abort(),
    onFit: () => fitMeshArea(),
  });

  /** The area to measure follows what the camera looks at. */
  function fitMeshArea(): void {
    const c = sync.scene.camera;
    const distance = Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
    meshPanel.setArea(c.target, Math.max(0.05, distance * 0.45));
  }
  fitMeshArea();

  async function runMeshExport(): Promise<void> {
    if (rendering || picking || discoveryGpuActive) return;
    const parsed = meshPanel.settings();
    if (!parsed.ok) return meshPanel.setStatus(parsed.error);
    const m = parsed.value;
    let gaussianStream:FileStream|undefined;
    if(m.mode==='gaussians'&&m.gaussianQuality!=='legacy'){
      try{gaussianStream=await openFileStream('fraktal.3dgs.ply','application/octet-stream','.ply');}catch(error){meshPanel.setStatus(error instanceof Error?error.message:String(error));return;}
    }
    const base = structuredClone(sync.scene);
    pause();
    rendering = true; // the picture rests while the graphics card measures
    meshPanel.setBusy(true);
    exportAbort=new AbortController();
    fpsLabel.textContent = "measuring …";
    try {
      meshPanel.setStatus("Preparing …");
      const ready = await engine.setScene(base);
      if (ready.errors.length > 0) throw new Error(ready.errors.join("; "));
      await syncTexture(base.color.texture?.data);
      const n = m.resolution;
      const step = (2 * m.halfSize) / (n - 1);
      const grid = {
        origin: [m.center[0] - m.halfSize, m.center[1] - m.halfSize, m.center[2] - m.halfSize] as [number, number, number],
        step: [step, step, step] as [number, number, number],
        size: [n, n, n] as [number, number, number],
      };
      if(gaussianStream){
        const options={bounds:{min:grid.origin,max:grid.origin.map(v=>v+2*m.halfSize) as [number,number,number]},quality:m.gaussianQuality as 'draft'|'balanced'|'high'|'ultra',maxCount:m.count,detailTolerance:m.detailTolerance,memoryBudgetMiB:m.memoryBudgetMiB,fileBudgetMiB:m.fileBudgetMiB,seed:m.seed,withColors:m.withColors,baseColor:base.material.baseColor as [number,number,number],signal:exportAbort.signal,
          gaussian:{scaleMultiplier:m.scaleMultiplier,opacity:m.opacity,opacityMode:m.opacityMode,colorMode:m.withColors?m.colorMode:'constant' as const,color:[1,1,1] as [number,number,number]},onProgress:(stage:string,done:number,total:number)=>meshPanel.setStatus(`${stage}: ${done.toLocaleString('en-GB')} / ${total.toLocaleString('en-GB')} …`)};
        if(gaussianStream.bufferedByteLimit)options.fileBudgetMiB=Math.min(options.fileBudgetMiB,gaussianStream.bufferedByteLimit/2**20);
        const e=estimateAdaptiveGaussians(options);
        const result=await exportAdaptiveGaussians(createGpuFractalSampler(base,engine),{...options,isoLevel:m.level*(2*m.halfSize/e.resolution)},gaussianStream);
        await gaussianStream.close();gaussianStream=undefined;
        meshPanel.setStatus(`Done: ${result.count.toLocaleString('en-US')} Gaussians, ${(result.fileBytes/1e6).toFixed(1)} MB. ${result.warnings.join(' ')}`);return;
      }
      if(m.mode!=='legacy'){
        const archive=new ZipWriter(new Date(1980,0,1));
        const contentSampler=m.mode==='scene'&&m.representation==='gaussians'&&m.gaussianQuality!=='legacy'?createGpuFractalSampler(base,engine):createFractalSampler(base,library.formulas,engine);
        const contentBounds={min:grid.origin,max:grid.origin.map(v=>v+2*m.halfSize) as [number,number,number]};
        const contentCellSize=m.mode==='scene'&&m.representation==='gaussians'&&m.gaussianQuality!=='legacy'?2*m.halfSize/estimateAdaptiveGaussians({bounds:contentBounds,quality:m.gaussianQuality}).resolution:step;
        const result=await exportContent({...base,credits:collectCredits(base,library.formulas)},contentSampler,{
          mode:m.mode,representation:m.representation,format:m.format,bounds:contentBounds,resolution:n-1,isoLevel:m.level*contentCellSize,
          count:m.count,seed:m.seed,withColors:m.withColors,withNormals:m.withNormals,volumeMode:m.volumeMode,simplifyTolerance:step*.3,windowAspect:windowAspect(),signal:exportAbort.signal,
          gaussian:{scaleMultiplier:m.scaleMultiplier,opacity:m.opacity,opacityMode:m.opacityMode,colorMode:m.withColors?m.colorMode:'constant',color:[1,1,1]},onProgress:(done,total)=>meshPanel.setStatus(`Export ${done}/${total} …`),
          adaptiveGaussian:m.gaussianQuality==='legacy'?undefined:{quality:m.gaussianQuality,maxCount:m.count,detailTolerance:m.detailTolerance,memoryBudgetMiB:m.memoryBudgetMiB,fileBudgetMiB:Math.min(240,m.fileBudgetMiB)},
        },{async write(path,bytes){await archive.add(path,new Blob([bytes.slice().buffer]));}},{blender:blenderHelper,vdb:vdbHelper});
        if(!result.ok)throw Error(result.status==='cancelled'?'The export was cancelled':result.error);
        const blob=archive.finish(),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`fraktal-${m.mode}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),60000);
        meshPanel.setStatus(`Done: ${result.files.length} files, ${(blob.size/1e6).toFixed(1)} MB. ${result.warnings.join(' ')}`);return;
      }
      meshPanel.setStatus(`Measuring the distance at ${(n ** 3).toLocaleString("en-US")} points …`);
      await new Promise((r) => setTimeout(r, 30)); // let the page repaint before the heavy part
      const t0 = performance.now();
      const adaptiveResult=m.adaptive?await extractAdaptiveMesh(createFractalSampler(base,library.formulas,engine),{
        bounds:{min:grid.origin,max:grid.origin.map(v=>v+2*m.halfSize) as [number,number,number]},resolution:n-1,isoLevel:m.level*step,
        simplifyTolerance:step*.3,withColors:m.withColors,signal:exportAbort.signal,onProgress:(done,total)=>meshPanel.setStatus(`Sample block ${done}/${total} …`),
      }):null;
      const values = adaptiveResult?null:await engine.distanceGrid(base, grid);
      if(exportAbort.signal.aborted)throw Error('The export was cancelled');
      const t1 = performance.now();
      meshPanel.setStatus("Building the surface …");
      await new Promise((r) => setTimeout(r, 30));
      const mesh = adaptiveResult?.mesh??extractSurface(values!, grid, m.level * step);
      const t2 = performance.now();
      if (mesh.indices.length === 0) {
        throw new Error("No surface was found in the area. Try \"Fetch area from the camera\", a larger area or another thickness.");
      }
      // Does the shape run out of the area? Then the mesh is open at the edge of it.
      const lo = grid.origin.map((v) => v + step * 1.5);
      const hi = grid.origin.map((v, i) => v + 2 * m.halfSize - step * 1.5);
      let touchesEdge = false;
      for (let i = 0; i < mesh.positions.length && !touchesEdge; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = mesh.positions[i + k]!;
          if (v < lo[k]! || v > hi[k]!) touchesEdge = true;
        }
      }
      if (m.withColors && !mesh.colors) {
        meshPanel.setStatus("Colouring the surface …");
        await new Promise((r) => setTimeout(r, 30));
        mesh.colors = await engine.colorsAt(base, mesh.positions, mesh.normals);
      }
      const credits = creditLines(collectCredits(base, library.formulas));
      let camera;
      if (m.includeCamera) {
        if (base.animation.keyframes.length < 2) throw new Error("The camera path requires at least two keyframes.");
        await timing.refresh(base);
        camera = sampleCameraTrack(base, timing.timing,1,windowAspect());
      }
      const blob =
        m.format === "glb"
          ? new Blob([meshToGlb(mesh, { name: "fractal", credits, ...(camera ? { camera } : {}) }) as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" })
          : m.format === "ply"
            ? new Blob([meshToPly(mesh, credits) as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" })
            : new Blob(meshToObjParts(mesh, credits), { type: "text/plain" });
      const link = document.createElement("a");
      if(exportAbort.signal.aborted)throw Error('The export was cancelled');
      link.href = URL.createObjectURL(blob);
      link.download = `fraktal.${m.format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      meshPanel.setStatus(
        `Done: ${(mesh.positions.length / 3).toLocaleString("en-US")} vertices, ${(mesh.indices.length / 3).toLocaleString("en-US")} triangles, ${(blob.size / 1e6).toFixed(1)} MB. ` +
          `Measurement ${Math.round(t1 - t0)} ms, surface ${Math.round(t2 - t1)} ms.` +
          (touchesEdge ? " The shape reaches the edge of the area, so the surface is open there. Increase the half size if you want it closed." : "")+
          (adaptiveResult?` Simplified ${adaptiveResult.diagnostics.simplifiedTriangles} triangles; max displacement ${adaptiveResult.diagnostics.maxDisplacement.toPrecision(3)}. ${adaptiveResult.diagnostics.warnings.join(' ')}`:''),
      );
    } catch (err) {
      if(gaussianStream)await gaussianStream.abort();
      meshPanel.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      rendering = false;
      exportAbort=undefined;
      meshPanel.setBusy(false);
      sync.edit((s) => s); // sends the working scene to the engine again
      showAll();
    }
  }

  // Artist aiming shares the existing viewport GPU gate and world-hit picker.
  const aimTools=document.createElement('div');aimTools.id='spot-aim-tools';
  const aimStatus=document.createElement('div');aimStatus.id='spot-aim-status';aimStatus.setAttribute('role','status');
  const cancelAim=document.createElement('button');cancelAim.textContent='Cancel light target';
  const hideAim=document.createElement('button');hideAim.textContent='Hide light target';
  const undoAim=document.createElement('button');undoAim.textContent='Undo light direction';
  const redoAim=document.createElement('button');redoAim.textContent='Redo light direction';
  const previewHint=document.createElement('div');previewHint.className='ainfo';previewHint.textContent='Explore uses a simplified camera light. Choose Final Preview above the picture for the real light and shadows of the scene.';
  aimTools.append(aimStatus,cancelAim,hideAim,undoAim,redoAim,previewHint);lightsBox.append(aimTools);
  const aimMarker=document.createElement('div');aimMarker.id='spot-aim-marker';aimMarker.textContent='⊕';aimMarker.setAttribute('aria-hidden','true');
  Object.assign(aimMarker.style,{position:'fixed',pointerEvents:'none',zIndex:'25',color:'#80efff',fontSize:'28px',lineHeight:'28px',textShadow:'0 0 3px black',transform:'translate(-50%,-50%)'});document.body.append(aimMarker);
  function spotAimView(){
    // The existing surface query uses the ordinary engine, never the separate GD solver.
    if(sync.scene.geometryDetail?.enabled)return null;
    const displayed=lookDev.surfacePickView(sync.scene);if(displayed!==undefined)return displayed;
    const r=canvas.getBoundingClientRect();
    // Reuse the existing completed viewport identity when there is no LookDev overlay.
    if(!lastPresentedScene||!sameSurfacePickView(lastPresentedScene,sync.scene)||sync.scene.geometryDetail?.enabled||Math.abs(r.width/r.height-lastPresentedAspect)>1e-6)return null;
    return {left:r.left,top:r.top,width:r.width,height:r.height,film:{width:canvas.width,height:canvas.height}};
  }
  function spotAimRect(){return spotAimView()??{left:0,top:0,width:0,height:0};}
  const spotAim=new SurfaceAim({
    scene:()=>sync.scene,rect:spotAimRect,
    available:()=>!rendering&&!picking&&!discoveryGpuActive&&!gpuLost&&sync.view===sync.scene,
    async pick(p){
      picking=true;pause();cancelDof();
      try{while(previewBusy||mainAuxBusy)await new Promise(resolve=>setTimeout(resolve,16));await sync.flush();
        if(gpuLost||rendering)throw Error('GPU not available');
        return await pickSurface(p.width,p.height,p.x,p.y);
      }finally{picking=false;renderedKey='';quality.touch(performance.now());}
    },
    commit(next){sync.editWithUndo(()=>next);showLights?.();},changed:updateSpotAim,
  });
  function startSpotAim(index:number,illumination?:number):boolean {
    if(rendering||picking||discoveryGpuActive||gpuLost)return false;
    if(focusPick.armed||focusPick.busy)return false; // one surface pick at a time
    pause();flightClock.pause();fly?.setActive(false);primitivePanel.cancelPlacement();
    if(spotAimView()===null){spotAim.message=sync.scene.geometryDetail?.enabled?'Surface picking is not supported with Geometry Detail. No change.':'The preview has an older camera or geometry. Update the picture before picking a surface.';updateSpotAim();return false;}
    return spotAim.start(index,illumination);
  }
  function updateSpotAim():void {
    aimStatus.textContent=spotAim.message;aimTools.dataset.state=spotAim.busy?'picking':spotAim.index!==null?'armed':'idle';
    cancelAim.hidden=spotAim.index===null&&!spotAim.busy;hideAim.hidden=!spotAim.target;
    undoAim.disabled=spotAim.busy||!sync.canUndo;redoAim.disabled=spotAim.busy||!sync.canRedo;
    const t=spotAim.target,r=spotAimRect();
    const visible=t&&t.scene===sync.scene&&t.rect.left===r.left&&t.rect.top===r.top&&t.rect.width===r.width&&t.rect.height===r.height;
    aimMarker.hidden=!visible;if(visible){aimMarker.style.left=r.left+t.pixel.x/t.pixel.width*r.width+'px';aimMarker.style.top=r.top+t.pixel.y/t.pixel.height*r.height+'px';}
    canvas.style.cursor=spotAim.index!==null?'crosshair':'';
    showLightFit?.();
  }
  cancelAim.onclick=()=>spotAim.cancel();hideAim.onclick=()=>spotAim.hide();
  undoAim.onclick=()=>{if(rendering||picking)return;pause();spotAim.cancel();if(sync.undo())showAll();updateSpotAim();};
  redoAim.onclick=()=>{if(rendering||picking)return;pause();spotAim.hide();if(sync.redo())showAll();updateSpotAim();};
  for(const surface of [canvas,lookDev.surface])surface.addEventListener('pointerdown',event=>{const e=event as PointerEvent;if(spotAim.index===null)return;e.preventDefault();e.stopImmediatePropagation();if(e.button===0)void spotAim.at(e.clientX,e.clientY);},{capture:true});
  canvas.addEventListener('dblclick',e=>{if(spotAim.index!==null||spotAim.busy){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  canvas.addEventListener('pointercancel',()=>{if(spotAim.index!==null||spotAim.busy)spotAim.cancel();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(spotAim.index!==null||spotAim.busy||spotAim.target)){spotAim.cancel();e.preventDefault();}});
  window.addEventListener('blur',()=>{if(spotAim.index!==null||spotAim.busy)spotAim.cancel();});
  new ResizeObserver(updateSpotAim).observe(canvas);window.addEventListener('scroll',updateSpotAim,true);
  updateSpotAim();

  // ---- ARTIST-SCALE-03: illumination at the aimed target. The control only edits the intensity of a light that was
  // aimed and fitted in this session and has not been moved or turned since; nothing is recalibrated on its own.
  const lightFitPanel = new LightFitPanel(lightsBox, {
    onLevel(level, begin) {
      const anchor = spotAim.fitted?.anchor;
      if (!anchor || rendering || picking || !anchorReading(sync.scene, anchor)) return; // no aimed light: the panel just remembers the level
      pause();
      const apply = (s: Scene): Scene => { const r = setAnchoredIllumination(s, anchor, level); return r.ok ? r.scene : s; };
      if (begin) sync.editWithUndo(apply); else sync.edit(apply);
      showLights?.();
    },
  });
  showLightFit = (): void => {
    const reading = anchorReading(sync.scene, spotAim.fitted?.anchor);
    lightFitPanel.update(reading ? { number: reading.index + 1, distance: reading.distance, intensity: reading.intensity, illumination: reading.illumination } : null);
  };
  showLightFit();

  // ---- ARTIST-LOOKS-02: camera-relative lighting rigs. Applying is the only thing that writes: the rig is turned into
  // ordinary world-space lights once, from the camera as it is now, in one Undo step. Nothing follows the camera later.
  let rigApplied: Scene | undefined;
  let rigRedoOwned = false;
  const lightRigPanel = new LightRigPanel(lightsBox, {
    onApply(rigId, mode, options) {
      if (rendering || picking || discoveryGpuActive || gpuLost) { lightRigPanel.setStatus('Wait until the ongoing work is finished and try again.'); return; }
      if (spotAim.index !== null || spotAim.busy || focusPick.armed || focusPick.busy) { lightRigPanel.setStatus('End the light target or the focus pick first (Esc).'); return; }
      pause();
      const result = applyRig(sync.scene, rigId, mode, options);
      if (!result.ok) { lightRigPanel.setStatus(result.message); showLights?.(); return; }
      sync.editWithUndo(() => result.scene);
      rigApplied = sync.scene; rigRedoOwned = false;
      lightRigPanel.setStatus(`${result.rig.name} is applied. ${result.summary} One Undo step.`);
      showAll();
    },
    onUndo() { if (rendering || picking || rigApplied !== sync.scene) return; pause(); if (sync.undo()) { rigRedoOwned = true; showAll(); lightRigPanel.setStatus('The rig is undone.'); } },
    onRedo() { if (rendering || picking || !rigRedoOwned) return; pause(); if (sync.redo()) { rigApplied = sync.scene; rigRedoOwned = false; showAll(); lightRigPanel.setStatus('The rig is redone.'); } },
    canUndo: () => rigApplied === sync.scene && sync.canUndo,
    canRedo: () => rigRedoOwned && sync.canRedo,
  });
  showLightRigs = (): void => lightRigPanel.update(sync.scene);
  showLightRigs();

  // ---- SURFACE-LIGHTING-01: finished lighting set-ups (Skulpturlägen) with pixel-scaled occlusion and contact shadows, one Undo step.
  let surfaceLookApplied: Scene | undefined;
  const surfaceLookPanel = new SurfaceLookPanel(lightsBox, {
    onApply(lookId) {
      if (rendering || picking || discoveryGpuActive || gpuLost) { surfaceLookPanel.setStatus('Wait until the ongoing work is finished and try again.'); return; }
      if (spotAim.index !== null || spotAim.busy || focusPick.armed || focusPick.busy) { surfaceLookPanel.setStatus('End the light target or the focus pick first (Esc).'); return; }
      const refusal = planSurfaceLook(sync.scene, lookId);
      if (refusal) { surfaceLookPanel.setStatus(refusal); return; }
      pause();
      const subject = subjectReference(sync.scene.camera, measuredPoint());
      const filmHeight = outputSize(sync.scene.render, windowAspect()).height;
      const next = applySurfaceLook(sync.scene, lookId, { subjectDistance: subject?.distance ?? 1, filmHeight });
      sync.editWithUndo(() => next); surfaceLookApplied = sync.scene;
      surfaceLookPanel.setStatus(`${SURFACE_LOOKS.find((l) => l.id === lookId)!.name} is applied (subject distance ${subject ? subject.distance.toPrecision(3) : 'unknown, 1'}, picture height ${filmHeight} pixels). One Undo step. Light, occlusion, contact shadows and tone curve are changed; geometry, camera and colours are untouched. If the picture looks too dark or bright for this particular subject: press Fit exposure.`);
      showAll();
    },
    onSculpt(next) { if (rendering || picking) return; pause(); sync.editWithUndo((s) => ({ ...s, details: { ...s.details, sculpt: next } })); surfaceLookApplied = undefined; showAll(); },
    async onFitExposure() {
      if (rendering || picking || discoveryGpuActive || gpuLost) { surfaceLookPanel.setStatus('Wait until the ongoing work is finished and try again.'); return; }
      pause();
      const scene = sync.scene, film = outputSize(scene.render, windowAspect()), w = 320, h = Math.max(16, Math.round((320 * film.height) / film.width));
      surfaceLookPanel.setStatus('Measuring the brightness of the picture …');
      const abort = new AbortController();
      try {
        const fit = await withProgressiveEngine(sync.view, abort.signal, async (eng) => {
          const layers = await eng.renderLayersToBuffer(w, h, { quality: { ...qualityValues({ geometry: 'standard', shadows: 32 }), samples_per_pixel: 1 }, dofMode: 'off', denoise: false, referenceFilm: { width: w, height: h } } as never);
          return fitExposure(layers.linear!, layers.depth, scene.display ?? defaultDisplay());
        });
        if (!Number.isFinite(fit.median)) { surfaceLookPanel.setStatus('Found too little surface in the picture to measure the brightness. No change.'); return; }
        sync.editWithUndo((s) => ({ ...s, display: { ...(s.display ?? defaultDisplay()), exposure: fit.exposure } })); surfaceLookApplied = undefined;
        surfaceLookPanel.setStatus(`Exposure is set to ${fit.exposure.toFixed(2)} stops (the median tone of the surface became about 70 of 255). One Undo step.`);
        showAll();
      } catch (e) { surfaceLookPanel.setStatus(`The measurement failed: ${String(e instanceof Error ? e.message : e)}`); }
    },
    onUndo() { if (rendering || picking || surfaceLookApplied !== sync.scene) return; pause(); if (sync.undo()) { showAll(); surfaceLookPanel.setStatus('The mode is undone.'); } },
    canUndo: () => surfaceLookApplied === sync.scene && sync.canUndo,
  });
  // ---- LOOKDEV-05: Ljus och skugga. Shadow reach, key light against fill, shadow depth, ambient light and softness for any lighting, one Undo step each.
  const lightDirectionPanel = new LightDirectionPanel({
    onChange(change) {
      if (rendering || picking || discoveryGpuActive || gpuLost) { lightDirectionPanel.setStatus('Wait until the ongoing work is finished and try again.'); return; }
      if (spotAim.index !== null || spotAim.busy || focusPick.armed || focusPick.busy) { lightDirectionPanel.setStatus('End the light target or the focus pick first (Esc).'); return; }
      pause();
      const subject = subjectReference(sync.scene.camera, measuredPoint());
      const filmHeight = outputSize(sync.scene.render, windowAspect()).height;
      try {
        const next = applyLightDirection(sync.scene, change, { subjectDistance: subject?.distance ?? 1, filmHeight });
        sync.editWithUndo(() => next); surfaceLookApplied = undefined; showAll();
      } catch (e) { lightDirectionPanel.setStatus(`The change could not be made: ${String(e instanceof Error ? e.message : e)}`); }
    },
  });
  surfaceLookPanel.root.after(lightDirectionPanel.root);
  const showSurfaceLooks = (): void => { surfaceLookPanel.update(sync.scene); lightDirectionPanel.update(sync.scene); };
  showSurfaceLooks(); window.setInterval(showSurfaceLooks, 700);

  // ---- ARTIST-LOOKS-03: saved Looks (material, optional gradient, a lighting rig template, optional fog). A Look never holds
  // camera framing or depth of field. Trying is a render-only layer; only "Applicera Look" writes, as one Undo step.
  const lookSubject = () => subjectReference(sync.scene.camera, measuredPoint());
  const lookPanel = new LookPanel(lightsBox, {
    scene: () => sync.scene,
    subject: lookSubject,
    capture: (choice) => captureLook(sync.scene, choice, lookSubject()),
    host: {
      scene: () => sync.scene,
      subject: lookSubject,
      begin: (apply, onEnd, bind) => sync.setAudition(apply, onEnd, bind, 'look'),
      end: () => sync.clearAudition(),
      commit: (next) => { pause(); sync.editWithUndo(() => next); showAll(); },
      busy: () => rendering || picking || discoveryGpuActive || gpuLost || spotAim.index !== null || spotAim.busy || focusPick.armed || focusPick.busy,
      undo: () => { if (rendering || picking) return false; pause(); const ok = sync.undo(); if (ok) showAll(); return ok; },
      canUndo: () => sync.canUndo,
    },
  });
  showLooks = (): void => lookPanel.update(sync.scene);
  showLooks();

  // ---- ARTIST-SCALE-02: focus on a picked surface without moving the camera, and scale-aware depth of field.
  // Focus uses the same real surface query and displayed-film mapping as the spot-light aim (LIGHT-02A) and changes only
  // camera.dof. The double-click focus above is untouched: it moves camera.target (the orbit pivot) and so recomposes.
  const dofFilm = () => outputSize(sync.scene.render, windowAspect());
  const afterDofEdit = (): void => { cameraPanel.update(sync.scene, windowAspect()); showDof?.(); quality.touch(performance.now()); };
  const dofPanel = new DofPanel(document.getElementById('camera-panel')!, {
    onFocusHere: () => startFocusPick(),
    onCancelFocus: () => focusPick.cancel(),
    onEnabled(enabled) {
      if (rendering || picking) return;
      pause(); cancelDof();
      sync.editWithUndo(s => ({ ...s, camera: { ...s.camera, dof: { ...(s.camera.dof ?? defaultDof()), enabled } } }));
      afterDofEdit();
    },
    onRelative(relative, begin) {
      if (rendering || picking) return;
      pause(); cancelDof();
      try {
        // Checked first: an unusable focus distance or field of view must never turn into an edit with extreme blur.
        const checked = withRelativeAperture(sync.scene, relative, dofFilm());
        const apply = (s: Scene): Scene => withRelativeAperture(s, relative, dofFilm()).scene;
        // The first change of a drag is the Undo step; the rest of the drag edits the same scene on top of it.
        if (begin) sync.editWithUndo(apply); else sync.edit(apply);
        dofPanel.setStatus(checked.limited ? 'The aperture was limited by the upper bound of the schema.' : '');
      } catch (e) { dofPanel.setStatus('Depth of field was not changed: ' + (e instanceof Error ? e.message : String(e))); return; }
      afterDofEdit();
    },
    onUndo() { if (rendering || picking) return; pause(); focusPick.cancel(); if (sync.undo()) showAll(); showDof?.(); },
    onRedo() { if (rendering || picking) return; pause(); focusPick.cancel(); if (sync.redo()) showAll(); showDof?.(); },
    canUndo: () => sync.canUndo,
    canRedo: () => sync.canRedo,
    film: dofFilm,
    previewHeight: () => spotAimView()?.film?.height ?? null,
  });
  showDof = (): void => dofPanel.update(sync.scene, sync.scene.render.quality.samples_per_pixel);
  const focusPick = new FocusPick({
    scene: () => sync.scene, rect: spotAimRect,
    available: () => !rendering && !picking && !discoveryGpuActive && !gpuLost && sync.view === sync.scene,
    async pick(p) {
      picking = true; pause(); cancelDof();
      try {
        while (previewBusy || mainAuxBusy) await new Promise(resolve => setTimeout(resolve, 16));
        await sync.flush();
        if (gpuLost || rendering) throw Error('GPU not available');
        return await pickSurface(p.width, p.height, p.x, p.y);
      } finally { picking = false; renderedKey = ''; quality.touch(performance.now()); }
    },
    commit(next) { sync.editWithUndo(() => next); afterDofEdit(); },
    changed: updateFocusPick,
  });
  function startFocusPick(): void {
    if (rendering || picking || discoveryGpuActive || gpuLost) { dofPanel.setStatus('Wait until the ongoing work is finished and try again.'); return; }
    if (spotAim.index !== null || spotAim.busy) { dofPanel.setStatus('End the light target first (Esc).'); return; }
    pause(); flightClock.pause(); fly?.setActive(false); primitivePanel.cancelPlacement();
    if (spotAimView() === null) {
      dofPanel.setStatus(sync.scene.geometryDetail?.enabled ? 'Surface picking is not supported with Geometry Detail. No change.' : 'The preview has an older camera or geometry. Update the picture before picking a surface.');
      return;
    }
    focusPick.start();
  }
  function updateFocusPick(): void {
    dofPanel.setPicking(focusPick.armed, focusPick.busy);
    dofPanel.setStatus(focusPick.message);
    if (focusPick.armed) canvas.style.cursor = 'crosshair'; else if (spotAim.index === null) canvas.style.cursor = '';
  }
  for (const surface of [canvas, lookDev.surface]) surface.addEventListener('pointerdown', event => {
    const e = event as PointerEvent;
    if (!focusPick.armed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.button === 0) void focusPick.at(e.clientX, e.clientY);
  }, { capture: true });
  // "Undersök insidan": while the plane is explored the camera stays where it is (no orbit, pan or zoom), so the pictures can be compared.
  for (const surface of [canvas, lookDev.surface]) for (const type of ['pointerdown', 'wheel']) surface.addEventListener(type, event => {
    if (!cutbookLocked) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, passive: false });
  // "Material från bilden": while armed, the next click on the picture is the pick (and nothing else, so the camera does not move).
  for (const surface of [canvas, lookDev.surface]) surface.addEventListener('pointerdown', event => {
    const e = event as PointerEvent;
    if (!materialPickClick) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const cb = materialPickClick; materialPickClick = null; canvas.style.cursor = '';
    if (e.button === 0) cb(e.clientX, e.clientY);
  }, { capture: true });
  canvas.addEventListener('dblclick', e => { if (focusPick.armed || focusPick.busy) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true });
  canvas.addEventListener('pointercancel', () => { if (focusPick.armed || focusPick.busy) focusPick.cancel(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (focusPick.armed || focusPick.busy)) { focusPick.cancel(); e.preventDefault(); } });
  window.addEventListener('blur', () => { if (focusPick.armed || focusPick.busy) focusPick.cancel(); });
  showDof();
  showAll();
  scheduleTiming();
  // ARTIST-UX-02 phase A: after every panel exists. Only reads and groups the existing controls.
  const settingsNavigator=new SettingsNavigator(document.getElementById('controls')!,document.getElementById('panel-toggle') as HTMLButtonElement,[{root:document.getElementById('preview-access')!,group:'Preview & rendering'}]);
  installFineControl(document.getElementById('settings-nav')!); // Finjustering: finer arrows and sliders (fineControl.ts)

  // ---- ARTIST-UX-REDESIGN-01: the artist-first shell. It only chooses which existing panels are visible and offers macros/presets
  // that are ordinary scene edits through the same one-step history; it holds no scene data of its own.
  const shellBusy=()=>rendering||picking||discoveryGpuActive||gpuLost||spotAim.index!==null||spotAim.busy||focusPick.armed||focusPick.busy||sync.auditioning;
  new ArtistShell({
    scene:()=>sync.scene,formulas:()=>library.formulas,gradients:()=>allGradients(),busy:shellBusy,
    commit(next){pause();sync.editWithUndo(()=>next);showAll();quality.touch(performance.now());},
    canUndo:()=>sync.canUndo&&!rendering&&!picking,canRedo:()=>sync.canRedo&&!rendering&&!picking,
    undo(){if(rendering||picking)return;pause();exitMathematics();if(sync.undo()){showAll();orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);}quality.touch(performance.now());},
    redo(){if(rendering||picking)return;pause();exitMathematics();if(sync.redo()){showAll();orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);}quality.touch(performance.now());},
    capture(){
      if(shellBusy())throw Error('Wait until the ongoing work is finished.');
      pause();fly?.setActive(false);
      return {scene:sync.view,film:outputSize(sync.view.render,windowAspect())};
    },
    renderBar:()=>renderBar.root,
    async render(scene,size,options){await lookDev.whenIdle(options.signal);return renderLookPreview(scene,size,options,()=>{});},
    message:(text)=>{showMessage(text);window.setTimeout(()=>{if(message.textContent===text)message.hidden=true;},7000);},
    openVariations:()=>{void variationsPanel.open();},
    starter:()=>starterScene(library.formulas,gradientLib.gradients),
  },document.getElementById('controls')!,settingsNavigator,document.getElementById('panel-toggle') as HTMLButtonElement);
  // One button in the top bar (the shell exists now) (visible from every tab): drag a rectangle, only that area is drawn at the real final size and quality (with Geometry Detail when the scene has it on).
  {
    const regionButton=document.createElement('button');regionButton.type='button';regionButton.id='render-region';regionButton.textContent='Render region';
    regionButton.title='Drag a rectangle over a detail in the picture. Only that area is drawn, at the real resolution and quality of the final picture (with Geometry Detail if it is on). Esc cancels.';
    regionButton.className='shell-region-button';
    regionButton.onclick=()=>detailView.pickArea();
    const bar=document.getElementById('artist-bar');if(bar)(bar.querySelector('.shell-spacer')??bar.lastElementChild)?.after(regionButton);else document.body.append(regionButton);
  }

  let dragging = false;
  let panning = false;
  // One mouse drag or one run of wheel turns is ONE Undo step: the first move of the gesture is the step, the rest edits the same scene on top of it.
  let cameraGesture = false, cameraGestureTimer = 0;
  const endCameraGesture = (): void => { cameraGesture = false; window.clearTimeout(cameraGestureTimer); };
  const moveCamera = (wheel = false): void => {
    cancelDof();
    pause();
    const change = (s: Scene): Scene => ({ ...s, camera: { ...s.camera, ...orbit.toSceneCamera(s.camera.fov_degrees) } });
    if (cameraGesture) sync.edit(change); else { cameraGesture = true; sync.editWithUndo(change); }
    if (wheel) { window.clearTimeout(cameraGestureTimer); cameraGestureTimer = window.setTimeout(endCameraGesture, 700); }
    navigation.update(sync.scene.camera);
    quality.touch(performance.now());
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if(primitivePanel.placementRequest&&e.button===0){e.preventDefault();void placeAtPointer(e);return;}
    if(rendering||picking||sync.scene.composition?.locked)return;
    pause();canvas.focus({preventScroll:true});
    cancelDof();
    dragging = true;
    quality.hold(true, performance.now());
    panning = e.button === 2 || e.shiftKey;
    canvas.setPointerCapture(e.pointerId);
  });
  const releaseView = (): void => {
    dragging = false; endCameraGesture();
    quality.hold(false, performance.now());
  };
  canvas.addEventListener("pointerup", releaseView);
  canvas.addEventListener("pointercancel", releaseView);
  canvas.addEventListener("lostpointercapture", () => { if(dragging)releaseView(); });
  window.addEventListener('blur', releaseView);
  // Camera/FOV and parameter sliders also produce continuous edits. Holding keeps NAV active even between input events.
  let controlDrag = false;
  document.addEventListener('pointerdown', e => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') {
      controlDrag = true;
      quality.hold(true, performance.now());
    }
  });
  const releaseControl = (): void => {
    if (controlDrag) {
      controlDrag = false;
      quality.hold(false, performance.now());
    }
  };
  document.addEventListener('pointerup',releaseControl);
  document.addEventListener('pointercancel',releaseControl);
  window.addEventListener('blur',releaseControl);
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || rendering || sync.scene.composition?.locked) return;
    if(fly?.active&&!panning){cancelDof();sync.edit(s=>({...s,camera:flyLook(s.camera,-e.movementX*.003*navigation.settings.sensitivity,-e.movementY*.003*navigation.settings.sensitivity)}));orbit.setFromSceneCamera(sync.scene.camera);navigation.update(sync.scene.camera);quality.touch(performance.now());return;}
    if (panning) orbit.pan(e.movementX * navigation.settings.speed, e.movementY * navigation.settings.speed, sync.scene.camera.projection==='orthographic' ? (sync.scene.camera.ortho_height??4)/canvas.clientHeight : undefined);
    else orbit.rotate(-e.movementX * 0.005 * navigation.settings.speed, e.movementY * 0.005 * navigation.settings.speed);
    moveCamera();
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (rendering || picking || discoveryGpuActive || sync.scene.composition?.locked) return;
      pause();
      if(fly?.active){fly.adjustSpeed(e.deltaY);return;}
      const factor=dollyFactor(e.deltaY, e.deltaMode, navigation.settings, e.shiftKey, e.ctrlKey);
      if(sync.scene.camera.projection==='orthographic')sync.edit(s=>({...s,camera:{...s.camera,ortho_height:Math.max(1e-9,Math.min(1e6,(s.camera.ortho_height??4)*factor))}}));
      else if(navigation.settings.wheel==='fly'&&!e.altKey){
        // Fly: the focus point travels with the camera, so every step is as long as the one before it (see flyWheelTarget). Alt + wheel is the old behaviour: it changes the distance
        // to the focus point, which is also the length of the steps.
        orbit.target=flyWheelTarget(orbit.position(),orbit.target,orbit.distance,factor);
      }else orbit.zoom(factor);
      moveCamera(true);
    },
    { passive: false },
  );

  let previewBusy = false;
  async function placeAtPointer(e:PointerEvent){
    if(rendering||picking||discoveryGpuActive)return;
    const request=primitivePanel.placementRequest;if(!request)return;
    const scene=sync.scene,rect=canvas.getBoundingClientRect();
    picking=true;pause();cancelDof();primitivePanel.setPlacementNote('Searching for the exact surface…');
    try{
      while(previewBusy)await new Promise(resolve=>setTimeout(resolve,16));
      await sync.flush();
      if(scene!==sync.scene||request!==primitivePanel.placementRequest||rendering)return;
      const hit=await pickSurface(rect.width,rect.height,e.clientX-rect.left,e.clientY-rect.top,request.id);
      if(scene!==sync.scene||request!==primitivePanel.placementRequest||rendering)return;
      if(hit)primitivePanel.placeAt(hit);else primitivePanel.setPlacementNote('No surface was hit. Click a surface or cancel with Esc.');
    }catch(error){primitivePanel.setPlacementNote(`Placement failed: ${error instanceof Error?error.message:String(error)}`);}
    finally{picking=false;renderedKey='';quality.touch(performance.now());}
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&primitivePanel.placementRequest){primitivePanel.cancelPlacement();e.preventDefault();}});
  canvas.addEventListener('pointercancel',()=>{if(primitivePanel.placementRequest)primitivePanel.cancelPlacement();});
  canvas.addEventListener('dblclick', e => {
    if(primitivePanel.placementRequest)return;
    if (rendering || picking || discoveryGpuActive || sync.scene.composition?.locked) return;
    cancelDof();
    picking = true; pause(); navigation.status.textContent = 'Searching for the surface point…';
    const scene = sync.view;
    const rect = canvas.getBoundingClientRect();
    const width = canvas.width, height = canvas.height;
    const x = Math.max(0,Math.min(width-1,Math.floor((e.clientX-rect.left)/rect.width*width)));
    const y = Math.max(0,Math.min(height-1,Math.floor((e.clientY-rect.top)/rect.height*height)));
    void (async () => {
      try {
        // The viewport may have one in-flight frame; finish it before touching its shared uniforms.
        while (previewBusy) await new Promise(resolve => setTimeout(resolve, 16));
        if (scene !== sync.view || rendering) return;
        await sync.flush();
        if (scene !== sync.view || rendering) return;
        const point = await pickFocus(engine, scene, width, height, x, y);
        if (scene !== sync.view || rendering) return; // stale depth must never change a newer camera
        if (point) {
          sync.edit(s => ({ ...s, camera: { ...s.camera, target: point } }));
          orbit.setFromSceneCamera(sync.scene.camera); navigation.update(sync.scene.camera);
          navigation.status.textContent = 'Focus set on the surface.';
        } else navigation.status.textContent = 'No surface was hit. The focus is kept.';
      } catch (err) { navigation.status.textContent = 'Focus: ' + (err instanceof Error ? err.message : String(err)); }
      finally { picking = false; renderedKey = ''; quality.touch(performance.now()); }
    })();
  });
  // "Mät från bildmitten": the same real surface query as double-click focus, but it only records a distance for the
  // relative controls. It changes neither the camera nor the scene, so there is nothing to undo.
  measureSubject = (): void => {
    if (rendering || picking || discoveryGpuActive || gpuLost) { fogPanel.setStatus('Wait until the ongoing work is finished and try again.'); return; }
    cancelDof();
    picking = true; pause();
    const scene = sync.view;
    const width = canvas.width, height = canvas.height;
    const x = Math.floor(width / 2), y = Math.floor(height / 2);
    void (async () => {
      try {
        while (previewBusy) await new Promise(resolve => setTimeout(resolve, 16));
        if (scene !== sync.view || rendering) return;
        await sync.flush();
        if (scene !== sync.view || rendering) return;
        const point = await pickFocus(engine, scene, width, height, x, y);
        if (scene !== sync.view || rendering) return; // a stale depth must never describe a newer scene
        if (point) { measuredSubject = { point, scene: sync.scene }; fogPanel.setStatus('Subject distance measured on the surface in the centre of the picture.'); }
        else fogPanel.setStatus('No surface in the centre of the picture. The subject distance is unchanged.');
      } catch (err) { fogPanel.setStatus('Measurement: ' + (err instanceof Error ? err.message : String(err))); }
      finally { picking = false; renderedKey = ''; quality.touch(performance.now()); showFog?.(); }
    })();
  };
  // "Mät bildens djup": a coarse depth grid (64 columns) of the current picture, the same engine query as the surface pick. Changes nothing in the
  // scene; the result is only the near/far depth that the fog controls are written against (engine/fogDepth.ts).
  measureDepth = async (): Promise<DepthRange | null> => {
    if (rendering || picking || discoveryGpuActive || gpuLost) throw new Error('Wait until the ongoing work is finished and try again.');
    cancelDof();
    picking = true; pause();
    const scene = sync.view;
    try {
      while (previewBusy) await new Promise(resolve => setTimeout(resolve, 16));
      if (scene !== sync.view || rendering) return null;
      await sync.flush();
      if (scene !== sync.view || rendering) return null;
      const columns = 64, rows = Math.max(8, Math.round(columns * canvas.height / Math.max(1, canvas.width)));
      const layers = await engine.renderLayersToBuffer(columns, rows, { quality: { samples_per_pixel: 1 }, debugView: 'raw' });
      if (scene !== sync.view || rendering) return null; // a stale depth must never describe a newer view
      const range = depthRangeOf(layers.depth);
      measuredDepth = range ? { range, scene: sync.scene } : null;
      return range;
    } finally { picking = false; renderedKey = ''; quality.touch(performance.now()); showFog?.(); }
  };
  let observedScene: Scene | null = null;
  let observedWorkload = '';
  let renderedKey = '';
  let activeViewportState = '';
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    updateSpotAim();
    artistPreview.observe(sync.view);
    lookbook.observe();
    lookDev.observe(sync.view,rendering||picking||gpuLost||lookbook.busy,rendering);
    progressive.observe();
    detailView.observe();
    if (rendering || picking || gpuLost) return; // the picture is busy or the device needs an explicit restart

    const flightClip=sync.scene.cameraFlight;
    if(flightClip&&flightClock.tick(now,flightClip))flightSeek(flightClock.time);
    const flown=fly?.tick(now,sync.scene.camera);
    if(flown){cancelDof();sync.edit(s=>({...s,camera:flown}));orbit.setFromSceneCamera(flown);navigation.update(flown);quality.touch(now);}
    const moving=flightClock.playing||!!fly?.moving||now-flightTouched<180;
    if(moving){if(quality.mode!=='navigate')quality.setMode('navigate');motionPreview=true;}
    else if(motionPreview){quality.setMode(lookDev.fast?'automatic':viewportMode.value as ViewportMode);motionPreview=false;}
    flightUpdate();

    if (playing) {
      time += (now - lastTick) / 1000;
      lastTick = now;
      if (time > sync.scene.animation.duration_seconds) time = 0; // loops
      sync.edit((s) => evaluateAnimation(s, time, timing.timing));
      quality.touch(performance.now()); // coarser picture keeps playback smooth
      syncLive();
    }

    if (sync.scene !== observedScene) {
      cancelDof();applyFraming();
      // Keep learning during parameter dragging; reset when the chain/effect workload changes structurally.
      const workload = JSON.stringify([
        sync.scene.primitives,
        sync.scene.content.map(c => [c.chain.map(s => [s.formula, s.iterations]), c.rounds, c.mode, c.execution]),
        sync.scene.lights.map(l => [l.enabled, l.type, l.shadows]),
        sync.scene.material,
        sync.scene.reflections,
        renderDetailsCostKey(sync.scene.cutout, sync.scene.details),
        sync.scene.environment.kind,
      ]);
      if (workload !== observedWorkload) {
        quality.resetCost();
        finalPreview.resetCost();
        observedWorkload = workload;
      }
      observedScene = sync.scene;
      quality.touch(now);
    }
    quality.idleMs = sync.scene.camera.dof?.enabled && sync.scene.camera.projection!=='orthographic' ? 80 : 400;
    const plan = quality.plan(now, sync.scene.render.quality);
    if (plan.state==='navigate')cancelDof();
    if (plan.state !== activeViewportState) {
      if (plan.state === 'navigate') fps.reset();
      activeViewportState = plan.state;
    }
    const stateLabel = plan.state === 'navigate' ? 'EXPLORE' : plan.state === 'lookdev' ? 'INSPECT' : 'FINAL';
    if (plan.state !== 'navigate') fpsLabel.textContent = lookDev.fast?'Simplified view':stateLabel;
    else if (!fpsLabel.textContent?.startsWith('EXPLORE')) fpsLabel.textContent = 'EXPLORE …';
    if(lookDev.holdsViewport){boxGizmo.update(sync.view,!rendering);fpsLabel.textContent=lookDev.fast?'Explore · simplified view':'Inspection · still picture';return;}
    if (previewBusy||discoveryGpuActive||mainAuxBusy) return; // Never build a queue of expensive, already obsolete views.
    const dpr = window.devicePixelRatio || 1;
    const epoch = JSON.stringify([
      plan.generation,
      canvas.clientWidth,
      canvas.clientHeight,
      dpr,
    ]);
    if (plan.state === "final" && epoch !== finalEpoch) {
      finalEpoch = epoch;
      finalPreview.invalidate();
      accumulator.dispose();
      firstPreviewMs = null;
      previewStarted = now;
    }
    const finalPass =
      plan.state === "final"
        ? finalPreview.plan(
            canvas.clientWidth,
            canvas.clientHeight,
            dpr,
            sync.scene.render.quality,
            sync.scene.details,
          )
        : null;
    if (plan.state === "final" && !finalPass && !profileRequested) return;
    if (
      finalPass &&
      finalPass.sequence !== lastFinalPass?.sequence &&
      finalPass.approximation &&
      firstPreviewMs !== null &&
      quality.isInteracting(now)
    )
      return;
    boxGizmo.update(sync.view,!rendering);
    const k = plan.scale * dpr;
    const w = finalPass?.width ?? Math.max(1, Math.floor(canvas.clientWidth * k));
    const h = finalPass?.height ?? Math.max(1, Math.floor(canvas.clientHeight * k));
    const key = JSON.stringify([w, h, plan.state, plan.quality, plan.features, debugView,finalPass?.sequence]);
    const needsDof=plan.state!=='navigate' && sync.scene.camera.dof?.enabled && sync.scene.camera.projection!=='orthographic' && debugView==='off';
    if (!profileRequested && plan.state !== 'navigate' && key === renderedKey && !sync.hasChanges && !(needsDof && dofPreview.hidden)) return;
    if (w !== canvas.width || h !== canvas.height) engine.resize(w, h);
    previewBusy = true;
    canvas.dataset.previewBusy='true';canvas.dataset.previewStarted=String(Number(canvas.dataset.previewStarted??0)+1);
    void (async () => {
      const scene = sync.view;
      try {
        lookDev.preparingFast(true);
        await syncPictures(scene);
        await sync.flush();
        if (rendering || scene !== sync.view || plan.generation !== quality.plan(performance.now(), sync.scene.render.quality).generation) return;
        engine.setPreviewQuality(plan.quality);
        engine.setPreviewFeatures(plan.features);
        const started = performance.now();
        if (profileRequested && plan.state === "final") {
          profileRequested = false;
          previewAbort = new AbortController();
          diagnostics.profiling();
          const size = previewSize(canvas.clientWidth, canvas.clientHeight, 1, 57600),
            cost = lastFinalPass ?? finalPass;
          const rows = await profilePreview(
            engine,
            size.width,
            size.height,
            {
              quality: cost?.quality ?? scene.render.quality,
              features: cost?.features,
            },
            cost?.details ?? scene.details,
            previewAbort.signal,
          );
          if (
            scene === sync.view &&
            plan.generation ===
              quality.plan(performance.now(), sync.scene.render.quality).generation
          )
            diagnostics.showProfile(rows, size.width, size.height);
          return;
        } else if (finalPass) {
          previewAbort = new AbortController();
          const signal = previewAbort.signal,
            timings: RenderTiming[] = [];
          const options = {
            referenceFilm:outputSize(scene.render,canvas.clientWidth/canvas.clientHeight),
            denoise:false,
            quality: finalPass.quality,
            details: finalPass.details,
            features: finalPass.features,
            dofSamples: 1,
            sampleOffset: finalPass.sampleOffset,
            tilePixels: finalPass.tilePixels,
            signal,
            debugView,
            onTiming: (t: RenderTiming) => timings.push(t),
          };
          const hasDof =
            scene.camera.dof?.enabled &&
            scene.camera.projection !== "orthographic" &&
            debugView === "off";
          let image,
            processorMs = 0,denoiseGpuMs=0;
          if (finalPass.approximation && hasDof) {
            const layers = await engine.renderLayersToBuffer(w, h, {
                ...options,
                dofMode: "off",
              }),
              processStarted = performance.now();
            image = await applyPreviewDof(
              layers,
              scene.camera,
              scene.render.fov_axis,
              signal,
            );
            processorMs = performance.now() - processStarted;
          } else {
            const denoiseWanted=!finalPass.approximation&&scene.denoise?.enabled&&debugView==='off';
            if(!finalPass.approximation){
              const accKey=JSON.stringify([finalPass.generation,w,h,finalPass.quality,finalPass.details,options.referenceFilm]);
              if(accKey!==accumulatorEpoch){accumulator.dispose();previewGuides=null;accumulatorEpoch=accKey;}
            }
            const sampleOptions={
              ...options,
              dofMode: hasDof && !finalPass.approximation ? "physical" : "off",
            } as const;
            if(denoiseWanted&&!previewGuides){previewGuides=await engine.renderLayersToBuffer(w,h,sampleOptions);image={width:w,height:h,data:previewGuides.color,linear:previewGuides.linear,display:previewGuides.display};}
            else image=await engine.renderToBuffer(w,h,sampleOptions);
            if (!finalPass.approximation) {
              const result = await accumulator.add(image, signal);
              image = result.image;
              processorMs = result.milliseconds;
              if(denoiseWanted&&previewGuides&&finalPass.sampleOffset>=3){
                const filterStart=performance.now();image=await engine.denoiseBuffer({...previewGuides,color:image.data,linear:image.linear,display:image.display},{signal,onTiming:t=>{denoiseGpuMs+=t.gpuMs;}});processorMs+=performance.now()-filterStart;
              }
            }
          }
          if (
            signal.aborted ||
            scene !== sync.view ||
            plan.generation !==
              quality.plan(performance.now(), sync.scene.render.quality).generation
          )
            return;
          const presentationStarted = performance.now();
          dofPreview.width = w;
          dofPreview.height = h;
          const pixels = new Uint8ClampedArray(
            image.data.buffer as ArrayBuffer,
            image.data.byteOffset,
            image.data.byteLength,
          );
          dofPreview
            .getContext("2d")!
            .putImageData(new ImageData(pixels, w, h), 0, 0);
          dofPreview.hidden = false;
          firstPreviewMs ??= performance.now() - previewStarted;
          const wallMs = performance.now() - started;
          diagnostics.show(
            finalPass,
            timings,
            wallMs,
            firstPreviewMs,
            processorMs,
            performance.now() - presentationStarted,
            denoiseGpuMs,
          );
          lastFinalPass = finalPass;
          // Cold pipeline compilation is a one-time latency, not a recurring
          // viewport cost. Adapt using completed GPU/readback/copy + worker work.
          const budgetMs = timings.reduce((n, t) => n + t.wallMs, 0) + processorMs + performance.now() - presentationStarted;
          finalPreview.complete(finalPass, budgetMs);
          previewAbort = null;
        } else if (
          plan.state !== "navigate" &&
          scene.camera.dof?.enabled &&
          scene.camera.projection !== "orthographic" &&
          debugView === "off"
        ) {
          previewAbort = new AbortController();
          const image = await applyPreviewDof(
            await engine.renderLayersToBuffer(w, h, {
              quality: { ...plan.quality, samples_per_pixel: 1 },
              dofMode: "off",
              signal: previewAbort.signal,
            }),
            scene.camera,
            scene.render.fov_axis,
            previewAbort.signal,
          );
          if (
            scene !== sync.view ||
            plan.generation !==
              quality.plan(performance.now(), sync.scene.render.quality).generation
          )
            return;
          dofPreview.width = w;
          dofPreview.height = h;
          const pixels = new Uint8ClampedArray(
            image.data.buffer as ArrayBuffer,
            image.data.byteOffset,
            image.data.byteLength,
          );
          dofPreview
            .getContext("2d")!
            .putImageData(new ImageData(pixels, w, h), 0, 0);
          dofPreview.hidden = false;
          if(lookDev.fast&&scene===sync.view)lookDev.presentViewport(dofPreview,scene,plan,performance.now()-started);
          previewAbort = null;
        } else {
          lookDev.preparingFast();
          engine.render();
          const fastFrame=lookDev.captureViewport();
          await engine.waitForPreview();
          if(lookDev.fast&&fastFrame){
            if(scene!==sync.view||plan.generation!==quality.plan(performance.now(),sync.scene.render.quality).generation)return;
            lookDev.presentViewport(fastFrame,scene,plan,performance.now()-started);
          }
        }
        lastPresentedScene=scene;{const r=canvas.getBoundingClientRect();lastPresentedAspect=r.width/r.height;}presentedView=structuredClone({camera:scene.camera,fov_axis:scene.render.fov_axis});canvas.dataset.presentedCamera=JSON.stringify(presentedView);canvas.dataset.presentedMathematics=JSON.stringify(scene.content);canvas.dataset.presentedAppearance=JSON.stringify(availableBindings(scene,library.formulas).filter(b=>b.target.kind!=='formula-parameter'&&b.target.kind!=='julia').map(b=>({target:b.target,value:b.value})));canvas.dataset.previewPresented=String(Number(canvas.dataset.previewPresented??0)+1);commitCameraCapture();
        const completed = performance.now();
        canvas.dataset.previewElapsedMs=String(completed-started);canvas.dataset.viewportState=plan.state;
        quality.complete(plan, completed - started);
        if (scene === sync.view && plan.generation === quality.plan(completed, sync.scene.render.quality).generation) renderedKey = key;
        if (plan.state === 'navigate') {
          const rate = fps.tick(completed);
          fpsLabel.textContent = rate > 0 ? `EXPLORE ${rate.toFixed(0)} fps` : 'EXPLORE …';
        }
      } catch (err) {
        if(err instanceof Error && err.name==='AbortError')return;
        showMessage(`Viewport: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        previewBusy = false;
        canvas.dataset.previewBusy='false';canvas.dataset.previewFinished=String(Number(canvas.dataset.previewFinished??0)+1);
      }
    })();
  };
  requestAnimationFrame(frame);
}

start().catch((err: unknown) =>
  (console.error(err), showMessage(`Something went wrong: ${err instanceof Error ? err.message + ' | ' + String(err.stack).split(String.fromCharCode(10)).slice(1, 4).join(' ; ') : String(err)}`)),
);
