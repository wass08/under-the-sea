import { build } from 'rolldown';
import {readFile} from 'node:fs/promises';
const seed=Number((await readFile('src/scene/island.ts','utf8')).match(/ISLAND_SEED = (\d+)/)[1]);
import { Vector3, PerspectiveCamera, Mesh, MeshBasicMaterial, Raycaster } from 'three/webgpu';
await build({input:'src/lib/terrain.ts',external:['three/webgpu'],output:{file:'verify/run-j/metrics-terrain.mjs',format:'esm'}});
const {generateIslandTerrain}=await import('./run-j/metrics-terrain.mjs');
/** Select by geometry/light orientation, never by screenshot brightness. */
export function contrastPair(preset = 'front') {
 const data=generateIslandTerrain(seed), mesh=new Mesh(data.geometry,new MeshBasicMaterial());mesh.position.y=.18;mesh.updateMatrixWorld();
 const camera=new PerspectiveCamera(39,1920/1080,.1,2000);if(preset==='default')camera.position.set(10.8,7.7,14.8);else camera.position.set(0,2.6,12.5);camera.lookAt(0,1.85,0);camera.updateMatrixWorld();
 const normal=data.geometry.getAttribute('normal'),sun=new Vector3(-2.65,4.85,-2.3).normalize();
 const ray=new Raycaster(),centres=data.faces.map(f=>new Vector3(f.x,f.height+.18,f.z));
 const eligible=(i)=>{const f=data.faces[i],n=new Vector3().fromBufferAttribute(normal,i*3);if(f.biome!==2||f.weights[2]<.9||f.height<1.0||f.height>1.8||n.z<.15)return false;
   ray.set(camera.position,centres[i].clone().sub(camera.position).normalize());const hit=ray.intersectObject(mesh)[0];return hit?.faceIndex===i;
 };
 const valid=data.faces.map((_,i)=>eligible(i)),pairs=[];
 data.faces.forEach((f,i)=>{if(!valid[i])return;for(const j of f.adjacent)if(valid[j]){
  const li=Math.max(0,new Vector3().fromBufferAttribute(normal,i*3).dot(sun)),lj=Math.max(0,new Vector3().fromBufferAttribute(normal,j*3).dot(sun));
  if(li>lj+.25)pairs.push({lit:i,dark:j,score:(li+.03)/(lj+.03)});
 }});
 pairs.sort((a,b)=>b.score-a.score);
 const selected=pairs[0];if(!selected)throw Error('No adjacent visible rock pair');
 const pixel=i=>{const p=centres[i].clone().project(camera);return [Math.round((p.x*.5+.5)*2880),Math.round((-.5*p.y+.5)*1620)];};
 const result={...selected,litPixel:pixel(selected.lit),darkPixel:pixel(selected.dark)};
 mesh.geometry.dispose();mesh.material.dispose();return result;
}
