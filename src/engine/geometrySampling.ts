import type { Vec3 } from './camera';
import type { Engine } from './engine';
import type { Formula } from './formula/types';
import { compileChainCpu } from './formula/cpu';
import { resolveScene, toChainSteps } from './scene';
import type { Scene } from './scene';

/** A signed estimate is not a metric SDF. Only an explicit caller contract allows Lipschitz pruning. */
export type FieldSemantics = 'signed-distance' | 'signed-estimate' | 'unsigned-estimate' | 'unknown-estimate';
export interface GeometryBounds { min: Vec3; max: Vec3 }
export interface FieldBatch { values: Float32Array; valid: Uint8Array }
export interface GeometrySampler {
  id: string;
  semantics: FieldSemantics;
  /** Certified upper bound, absent for fractals. */
  lipschitz?: number;
  sample(points: readonly Vec3[]): Promise<FieldBatch>;
  colors?(positions: Float32Array, normals: Float32Array): Promise<Float32Array>;
}
export interface GeometryDiagnostics {
  semantics: FieldSemantics;
  samples: number;
  invalidSamples: number;
  peakSampleBytes: number;
  warnings: string[];
}
export interface SamplingOptions {
  bounds: GeometryBounds;
  /** Cells on the longest side; proportional counts on the other sides. */
  resolution: number;
  isoLevel: number;
  blockCells?: number;
  maxSamples?: number;
  maxVertices?: number;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}
export const DEFAULT_EXPORT_LIMITS = { maxSamples: 64_000_000, maxVertices: 2_000_000, blockCells: 24 } as const;
export function samplingGrid(options: SamplingOptions) {
  const {min,max}=options.bounds;
  if(![...min,...max,options.isoLevel].every(Number.isFinite)||max.some((n,k)=>n<=min[k]!))throw Error('Invalid geometry bounds or isovalue');
  if(!Number.isInteger(options.resolution)||options.resolution<4||options.resolution>1024)throw Error('Geometry resolution must be 4–1024 cells');
  const spacing=Math.max(...max.map((n,k)=>n-min[k]!))/options.resolution;
  const cells=max.map((n,k)=>Math.ceil((n-min[k]!)/spacing)) as Vec3;
  const step=max.map((n,k)=>(n-min[k]!)/cells[k]!) as Vec3;
  const block=options.blockCells??DEFAULT_EXPORT_LIMITS.blockCells;
  if(!Number.isInteger(block)||block<4||block>64)throw Error('Block size must be 4–64 cells');
  const maxSamples=options.maxSamples??DEFAULT_EXPORT_LIMITS.maxSamples;
  const maxVertices=options.maxVertices??DEFAULT_EXPORT_LIMITS.maxVertices;
  if(!Number.isSafeInteger(maxSamples)||maxSamples<1||maxSamples>DEFAULT_EXPORT_LIMITS.maxSamples||!Number.isSafeInteger(maxVertices)||maxVertices<1||maxVertices>DEFAULT_EXPORT_LIMITS.maxVertices)throw Error('Invalid export resource budget');
  return {cells,step,spacing,block,maxSamples,maxVertices};
}
export function checkCancelled(signal?:AbortSignal):void {if(signal?.aborted)throw Error('Geometry export cancelled');}
/** Own CPU evaluator reports invalid domains, unlike finite GPU miss sentinels. GPU colour evaluation remains reusable. */
export function createFractalSampler(scene:Scene,formulas:readonly Formula[],engine?:Pick<Engine,'colorsAt'>):GeometrySampler {
  const resolved=resolveScene(scene,formulas);if(!resolved.ok)throw Error(resolved.errors.join('; '));
  const evaluate=compileChainCpu(toChainSteps(resolved),resolved.rounds,{mode:resolved.mode,execution:resolved.execution,fieldMaps:scene.formulaFields,round32:true});
  return {id:'fractal',semantics:'unknown-estimate',async sample(points){
    const values=new Float32Array(points.length),valid=new Uint8Array(points.length);
    points.forEach((p,i)=>{const r=evaluate(p,resolved.parameterValues,resolved.chainWeights,resolved.julia[3]?resolved.julia.slice(0,3):null);values[i]=r.dist;valid[i]=!r.invalid&&Number.isFinite(r.dist)&&Math.abs(r.dist)<1e19?1:0;});
    return {values,valid};
  },...(engine?{colors:(p:Float32Array,n:Float32Array)=>engine.colorsAt(scene,p,n)}:{})};
}
/** Optional bounded GPU field source. Existing distanceAt emits a large miss sentinel for
 * invalid formula domains: preserve that as validity=0, never as a synthetic crossing.
 * Caller owns setScene/texture/map readiness and serial access to the engine. */
export function createGpuFractalSampler(scene:Scene,engine:Pick<Engine,'distanceAt'|'colorsAt'>):GeometrySampler {
 return {id:'fractal',semantics:'unknown-estimate',async sample(points){
  const values=await engine.distanceAt(scene,points),valid=Uint8Array.from(values,v=>Number.isFinite(v)&&Math.abs(v)<1e19?1:0);
  return {values,valid};
 },colors:(p,n)=>engine.colorsAt(scene,p,n)};
}
/** Validated source contract; batches cannot silently drop samples or substitute invalid data. */
export async function sampleChecked(sampler:GeometrySampler,points:readonly Vec3[],diagnostics:GeometryDiagnostics,limit:number,signal?:AbortSignal):Promise<FieldBatch>{
  checkCancelled(signal);if(diagnostics.samples+points.length>limit)throw Error('Geometry sample budget exceeded');
  const batch=await sampler.sample(points);checkCancelled(signal);
  if(batch.values.length!==points.length||batch.valid.length!==points.length)throw Error('Geometry sampler returned a mismatched batch');
  diagnostics.samples+=points.length;
  diagnostics.peakSampleBytes=Math.max(diagnostics.peakSampleBytes,points.length*29); // packed value/validity + conservative JS position cost is separate
  for(let i=0;i<points.length;i++){if(!Number.isFinite(batch.values[i])||Math.abs(batch.values[i]!)>=1e19)batch.valid[i]=0;if(!batch.valid[i])diagnostics.invalidSamples++;}
  return batch;
}
