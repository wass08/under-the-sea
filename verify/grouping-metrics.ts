import {state} from '../src/state';
import type {Camera,Scene} from 'three/webgpu';
import type {PhysicsWorld} from '../src/lib/physics';
import {groupAdjacentCells,type ShatterCell} from '../src/lib/shatter';
import type {ReleasedShard} from '../src/lib/release';
export function createGroupingProbe(enabled:boolean) {
 if(!enabled||!new URLSearchParams(location.search).has('groupingProbe'))return null;
 const bodies:ReleasedShard[]=[];
 const releases:{wall:number;full:boolean;budget:number;minimumArea:number;groups:{cells:number;area:number}[]}[]=[];
 let floorArmed=false,floorFrozen=false,world:PhysicsWorld|undefined,view:Camera|undefined;
 const floorView=()=>{if(view&&floorFrozen){view.position.set(1.8,3.2,7.7);view.lookAt(.6,-.36,4.9);view.updateMatrixWorld(true);}};
 const probe={releases,body(i:number){const b=bodies[i].body;return {i,p:b.translation(),v:b.linvel(),w:b.angvel(),linearDamping:b.linearDamping(),angularDamping:b.angularDamping(),mass:b.mass(),asleep:b.isSleeping()};},floor:null as null|{age:number;physicsTime:number},armFloor(){floorArmed=true;},view(physics:PhysicsWorld,scene:Scene,camera:Camera){world=physics;view=camera;const before=scene.onBeforeRender;scene.onBeforeRender=function(...args){if(args[2]===camera)floorView();before.apply(this,args);};},update(){if(floorArmed&&!floorFrozen&&state.mode==='shattered'&&state.elapsed-state.shatterTime>=2){world!.frozen=true;floorFrozen=true;probe.floor={age:state.elapsed-state.shatterTime,physicsTime:world!.elapsed};}floorView();},record(cells:ShatterCell[],budget:number,minimumArea:number,shards:ReleasedShard[],wall:number,full:boolean) {
  const groups=groupAdjacentCells(cells,budget,minimumArea);if(groups.length!==shards.length)throw Error('Grouping/body count mismatch');
  bodies.push(...shards);
  releases.push({wall,full,budget,minimumArea,groups:groups.map((g,i)=>{if(g.length!==shards[i].body.numColliders())throw Error('Cell/collider count mismatch');return {cells:g.length,area:g.reduce((n,c)=>n+Math.abs(c.polygon.reduce((s,p,j)=>{const q=c.polygon[(j+1)%c.polygon.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2,0)};})});
 },snapshot(){const groups=releases.flatMap(r=>r.groups);return {bodies:groups.length,cells:groups.reduce((n,g)=>n+g.cells,0),histogram:[1,2,5,Infinity].map((hi,i)=>groups.filter(g=>g.cells>([0,1,2,5][i])&&g.cells<=hi).length),singleArea:groups.filter(g=>g.cells===1).reduce((n,g)=>n+g.area,0),compoundArea:groups.filter(g=>g.cells>1).reduce((n,g)=>n+g.area,0),releases};}};
 Object.assign(window,{groupingProbe:probe});return probe;
}
