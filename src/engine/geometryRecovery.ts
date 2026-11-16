import {mb3dParityShader,validateMb3dParity} from './mb3dParityLab';
import type {Mb3dParityLab} from './mb3dParityLab';
/** GEO2 laboratory only. Immutable engine option, never a serialized scene/UI setting. */
export interface GeometryRecoveryExperiment {
  /** GEO3 explicit lab lanes; never serialized into artist scenes. */
  ds?: boolean;
  /** GEO4 opt-in; absent preserves the earlier solver policies. */
  marchRule?:'legacy'|'margin'|'adaptive';
  nativeMb3d?:Mb3dParityLab;
  dsProduct?: 'fma'|'split';
  solver?: 'segment'|'rewind'|'prefix'|'band'|'direct';
  /** Controlled regression injection; never an artist scene setting. */
  testCoarseMiss?: boolean;
  normalMode?: 'original'|'micro';
  hardEdges?: boolean;
  preciseColor?: boolean;
  stepPixels?: number;
  /** True constant world-space DE goal, unlike legacy h*(1+t). */
  detailWorld?: number;
  /** Measured warning estimate from this experiment, never a certified bound. */
  fieldErrorEstimate?: number;
  retainBest?: boolean;
  sourceParameters?: boolean;
  stable?: boolean;
  limitSteps?: boolean;
  recover?: boolean;
  adaptive?: boolean;
  /** Positive requested effort, independent of the finite per-ray work budget. */
  effort: number;
  maxQueries: number;
  /** Local experimental guard only, not the production tolerance floor. */
  ulpFactor?: 1|4;
}
export function validateGeometryExperiment(x:GeometryRecoveryExperiment):void {
  const keys=['stable','limitSteps','recover','adaptive','effort','maxQueries','ulpFactor','ds','dsProduct','solver','normalMode','hardEdges','preciseColor','stepPixels','detailWorld','fieldErrorEstimate','retainBest','sourceParameters','testCoarseMiss','nativeMb3d','marchRule'];
  for(const key of Object.keys(x))if(!keys.includes(key))throw Error('Unknown geometry experiment key '+key);
  for(const key of ['stable','limitSteps','recover','adaptive','ds','hardEdges','preciseColor','retainBest','sourceParameters','testCoarseMiss'] as const)if(x[key]!==undefined&&typeof x[key]!=='boolean')throw Error('Boolean geometry flag required: '+key);
  if(!Number.isFinite(x.effort)||x.effort<=0)throw Error('Geometry effort must be finite and positive');
  if(!Number.isInteger(x.maxQueries)||x.maxQueries<1||x.maxQueries>(x.marchRule?20000:4096))throw Error('Invalid experimental per-ray query budget');
  if(x.marchRule!==undefined&&(!['legacy','margin','adaptive'].includes(x.marchRule)||x.solver!=='direct'||x.nativeMb3d))throw Error('March rule needs the isolated DS direct solver');
  if(x.ulpFactor!==undefined&&x.ulpFactor!==1&&x.ulpFactor!==4)throw Error('Unmeasured experimental arithmetic guard');
  if(x.stepPixels!==undefined&&(!Number.isFinite(x.stepPixels)||x.stepPixels<=0))throw Error('Positive step cap required');
  if(x.preciseColor&&!x.ds)throw Error('Precise coloring requires DS evaluation');
  if(x.dsProduct!==undefined&&(!x.ds||!['fma','split'].includes(x.dsProduct)))throw Error('Unsupported DS product');
  if(x.sourceParameters&&!x.ds)throw Error('Saved parameter precision requires DS');
  if(x.nativeMb3d){validateMb3dParity(x.nativeMb3d);if(!x.ds||!x.sourceParameters||x.dsProduct!=='split'||x.solver!=='direct')throw Error('Native parity requires source DS direct laboratory');}
  if(x.solver!==undefined&&!['segment','rewind','prefix','band','direct'].includes(x.solver))throw Error('Unsupported experimental solver');
  if(x.solver==='direct'&&!x.ds)throw Error('Direct primary laboratory requires a validated DS family');
  if(x.testCoarseMiss&&x.solver!=='direct')throw Error('Coarse miss injection requires direct primary');
  if(x.normalMode!==undefined&&!['original','micro'].includes(x.normalMode))throw Error('Unsupported experimental normal');
  for(const v of [x.detailWorld,x.fieldErrorEstimate])if(v!==undefined&&(!Number.isFinite(v)||v<=0))throw Error('Positive finite detail/error value required');
}

/** Piecewise evaluation of |t+f|-|t-f|-t, avoiding cancellation outside the fold. */
export function stableBox(t:number,f:number):number {
  return t>Math.abs(f)?2*f-t:t< -Math.abs(f)?-2*f-t:f>=0?t:-3*t;
}
const stableHelpers=`
fn geoBox(t:f32,f:f32)->f32{if(t>abs(f)){return 2.0*f-t;}if(t< -abs(f)){return -2.0*f-t;}return select(-3.0*t,t,f>=0.0);}
fn geoBox3(v:vec3f,f:f32)->vec3f{return vec3f(geoBox(v.x,f),geoBox(v.y,f),geoBox(v.z,f));}
`;

/** Share state/math/map bindings; duplicate only the full finite primary evaluator.
 * Coarse normals, lighting, secondary rays and saved formula definitions remain untouched.
 */
export function geometryField(original:string,full:string,x:GeometryRecoveryExperiment,dsCode?:string):string {
  validateGeometryExperiment(x);
  const start=full.indexOf('fn formulaCoreAtThreshold('),end=full.indexOf('fn formulaCore(pos',start);
  if(start<0||end<0)throw Error('GEO2 requires a mapped finite field');
  let core=full.slice(start,end).replaceAll('formulaCoreAtThreshold','geoFullCore');
  if(x.stable)core=core.replaceAll('essentialBox3(', 'geoBox3(').replaceAll('essentialBox(', 'geoBox(').replaceAll('kernelRotatedBox(', 'geoRotatedBox(');
  const rotated=full.match(/fn kernelRotatedBox\([^}]+\}/)?.[0]??'';
  if(x.stable&&core.includes('geoRotatedBox(')&&!rotated)throw Error('Missing shared rotated fold helper');
  if(x.ds&&!dsCode)throw Error('GEO3 DS field definition required');
  return original+'\n'+(x.stable?stableHelpers+rotated.replaceAll('kernelRotatedBox','geoRotatedBox').replaceAll('essentialBox(', 'geoBox('):'')+core+(x.ds?dsCode:'');
}

/** Surgical primary-ray experiment. No change when absent; not a replacement renderer.
 * DE-goal samples are predicates, never presumed signed root brackets. A successful
 * continuation is still conditional evidence of a first surface, not a proof of it.
 */
export function geometryShader(shader:string,x:GeometryRecoveryExperiment):string {
  validateGeometryExperiment(x);
  if(x.nativeMb3d){const {nativeMb3d,...rest}=x;return mb3dParityShader(geometryShader(shader,rest),nativeMb3d,x.maxQueries);}
  if(x.solver||x.ds||x.normalMode||x.hardEdges||x.stepPixels)return aggressiveShader(shader,x);
  const replace=(a:string,b:string)=>{if(shader.split(a).length!==2)throw Error('GEO2 shader anchor changed: '+a);shader=shader.replace(a,b);};
  const f=(v:number)=>v.toExponential(12);
  // Requested effort stays a JS double. Representability saturation is explicit in
  // the plan and effective tolerance, rather than an invalid WGSL numeric literal.
  const inverseEffort=Math.min(3.402823e38,Math.fround(1/x.effort));
  replace('  let interval = clipInterval(origin, dir, u.march.w);',`  geoInfo=vec4f(0.0);geoMore=vec4f(0.0);
  var geoPrevT=0.0;var geoPrevD=0.0;var geoLastD=0.0;
  let interval = clipInterval(origin, dir, u.march.w);`);
  if(x.stable)replace('let d = formulaCoreAtThreshold(q, primaryHitThreshold(t, q)).x;', 'let d = geoFullCore(q,0.0).x;');
  replace('    let threshold = primaryHitThreshold(t, q);','    let threshold = primaryHitThreshold(t, q);geoLastD=surfaceDistance;');
  replace('    t += surfaceDistance * u.march.y;',`    geoPrevT=t;geoPrevD=surfaceDistance;
    var geoStep=surfaceDistance*u.march.y;
    ${x.limitSteps?'let footprint=geoPixel(t);if(surfaceDistance<max(32.0*footprint,8.0*threshold)){geoStep=min(geoStep,max(2.0*footprint,0.5*threshold));}':''}
    t += geoStep;`);
  const recovering=x.recover||x.adaptive;
  replace('  let exhausted = !hit && t <= interval.y;',`${recovering?`
  if(hit && !escapeUnsignedInterior){
    let coarseT=t;let coarseP=origin+dir*t;let requested=min(3.402823e38,0.5*geoPixel(t)*${f(inverseEffort)});
    // Heuristic representability guard, not a certified formula error bound.
    let arithmetic=geoRepresentability(coarseP);let goal=max(requested,arithmetic);
    geoInfo=vec4f(0.0,requested,goal,coarseT);geoMore=vec4f(geoLastD,0.0,arithmetic,0.0);
    var budget=${x.maxQueries}u;
    ${x.adaptive?`let slope=abs(geoPrevD-geoLastD)/max(1e-30,abs(coarseT-geoPrevT));
    if(slope>0.25){budget=min(budget,48u);} // easy transversals, bounded grazing fallback
    `:''}
    // Start at the preceding real segment endpoint, not an invented signed bracket.
    var rt=max(interval.x,geoPrevT);var status=2.0;var residual=geoLastD;
    for(var j=0u;j<budget;j++){
      let rp=origin+dir*rt;let rd=geoFullCore(rp,0.0).x;residual=select(rd,abs(rd),clipped);
      geoMore.y=f32(j+1u);
      if(!(abs(rd)<1e18)){status=4.0;break;}
      if(residual<=goal){t=rt;status=1.0;break;}
      let step=min(residual*u.march.y,max(8.0*goal,2.0*geoPixel(rt)));
      let next=rt+step;
      if(next<=rt || all(origin+dir*next==rp)){status=3.0;break;}
      if(next>interval.y){status=5.0;break;}
      rt=next;
    }
    // Unresolved rays keep their genuine original coarse hit, explicitly classified.
    geoInfo.x=status;geoMore.x=residual;geoMore.w=f32(budget);
  }
  `:''}
  let exhausted = !hit && t <= interval.y;`);
  return `var<private> geoInfo:vec4f;var<private> geoMore:vec4f;
fn geoPixel(t:f32)->f32{return select(t*u.normalFilm.y,u.normalFilm.z,u.cameraEffects.x>0.0);}
fn geoRepresentability(p:vec3f)->f32{let m=max(max(abs(p.x),abs(p.y)),abs(p.z));let next=bitcast<f32>(bitcast<u32>(m)+1u);return max(1e-12,${f(x.ulpFactor??4)}*(next-m));}
`+shader;
}

/** Competing GEO3 candidates. A threshold crossing is never called a zero root.
 * Rewind/prefix replay may recover an earlier sampled component; no proof for
 * arbitrarily thin unsigned structures. Failed rays keep coarse hits + status.
 */
function aggressiveShader(shader:string,x:GeometryRecoveryExperiment):string {
 let s=geometryShader(shader,{effort:x.effort,maxQueries:Math.min(4096,x.maxQueries),ulpFactor:x.ulpFactor,stable:x.stable,limitSteps:x.limitSteps});
 const one=(a:string,b:string)=>{if(s.split(a).length!==2)throw Error('GEO3 anchor '+a);s=s.replace(a,b);};
 const direct=x.solver==='direct';
 if(x.stepPixels&&!direct)one('    t += geoStep;',`    if(surfaceDistance<64.0*primaryHitThreshold(t,q)){geoStep=min(geoStep,${x.stepPixels.toExponential(12)}*geoPixel(t));}t += geoStep;`);
 const inverse=Math.min(3.402823e38,Math.fround(1/x.effort)).toExponential(12);
 const requestAt=(t:string)=>x.detailWorld!==undefined?Math.min(3.402823e38,Math.fround(x.detailWorld)).toExponential(12):'0.5*geoPixel('+t+')*'+inverse;
 const arithmeticAt=(p:string)=>x.ds?'max(1e-12,1e-12*length('+p+'))':'geoRepresentability('+p+')';
 if(direct){
  one('  let interval = clipInterval(origin, dir, u.march.w);','  let interval = clipInterval(origin, dir, u.march.w);var geoClosestT=interval.x;var geoClosestD=1e20;');
  one('geoLastD=surfaceDistance;','geoLastD=surfaceDistance;if(surfaceDistance<geoClosestD){geoClosestD=surfaceDistance;geoClosestT=t;}');
 }
 if(x.solver||x.ds){
  const start=x.solver==='prefix'||direct?'interval.x':x.solver==='rewind'?'max(interval.x,coarseT-64.0*primaryHitThreshold(coarseT,coarseP))':'max(interval.x,geoPrevT)';
  const evalDS=x.ds?'let dsSample=geoDS(dsPoint(origin,dir,rt));let rd=dsSample.d.x+dsSample.d.y;':'let rd=geoFullCore(origin+dir*rt,0.0).x;';
  const rt=x.ds?'vec2f('+start+',0.0)':start;
  const tf=x.ds?'(rt.x+rt.y)':'rt';
  const update=x.ds?'let next=dsA(rt,vec2f(step,0.0));if(all(next==rt)){status=3.0;break;}':'let next=rt+step;if(next<=rt||all(origin+dir*next==origin+dir*rt)){status=3.0;break;}';
  one('  let exhausted = !hit && t <= interval.y;',`
  geoDSReady=false;
  ${x.testCoarseMiss?'hit=false; // Deliberately injected coarse miss, same field and ray.':''}
  if(${direct?'interval.x<=interval.y':'hit'}&&!escapeUnsignedInterior){
   let coarseT=${direct?'clamp(t,interval.x,interval.y)':'t'};let coarseP=origin+dir*coarseT;var requested=${requestAt('coarseT')};
   var arithmetic=${arithmeticAt('coarseP')};
   var goal=max(requested,arithmetic);geoInfo=vec4f(0.0,requested,goal,coarseT);geoMore=vec4f(0.0,0.0,arithmetic,${x.maxQueries}.0);
   var rt=${rt};var status=2.0;var residual=1e20;var previous=rt;var previousResidual=1e20;
   ${x.retainBest?'var bestRT=rt;var bestResidual=1e20;':''}
   for(var j=0u;j<${x.maxQueries}u;j++){
    ${direct?`requested=${requestAt(tf)};arithmetic=${arithmeticAt('origin+dir*'+tf)};goal=max(requested,arithmetic);geoInfo.y=requested;geoInfo.z=goal;geoMore.z=arithmetic;`:''}
    ${evalDS}residual=select(rd,abs(rd),clipped);geoMore.y=f32(j+1u);
    if(!(abs(rd)<1e18)){status=4.0;break;}
    ${x.retainBest?'if(residual<bestResidual){bestResidual=residual;bestRT=rt;}':''}
    if(residual<=goal){
     ${x.solver==='band'||direct?`// MB-style threshold-band search, observed inside/outside predicate only.
     var lo=previous;var hi=rt;
     for(var k=0u;k<24u;k++){
      let mid=${x.ds?'dsM(dsA(lo,hi),vec2f(0.5,0.0))':'(lo+hi)*0.5'};
      ${x.ds?'let mdPair=geoDS(dsPoint(origin,dir,mid)).d;let md=mdPair.x+mdPair.y;':'let md=geoFullCore(origin+dir*mid,0.0).x;'}
      let bandGoal=${direct?'max('+requestAt('(mid.x+mid.y)')+','+arithmeticAt('origin+dir*(mid.x+mid.y)')+')':'goal'};
      if(select(md,abs(md),clipped)<=bandGoal){hi=mid;}else{lo=mid;}
     }rt=hi;`:''}
     t=${tf};hit=true;status=1.0;${x.ds?'geoDSPosition=dsPoint(origin,dir,rt);geoDSCore=geoDS(geoDSPosition).core;geoDSReady=true;geoDSDepth=rt;':''}
     ${x.solver==='band'||direct?`let finalDE=${x.ds?'geoDSCore.x':'geoFullCore(origin+dir*t,0.0).x'};residual=select(finalDE,abs(finalDE),clipped);`:''}
     ${direct?`requested=${requestAt('t')};arithmetic=${arithmeticAt('origin+dir*t')};goal=max(requested,arithmetic);geoInfo.y=requested;geoInfo.z=goal;geoMore.z=arithmetic;`:''}break;
    }
    ${x.marchRule==='adaptive'?`let g4Slope=abs(previousResidual-residual)/max(1e-30,abs(${tf}-${x.ds?'(previous.x+previous.y)':'previous'}));`:''}
    previous=rt;previousResidual=residual;
    // Subtract half the target threshold, separate DE scale and camera cap.
    var step=${x.marchRule==='legacy'?'residual': 'max(residual-0.5*goal,0.125*goal)'}*u.march.y;
    ${x.marchRule==='adaptive'?`// Experimental, not a Lipschitz certificate. Retain the requested fine
    // multiplier near the target; only far, slowly varying segments accelerate.
    if(residual>64.0*goal&&g4Slope<0.25){step=max(residual-0.5*goal,0.125*goal)*max(u.march.y,0.15);}`:''}
    ${x.solver==='prefix'?'if(residual<32.0*geoPixel('+tf+')){':''}
    step=min(step,max(8.0*goal,${Math.min(3.402823e38,x.stepPixels??(direct?16:2)).toExponential(12)}*geoPixel(${direct?'geoClosestT':tf})));
    ${x.solver==='prefix'?'}':''}
    ${update}if(${x.ds?'next.x+next.y':'next'}>interval.y){status=5.0;break;}rt=next;
   }
   ${direct?'if(status==5.0){hit=false;t=interval.y+1.0;}':''}
   ${x.retainBest?`if(status!=1.0${direct?'&&status!=5.0':''}&&bestResidual<geoLastD){t=${x.ds?'bestRT.x+bestRT.y':'bestRT'};residual=bestResidual;${x.ds?'geoDSPosition=dsPoint(origin,dir,bestRT);geoDSCore=geoDS(geoDSPosition).core;geoDSReady=true;geoDSDepth=bestRT;':''}} // Partial point retained; failure classification remains.`:''}
   if(status==1.0&&requested<arithmetic){status=6.0;}
   ${x.fieldErrorEstimate?`if(status==1.0&&requested<${x.fieldErrorEstimate.toExponential(12)}){status=6.0;} // Observed precision warning, keep computed point; no false certificate.`:''}
   geoInfo.x=status;geoMore.x=residual;
  }
  let exhausted = !hit && t <= interval.y;`);
 }
 if(x.normalMode==='micro'){
  one('  let outward = sceneNormal(p, primaryNormalStep(t, p));',`  let outward=geoMicroNormal(p,t);`);
 }
 if(x.hardEdges){
  // COMPAT-02 WP2: with PBR/surface code integrated, the line is `var n = softenedNormal(...)` followed by the surface shading
  // normal. The hard-edge meaning is the same: the primary normal is the unsoftened raw normal. Plain shaders keep the old anchor.
  const plain='  let n = softenedNormal(p, rawNormal, primaryNormalStep(t, p));',integrated='  var n = softenedNormal(p, rawNormal, primaryNormalStep(t, p));';
  if(!s.includes(plain)&&s.split(integrated).length===2)one(integrated,'  var n = rawNormal;');else one(plain,'  let n = rawNormal;');
 }
 if(x.preciseColor)one('  let core = formulaCore(p);','  let core = select(formulaCore(p),geoDSCore,geoDSReady);');
 const helpers=x.ds?`var<private> geoDSPosition:DSP;var<private> geoDSDepth:vec2f;var<private> geoDSCore:vec3f;
 fn geoDSOffset(axis:u32,h:f32)->f32{var q=geoDSPosition;if(axis==0u){q.x=dsA(q.x,vec2f(h,0.0));}else if(axis==1u){q.y=dsA(q.y,vec2f(h,0.0));}else{q.z=dsA(q.z,vec2f(h,0.0));}let r=geoDS(q);return r.d.x+r.d.y;}
 `:'';
 const micro=x.normalMode==='micro'?`
 fn geoMicroNormal(p:vec3f,t:f32)->vec3f{
 let h=max(${x.ds?'1e-11':'geoRepresentability(p)'},0.25*geoPixel(t));var g=vec3f(0.0);
 ${x.ds?'if(geoDSReady){for(var i=0u;i<3u;i++){g[i]=geoDSOffset(i,h)-geoDSOffset(i,-h);}}else':''}
 {for(var i=0u;i<3u;i++){var e=vec3f(0.0);e[i]=h;g[i]=geoFullCore(p+e,0.0).x-geoFullCore(p-e,0.0).x;}}
 if(!(dot(g,g)>0.0)){return sceneNormal(p,primaryNormalStep(t,p));}return normalize(g);}
 `:'';
 return 'var<private> geoDSReady:bool;\n'+helpers+s+micro;
}
