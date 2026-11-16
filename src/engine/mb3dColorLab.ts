/** GEO6 isolated Co0-state experiment. Independent scalar/orbit equations;
 * no native palette, lighting, texture or source implementation is embedded.
 * See docs/rendering/GEO6_MICRODETAIL.md for pinned source observations.
 * This only observes a *fixed* verified hit. It never changes DE or traversal.
 */
export interface NativeColorContract {radius:number;totalIterations:number;colorOffset:number;zoomCompensation:number}
export interface NativePaletteContract {start:number;multiplier:number;depthOffset:number;depthScale:number;cycling:boolean;stops:{position:number;linear:number[]}[]}
export function nativePaletteIndex(word:number,t:number,c:NativePaletteContract):number {
 const index=Math.round(((word-c.start)*c.multiplier+(t+c.depthOffset)*c.depthScale)*16384);
 return c.cycling?((index%32768)+32768)%32768:Math.max(0,Math.min(32767,index));
}
export function nativePaletteShader(c:NativePaletteContract):string {
 if(c.stops.length!==10||!c.stops.every((s,i)=>Number.isInteger(s.position)&&s.position>=0&&s.position<32768&&s.linear.length===3&&s.linear.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&(i===0||s.position>c.stops[i-1]!.position))||![c.start,c.multiplier,c.depthOffset,c.depthScale].every(Number.isFinite))throw Error('Unsupported native palette');
 const f=(x:number)=>x.toExponential(16),colors=c.stops.map(s=>'vec3f('+s.linear.map(f).join(',')+')');
 return `fn geo6Palette(word:f32,t:f32)->vec3f{
 let index=round(((word-${f(c.start)})*${f(c.multiplier)}+(t+${f(c.depthOffset)})*${f(c.depthScale)})*16384.0);
 let ir=${c.cycling?'f32(i32(index)&32767)':'clamp(index,0.0,32767.0)'};
 ${c.stops.slice(0,9).map((s,i)=>`if(ir<${c.stops[i+1]!.position}.0){return mix(${colors[i]},${colors[i+1]},clamp((ir-${s.position}.0)/${c.stops[i+1]!.position-s.position}.0,0.0,1.0));}`).join('\n')}
 return ${c.cycling?`mix(${colors[9]},${colors[0]},(ir-${c.stops[9]!.position}.0)/${32767-c.stops[9]!.position}.0)` : colors[9]};}
 `;
}
export function nativeSmoothIteration(count:number,radiusSquared:number,previousSquared:number,radius:number,power=2):number {
 if(radiusSquared<=1)return count;
 const d=Math.log(.5*Math.log(radiusSquared)),stop=Math.fround(Math.log(Math.log(radius)));
 return Math.fround(count+(previousSquared>1?(stop-d)/(d-Math.log(.5*Math.log(previousSquared))+1e-100):stop-d/Math.log(power)));
}
export function nativeColorWords(smooth:number,trap:number,worldGoal:number,c:NativeColorContract,limited=true):[number,number] {
 if(![smooth,trap,worldGoal,c.radius,c.totalIterations,c.colorOffset,c.zoomCompensation].every(Number.isFinite)||worldGoal<=0||c.radius<=1||c.totalIterations<1)throw Error('Unsupported native color contract');
 const word=(v:number)=>Math.max(0,Math.min(32767,Math.round(Math.fround(v))));
 return [word(32767-Math.fround(smooth+(limited?c.colorOffset+c.zoomCompensation*Math.log(worldGoal):0))*Math.fround(32767/(c.totalIterations+1))),word(trap*4096)];
}
/** Derive an observer from the *actual* provider. Its original bytes and all
 * original entrypoints remain untouched; only the appended color query varies.
 * Co0 mix: smooth iteration sum; mean(primary minimum squared radius, field trap).
 * The center color query uses the same local threshold exit as the native field.
 */
export function nativeCo0Field(provider:string,radius:number):string {
 if(!(radius>1&&Number.isFinite(radius)))throw Error('Native radius > 1 required');
 const a=provider.indexOf(' fn geoDSNative(');if(a<0)throw Error('Validated native DS provider required');
 let q=provider.slice(a);
 const one=(a:string,b:string)=>{if(q.split(a).length!==2)throw Error('Native color provider anchor '+a);q=q.replace(a,b);};
 one('fn geoDSNative(','fn geo6ColorState(');
 one('var count=0.0;','var count=0.0;var previousRadius=dsDot(input);var radius=previousRadius;var orbitTrap=radius;');
 one('count+=1.0;','previousRadius=radius;radius=dsDot(v);orbitTrap=dsMin(orbitTrap,radius);count+=1.0;');
 one(' let denominator=dsAbs(w);',` let rr=radius.x+radius.y;let old=previousRadius.x+previousRadius.y;var smoothCount=count;
 if(rr>1.0){let d=log(0.5*log(rr));let stop=${Math.fround(Math.log(Math.log(radius))).toExponential(16)};
 if(old>1.0){smoothCount=count+(stop-d)/(d-log(0.5*log(old)));}else{smoothCount=count+stop-d/log(2.0);}}
 let denominator=dsAbs(w);`);
 one('count+bestI,h','smoothCount+bestI,0.5*(orbitTrap.x+orbitTrap.y+h)');
 return q;
}

/** A fixed-hit appearance adapter. 'existing' is a controlled scalar ablation:
 * same artist palette/material/texture and lighting, only the measure changes.
 * This is NOT native RGB parity. Native map/lighting are separate concerns.
 */
export function nativeCo0Appearance(shader:string,provider:string,c:NativeColorContract,palette?:NativePaletteContract):string {
 nativeColorWords(0,0,1,c);
 const anchor='  let base = surfaceBaseColorWith(core, p, n, steps)*materialData(0u).rgb;';
 if(shader.split(anchor).length!==2||!shader.includes('geoNativePoint(')||!shader.includes('geoFiveNormal('))throw Error('Validated native hit/normal path required');
 return nativeCo0Field(provider,c.radius)+(palette?nativePaletteShader(palette):'')+shader.replace(anchor,`
 let colorState=geo6ColorState(geoDSPosition,geoNativeGoal(t)*1.03);
 let compensated=colorState.core.y+${c.colorOffset.toExponential(16)}+${c.zoomCompensation.toExponential(16)}*log(geoNativeGoal(t));
 let word=clamp(round(32767.0-compensated*${Math.fround(32767/(c.totalIterations+1)).toExponential(16)}),0.0,32767.0);
 let colorCore=vec3f(core.x,core.y,2.0*word/32767.0);
 let base=${palette?'geo6Palette(word,t)':'surfaceBaseColorWith(colorCore,p,n,steps)'}*materialData(0u).rgb;
 `);
}
