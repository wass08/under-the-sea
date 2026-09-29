import { bundle } from './temp-build.mjs';
import { Vector3, PerspectiveCamera, Mesh, MeshBasicMaterial, Raycaster } from 'three/webgpu';
const {generateIslandTerrain}=await bundle('src/lib/terrain.ts');
/** Select adjacent visible rock by geometry and the actual point light, never pixel brightness. */
export function contrastPair(state) {
 const data=generateIslandTerrain(state.island.seed), mesh=new Mesh(data.geometry,new MeshBasicMaterial());mesh.position.fromArray(state.island.position);mesh.updateMatrixWorld();
 const camera=new PerspectiveCamera();camera.projectionMatrix.fromArray(state.camera.projection);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.matrixWorld.fromArray(state.camera.world);camera.matrixWorldInverse.copy(camera.matrixWorld).invert();camera.position.fromArray(state.camera.position);
 let next=0;const rendered=data.faces.map(f=>f.ids.every(id=>data.heights[id]===Math.fround(.10))?-1:next++);
 const normal=data.geometry.getAttribute('normal'),lamp=new Vector3().fromArray(state.lampPosition);
 const ray=new Raycaster(),centres=data.faces.map(f=>new Vector3(f.x,f.height,f.z).add(mesh.position));
 const eligible=(i)=>{if(rendered[i]<0)return false;const f=data.faces[i],n=new Vector3().fromBufferAttribute(normal,rendered[i]*3),centre=centres[i];if(f.biome!==2||f.weights[2]<.9||centre.y<state.tank.floor+.65||centre.y>state.height-.25||n.dot(camera.position.clone().sub(centre).normalize())<.2)return false;
   ray.set(camera.position,centre.clone().sub(camera.position).normalize());const hit=ray.intersectObject(mesh)[0];return hit?.faceIndex===rendered[i];
 };
 const valid=data.faces.map((_,i)=>eligible(i)),pairs=[];
 data.faces.forEach((f,i)=>{if(!valid[i])return;for(const j of f.adjacent)if(valid[j]){
  const incidence=k=>Math.max(0,new Vector3().fromBufferAttribute(normal,rendered[k]*3).dot(lamp.clone().sub(centres[k]).normalize()));
  const li=incidence(i),lj=incidence(j);
  if(li>lj+.25)pairs.push({lit:i,dark:j,score:(li+.03)/(lj+.03),incidence:[li,lj]});
 }});
 pairs.sort((a,b)=>b.score-a.score);
 const selected=pairs[0];if(!selected)throw Error('No adjacent visible rock pair');
 const pixel=i=>{const p=centres[i].clone().project(camera);return [Math.round((p.x*.5+.5)*state.camera.viewport[0]*state.pixelRatio),Math.round((-.5*p.y+.5)*state.camera.viewport[1]*state.pixelRatio)];};
 const result={...selected,litPixel:pixel(selected.lit),darkPixel:pixel(selected.dark),world:[centres[selected.lit].toArray(),centres[selected.dark].toArray()]};
 // Crop the projected tank interior; resolution/camera/landform changes cannot move it onto UI or floor.
 const corners=[];for(const x of [-1,1])for(const z of [-1,1])for(const y of [state.tank.floor+.2,state.height])corners.push(new Vector3(x*(state.tank.width/2-.2),y,z*(state.tank.depth/2-.2)).project(camera));
 result.crop=[Math.min(...corners.map(p=>p.x))*.5+.5,.5-Math.max(...corners.map(p=>p.y))*.5,Math.max(...corners.map(p=>p.x))*.5+.5,.5-Math.min(...corners.map(p=>p.y))*.5];
 mesh.geometry.dispose();mesh.material.dispose();return result;
}
