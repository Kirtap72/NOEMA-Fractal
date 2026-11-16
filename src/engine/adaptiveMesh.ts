import {extractSurface} from './mesh';
import type {Mesh} from './mesh';
import type {Vec3} from './camera';
import {checkCancelled,sampleChecked,samplingGrid} from './geometrySampling';
import type {GeometrySampler,SamplingOptions,GeometryDiagnostics} from './geometrySampling';

export interface MeshExportResult {mesh:Mesh;diagnostics:GeometryDiagnostics & {triangles:number;boundaryEdges:number;nonManifoldEdges:number;skippedBlocks:number;outputBytes:number;simplifiedTriangles:number;maxDisplacement:number}}
/** Tiled Surface Nets with shared global cell ownership. Halo cells make tile interfaces identical to a monolithic grid. */
export async function extractAdaptiveMesh(sampler:GeometrySampler,options:SamplingOptions & {simplifyTolerance?:number;featureAngleDegrees?:number;withColors?:boolean}):Promise<MeshExportResult>{
 const {cells,step,block,maxSamples,maxVertices}=samplingGrid(options);
 const diagnostics:MeshExportResult['diagnostics']={semantics:sampler.semantics,samples:0,invalidSamples:0,peakSampleBytes:0,warnings:[],triangles:0,boundaryEdges:0,nonManifoldEdges:0,skippedBlocks:0,outputBytes:0,simplifiedTriangles:0,maxDisplacement:0};
 if(sampler.semantics!=='signed-distance')diagnostics.warnings.push('Distance estimator: topology and sub-voxel detail are not guaranteed; a positive isovalue may be required for unsigned zero interiors.');
 const positions:number[]=[],normals:number[]=[],indices:number[]=[],vertices=new Map<string,number>(),faces=new Set<string>();
 const total=cells.reduce((n,c)=>n*Math.ceil(c/block),1);let done=0;
 for(let z=0;z<cells[2];z+=block)for(let y=0;y<cells[1];y+=block)for(let x=0;x<cells[0];x+=block){
  checkCancelled(options.signal);const start=[x,y,z],lo=start.map(v=>Math.max(0,v-1)),hi=start.map((v,k)=>Math.min(cells[k]!,v+block+1));
  const size=hi.map((v,k)=>v-lo[k]!+1) as Vec3;
  const origin=lo.map((v,k)=>options.bounds.min[k]!+v*step[k]!) as Vec3;
  // Only certified fields can cull blocks. Fractal DE values never justify skipping unsampled structures.
  if(sampler.semantics==='signed-distance'&&sampler.lipschitz!==undefined&&Number.isFinite(sampler.lipschitz)&&sampler.lipschitz>0){
   const centre=lo.map((v,k)=>options.bounds.min[k]!+(v+hi[k]!)*.5*step[k]!) as Vec3;
   const radius=Math.hypot(...hi.map((v,k)=>(v-lo[k]!)*step[k]!))*.5;
   const sample=await sampleChecked(sampler,[centre],diagnostics,maxSamples,options.signal);
   if(sample.valid[0]&&Math.abs(sample.values[0]!-options.isoLevel)>sampler.lipschitz*radius){diagnostics.skippedBlocks++;options.onProgress?.(++done,total);continue;}
  }
  const points:Vec3[]=[];
  for(let k=lo[2]!;k<=hi[2]!;k++)for(let j=lo[1]!;j<=hi[1]!;j++)for(let i=lo[0]!;i<=hi[0]!;i++)points.push([options.bounds.min[0]+i*step[0],options.bounds.min[1]+j*step[1],options.bounds.min[2]+k*step[2]]);
  const batch=await sampleChecked(sampler,points,diagnostics,maxSamples,options.signal);
  // An invalid domain is a hole, never a synthetic high distance that creates a bogus crossing.
  for(let i=0;i<batch.values.length;i++)if(!batch.valid[i])batch.values[i]=NaN;
  const cellIds:Vec3[]=[];
  const tile=extractSurface(batch.values,{origin,step,size},options.isoLevel,cell=>cellIds.push(cell)),remap=new Int32Array(tile.positions.length/3).fill(-1);
  for(let i=0;i<remap.length;i++){
   const p=Array.from(tile.positions.subarray(i*3,i*3+3));if(!p.every(Number.isFinite)||!Array.from(tile.normals.subarray(i*3,i*3+3)).every(Number.isFinite))continue;
   const key=cellIds[i]!.map((v,k)=>v+lo[k]!).join(',');let id=vertices.get(key);
   if(id===undefined){if(vertices.size>=maxVertices)throw Error('Geometry vertex budget exceeded');id=vertices.size;vertices.set(key,id);positions.push(...p);normals.push(...tile.normals.subarray(i*3,i*3+3));}
   remap[i]=id;
  }
  for(let i=0;i<tile.indices.length;i+=3){const triangle=[remap[tile.indices[i]!]!,remap[tile.indices[i+1]!]!,remap[tile.indices[i+2]!]!];if(triangle.some(v=>v<0)||new Set(triangle).size!==3)continue;
   const key=[...triangle].sort((a,b)=>a-b).join(',');if(!faces.has(key)){faces.add(key);indices.push(...triangle);}}
  options.onProgress?.(++done,total);await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 let mesh:Mesh={positions:Float32Array.from(positions),normals:Float32Array.from(normals),indices:Uint32Array.from(indices)};
 const before=mesh.indices.length/3,tolerance=options.simplifyTolerance??0;
 if(!Number.isFinite(tolerance)||tolerance<0)throw Error('Invalid simplification tolerance');
 if(tolerance>0){const simplified=simplifySmoothEdges(mesh,tolerance,options.featureAngleDegrees??15);mesh=simplified.mesh;diagnostics.maxDisplacement=simplified.maxDisplacement;}
 diagnostics.simplifiedTriangles=before-mesh.indices.length/3;
 if(options.withColors&&sampler.colors)mesh.colors=await sampler.colors(mesh.positions,mesh.normals);
 Object.assign(diagnostics,meshTopology(mesh));diagnostics.triangles=mesh.indices.length/3;diagnostics.outputBytes=mesh.positions.byteLength+mesh.normals.byteLength+mesh.indices.byteLength+(mesh.colors?.byteLength??0);
 if(diagnostics.invalidSamples)diagnostics.warnings.push('Invalid field domains were omitted; inspect open boundaries.');
 if(diagnostics.boundaryEdges)diagnostics.warnings.push('Open boundaries: bounds, invalid domains or unresolved small structures.');
 if(diagnostics.nonManifoldEdges)diagnostics.warnings.push('Non-manifold contacts: not a guaranteed watertight manufacturing mesh.');
 return {mesh,diagnostics};
}
export function meshTopology(mesh:Mesh):{boundaryEdges:number;nonManifoldEdges:number}{
 const edges=new Map<string,number>();for(let i=0;i<mesh.indices.length;i+=3)for(let k=0;k<3;k++){const a=mesh.indices[i+k]!,b=mesh.indices[i+(k+1)%3]!,key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)??0)+1);}
 return {boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonManifoldEdges:[...edges.values()].filter(n=>n>2).length};
}
/** One disjoint collapse pass: manifold link condition, angular feature guard and explicit geometric error bound.
 * Boundary/non-manifold vertices are protected. This reduces smooth regions without claiming exact fractal geometry. */
export function simplifySmoothEdges(mesh:Mesh,tolerance:number,angle:number):{mesh:Mesh;maxDisplacement:number}{
 if(!Number.isFinite(angle)||angle<0||angle>60)throw Error('Feature angle must be 0–60 degrees');
 const n=mesh.positions.length/3,neighbours=Array.from({length:n},()=>new Set<number>()),incident=Array.from({length:n},()=>[] as number[]),edges=new Map<string,{a:number;b:number;faces:number[]}>();
 for(let t=0;t<mesh.indices.length;t+=3){for(let k=0;k<3;k++){const a=mesh.indices[t+k]!,b=mesh.indices[t+(k+1)%3]!;neighbours[a]!.add(b);neighbours[b]!.add(a);incident[a]!.push(t);const key=a<b?`${a},${b}`:`${b},${a}`;const e=edges.get(key)??{a:Math.min(a,b),b:Math.max(a,b),faces:[]};e.faces.push(t);edges.set(key,e);}}
 const protectedVertex=new Set<number>();for(const e of edges.values())if(e.faces.length!==2){protectedVertex.add(e.a);protectedVertex.add(e.b);}
 const parent=Int32Array.from({length:n},(_,i)=>i),used=new Set<number>(),p=mesh.positions.slice(),normal=mesh.normals.slice(),cos=Math.cos(angle*Math.PI/180);let maxDisplacement=0;
 const vector=(array:Float32Array,i:number)=>Array.from(array.subarray(i*3,i*3+3));
 const cross=(a:number[],b:number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];
 const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i]!,0);
 for(const {a,b,faces} of edges.values()){
  if(faces.length!==2||used.has(a)||used.has(b)||protectedVertex.has(a)||protectedVertex.has(b))continue;
  if([...neighbours[a]!].filter(v=>neighbours[b]!.has(v)).length!==2)continue;
  const pa=vector(p,a),pb=vector(p,b),na=vector(normal,a),nb=vector(normal,b),distance=Math.hypot(...pa.map((v,k)=>v-pb[k]!));
  if(distance*.5>tolerance||dot(na,nb)<cos)continue;
  const midpoint=pa.map((v,k)=>(v+pb[k]!)*.5);
  const local=[...new Set([...incident[a]!,...incident[b]!])];let safe=true;
  for(const t of local){if(faces.includes(t))continue;const ids=Array.from(mesh.indices.subarray(t,t+3)),old=ids.map(i=>vector(p,i)),next=ids.map((i,k)=>i===a||i===b?midpoint:old[k]!);
   const normalOf=(v:number[][])=>cross(v[1]!.map((x,k)=>x-v[0]![k]!),v[2]!.map((x,k)=>x-v[0]![k]!));const oldN=normalOf(old),newN=normalOf(next);
   if(dot(oldN,newN)<=cos*Math.hypot(...oldN)*Math.hypot(...newN)||Math.hypot(...newN)<1e-14){safe=false;break;}}
  if(!safe)continue;parent[b]=a;p.set(midpoint,a*3);const sum=na.map((v,k)=>v+nb[k]!),length=Math.hypot(...sum);normal.set(sum.map(v=>v/length),a*3);
  // Protect the entire neighbourhood: simultaneous independent collapses cannot alter a shared face/link.
  used.add(a);used.add(b);for(const v of [...neighbours[a]!,...neighbours[b]!])used.add(v);maxDisplacement=Math.max(maxDisplacement,distance*.5);
 }
 const ids:number[]=[],remap=new Map<number,number>(),outP:number[]=[],outN:number[]=[];
 for(let t=0;t<mesh.indices.length;t+=3){const triangle=Array.from(mesh.indices.subarray(t,t+3),i=>parent[i]!);if(new Set(triangle).size!==3)continue;for(const id of triangle){let index=remap.get(id);if(index===undefined){index=remap.size;remap.set(id,index);outP.push(...vector(p,id));outN.push(...vector(normal,id));}ids.push(index);}}
 return {mesh:{positions:Float32Array.from(outP),normals:Float32Array.from(outN),indices:Uint32Array.from(ids)},maxDisplacement};
}
