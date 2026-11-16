/** Reference replay only. Own equations derived from pinned MB3D host semantics;
 * not a scene setting, a general camera model or an original CalcDE binary. */
import type {NeutralMb3dPreset} from '../importers/mb3d/types';
import {nativeFiveShader} from './mb3dNormalLab';
export interface Mb3dParityLab {
 /** Isolated GEO8 request; absent retains GEO3C/GEO7 bytes. */
 goalScale?:number;
 mode:'camera'|'replay';width:number;height:number;axes:number[][];nearCenter:number[];
 radiansPerPixel:number;stepWidth:number;maxDistance:number;bailoutRadius:number;
 deStop:number;adaptFactor:number;raystep:number;limiter:number;binarySteps:number;
 firstStepFraction:number;deScale:number;
 /** GEO3C opt-in: native FOVXmul is Single; vertical FOV remains Double.
  * Undefined preserves the earlier GEO3 candidate byte for byte. */
 horizontalRadiansPerPixel?:number;
 /** Separate post-hit appearance experiment; never changes the primary solver. */
 normalReconstruction?:'smooth5';
 /** Preserve DE/goal low limbs only in the existing post-hit comparisons. */
 refineComparison?:'split';
}
export function mb3dParityFromPreset(n:NeutralMb3dPreset,mode:Mb3dParityLab['mode']='replay',firstStepFraction=.5):Mb3dParityLab {
 const h=n.legacyRecords.header,v=n.cameraView,num=(k:string)=>{const x=h[k];if(typeof x!=='number'||!Number.isFinite(x))throw Error('Native parity needs '+k);return x;};
 if(n.source.mandId!==44||num('bNewOptions')!==0||num('bPlanarOptic')!==0||num('bStereoMode')!==0||num('bCutOption')!==0||num('TilingOptions')!==0||(num('iOptions')&4)!==0)throw Error('Unvalidated native camera/stepping profile');
 const width=num('Width'),height=num('Height'),stepWidth=2.1345/(num('dZoom')*width),axes=(v.storedBasis as number[][]).map(row=>row.map(x=>x/Math.hypot(...row))),delta=num('dZstart')-num('dZmid'),fov=num('dFOVy')*Math.PI/180;
 const config:Mb3dParityLab={mode,width,height,axes,nearCenter:(v.fractalCenter as number[]).map((x,i)=>x+delta*axes[2]![i]!),radiansPerPixel:fov/height,stepWidth,maxDistance:num('dZend')-num('dZstart'),bailoutRadius:num('RStop'),deStop:Math.fround(Math.max(.001,num('sDEstop'))),adaptFactor:num('bVaryDEstopOnFOV')?Math.fround(Math.sin(.01)*Math.max(1/65535,fov)/(.01*height)):0,raystep:Math.fround(Math.max(.0001,num('mZstepDiv'))),limiter:Math.fround(Math.max(width,height)*.5*Math.sqrt(Math.fround(num('mZstepDiv'))+Math.fround(.001))*Math.max(Math.fround(.01),num('sRaystepLimiter'))),binarySteps:num('bStepsafterDEStop'),firstStepFraction,deScale:Math.fround(1/stepWidth)*stepWidth};
 validateMb3dParity(config);return config;
}
export function validateMb3dParity(c:Mb3dParityLab):void {
 if(!['camera','replay'].includes(c.mode)||!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||!Number.isInteger(c.binarySteps)||c.binarySteps<0||c.binarySteps>64||c.firstStepFraction<0||c.firstStepFraction>1)throw Error('Invalid native parity profile');
 for(const x of [c.width,c.height,c.radiansPerPixel,c.stepWidth,c.maxDistance,c.bailoutRadius,c.deStop,c.raystep,c.limiter,c.deScale])if(!Number.isFinite(x)||x<=0)throw Error('Positive native scalar required');
 if(!Number.isFinite(c.adaptFactor)||c.adaptFactor<0||!Number.isFinite(c.firstStepFraction))throw Error('Invalid native adaptive/random value');
 if(c.horizontalRadiansPerPixel!==undefined&&(!Number.isFinite(c.horizontalRadiansPerPixel)||c.horizontalRadiansPerPixel<=0))throw Error('Positive native horizontal coefficient required');
 if(c.normalReconstruction!==undefined&&c.normalReconstruction!=='smooth5')throw Error('Unsupported native normal reconstruction');
 if(c.refineComparison!==undefined&&c.refineComparison!=='split')throw Error('Unsupported native refinement comparison');
 if(c.goalScale!==undefined&&(!Number.isFinite(c.goalScale)||c.goalScale<=0))throw Error('Positive detail goal scale required');
 if(c.axes.length!==3||c.axes.some(a=>a.length!==3||!a.every(Number.isFinite)||Math.abs(Math.hypot(...a)-1)>1e-10)||c.nearCenter.length!==3||!c.nearCenter.every(Number.isFinite))throw Error('Invalid native camera basis');
}
export function mb3dNativeRay(c:Mb3dParityLab,x:number,y:number){
 const ax=(c.width*.5-(x+1))*(c.horizontalRadiansPerPixel??c.radiansPerPixel),ay=(y-c.height*.5)*c.radiansPerPixel;
 const local=[-Math.sin(ax),Math.sin(ay),Math.cos(ax)*Math.cos(ay)],length=Math.hypot(...local);
 return {origin:c.nearCenter.map((v,i)=>v+c.stepWidth*((x-c.width*.5)*c.axes[0]![i]!+(y-c.height*.5)*c.axes[1]![i]!)),direction:c.nearCenter.map((_,i)=>local.reduce((s,v,j)=>s+v/length*c.axes[j]![i]!,0))};
}
export function mb3dNativeGoal(c:Mb3dParityLab,t:number){return Math.fround(c.deStop*(1+t/c.stepWidth*c.adaptFactor))*c.stepWidth*(c.goalScale??1);}
/** Native 0.001 internal-unit stopping rule, expressed in world units. */
export function mb3dRefinementConverged(distance:number,goal:number,stepWidth:number):boolean {
 if(![distance,goal,stepWidth].every(Number.isFinite)||stepWidth<=0)throw Error('Finite native refinement values required');
 return Math.abs(distance-goal)<Math.fround(.001)*stepWidth;
}
const f=(x:number)=>x.toExponential(16),ds=(x:number)=>`vec2f(${f(Math.fround(x))},${f(Math.fround(x-Math.fround(x)))})`;
export function mb3dParityShader(shader:string,c:Mb3dParityLab,budget:number):string {
 validateMb3dParity(c);let s=shader;const one=(a:string,b:string)=>{if(s.split(a).length!==2)throw Error('Native parity anchor '+a);s=s.replace(a,b);};
 if(!s.includes('fn geoDSNative(')||!s.includes('geoDSPosition'))throw Error('Native replay needs source-parameter DS provider');
 const a=s.indexOf('  var origin = u.camPos.xyz;'),b=s.indexOf('  let interval = clipInterval',a);if(a<0||b<0)throw Error('Native camera anchors');
 const initializers=s.slice(a,b).match(/  geoInfo=vec4f\(0.0\);[\s\S]*/)?.[0]??'';
 s=s.slice(0,a)+`  geoNativeCamera(p0-vec2f(0.5));
  var origin=vec3f(geoNativeO.x.x+geoNativeO.x.y,geoNativeO.y.x+geoNativeO.y.y,geoNativeO.z.x+geoNativeO.z.y);
  var dir=vec3f(geoNativeD.x.x+geoNativeD.x.y,geoNativeD.y.x+geoNativeD.y.y,geoNativeD.z.x+geoNativeD.z.y);
`+initializers+s.slice(b);
 if(c.mode==='camera'){
  s=s.replaceAll('dsPoint(origin,dir,','geoNativePoint(');
  const at=s.indexOf('  let interval = clipInterval',s.indexOf('fn fs('));if(at<0)throw Error('Native main interval');
  s=s.slice(0,at)+s.slice(at).replace('  let interval = clipInterval(origin, dir, u.march.w);',`  let interval = vec2f(0.0,${f(c.maxDistance)});`);
 }else{
  const start=s.indexOf('  let interval = clipInterval',s.indexOf('fn fs(')),end=s.indexOf('  let profileStage =',start);if(start<0||end<0)throw Error('Native primary anchors');
  s=s.slice(0,start)+`
  let interval=vec2f(0.0,${f(c.maxDistance)});let clipped=false;var t=0.0;var hit=false;var escapeUnsignedInterior=false;var steps=0;
  var nt=vec2f(0.0);var de=0.0;var lastDE=0.0;var lastStep=0.0;var multiplier=1.0;var first=true;var goal=geoNativeGoal(0.0);var status=2.0;
  ${c.refineComparison?'var dePair=vec2f(0.0);':''}
  geoDSReady=false;geoInfo=vec4f(0.0);geoMore=vec4f(0.0);
  for(var query=0u;query<${budget}u;query++){
   t=nt.x+nt.y;goal=geoNativeGoal(t);let sample=geoDSNative(geoNativePoint(nt),goal*1.03);de=(sample.d.x+sample.d.y)*${f(c.deScale)};steps=i32(query);geoMore.y=f32(query+1u);
   ${c.refineComparison?`dePair=dsM(sample.d,${ds(c.deScale)});let rawSampleDE=de;`:''}
   if(!(abs(de)<1e18)){status=4.0;break;}
   if(query>0u){de=min(de,lastDE+lastStep);let drop=lastDE-de;multiplier=select(1.0,max(0.5,min(1.0,lastStep/max(drop,1e-30))),drop>1e-30);}
   ${c.refineComparison?'if(de<rawSampleDE){dePair=vec2f(de,0.0);} // Preserve the existing primary clamp.':''}
   if(de<goal){
    var refineStep=-0.5*lastStep;
    for(var refine=0u;refine<${c.binarySteps}u;refine++){
     if(${c.refineComparison?`dsLT(dsAbs(dsS(dePair,geoNativeGoalPair(nt))),${ds(Math.fround(.001)*c.stepWidth)})`:`abs(de-goal)<${f(Math.fround(.001)*c.stepWidth)}`}){break;}
     nt=dsA(nt,vec2f(refineStep,0.0));t=nt.x+nt.y;goal=geoNativeGoal(t);
     if(refine+1u>=${c.binarySteps}u){break;}
     let value=geoDSNative(geoNativePoint(nt),goal*1.03);de=(value.d.x+value.d.y)*${f(c.deScale)};
     ${c.refineComparison?`dePair=dsM(value.d,${ds(c.deScale)});`:''}
     refineStep=select(abs(refineStep)*0.55,-abs(refineStep)*0.55,${c.refineComparison?'dsLT(dePair,geoNativeGoalPair(nt))':'de<goal'});
    }
    hit=true;status=1.0;geoDSPosition=geoNativePoint(nt);geoDSDepth=nt;geoDSCore=geoDSNative(geoDSPosition,goal*1.03).core;geoDSReady=true;de=geoDSCore.x*${f(c.deScale)};break;
   }
   lastDE=de;
   var step=max(${f(Math.fround(.11)*c.stepWidth)},de*${f(c.raystep)}*multiplier);
   step=min(step,max(goal,${f(.4*c.stepWidth)})*${f(c.limiter)});
   if(first){step*= ${f(c.firstStepFraction)};first=false;}
   lastStep=step;let next=dsA(nt,vec2f(step,0.0));if(all(next==nt)){status=3.0;break;}nt=next;
   if(nt.x+nt.y>interval.y){status=5.0;t=nt.x+nt.y;break;}
  }
  t=nt.x+nt.y;geoInfo=vec4f(status,goal,goal,t);geoMore.x=de;geoMore.w=${budget}.0;let exhausted=!hit&&status==2.0;
`+s.slice(end);
 }
 const helpers=mb3dCameraHelpers(c);
 if(c.normalReconstruction==='smooth5')one('  let outward=geoMicroNormal(p,t);','  let outward=geoFiveNormal(p,t);');
 return helpers+s+(c.normalReconstruction==='smooth5'?nativeFiveShader(c.axes,c.stepWidth,c.deStop,c.adaptFactor):'');
}

/** Shared only by isolated matched-ray diagnostics; unchanged GEO3C equations. */
export function mb3dCameraHelpers(c:Mb3dParityLab):string {
 validateMb3dParity(c);
 const component=(axis:number,local:string[])=>local.map((v,j)=>`dsM(${v},${ds(c.axes[j]![axis]!)})`).reduce((a,b)=>`dsA(${a},${b})`);
 const goalScale=c.goalScale===undefined||c.goalScale===1?'':`*${f(c.goalScale)}`;
 const helpers=`
 var<private> geoNativeO:DSP;var<private> geoNativeD:DSP;
 fn geoNativeSin(x:vec2f)->vec2f{let xx=dsM(x,x);var term=x;var sum=x;for(var k=1u;k<=10u;k++){term=dsD(dsM(-term,xx),vec2f(f32((2u*k)*(2u*k+1u)),0.0));sum=dsA(sum,term);}return sum;}
 fn geoNativeCos(x:vec2f)->vec2f{let xx=dsM(x,x);var term=vec2f(1.0,0.0);var sum=term;for(var k=1u;k<=10u;k++){term=dsD(dsM(-term,xx),vec2f(f32((2u*k-1u)*(2u*k)),0.0));sum=dsA(sum,term);}return sum;}
 fn geoNativeCamera(pixel:vec2f){
 let px=dsS(vec2f(pixel.x,0.0),${ds(c.width*.5)});let py=dsS(vec2f(pixel.y,0.0),${ds(c.height*.5)});
 let ax=dsM(dsS(-px,vec2f(1.0,0.0)),${ds(c.horizontalRadiansPerPixel??c.radiansPerPixel)});let ay=dsM(py,${ds(c.radiansPerPixel)});
 var local=DSP(-geoNativeSin(ax),geoNativeSin(ay),dsM(geoNativeCos(ax),geoNativeCos(ay)));local=dsScale(local,dsD(vec2f(1.0,0.0),dsQ(dsDot(local))));
 geoNativeD=DSP(${[0,1,2].map(i=>component(i,['local.x','local.y','local.z'])).join(',')});
 geoNativeO=DSP(${[0,1,2].map(i=>`dsA(${ds(c.nearCenter[i]!)},dsM(dsA(dsM(px,${ds(c.axes[0]![i]!)}),dsM(py,${ds(c.axes[1]![i]!)})),${ds(c.stepWidth)}))`).join(',')});
 }
 fn geoNativePoint(t:vec2f)->DSP{return DSP(dsA(geoNativeO.x,dsM(geoNativeD.x,t)),dsA(geoNativeO.y,dsM(geoNativeD.y,t)),dsA(geoNativeO.z,dsM(geoNativeD.z,t)));}
 fn geoNativeGoal(t:f32)->f32{return (${f(c.deStop)}*(1.0+t/${f(c.stepWidth)}*${f(c.adaptFactor)}))*${f(c.stepWidth)}${goalScale};}
 ${c.refineComparison?`fn geoNativeGoalPair(t:vec2f)->vec2f{
 let units=dsM(${ds(c.deStop)},dsA(vec2f(1.0,0.0),dsM(dsD(t,${ds(c.stepWidth)}),${ds(c.adaptFactor)})));
 // The original msDEstop storage is Single. Round once there, then retain
 // the low limb of its conversion back into world distance.
 return dsM(vec2f(units.x+units.y,0.0),${ds(c.stepWidth*(c.goalScale??1))});
 }`:''}
 `;
 return helpers;
}
