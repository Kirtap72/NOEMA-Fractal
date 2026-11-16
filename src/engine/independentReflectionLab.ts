/** QUALITY LAB 02 only. No scene schema or production-default change. */
import type {Scene} from './scene';
export type ReflectionSampleCount=1|2|4;
export const MAX_REFLECTION_CAMERA_ID=0x7fffff;
export function readReflectionSampleCount(value:unknown):ReflectionSampleCount{
 if(value!==1&&value!==2&&value!==4)throw Error('Reflection samples must be 1, 2 or 4');return value;
}
/** Stateless dimensions. Keep all indices below 2^31: the legacy sampler doubles them. */
export function reflectionLabIndex(camera:number,sample:number,referenceStream?:0|1):number{
 if(!Number.isInteger(camera)||camera<0||camera>MAX_REFLECTION_CAMERA_ID||!Number.isInteger(sample)||sample<0||sample>=(referenceStream===undefined?4:64))throw Error('Reflection sample identity outside lab range');
 if(referenceStream!==undefined)return (referenceStream===0?0x40000000:0x60000000)+camera*64+sample;
 return sample===0?camera:0x10000000+camera*4+sample-1;
}
export function reflectionLabProblem(scene:Scene):string|undefined{
 if(!scene.reflections.enabled)return;
 if(scene.reflections.samples!==1)return 'The research option requires a saved reflection sample. The older sample budget is preserved.';
 if(scene.reflections.maxReflectionBounces!==1)return 'The research option is verified for exactly one reflection bounce.';
 if(scene.transport?.enabled)return 'The research option does not support transmission.';
}
function replaceOnce(shader:string,from:string,to:string):string{
 if(shader.split(from).length!==2)throw Error('Independent reflection shader anchor missing or repeated: '+from);return shader.replace(from,to);
}
/** Only the secondary loop bound and identities change. All field/BRDF/integration text remains intact. */
export function independentReflectionShader(shader:string,samples:ReflectionSampleCount):string{
 readReflectionSampleCount(samples);if(samples===1)return shader;
 // Keep the legacy uniform loop bound, avoiding static secondary-kernel expansion.
 return replaceOnce(shader,'let index=u32(u.reflectionSampling.z)*u32(count)+u32(i);',
  'let camera=u32(u.reflectionSampling.z);\n  let index=select(0x10000000u+camera*4u+u32(i)-1u,camera,i==0);');
}
/** Disjoint diagnostic streams, same camera sample set; never part of the artist control. */
export function reflectionReferenceShader(shader:string,samples:8|12|16|32|64,stream:0|1):string{
 if((![8,12,16,32,64].includes(samples))||(stream!==0&&stream!==1))throw Error('Invalid reflection reference');
 // Keep the legacy uniform loop bound, avoiding static secondary-kernel expansion.
 return replaceOnce(shader,'let index=u32(u.reflectionSampling.z)*u32(count)+u32(i);',`let index=${stream===0?'0x40000000u':'0x60000000u'}+u32(u.reflectionSampling.z)*64u+u32(i);`);
}
