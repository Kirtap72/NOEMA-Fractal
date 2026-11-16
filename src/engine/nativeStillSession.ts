import {createEngine} from './engine';
import {parseScene,resolveScene} from './scene';
import type {Library} from './formula/library';
import {doubleSingleField,dsDefinition} from './geometryDoubleSingle';
import {mb3dCameraHelpers} from './mb3dParityLab';

import type {Mb3dParityLab} from './mb3dParityLab';
import type {Engine,RenderTiming} from './engine';
import type {Scene} from './scene';
import {nativeCo0Field,nativeCo0Appearance} from './mb3dColorLab';
import {generateChain} from './formula/chain';
import {toChainSteps} from './scene';
import {buildShader} from './shader';
import {nativeFiveShader} from './mb3dNormalLab';
import {nativeRoughnessShader,nativeVisibilityShader,nativeSoftVisibilityShader} from './mb3dAppearanceLab';
import {sampleJitter} from './renderSetup';

export function createNativeStillSession(formulas:Library['formulas']){
let scene:Scene,camera:Mb3dParityLab,engine:Engine|undefined,key='',applied='';
let observer: {device:GPUDevice;code:string;pipe:GPUComputePipeline;compileMs:number}|undefined;

const features={shadows:false,occlusion:false,material:true,simpleLight:false,tetraNormal:false,reflections:false,secondaryReflections:false,fog:false};
const b64=(v:ArrayBufferLike|Uint8Array)=>{const b=v instanceof Uint8Array?v:new Uint8Array(v);let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
return {
 prepare(raw:unknown,c?:Mb3dParityLab){const p=parseScene(raw);if(!p.ok)throw Error(p.errors.join('; '));scene=p.scene;applied='';if(c)camera=c;},
 async colorProbe(job:any,depth:ArrayLike<number>){
  const r=resolveScene(scene,formulas);if(!r.ok)throw Error(r.errors.join('; '));const g=generateChain(toChainSteps(r),r.rounds,{mode:r.mode,execution:r.execution});if(!g.ok)throw Error(g.errors.join('; '));
  const provider=doubleSingleField(dsDefinition(r,true),'split',true,camera.bailoutRadius);
  const code=buildShader(g.wgsl)+provider+'var<private> geoDSPosition:DSP;\n'+nativeCo0Field(provider,camera.bailoutRadius)+mb3dCameraHelpers(camera)+nativeFiveShader(camera.axes,camera.stepWidth,camera.deStop,camera.adaptFactor).replace('return geoMicroNormal(p,t);','return vec3f(0.0);')+nativeRoughnessShader(camera.axes,camera.stepWidth,camera.adaptFactor)+(job.shadowLight?(job.softShadow?nativeSoftVisibilityShader(job.shadowLight,camera):nativeVisibilityShader(job.shadowLight,.1)):'')+`
 @group(0) @binding(20) var<storage,read> points:array<vec4f>;
 @group(0) @binding(21) var<storage,read_write> values:array<vec4f>;
 @compute @workgroup_size(32) fn colorProbe(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&points)){return;}let input=points[id.x];geoNativeCamera(input.xy);let t=input.zw;
 geoDSPosition=geoNativePoint(t);let color=geo6ColorState(geoDSPosition,geoNativeGoal(t.x+t.y)*1.03);
 let compensated=color.core.y+4.6+3.2642628816793153*log(geoNativeGoal(t.x+t.y));
 values[id.x*2u]=vec4f(clamp(round(32767.0-compensated*697.17022705078125),0.0,32767.0),geo7Roughness(t.x+t.y),color.core.y,clamp(round(color.core.z*4096.0),0.0,32767.0));
 let normal=geoFiveNormal(vec3f(0.0),t.x+t.y);
 values[id.x*2u+1u]=vec4f(normal,${job.shadowLight?'geo7Visibility(normal,t.x+t.y'+(job.softShadow?',input.y':'')+')':'geoNativeGoal(t.x+t.y)'});}
 `;
  if(!observer||observer.code!==code){observer?.device.destroy();const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.info.isFallbackAdapter)throw Error('Real GPU required');const d=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});const start=performance.now();const module=d.createShaderModule({code});const pipe=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'colorProbe'}});observer={device:d,code,pipe,compileMs:performance.now()-start};}
 const d=observer.device;d.pushErrorScope('validation');
  const resources:GPUBuffer[]=[];const buffer=(n:number,u:number)=>{const b=d.createBuffer({size:n,usage:u});resources.push(b);return b;};
  try{const {pipe,compileMs}=observer;observer.compileMs=0;
   const n=job.roi.width*job.roi.height,points=new Float32Array(n*4),offset=sampleJitter(job.sampleOffset??0,scene.render.quality.seed);for(let i=0;i<n;i++)points.set([job.roi.x+i%job.roi.width+offset[0]!,job.roi.y+Math.floor(i/job.roi.width)+offset[1]!,depth[i*2]!,depth[i*2+1]!],i*4);
   const input=buffer(points.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),output=buffer(points.byteLength*2,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),read=buffer(points.byteLength*2,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);d.queue.writeBuffer(input,0,points);
   const bind=d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:20,resource:{buffer:input}},{binding:21,resource:{buffer:output}}]});const enc=d.createCommandEncoder();
   const query=d.features.has('timestamp-query')?d.createQuerySet({type:'timestamp',count:2}):undefined;
   const time=query?buffer(16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):undefined,timeRead=query?buffer(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):undefined;
   const pass=enc.beginComputePass(query?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(n/32));pass.end();enc.copyBufferToBuffer(output,0,read,0,points.byteLength*2);if(query){enc.resolveQuerySet(query,0,2,time!,0);enc.copyBufferToBuffer(time!,0,timeRead!,0,16);}const go=performance.now();d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=read.getMappedRange().slice(0);read.unmap();let gpuMs:number|undefined;if(timeRead){await timeRead.mapAsync(GPUMapMode.READ);const times=new BigUint64Array(timeRead.getMappedRange());gpuMs=Number(times[1]!-times[0]!)/1e6;timeRead.unmap();}query?.destroy();const error=await d.popErrorScope();if(error)throw Error(error.message);return {state:new Float32Array(bytes),shader:code,gpuMs,wallMs:performance.now()-go,compileMs,offset};
  }finally{resources.forEach(b=>b.destroy());}
 },
 async render(job:any){
  if(!['C','G6'].includes(job.mode))throw Error('Native still session requires an explicit native lane');
 const diagnostic=job.layer==='diagnostic';
  const id=JSON.stringify([job.mode,job.layer,job.splitCamera,job.normalMode,job.nativePalette,camera,job.settings,job.continuation,job.slice]);let compileMs=0;
  if(id!==key){engine?.destroy();applied='';
   const resolved=resolveScene(scene,formulas);if(!resolved.ok)throw Error(resolved.errors.join('; '));

   const transform=(input:string)=>{
    let s=input;
    if(diagnostic){const d='vec4f(geoDSDepth,geoInfo.x,geoMore.y)';
     s=s.replaceAll(/out\.data = vec4f\([^;]+;/g,'out.data = '+d+';');
    }
    if(job.layer==='shading')s=s.replaceAll('out.data = vec4f(t, rawNormal.x, rawNormal.y, rawNormal.z);','out.data = vec4f(t,n);');
    if(job.mode==='G6'){
     const nativeProvider=doubleSingleField(dsDefinition(resolved,true),'split',true,camera.bailoutRadius);
     s=nativeCo0Appearance(s,nativeProvider,{radius:camera.bailoutRadius,totalIterations:46,colorOffset:4.6,zoomCompensation:3.2642628816793153},job.nativePalette);
    }
    return s;
   };
   engine=await createEngine({...(job.continuation?{geometryDetail:job.settings,geometryPassSteps:job.slice??640}:{}),...({qaGeometry:{effort:8,maxQueries:job.continuation?4096:Math.min(4096,job.settings?.maxSteps??4096),stable:true,ds:true,dsProduct:'split',solver:'direct',hardEdges:true,sourceParameters:true,normalMode:'micro',preciseColor:true,nativeMb3d:{...camera,...(job.normalMode==='micro'?{normalReconstruction:undefined}:{})}}}),qaShaderTransform:transform,onGpuReady:i=>{if(i.isFallbackAdapter)throw Error('Real GPU required');}});engine.setFormulas(formulas);key=id;
  }
  // Explicit matched-film adapter: saved clip planes and NOEMA pinhole are not part of MB3D's Common film.
  const q={...scene.render.quality,...({precision_mode:'fixed' as const,hit_precision:1e-7,hit_pixels:.25,normal_policy:'film-detail' as const,hit_policy:'film-half-pixel' as const,step_factor:.1,max_steps:640}),...job.quality};
  const signature=JSON.stringify([id,q]);
  if(applied!==signature){const start=performance.now(),r=await engine!.setScene({...scene,cutout:{...scene.cutout,planes:[]},render:{...scene.render,quality:q}});compileMs=performance.now()-start;if(r.errors.length)throw Error(r.errors.join('; '));applied=signature;}
  if(job.texture&&scene.color.texture){const bitmap=await createImageBitmap(await (await fetch(scene.color.texture.data)).blob());const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);const data=ctx.getImageData(0,0,bitmap.width,bitmap.height);engine!.setTextureImage({width:bitmap.width,height:bitmap.height,data:new Uint8Array(data.data)});bitmap.close();}else engine!.setTextureImage(null);
  const timing:RenderTiming[]=[],passes:any[]=[];
  const film=job.film??{width:7000,height:3938};const image=await engine!.renderLayersToBuffer(film.width,film.height,{region:job.roi,referenceFilm:film,features,dofMode:'off',denoise:false,profileStage:job.profileStage??0,quality:{samples_per_pixel:job.samples??1},sampleOffset:job.sampleOffset??0,tilePixels:job.tilePixels??1024,qaRayBatchCapacity:job.qaRayBatchCapacity,signal:job.signal,onTiming:t=>timing.push(t),onGeometry:(d,s)=>{passes.push(d);job.onGeometry?.(d,s);}});
  return {color:image.color,depth:image.depth,normal:image.normal,compileMs,gpuMs:timing.reduce((a,t)=>a+t.gpuMs,0),timing,passes,width:image.width,height:image.height};
 },destroy(){engine?.destroy();observer?.device.destroy();observer=undefined;engine=undefined;key='';}
};
}
