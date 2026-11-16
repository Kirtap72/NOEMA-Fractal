import type {LibraryBackup} from '../engine/discoveryLibrary';

export const LIBRARY_JSON_FILE_LIMIT=128*1024*1024;
export const LIBRARY_EXPANDED_LIMIT=512*1024*1024;
export const LIBRARY_GZIP_FILE_LIMIT=128*1024*1024;
/** Lossless container for large embedded geometry maps. The inner format remains library v1. */
export async function encodeLibraryBackupFile(backup:LibraryBackup,jsonLimit=LIBRARY_JSON_FILE_LIMIT,expandedLimit=LIBRARY_EXPANDED_LIMIT):Promise<{name:string;blob:Blob}> {
 const parts:BlobPart[]=[JSON.stringify({format:backup.format,version:backup.version,exportedAt:backup.exportedAt}).slice(0,-1)+',"records":['];
 backup.records.forEach((record,i)=>parts.push((i?',':'')+JSON.stringify(record)));parts.push(']}');
 const json=new Blob(parts,{type:'application/json'});
 if(json.size>expandedLimit)throw Error('The backup exceeds the unpacked budget of 512 MiB. Split the library before export.');
 if(json.size<=jsonLimit)return {name:'mina-fraktaler.library.json',blob:json};
 const blob=await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
 return {name:'mina-fraktaler.library.json.gz',blob};
}
export async function readLibraryBackupFile(file:Blob&{name?:string},expandedLimit=LIBRARY_EXPANDED_LIMIT,jsonLimit=LIBRARY_JSON_FILE_LIMIT,gzipLimit=LIBRARY_GZIP_FILE_LIMIT):Promise<unknown> {
 const gzip=/\.gz$/i.test(file.name??'');
 if(file.size>(gzip?gzipLimit:jsonLimit))throw Error(gzip?'The compressed backup exceeds the file budget of 128 MiB.':'Backup larger than 128 MiB. Use the lossless .json.gz export of the app for large maps.');
 let size=0;const bounded=new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){size+=chunk.byteLength;if(size>expandedLimit)throw Error('The unpacked backup exceeds the budget of 512 MiB.');controller.enqueue(chunk);}});
 const stream=gzip?file.stream().pipeThrough(new DecompressionStream('gzip')):file.stream();
 // Enforce the expansion bound while streaming, before constructing the JSON string or opening storage.
 return JSON.parse(await new Response(stream.pipeThrough(bounded)).text());
}
