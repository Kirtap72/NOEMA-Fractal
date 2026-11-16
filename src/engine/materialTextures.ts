import {readTexture} from './gradient';
import type {MaterialSettings} from './material';
import type {SurfaceImage} from './surfaceDetail';

export const PBR_CHANNELS=['baseColor','roughness','metallic','ao','emission'] as const;
export type PbrChannel=typeof PBR_CHANNELS[number];
export type TextureChannel=PbrChannel|'normal'|'height';
export const TEXTURE_CHANNELS:readonly TextureChannel[]=[...PBR_CHANNELS,'normal','height'];
export interface PbrMap {enabled:boolean;strength:number;mode:'multiply'|'replace';texture?:SurfaceImage}
export interface MaterialTextures {maps:Partial<Record<PbrChannel,PbrMap>>}
export const isColorMap=(channel:PbrChannel)=>channel==='baseColor'||channel==='emission';
export const defaultPbrMap=(channel:PbrChannel):PbrMap=>({enabled:false,strength:1,mode:channel==='baseColor'||channel==='ao'||channel==='emission'?'multiply':'replace'});
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function readMaterialTextures(raw:unknown,where:string,errors:string[]):MaterialTextures|undefined {
 const before=errors.length;
 if(!obj(raw)||Object.keys(raw).some(k=>k!=='maps')||!obj(raw.maps)){errors.push(where+' needs a maps object');return}
 const maps:MaterialTextures['maps']={};
 for(const [channel,value] of Object.entries(raw.maps)){
  if(!(PBR_CHANNELS as readonly string[]).includes(channel)||!obj(value)){errors.push(where+'.maps.'+channel+' is unknown or invalid');continue}
  const key=channel as PbrChannel,map=defaultPbrMap(key);
  for(const k of Object.keys(value))if(!['enabled','strength','mode','texture'].includes(k))errors.push(where+'.maps.'+channel+'.'+k+' is unknown');
  if(typeof value.enabled!=='boolean')errors.push(where+'.maps.'+channel+'.enabled must be boolean');else map.enabled=value.enabled;
  if(typeof value.strength!=='number'||!Number.isFinite(value.strength)||value.strength<0||value.strength>1)errors.push(where+'.maps.'+channel+'.strength must be within 0 to 1');else map.strength=value.strength;
  if(value.mode!=='multiply'&&value.mode!=='replace')errors.push(where+'.maps.'+channel+'.mode must be multiply or replace');else map.mode=value.mode;
  if(value.texture!==undefined){
   if(!obj(value.texture)||Object.keys(value.texture).some(k=>!['data','name'].includes(k)))errors.push(where+'.maps.'+channel+'.texture must be an embedded image');
   else{const t=readTexture({...value.texture,mapping:'triplanar',scale:1,strength:1},where+'.maps.'+channel+'.texture',errors);if(t)map.texture={data:t.data,...(t.name?{name:t.name}:{})};}
  }maps[key]=map;
 }
 return errors.length===before?{maps}:undefined;
}
export function materialTexturesActive(material:MaterialSettings):boolean{return PBR_CHANNELS.some(c=>{const m=material.textures?.maps[c];return m?.enabled&&m.strength>0&&!!m.texture})}
export function textureScalar(base:number,sample:number,strength:number,mode:PbrMap['mode']):number{return Math.max(0,Math.min(1,base*(1-strength)+(mode==='multiply'?base*sample:sample)*strength))}
/** IEC sRGB EOTF. Scalar and normal bytes remain linear data.
 * https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials
 */
export function srgbChannelToLinear(c:number):number{return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}
export const PBR_RECORD_FLOATS=20;
/** MATERIAL-GRADIENT-02: 37 surface slots + 8 tail records for the gradient table (rampTextures.ts); an optional tail is copied after the slots. */
export const PBR_BUFFER_RECORDS=37+8;
export function packMaterialTextures(materials:readonly MaterialSettings[],images:readonly SurfaceImage[],tail?:Float32Array):Float32Array {
 const out=new Float32Array(PBR_BUFFER_RECORDS*PBR_RECORD_FLOATS);if(tail)out.set(tail,37*PBR_RECORD_FLOATS);
 materials.forEach((m,i)=>PBR_CHANNELS.forEach((c,k)=>{const map=m.textures?.maps[c],colorSpace=isColorMap(c)?'srgb':undefined;const layer=map?.enabled&&map.strength>0&&map.texture?images.findIndex(t=>t.data===map.texture!.data&&t.colorSpace===colorSpace):-1;out.set([layer,map?.strength??0,map?.mode==='replace'?1:0,0],i*PBR_RECORD_FLOATS+k*4)}));return out;
}
const aliases:Record<TextureChannel,readonly string[]>={baseColor:['basecolor','base_color','albedo','diffuse','diff','color','colour'],roughness:['roughness','rough'],metallic:['metallic','metalness','metal'],normal:['normal','normalgl','normaldx','nor_gl','nor_dx','nrm'],height:['height','displacement','displace','bump','disp'],ao:['ao','ambientocclusion','ambient_occlusion','occlusion'],emission:['emission','emissive']};
export interface TextureAssignment {channel:TextureChannel;matches:number[];proposed?:number;ambiguous:boolean}
/** Whole filename tokens only. Two matching images always require an artist's choice. */
export function proposeTextureAssignments(names:readonly string[]):TextureAssignment[]{return TEXTURE_CHANNELS.map(channel=>{const matches=names.flatMap((name,i)=>{const stem=name.toLowerCase().replace(/\.[^.]+$/,'');return aliases[channel].some(token=>new RegExp('(?:^|[ _.-])'+token+'(?:$|[ _.-])').test(stem))?[i]:[]});return {channel,matches,...(matches.length===1?{proposed:matches[0]}:{}),ambiguous:matches.length>1}})}
