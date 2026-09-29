import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
await page.addInitScript(()=>{
 window.__THREE_DEVTOOLS__=new EventTarget();
 __THREE_DEVTOOLS__.addEventListener('observe',e=>{if(e.detail.isRenderer){const renderer=e.detail,render=renderer.render.bind(renderer);renderer.render=(scene,camera,...args)=>{if(scene.isScene&&scene.children.length>10){window.scene=scene;if(camera.isPerspectiveCamera)window.camera=camera;if(window.parts&&window.mode) for(const [name,objects] of Object.entries(parts)) objects.forEach(o=>o.visible=mode!=='opaque'&&mode!==`no-${name}`);}return render(scene,camera,...args);};}});
});
await page.goto('http://localhost:4174/?camera=front');await page.waitForFunction(()=>window.aquarium?.elapsed>2);
await page.evaluate(()=>{const now=performance.now();performance.now=()=>now;});
const info=await page.evaluate(()=>{
 window.parts={glass:scene.children.filter(o=>o.userData.wall!==undefined),surface:scene.children.filter(o=>o.renderOrder===3),volume:scene.children.filter(o=>o.renderOrder===2),shafts:scene.children.filter(o=>o.name==='Water single scattering')};
 const peak=scene.children.find(o=>o.geometry?.getAttribute('biome'));
 const p=peak.geometry.getAttribute('position'),n=peak.geometry.getAttribute('normal'),biome=peak.geometry.getAttribute('biome'),facets=[];
 const sun=scene.children.find(o=>o.isDirectionalLight).position.clone().sub(scene.children.find(o=>o.isDirectionalLight).target.position).normalize();
 for(let i=0;i<p.count;i+=3){const vertices=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j)+peak.position.y,p.getZ(i+j)]);const center=peak.position.clone().set(0,0,0);vertices.forEach(v=>center.add(peak.position.clone().fromArray(v).multiplyScalar(1/3)));const normal=peak.position.clone().set(n.getX(i),n.getY(i),n.getZ(i)); const projected=center.clone().project(camera);
 facets.push({id:i/3,vertices,center:center.toArray(),normal:normal.toArray(),light:normal.dot(sun),biome:biome.getX(i),pixel:[(projected.x*.5+.5)*2880,(-projected.y*.5+.5)*1620],facing:normal.dot(camera.position.clone().sub(center))});}
 return {camera: {position:camera.position.toArray(),fov:camera.fov,aspect:camera.aspect},facets,parts:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.length]))};
});await writeFile('verify/run-g/facets.json',JSON.stringify(info));
for(const mode of ['all','no-shafts','no-volume','no-surface','no-glass','opaque']){
 await page.evaluate(mode=>{window.mode=mode;},mode);
 await page.waitForTimeout(150);await page.screenshot({path:`verify/run-g/${mode}.png`});
}
await browser.close();
