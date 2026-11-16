/** GEO7 isolated fixed-hit observations. Independent finite-difference variance
 * and standard shadow visibility; no changes to the GEO3C hit/normal solver.
 * Roughness follows the mathematical S5 footprint, not a synthetic normal map.
 * Shadow is explicitly an approximate control, not native HS equivalence.
 */
export type NativeAppearanceMode='artist'|'native-compatibility';
export function nativeTextureCoordinates(point:number[],normal:number[],scale:number,offset:number[]):{uv:[number,number];weight:number}[]{
 if(point.length!==3||normal.length!==3||offset.length!==2||![...point,...normal,...offset,scale].every(Number.isFinite)||scale<=0||Math.hypot(...normal)===0)throw Error('Finite triplanar material data required');
 const sum=normal.reduce((a,b)=>a+Math.abs(b),0),frac=(v:number)=>v-Math.floor(v);
 return [[1,2],[0,2],[0,1]].map(([x,y],i)=>({uv:[frac(point[x!]!*scale+offset[0]!),frac(point[y!]!*scale+offset[1]!)],weight:Math.abs(normal[i]!)/sum}));
}
export function nativePaletteLuminance(palette:number[],texture:number[]):number[]{
 if(palette.length!==3||texture.length!==3||![...palette,...texture].every(Number.isFinite))throw Error('Finite RGB required');
 const y=(v:number[])=>Math.max(0,.3*v[0]!+.59*v[1]!+.11*v[2]!);
 const ratio=y(texture)/(.001+y(palette));return palette.map(v=>v*ratio);
}
/** Legacy non-square display is already RGB; do not apply an extra sRGB EOTF. */
export function nativeDisplayRGB(rgb:number[],gammaCode:number):number[]{
 if(rgb.length!==3||rgb.some(n=>!Number.isFinite(n))||!Number.isInteger(gammaCode)||gammaCode<0||gammaCode>63)throw Error('Finite legacy display contract required');
 return rgb.map(value=>{const x=Math.max(0,Math.min(255,value));return gammaCode===32?x:gammaCode>32?x+(Math.sqrt(255*x)-x)*(gammaCode-32)/31:x+(x*x/255-x)*(1-gammaCode/32);});
}
export function nativeRoughnessMoment(gradient:number[],mean:number,samples:number[][],h:number,spacing:number):number {
 if(gradient.length!==3||samples.length!==2||samples.some(a=>a.length!==10)||![...gradient,mean,h,spacing,...samples.flat()].every(Number.isFinite)||h<=0||spacing<=0)throw Error('Complete S5 moment samples required');
 const indices=[-5,-4,-3,-2,-1,1,2,3,4,5];
 const variance=samples.reduce((total,axis)=>{const slopes=axis.map((x,i)=>(x-mean)/indices[i]!);return total+10*slopes.reduce((s,v)=>s+v*v,0)-slopes.reduce((s,v)=>s+v,0)**2;},0);
 const scale=h/(10*spacing),g2=gradient.reduce((s,v)=>s+v*v,0);
 return Math.round(255*Math.max(0,Math.min(1,Math.sqrt(Math.max(0,7*variance*scale*scale/(g2+1e-40)))-.05)));
}
export function nativeRoughnessShader(axes:number[][],stepWidth:number,adapt:number):string {
 const f=(n:number)=>n.toExponential(16);
 if(axes.length!==3||axes.some(a=>a.length!==3||a.some(x=>!Number.isFinite(x)))||!(stepWidth>0&&adapt>0))throw Error('Invalid native roughness footprint');
 return `fn geo7Roughness(t:f32)->f32{
 let basis=mat3x3f(${axes.map(a=>'vec3f('+a.map(f).join(',')+')').join(',')});
 let h=${f(stepWidth*.15)}*(1.0+t/${f(stepWidth)}*${f(adapt)});
 var g=vec3f(0.0);for(var j=0u;j<3u;j++){g[j]=0.5*(geoFiveSample(basis[j]*h,t)-geoFiveSample(-basis[j]*h,t));}
 if(!(dot(g,g)>0.0)){return 0.0;}let n=normalize(g);
 let tx=basis*geoFiveTangent(n,vec3f(1.0,0.0,0.0));let ty=basis*geoFiveTangent(n,vec3f(0.0,1.0,0.0));
 var mean=geoFiveSample(vec3f(0.0),t);
 for(var j=0u;j<2u;j++){mean+=geoFiveSample(basis[j]*(2.0*h),t)+geoFiveSample(basis[j]*(-2.0*h),t);}mean*=0.2;
 let spacing=h*(12.0/11.0);var variance=0.0;
 for(var axis=0u;axis<2u;axis++){let tangent=select(tx,ty,axis==1u);var sum=0.0;var square=0.0;
 for(var j=-5;j<=5;j++){if(j!=0){let value=(geoFiveSample(tangent*(f32(j)*spacing),t)-mean)/f32(j);sum+=value;square+=value*value;}}
 variance+=10.0*square-sum*sum;}
 let scale=h/(10.0*spacing);
 return round(255.0*clamp(sqrt(max(0.0,7.0*variance*scale*scale/(dot(g,g)+1e-40)))-0.05,0.0,1.0));
 }
 `;
}
/** Preserve all solver bytes except an added scalar counter. It observes the
 * fraction of the nominal step retained by the limiter, used by native fog.
 */
export function nativeStepObservation(shader:string):string {
 const anchor='   if(first){step*=';
 if(shader.split(anchor).length!==2)throw Error('Validated native marcher required');
 const re=/   step=min\(step,max\(goal,[^\n]+\);/;
 if(!re.test(shader))throw Error('Native limiter anchor required');
 return 'var<private> geo7StepCount:f32=0.0;\n'+shader.replace(re,line=>'   let nominalStep=step;\n'+line+'\n   geo7StepCount+=step/nominalStep;');
}

export function nativeVisibilityShader(direction:number[],maxDistance:number,maxQueries=1024):string {
 if(direction.length!==3||direction.some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...direction)-1)>1e-6||!(maxDistance>0&&Number.isFinite(maxDistance))||!Number.isSafeInteger(maxQueries)||maxQueries<1||maxQueries>4096)throw Error('Bounded unit-direction visibility control required');
 const f=(n:number)=>n.toExponential(16);
 return `fn geo7Visibility(n:vec3f,t:f32)->f32{
 let light=vec3f(${direction.map(f).join(',')});let goal=geoNativeGoal(t);
 var p=geoDSPosition;p.x=dsA(p.x,vec2f(n.x*goal*2.0,0.0));p.y=dsA(p.y,vec2f(n.y*goal*2.0,0.0));p.z=dsA(p.z,vec2f(n.z*goal*2.0,0.0));
 var distance=0.0;
 for(var i=0u;i<${maxQueries}u;i++){
 let value=geoDSNative(p,goal*1.03);let d=value.d.x+value.d.y;
 if(!(abs(d)<1e18)){return 3.0;}if(d<goal*0.5){return 0.0;}
 let step=max(goal*0.1,d*0.1);distance+=step;
 if(distance>${f(maxDistance)}){return 1.0;}
 p.x=dsA(p.x,vec2f(light.x*step,0.0));p.y=dsA(p.y,vec2f(light.y*step,0.0));p.z=dsA(p.z,vec2f(light.z*step,0.0));
 }return 2.0;}
 `;
}

/** Independently reconstructed, bounded native soft-visibility experiment.
 * All distances are world units. The native finite reach and projected-camera
 * threshold are essential: a global long ray is not the same visibility test.
 * Returns 0..1 visibility, 2 budget exhaustion, 3 invalid field. No primary edits.
 */
export function nativeSoftVisibilityShader(direction:number[],c:{width:number;height:number;stepWidth:number;maxDistance:number;radiansPerPixel:number;deScale:number;raystep:number;limiter:number},budget=2048):string {
 nativeVisibilityShader(direction,.1,budget);
 const f=(n:number)=>n.toExponential(16);
 if(![c.width,c.height,c.stepWidth,c.maxDistance,c.radiansPerPixel,c.deScale,c.raystep,c.limiter].every(n=>Number.isFinite(n)&&n>0))throw Error('Positive native visibility contract required');
 return `fn geo7Visibility(n:vec3f,t:f32,pixelY:f32)->f32{
 let light=vec3f(${direction.map(f).join(',')});
 if(dot(n,light)<0.0){return 0.0;}
 let view=vec3f(geoNativeD.x.x+geoNativeD.x.y,geoNativeD.y.x+geoNativeD.y.y,geoNativeD.z.x+geoNativeD.z.y);
 let depth=max(0.0,t-${f(.1*c.stepWidth)});
 let reach=(${f(c.width)}+pixelY)*0.6*${f(c.stepWidth)}*(1.0+0.5*min(depth,${f(c.maxDistance*.4)})*${f(c.radiansPerPixel/c.stepWidth)});
 var p=geoDSPosition;p.x=dsA(p.x,vec2f(-view.x*${f(.1*c.stepWidth)},0.0));p.y=dsA(p.y,vec2f(-view.y*${f(.1*c.stepWidth)},0.0));p.z=dsA(p.z,vec2f(-view.z*${f(.1*c.stepWidth)},0.0));
 var projected=depth;var goal=geoNativeGoal(abs(projected));
 var value=geoDSNative(p,goal*1.03);var distance=0.0;var d=(value.d.x+value.d.y)*${f(c.deScale)};var multiplier=2.0;var visibility=1.0;
 for(var i=0u;i<${budget}u;i++){
 let step=min(max(${f(Math.fround(.11)*c.stepWidth)},d*${f(c.raystep)}*multiplier),max(goal,${f(.4*c.stepWidth)})*${f(c.limiter)});
 let previous=d;distance+=step;
 p.x=dsA(p.x,vec2f(light.x*step,0.0));p.y=dsA(p.y,vec2f(light.y*step,0.0));p.z=dsA(p.z,vec2f(light.z*step,0.0));
 projected+=step*dot(light,view);goal=geoNativeGoal(abs(projected));value=geoDSNative(p,goal*1.03);d=(value.d.x+value.d.y)*${f(c.deScale)};
 if(!(abs(d)<1e18)){return 3.0;}
 let ratio=distance/reach;let r2=ratio*ratio;
 visibility=min(visibility,(d-goal)*80.0/(distance+${f(Math.fround(.11)*c.stepWidth)})+r2*r2*r2);
 if(d<=goal){return 0.0;}
 if(distance>reach){return round(63.0*clamp(visibility,0.0,1.0))/63.0;}
 d=min(d,previous+step);let drop=previous-d;multiplier=select(1.0,max(0.5,min(1.0,step/max(drop,1e-30))),drop>1e-30);
 }return 2.0;}
 `;
}
