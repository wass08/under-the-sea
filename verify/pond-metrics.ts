import {Vector3,type Camera,type Scene,type Mesh} from 'three/webgpu';
import {state,STAGE_Y} from '../src/state';
import type {PhysicsWorld} from '../src/lib/physics';
import type {ReleasedShard} from '../src/lib/release';
/** Explicit verification-only controls; ordinary aquarium runs allocate no probe. */
export function createPondProbe(scene:Scene,camera:Camera|undefined,world:PhysicsWorld,loose:Mesh,read:()=>ReleasedShard[]) {
 if(!camera||!new URLSearchParams(location.search).has('pondProbe'))return null;
 const view=camera,point=new Vector3();let mode='normal',stop=Infinity,frozen=false,eye:number[]|undefined,target:number[]|undefined;
 const visibility=new Map<Mesh,boolean>(),ponds=()=>scene.children.filter(o=>o.userData.floorPond) as Mesh[];
 const pose=()=>{if(eye&&target){view.position.fromArray(eye);view.lookAt(point.fromArray(target));view.updateMatrixWorld(true);}};
 const layers=()=>{for(const p of ponds()){p.visible=mode!=='glass-only'&&(visibility.get(p)??p.visible);p.renderOrder=mode==='glass-last'?-4+p.userData.wall*.01:mode==='pond-last'?10+p.userData.wall:p.userData.pondOrder;}loose.visible=mode!=='pond-only';};
 const previous=scene.onBeforeRender;scene.onBeforeRender=function(...args){if(frozen)layers();if(args[2]===view)pose();previous.apply(this,args);};
 const probe={arm(seconds:number){stop=seconds;},get frozen(){return frozen;},get age(){return state.elapsed-state.shatterTime;},
  update(){if(!frozen&&state.mode==='shattered'&&state.elapsed-state.shatterTime>=stop){for(const p of ponds())visibility.set(p,p.visible);world.frozen=true;state.timeScale=0;frozen=true;}pose();},
  view(position:number[],look:number[]){eye=position;target=look;pose();},
  layer(next:'normal'|'glass-last'|'pond-last'|'glass-only'|'pond-only'){mode=next;layers();},
  candidates(){pose();const points:{shard:number;world:number[];pixel:number[];pond:number}[]=[];
   for(const [shard,s]of read().entries()){const p=s.mesh.geometry.getAttribute('position'),n=s.mesh.geometry.getAttribute('normal');
    for(let i=0;i<p.count;i+=3){point.set(0,0,0);for(let j=0;j<3;j++)point.add(new Vector3().fromBufferAttribute(p,i+j));point.multiplyScalar(1/3).applyQuaternion(s.mesh.quaternion).add(s.mesh.position);
     if(point.y<STAGE_Y||point.y>STAGE_Y+.13||new Vector3().fromBufferAttribute(n,i).applyQuaternion(s.mesh.quaternion).y<.5)continue;
     const pond=ponds().findIndex(o=>((point.x-o.position.x)/o.scale.x)**2+((point.z-o.position.z)/o.scale.z)**2<.65**2);if(pond<0)continue;
     const world=point.toArray();point.project(view);if(Math.abs(point.x)>.96||Math.abs(point.y)>.96||point.z>1)continue;
     points.push({shard,world,pixel:[(point.x+1)*innerWidth/2,(1-point.y)*innerHeight/2],pond});
    }
   }return points;
  },
  get ordering(){return {ponds:ponds().map(p=>({order:p.renderOrder,y:p.position.y,depthWrite:(p.material as any).depthWrite,depthTest:(p.material as any).depthTest})),shard:{order:loose.renderOrder,depthWrite:(loose.material as any).depthWrite,depthTest:(loose.material as any).depthTest,transparent:(loose.material as any).transparent,transmission:(loose.material as any).transmission}};}
 };
 Object.assign(window,{pondProbe:probe});return probe;
}
