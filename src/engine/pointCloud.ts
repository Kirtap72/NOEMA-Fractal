import type {Mesh} from './mesh';
import type {GeometryBounds,FieldSemantics} from './geometrySampling';
import {checkCancelled} from './geometrySampling';
import {linearToSrgb8} from './meshExport';
export interface SurfacePoints {
 positions:Float32Array;normals:Float32Array;colors?:Float32Array;
 /** Equivalent local disk radius for this sample's represented surface area. */
 radii:Float32Array;
 objectId:string;materialId:string;bounds:GeometryBounds;resolution:number;semantics:FieldSemantics;
 confidence:'sampled-isosurface';seed:number;
}
export interface PointSamplingOptions {count:number;seed:number;bounds:GeometryBounds;resolution:number;semantics:FieldSemantics;objectId?:string;materialId?:string;withColors?:boolean;adaptiveByCurvature?:boolean;signal?:AbortSignal}
/** Stratified quantiles of triangle area (optionally weighted by bounded curvature) with unbiased barycentric samples. */
export function sampleSurfacePoints(mesh:Mesh,options:PointSamplingOptions):SurfacePoints {
 if(!Number.isInteger(options.count)||options.count<1||options.count>1_000_000||!Number.isInteger(options.seed)||options.seed<0||options.seed>0xffffffff)throw Error('Invalid point count or sampling seed');
 checkCancelled(options.signal);
 const triangleIds:number[]=[],cdf:number[]=[],factors:number[]=[];let total=0;
 for(let t=0;t<mesh.indices.length;t+=3){
  const ids=Array.from(mesh.indices.subarray(t,t+3)),p=ids.map(i=>Array.from(mesh.positions.subarray(i*3,i*3+3))),a=p[1]!.map((v,k)=>v-p[0]![k]!),b=p[2]!.map((v,k)=>v-p[0]![k]!);
  const cross=[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!],area=Math.hypot(...cross)*.5;
  if(!Number.isFinite(area)||area<1e-16)continue;
  const normals=ids.map(i=>Array.from(mesh.normals.subarray(i*3,i*3+3)));
  const cosine=Math.min(...[0,1,2].map(k=>normals[k]!.reduce((s,v,j)=>s+v*normals[(k+1)%3]![j]!,0)));
  const factor=options.adaptiveByCurvature?1+Math.min(1,Math.max(0,1-cosine)*4):1;
  total+=area*factor;triangleIds.push(t);cdf.push(total);factors.push(factor);
 }
 if(!triangleIds.length||!Number.isFinite(total))throw Error('No valid surface area for point sampling');
 let state=options.seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
 const positions=new Float32Array(options.count*3),normals=new Float32Array(options.count*3),colors=options.withColors&&mesh.colors?new Float32Array(options.count*3):undefined,radii=new Float32Array(options.count);
 let triangle=0;
 for(let i=0;i<options.count;i++){
  if(i%4096===0)checkCancelled(options.signal);
  const area=(i+random())*total/options.count;while(triangle<cdf.length-1&&cdf[triangle]!<area)triangle++;
  const t=triangleIds[triangle]!,root=Math.sqrt(random()),v=random(),weights=[1-root,root*(1-v),root*v];
  for(let k=0;k<3;k++)for(let corner=0;corner<3;corner++){const source=mesh.indices[t+corner]!*3+k,target=i*3+k;positions[target]=positions[target]!+weights[corner]!*mesh.positions[source]!;normals[target]=normals[target]!+weights[corner]!*mesh.normals[source]!;if(colors)colors[target]=colors[target]!+weights[corner]!*mesh.colors![source]!;}
  const length=Math.hypot(...normals.subarray(i*3,i*3+3));if(length<1e-10)throw Error('Undefined sampled surface normal');for(let k=0;k<3;k++)normals[i*3+k]=normals[i*3+k]!/length;
  radii[i]=Math.sqrt(total/options.count/factors[triangle]!/Math.PI);
 }
 return {positions,normals,...(colors?{colors}:{}),radii,objectId:options.objectId??'fractal',materialId:options.materialId??'scene',bounds:options.bounds,resolution:options.resolution,semantics:options.semantics,confidence:'sampled-isosurface',seed:options.seed};
}
export function pointsToPly(points:SurfacePoints,options:{normals?:boolean;colors?:boolean;ids?:boolean}={}):Uint8Array {
 const n=points.positions.length/3,normal=options.normals??true,color=(options.colors??true)&&!!points.colors,ids=options.ids??true;
 const comment=JSON.stringify({idTables:{objects:[points.objectId],materials:[points.materialId]},bounds:points.bounds,resolution:points.resolution,semantics:points.semantics,confidence:points.confidence,seed:points.seed});
 const header=new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment Fraktalmotorn surface points ${comment}\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\n${normal?'property float nx\nproperty float ny\nproperty float nz\n':''}${color?'property uchar red\nproperty uchar green\nproperty uchar blue\n':''}${ids?'property uint object_id\nproperty uint material_id\n':''}end_header\n`);
 const stride=12+(normal?12:0)+(color?3:0)+(ids?8:0),out=new Uint8Array(header.length+n*stride);out.set(header);const view=new DataView(out.buffer);let offset=header.length;
 for(let i=0;i<n;i++){for(let k=0;k<3;k++,offset+=4)view.setFloat32(offset,points.positions[i*3+k]!,true);if(normal)for(let k=0;k<3;k++,offset+=4)view.setFloat32(offset,points.normals[i*3+k]!,true);if(color)for(let k=0;k<3;k++)view.setUint8(offset++,linearToSrgb8(points.colors![i*3+k]!));if(ids){view.setUint32(offset,0,true);view.setUint32(offset+4,0,true);offset+=8;}}
 return out;
}
