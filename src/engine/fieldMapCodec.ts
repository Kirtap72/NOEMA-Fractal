/** Lossless grayscale RGB storage. PackBits-style packets, independently written.
 * Tags 0..127: tag+1 literals; 128..255: (tag&127)+1 copies of next byte.
 * No quantization, gamma conversion or dimension change is allowed.
 */
export const MAX_COMPACT_FIELD_PIXELS=Math.floor(512*1024*1024/3);
export function bytesToBase64(bytes:Uint8Array):string {
 const chunks:string[]=[];for(let i=0;i<bytes.length;i+=12288)chunks.push(String.fromCharCode(...bytes.subarray(i,i+12288)));return btoa(chunks.join(''));
}
export function base64ToBytes(data:string):Uint8Array {
 const text=atob(data),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return bytes;
}
/** Returns null for any non-grayscale image; never throws away RGB channels. */
export function encodeGrayField(rgb:Uint8Array):Uint8Array|null {
 if(rgb.length%3)throw Error('Incomplete RGB pixel');
 const pixels=rgb.length/3;for(let i=0;i<rgb.length;i+=3)if(rgb[i]!==rgb[i+1]||rgb[i]!==rgb[i+2])return null;
 const chunks:Uint8Array[]=[],size=65536;let chunk=new Uint8Array(size),used=0,total=0;
 const push=(v:number)=>{if(used===size){chunks.push(chunk);total+=used;chunk=new Uint8Array(size);used=0;}chunk[used++]=v;};
 let p=0;while(p<pixels){let run=1;while(run<128&&p+run<pixels&&rgb[(p+run)*3]===rgb[p*3])run++;
  if(run>=3){push(128+run-1);push(rgb[p*3]!);p+=run;continue;}
  const start=p;p+=run;
  while(p<pixels&&p-start<128){run=1;while(run<3&&p+run<pixels&&rgb[(p+run)*3]===rgb[p*3])run++;if(run>=3)break;p+=Math.min(run,128-(p-start));}
  push(p-start-1);for(let i=start;i<p;i++)push(rgb[i*3]!);
 }
 const result=new Uint8Array(total+used);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}result.set(chunk.subarray(0,used),offset);return result;
}
/** Validate expansion before allocation. Malformed/truncated/oversized packets fail. */
export function grayFieldPacketError(packed:Uint8Array,pixels:number):string|undefined {
 if(!Number.isSafeInteger(pixels)||pixels<1||pixels>MAX_COMPACT_FIELD_PIXELS)return 'compressed formula field exceeds pixel budget';
 let count=0,p=0;while(p<packed.length){const tag=packed[p++]!,n=(tag&127)+1,bytes=tag<128?n:1;if(p+bytes>packed.length||count+n>pixels)return 'invalid grayscale formula field packet';p+=bytes;count+=n;}
 return count===pixels?undefined:'incomplete grayscale formula field';
}
export function decodeGrayField(packed:Uint8Array,pixels:number):Uint8Array {
 const error=grayFieldPacketError(packed,pixels);if(error)throw Error(error);
 const out=new Uint8Array(pixels);let p=0,d=0;while(p<packed.length){const tag=packed[p++]!,n=(tag&127)+1;if(tag<128){out.set(packed.subarray(p,p+n),d);p+=n;}else out.fill(packed[p++]!,d,d+n);d+=n;}return out;
}
