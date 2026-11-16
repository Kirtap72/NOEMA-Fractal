/** Display only: beauty buffers remain scene-linear RGB with sRGB/Rec.709 primaries. */
export interface DisplaySettings {exposure:number; toneMapping:'linear'|'reinhard'|'filmic'; transfer:'legacy-gamma'|'srgb';}
export const defaultDisplay=():DisplaySettings=>({exposure:0,toneMapping:'linear',transfer:'legacy-gamma'});
export function readDisplay(raw:unknown,errors:string[]):DisplaySettings {
 if(raw===undefined)return defaultDisplay();
 const d=raw as DisplaySettings;
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['exposure','toneMapping','transfer'].includes(k))||!Number.isFinite(d.exposure)||Math.abs(d.exposure)>20||!['linear','reinhard','filmic'].includes(d.toneMapping)||!['legacy-gamma','srgb'].includes(d.transfer)){errors.push('display needs exposure -20–20 EV, toneMapping and transfer');return defaultDisplay();}
 return {...d};
}
export function displayValue(value:number,d:DisplaySettings=defaultDisplay()):number {
 let x=Math.max(0,value)*2**d.exposure;
 if(d.toneMapping==='reinhard')x=x/(1+x);
 // A rational filmic shoulder, ACES-style appearance; not the ACES reference transform.
 if(d.toneMapping==='filmic')x=(x*(2.51*x+.03))/(x*(2.43*x+.59)+.14);
 x=Math.max(0,Math.min(1,x));
 return d.transfer==='srgb'?(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055):x**(1/2.2);
}
/**
 * The 8-bit value of a scene-linear number is a monotone step function of it, so instead of evaluating the transfer curve (a power) for
 * every channel of every pixel, the 255 places where the 8-bit value steps up are found once per display setting, by bisection on the very
 * same `displayValue`, and each channel is then placed among them with a handful of comparisons. The result is identical to evaluating
 * `Math.round(255*displayValue(v))`; tests compare the two on many millions of values.
 */
const thresholdCache = new Map<string, Float64Array>();
function byteThresholds(d: DisplaySettings): Float64Array {
 const key = `${d.exposure}|${d.toneMapping}|${d.transfer}`;
 let t = thresholdCache.get(key);
 if (t) return t;
 t = new Float64Array(255);
 for (let b = 1; b <= 255; b++) {
  let lo = 0, hi = 1e30;
  if (Math.round(255 * displayValue(hi, d)) < b) { t[b - 1] = Infinity; continue; }
  for (let i = 0; i < 400 && lo < hi; i++) { const mid = (lo + hi) / 2; if (mid === lo || mid === hi) break; if (Math.round(255 * displayValue(mid, d)) >= b) hi = mid; else lo = mid; }
  t[b - 1] = hi;
 }
 if (thresholdCache.size > 16) thresholdCache.clear();
 thresholdCache.set(key, t);
 return t;
}
export function displayRgba(linear:Float32Array,d:DisplaySettings=defaultDisplay()):Uint8Array {
 const out=new Uint8Array(linear.length),t=byteThresholds(d);
 for(let i=0;i<out.length;i+=4){
  for(let c=0;c<3;c++){
   const v=linear[i+c]!;
   if(!(v<Infinity)){out[i+c]=Math.round(255*displayValue(v,d));continue;} // NaN and +Infinity keep the exact original arithmetic
   let lo=0,hi=255; // number of thresholds that are <= v
   while(lo<hi){const mid=(lo+hi)>>1;if(t[mid]!<=v)lo=mid+1;else hi=mid;}
   out[i+c]=lo;
  }
  out[i+3]=Math.round(255*Math.max(0,Math.min(1,linear[i+3]!)));
 }
 return out;
}
/** The original per-value evaluation, kept as the reference the faster version is tested against. */
export function displayRgbaReference(linear:Float32Array,d:DisplaySettings=defaultDisplay()):Uint8Array {
 const out=new Uint8Array(linear.length);
 for(let i=0;i<out.length;i+=4){for(let c=0;c<3;c++)out[i+c]=Math.round(255*displayValue(linear[i+c]!,d));out[i+3]=Math.round(255*Math.max(0,Math.min(1,linear[i+3]!)));}
 return out;
}
/** Exact half decoding, including subnormal values. No gamma and no 0–1 clamp. */
export function halfToFloat(h:number):number {const s=h&32768?-1:1,e=(h>>10)&31,m=h&1023;return s*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));}
export const displayWgsl=/* wgsl */`
fn displayColor(value:vec3f)->vec3f{
 var x=max(value,vec3f(0.0));
 if(u.display.w>0.5){return x;}
 x*=exp2(u.display.x);
 if(u.display.y>0.5&&u.display.y<1.5){x=x/(vec3f(1.0)+x);}
 if(u.display.y>1.5){x=(x*(2.51*x+vec3f(0.03)))/(x*(2.43*x+vec3f(0.59))+vec3f(0.14));}
 x=clamp(x,vec3f(0.0),vec3f(1.0));
 if(u.display.z>0.5){return select(1.055*pow(x,vec3f(1.0/2.4))-vec3f(0.055),12.92*x,x<=vec3f(0.0031308));}
 return pow(x,vec3f(1.0/2.2));
}
`;
