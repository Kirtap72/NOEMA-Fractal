import type {SurfaceImage} from './surfaceDetail';
import {imageHeaderDimensions} from './textureResources';
import type {HeightBounds} from './displacement';

export interface SurfaceAtlas {materialTextures?:boolean;displacement?:boolean;heightBounds?:HeightBounds[];texture:GPUTexture; images:SurfaceImage[]; side:number; warnings:string[]}
/** Data textures are decoded without profile conversion, never through the colour-texture gamma path. */
export async function createSurfaceAtlas(device:GPUDevice,images:SurfaceImage[],geometry=false):Promise<SurfaceAtlas>{
  if(images.length>Math.min(256,device.limits.maxTextureArrayLayers)||images.reduce((n,t)=>n+t.data.length,0)>64*1024*1024)throw Error('The material maps exceed the budget of the atlas (256 layers / 64 MiB embedded pictures).');
  // Legacy data-only atlases keep their format and upload path. M2A colour maps
  // are decoded once into linear half-floats before filtering or mip generation.
  const color=images.some(t=>t.colorSpace==='srgb'),format=color?'rgba16float':'rgba8unorm';
  const dimensions:{width:number;height:number}[]=[];
  {
    for(const image of images){imageHeaderDimensions(image.data);const blob=await(await fetch(image.data)).blob();const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});dimensions.push({width:bitmap.width,height:bitmap.height});bitmap.close();}
    const maxSide=Math.max(1,...dimensions.map(b=>Math.max(b.width,b.height)));
    const side=2**Math.floor(Math.log2(Math.max(1,Math.min(1024,maxSide,Math.sqrt((color?4:8)*1024*1024/Math.max(1,images.length))))));
    const warnings=dimensions.some(b=>b.width>side||b.height>side)?[`Surface Detail: pictures are filtered to ${side} × ${side} in the GPU atlas (the originals are saved unchanged).`]:[];
    const levels=Math.log2(side)+1;
    const texture=device.createTexture({label:'Linear surface data atlas',size:[side,side,Math.max(1,images.length)],mipLevelCount:levels,format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});
    let staging:GPUTexture|undefined,settings:GPUBuffer|undefined;
    try {
      let convert:GPUComputePipeline|undefined;
      if(color){
        settings=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        const module=device.createShaderModule({code:`@group(0) @binding(0) var image:texture_2d<f32>;@group(0) @binding(1) var outputTex:texture_storage_2d_array<rgba16float,write>;@group(0) @binding(2) var<uniform> settings:vec4u;
        fn linearAt(p:vec2i)->vec4f{let size=vec2i(textureDimensions(image));var v=textureLoad(image,clamp(p,vec2i(0),size-1),0);if(settings.y==1u){v=vec4f(select(v.rgb/12.92,pow((v.rgb+vec3f(.055))/1.055,vec3f(2.4)),v.rgb>vec3f(.04045)),v.a);}return v;}
        @compute @workgroup_size(8,8) fn cs(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(outputTex);if(any(id.xy>=size)){return;}let p=(vec2f(id.xy)+.5)*vec2f(textureDimensions(image))/vec2f(size)-.5;let low=vec2i(floor(p));let f=fract(p);let v=mix(mix(linearAt(low),linearAt(low+vec2i(1,0)),f.x),mix(linearAt(low+vec2i(0,1)),linearAt(low+vec2i(1,1)),f.x),f.y);textureStore(outputTex,vec2i(id.xy),i32(settings.x),v);}`});convert=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'cs'}});
      }
      if(!images.length)device.queue.writeTexture({texture},new Uint8Array([128,128,255,255]),{bytesPerRow:4},[1,1]);
      for(let i=0;i<images.length;i++){
        // Colour must be decoded BEFORE the first spatial resampling as well as
        // before mip generation. Keep only one bounded full-source staging image.
        const bitmap=await createImageBitmap(await(await fetch(images[i]!.data)).blob(),{...(color?{}:{resizeWidth:side,resizeHeight:side,resizeQuality:'high' as const}),colorSpaceConversion:'none',premultiplyAlpha:'none'});
        try{
          if(convert&&settings){staging?.destroy();staging=device.createTexture({size:[bitmap.width,bitmap.height],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});device.queue.copyExternalImageToTexture({source:bitmap},{texture:staging,premultipliedAlpha:false},[bitmap.width,bitmap.height]);device.queue.writeBuffer(settings,0,new Uint32Array([i,images[i]!.colorSpace==='srgb'?1:0,0,0]));const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(convert);pass.setBindGroup(0,device.createBindGroup({layout:convert.getBindGroupLayout(0),entries:[{binding:0,resource:staging.createView()},{binding:1,resource:texture.createView({dimension:'2d-array',baseMipLevel:0,mipLevelCount:1})},{binding:2,resource:{buffer:settings}}]}));pass.dispatchWorkgroups(Math.ceil(side/8),Math.ceil(side/8));pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();}
          else device.queue.copyExternalImageToTexture({source:bitmap},{texture,origin:[0,0,i],premultipliedAlpha:false},[side,side]);
        }finally{bitmap.close();}
      }
      if(levels>1){
        const module=device.createShaderModule({code:`
          @group(0) @binding(0) var source:texture_2d_array<f32>;
          @group(0) @binding(1) var outputTex:texture_storage_2d_array<${format},write>;
          @compute @workgroup_size(8,8) fn cs(@builtin(global_invocation_id) id:vec3u){
            let size=textureDimensions(outputTex);if(any(id.xy>=size)){return;}
            let p=vec2i(id.xy)*2;let layer=i32(id.z);
            let v=(textureLoad(source,p,layer,0)+textureLoad(source,p+vec2i(1,0),layer,0)+textureLoad(source,p+vec2i(0,1),layer,0)+textureLoad(source,p+vec2i(1,1),layer,0))*0.25;
            textureStore(outputTex,vec2i(id.xy),layer,v);
          }`});
        const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==="error");if(errors.length)throw Error(errors.map(m=>`Surface atlas line ${m.lineNum}: ${m.message}`).join("; "));
        const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'cs'}});
        const encoder=device.createCommandEncoder();for(let level=1;level<levels;level++){
          const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({dimension:'2d-array',baseMipLevel:level-1,mipLevelCount:1})},{binding:1,resource:texture.createView({dimension:'2d-array',baseMipLevel:level,mipLevelCount:1})}]}));pass.dispatchWorkgroups(Math.ceil((side>>level)/8),Math.ceil((side>>level)/8),images.length);pass.end();}device.queue.submit([encoder.finish()]);
      }
      if(color)await device.queue.onSubmittedWorkDone();
      const heightBounds=geometry?await measureHeightBounds(device,texture,side,images.length):undefined;
      return {texture,images,side,warnings,...(geometry?{displacement:true,heightBounds}:{} )};
    }catch(error){texture.destroy();throw error;}finally{staging?.destroy();settings?.destroy();}
  }
}

/** Bounds from the actual base mip, including wrap seams. Tiny readback, no full
 * atlas copy. Bitwise atomics are ordered for these nonnegative finite values. */
async function measureHeightBounds(device:GPUDevice,texture:GPUTexture,side:number,layers:number):Promise<HeightBounds[]>{
 const size=Math.max(16,layers*16),stats=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{
  const init=new Float32Array(size/4);for(let i=0;i<layers;i++)init[i*4]=1;device.queue.writeBuffer(stats,0,init);
  const module=device.createShaderModule({code:`
   @group(0) @binding(0) var image:texture_2d_array<f32>;
   @group(0) @binding(1) var<storage,read_write> stats:array<atomic<u32>>;
   @compute @workgroup_size(8,8) fn cs(@builtin(global_invocation_id) id:vec3u){
    let size=textureDimensions(image);if(any(id.xy>=size)){return;}
    let p=vec2i(id.xy);let l=i32(id.z);let v=textureLoad(image,p,l,0).r;
    let dx=abs(v-textureLoad(image,vec2i(vec2u((id.x+1u)%size.x,id.y)),l,0).r);
    let dy=abs(v-textureLoad(image,vec2i(vec2u(id.x,(id.y+1u)%size.y)),l,0).r);
    atomicMin(&stats[id.z*4u],bitcast<u32>(v));atomicMax(&stats[id.z*4u+1u],bitcast<u32>(v));
    atomicMax(&stats[id.z*4u+2u],bitcast<u32>(dx));atomicMax(&stats[id.z*4u+3u],bitcast<u32>(dy));
   }`});
  const info=await module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`Displacement atlas ${m.lineNum}: ${m.message}`).join('; '));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'cs'}}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({dimension:'2d-array',baseMipLevel:0,mipLevelCount:1})},{binding:1,resource:{buffer:stats}}]}));pass.dispatchWorkgroups(Math.ceil(side/8),Math.ceil(side/8),layers);pass.end();encoder.copyBufferToBuffer(stats,0,read,0,size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const v=new Float32Array(read.getMappedRange()).slice();read.unmap();
  const out=Array.from({length:layers},(_,i)=>({min:v[i*4]!,max:v[i*4+1]!,du:v[i*4+2]!*side,dv:v[i*4+3]!*side}));
  if(out.some(b=>Object.values(b).some(x=>!Number.isFinite(x)||x<0)||b.max>1))throw Error('Displacement: invalid linear height limits in the GPU atlas.');return out;
 }finally{stats.destroy();read.destroy();}
}
