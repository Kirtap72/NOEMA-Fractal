import type {Scene} from './scene';
import type {ColorSettings} from './gradient';

export const validAnimationId=(id:unknown):id is string=>typeof id==='string'&&/^[-\w]{1,64}$/.test(id);

/** Legacy files get reproducible identities once; editing adds fresh identities, never recycled indices. */
export function withAnimationIdentities(scene:Scene,makeId?:(kind:string)=>string):Scene {
 const used=new Set(scene.content.flatMap(c=>[c.id,...c.chain.map(s=>s.id)]).filter((s):s is string=>!!s));
 const allocate=(kind:string,path:string)=>{const basePath=path.slice(0,48);let id=makeId?makeId(kind):basePath,n=1;while(used.has(id))id=makeId?makeId(kind):basePath+'-'+n++;used.add(id);return id;};
 const lightUsed=new Set(scene.lights.flatMap(l=>l.id?[l.id]:[])),stopUsed=new Set(scene.color.gradient.stops.flatMap(s=>s.id?[s.id]:[]));
 for(const id of [...lightUsed,...stopUsed])used.add(id);
 // Missing/replaced objects must not reuse a still-bound identity at serialization time.
 for(const t of scene.cameraFlight?.tracks.slice(1)??[])if(t.target.kind==='light')used.add(t.target.objectId);else if(t.target.kind==='gradient-stop')used.add(t.target.stopId);
 let changed=false;
 const content=scene.content.map((c,i)=>{
  const id=c.id??allocate('content','content-'+(i+1));if(!c.id)changed=true;
  const chain=c.chain.map((s,j)=>{if(s.id)return s;changed=true;return {...s,id:allocate('step',id+'-step-'+(j+1))};});
  return c.id&&chain.every((s,j)=>s===c.chain[j])?c:{...c,id,chain};
 });
 const lights=scene.lights.map((l,i)=>{if(l.id)return l;changed=true;return {...l,id:allocate('light','light-'+(i+1))};});
 const stops=scene.color.gradient.stops.map((s,i)=>{if(s.id)return s;changed=true;return {...s,id:allocate('stop','stop-'+(i+1))};});
 return changed?{...scene,content,lights,color:{...scene.color,gradient:{...scene.color.gradient,stops}}}:scene;
}

/** A material/gradient resource is a replacement, not an identity-bearing scene reopen. */
export function replacementGradientColor(scene:Scene,color:ColorSettings):ColorSettings {
 const used=new Set([...scene.color.gradient.stops,...color.gradient.stops].flatMap(s=>s.id?[s.id]:[]));
 for(const t of scene.cameraFlight?.tracks.slice(1)??[])if(t.target.kind==='gradient-stop')used.add(t.target.stopId);
 let next=1;
 return {...color,gradient:{...color.gradient,stops:color.gradient.stops.map(stop=>{let id:string;do{id='stop-replacement-'+next++;}while(used.has(id));used.add(id);return {...stop,id};})}};
}
