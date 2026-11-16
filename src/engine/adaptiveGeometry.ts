/** GEO5 candidate. Settings are opt-in; legacy rendering never allocates this state. */
export interface GeometryDetailSettings {
  enabled:boolean;
  detailLevel:number;
  stepMultiplier:number;
  budget:'automatic'|'manual';
  maxSteps:number;
}
export const DEFAULT_GEOMETRY_DETAIL:GeometryDetailSettings={enabled:false,detailLevel:8,stepMultiplier:0.1,budget:'automatic',maxSteps:65536};
export const GEOMETRY_STATE_BYTES=64;
export const GEOMETRY_PASS_STEPS=640;
export function readGeometryDetail(raw:unknown):GeometryDetailSettings {
  if(!raw||typeof raw!=='object')throw Error('Geometry Detail settings required');
  const r=raw as GeometryDetailSettings;
  if(Object.keys(r).some(k=>!['enabled','detailLevel','stepMultiplier','budget','maxSteps'].includes(k)))throw Error('Unknown Geometry Detail setting');
  if(typeof r.enabled!=='boolean'||!['automatic','manual'].includes(r.budget))throw Error('Invalid Geometry Detail mode');
  if(!Number.isFinite(r.detailLevel)||r.detailLevel<=0||!Number.isFinite(r.stepMultiplier)||r.stepMultiplier<=0||!Number.isFinite(Math.fround(r.stepMultiplier))||Math.fround(r.stepMultiplier)===0)throw Error('Finite positive detail/representable step required');
  if(!Number.isInteger(r.maxSteps)||r.maxSteps<1||r.maxSteps>1048576)throw Error('Technical ray budget must be 1–1048576');
  return {...r};
}
export interface GeometryDiagnostics {
  tile?:{x:number;y:number;width:number;height:number}; sampleIndex?:number;
  pixels:number; passes:number; queries:number; pending:number; hits:number;
  precisionLimited:number; invalid:number; clipUnresolved:number; maxDistance:number; stagnated:number;
  stateBytes:number; requestedMin:number; effectiveMin:number;
  /** Existing f32 camera transport + direction error are not certified by the DS field. */
  cameraPrecision:'float32-input'|'native-split';
}
export function geometryDiagnostics(state:Float32Array,passes:number):GeometryDiagnostics {
  if(state.length%16)throw Error('Invalid continuation state');
  const d:GeometryDiagnostics={pixels:state.length/16,passes,queries:0,pending:0,hits:0,precisionLimited:0,invalid:0,clipUnresolved:0,maxDistance:0,stagnated:0,stateBytes:state.byteLength,requestedMin:Infinity,effectiveMin:Infinity,cameraPrecision:'float32-input'};
  for(let i=0;i<state.length;i+=16){
    const status=state[i+4]; d.queries+=state[i+5]!;
    if(status===1||status===6)d.hits++;
    if(status===6)d.precisionLimited++;
    if(status===0||status===2)d.pending++;
    if(status===3)d.stagnated++;
    if(status===4)d.invalid++;
    if(status===5)d.maxDistance++;
    if(status===7)d.clipUnresolved++;
    if(state[i+9]!>=0)d.requestedMin=Math.min(d.requestedMin,state[i+9]!);
    if(state[i+7]!>0)d.effectiveMin=Math.min(d.effectiveMin,state[i+7]!);
  }
  return d;
}
/** Retains the exact GEO4 step arithmetic, finite field and band refinement.
 * Only the unfinished ray's loop state moves across pass boundaries. Completed
 * fragments discard before field evaluation; attachments use load, not clear.
 * No coarse-feature classifier or unverified far-field acceleration is used.
 */
export function adaptiveGeometryShader(input:string):string {
  let s=input;
  const one=(a:string,b:string)=>{if(s.split(a).length!==2)throw Error('GEO5 continuation anchor: '+a);s=s.replace(a,b);};
  one('  let res = u.view.xy;',`  let gi=u32(frag.y)*geoControl.x+u32(frag.x);
  let saved=geoRays[gi];
  if(saved.metrics.x!=0.0&&saved.metrics.x!=2.0){discard;return FragOut();}
  let res = u.view.xy;`);
  one('  let maxSteps = i32(u.march.z);','  let maxSteps = select(0,i32(u.march.z),geoControl.z==0u);');
  one('  geoDSReady=false;',`  if(geoControl.z>0u){geoClosestT=saved.cap.x;t=saved.coarse.x;hit=saved.coarse.y>0.5;}
  geoDSReady=false;`);
  one('var previousResidual=1e20;','var previousResidual=1e20;\n   if(geoControl.z>0u){rt=saved.path.xy;previous=saved.path.zw;}');
  // The direct solver's immutable lab cap becomes a bounded per-dispatch slice.
  const loop=/for\(var j=0u;j<\d+u;j\+\+\)\{/;
  if(!loop.test(s))throw Error('GEO5 direct loop missing');
  s=s.replace(loop,'for(var j=0u;j<geoControl.y;j++){');
  one('   geoInfo.x=status;geoMore.x=residual;',`   geoInfo.x=status;geoMore.x=residual;
   geoRays[gi].path=vec4f(rt,previous);
   geoRays[gi].metrics=vec4f(status,saved.metrics.y+geoMore.y,arithmetic,goal);
   geoRays[gi].cap=vec4f(geoClosestT,requested,residual,0.0);
   geoRays[gi].coarse=select(saved.coarse,vec4f(coarseT,select(0.0,1.0,hit),0.0,0.0),geoControl.z==0u);`);
  one('  let exhausted = !hit && t <= interval.y;',`  if(escapeUnsignedInterior){geoRays[gi].metrics.x=7.0;}
  if(interval.x>interval.y){geoRays[gi].metrics.x=5.0;}
  // Budget/precision failures are conspicuous, never silently sky pixels.
  if(geoRays[gi].metrics.x==2.0||geoRays[gi].metrics.x==3.0||geoRays[gi].metrics.x==4.0||geoRays[gi].metrics.x==7.0){
    out.color=vec4f(1.0,0.0,1.0,1.0);out.data=vec4f(-1.0,0.0,0.0,0.0);return out;
  }
  let exhausted = !hit && t <= interval.y;`);
  return `struct GeoRay{path:vec4f,metrics:vec4f,cap:vec4f,coarse:vec4f}
@group(0) @binding(18) var<storage,read_write> geoRays:array<GeoRay>;
@group(0) @binding(19) var<uniform> geoControl:vec4u;
`+s;
}

/** GEO8 resumes the existing native solver, with the same arithmetic and query
 * order. Shares GEO5's 64-byte state, host budget, load/discard and cancel gate.
 * No neighboring-ray classification, coarse guess or alternate field. */
export function adaptiveNativeGeometryShader(input:string):string {
 let s=input;
 const one=(a:string,b:string)=>{if(s.split(a).length!==2)throw Error('Native continuation anchor '+a);s=s.replace(a,b);};
 one('  let res = u.view.xy;',`  let gi=u32(frag.y)*geoControl.x+u32(frag.x);let saved=geoRays[gi];
 if(saved.metrics.x!=0.0&&saved.metrics.x!=2.0){discard;}
 let res = u.view.xy;`);
 one('  geoDSReady=false;geoInfo=vec4f(0.0);geoMore=vec4f(0.0);',`  var baseQuery=0u;
 if(geoControl.z>0u){nt=saved.path.xy;lastDE=saved.path.z;lastStep=saved.path.w;multiplier=saved.cap.x;first=false;baseQuery=u32(saved.metrics.y);}
 geoDSReady=false;geoInfo=vec4f(0.0);geoMore=vec4f(0.0);`);
 s=s.replace(/for\(var query=0u;query<\d+u;query\+\+\)\{/,'for(var localQuery=0u;localQuery<geoControl.y;localQuery++){let query=baseQuery+localQuery;');
 one('let exhausted=!hit&&status==2.0;',`let exhausted=!hit&&status==2.0;
 geoRays[gi].path=vec4f(nt,lastDE,lastStep);
 geoRays[gi].metrics=vec4f(status,geoMore.y,0.0,goal);
 geoRays[gi].cap=vec4f(multiplier,goal,de,0.0);
 if(status==2.0||status==3.0||status==4.0){out.color=vec4f(1.0,0.0,1.0,1.0);out.data=vec4f(geoDSDepth,status,geoMore.y);return out;}`);
 return `struct GeoRay{path:vec4f,metrics:vec4f,cap:vec4f,coarse:vec4f}
 @group(0) @binding(18) var<storage,read_write> geoRays:array<GeoRay>;
 @group(0) @binding(19) var<uniform> geoControl:vec4u;
 `+s;
}
