import assert from 'node:assert/strict';
import {Scene,Vector3} from 'three/webgpu';
import {createSpill} from '../src/scene/spill';
import {TANK,waterHeight,waterNormal,breachDrawdowns,simTime} from '../src/state';
// Exercise the production sheet mesh with overlapping, full-width opposite breaches.
let maximumError=0,maximumOtherDepth=0,samples=0;
for(const order of [[0,1],[1,0]]) {
 const scene=new Scene(),spill=createSpill(scene,()=>{});waterHeight.value=TANK.base;waterNormal.value.set(.01,1,-.015).normalize();
 for(const wall of order)spill.add({wall,point:new Vector3(0,.5,(wall===0?1:-1)*(TANK.depth/2+.026)),normal:new Vector3(0,0,wall===0?1:-1),bottom:TANK.floor,width:TANK.width,full:true});
 spill.update(1/60);
 for(const mesh of scene.children.filter((m:any)=>m.visible&&m.userData.emitter?.sheet===m) as any[]) {
  const e=mesh.userData.emitter,p=mesh.geometry.getAttribute('position'),base=mesh.geometry.userData.base,head=waterHeight.value-e.opening.bottom;
  for(let i=0;i<p.count;i++)if(Math.abs(base[i*3+2]+.5)<1e-6) {
   const x=p.getX(i),z=p.getZ(i),parts=breachDrawdowns.map(({value:b})=>b.w*Math.max(0,1-((x-b.x)**2+(z-b.y)**2)/Math.max(.001,b.z*.8)**2)**3);
   const expected=waterHeight.value-(x*waterNormal.value.x+z*waterNormal.value.z)/waterNormal.value.y-parts.reduce((a,b)=>a+b,0)+base[i*3+1]/.04*Math.min(.025,head*.06);
   maximumError=Math.max(maximumError,Math.abs(p.getY(i)-expected));maximumOtherDepth=Math.max(maximumOtherDepth,parts[1-e.opening.wall]);samples++;
  }
 }
 for(let i=0;i<300;i++){simTime.value+=1/60;spill.update(1/60);}
 assert.ok(spill.puddles.every(p=>p.radius[0]===1.6),'Thin-sheet radius reaches its cap');spill.reset();
}
assert.ok(samples>0&&maximumOtherDepth>.08&&maximumError<1e-6);
console.log(`Opposite-wall lips: PASS ${samples} vertices, max error ${maximumError.toExponential(3)}, overlapping depth ${maximumOtherDepth.toFixed(6)} (both update orders); pond cap 1.6`);
