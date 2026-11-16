/** VISUAL-02: primary composition only; never change the sampled secondary path. */
export function secondaryRadianceGainShader(shader:string,gain=1):string{
 if(!Number.isFinite(gain)||gain<0||gain>1)throw Error('Invalid secondary reflection radiance gain');
 if(gain===1)return shader;
 const composition='lit = base * (1.0 - metal) * light * occ + max(refl, metal) * (primarySpecular + environment * occ);';
 const pixel=shader.includes('let transportPixel =')?'transportPixel':'p0-u.extra.xy';
 const trace=`environment=tracedReflection(p,reflectionNormal,dir,t,clamp(matValue(1,core,p,n,steps),0.0,1.0),matF0,${pixel});`;
 for(const anchor of [composition,trace,'var environment = vec3f(0.0);'])if(shader.split(anchor).length!==2)throw Error('Secondary radiance composition anchor changed');
 // Mark the traced path explicitly so disabled reflections/NAV/LookDev retain
 // their existing environment fallback. Direct specular remains outside gain.
 return shader.replace('var environment = vec3f(0.0);','var environment = vec3f(0.0); var secondaryRadianceActive=false;')
  .replace(trace,trace+' secondaryRadianceActive=true;')
  // The gain is read from the uniform block (u.tune.y), not written into the text: moving the slider must not build the shader again (that took up to a minute).
  .replace(composition,composition.replace('environment * occ','environment * occ * select(1.0, u.tune.y, secondaryRadianceActive)'));
}
