import {checkCancelled,sampleChecked,samplingGrid} from './geometrySampling';
import type {GeometrySampler,SamplingOptions,GeometryDiagnostics,FieldSemantics} from './geometrySampling';
export type VolumeMode='raw-field'|'occupancy'|'surface-density';
export interface VolumeMetadata {
 format:'fraktalmotorn-field';version:1;coordinateSystem:'right-handed Y-up';
 dimensions:[number,number,number];origin:[number,number,number];spacing:[number,number,number];
 inputSemantics:FieldSemantics;mode:VolumeMode;isoLevel:number;densityWidth?:number;
 files:{header:string;values:string;validity:string};diagnostics:GeometryDiagnostics;
}
/** Awaited sink provides backpressure: no full-volume allocation. Values x-fast, Float32 little endian; separate validity bytes. */
export async function exportVolume(sampler:GeometrySampler,options:SamplingOptions & {mode:VolumeMode;densityWidth?:number},sink:{values(bytes:Uint8Array):Promise<void>;validity(bytes:Uint8Array):Promise<void>}):Promise<{header:string;metadata:VolumeMetadata}>{
 if(!['raw-field','occupancy','surface-density'].includes(options.mode))throw Error('Unsupported volume mode before sampling');
 const {cells,step,maxSamples}=samplingGrid(options),dimensions=cells.map(v=>v+1) as [number,number,number],plane=dimensions[0]*dimensions[1];
 if(dimensions.reduce((a,b)=>a*b,1)>maxSamples)throw Error('Volume sample budget exceeded before allocation');
 if(options.mode==='occupancy'&&sampler.semantics!=='signed-distance'&&sampler.semantics!=='signed-estimate')throw Error('Occupancy requires an explicitly signed field');
 const densityWidth=options.densityWidth??Math.max(...step);
 if(options.mode==='surface-density'&&(!Number.isFinite(densityWidth)||densityWidth<=0))throw Error('Density width must be positive');
 const diagnostics:GeometryDiagnostics={semantics:sampler.semantics,samples:0,invalidSamples:0,peakSampleBytes:0,warnings:[]};
 if(sampler.semantics!=='signed-distance')diagnostics.warnings.push('This volume is a sampled distance estimator, not an exact signed-distance solid.');
 if(options.mode==='surface-density')diagnostics.warnings.push('Density is a Gaussian isovalue band; zero-valued interiors can fill. This is not inferred solid occupancy.');
 // Bounded x-fast blocks also work when one XY plane exceeds the normal batch budget.
 const total=plane*dimensions[2],batchSize=32768;
 for(let from=0;from<total;from+=batchSize){checkCancelled(options.signal);const count=Math.min(batchSize,total-from),points:[number,number,number][]=[];
  for(let i=from;i<from+count;i++){const x=i%dimensions[0],y=Math.floor(i/dimensions[0])%dimensions[1],z=Math.floor(i/plane);points.push([options.bounds.min[0]+x*step[0],options.bounds.min[1]+y*step[1],options.bounds.min[2]+z*step[2]]);}
  const sampled=await sampleChecked(sampler,points,diagnostics,maxSamples,options.signal),bytes=new Uint8Array(count*4),view=new DataView(bytes.buffer);
  for(let i=0;i<count;i++){const raw=sampled.values[i]!,valid=sampled.valid[i];let value=raw;if(options.mode==='occupancy')value=raw<=options.isoLevel?1:0;else if(options.mode==='surface-density')value=Math.exp(-.5*((raw-options.isoLevel)/densityWidth)**2);view.setFloat32(i*4,valid?value:NaN,true);}
  await sink.values(bytes);await sink.validity(sampled.valid);options.onProgress?.(from+count,total);await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 if(diagnostics.invalidSamples)diagnostics.warnings.push('Invalid samples are NaN with validity=0; they are never silently filled as exterior or interior.');
 const metadata:VolumeMetadata={format:'fraktalmotorn-field',version:1,coordinateSystem:'right-handed Y-up',dimensions,origin:[...options.bounds.min],spacing:step,inputSemantics:sampler.semantics,mode:options.mode,isoLevel:options.isoLevel,...(options.mode==='surface-density'?{densityWidth}:{}),files:{header:'field.mhd',values:'field.raw',validity:'validity.raw'},diagnostics};
 const header=`ObjectType = Image\nNDims = 3\nBinaryData = True\nBinaryDataByteOrderMSB = False\nCompressedData = False\nTransformMatrix = 1 0 0 0 1 0 0 0 1\nOffset = ${metadata.origin.join(' ')}\nElementSpacing = ${step.join(' ')}\nDimSize = ${dimensions.join(' ')}\nElementType = MET_FLOAT\nElementDataFile = field.raw\n`;
 return {header,metadata};
}
export function volumeEstimate(options:SamplingOptions){const {cells}=samplingGrid(options),points=cells.reduce((n,v)=>n*(v+1),1);return {points,valuesBytes:points*4,validityBytes:points,peakNumericBatchBytes:Math.min(points,32768)*33};}
