import assert from 'node:assert/strict';
import {MeshBasicMaterial,Quaternion,Vector3} from 'three/webgpu';
import {createPhysicsWorld as original} from './burst-reference-physics';
import {createPhysicsWorld,type PhysicsWorld} from '../src/lib/physics';
import {releaseShards} from '../src/lib/release';
import {generateShatterPattern} from '../src/lib/shatter';import {random} from '../src/lib/random';
async function replay(level:2|3,reference:boolean,count=220,profile='legacy'){const world=reference?await original(undefined,true):await createPhysicsWorld(undefined,true);if('profile'in world)world.profile=profile as PhysicsWorld['profile'];world.addStaticBox({x:0,y:-.1,z:0},{x:80,y:.2,z:80});world.addStaticBox({x:0,y:.11,z:0},{x:3.55,y:.22,z:.55},true);
 const cells=generateShatterPattern({level,width:3.2,height:2,impact:[.02,.01],count,seed:912}).cells,material=new MeshBasicMaterial(),shards=releaseShards({cells,world:world as PhysicsWorld,material,origin:new Vector3(0,1.25,0),rotation:new Quaternion(),impact:new Vector3(.02,1.26,0),width:3.2,height:2,level,budget:400,minimumArea:level===2?.1:.025,floorY:0,random:random(117)}),poses:number[][]=[];
 for(let i=0;i<30;i++){world.step(1/60);poses.push(shards.flatMap(s=>[...Object.values(s.body.worldCom()),...Object.values(s.body.linvel()),...Object.values(s.body.angvel())]));}
 world.dispose();shards.forEach(s=>s.mesh.geometry.dispose());material.dispose();return poses;
}
for(const level of [2,3] as const)assert.deepEqual(await replay(level,true),await replay(level,false));
console.log('PASS reference reconstruction: Lab L2/L3 first 30 steps are bit-identical to saved pre-performance physics.ts.');

for(const level of [2,3] as const)assert.deepEqual(await replay(level,true,600),await replay(level,false,600,'launch'));
console.log('PASS dense Lab launch: L2/L3 at 600 cells match saved 48/12 solver trajectories for all first 30 steps.');
