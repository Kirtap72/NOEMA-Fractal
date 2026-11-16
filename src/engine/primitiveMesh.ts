import type {Mesh} from './mesh';
import type {ScenePrimitive} from './primitives';
import {primitiveInverse} from './primitives';
/** Tessellated analytical geometry, world-space Y-up. Plane is explicitly bounded to local ±planeHalfSize. */
export function primitiveMesh(p:ScenePrimitive,segments=32,planeHalfSize=10):Mesh{
 if(!Number.isInteger(segments)||segments<8||segments>256||!Number.isFinite(planeHalfSize)||planeHalfSize<=0)throw Error('Invalid primitive tessellation');
 const positions:number[]=[],normals:number[]=[],indices:number[]=[];
 const vertex=(v:number[],n:number[])=>{const id=positions.length/3;positions.push(...v);normals.push(...n);return id;};
 if(p.type==='sphere'){
  const rings=Math.floor(segments/2),top=vertex([0,1,0],[0,1,0]);
  for(let j=1;j<rings;j++)for(let i=0;i<segments;i++){const t=j*Math.PI/rings,a=i*2*Math.PI/segments,v=[Math.sin(t)*Math.cos(a),Math.cos(t),Math.sin(t)*Math.sin(a)];vertex(v,v);}
  const bottom=vertex([0,-1,0],[0,-1,0]);
  for(let i=0;i<segments;i++){const next=(i+1)%segments;indices.push(top,1+next,1+i);for(let j=0;j<rings-2;j++){const a=1+j*segments+i,b=1+j*segments+next,c=a+segments,d=b+segments;indices.push(a,b,c,b,d,c);}const a=1+(rings-2)*segments;indices.push(bottom,a+i,a+next);}
 }else if(p.type==='plane'){
  for(const v of [[-1,0,-1],[-1,0,1],[1,0,1],[1,0,-1]])vertex(v.map(x=>x*planeHalfSize),[0,1,0]);indices.push(0,1,2,0,2,3);
 }else {
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const u=(axis+1)%3,v=(axis+2)%3,offset=positions.length/3;for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const point=[0,0,0],normal=[0,0,0];point[axis]=sign;point[u]=a!;point[v]=b!;normal[axis]=sign;vertex(point,normal);}if(sign>0)indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);else indices.push(offset,offset+2,offset+1,offset,offset+3,offset+2);}
 }
 const inverse=primitiveInverse(p),axes=inverse.map((row,k)=>row.slice(0,3).map(v=>v*p.scale[k]!));
 for(let i=0;i<positions.length;i+=3){const local=positions.slice(i,i+3),n=normals.slice(i,i+3);const transformed=[0,1,2].map(k=>inverse.reduce((s,row,j)=>s+row[k]!*n[j]!,0)),length=Math.hypot(...transformed);
  for(let k=0;k<3;k++){positions[i+k]=p.position[k]!+axes.reduce((s,a,j)=>s+a[k]!*p.scale[j]!*local[j]!,0);normals[i+k]=transformed[k]!/length;}}
 return {positions:Float32Array.from(positions),normals:Float32Array.from(normals),indices:Uint32Array.from(indices),colors:Float32Array.from({length:positions.length},(_,i)=>p.color[i%3]!)};
}
