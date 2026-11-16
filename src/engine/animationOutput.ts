/** Animation 2.0 production contract. No clocks, preview state, filesystem or legacy evaluator. */
import type { Scene } from './scene';
import { parseScene, resolveScene } from './scene';
import { parseFormula } from './formula/parse';
import { synthesizedLibrary } from './synthesizedFormula';
import { evaluateCameraAtTime } from './cameraFlight';
import { evaluateMathematics, mathematicalTrackDiagnostics, propertyTracks, bindingFor } from './propertyAnimation';
import { checkOutputSize } from './renderSetup';
export const ANIMATION_OUTPUT_VERSION = 1;
export const MAX_SEQUENCE_FRAMES = 100_000;
export interface SequenceOptions {
  width:number; height:number; fps:number; firstFrame:number; lastFrame:number;
  format:'png'|'exr-half'|'exr-float'; prefix:string;
}
export interface AnimationSnapshot { scene:Scene; formulaSources:string[] }
const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
/** Frame zero is t=0; both selected bounds are inclusive. A nonaligned clip end is never rounded up. */
export function lastClipFrame(seconds:number,fps:number):number {
  if(!Number.isFinite(seconds)||seconds<0||!integer(fps,1,120))throw Error('Invalid duration / FPS');
  const n=seconds*fps;if(!Number.isSafeInteger(Math.floor(n)))throw Error('Unsafe frame arithmetic');
  const last=Math.floor(n+Number.EPSILON*Math.max(1,n)*2);if(!Number.isSafeInteger(last)||last>=Number.MAX_SAFE_INTEGER)throw Error('Unsafe terminal frame arithmetic');return last;
}
export function readSequenceOptions(raw:unknown,duration?:number):SequenceOptions {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid sequence settings');
  const o=raw as SequenceOptions;
  if(Object.keys(o).some(k=>!['width','height','fps','firstFrame','lastFrame','format','prefix'].includes(k)))throw Error('Unknown sequence option');
  const size=checkOutputSize(o.width,o.height);if(size)throw Error(size);
  if(!integer(o.fps,1,120)||!integer(o.firstFrame,0,Number.MAX_SAFE_INTEGER-1)||!integer(o.lastFrame,o.firstFrame,Number.MAX_SAFE_INTEGER-1)||o.lastFrame-o.firstFrame>=MAX_SEQUENCE_FRAMES)throw Error('Invalid inclusive frame range / FPS (maximum 100,000 frames per job)');
  if(duration!==undefined&&o.lastFrame>lastClipFrame(duration,o.fps))throw Error('Frame range extends beyond clip');
  if(!['png','exr-half','exr-float'].includes(o.format))throw Error('Unsupported output format');
  if(typeof o.prefix!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(o.prefix)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(o.prefix))throw Error('Use a safe filename prefix: letters, numbers, hyphen or underscore');
  return {...o};
}
export const sequenceFrameCount=(o:SequenceOptions)=>o.lastFrame-o.firstFrame+1;
export function sequenceFrameName(o:SequenceOptions,n:number):string {
  if(!integer(n,o.firstFrame,o.lastFrame))throw Error('Frame outside range');
  // File numbering is absolute timeline frame + 1, including custom in/out ranges.
  return `${o.prefix}_${String(n+1).padStart(Math.max(6,String(o.lastFrame+1).length),'0')}.${o.format==='png'?'png':'exr'}`;
}
export function readAnimationSnapshot(raw:unknown):AnimationSnapshot {
  if(!raw||typeof raw!=='object')throw Error('Invalid animation snapshot');
  const r=raw as AnimationSnapshot;
  if(Object.keys(r).some(k=>!['scene','formulaSources'].includes(k))||!Array.isArray(r.formulaSources)||r.formulaSources.length>32||r.formulaSources.some(t=>typeof t!=='string'||t.length>1_000_000))throw Error('Invalid frozen formula sources');
  const result=parseScene(r.scene);if(!result.ok)throw Error(result.errors.join('; '));
  const snapshot={scene:result.scene,formulaSources:[...r.formulaSources]},formulas=snapshotFormulas(snapshot);
  const resolved=resolveScene(snapshot.scene,formulas);if(!resolved.ok)throw Error(resolved.errors.join('; '));
  const diagnostics=mathematicalTrackDiagnostics(snapshot.scene,formulas);
  if(diagnostics.errors.length)throw Error(diagnostics.errors.join('; '));
  const missing=propertyTracks(snapshot.scene.cameraFlight).filter(t=>snapshot.scene.cameraFlight?.enabled&&t.enabled&&t.keyframes.length&&!bindingFor(snapshot.scene,formulas,t.target));
  if(missing.length)throw Error('Unresolved active tracks: '+missing.map(t=>t.id).join(', '));
  // Other content is currently not rendered by the production engine; never silently promise it here.
  if(snapshot.scene.content.length>1)throw Error('Multiple fractal content entries are unsupported by the final renderer');
  return snapshot;
}
export function snapshotFormulas(snapshot:AnimationSnapshot) {
  const formulas=snapshot.formulaSources.map(text=>{const f=parseFormula(text);if(!f.ok)throw Error(f.errors.join('; '));return f.formula;});
  if(new Set(formulas.map(f=>f.id)).size!==formulas.length)throw Error('Duplicate frozen formula IDs');
  return synthesizedLibrary(snapshot.scene.discoveredFormulas,formulas);
}
export function evaluateSequenceFrame(snapshot:AnimationSnapshot,options:SequenceOptions,n:number):Scene {
  if(!integer(n,options.firstFrame,options.lastFrame))throw Error('Frame outside range');
  const base=snapshot.scene,t=n/options.fps,formulas=snapshotFormulas(snapshot);
  const s=evaluateMathematics(base,t,formulas);
  // Match the 10A–10C artist workspace: composition lock holds the camera, while property tracks still run.
  const view=!base.composition?.locked&&base.cameraFlight&&evaluateCameraAtTime(base.cameraFlight,t,options.width/options.height);
  return {...s,...(view?{camera:view.camera}:{}),render:{...s.render,...(view?{fov_axis:view.fov_axis}:{}),format:{preset:'custom',ratio:[options.width,options.height]},resolution:{width:options.width,height:options.height}}};
}
/** Upper-scale planning only; PNG compression varies and render time is deliberately not guessed. */
export function approximateSequenceBytes(o:SequenceOptions) {return sequenceFrameCount(o)*(o.width*o.height*(o.format==='png'?3:o.format==='exr-half'?8:16)+o.height*16+4096);}
