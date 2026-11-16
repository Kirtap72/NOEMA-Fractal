/** External formula fields are geometry resources, independent of surface textures. */
import {base64ToBytes,bytesToBase64,encodeGrayField,decodeGrayField,grayFieldPacketError,MAX_COMPACT_FIELD_PIXELS} from './fieldMapCodec';
export interface FieldMap {
  id: number;
  reference: string;
  status?: 'MISSING'|'AMBIGUOUS';
  sampler: 'periodic-bspline';
  width?: number;
  height?: number;
  /** Top-down RGB8, base64; raw unless rgb8Encoding is explicit. No gamma conversion. */
  rgb8?: string;
  /** Optional lossless grayscale packet storage; decoded RGB is exactly unchanged. */
  rgb8Encoding?: 'gray8-rle-v1';
}
export type FieldSampler=(id:number,u:number,v:number)=>readonly number[]|null;
const resourceKeys=new WeakMap<FieldMap,{signature:unknown[];key:string}>();
export function fieldResourcesKey(maps:readonly FieldMap[]):string[]{
  return maps.map(m=>{const signature=[m.id,m.width,m.height,m.rgb8,m.rgb8Encoding];const cached=resourceKeys.get(m);if(cached&&signature.every((v,i)=>v===cached.signature[i]))return cached.key;let hash=2166136261;for(let i=0;i<(m.rgb8?.length??0);i++)hash=Math.imul(hash^m.rgb8!.charCodeAt(i),16777619);const key=JSON.stringify([m.id,m.width,m.height,m.rgb8?.length,hash,...(m.rgb8Encoding?[m.rgb8Encoding]:[])]);resourceKeys.set(m,{signature,key});return key;});
}
export function fieldMapErrors(maps:unknown):string[]{
  if(!Array.isArray(maps))return ['formulaFields must be an array'];
  const ids=new Set<number>(),errors:string[]=[];
  for(const m of maps as FieldMap[]){
    if(!m||!Number.isInteger(m.id)||m.id<1||m.id>16777216||ids.has(m.id)||typeof m.reference!=='string'||m.sampler!=='periodic-bspline'||m.status!==undefined&&!['MISSING','AMBIGUOUS'].includes(m.status))errors.push('invalid or duplicate formula field reference');
    else ids.add(m.id);
    if(!m)continue;
    if(m.rgb8Encoding!==undefined&&m.rgb8Encoding!=='gray8-rle-v1')errors.push('unknown formula field encoding');
    if(m.rgb8Encoding&&!m.rgb8)errors.push('missing encoded formula field data');
    if(m.rgb8!==undefined){
      if(m.rgb8Encoding==='gray8-rle-v1'){
        if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width!<1||m.height!<1||typeof m.rgb8!=='string'||m.rgb8.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(m.rgb8))errors.push('invalid encoded formula field data');
        else {try{const error=grayFieldPacketError(base64ToBytes(m.rgb8),m.width!*m.height!);if(error)errors.push(error);}catch{errors.push('invalid encoded formula field data');}}
        continue;
      }
      if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width!<1||m.height!<1||typeof m.rgb8!=='string'||m.rgb8.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(m.rgb8)||Math.floor(m.rgb8.length*3/4)-(m.rgb8.endsWith('==')?2:m.rgb8.endsWith('=')?1:0)!==m.width!*m.height!*3)errors.push('invalid RGB8 formula field data');
    }
  }
  return errors;
}
function decode(map:FieldMap):Uint8Array|null{
  if(!map.rgb8)return null;
  const bytes=base64ToBytes(map.rgb8);return map.rgb8Encoding?decodeGrayField(bytes,map.width!*map.height!):bytes;
}
/** Compact only large, exactly grayscale resources. Small legacy payloads stay byte-identical. */
export function compactFieldMap(map:FieldMap):FieldMap {
 if(map.rgb8Encoding||!map.rgb8||map.width!*map.height!<1048576||map.width!*map.height!>MAX_COMPACT_FIELD_PIXELS)return map;
 const packed=encodeGrayField(base64ToBytes(map.rgb8));if(!packed||packed.length*4/3>=map.rgb8.length)return map;
 return {...map,rgb8:bytesToBase64(packed),rgb8Encoding:'gray8-rle-v1'};
}
export function splineWeights(t:number):number[]{
  const d=t*t*t/6,a=1/6+.5*t*(t-1)-d,c=t+a-2*d;
  return [a,1-a-c-d,c,d].map(Math.fround);
}
export function createFieldSampler(maps:readonly FieldMap[]):FieldSampler{
  const data=new Map(maps.map(m=>[m.id,{map:m,bytes:decode(m)}]));
  return (id,u,v)=>{
    // Native map number zero is an explicit empty slot, not a missing file.
    if(id===0)return [0,0,0];
    const r=data.get(id);if(!r?.bytes||![u,v].every(Number.isFinite))return null;
    const w=r.map.width!,h=r.map.height!,x=(u-Math.floor(u))*w,y=(v-Math.floor(v))*h;
    const ix=Math.floor(x),iy=Math.floor(y),a=splineWeights(x-ix),b=splineWeights(y-iy),out=[0,0,0];
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){
      const pixel=((iy+j-1+h)%h)*w+(ix+i-1+w)%w;
      for(let k=0;k<3;k++)out[k]!+=r.bytes[r.map.rgb8Encoding?pixel:pixel*3+k]!/255*a[i]!*b[j]!;
    }
    return out;
  };
}
/** Descriptors and raw RGB8 textures are separate: no 16-byte Float32 expansion per texel. */
export function packFieldDescriptors(maps:readonly FieldMap[]):Float32Array{
  const errors=fieldMapErrors(maps);if(errors.length)throw Error(errors.join('; '));
  const ready=maps.filter(m=>m.rgb8),data=new Float32Array((1+ready.length)*4);data[0]=ready.length;
  ready.forEach((m,i)=>data.set([m.id,m.width!,m.height!,i],(i+1)*4));return data;
}
export function fieldMapRgba(map:FieldMap):Uint8Array{
  const raw=decode(map);if(!raw)throw Error('Missing formula field data');
  const rgba=new Uint8Array(map.width!*map.height!*4);
  const channels=map.rgb8Encoding?1:3;
  for(let i=0,j=0;i<raw.length;i+=channels,j+=4){rgba[j]=raw[i]!;rgba[j+1]=raw[i+(channels===1?0:1)]!;rgba[j+2]=raw[i+(channels===1?0:2)]!;rgba[j+3]=255;}
  return rgba;
}
export const FIELD_MAP_WGSL=`
@group(0) @binding(8) var formulaFieldTex:texture_2d_array<f32>;
@group(0) @binding(9) var<storage,read> formulaFields:array<vec4f>;
fn fieldWeights(t:f32)->vec4f {let d=t*t*t/6.0;let a=1.0/6.0+0.5*t*(t-1.0)-d;let c=t+a-2.0*d;return vec4f(a,1.0-a-c-d,c,d);}
fn sampleFormulaField(id:i32,uv:vec2f)->vec4f{
 if(id==0){return vec4f(0.0,0.0,0.0,1.0);}
 for(var slot=1;slot<=i32(formulaFields[0].x);slot++){
  let m=formulaFields[slot];if(i32(m.x)!=id){continue;}
  let wh=vec2i(m.yz);let p=fract(uv)*m.yz;let cell=vec2i(floor(p));let a=fieldWeights(fract(p.x));let b=fieldWeights(fract(p.y));var rgb=vec3f(0.0);
  for(var y=0;y<4;y++){for(var x=0;x<4;x++){
   let c=(cell+vec2i(x-1,y-1)+wh)%wh;rgb+=textureLoad(formulaFieldTex,c,i32(m.w),0).xyz*a[x]*b[y];
  }}return vec4f(rgb,1.0);
 }return vec4f(0.0);
}`;
