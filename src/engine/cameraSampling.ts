/** One progressive 2D Sobol net, nested-scrambled independently for each global film pixel.
 * The zero branch is conditioned to the pixel centre, retaining exact one-sample guides.
 * This is a deterministic quadrature rule, not a claim of unbiased independent Monte Carlo.
 * 4/16/64 prefixes cover each 2x2/4x4/8x8 cell once. No reconstruction filter is applied.
 */
export const CAMERA_SAMPLE_LIMIT = 0x1000000;
const hash = (v:number):number => {v^=v>>>16;v=Math.imul(v,0x7feb352d);v^=v>>>15;v=Math.imul(v,0x846ca68b);return (v^(v>>>16))>>>0;};
function sobol(index:number,dimension:number):number {
 let gray=(index^(index>>>1))>>>0,direction=0x800000,value=0;
 for(let bit=0;bit<24;bit++){if(gray&1)value^=direction;gray>>>=1;direction=dimension===0?direction>>>1:direction^(direction>>>1);}
 return value;
}
function scramble(value:number,salt:number):number {
 let prefix=0,result=0;
 for(let bit=23;bit>=0;bit--){const digit=(value>>>bit)&1;
  const flip=prefix===0?(bit===23?1:0):hash(salt^hash(prefix)^Math.imul(bit+1,0x9e3779b9))&1;
  result=(result<<1)|(digit^flip);prefix=(prefix<<1)|digit;
 }
 return result;
}
export function stratifiedCameraJitter(index:number,seed:number,x:number,y:number):[number,number]{
 if(!Number.isSafeInteger(index)||index<0||index>=CAMERA_SAMPLE_LIMIT)throw Error('Camera sample index must be an integer below 2^24');
 const salt=hash((seed>>>0)^hash(x>>>0)^hash((y^0x63d83595)>>>0)^0xa511e9b3);
 return [scramble(sobol(index,0),salt^0x68bc21eb)/CAMERA_SAMPLE_LIMIT-.5,scramble(sobol(index,1),salt^0x02e5be93)/CAMERA_SAMPLE_LIMIT-.5];
}
/** Same integer operations as the CPU reference; camera has its own namespace, separate from transport RNG. */
export const cameraSamplingWgsl=/* wgsl */`
fn cameraHash(input:u32)->u32{var v=input;v^=v>>16u;v*=0x7feb352du;v^=v>>15u;v*=0x846ca68bu;return v^(v>>16u);}
fn cameraSobol(index:u32,dimension:u32)->u32{
 var gray=index^(index>>1u);var direction=0x800000u;var value=0u;
 for(var bit=0u;bit<24u;bit++){if((gray&1u)!=0u){value^=direction;}gray>>=1u;if(dimension==0u){direction>>=1u;}else{direction^=direction>>1u;}}
 return value;
}
fn cameraScramble(value:u32,salt:u32)->u32{
 var prefix=0u;var result=0u;
 for(var level=0u;level<24u;level++){let bit=23u-level;let digit=(value>>bit)&1u;var flip=0u;
  if(prefix==0u){if(bit==23u){flip=1u;}}else{flip=cameraHash(salt^cameraHash(prefix)^((bit+1u)*0x9e3779b9u))&1u;}
  result=(result<<1u)|(digit^flip);prefix=(prefix<<1u)|digit;
 }
 return result;
}
fn cameraPixelJitter(pixel:vec2f)->vec2f{
 if(u.cameraSampling.x<0.5){return u.extra.xy;}
 let seed=u32(u.cameraSampling.y)|(u32(u.cameraSampling.z)<<16u);
 let index=u32(u.cameraSampling.w);
 let salt=cameraHash(seed^cameraHash(u32(pixel.x))^cameraHash(u32(pixel.y)^0x63d83595u)^0xa511e9b3u);
 return vec2f(f32(cameraScramble(cameraSobol(index,0u),salt^0x68bc21ebu)),f32(cameraScramble(cameraSobol(index,1u),salt^0x02e5be93u)))/16777216.0-vec2f(0.5);
}
`;
