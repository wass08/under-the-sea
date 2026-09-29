import {MeshBasicMaterial,Quaternion,Vector3} from 'three/webgpu';
import {createShardWorld,releaseShards} from '../src/lib/release';
import {generateShatterPattern} from '../src/lib/shatter';import {random} from '../src/lib/random';
for(const profile of ['economy','launch'] as const)for(const idle of [0,100,231]) {
 const world=await createShardWorld();world.profile=profile;const material=new MeshBasicMaterial();
 world.addStaticBox({x:0,y:-.1,z:0},{x:80,y:.2,z:80});world.addStaticBox({x:0,y:.11,z:0},{x:3.55,y:.22,z:.55},true);
 for(let i=0;i<idle;i++)world.step(1/60);
 const cells=generateShatterPattern({level:3,width:3.2,height:2,impact:[.02,.01],count:220,seed:912}).cells;
 const shards=releaseShards({cells,world,material,origin:new Vector3(0,1.25,0),rotation:new Quaternion(),impact:new Vector3(.02,1.26,0),width:3.2,height:2,level:3,budget:400,minimumArea:.025,floorY:0,random:random(117)});
 let ref:number[][]=[],maxRotation=0,maxDisplacement=0,worst=-1;
 for(let i=1;i<=300;i++) {
  world.step(1/60);world.sync();
  if(i<180||i>240)continue;
  const poses=shards.map(s=>[...s.mesh.position.toArray(),...s.mesh.quaternion.toArray()]);if(!ref.length)ref=poses;
  poses.forEach((p,j)=>{const a=ref[j],q=a.slice(3),r=p.slice(3),angle=2*Math.acos(Math.min(1,Math.abs(q.reduce((n,v,k)=>n+v*r[k],0)/Math.hypot(...q)/Math.hypot(...r))));if(angle>maxRotation){maxRotation=angle;worst=j;}maxDisplacement=Math.max(maxDisplacement,Math.hypot(...p.slice(0,3).map((v,k)=>v-a[k])));});
 }
 console.log(JSON.stringify({profile,idle,count:shards.length,maxRotation,maxDisplacement,worst,awake5:shards.filter(s=>!s.body.isSleeping()).length,pose:worst<0?null:shards[worst].body.translation()}));
 shards.forEach(s=>s.mesh.geometry.dispose());material.dispose();world.dispose();
}
