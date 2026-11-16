import type {FieldMap} from '../../engine/fieldMaps';
import {fieldMapErrors,compactFieldMap} from '../../engine/fieldMaps';

/** A local, user-supplied resource pack. Missing files are explicit in the compatibility preview. */
export async function loadMb3dFieldResources(ids:readonly number[]):Promise<FieldMap[]>{
  if(!ids.length)return [];
  try{
    const response=await fetch('/mb3d-maps/manifest.json');if(!response.ok)return [];
    const manifest=await response.json() as {resources:Record<string,{path:string}>;ambiguous?:Record<string,string[]>};
    const maps:FieldMap[]=[];
    for(const id of ids){
      const entry=manifest.resources[String(id)];if(manifest.ambiguous?.[String(id)]){maps.push({id,reference:manifest.ambiguous[String(id)]!.join(' | '),sampler:'periodic-bspline',status:'AMBIGUOUS'});continue;}if(!entry||!/^\d+\.json$/.test(entry.path))continue;
      const response=await fetch('/mb3d-maps/'+entry.path);if(!response.ok)continue;
      const map=await response.json() as FieldMap;if(map.id===id&&map.rgb8&&!fieldMapErrors([map]).length)maps.push(compactFieldMap(map));
    }return maps;
  }catch{return [];}
}

/** Explicit user attachment. No gamma conversion; image RGB bytes remain the geometry field. */
export async function fieldMapFromImage(file:File,id:number):Promise<FieldMap>{
  const bitmap=await createImageBitmap(file,{colorSpaceConversion:'none'});
  try{
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d')!;
    context.drawImage(bitmap,0,0);const rgba=context.getImageData(0,0,bitmap.width,bitmap.height).data;
    const chunks:string[]=[];let chars:number[]=[];
    for(let i=0;i<rgba.length;i+=4){chars.push(rgba[i]!,rgba[i+1]!,rgba[i+2]!);if(chars.length>=12288){chunks.push(String.fromCharCode(...chars));chars=[];}}
    if(chars.length)chunks.push(String.fromCharCode(...chars));
    return compactFieldMap({id,reference:file.name,sampler:'periodic-bspline',width:bitmap.width,height:bitmap.height,rgb8:btoa(chunks.join(''))});
  }finally{bitmap.close();}
}
