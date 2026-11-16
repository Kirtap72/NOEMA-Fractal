import type {Vec3} from './camera';
import type {GeometryBounds,GeometryDiagnostics,GeometrySampler} from './geometrySampling';
import {checkCancelled,sampleChecked} from './geometrySampling';
import {constructGaussians,encodeGaussianRecords,gaussianPlyHeader,GAUSSIAN_PLY_STRIDE,validateGaussianOptions,MAX_GAUSSIAN_COUNT} from './gaussianExport';
import type {GaussianOptions} from './gaussianExport';
import type {SurfacePoints} from './pointCloud';

export type GaussianQuality='draft'|'balanced'|'high'|'ultra';
export interface AdaptiveGaussianOptions {
 bounds:GeometryBounds;quality?:GaussianQuality;resolution?:number;detailTolerance?:number;isoLevel?:number;
 maxCount?:number;memoryBudgetMiB?:number;fileBudgetMiB?:number;maxSamples?:number;seed?:number;
 withColors?:boolean;baseColor?:Vec3;gaussian?:Partial<GaussianOptions>;signal?:AbortSignal;
 onProgress?(stage:string,done:number,total:number):void;
}
const presets={draft:{resolution:32,depth:1,error:.22},balanced:{resolution:64,depth:2,error:.13},high:{resolution:128,depth:2,error:.08},ultra:{resolution:256,depth:3,error:.05}};
const STRIDE=14,CHUNK=4096,BATCH=512;
/** Packed cell origin/size, surface position/normal, footprint sigma and local fitting error.
 * No mesh, connectivity, triangle CDF or global neighbour map is retained. */
class Patches {
 chunks:Float32Array[]=[];count=0;
 add(record:readonly number[]){if(this.count%CHUNK===0)this.chunks.push(new Float32Array(CHUNK*STRIDE));this.chunks.at(-1)!.set(record,(this.count%CHUNK)*STRIDE);this.count++;}
 get(i:number){return this.chunks[Math.floor(i/CHUNK)]!.subarray(i%CHUNK*STRIDE,(i%CHUNK+1)*STRIDE);}
}
export function estimateAdaptiveGaussians(options:AdaptiveGaussianOptions){
 const quality=options.quality??'balanced';if(!(quality in presets))throw Error('Invalid Gaussian quality');
 const preset=presets[quality],span=Math.max(...options.bounds.max.map((v,k)=>v-options.bounds.min[k]!));
 if(![...options.bounds.min,...options.bounds.max].every(Number.isFinite)||options.bounds.max.some((v,k)=>v<=options.bounds.min[k]!))throw Error('Invalid Gaussian bounds');
 const resolution=options.resolution??preset.resolution,tolerance=options.detailTolerance??span/resolution*preset.error;
 const memory=options.memoryBudgetMiB??512,file=options.fileBudgetMiB??1536,requested=options.maxCount??5_000_000;
 if(!Number.isInteger(resolution)||resolution<4||resolution>1024||!Number.isFinite(tolerance)||tolerance<=0)throw Error('Invalid Gaussian resolution or detail tolerance');
 if(!Number.isFinite(memory)||memory<16||memory>32768||!Number.isFinite(file)||file<1||file>32768||!Number.isSafeInteger(requested)||requested<1||requested>MAX_GAUSSIAN_COUNT)throw Error('Invalid Gaussian memory/file/count budget');
 // Two patch generations + retained leaves + bounded sample/colour/encoding scratch.
 const bytesPerPatch=STRIDE*4*3+16; // Includes refinement ordering and conservative sort scratch.
 const maxCount=Math.min(requested,Math.floor((memory*2**20-8*2**20)/bytesPerPatch),Math.floor((file*2**20-65536)/GAUSSIAN_PLY_STRIDE));
 if(maxCount<1)throw Error('Gaussian budgets cannot hold a single sample');
 const maxSamples=options.maxSamples??500_000_000;
 if(!Number.isSafeInteger(maxSamples)||maxSamples<1||maxSamples>2_000_000_000)throw Error('Invalid Gaussian field sample budget');
 const seed=options.seed??42;if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid Gaussian seed');
 if(options.isoLevel!==undefined&&!Number.isFinite(options.isoLevel))throw Error('Invalid Gaussian isovalue');
 const cells=options.bounds.max.map((v,k)=>Math.ceil((v-options.bounds.min[k]!)/span*resolution)) as Vec3;
 const step=options.bounds.max.map((v,k)=>(v-options.bounds.min[k]!)/cells[k]!) as Vec3;
 return {quality,resolution,tolerance,depth:preset.depth,maxCount,maxSamples,seed,cells,step,
  maximumFileBytes:maxCount*GAUSSIAN_PLY_STRIDE+65536,workingBytes:maxCount*bytesPerPatch+8*2**20,
  baseSamples:cells.reduce((n,v)=>n*(v+1),1),complexity:'Full base lattice, then bounded surface-only subdivision and six field probes per normal'};
}
const corners=Array.from({length:8},(_,i)=>[i&1,(i>>1)&1,(i>>2)&1] as Vec3);
const edges=corners.flatMap((p,i)=>[1,2,4].filter(bit=>!(i&bit)).map(bit=>[i,i|bit] as [number,number]));
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,k)=>s+v*b[k]!,0);
/** Gradient of the cell interpolant, used ONLY for local complexity estimates, never as a metric DE. */
function gradient(values:readonly number[],p:readonly number[],step:readonly number[]):Vec3{
 return [0,1,2].map(axis=>corners.reduce((s,c,i)=>s+values[i]!*(c[axis]?1:-1)*[0,1,2].filter(k=>k!==axis).reduce((w,k)=>w*(c[k]?p[k]!:1-p[k]!),1),0)/step[axis]!) as Vec3;
}
function patch(origin:Vec3,step:Vec3,values:readonly number[],iso:number):number[]|undefined{
 const hits:Vec3[]=[];
 for(const [a,b]of edges){const va=values[a]!-iso,vb=values[b]!-iso;if((va<0)===(vb<0))continue;const t=va/(va-vb);hits.push(corners[a]!.map((v,k)=>v+(corners[b]![k]!-v)*t) as Vec3);}
 if(!hits.length)return;
 const p=[0,1,2].map(k=>hits.reduce((s,h)=>s+h[k]!,0)/hits.length) as Vec3;
 const g=gradient(values,p,step),length=Math.hypot(...g);if(!Number.isFinite(length)||length<1e-16)return;
 const normal=g.map(v=>v/length) as Vec3;let error=0,variation=0;
 for(const h of hits){error=Math.max(error,Math.abs(dot(normal,h.map((v,k)=>(v-p[k]!)*step[k]!))));const n=gradient(values,h,step),l=Math.hypot(...n);if(l>1e-16)variation=Math.max(variation,1-dot(normal,n.map(v=>v/l)));}
 // Footprint comes from local projected cell area, not global point count. Approximate
 // spacing projected onto the tangent plane; sigma overlaps adjacent cells at ~0.7 spacing.
 const area=Math.abs(normal[0])*step[1]*step[2]+Math.abs(normal[1])*step[0]*step[2]+Math.abs(normal[2])*step[0]*step[1];
 const sigma=.7*Math.sqrt(area);
 return [...origin,...step,...p.map((v,k)=>origin[k]!+v*step[k]!),...normal,sigma,Math.max(error,variation*Math.min(...step)*.5)];
}
export interface AdaptiveGaussianReport extends GeometryDiagnostics {
 count:number;baseResolution:number;finestCellSize:number;isoLevel:number;detailTolerance:number;
 refinedCells:number;budgetLimitedCells:number;normalFallbacks:number;projectionFallbacks:number;
 maxCount:number;fileBytes:number;workingBytesUpperBound:number;timings:Record<string,number>;
}
/** Two-stage bounded surface construction. Every base lattice cell is inspected, including
 * unknown/unsigned fields. Only witnessed crossings are refined: sub-lattice features remain uncertain.
 * Refinement replaces a parent atomically; budget exhaustion retains coverage instead of truncating space. */
export async function exportAdaptiveGaussians(sampler:GeometrySampler,options:AdaptiveGaussianOptions,sink:{write(bytes:Uint8Array):Promise<void>}):Promise<AdaptiveGaussianReport>{
 const estimate=estimateAdaptiveGaussians(options),{cells,step}=estimate;
 const gaussian:GaussianOptions={scaleMultiplier:1,opacity:.98,opacityMode:'constant',colorMode:sampler.colors&&options.withColors!==false?'surface-color':'constant',color:options.baseColor??[.65,.65,.65],normalThickness:.035,...options.gaussian};
 validateGaussianOptions(gaussian,!!sampler.colors&&options.withColors!==false);
 const iso=options.isoLevel??0;
 const effectiveIso=iso===0&&sampler.semantics!=='signed-distance'&&sampler.semantics!=='signed-estimate'?estimate.tolerance*.2:iso;
 const report:AdaptiveGaussianReport={semantics:sampler.semantics,samples:0,invalidSamples:0,peakSampleBytes:0,warnings:[],count:0,baseResolution:estimate.resolution,finestCellSize:Math.min(...step),isoLevel:effectiveIso,detailTolerance:estimate.tolerance,refinedCells:0,budgetLimitedCells:0,normalFallbacks:0,projectionFallbacks:0,maxCount:estimate.maxCount,fileBytes:0,workingBytesUpperBound:estimate.workingBytes,timings:{}};
 if(sampler.semantics!=='signed-distance')report.warnings.push('Non-metric field: sampled isosurface, uncertain sub-cell features and topology; no DE-based empty-space pruning.');
 if(effectiveIso!==iso)report.warnings.push(`Unsigned/unknown zero interior: automatic positive isovalue ${effectiveIso}; not an exact zero surface.`);
 const progress=(stage:string,done:number,total:number)=>options.onProgress?.(stage,done,total);
 const sample=(points:Vec3[])=>sampleChecked(sampler,points,report,estimate.maxSamples,options.signal);
 const cooperate=async()=>{checkCancelled(options.signal);await new Promise<void>(r=>setTimeout(r,0));};
 let active=new Patches(),final=new Patches(),started=performance.now(),done=0;
 const block=8,total=cells.reduce((n,c)=>n*Math.ceil(c/block),1);
 for(let z=0;z<cells[2];z+=block)for(let y=0;y<cells[1];y+=block)for(let x=0;x<cells[0];x+=block){
  checkCancelled(options.signal);const size=[Math.min(block,cells[0]-x),Math.min(block,cells[1]-y),Math.min(block,cells[2]-z)] as Vec3,points:Vec3[]=[];
  for(let k=0;k<=size[2];k++)for(let j=0;j<=size[1];j++)for(let i=0;i<=size[0];i++)points.push([options.bounds.min[0]+(x+i)*step[0],options.bounds.min[1]+(y+j)*step[1],options.bounds.min[2]+(z+k)*step[2]]);
  const batch=await sample(points),index=(i:number,j:number,k:number)=>(k*(size[1]+1)+j)*(size[0]+1)+i;
  for(let k=0;k<size[2];k++)for(let j=0;j<size[1];j++)for(let i=0;i<size[0];i++){
   const ids=corners.map(c=>index(i+c[0],j+c[1],k+c[2]));if(ids.some(id=>!batch.valid[id]))continue;
   const record=patch([options.bounds.min[0]+(x+i)*step[0],options.bounds.min[1]+(y+j)*step[1],options.bounds.min[2]+(z+k)*step[2]],step,ids.map(id=>batch.values[id]!),effectiveIso);
   if(record){if(active.count>=estimate.maxCount)throw Error('Base surface exceeds Gaussian budget; choose a lower base resolution or larger memory/file/count budget');active.add(record);}
  }
  progress('Field sampling',++done,total);await cooperate();
 }
 report.timings.fieldSamplingMs=performance.now()-started;started=performance.now();
 for(let depth=0;depth<estimate.depth&&active.count;depth++){
  const next=new Patches();let currentCount=final.count+active.count;
  let candidateCount=0;for(let i=0;i<active.count;i++)if(active.get(i)[13]!>estimate.tolerance)candidateCount++;
  const order=new Uint32Array(candidateCount);let at=0;
  for(let i=0;i<active.count;i++)if(active.get(i)[13]!>estimate.tolerance)order[at++]=i;else final.add(Array.from(active.get(i)));
  const tie=(i:number)=>(Math.imul(i^estimate.seed,1597334677)>>>0);
  order.sort((a,b)=>active.get(b)[13]!-active.get(a)[13]!||tie(a)-tie(b)||a-b);
  for(let start=0;start<order.length;start+=BATCH){
   const parents:number[]=[],points:Vec3[]=[];
   for(let i=start;i<Math.min(order.length,start+BATCH);i++){
    const id=order[i]!,r=active.get(id);
    parents.push(id);for(const child of corners)for(const c of corners)points.push([0,1,2].map(k=>r[k]!+(child[k]!+c[k]!)*r[k+3]!*.5) as Vec3);
   }
   if(points.length){const batch=await sample(points);
    parents.forEach((id,parentIndex)=>{const r=active.get(id),children:number[][]=[];
     corners.forEach((child,childIndex)=>{const off=parentIndex*64+childIndex*8;if(corners.some((_,k)=>!batch.valid[off+k]))return;
      const record=patch([0,1,2].map(k=>r[k]!+child[k]!*r[k+3]!*.5) as Vec3,[r[3]!*.5,r[4]!*.5,r[5]!*.5],Array.from(batch.values.subarray(off,off+8)),effectiveIso);if(record)children.push(record);});
     // Keep a witnessed parent if children cannot represent it (invalid domains or unresolved crossing).
     if(!children.length||currentCount+children.length-1>estimate.maxCount){final.add(Array.from(r));report.budgetLimitedCells++;return;}
     currentCount+=children.length-1;report.refinedCells++;report.finestCellSize=Math.min(report.finestCellSize,r[3]!*.5,r[4]!*.5,r[5]!*.5);children.forEach(record=>next.add(record));
    });
   }
   progress('Adaptive refinement',Math.min(start+BATCH,order.length),order.length);await cooperate();
  }
  active=next;
 }
 for(let i=0;i<active.count;i++)final.add(Array.from(active.get(i)));active=new Patches();
 report.timings.refinementMs=performance.now()-started;
 if(!final.count)throw Error('No valid surface crossings; adjust region or isovalue');
 report.count=final.count;
 if(report.budgetLimitedCells)report.warnings.push('Refinement budget reached: some coarse surface patches were retained; requested tolerance is not guaranteed.');
 started=performance.now();
 const validated=new Patches();
 // Six original-field probes per point; bounded Newton projection back to the selected isosurface.
 for(let start=0;start<final.count;start+=BATCH){
  const end=Math.min(final.count,start+BATCH),positions:Vec3[]=[],eps:number[]=[];
  for(let i=start;i<end;i++){const r=final.get(i);positions.push([r[6]!,r[7]!,r[8]!]);eps.push(Math.min(r[3]!,r[4]!,r[5]!)*.06);}
  for(let iteration=0;iteration<3;iteration++){
   const probes=positions.flatMap((p,i)=>[p,...[0,1,2].flatMap(k=>[-1,1].map(sign=>p.map((v,j)=>v+(j===k?sign*eps[i]!:0)) as Vec3))]);
   const batch=await sample(probes);
   positions.forEach((p,i)=>{const off=i*7,r=final.get(start+i);if(!batch.valid[off]){report.projectionFallbacks++;return;}
    if([1,2,3,4,5,6].some(k=>!batch.valid[off+k])){report.normalFallbacks++;return;}
    const g=[0,1,2].map(k=>(batch.values[off+2+k*2]!-batch.values[off+1+k*2]!)/(2*eps[i]!)),l=Math.hypot(...g);
    if(l<1e-12||!Number.isFinite(l)){report.normalFallbacks++;return;}
    r.set(g.map(v=>v/l),9);
    const distance=(batch.values[off]!-effectiveIso)/l;
    if(Math.abs(distance)<estimate.tolerance*.05)return;
    const move=Math.max(-eps[i]!*4,Math.min(eps[i]!*4,distance)),next=p.map((v,k)=>Math.max(r[k]!,Math.min(r[k]!+r[k+3]!,v-move*g[k]!/l))) as Vec3;
    positions[i]=next;
   });
  }
  // Check the last proposal: invalid samples never become invented geometry.
  const checked=await sample(positions);positions.forEach((p,i)=>{if(checked.valid[i]){const r=final.get(start+i);r.set(p,6);validated.add(Array.from(r));}else report.projectionFallbacks++;});
  progress('Surface extraction / normals',end,final.count);await cooperate();
 }
 report.timings.surfaceExtractionMs=performance.now()-started;
 final=validated;report.count=final.count;
 if(!final.count)throw Error('No valid surface after projection; invalid domains were omitted');
 if(report.projectionFallbacks)report.warnings.push('Some projection probes were invalid; invalid final surface positions were omitted.');
 const header=gaussianPlyHeader(final.count,{representation:'surface-geometric',sampling:'adaptive-original-field',coordinateSystem:'right-handed Y-up',colorSpace:'sRGB',activeSHDegree:0,storedSHDegree:3,bounds:options.bounds,seed:estimate.seed,quality:estimate.quality,baseResolution:estimate.resolution,detailTolerance:estimate.tolerance,isoLevel:effectiveIso,options:gaussian});
 checkCancelled(options.signal);await sink.write(header);report.fileBytes=header.length;
 let constructionMs=0,encodingMs=0,writingMs=0;
 for(let start=0;start<final.count;start+=CHUNK){
  checkCancelled(options.signal);const count=Math.min(CHUNK,final.count-start),positions=new Float32Array(count*3),normals=new Float32Array(count*3),radii=new Float32Array(count);
  for(let i=0;i<count;i++){const r=final.get(start+i);positions.set(r.subarray(6,9),i*3);normals.set(r.subarray(9,12),i*3);radii[i]=r[12]!;}
  started=performance.now();const colors=gaussian.colorMode==='surface-color'&&sampler.colors?await sampler.colors(positions,normals):undefined;
  if(colors){if(colors.length!==positions.length)throw Error('Mismatched Gaussian colour batch');for(let i=0;i<colors.length;i++)colors[i]=colors[i]!*(options.baseColor?.[i%3]??1);}
  const points:SurfacePoints={positions,normals,radii,...(colors?{colors}:{}),bounds:options.bounds,objectId:sampler.id,materialId:'scene',resolution:estimate.resolution,semantics:sampler.semantics,confidence:'sampled-isosurface',seed:estimate.seed};
  const gs=constructGaussians(points,gaussian);constructionMs+=performance.now()-started;progress('Gaussian construction',start+count,final.count);
  started=performance.now();const encoded=encodeGaussianRecords(gs);encodingMs+=performance.now()-started;progress('Attribute encoding',start+count,final.count);
  checkCancelled(options.signal);started=performance.now();await sink.write(encoded);writingMs+=performance.now()-started;report.fileBytes+=encoded.length;progress('File writing',start+count,final.count);await cooperate();
 }
 Object.assign(report.timings,{constructionMs,encodingMs,writingMs});return report;
}
