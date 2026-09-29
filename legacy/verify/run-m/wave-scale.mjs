// Dense CPU evaluation of the shader's shared spectrum, including pinned horizontal
// displacement. Tilt is excluded from wave height and tested separately for rim clearance.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {WATER_SPECTRUM as spectrum,WATER_SCALE as tune} from '../../src/lib/waves.ts';
const halfX=2.974,halfZ=1.724,base=2.59,rim=3.66;
const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v)};
function measure(agitation,disturbances=false){
 let lo=Infinity,hi=-Infinity,maxFrameRange=0,maxX=0,maxZ=0,edgeMotion=0;
 for(let frame=0;frame<360;frame++){
  const time=frame/20;let frameLo=Infinity,frameHi=-Infinity;
  for(let ix=0;ix<=128;ix++)for(let iz=0;iz<=80;iz++){
   const x=-halfX+2*halfX*ix/128,z=-halfZ+2*halfZ*iz/80;
   let h=0,ox=0,oz=0;
   for(const [angle,wavelength,a,q] of spectrum){
    const dx=Math.cos(angle),dz=Math.sin(angle),k=2*Math.PI/wavelength;
    const phase=(x*dx+z*dz)*k-time*Math.sqrt(9.81*k),amplitude=a*(1+agitation*tune.agitationGain);
    h+=Math.sin(phase)*amplitude;
    const horizontal=Math.cos(phase)*amplitude*q*tune.choppiness*(1+agitation*tune.chopGain);
    ox+=dx*horizontal;oz+=dz*horizontal;
   }
   if(disturbances){
    h+=Math.sin((x*.6+z*.8)*4-time*7)*agitation*tune.sloshAmplitude;
    // Four simultaneous maximum-strength impacts: deliberately more severe than bubble pops.
    for(const [rx,rz] of [[-.4,-.2],[.4,.2],[-.2,.4],[.2,-.4]]){
     const age=time%3,ring=Math.hypot(x-rx,z-rz)-age*1.35;
     h+=Math.sin(ring*22)*Math.exp(-7*ring*ring-1.3*age)*tune.maxRippleStrength*tune.rippleAmplitude;
    }
   }
   const pin=smooth((halfX-Math.abs(x))/tune.edgeWidth)*smooth((halfZ-Math.abs(z))/tune.edgeWidth);
   ox*=pin;oz*=pin;maxX=Math.max(maxX,Math.abs(x+ox));maxZ=Math.max(maxZ,Math.abs(z+oz));
   if(ix===0||ix===128||iz===0||iz===80)edgeMotion=Math.max(edgeMotion,Math.hypot(ox,oz));
   lo=Math.min(lo,h);hi=Math.max(hi,h);frameLo=Math.min(frameLo,h);frameHi=Math.max(frameHi,h);
  }
  maxFrameRange=Math.max(maxFrameRange,frameHi-frameLo);
 }
 return {min:lo,max:hi,peakToTrough:hi-lo,maxSimultaneousPeakToTrough:maxFrameRange,maxX,maxZ,edgeMotion};
}
const rest=measure(0),maximum=measure(1),maximumWithImpacts=measure(1,true);
const amplitudeSum=spectrum.reduce((s,w)=>s+w[2],0);
const absoluteVerticalBound=amplitudeSum*(1+tune.agitationGain)+tune.sloshAmplitude+4*tune.rippleAmplitude*tune.maxRippleStrength;
const tiltBound=.025*Math.hypot(halfX,halfZ);
const highestPossibleSurface=base+absoluteVerticalBound+tiltBound;
const compressionBound=spectrum.reduce((s,w)=>s+w[2]*w[3]*2*Math.PI/w[1],0)*(1+tune.agitationGain)*tune.choppiness*(1+tune.chopGain);
assert.ok(rest.peakToTrough>=.01&&rest.peakToTrough<=.03);
assert.ok(maximum.peakToTrough/rest.peakToTrough>=3&&maximum.peakToTrough/rest.peakToTrough<=4);
assert.ok(maximumWithImpacts.peakToTrough<=rest.peakToTrough*4.2);
assert.ok(highestPossibleSurface<rim);
assert.ok(compressionBound<1,'Gerstner mapping cannot fold');
for(const result of [rest,maximum,maximumWithImpacts]){
 assert.ok(result.edgeMotion<1e-12,'no horizontal displacement away from glass');
 assert.ok(result.maxX<=halfX+1e-12&&result.maxZ<=halfZ+1e-12,'no wall penetration');
}
const result={samplesPerCase:360*129*81,seconds:17.95,resolution:[128,80],wavelengths:spectrum.map(w=>w[1]),rest,maximum,maximumWithImpacts,absoluteVerticalBound,tiltBound,highestPossibleSurface,rimClearance:rim-highestPossibleSurface,compressionBound};
writeFileSync('verify/run-m/wave-scale.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
