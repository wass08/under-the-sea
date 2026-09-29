import { state } from '../src/state';
import type { PhysicsWorld } from '../src/lib/physics';
import type { ReleasedShard } from '../src/lib/release';
import type { Vector3 } from 'three/webgpu';
type Shard = ReleasedShard & { radial: Vector3; full:boolean };
export function createLaunchProbe(physics:PhysicsWorld, read:()=>Shard[], enabled:boolean) {
  if (!enabled || !new URLSearchParams(location.search).has('launchProbe')) return null;
  const frames:Record<string,number>[]=[];let start=-Infinity,realStart=0,initialTicks=0,impulseStart=0,previous=0,shots:number[]=[];
  const probe={frames,images:[] as {age:number;actual:number;data:string}[],
    arm(times:number[]=[]) {frames.length=0;probe.images.length=0;shots=[...times];},
    before(){impulseStart=physics.impulses.length;},
    begin(){start=state.elapsed;realStart=previous=performance.now();initialTicks=physics.totalSteps;probe.sample();},
    get launch(){return {profile:physics.profile,start,realStart,impulseFrames:[...new Set(physics.impulses.slice(impulseStart))],impulses:physics.impulses.length-impulseStart};},
    sample(){
      const age=state.elapsed-start,now=performance.now();if(age<0||age>10.2)return;
      const shards=read(),p=shards.map(s=>s.body.worldCom()),v=shards.map(s=>s.body.linvel()),speed=v.map(v=>Math.hypot(v.x,v.y,v.z)),angular=shards.map(s=>{const w=s.body.angvel();return Math.hypot(w.x,w.y,w.z);});
      let linked=0,coreLinked=0,radial=0,radialOutward=0;
      for(let i=0;i<shards.length;i++) {
        const r=shards[i].radial;const fraction=(v[i].x*r.x+v[i].y*r.y+v[i].z*r.z)/Math.max(1e-8,speed[i]);radial+=Math.abs(fraction);radialOutward+=fraction;
        if(age<=1.5)for(let j=0;j<i;j++)if((p[i].x-p[j].x)**2+(p[i].y-p[j].y)**2+(p[i].z-p[j].z)**2<.25**2&&(v[i].x-v[j].x)**2+(v[i].y-v[j].y)**2+(v[i].z-v[j].z)**2<.15**2){linked++;if(!shards[i].full&&!shards[j].full)coreLinked++;}
      }
      speed.sort((a,b)=>a-b);angular.sort((a,b)=>a-b);const q=(a:number[],f:number)=>a[Math.floor((a.length-1)*f)]??0;
      frames.push({age,wallAge:(now-realStart)/1000,frameMs:now-previous,frame:physics.frame,steps:physics.lastSteps,totalSteps:physics.totalSteps-initialTicks,physicsAge:(physics.totalSteps-initialTicks)/60,speed50:q(speed,.5),speed90:q(speed,.9),radial:radial/Math.max(1,shards.length),radialOutward:radialOutward/Math.max(1,shards.length),angular50:q(angular,.5),angular90:q(angular,.9),asleep:shards.filter(s=>s.body.isSleeping()).length,linked,coreLinked,count:shards.length,coreBodies:shards.filter(s=>!s.full).length,coreCells:shards.filter(s=>!s.full).reduce((n,s)=>n+s.body.numColliders(),0),solver:physics.world.numSolverIterations,effectiveSolver:physics.world.numSolverIterations+Math.max(0,...shards.map(s=>s.body.additionalSolverIterations())),pgs:physics.world.numInternalPgsIterations});previous=now;
    },
    rendered(canvas:HTMLCanvasElement){if(shots.length && state.elapsed-start>=shots[0]){const age=shots.shift()!;probe.images.push({age,actual:state.elapsed-start,data:canvas.toDataURL('image/png')});}},
  };
  Object.assign(window,{launchProbe:probe});return probe;
}
