import {displayRgba} from './display';
import type {ImageBuffer,LayerBuffers} from './engine';
export interface DenoiseSettings {enabled:boolean;}
export const defaultDenoise=():DenoiseSettings=>({enabled:false});
export function readDenoise(raw:unknown,errors:string[]):DenoiseSettings {
 if(raw===undefined)return defaultDenoise();
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='enabled')||typeof (raw as DenoiseSettings).enabled!=='boolean'){errors.push('denoise needs only a boolean enabled');return defaultDenoise();}
 return {enabled:(raw as DenoiseSettings).enabled};
}
export interface DenoiseTiming {gpuMs:number;gpuClock:'timestamp'|'fenced-wall';totalMs:number;}
export const DENOISE_RADIUS=2;
/** Independent CPU weight reference, also useful for inspecting the filter's fixed conservative gates. */
export function denoiseWeight(depth:number,other:number,normalDot:number,pixelWorld:number,colorDistanceSquared:number,offsetSquared:number):number {
 const sigma=Math.max(1e-6,pixelWorld*.75),delta=Math.abs(depth-other);
 if(depth<0||other<0||normalDot<.96||delta>Math.max(1e-5,sigma*3))return 0;
 return Math.exp(-offsetSquared/4-delta*delta/(sigma*sigma)-(1-normalDot)*80-colorDistanceSquared/.5);
}
/** One 5x5 joint bilateral pass, independent of the scene/formula shader and never fed back into accumulation. */
export const denoiseWgsl=/* wgsl */`
@group(0) @binding(0) var<storage,read> colors:array<vec4f>;
@group(0) @binding(1) var<storage,read> guides:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> output:array<vec4f>;
struct Params {size:vec4u,metric:vec4f};
@group(0) @binding(3) var<uniform> params:Params;
fn linearColor(p:u32)->vec3f{return pow(vec3f(f32(p&255u),f32((p>>8u)&255u),f32((p>>16u)&255u))/255.0,vec3f(2.2));}
@compute @workgroup_size(8,8) fn denoiseCs(@builtin(global_invocation_id) id:vec3u){
 let size=params.size.xy;if(any(id.xy>=size)){return;}let index=id.y*size.x+id.x;let g=guides[index];let raw=colors[index];
 if(g.x<0.0||dot(g.yzw,g.yzw)<0.5){output[index]=raw;return;}
 let centre=raw.rgb;let pixelWorld=max(params.metric.y,params.metric.x*g.x);let sigma=max(1e-6,pixelWorld*0.75);var sum=vec3f(0.0);var total=0.0;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let p=clamp(vec2i(id.xy)+vec2i(x,y),vec2i(0),vec2i(size)-vec2i(1));let at=u32(p.y)*size.x+u32(p.x);let n=guides[at];let nd=clamp(dot(g.yzw,n.yzw),-1.0,1.0);let dz=abs(g.x-n.x);
  if(n.x<0.0||nd<0.96||dz>max(1e-5,sigma*3.0)){continue;}
  let c=colors[at].rgb;let diff=(c-centre)/max(1.0,max(max(max(c.r,c.g),c.b),max(max(centre.r,centre.g),centre.b)));let weight=exp(-f32(x*x+y*y)/4.0-dz*dz/(sigma*sigma)-(1.0-nd)*80.0-dot(diff,diff)/0.5);
  sum+=c*weight;total+=weight;
 }}
 let filtered=mix(centre,sum/max(total,1e-8),0.7);
 output[index]=vec4f(filtered,raw.a);
}`;

export class GpuDenoiser {
 private pipeline:Promise<GPUComputePipeline>|null=null;
 constructor(private device:GPUDevice){}
 async filter(image:LayerBuffers,perspectivePixel:number,orthoPixel:number,signal?:AbortSignal,onTiming?:(t:DenoiseTiming)=>void,tileSize=512):Promise<ImageBuffer>{
  const {width,height,color,depth,normal}=image;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||color.length!==width*height*4||depth.length!==width*height||normal.length!==width*height*3)throw Error('Invalid denoise layers');
  if(!Number.isFinite(perspectivePixel)||perspectivePixel<0||!Number.isFinite(orthoPixel)||orthoPixel<0||!Number.isSafeInteger(tileSize)||tileSize<1)throw Error('Invalid denoise pixel footprint or tile size');
  const abort=()=>{if(signal?.aborted){const e=Error('Denoise cancelled');e.name='AbortError';throw e;}};abort();
  const pipeline=await(this.pipeline??=this.device.createComputePipelineAsync({layout:'auto',compute:{module:this.device.createShaderModule({code:denoiseWgsl}),entryPoint:'denoiseCs'}}));abort();
  const device=this.device,output=new Float32Array(color.length),edge=Math.min(tileSize,Math.floor(Math.sqrt(device.limits.maxStorageBufferBindingSize/16))-4);
  for(let y=0;y<height;y+=edge)for(let x=0;x<width;x+=edge){
   abort();const started=performance.now(),x0=Math.max(0,x-2),y0=Math.max(0,y-2),x1=Math.min(width,x+edge+2),y1=Math.min(height,y+edge+2),w=x1-x0,h=y1-y0;
   const pixels=new Float32Array(w*h*4),data=new Float32Array(w*h*4);
   for(let j=0;j<h;j++)for(let i=0;i<w;i++){const from=(y0+j)*width+x0+i,to=j*w+i;for(let c=0;c<4;c++)pixels[to*4+c]=image.linear?image.linear[from*4+c]!:(c===3?color[from*4+c]!/255:(color[from*4+c]!/255)**2.2);data.set([depth[from]!,normal[from*3]!,normal[from*3+1]!,normal[from*3+2]!],to*4);}
   const raw=device.createBuffer({size:pixels.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),guide=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),out=device.createBuffer({size:pixels.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:pixels.byteLength,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),params=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   const query=onTiming&&device.features.has('timestamp-query')?device.createQuerySet({type:'timestamp',count:2}):undefined,resolve=query?device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}):undefined,times=query?device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}):undefined;
   try{
    device.queue.writeBuffer(raw,0,pixels);device.queue.writeBuffer(guide,0,data);const p=new ArrayBuffer(32);new Uint32Array(p).set([w,h,0,0]);new Float32Array(p,16).set([perspectivePixel,orthoPixel,0,0]);device.queue.writeBuffer(params,0,p);
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[raw,guide,out,params].map((b,binding)=>({binding,resource:{buffer:b}}))}),encoder=device.createCommandEncoder(),gpuStart=performance.now();
    const pass=encoder.beginComputePass(query?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(w/8),Math.ceil(h/8));pass.end();encoder.copyBufferToBuffer(out,0,read,0,pixels.byteLength);
    if(query&&resolve&&times){encoder.resolveQuerySet(query,0,2,resolve,0);encoder.copyBufferToBuffer(resolve,0,times,0,16);}device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);let gpuMs=performance.now()-gpuStart;
    if(times){await times.mapAsync(GPUMapMode.READ);const t=new BigUint64Array(times.getMappedRange());gpuMs=Number(t[1]!-t[0]!)/1e6;times.unmap();}
    abort();const values=new Float32Array(read.getMappedRange()),tw=Math.min(edge,width-x),th=Math.min(edge,height-y);for(let j=0;j<th;j++)output.set(values.subarray(((y-y0+j)*w+x-x0)*4,((y-y0+j)*w+x-x0+tw)*4),((y+j)*width+x)*4);read.unmap();
    onTiming?.({gpuMs,gpuClock:query?'timestamp':'fenced-wall',totalMs:performance.now()-started});
   }finally{raw.destroy();guide.destroy();out.destroy();read.destroy();params.destroy();query?.destroy();resolve?.destroy();times?.destroy();}
  }
  return {width,height,data:displayRgba(output,image.display),linear:output,display:image.display};
 }
}
