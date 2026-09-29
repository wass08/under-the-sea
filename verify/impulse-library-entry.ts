import assert from 'node:assert/strict';import {MeshBasicMaterial,Quaternion,Vector3} from 'three/webgpu';
import {createShardWorld,releaseShards,LAB_RELEASE_DEFAULTS,migrateLabReleaseSettings} from '../src/lib/release';
import {createShardWorld as oldWorld,releaseShards as oldRelease} from './impulse-before/release-reference';
import {generateShatterPattern} from '../src/lib/shatter';import {random} from '../src/lib/random';
async function aquarium(old:boolean){const world=(old?await oldWorld():await createShardWorld()) as Awaited<ReturnType<typeof createShardWorld>>;world.separateLaunch=true;world.individualCells=true;
 world.addStaticBox({x:0,y:-.54,z:0},{x:40,y:.24,z:40});world.addStaticBox({x:0,y:-.21,z:0},{x:8,y:.42,z:4.8});world.addStaticBox({x:0,y:.08,z:0},{x:7.78,y:.16,z:4.58});
 const material=new MeshBasicMaterial(),cells=generateShatterPattern({level:3,width:7.6,height:2.84,impact:[.6,.23],count:220,seed:93}).cells;
 const shards=(old?oldRelease:releaseShards)({cells,world,material,origin:new Vector3(0,1.58,2.2),rotation:new Quaternion(),impact:new Vector3(.6,1.81,2.2),width:7.6,height:2.84,level:3,budget:220,minimumArea:0,floorY:-.42,random:random(912),strength:1.35,maxSpeed:9,spinStrength:.75});
 const frames:number[][]=[];for(let i=0;i<300;i++){world.step(1/60);frames.push(shards.flatMap(s=>[...Object.values(s.body.translation()),...Object.values(s.body.rotation()),...Object.values(s.body.linvel()),...Object.values(s.body.angvel())]));}
 world.dispose();shards.forEach(s=>s.mesh.geometry.dispose());material.dispose();return frames;
}
assert.deepEqual(await aquarium(true),await aquarium(false));console.log('PASS aquarium profile: all 300 steps of positions, rotations and linear/angular velocities are bit-identical to pre-tuning sources.');
async function lab(level:1|2|3,chunks=[1/60],density=2500){const world=await createShardWorld();world.addStaticBox({x:0,y:-.1,z:0},{x:80,y:.2,z:80});world.addStaticBox({x:0,y:.11,z:0},{x:3.55,y:.22,z:.55},true);
 const material=new MeshBasicMaterial(),cells=generateShatterPattern({level,width:3.2,height:2,impact:[.02,.01],count:220,seed:912}).cells;
 const shards=releaseShards({cells,world,material,origin:new Vector3(0,1.25,0),rotation:new Quaternion(),impact:new Vector3(.02,1.26,0),width:3.2,height:2,level,budget:cells.length,minimumArea:0,floorY:0,random:random(117),density,profile:{kind:'lab',...LAB_RELEASE_DEFAULTS}});
 assert.equal(shards.length,cells.length);assert.ok(shards.every(s=>s.body.numColliders()===1));
 assert.ok(shards.every(s=>s.launch.angularSpeed<=14.001),'Lab spin is bounded at creation');
 const launch=shards.flatMap(s=>[...Object.values(s.body.linvel()),...Object.values(s.body.angvel())]),frames:number[][]=[];let rest:number[][]=[],maxDisplacement=0,maxRotation=0,awake5=-1;
 for(let tick=1;tick<=300;tick++){for(const dt of chunks)world.step(dt);world.sync();if(tick<=60)frames.push(shards.flatMap(s=>[...Object.values(s.body.translation()),...Object.values(s.body.rotation())]));
  if(tick===180)rest=shards.map(s=>[...s.mesh.position.toArray(),...s.mesh.quaternion.toArray()]);
  if(tick>=180&&tick<=240)for(let i=0;i<shards.length;i++){const a=rest[i],s=shards[i],q=new Quaternion(...a.slice(3) as [number,number,number,number]);maxDisplacement=Math.max(maxDisplacement,s.mesh.position.distanceTo(new Vector3(...a.slice(0,3) as [number,number,number])));maxRotation=Math.max(maxRotation,s.mesh.quaternion.angleTo(q));}
  if(tick===300)awake5=shards.filter(s=>!s.body.isSleeping()).length;
 }
 world.dispose();shards.forEach(s=>s.mesh.geometry.dispose());material.dispose();return {launch,frames,maxDisplacement,maxRotation,awake5};
}
for(const level of [1,2,3] as const){const a=await lab(level);console.log(`Lab L${level} rest: ${JSON.stringify({maxDisplacement:a.maxDisplacement,maxRotation:a.maxRotation,awake5:a.awake5})}`);assert.equal(a.awake5,0);assert.ok(a.maxDisplacement<.002);assert.ok(a.maxRotation<.01);
 if(level>1){assert.deepEqual(a.frames,(await lab(level,[1/120,1/120])).frames);const low=await lab(level,[1/60],250);assert.ok(a.launch.every((v,i)=>Math.abs(v-low.launch[i])<1e-4));}}
console.log('PASS Lab profile: deterministic render chunking, density-invariant impulses, bounded tumble, 3-4s rest and native sleep by 5s for L1-L3.');

const settings={impulse:1.6,falloff:3.8,forward:.6,spin:1,count:600};migrateLabReleaseSettings(settings);assert.deepEqual(settings,{...LAB_RELEASE_DEFAULTS,count:600,burstVersion:2});settings.impulse=2.1;migrateLabReleaseSettings(settings);assert.equal(settings.impulse,2.1);console.log('PASS Lab burst settings: old defaults migrate once; subsequent custom values persist.');
