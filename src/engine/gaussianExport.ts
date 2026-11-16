import type {SurfacePoints} from './pointCloud';
export interface GaussianOptions {scaleMultiplier:number;opacity:number;opacityMode:'constant'|'coverage';colorMode:'surface-color'|'constant';color?:[number,number,number];normalThickness?:number}
export interface GaussianSet {
 points:SurfacePoints;
 /** Actual positive world-space standard deviations, not stored log scales. Local Z is the surface normal. */
 scales:Float32Array;
 /** Scalar-first unit quaternions (w,x,y,z). */
 rotations:Float32Array;
 opacity:Float32Array;
 /** SH DC in sRGB appearance space. Higher coefficients are deliberately zero. */
 dc:Float32Array;
 representation:'surface-geometric';options:GaussianOptions;
}
/** Packed patch/sort indices use Uint32. Practical capacity is chosen by memory/file budgets. */
export const MAX_GAUSSIAN_COUNT=0xffffffff;
export const SH_DC_FACTOR=0.28209479177387814;
const srgb=(v:number)=>{v=Math.max(0,Math.min(1,v));return v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;};
export function validateGaussianOptions(options:GaussianOptions,hasColors:boolean):void{
 if(!Number.isFinite(options.scaleMultiplier)||options.scaleMultiplier<.25||options.scaleMultiplier>4||!Number.isFinite(options.opacity)||options.opacity<=0||options.opacity>=.9999999)throw Error('Invalid Gaussian scale or opacity');
 if(options.normalThickness!==undefined&&(!Number.isFinite(options.normalThickness)||options.normalThickness<=0||options.normalThickness>1))throw Error('Invalid Gaussian normal thickness');
 if(options.colorMode==='surface-color'&&!hasColors)throw Error('Surface colour samples are required');
 if(!['surface-color','constant'].includes(options.colorMode)||!['constant','coverage'].includes(options.opacityMode))throw Error('Invalid Gaussian colour/opacity mode');
 if(options.color&&(options.color.length!==3||!options.color.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))throw Error('Invalid constant Gaussian colour');
}
/** Direct geometric construction, no training or camera-dependent appearance fit. Covariance = R diag(s²) Rᵀ. */
export function constructGaussians(points:SurfacePoints,options:GaussianOptions):GaussianSet{
 const n=points.positions.length/3;
 if(!Number.isInteger(n)||n<1||n>MAX_GAUSSIAN_COUNT||points.normals.length!==n*3||points.radii.length!==n||points.colors&&points.colors.length!==n*3)throw Error('Invalid Gaussian sample count/attributes');
 validateGaussianOptions(options,!!points.colors);
 const scales=new Float32Array(n*3),rotations=new Float32Array(n*4),opacity=new Float32Array(n),dc=new Float32Array(n*3);
 for(let i=0;i<n;i++){
  const normal=Array.from(points.normals.subarray(i*3,i*3+3)),length=Math.hypot(...normal),radius=points.radii[i]!;
  if(!normal.every(Number.isFinite)||Math.abs(length-1)>1e-4||!Number.isFinite(radius)||radius<=0||!Array.from(points.positions.subarray(i*3,i*3+3)).every(Number.isFinite))throw Error('Invalid Gaussian surface position/normal/radius');
  const [x,y,z]=normal.map(v=>v/length);
  // Shortest rotation from local +Z to normal, with a stable antipodal convention.
  const q=z!<=-1+1e-12?[0,1,0,0]:[1+z!,-y!,x!,0],qLength=Math.hypot(...q);rotations.set(q.map(v=>v/qLength),i*4);
  const tangent=radius*options.scaleMultiplier;
  scales.set([tangent,tangent,tangent*(options.normalThickness??.12)],i*3);
  // Coverage mode conserves approximate integrated alpha across size changes. This is geometric, not trained opacity.
  const alpha=options.opacityMode==='coverage'?1-(1-options.opacity)**(1/options.scaleMultiplier**2):options.opacity;
  // Float32 must remain strictly inside (0,1), also when coverage saturates or tiny alpha underflows.
  opacity[i]=Math.max(1e-7,Math.min(1-1e-7,alpha));
  for(let k=0;k<3;k++){const color=options.colorMode==='surface-color'?points.colors![i*3+k]!:options.color?.[k]??.65;if(!Number.isFinite(color))throw Error('Invalid Gaussian surface colour');dc[i*3+k]=(srgb(color)-.5)/SH_DC_FACTOR;}
 }
 return {points,scales,rotations,opacity,dc,representation:'surface-geometric',options:{...options}};
}
/** Standard 3DGS PLY conventions: log sigma, opacity logit, scalar-first quaternion, SH DC + 45 zero higher coefficients.
 * Storing a degree-3 layout with zero high bands also supports conventional readers expecting f_rest_0..44. */
export const GAUSSIAN_PLY_STRIDE=248;
export function gaussianPlyHeader(n:number,metadata:unknown):Uint8Array{
 if(!Number.isSafeInteger(n)||n<1||n>MAX_GAUSSIAN_COUNT)throw Error('Invalid PLY count');
 const names=['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2',...Array.from({length:45},(_,i)=>`f_rest_${i}`),'opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
 return new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment Fraktalmotorn genuine 3DGS ${JSON.stringify(metadata)}\nelement vertex ${n}\n${names.map(name=>`property float ${name}\n`).join('')}end_header\n`);
}
/** A fresh bounded buffer; consumers can keep a chunk without a later mutation. */
export function encodeGaussianRecords(gaussians:GaussianSet,start=0,end=gaussians.points.positions.length/3):Uint8Array{
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>gaussians.points.positions.length/3)throw Error('Invalid Gaussian chunk range');
 const out=new Uint8Array((end-start)*GAUSSIAN_PLY_STRIDE),view=new DataView(out.buffer);let offset=0;
 for(let i=start;i<end;i++){
  const alpha=gaussians.opacity[i]!;
  const fields=[...gaussians.points.positions.subarray(i*3,i*3+3),...gaussians.points.normals.subarray(i*3,i*3+3),...gaussians.dc.subarray(i*3,i*3+3),...new Array<number>(45).fill(0),Math.log(alpha/(1-alpha)),...Array.from(gaussians.scales.subarray(i*3,i*3+3),Math.log),...gaussians.rotations.subarray(i*4,i*4+4)];
  if(fields.some(v=>!Number.isFinite(v)))throw Error('Gaussian encoding produced a non-finite attribute');
  for(const value of fields){view.setFloat32(offset,value,true);offset+=4;}
 }
 return out;
}
export function gaussiansToPly(gaussians:GaussianSet):Uint8Array{
 const n=gaussians.points.positions.length/3;
 const metadata={representation:gaussians.representation,activeSHDegree:0,storedSHDegree:3,colorSpace:'sRGB',coordinateSystem:'right-handed Y-up; explicit import axes required',objectId:gaussians.points.objectId,materialId:gaussians.points.materialId,bounds:gaussians.points.bounds,seed:gaussians.points.seed,options:gaussians.options};
 const header=gaussianPlyHeader(n,metadata),out=new Uint8Array(header.length+n*GAUSSIAN_PLY_STRIDE);out.set(header);
 for(let start=0;start<n;start+=4096)out.set(encodeGaussianRecords(gaussians,start,Math.min(n,start+4096)),header.length+start*GAUSSIAN_PLY_STRIDE);
 return out;
}
