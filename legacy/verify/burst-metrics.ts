import { perf } from './four-wall-metrics';
import type RAPIER from '@dimforge/rapier3d-compat';
type Binding={body:RAPIER.RigidBody;grounded:boolean;restingDrag:boolean;syncedStill:boolean;extraIterations:number};
type V={x:number;y:number;z:number};
export function createBurstProbe(world:RAPIER.World) {
 if(typeof location==='undefined'||!new URLSearchParams(location.search).has('burstProbe'))return null;
 const until=Number(new URLSearchParams(location.search).get('burstUntil')??.5);
 const bodies:{body:RAPIER.RigidBody;impact:V;homeRadius:number}[]=[],steps:Record<string,unknown>[]=[],frames:Record<string,number>[]=[];let start=-1,frame=0,last=0,realStart=0;
 const probe={steps,frames,stopAt:Infinity,release(shards:{body:RAPIER.RigidBody}[],impact:V,time:number){
  Object.assign(window,{burstProbe:probe});
  if(start!==time){bodies.length=steps.length=frames.length=0;start=time;realStart=last=performance.now();frame=0;}
  for(const s of shards)bodies.push({body:s.body,impact:{...impact},homeRadius:Math.hypot(s.body.worldCom().x-impact.x,s.body.worldCom().y-impact.y,s.body.worldCom().z-impact.z)});
 },before(time:number,bindings:Binding[]){
  if(start<0||time-start>=until-1e-8)return;
  const states=bindings.map(b=>({handle:b.body.handle,regime:b.restingDrag?'quiet':b.grounded?'supported':'airborne',linear:b.body.linearDamping(),angular:b.body.angularDamping(),sleep:b.body.isSleeping(),cached:b.syncedStill,solver:world.numSolverIterations+b.extraIterations}));
  steps.push({time:time-start,frame,solver:world.numSolverIterations,pgs:world.numInternalPgsIterations,states});
 },after(time:number){
  if(start<0||time-start>until+1e-8)return;
  const rows=bodies.map(({body,impact,homeRadius})=>{const p=body.worldCom(),v=body.linvel(),w=body.angvel(),r={x:p.x-impact.x,y:p.y-impact.y,z:p.z-impact.z},length=Math.hypot(r.x,r.y,r.z);return {handle:body.handle,p,q:body.rotation(),v,w,homeRadius,radius:length,radial:(v.x*r.x+v.y*r.y+v.z*r.z)/Math.max(1e-10,length),speed:Math.hypot(v.x,v.y,v.z),angular:Math.hypot(w.x,w.y,w.z),sleep:body.isSleeping()};});
  Object.assign(steps.at(-1)!,{after:time-start,bodies:rows});
 },frame(time:number,count:number){if(start<0)return;const now=performance.now();frames.push({physics:perf?.physics??0,rapier:perf?.rapier??0,sync:perf?.sync??0,time:time-start,wallTime:(now-realStart)/1000,ms:now-last,steps:count,frame:++frame});last=now;},get count(){return bodies.length;},get start(){return start;}};
 Object.assign(window,{burstProbe:probe});return probe;
}
