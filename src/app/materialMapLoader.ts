import {bytesToBase64} from '../engine/radiance';
import {imageHeaderDimensions} from '../engine/textureResources';
import type {SurfaceImage} from '../engine/surfaceDetail';
export async function readMaterialMap(file:File,signal:AbortSignal):Promise<SurfaceImage>{
 signal.throwIfAborted();if(!['image/png','image/jpeg'].includes(file.type)||file.size>5_999_950)throw Error('Choose PNG/JPEG, at most about 6 MB per map.');
 const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();const data=`data:${file.type};base64,`+bytesToBase64(bytes);imageHeaderDimensions(data);
 const bitmap=await createImageBitmap(file,{colorSpaceConversion:'none',premultiplyAlpha:'none'});bitmap.close();signal.throwIfAborted();return {data,name:file.name.slice(0,100)};
}
